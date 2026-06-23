import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import admin from 'firebase-admin';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderErrorPage } from './errorPage';
import { isBotUserAgent, appendSubid, clickStatDay } from './src/lib/tracking';
import { DEFAULT_BRANDS } from './src/lib/brand';
import { projectPartnerResults } from './src/lib/partnerResults';
import { pullApprovedRoster, isOtgLinksConfigured } from './otgLinksPull';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let adminApp: admin.app.App | null = null;
let adminDb: admin.firestore.Firestore | null = null;

// Bucket do Storage (logos das casas). Default = bucket do projeto; override por env.
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'agencia-boost-app.firebasestorage.app';

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount), storageBucket: STORAGE_BUCKET });
  } else {
    adminApp = admin.initializeApp({ storageBucket: STORAGE_BUCKET });
  }
  adminDb = adminApp.firestore();
  console.log('Firebase Admin initialized');
} catch (error) {
  console.error('Firebase Admin initialization failed:', error);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // SECURITY (LOW): cabeçalhos de segurança. CSP fica desligada aqui porque exige
  // uma allowlist própria (Tailwind/Vite, Firebase, recharts, avatares dicebear) e
  // precisa ser testada — fica como follow-up; os demais headers (nosniff,
  // Referrer-Policy, HSTS, etc.) já entram. COEP off p/ não bloquear recursos
  // cross-origin legítimos (avatares, storage).
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  // O backoffice de casas envia a logo em base64 no corpo — precisa de um teto
  // maior. Parser dedicado ANTES do global (escopado em /api/houses): o global de
  // 32kb vira no-op p/ esse path (express.json não re-parseia req._body). Demais
  // rotas seguem no limite apertado.
  app.use('/api/houses', express.json({ limit: '4mb' }));

  // SECURITY (LOW): limite explícito do corpo JSON (evita payloads gigantes).
  app.use(express.json({ limit: '32kb' }));

  // SECURITY (MEDIUM-2): rate limit nas rotas PÚBLICAS de auth (criam/leem contas
  // e convites). Sem isso, dá pra martelar /api/accept-invite (cria usuários reais)
  // e enumerar e-mails. App.set('trust proxy', 1) p/ a chave por IP funcionar atrás
  // do Cloud Run/App Hosting.
  app.set('trust proxy', 1);
  const publicAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
  });

  // --- Auth middlewares -----------------------------------------------------
  // Clients send their Firebase ID token as `Authorization: Bearer <token>`.
  const verifyBearer = async (req: express.Request) => {
    if (!adminApp) return null;
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer (.+)$/);
    if (!match) return null;
    try {
      return await adminApp.auth().verifyIdToken(match[1]);
    } catch {
      return null;
    }
  };

  const requireAuth: express.RequestHandler = async (req, res, next) => {
    if (!adminApp || !adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    const decoded = await verifyBearer(req);
    if (!decoded) return res.status(401).json({ error: 'Não autenticado.' });

    let role: string | null = null;
    let affiliateId: string | null = null;
    try {
      const snap = await adminDb.collection('users').doc(decoded.uid).get();
      if (snap.exists) {
        const data = snap.data();
        role = data?.role ?? null;
        affiliateId = data?.affiliateId ?? null;
      }
    } catch {
      // fall through with null role/affiliateId
    }

    (req as any).user = { uid: decoded.uid, email: decoded.email, role, affiliateId };
    next();
  };

  const requireAdmin: express.RequestHandler = async (req, res, next) => {
    if (!adminApp || !adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    const decoded = await verifyBearer(req);
    if (!decoded) return res.status(401).json({ error: 'Não autenticado.' });
    try {
      const snap = await adminDb.collection('users').doc(decoded.uid).get();
      if (!snap.exists || snap.data()?.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores.' });
      }
    } catch {
      return res.status(500).json({ error: 'Erro ao verificar permissões.' });
    }
    (req as any).user = { uid: decoded.uid, email: decoded.email };
    next();
  };

  // --- Partner auth (M2M) ---------------------------------------------------
  // Um parceiro externo NÃO é usuário logado (sem Firebase JWT). Ele se autentica
  // com uma API key emitida pela PRÓPRIA Boost (≠ x-api-key da OTG), enviada no
  // header `x-boost-api-key`. Guardamos só o HASH (sha-256) em `api_partners`
  // (server-only) — a key crua é mostrada uma vez na emissão (scripts/partners).
  // `scopes` limita o que cada parceiro pode ler ('*' = tudo). Read-only por ora.
  const hashApiKey = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

  // Rate-limit por key (cai no IP como fallback). Generoso p/ integração server-to-server.
  const partnerLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    // Bucket por API key; sem key, cai no IP NORMALIZADO (ipKeyGenerator mascara
    // o IPv6 num /56 — senão um usuário IPv6 trocaria de IP e burlaria o limite).
    keyGenerator: (req) => String(req.headers['x-boost-api-key'] || ipKeyGenerator(String(req.ip || ''))),
    message: { error: 'Limite de requisições excedido. Aguarde um instante.' },
  });

  const requirePartner: express.RequestHandler = async (req, res, next) => {
    if (!adminApp || !adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    const raw = String(req.headers['x-boost-api-key'] || '').trim();
    if (!raw) return res.status(401).json({ error: 'API key ausente. Envie o header x-boost-api-key.' });
    try {
      const snap = await adminDb
        .collection('api_partners')
        .where('keyHash', '==', hashApiKey(raw))
        .limit(1)
        .get();
      if (snap.empty) return res.status(401).json({ error: 'API key inválida.' });
      const doc = snap.docs[0];
      const data = doc.data() as any;
      if (data.active === false) return res.status(403).json({ error: 'API key desativada.' });
      const scopes: string[] = Array.isArray(data.scopes) ? data.scopes.map(String) : [];
      (req as any).partner = { id: doc.id, name: data.name ?? null, scopes };
      // best-effort: marca último uso (não bloqueia a resposta)
      doc.ref.set({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
      next();
    } catch (error) {
      console.error('Erro ao validar API key de parceiro:', error);
      return res.status(500).json({ error: 'Erro ao validar credenciais.' });
    }
  };

  // Exige um scope específico (ou '*') no parceiro autenticado.
  const requireScope = (scope: string): express.RequestHandler => (req, res, next) => {
    const scopes: string[] = (req as any).partner?.scopes ?? [];
    if (scopes.includes('*') || scopes.includes(scope)) return next();
    return res.status(403).json({ error: `Sua chave não tem acesso a "${scope}".` });
  };
  // --------------------------------------------------------------------------

  const serializeTimestamp = (value: any) => {
    if (value?.toDate && typeof value.toDate === 'function') {
      return value.toDate().toISOString();
    }
    return value ?? null;
  };

  // B3 · Afiliado especial define a comissão de um sub-afiliado da própria sub-rede.
  // `affiliate_configs` é admin-only nas rules; este endpoint grava via Admin SDK
  // após validar que o caller é o especial DAQUELE sub. COM teto: a taxa do sub não
  // pode passar da taxa PRÓPRIA do especial (o teto que o master setou) — senão o
  // spread fica negativo. O ganho do especial é o spread sobre essa taxa própria.
  // requireAuth — o especial é `client`.
  app.post('/api/special/sub-config', requireAuth, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      const user = (req as any).user;
      const callerAffiliateId = user?.affiliateId ? String(user.affiliateId) : null;
      if (!callerAffiliateId) return res.status(403).json({ error: 'Sua conta não está vinculada a um afiliado.' });

      const { subAffiliateId, cpaValue, revPercentage } = req.body ?? {};
      const subId = subAffiliateId != null ? String(subAffiliateId) : '';
      if (!subId) return res.status(400).json({ error: 'subAffiliateId é obrigatório.' });

      const cpa = Number(cpaValue) || 0;
      const rev = Number(revPercentage) || 0;
      if (cpa < 0 || rev < 0) return res.status(400).json({ error: 'Valores não podem ser negativos.' });

      const specialSnap = await adminDb.collection('special_affiliates').doc(callerAffiliateId).get();
      const special = specialSnap.exists ? (specialSnap.data() as any) : null;
      if (!special?.active) return res.status(403).json({ error: 'Você não é um afiliado especial ativo.' });
      const subs = Array.isArray(special.subAffiliateIds) ? special.subAffiliateIds.map((s: any) => String(s)) : [];
      if (!subs.includes(subId)) return res.status(403).json({ error: 'Este afiliado não pertence à sua sub-rede.' });

      // Teto = taxa própria do especial (affiliate_configs do callerAffiliateId).
      // A taxa do sub não pode passar do teto (senão o spread do especial fica negativo).
      const ownCfgSnap = await adminDb.collection('affiliate_configs').doc(callerAffiliateId).get();
      const ownCfg = ownCfgSnap.exists ? (ownCfgSnap.data() as any) : {};
      const tetoCpa = Number(ownCfg.cpaValue) || 0;
      const tetoRev = Number(ownCfg.revPercentage) || 0;
      if (cpa > tetoCpa || rev > tetoRev) {
        return res.status(400).json({ error: `A comissão do sub não pode passar da sua taxa (teto: R$ ${tetoCpa}/CPA · ${tetoRev}% REV).` });
      }

      await adminDb.collection('affiliate_configs').doc(subId).set({
        affiliateId: subId,
        cpaValue: cpa,
        revPercentage: rev,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.json({ affiliateId: subId, cpaValue: cpa, revPercentage: rev });
    } catch (error: any) {
      console.error('Error setting sub-affiliate config:', error);
      return res.status(500).json({ error: error.message || 'Erro interno.' });
    }
  });

  // Admin · grava o registro de afiliado especial (special_affiliates) E espelha a
  // flag `isSpecial` em TODO login vinculado ao affiliateId. Resolver o uid PELO
  // affiliateId aqui (em vez de exigir o client passar o userUid) elimina o bug
  // recorrente do "especial ativo sem acesso à rede": antes a flag só pousava se a
  // UI tivesse o userUid em mãos, e o fluxo de convite (accept-invite) nunca a
  // setava — então o especial era roteado pra própria view, sem a /network.
  app.post('/api/special-affiliates', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      const { affiliateId, active, subAffiliateIds } = req.body ?? {};
      const affId = affiliateId != null ? String(affiliateId).trim() : '';
      if (!affId) return res.status(400).json({ error: 'affiliateId é obrigatório.' });
      const isActive = active === true;
      const subs = Array.isArray(subAffiliateIds) ? subAffiliateIds.map((s: any) => String(s)) : [];

      await adminDb.collection('special_affiliates').doc(affId).set({
        active: isActive,
        subAffiliateIds: isActive ? subs : [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Espelha isSpecial em todo user com este affiliateId (normalmente 1; batch
      // por segurança). Promoção → true; rebaixamento → false.
      const usersSnap = await adminDb.collection('users').where('affiliateId', '==', affId).get();
      if (!usersSnap.empty) {
        const batch = adminDb.batch();
        usersSnap.forEach((d) => batch.set(d.ref, {
          isSpecial: isActive,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }));
        await batch.commit();
      }

      return res.json({ affiliateId: affId, active: isActive, subAffiliateIds: isActive ? subs : [], linkedUsers: usersSnap.size });
    } catch (error: any) {
      console.error('Error saving special affiliate:', error);
      return res.status(500).json({ error: error.message || 'Erro interno salvando afiliado especial.' });
    }
  });

  // B4 · Dados de pagamento do afiliado (PIX + dados de NF). Preenchidos pelo
  // próprio afiliado; o admin apenas visualiza. São PII → coleção server-only
  // (payment_profiles), gravada via Admin SDK. O afiliado lê/grava o PRÓPRIO
  // perfil (escopado pelo affiliateId do token); o admin lê o de qualquer um.
  const sanitizePaymentProfile = (body: any) => ({
    pixKeyType: body?.pixKeyType ? String(body.pixKeyType).trim() : '',
    pixKey: body?.pixKey ? String(body.pixKey).trim() : '',
    documentType: body?.documentType === 'cnpj' ? 'cnpj' : 'cpf',
    document: body?.document ? String(body.document).trim() : '',
    legalName: body?.legalName ? String(body.legalName).trim() : '',
    address: body?.address ? String(body.address).trim() : '',
  });

  app.get('/api/payment-profile', requireAuth, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      const user = (req as any).user;
      const affiliateId = user?.affiliateId ? String(user.affiliateId) : null;
      if (!affiliateId) return res.status(400).json({ error: 'Sua conta não está vinculada a um afiliado.' });
      const snap = await adminDb.collection('payment_profiles').doc(affiliateId).get();
      return res.json(snap.exists ? { affiliateId, ...snap.data() } : { affiliateId });
    } catch (error: any) {
      console.error('Error fetching payment profile:', error);
      return res.status(500).json({ error: error.message || 'Erro interno.' });
    }
  });

  app.post('/api/payment-profile', requireAuth, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      const user = (req as any).user;
      const affiliateId = user?.affiliateId ? String(user.affiliateId) : null;
      if (!affiliateId) return res.status(400).json({ error: 'Sua conta não está vinculada a um afiliado.' });
      const data = sanitizePaymentProfile(req.body);
      if (!data.pixKey) return res.status(400).json({ error: 'A chave PIX é obrigatória.' });
      await adminDb.collection('payment_profiles').doc(affiliateId).set({
        affiliateId,
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.json({ affiliateId, ...data });
    } catch (error: any) {
      console.error('Error saving payment profile:', error);
      return res.status(500).json({ error: error.message || 'Erro interno.' });
    }
  });

  app.get('/api/payment-profile/:affiliateId', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      const { affiliateId } = req.params;
      const snap = await adminDb.collection('payment_profiles').doc(String(affiliateId)).get();
      return res.json(snap.exists ? { affiliateId, ...snap.data() } : { affiliateId });
    } catch (error: any) {
      console.error('Error fetching payment profile (admin):', error);
      return res.status(500).json({ error: error.message || 'Erro interno.' });
    }
  });

  app.post('/api/create-user', requireAdmin, async (req, res) => {
    if (!adminApp || !adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }

    try {
      const { name, email, password, role, affiliateId, mustChangePassword } = req.body;
      if (!email || !password || !name || !role) {
        return res.status(400).json({ error: 'Dados incompletos para criar usuário.' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const normalizedName = String(name).trim();
      const normalizedRole = String(role);
      let userRecord: admin.auth.UserRecord;

      try {
        userRecord = await adminApp.auth().createUser({
          email: normalizedEmail,
          password: String(password),
          displayName: normalizedName,
        });
      } catch (error: any) {
        if (error.code === 'auth/email-already-exists') {
          userRecord = await adminApp.auth().getUserByEmail(normalizedEmail);
        } else {
          throw error;
        }
      }

      const userDoc = adminDb.collection('users').doc(userRecord.uid);
      await userDoc.set({
        uid: userRecord.uid,
        name: normalizedName,
        email: normalizedEmail,
        role: normalizedRole,
        affiliateId: affiliateId ? String(affiliateId) : null,
        mustChangePassword: !!mustChangePassword,
        avatarUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(normalizedName)}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return res.json({ uid: userRecord.uid });
    } catch (error: any) {
      console.error('Error creating auth user:', error);
      return res.status(500).json({ error: error.message || 'Erro interno criando usuário.' });
    }
  });

  // Vincula um login JÁ EXISTENTE (por e-mail) a um afiliado. Corrige o caso de
  // users/{uid} sem `affiliateId` — que prende o afiliado no /profile, porque o
  // roteamento (clientHome) cai no fallback. Espelha `isSpecial` a partir de
  // special_affiliates. Admin-only (affiliateId/isSpecial só são gravados pelo
  // servidor — as rules proíbem o cliente de setá-los).
  app.post('/api/link-affiliate-user', requireAdmin, async (req, res) => {
    if (!adminApp || !adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }
    try {
      const { email, affiliateId } = req.body;
      if (!email || !affiliateId) {
        return res.status(400).json({ error: 'Informe o e-mail do login e o afiliado.' });
      }
      const normalizedEmail = String(email).trim().toLowerCase();
      const affId = String(affiliateId).trim();

      let userRecord: admin.auth.UserRecord;
      try {
        userRecord = await adminApp.auth().getUserByEmail(normalizedEmail);
      } catch (e: any) {
        if (e.code === 'auth/user-not-found') {
          return res.status(404).json({ error: 'Nenhum login encontrado com este e-mail.' });
        }
        throw e;
      }

      // isSpecial espelha special_affiliates (existe e ativo).
      const specialSnap = await adminDb.collection('special_affiliates').doc(affId).get();
      const isSpecial = specialSnap.exists && specialSnap.data()?.active !== false;

      await adminDb.collection('users').doc(userRecord.uid).set({
        affiliateId: affId,
        isSpecial,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.json({ uid: userRecord.uid, affiliateId: affId, isSpecial });
    } catch (error: any) {
      console.error('Error linking affiliate user:', error);
      return res.status(500).json({ error: error.message || 'Erro interno ao vincular login.' });
    }
  });

  app.get('/api/affiliate-statuses', requireAdmin, async (_req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }

    try {
      const snapshot = await adminDb.collection('affiliate_statuses').get();
      const statuses = snapshot.docs.reduce<Record<string, { status: string; updatedAt: string | null }>>((acc, item) => {
        const data = item.data();
        acc[item.id] = {
          status: data.status || 'inactive',
          updatedAt: serializeTimestamp(data.updatedAt)
        };
        return acc;
      }, {});

      return res.json(statuses);
    } catch (error: any) {
      console.error('Error fetching affiliate statuses:', error);
      return res.status(500).json({ error: error.message || 'Erro interno listando status.' });
    }
  });

  app.patch('/api/affiliates/:affiliateId', requireAdmin, async (req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }

    try {
      const { affiliateId } = req.params;
      const { status } = req.body ?? {};

      if (!affiliateId) {
        return res.status(400).json({ error: 'affiliateId é obrigatório.' });
      }

      if (status !== 'active' && status !== 'inactive') {
        return res.status(400).json({ error: 'Status inválido. Use active ou inactive.' });
      }

      await adminDb.collection('affiliate_statuses').doc(String(affiliateId)).set({
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return res.json({ affiliateId, status });
    } catch (error: any) {
      console.error('Error updating affiliate status:', error);
      return res.status(500).json({ error: error.message || 'Erro interno atualizando status.' });
    }
  });

  app.get('/api/audit-logs', requireAdmin, async (_req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }

    try {
      const snapshot = await adminDb
        .collection('audit_logs')
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get();

      const logs = snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          ...data,
          createdAt: serializeTimestamp(data.createdAt),
          updatedAt: serializeTimestamp(data.updatedAt)
        };
      });

      return res.json(logs);
    } catch (error: any) {
      console.error('Error fetching audit logs:', error);
      return res.status(500).json({ error: error.message || 'Erro interno listando logs.' });
    }
  });

  app.post('/api/audit-logs', requireAdmin, async (req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }

    try {
      const { affiliateId, actorId, actorName, action, reason } = req.body ?? {};

      if (!affiliateId || !action) {
        return res.status(400).json({ error: 'affiliateId e action são obrigatórios.' });
      }

      const payload = {
        affiliateId: String(affiliateId),
        actorId: actorId ? String(actorId) : null,
        actorName: actorName ? String(actorName) : null,
        action: String(action),
        reason: reason ? String(reason) : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const docRef = await adminDb.collection('audit_logs').add(payload);

      return res.status(201).json({
        id: docRef.id,
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error creating audit log:', error);
      return res.status(500).json({ error: error.message || 'Erro interno criando log.' });
    }
  });

  // --- Avisos / comunicados da rede (notices) -------------------------------
  // Feed broadcast: o admin publica, o afiliado lê (realtime, regra signed-in).
  // Escrita só pelo servidor (requireAdmin), com saneamento de tamanho/enum.
  const NOTICE_CATEGORIES = ['info', 'importante', 'comunicado'];
  const NOTICE_AUDIENCES = ['all', 'clients', 'specials'];

  const sanitizeNotice = (body: any) => {
    const title = String(body?.title ?? '').trim().slice(0, 160);
    const text = String(body?.body ?? '').trim().slice(0, 5000);
    const category = NOTICE_CATEGORIES.includes(body?.category) ? body.category : 'info';
    const audience = NOTICE_AUDIENCES.includes(body?.audience) ? body.audience : 'all';
    const link = body?.link ? String(body.link).trim().slice(0, 500) : '';
    return { title, text, category, audience, link };
  };

  app.post('/api/notices', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      const { title, text, category, audience, link } = sanitizeNotice(req.body);
      if (!title || !text) {
        return res.status(400).json({ error: 'Título e mensagem são obrigatórios.' });
      }
      const active = req.body?.active === undefined ? true : !!req.body.active;
      const payload = {
        title,
        body: text,
        category,
        audience,
        link: link || null,
        active,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      const docRef = await adminDb.collection('notices').add(payload);
      return res.status(201).json({ id: docRef.id, ...payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    } catch (error: any) {
      console.error('Error creating notice:', error);
      return res.status(500).json({ error: error.message || 'Erro interno criando aviso.' });
    }
  });

  app.patch('/api/notices/:id', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      const id = String(req.params.id);
      const patch: Record<string, any> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (req.body?.title !== undefined) patch.title = String(req.body.title).trim().slice(0, 160);
      if (req.body?.body !== undefined) patch.body = String(req.body.body).trim().slice(0, 5000);
      if (req.body?.category !== undefined) patch.category = NOTICE_CATEGORIES.includes(req.body.category) ? req.body.category : 'info';
      if (req.body?.audience !== undefined) patch.audience = NOTICE_AUDIENCES.includes(req.body.audience) ? req.body.audience : 'all';
      if (req.body?.link !== undefined) patch.link = req.body.link ? String(req.body.link).trim().slice(0, 500) : null;
      if (req.body?.active !== undefined) patch.active = !!req.body.active;
      await adminDb.collection('notices').doc(id).set(patch, { merge: true });
      return res.json({ id, updated: true });
    } catch (error: any) {
      console.error('Error updating notice:', error);
      return res.status(500).json({ error: error.message || 'Erro interno atualizando aviso.' });
    }
  });

  app.delete('/api/notices/:id', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      await adminDb.collection('notices').doc(String(req.params.id)).delete();
      return res.json({ deleted: true });
    } catch (error: any) {
      console.error('Error deleting notice:', error);
      return res.status(500).json({ error: error.message || 'Erro interno removendo aviso.' });
    }
  });

  // --- Mensagens diretas da gerência → afiliado (popup 1:1) -----------------
  // O admin envia escolhendo o afiliado; resolvemos o(s) login(s) vinculado(s)
  // (users.affiliateId) e gravamos `recipientUid` em cada mensagem — a leitura é
  // escopada por recipientUid na regra (query segura, sem get()). Se o afiliado
  // ainda não tem login Boost, não há pra quem entregar o popup → 409 informativo.
  app.post('/api/direct-messages', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      const affiliateId = String(req.body?.affiliateId ?? '').trim();
      const title = String(req.body?.title ?? '').trim().slice(0, 160);
      const text = String(req.body?.body ?? '').trim().slice(0, 5000);
      if (!affiliateId) return res.status(400).json({ error: 'affiliateId é obrigatório.' });
      if (!title || !text) return res.status(400).json({ error: 'Título e mensagem são obrigatórios.' });

      // Logins vinculados ao afiliado.
      const usersSnap = await adminDb.collection('users').where('affiliateId', '==', affiliateId).get();
      if (usersSnap.empty) {
        return res.status(409).json({ error: 'Este afiliado ainda não tem login Boost vinculado — não há para quem entregar a mensagem.' });
      }

      // Nome do afiliado (mirror) e nome do remetente (admin) p/ exibição.
      const affSnap = await adminDb.collection('affiliates').doc(affiliateId).get();
      const affiliateName = (affSnap.exists ? (affSnap.data() as any)?.name : null)
        || (usersSnap.docs[0].data() as any)?.name || 'Afiliado';
      const adminSnap = await adminDb.collection('users').doc((req as any).user.uid).get();
      const createdByName = (adminSnap.exists ? (adminSnap.data() as any)?.name : null) || 'Gerência Boost';

      const batch = adminDb.batch();
      let delivered = 0;
      usersSnap.forEach((u) => {
        const ref = adminDb!.collection('direct_messages').doc();
        batch.set(ref, {
          recipientUid: u.id,
          affiliateId,
          affiliateName,
          title,
          body: text,
          createdByName,
          readAt: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        delivered++;
      });
      await batch.commit();
      return res.status(201).json({ delivered });
    } catch (error: any) {
      console.error('Error sending direct message:', error);
      return res.status(500).json({ error: error.message || 'Erro interno enviando mensagem.' });
    }
  });

  // Marca a própria mensagem como lida (após o afiliado fechar o popup).
  app.post('/api/direct-messages/:id/read', requireAuth, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      const id = String(req.params.id);
      const ref = adminDb.collection('direct_messages').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Mensagem não encontrada.' });
      if ((snap.data() as any)?.recipientUid !== (req as any).user.uid) {
        return res.status(403).json({ error: 'Você não pode alterar esta mensagem.' });
      }
      await ref.set({ readAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return res.json({ read: true });
    } catch (error: any) {
      console.error('Error marking direct message read:', error);
      return res.status(500).json({ error: error.message || 'Erro interno marcando leitura.' });
    }
  });

  const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const fetchExternalAffiliates = async (): Promise<any[]> => {
    const BASE_URL = process.env.VITE_AFFILIATE_API_BASE_URL || 'https://affiliate-api-prd.partnersotg.com';
    const apiKey = process.env.AFFILIATE_API_KEY;
    if (!apiKey) throw new Error('Chave de API externa não configurada.');

    const response = await fetch(`${BASE_URL}/api/v2/external/affiliates`, {
      headers: { 'x-api-key': apiKey, 'Accept': 'application/json', 'User-Agent': 'AgenciaBoost-App/1.0' },
    });
    if (!response.ok) {
      throw new Error(`Erro na API externa ao listar afiliados: ${response.status}`);
    }
    const body = await response.json();
    // External shape: { data: { data: [...] } }
    const list = body?.data?.data ?? body?.data ?? body;
    return Array.isArray(list) ? list : [];
  };

  // --- Pré-cadastro (afiliados aprovados na OTG, ainda fora do relatório) -------
  // A OTG separa PROVISIONAMENTO (links.otgpartners) de RELATÓRIO (a x-api-key só
  // traz quem já produziu). Importamos os aprovados como `pending_affiliates` com
  // um affiliateId SINTÉTICO (`pending_<nameKey>_<casa>`) — assim o pendente é
  // cidadão de 1ª classe no fluxo existente (lista/convite/accept/dashboard) sem
  // reescrever nada. A ponte com o relatório é o NOME normalizado; quando o
  // afiliado aparece no relatório, reconciliamos trocando o id sintético pelo
  // real (no doc do pendente e em qualquer login já criado). Ver
  // scripts/otg-approved/README.md e a memória boost-external-api-state.
  const normNameKey = (s?: string | null) =>
    String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const brandNameOf = (aff: any): string => {
    const b = aff?.brand ?? aff?.marca;
    if (!b) return '';
    if (typeof b === 'string') return b;
    return b.name ?? b.nome ?? b.label ?? '';
  };
  const pendingDocId = (nameKey: string, house: string) => `pending_${nameKey}_${normNameKey(house)}`;

  // Casa pendente ↔ afiliado do relatório por (nameKey + casa). Marca o pendente
  // como reconciliado, grava o affiliateId real e reaponta logins já criados.
  const reconcilePending = async (reportingAffiliates: any[]): Promise<number> => {
    if (!adminDb) return 0;
    const byKey = new Map<string, any>();
    for (const a of reportingAffiliates) {
      const nk = normNameKey(a?.name ?? a?.label);
      const hs = normNameKey(brandNameOf(a));
      if (nk) byKey.set(`${nk}|${hs}`, a);
    }
    const pend = await adminDb.collection('pending_affiliates').where('status', '==', 'pending').get();
    let reconciled = 0;
    for (const docSnap of pend.docs) {
      const p = docSnap.data();
      const match = byKey.get(`${String(p.nameKey)}|${normNameKey(p.house)}`);
      const realId = String(match?.id ?? match?._id ?? '').trim();
      if (!realId) continue;
      await docSnap.ref.set(
        { status: 'reconciled', affiliateId: realId, reconciledAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      // reaponta logins existentes que ficaram amarrados ao id sintético
      const linked = await adminDb.collection('users').where('affiliateId', '==', docSnap.id).get();
      for (const u of linked.docs) {
        await u.ref.set({ affiliateId: realId, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
      reconciled++;
    }
    return reconciled;
  };

  // Upsert das linhas de aprovados em `pending_affiliates` (id sintético por
  // nameKey+casa). Usado tanto pelo import manual (snapshot) quanto pelo pull
  // automático da OTG — mesma forma de dado, mesma idempotência. NÃO rebaixa um
  // pendente já reconciliado.
  const upsertPendingRows = async (rows: any[]): Promise<{ imported: number; skipped: number }> => {
    if (!adminDb) return { imported: 0, skipped: 0 };
    let imported = 0;
    let skipped = 0;
    for (const r of rows) {
      const name = String(r?.name ?? '').trim();
      const house = String(r?.house ?? '').trim();
      const nameKey = normNameKey(r?.nameKey || name);
      if (!name || !house || !nameKey) { skipped++; continue; }
      const id = pendingDocId(nameKey, house);
      const ref = adminDb.collection('pending_affiliates').doc(id);
      const prev = await ref.get();
      await ref.set({
        id,
        name,
        nameKey,
        house,
        email: r?.email ?? null,
        phone: r?.phone ?? null,
        social: r?.social ?? null,
        registerUrl: r?.registerUrl ?? null,
        // não rebaixa um já reconciliado; novo entra como 'pending'
        status: prev.exists ? (prev.data()!.status || 'pending') : 'pending',
        createdAt: prev.exists ? (prev.data()!.createdAt ?? admin.firestore.FieldValue.serverTimestamp()) : admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      imported++;
    }
    return { imported, skipped };
  };

  // Sync the external affiliate list into the local `affiliates` collection.
  app.post('/api/affiliates/sync', requireAdmin, async (_req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }
    try {
      const affiliates = await fetchExternalAffiliates();
      let written = 0;
      // Firestore batches are capped at 500 ops; chunk to stay safe.
      for (let i = 0; i < affiliates.length; i += 400) {
        const slice = affiliates.slice(i, i + 400);
        const batch = adminDb.batch();
        for (const aff of slice) {
          const externalId = String(aff.id ?? aff._id ?? '').trim();
          if (!externalId) continue;
          const ref = adminDb.collection('affiliates').doc(externalId);
          batch.set(ref, {
            id: externalId,
            name: aff.name ?? aff.label ?? 'Sem Nome',
            siteId: aff.siteId ?? null,
            brand: aff.brand ?? null,
            syncedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          written++;
        }
        await batch.commit();
      }
      // Após espelhar o relatório, reconcilia os pré-cadastros que já apareceram.
      const reconciled = await reconcilePending(affiliates);
      return res.json({ synced: written, total: affiliates.length, reconciled });
    } catch (error: any) {
      console.error('Error syncing affiliates:', error);
      return res.status(500).json({ error: error.message || 'Erro interno sincronizando afiliados.' });
    }
  });

  // Lista os pré-cadastros (afiliados aprovados importados do snapshot da OTG).
  app.get('/api/pending-affiliates', requireAdmin, async (_req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }
    try {
      const snap = await adminDb.collection('pending_affiliates').get();
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return res.json(rows);
    } catch (error: any) {
      console.error('Error listing pending affiliates:', error);
      return res.status(500).json({ error: error.message || 'Erro interno listando pré-cadastros.' });
    }
  });

  // Importa o snapshot de aprovados (upsert por nameKey+casa) e já reconcilia
  // contra o relatório atual. Não rebaixa pendentes já reconciliados.
  app.post('/api/pending-affiliates/import', requireAdmin, async (req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
      if (!rows) {
        return res.status(400).json({ error: 'Envie { rows: [...] } com as linhas do snapshot.' });
      }
      const { imported, skipped } = await upsertPendingRows(rows);
      // reconcilia imediatamente contra o relatório (quem já produziu some da fila)
      let reconciled = 0;
      try {
        reconciled = await reconcilePending(await fetchExternalAffiliates());
      } catch (e) {
        console.warn('Import: reconciliação adiada (falha ao ler relatório):', (e as any)?.message);
      }
      return res.json({ imported, skipped, reconciled, total: rows.length });
    } catch (error: any) {
      console.error('Error importing pending affiliates:', error);
      return res.status(500).json({ error: error.message || 'Erro interno importando pré-cadastros.' });
    }
  });

  // Puxa o roster de aprovados DIRETO da OTG (Supabase de provisionamento) e faz
  // o mesmo upsert + reconciliação do import manual — tira o "manual" do snapshot.
  // Usa as creds do .env (OTG_LINKS_*). Pode ser chamado por um scheduler externo
  // (cron batendo neste endpoint) ou pelo botão do /admin. Ver otgLinksPull.ts.
  app.post('/api/pending-affiliates/refresh', requireAdmin, async (_req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    if (!isOtgLinksConfigured()) {
      return res.status(503).json({ error: 'Pull automático não configurado (defina OTG_LINKS_* no .env).' });
    }
    try {
      const roster = await pullApprovedRoster();
      const { imported, skipped } = await upsertPendingRows(roster.rows);
      let reconciled = 0;
      try {
        reconciled = await reconcilePending(await fetchExternalAffiliates());
      } catch (e) {
        console.warn('Refresh: reconciliação adiada (falha ao ler relatório):', (e as any)?.message);
      }
      return res.json({ source: 'otg-links', total: roster.total, byHouse: roster.byHouse, imported, skipped, reconciled, fetchedAt: roster.fetchedAt });
    } catch (error: any) {
      console.error('Error refreshing pending affiliates from OTG:', error);
      return res.status(502).json({ error: error.message || 'Erro ao puxar o roster da OTG.' });
    }
  });

  // Admin generates an access invite for an affiliate.
  app.post('/api/invites', requireAdmin, async (req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }
    try {
      const { affiliateId, affiliateName } = req.body ?? {};
      if (!affiliateId) {
        return res.status(400).json({ error: 'affiliateId é obrigatório.' });
      }

      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + INVITE_TTL_MS);

      await adminDb.collection('invites').doc(token).set({
        token,
        affiliateId: String(affiliateId),
        affiliateName: affiliateName ? String(affiliateName) : null,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt,
      });

      return res.status(201).json({ token, expiresAt: expiresAt.toDate().toISOString() });
    } catch (error: any) {
      console.error('Error creating invite:', error);
      return res.status(500).json({ error: error.message || 'Erro interno criando convite.' });
    }
  });

  // Public: validate an invite token and return the affiliate it is bound to.
  app.get('/api/invites/:token', publicAuthLimiter, async (req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }
    try {
      const { token } = req.params;
      const snap = await adminDb.collection('invites').doc(String(token)).get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'Convite não encontrado.' });
      }
      const data = snap.data()!;
      if (data.status === 'used') {
        return res.status(410).json({ error: 'Este convite já foi utilizado.' });
      }
      if (data.expiresAt?.toMillis && data.expiresAt.toMillis() < Date.now()) {
        return res.status(410).json({ error: 'Este convite expirou.' });
      }
      return res.json({
        affiliateId: data.affiliateId,
        affiliateName: data.affiliateName ?? null,
        status: data.status,
      });
    } catch (error: any) {
      console.error('Error fetching invite:', error);
      return res.status(500).json({ error: error.message || 'Erro interno lendo convite.' });
    }
  });

  // Public: affiliate accepts an invite, creating their own login linked to the affiliateId.
  app.post('/api/accept-invite', publicAuthLimiter, async (req, res) => {
    if (!adminApp || !adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }
    try {
      const { token, email, password, phone, socialMedia, cpf } = req.body ?? {};
      if (!token || !email || !password) {
        return res.status(400).json({ error: 'Token, e-mail e senha são obrigatórios.' });
      }
      const normalizedPhone = String(phone ?? '').trim();
      if (!normalizedPhone) {
        return res.status(400).json({ error: 'O telefone é obrigatório.' });
      }
      const normalizedSocialMedia = String(socialMedia ?? '').trim();
      const normalizedCpf = String(cpf ?? '').trim();

      const inviteRef = adminDb.collection('invites').doc(String(token));
      const inviteSnap = await inviteRef.get();
      if (!inviteSnap.exists) {
        return res.status(404).json({ error: 'Convite não encontrado.' });
      }
      const invite = inviteSnap.data()!;
      if (invite.status === 'used') {
        return res.status(410).json({ error: 'Este convite já foi utilizado.' });
      }
      if (invite.expiresAt?.toMillis && invite.expiresAt.toMillis() < Date.now()) {
        return res.status(410).json({ error: 'Este convite expirou.' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const affiliateName = invite.affiliateName || normalizedEmail;
      const affId = String(invite.affiliateId);

      // Se este afiliado já foi marcado como especial ANTES de aceitar o convite,
      // espelha isSpecial no doc novo — senão ele se cadastra sem acesso à /network
      // (bug recorrente do especial sem flag). Resolvido pelo affiliateId do convite.
      const specialSnap = await adminDb.collection('special_affiliates').doc(affId).get();
      const isSpecial = specialSnap.exists && specialSnap.data()?.active === true;

      let userRecord: admin.auth.UserRecord;
      try {
        userRecord = await adminApp.auth().createUser({
          email: normalizedEmail,
          password: String(password),
          displayName: affiliateName,
        });
      } catch (error: any) {
        if (error.code === 'auth/email-already-exists') {
          return res.status(409).json({ error: 'Este e-mail já está cadastrado. Faça login.' });
        }
        throw error;
      }

      await adminDb.collection('users').doc(userRecord.uid).set({
        uid: userRecord.uid,
        name: affiliateName,
        email: normalizedEmail,
        role: 'client',
        affiliateId: affId,
        isSpecial,
        phone: normalizedPhone,
        socialMedia: normalizedSocialMedia,
        cpf: normalizedCpf,
        mustChangePassword: false,
        avatarUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(affiliateName)}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await inviteRef.set({
        status: 'used',
        usedByUid: userRecord.uid,
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.status(201).json({ uid: userRecord.uid, affiliateId: String(invite.affiliateId) });
    } catch (error: any) {
      console.error('Error accepting invite:', error);
      return res.status(500).json({ error: error.message || 'Erro interno aceitando convite.' });
    }
  });

  // Proxy route for Affiliate API to handle multiple endpoints dynamically
  app.get('/api/external/:endpoint/:id?', requireAuth, async (req, res) => {
    try {
      const { endpoint, id } = req.params;
      const BASE_URL = process.env.VITE_AFFILIATE_API_BASE_URL || 'https://affiliate-api-prd.partnersotg.com';
      const apiKey = process.env.AFFILIATE_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: 'Chave de API não configurada' });
      }

      // Per-affiliate scoping: non-admins may only read `results`, never another
      // endpoint. Normal afiliados ficam restritos ao próprio id; o afiliado
      // ESPECIAL (B3) pode ler a própria sub-rede (own + subs vinculados). O
      // conjunto permitido é resolvido NO SERVIDOR (special_affiliates) e os
      // affiliateIds pedidos pelo cliente são validados contra ele.
      const user = (req as any).user;
      if (user?.role !== 'admin') {
        if (endpoint !== 'results' || id) {
          return res.status(403).json({ error: 'Acesso restrito ao seu próprio desempenho.' });
        }
        if (!user?.affiliateId) {
          return res.status(403).json({ error: 'Sua conta não está vinculada a um afiliado.' });
        }
        const ownId = String(user.affiliateId);

        let allowedIds = [ownId];
        if (adminDb) {
          try {
            const specialSnap = await adminDb.collection('special_affiliates').doc(ownId).get();
            const special = specialSnap.exists ? (specialSnap.data() as any) : null;
            if (special?.active && Array.isArray(special.subAffiliateIds)) {
              allowedIds = [ownId, ...special.subAffiliateIds.map((s: any) => String(s))];
            }
          } catch (e) {
            console.error('Erro ao carregar sub-rede do afiliado especial:', e);
          }
        }

        const requested = String(req.query.affiliateIds || '')
          .split(',').map((s) => s.trim()).filter(Boolean);
        const scoped = requested.length
          ? requested.filter((idr) => allowedIds.includes(idr))
          : allowedIds;
        if (scoped.length === 0) {
          return res.status(403).json({ error: 'Acesso restrito à sua sub-rede.' });
        }
        req.query.affiliateIds = scoped.join(',');
      }

      // A API externa NÃO aceita affiliateIds separados por vírgula (devolve vazio);
      // ela espera o parâmetro REPETIDO (affiliateIds=a&affiliateIds=b). Expandimos
      // aqui — senão o afiliado especial (own + subs) e o filtro multi-marca por
      // campanha (vários ids) recebem 0 linhas. Os demais params passam direto.
      const outParams = new URLSearchParams();
      for (const [key, value] of Object.entries(req.query as Record<string, any>)) {
        if (value == null) continue;
        if (key === 'affiliateIds') {
          const raw = Array.isArray(value) ? value : [value];
          raw
            .flatMap((v) => String(v).split(','))
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((affId) => outParams.append('affiliateIds', affId));
        } else {
          outParams.append(key, String(value));
        }
      }
      const queryString = outParams.toString();
      const targetUrl = id
        ? `${BASE_URL}/api/v2/external/${endpoint}/${id}${queryString ? '?' + queryString : ''}`
        : `${BASE_URL}/api/v2/external/${endpoint}${queryString ? '?' + queryString : ''}`;
        
      console.log(`Proxying request to: ${targetUrl}`);
      
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Accept': 'application/json',
          'User-Agent': 'AgenciaBoost-App/1.0',
        },
      });

      const responseText = await response.text();
      let responseBody: any = null;
      try {
        responseBody = responseText ? JSON.parse(responseText) : null;
      } catch {
        responseBody = null;
      }

      if (!response.ok) {
        // SECURITY (MEDIUM-1): o corpo bruto do upstream (details/message/host/IDs
        // internos) fica SÓ no log do servidor; ao cliente vai um erro genérico +
        // requestId p/ correlação. Mantém-se apenas o `code` curto (ex.: "040"),
        // que a UI usa p/ distinguir "sem dados" de erro real — não é sensível.
        const requestId = crypto.randomBytes(8).toString('hex');
        console.error(`[external-proxy] ${requestId} upstream ${response.status} em ${endpoint}:`, responseText);
        return res.status(response.status).json({
          error: 'Falha ao consultar a API externa.',
          code: responseBody?.code || responseBody?.errorCode,
          requestId,
        });
      }

      if (responseBody !== null) {
        return res.json(responseBody);
      }

      const requestId = crypto.randomBytes(8).toString('hex');
      console.error(`[external-proxy] ${requestId} resposta não-JSON do upstream em ${endpoint}:`, responseText);
      return res.status(502).json({
        error: 'Resposta inválida da API externa.',
        requestId,
      });
    } catch (error) {
      console.error('Proxy Exception:', error);
      res.status(500).json({ 
        error: 'Erro interno no servidor proxy', 
        message: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // --- Link de divulgação da agência (tracking + redirect) ------------------
  // O afiliado compartilha boost.../go/:code em vez da URL da casa. O servidor
  // registra o clique (subid-ready: gera um clickId e o passa como ?subid pra
  // casa — quando a OTG ligar o postback, vira atribuição por jogador) e
  // redireciona pro registerUrl real do afiliado naquela casa. PÚBLICO (sem auth:
  // qualquer visitante abre). Provado por probe (2026-06-17): o subid sobrevive
  // até a URL final de cadastro e convive com o `wm` (ref do afiliado).
  const GO_FALLBACK = process.env.GO_FALLBACK_URL || '/';
  // Limite generoso só p/ conter abuso de writes (humano não clica 60x/min). Não
  // usa o publicAuthLimiter (mais estrito) p/ não barrar tráfego legítimo do link.
  const goLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
  app.get('/go/:code', goLimiter, async (req, res) => {
    const code = String(req.params.code || '').trim();
    if (!adminDb || !code) return res.redirect(302, GO_FALLBACK);
    try {
      const snap = await adminDb.collection('affiliate_links').doc(code).get();
      const link = snap.exists ? (snap.data() as any) : null;
      if (!link || link.active === false || !link.registerUrl) {
        return res.redirect(302, GO_FALLBACK);
      }

      const clickId = crypto.randomBytes(12).toString('hex'); // = o subid
      const ua = String(req.headers['user-agent'] || '');
      const referer = String(req.headers['referer'] || '');
      const bot = isBotUserAgent(ua);
      // LGPD: nunca guardamos o IP cru — só um hash truncado e salgado (dedup/fraude).
      const ipHash = crypto
        .createHash('sha256')
        .update(String(req.ip || '') + (process.env.IP_HASH_SALT || ''))
        .digest('hex')
        .slice(0, 16);
      const day = clickStatDay(new Date());
      const affiliateId = link.affiliateId ?? null;
      const brandId = link.brandId ?? null;

      // Clique cru (subid=clickId, p/ casar com o futuro postback) + contador
      // diário (séries temporais) + totais no próprio link (leitura barata p/ a
      // dashboard). Await garante o flush antes do redirect no Cloud Run.
      await Promise.all([
        adminDb.collection('link_clicks').doc(clickId).set({
          clickId, code, affiliateId, brandId,
          isBot: bot,
          ua: ua.slice(0, 300),
          referer: referer.slice(0, 300),
          ipHash,
          ts: admin.firestore.FieldValue.serverTimestamp(),
        }),
        adminDb.collection('link_click_stats').doc(`${code}__${day}`).set({
          code, affiliateId, brandId, date: day,
          clicks: admin.firestore.FieldValue.increment(bot ? 0 : 1),
          botClicks: admin.firestore.FieldValue.increment(bot ? 1 : 0),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }),
        adminDb.collection('affiliate_links').doc(code).set({
          clicks: admin.firestore.FieldValue.increment(bot ? 0 : 1),
          botClicks: admin.firestore.FieldValue.increment(bot ? 1 : 0),
          lastClickAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }),
      ]);

      res.cookie('boost_click', clickId, {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
      return res.redirect(302, appendSubid(String(link.registerUrl), clickId));
    } catch (e) {
      console.error('[go] erro no redirect de clique:', e);
      return res.redirect(302, GO_FALLBACK);
    }
  });

  // Cria (idempotente por afiliado×casa) o link de divulgação de um afiliado.
  // Admin only. Reusar = link estável (não muda o code já compartilhado).
  app.post('/api/affiliate-links', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Servidor indisponível' });
    try {
      const { affiliateId, brandId, registerUrl } = req.body || {};
      if (!affiliateId || !registerUrl) {
        return res.status(400).json({ error: 'affiliateId e registerUrl são obrigatórios' });
      }
      const normBrand = brandId != null ? String(brandId) : null;
      const existing = await adminDb
        .collection('affiliate_links')
        .where('affiliateId', '==', String(affiliateId))
        .where('brandId', '==', normBrand)
        .limit(1)
        .get();
      if (!existing.empty) {
        const docRef = existing.docs[0].ref;
        await docRef.set(
          { registerUrl: String(registerUrl), active: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        const fresh = await docRef.get();
        return res.json({ code: docRef.id, ...(fresh.data() as any) });
      }
      const code = crypto.randomBytes(6).toString('base64url'); // ~8 chars URL-safe
      const payload = {
        code,
        affiliateId: String(affiliateId),
        brandId: normBrand,
        registerUrl: String(registerUrl),
        active: true,
        clicks: 0,
        botClicks: 0,
        createdByUid: (req as any).user?.uid ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await adminDb.collection('affiliate_links').doc(code).set(payload);
      return res.status(201).json({ code, ...payload });
    } catch (e) {
      console.error('[affiliate-links] erro ao criar link:', e);
      return res.status(500).json({ error: 'Erro ao criar o link' });
    }
  });

  // Lista os links: admin vê todos; afiliado vê só o(s) dele. Os totais de clique
  // vêm direto do doc do link (incrementados no /go) — leitura barata.
  app.get('/api/affiliate-links', requireAuth, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Servidor indisponível' });
    try {
      const user = (req as any).user;
      let query: admin.firestore.Query = adminDb.collection('affiliate_links');
      if (user?.role !== 'admin') {
        if (!user?.affiliateId) {
          return res.status(403).json({ error: 'Sua conta não está vinculada a um afiliado.' });
        }
        query = query.where('affiliateId', '==', String(user.affiliateId));
      }
      const snap = await query.get();
      const links = snap.docs.map((d) => ({ code: d.id, ...(d.data() as any) }));
      return res.json({ links });
    } catch (e) {
      console.error('[affiliate-links] erro ao listar links:', e);
      return res.status(500).json({ error: 'Erro ao listar os links' });
    }
  });

  // === Backoffice de CASAS (betting houses) =================================
  // Fonte de verdade do registro de casas (substitui o KNOWN_BRANDS hardcoded):
  // o admin cria/edita casas em /casas. Tudo via Admin SDK; o cliente nunca toca
  // `houses` direto (rules server-only) — lê pelo GET autenticado p/ logos/filtros.
  const slugifyHouse = (s: string) =>
    String(s ?? '')
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  // Sobe a logo (data URL base64) pro Storage e devolve a URL de download. Usa
  // download-token (compatível com uniform bucket-level access — makePublic falha).
  const uploadHouseLogo = async (slug: string, dataUrl: string): Promise<string> => {
    const m = /^data:(image\/(png|jpe?g|webp|svg\+xml));base64,(.+)$/i.exec(String(dataUrl));
    if (!m) throw new Error('Logo inválida (envie PNG, JPG, WEBP ou SVG).');
    const mime = m[1];
    const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase().replace('svg+xml', 'svg');
    const buffer = Buffer.from(m[3], 'base64');
    if (buffer.length > 2 * 1024 * 1024) throw new Error('Logo muito grande (máx. 2MB).');
    const bucket = admin.storage().bucket();
    const filePath = `house-logos/${slug}-${Date.now()}.${ext}`;
    const token = crypto.randomUUID();
    await bucket.file(filePath).save(buffer, {
      resumable: false,
      contentType: mime,
      metadata: { cacheControl: 'public,max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
    });
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
  };

  // Semeia as casas-semente (DEFAULT_BRANDS) na 1ª vez que a coleção está vazia,
  // p/ produção nunca ficar sem Superbet/SportingBet. Idempotente.
  const ensureHousesSeeded = async () => {
    if (!adminDb) return;
    const snap = await adminDb.collection('houses').limit(1).get();
    if (!snap.empty) return;
    const batch = adminDb.batch();
    DEFAULT_BRANDS.forEach((b, i) => {
      batch.set(adminDb!.collection('houses').doc(b.slug), {
        slug: b.slug,
        name: b.name,
        brandId: b.id ?? null,
        logo: b.logo ?? null,
        registerUrlTemplate: null,
        active: b.active !== false,
        order: i,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  };

  const houseFromDoc = (d: admin.firestore.DocumentSnapshot) => {
    const data = (d.data() as any) || {};
    return {
      id: d.id,
      slug: data.slug ?? d.id,
      name: data.name ?? d.id,
      brandId: data.brandId ?? null,
      logo: data.logo ?? null,
      registerUrlTemplate: data.registerUrlTemplate ?? null,
      active: data.active !== false,
      order: Number.isFinite(Number(data.order)) ? Number(data.order) : 0,
    };
  };

  // Lista as casas (qualquer signed-in: o afiliado precisa p/ logos/filtros).
  app.get('/api/houses', requireAuth, async (_req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Servidor indisponível' });
    try {
      await ensureHousesSeeded();
      const snap = await adminDb.collection('houses').get();
      const houses = snap.docs
        .map(houseFromDoc)
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR'));
      return res.json({ houses });
    } catch (e) {
      console.error('[houses] erro ao listar:', e);
      return res.status(500).json({ error: 'Erro ao listar as casas' });
    }
  });

  // Cria uma casa (admin). doc id = slug (único).
  app.post('/api/houses', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Servidor indisponível' });
    try {
      const { name, brandId, registerUrlTemplate, active, order, logoBase64 } = req.body || {};
      const cleanName = String(name ?? '').trim();
      if (!cleanName) return res.status(400).json({ error: 'O nome da casa é obrigatório.' });
      const slug = slugifyHouse(req.body?.slug || cleanName);
      if (!slug) return res.status(400).json({ error: 'Slug inválido.' });
      const ref = adminDb.collection('houses').doc(slug);
      if ((await ref.get()).exists) {
        return res.status(409).json({ error: `Já existe uma casa com o slug "${slug}".` });
      }
      let logo: string | null = null;
      if (logoBase64) logo = await uploadHouseLogo(slug, String(logoBase64));
      await ref.set({
        slug,
        name: cleanName,
        brandId: brandId ? String(brandId) : null,
        logo,
        registerUrlTemplate: registerUrlTemplate ? String(registerUrlTemplate) : null,
        active: active !== false,
        order: Number.isFinite(Number(order)) ? Number(order) : 0,
        createdByUid: (req as any).user?.uid ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(201).json(houseFromDoc(await ref.get()));
    } catch (e: any) {
      console.error('[houses] erro ao criar:', e);
      return res.status(500).json({ error: e?.message || 'Erro ao criar a casa' });
    }
  });

  // Atualiza uma casa (admin). Patch parcial; logoBase64 troca a logo.
  app.patch('/api/houses/:id', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Servidor indisponível' });
    try {
      const ref = adminDb.collection('houses').doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Casa não encontrada.' });
      const body = req.body || {};
      const patch: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (body.name != null) {
        const cleanName = String(body.name).trim();
        if (!cleanName) return res.status(400).json({ error: 'O nome da casa é obrigatório.' });
        patch.name = cleanName;
      }
      if (body.brandId !== undefined) patch.brandId = body.brandId ? String(body.brandId) : null;
      if (body.registerUrlTemplate !== undefined) patch.registerUrlTemplate = body.registerUrlTemplate ? String(body.registerUrlTemplate) : null;
      if (body.active !== undefined) patch.active = body.active !== false;
      if (body.order !== undefined && Number.isFinite(Number(body.order))) patch.order = Number(body.order);
      if (body.logoBase64) patch.logo = await uploadHouseLogo((snap.data() as any)?.slug ?? ref.id, String(body.logoBase64));
      else if (body.logo === null) patch.logo = null;
      await ref.set(patch, { merge: true });
      return res.json(houseFromDoc(await ref.get()));
    } catch (e: any) {
      console.error('[houses] erro ao atualizar:', e);
      return res.status(500).json({ error: e?.message || 'Erro ao atualizar a casa' });
    }
  });

  // Remove uma casa (admin).
  app.delete('/api/houses/:id', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Servidor indisponível' });
    try {
      await adminDb.collection('houses').doc(String(req.params.id)).delete();
      return res.json({ ok: true });
    } catch (e) {
      console.error('[houses] erro ao remover:', e);
      return res.status(500).json({ error: 'Erro ao remover a casa' });
    }
  });

  // === API do PARCEIRO (read-only, M2M) =====================================
  // Superfície estável e versionada (/api/partner/v1/*) exposta a um parceiro
  // externo via API key da Boost (requirePartner). Read-only. Envelope fixo
  // { data, total, generatedAt } p/ não vazar a inconsistência de shape da OTG.
  // Ver PARTNER-API.md e a memória boost-partner-api.
  const partnerEnvelope = (data: any[]) => ({ data, total: data.length, generatedAt: new Date().toISOString() });
  const partnerApi = express.Router();
  partnerApi.use(partnerLimiter, requirePartner);

  // Afiliados PENDENTES de cadastro (aprovados na OTG, ainda fora do relatório).
  // É o dado-chave da integração. Filtros opcionais: ?status=pending|reconciled, ?house=.
  partnerApi.get('/pending-affiliates', requireScope('pending-affiliates'), async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Servidor indisponível.' });
    try {
      const snap = await adminDb.collection('pending_affiliates').get();
      // Carlos (2026-06-17): esconder PII de contato (email/phone) do parceiro por ora.
      // Removidos no servidor; o resto (nome, casa, status, registerUrl…) segue.
      let rows = snap.docs.map((d) => {
        const { email, phone, ...rest } = d.data() as any;
        void email; void phone;
        return { id: d.id, ...rest };
      });
      const status = req.query.status ? String(req.query.status) : null;
      const house = req.query.house ? String(req.query.house).toLowerCase() : null;
      if (status) rows = rows.filter((r) => String(r.status || 'pending') === status);
      if (house) rows = rows.filter((r) => String(r.house || '').toLowerCase() === house);
      return res.json(partnerEnvelope(rows));
    } catch (error: any) {
      console.error('[partner-api] pending-affiliates:', error);
      return res.status(500).json({ error: 'Erro ao listar afiliados pendentes.' });
    }
  });

  // Afiliados reconciliados/ativos (espelho do relatório). Inclui registerUrl
  // (link de cadastro) quando houver — do affiliate_links ou do pré-cadastro.
  partnerApi.get('/affiliates', requireScope('affiliates'), async (_req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Servidor indisponível.' });
    try {
      const [affSnap, linkSnap, pendSnap] = await Promise.all([
        adminDb.collection('affiliates').get(),
        adminDb.collection('affiliate_links').get(),
        adminDb.collection('pending_affiliates').where('status', '==', 'reconciled').get(),
      ]);
      // mapa affiliateId → registerUrl (link de divulgação tem prioridade; senão o do pré-cadastro)
      const urlById = new Map<string, string>();
      for (const d of pendSnap.docs) {
        const p = d.data() as any;
        if (p.affiliateId && p.registerUrl) urlById.set(String(p.affiliateId), p.registerUrl);
      }
      for (const d of linkSnap.docs) {
        const l = d.data() as any;
        if (l.affiliateId && l.registerUrl) urlById.set(String(l.affiliateId), l.registerUrl);
      }
      const rows = affSnap.docs.map((d) => {
        const a = d.data() as any;
        return {
          id: d.id,
          name: a.name ?? null,
          siteId: a.siteId ?? null,
          brand: a.brand ?? null,
          registerUrl: urlById.get(d.id) ?? null,
        };
      });
      return res.json(partnerEnvelope(rows));
    } catch (error: any) {
      console.error('[partner-api] affiliates:', error);
      return res.status(500).json({ error: 'Erro ao listar afiliados.' });
    }
  });

  // Resultados/produção agregados (proxy do relatório da OTG). Query obrigatória:
  // ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD ; opcional ?groupBy=affiliate|brand|date|campaign
  // (default affiliate) e ?affiliateIds=a,b (expandido p/ o formato repetido da OTG).
  partnerApi.get('/results', requireScope('results'), async (req, res) => {
    const BASE_URL = process.env.VITE_AFFILIATE_API_BASE_URL || 'https://affiliate-api-prd.partnersotg.com';
    const apiKey = process.env.AFFILIATE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Chave de API externa não configurada.' });
    const startDate = req.query.startDate ? String(req.query.startDate) : '';
    const endDate = req.query.endDate ? String(req.query.endDate) : '';
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate e endDate são obrigatórios (YYYY-MM-DD).' });
    }
    try {
      // Params base da consulta (a página é setada por iteração abaixo).
      const baseParams = new URLSearchParams();
      baseParams.set('startDate', startDate);
      baseParams.set('endDate', endDate);
      baseParams.set('groupBy', req.query.groupBy ? String(req.query.groupBy) : 'affiliate');
      // a OTG não aceita affiliateIds CSV — expande p/ parâmetro repetido.
      if (req.query.affiliateIds) {
        String(req.query.affiliateIds).split(',').map((s) => s.trim()).filter(Boolean)
          .forEach((affId) => baseParams.append('affiliateIds', affId));
      }

      // PAGINAÇÃO: a OTG entrega só pageSize=50 por página (page=N até totalPages;
      // pageSize/limit maiores dão erro). Sem isto, o parceiro via só os 50 primeiros
      // afiliados. Varremos todas as páginas e concatenamos. Trava de segurança em
      // MAX_PAGES (2500 linhas) — se estourar, logamos o truncamento (não silencioso).
      const MAX_PAGES = 50;
      const all: any[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const params = new URLSearchParams(baseParams);
        params.set('page', String(page));
        const resp = await fetch(`${BASE_URL}/api/v2/external/results?${params.toString()}`, {
          headers: { 'x-api-key': apiKey, Accept: 'application/json', 'User-Agent': 'AgenciaBoost-App/1.0' },
        });
        const text = await resp.text();
        let body: any = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = null; }
        if (!resp.ok) {
          const requestId = crypto.randomBytes(8).toString('hex');
          console.error(`[partner-api] ${requestId} results upstream ${resp.status} (page ${page}):`, text);
          return res.status(502).json({ error: 'Falha ao consultar o relatório.', code: body?.code, requestId });
        }
        const d = body?.data;
        const rows = Array.isArray(d?.data) ? d.data : (Array.isArray(d) ? d : (Array.isArray(body) ? body : []));
        all.push(...rows);
        const tp = Number(d?.meta?.totalPages);
        totalPages = Number.isFinite(tp) && tp > 0 ? tp : 1;
        page++;
      } while (page <= totalPages && page <= MAX_PAGES);

      if (totalPages > MAX_PAGES) {
        console.warn(`[partner-api] results truncado: ${totalPages} páginas > limite ${MAX_PAGES}. Retornando ${all.length} linhas.`);
      }

      // Carlos (2026-06-17): pro parceiro só CADASTRO, DEPÓSITOS e CPA (contagem) —
      // NADA de valores (R$). Whitelist derruba total_commission/cpa/rvs/deposit e
      // qualquer campo monetário. Ver src/lib/partnerResults.ts.
      return res.json(partnerEnvelope(projectPartnerResults(all)));
    } catch (error: any) {
      console.error('[partner-api] results:', error);
      return res.status(500).json({ error: 'Erro ao consultar resultados.' });
    }
  });

  app.use('/api/partner/v1', partnerApi);
  // ==========================================================================

  // Block requests to dotfiles / sensitive paths (e.g. /.git, /.env) with a branded
  // page. In dev the Vite fs middleware would otherwise return a raw 403 that leaks
  // the absolute disk path; in prod these are just paths we never want to serve.
  // Placed after /api/* (so the API keeps working) and before the SPA/static layer.
  // Só dotfiles na RAIZ (/.git, /.env, /.ssh…). Não casa caminhos internos do Vite
  // como /node_modules/.vite/deps/* — bloqueá-los quebraria o dev server.
  app.use((req, res, next) => {
    if (/^\/\.[^/]/.test(req.path)) {
      return res.status(404).type('html').send(
        renderErrorPage({
          status: 404,
          title: 'Página não encontrada',
          message: 'O endereço que você tentou acessar não existe ou não está disponível.',
        })
      );
    }
    next();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Assets têm hash no nome (imutáveis): cache do Express padrão é seguro —
    // um build novo gera um nome novo, então não há staleness.
    // `index: false` para que o index.html passe SEMPRE pelo fallback abaixo.
    app.use(express.static(distPath, { index: false }));

    // Serve o index.html sem cache nem validadores. CRÍTICO: o ETag default do
    // Express é (tamanho + mtime); o index.html tem sempre 555 bytes e o buildpack
    // do App Hosting preserva o mtime, então o ETag NÃO muda entre deploys. Com
    // revalidação (no-cache) o browser recebia 304 e mantinha um index.html velho
    // apontando p/ um hash de asset que o build novo apagou → 404 / tela branca a
    // cada deploy. `no-store` + etag/lastModified desligados elimina o 304.
    const sendIndex = (res: express.Response) => {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'), { etag: false, lastModified: false });
    };

    app.get('*', (req, res) => {
      // O fallback SPA é só para rotas de cliente. Se um request de ARQUIVO
      // (com extensão, ex.: /assets/index-*.js) chega aqui, o arquivo não existe
      // nesta build — devolver 404 em vez do index.html, que o browser carregaria
      // com o MIME errado ("Expected a JavaScript module…").
      if (path.extname(req.path)) {
        return res.status(404).type('html').send(
          renderErrorPage({
            status: 404,
            title: 'Recurso não encontrado',
            message: 'O arquivo solicitado não existe nesta versão da aplicação.',
          })
        );
      }
      sendIndex(res);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
