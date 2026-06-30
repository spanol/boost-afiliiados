import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import express from 'express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import admin from 'firebase-admin';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderErrorPage } from './errorPage';
import { isBotUserAgent, appendSubid, clickStatDay } from './src/lib/tracking';
import { resolveIsSpecial, resolveServerToday, resolveScopedAffiliateIds } from './src/lib/scope';
import { computeRankingEntries } from './src/lib/ranking';
import { expandAffiliateIdsParam } from './src/lib/affiliateIdsParam';
import { hrDocId, sanitizeMetrics } from './src/lib/houseResultsDoc';
import { makeBoostAffiliateId, normalizeEmailKey } from './src/lib/boostAffiliate';
import type { AffiliateConfig } from './src/lib/commission';
import { DEFAULT_BRANDS } from './src/lib/brand';
import { projectPartnerResults } from './src/lib/partnerResults';
import { pullApprovedRoster, isOtgLinksConfigured } from './otgLinksPull';
import { pullAnalytics, isOtgAnalyticsConfigured } from './otgAnalyticsPull';
import { analyticsDocId, funnelKey, sanitizeFunnel, hasFunnelActivity } from './src/lib/analyticsDoc';
import { buildVersionPayload, type AppVersion } from './src/lib/version';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bucket do Storage (logos das casas). Default = bucket do projeto; override por env.
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'agencia-boost-app.firebasestorage.app';

// Inicializa o Firebase Admin (idempotente). Fica DENTRO de uma função — antes era um
// side-effect no topo do módulo — p/ que importar este arquivo nos testes (só para
// pegar `createApp`) não tente ADC/credenciais nem polua o console. Chamado por startServer().
function initAdmin(): { adminApp: admin.app.App | null; adminDb: admin.firestore.Firestore | null } {
  try {
    let adminApp: admin.app.App;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount), storageBucket: STORAGE_BUCKET });
    } else {
      adminApp = admin.initializeApp({ storageBucket: STORAGE_BUCKET });
    }
    console.log('Firebase Admin initialized');
    return { adminApp, adminDb: adminApp.firestore() };
  } catch (error) {
    console.error('Firebase Admin initialization failed:', error);
    return { adminApp: null, adminDb: null };
  }
}

// Dependências injetáveis. Produção passa o Admin SDK real + o fetch global; os testes
// (supertest) passam mocks de Firestore/verifyIdToken (via adminApp.auth())/fetch p/
// exercitar o ESCOPO e a AUTORIZAÇÃO das rotas sem rede nem Firebase real (R4/R13/R16/R20/R25).
export interface ServerDeps {
  adminApp: admin.app.App | null;
  adminDb: admin.firestore.Firestore | null;
  fetchImpl?: typeof fetch;
}

// Monta o app Express (middlewares + rotas) SEM ouvir porta nem montar Vite/estático —
// isso fica no startServer(), específico de ambiente. Tudo o que as rotas usam
// (adminApp/adminDb/fetch) vem de `deps`, deixando o app testável de fora via supertest.
export function createApp(deps: ServerDeps) {
  const { adminApp, adminDb } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const app = express();

  // SECURITY (LOW): cabeçalhos de segurança. CSP fica desligada aqui porque exige
  // uma allowlist própria (Tailwind/Vite, Firebase, recharts, avatares dicebear) e
  // precisa ser testada — fica como follow-up; os demais headers (nosniff,
  // Referrer-Policy, HSTS, etc.) já entram. COEP off p/ não bloquear recursos
  // cross-origin legítimos (avatares, storage).
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  // O backoffice de casas envia a logo (base64) e o import de resultados (planilha)
  // no corpo — precisam de um teto maior. Parser dedicado ANTES do global (escopado
  // nesses paths): o global de 32kb vira no-op p/ eles (express.json não re-parseia
  // req._body). Demais rotas seguem no limite apertado.
  app.use(['/api/houses', '/api/house-results'], express.json({ limit: '4mb' }));

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
    let name: string | null = null;
    try {
      const snap = await adminDb.collection('users').doc(decoded.uid).get();
      if (!snap.exists || snap.data()?.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores.' });
      }
      // Nome do admin p/ carimbar o autor nos logs de auditoria (não-forjável: vem
      // do users/{uid} resolvido pelo token, nunca do corpo do request).
      name = snap.data()?.name ?? snap.data()?.displayName ?? null;
    } catch {
      return res.status(500).json({ error: 'Erro ao verificar permissões.' });
    }
    (req as any).user = { uid: decoded.uid, email: decoded.email, name };
    next();
  };

  // --- Auditoria (server-authoritative) -------------------------------------
  // Cada mutação de admin grava em `audit_logs`: QUEM (autor carimbado pelo token,
  // nunca pelo cliente), O QUÊ (entidade + ação) e, quando faz sentido, o antes→depois
  // (`changes`) + `metadata`. A coleção é APPEND-ONLY nas rules (cliente não escreve/
  // edita/apaga) — o log é a fonte de verdade da trilha. NUNCA quebra a ação principal:
  // falha ao gravar só vai ao console. [[boost-audit-trail]]
  type AuditChange = { field: string; before: unknown; after: unknown };
  interface AuditFields {
    entityType: string;            // 'affiliate' | 'house' | 'affiliate_config' | 'user' | ...
    entityId?: string | null;      // id da entidade (affiliateId, slug, uid, token…)
    entityLabel?: string | null;   // nome no momento (snapshot) p/ exibir sem join
    action: string;                // 'affiliate.deactivate' | 'house.create' | 'config.update' | ...
    changes?: AuditChange[] | null;
    metadata?: Record<string, unknown> | null;
    reason?: string | null;
  }
  function auditEntry(req: express.Request, f: AuditFields) {
    const u = (req as any).user || {};
    const entityId = f.entityId != null ? String(f.entityId) : null;
    return {
      entityType: String(f.entityType),
      entityId,
      entityLabel: f.entityLabel ?? null,
      action: String(f.action),
      actorId: u.uid ?? null,
      actorName: u.name ?? null,
      actorEmail: u.email ?? null,
      changes: f.changes ?? null,
      metadata: f.metadata ?? null,
      reason: f.reason ?? null,
      // Espelho do id p/ a tabela legada (Settings lê `log.affiliateId`) seguir
      // funcionando até a UI nova de /auditoria entrar (Fase 5).
      affiliateId: f.entityType === 'affiliate' ? entityId : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
  }
  // Grava um log de forma autônoma (best-effort). Use quando a mutação não está num batch.
  async function writeAuditLog(req: express.Request, f: AuditFields): Promise<void> {
    if (!adminDb) return;
    try {
      await adminDb.collection('audit_logs').add(auditEntry(req, f));
    } catch (e) {
      console.error('[audit] falha ao gravar log:', e);
    }
  }

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
      if (!resolveIsSpecial(special)) return res.status(403).json({ error: 'Você não é um afiliado especial ativo.' });
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
      // SECURITY (R25): `role` é gravado verbatim e decide o roteamento/escopo. Um
      // valor fora de {admin,client} cairia no fallback /profile silencioso (e poderia
      // confundir checagens futuras). Valida o enum ANTES de criar o usuário no Auth.
      if (normalizedRole !== 'admin' && normalizedRole !== 'client') {
        return res.status(400).json({ error: 'Papel inválido. Use "admin" ou "client".' });
      }
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

      // isSpecial espelha special_affiliates (existe e ativo). resolveIsSpecial unifica
      // a regra (active === true) — antes este site usava `active !== false` e divergia
      // dos demais quando o doc não tinha o campo `active`. [[R7]]
      const specialSnap = await adminDb.collection('special_affiliates').doc(affId).get();
      const isSpecial = resolveIsSpecial(specialSnap.exists ? (specialSnap.data() as any) : null);

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

  // SECURITY (R5): taxas (CPA/REV/byBrand) são dado comercial sensível. Antes a rule
  // de affiliate_configs era `read: isSignedIn()` e o cliente lia a COLEÇÃO INTEIRA —
  // todo afiliado via a taxa de todos. Agora a leitura é mediada aqui (Admin SDK) e
  // escopada por papel: admin recebe todas; afiliado recebe só a própria + (se especial
  // ativo) as da sub-rede. A rule passa a ser admin-only (cliente direto bloqueado),
  // espelhando payment_profiles/houses. [[REVIEW-TEST-PLAN R5]]
  app.get('/api/affiliate-configs', requireAuth, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      const user = (req as any).user;
      if (user?.role === 'admin') {
        const snap = await adminDb.collection('affiliate_configs').get();
        const configs: Record<string, any> = {};
        snap.forEach((d) => { configs[d.id] = d.data(); });
        return res.json({ configs });
      }

      const ownId = user?.affiliateId ? String(user.affiliateId) : '';
      if (!ownId) return res.json({ configs: {} });

      // Própria config + (se especial ativo) as da sub-rede — mesmo escopo do proxy.
      const ids = new Set<string>([ownId]);
      try {
        const specialSnap = await adminDb.collection('special_affiliates').doc(ownId).get();
        const special = specialSnap.exists ? (specialSnap.data() as any) : null;
        if (resolveIsSpecial(special) && Array.isArray(special.subAffiliateIds)) {
          special.subAffiliateIds.forEach((s: any) => ids.add(String(s)));
        }
      } catch (e) {
        console.error('Erro ao carregar sub-rede p/ configs:', e);
      }

      const configs: Record<string, any> = {};
      await Promise.all([...ids].map(async (id) => {
        const d = await adminDb!.collection('affiliate_configs').doc(id).get();
        if (d.exists) configs[id] = d.data();
      }));
      return res.json({ configs });
    } catch (error: any) {
      console.error('[affiliate-configs] get:', error);
      return res.status(500).json({ error: error.message || 'Erro ao carregar configs.' });
    }
  });

  // Funil da v1 analítica (cliques/cadastros/FTD/NGR), escopado por papel como
  // affiliate-configs: admin vê tudo; afiliado vê só o próprio (+ sub-rede se especial
  // ativo). Dado sensível mediado pelo servidor — cliente NUNCA lê affiliate_analytics
  // direto (rule admin-only). [[espelha /api/affiliate-configs]]
  app.get('/api/affiliate-analytics', requireAuth, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    try {
      const user = (req as any).user;
      if (user?.role === 'admin') {
        const snap = await adminDb.collection('affiliate_analytics').get();
        const analytics: any[] = [];
        snap.forEach((d) => analytics.push({ id: d.id, ...d.data() }));
        return res.json({ analytics });
      }

      const ownId = user?.affiliateId ? String(user.affiliateId) : '';
      if (!ownId) return res.json({ analytics: [] });

      const ids = new Set<string>([ownId]);
      try {
        const specialSnap = await adminDb.collection('special_affiliates').doc(ownId).get();
        const special = specialSnap.exists ? (specialSnap.data() as any) : null;
        if (resolveIsSpecial(special) && Array.isArray(special.subAffiliateIds)) {
          special.subAffiliateIds.forEach((s: any) => ids.add(String(s)));
        }
      } catch (e) {
        console.error('Erro ao carregar sub-rede p/ analytics:', e);
      }

      const analytics: any[] = [];
      await Promise.all(
        [...ids].map(async (id) => {
          const snap = await adminDb!.collection('affiliate_analytics').where('affiliateId', '==', id).get();
          snap.forEach((d) => analytics.push({ id: d.id, ...d.data() }));
        })
      );
      return res.json({ analytics });
    } catch (error: any) {
      console.error('[affiliate-analytics] get:', error);
      return res.status(500).json({ error: error.message || 'Erro ao carregar analytics.' });
    }
  });

  app.patch('/api/affiliates/:affiliateId', requireAdmin, async (req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }

    try {
      const { affiliateId } = req.params;
      const { status, reason } = req.body ?? {};

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

      // Auditoria server-side (substitui o log que era feito pelo cliente).
      await writeAuditLog(req, {
        entityType: 'affiliate',
        entityId: affiliateId,
        action: status === 'active' ? 'affiliate.activate' : 'affiliate.deactivate',
        reason: reason != null && String(reason).trim() ? String(reason).trim() : null,
      });

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

  // --- Ranking diário (snapshot calculado no servidor) ----------------------
  // O afiliado não consegue montar o leaderboard sozinho (o proxy o escopa ao
  // próprio id). Então o admin dispara o cálculo: buscamos os results do DIA
  // (groupBy=affiliate, paginado como o partner-api), calculamos o repasse de cada
  // afiliado (qualified_cpa·CPA + rvs·REV%, taxa default do afiliado) e gravamos
  // daily_rankings/{data} — que todo afiliado lê (leaderboard público com nomes).
  const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;

  // Núcleo REUSÁVEL da geração do ranking (fonte única — CLAUDE.md): pagina os results
  // do dia, calcula o repasse de cada afiliado (mesma fórmula byBrand dos dashboards) e
  // grava daily_rankings/{date}. Reusado pela rota admin (botão) E pela rota de cron.
  // Lança em falha dura (Error.status p/ o chamador mapear); code "040" (sem dados) não
  // é erro → grava ranking vazio. NUNCA reimplemente este cálculo inline (R2).
  async function computeAndStoreRanking(
    date: string,
    generatedByName: string,
  ): Promise<{ date: string; count: number; entries: any[] }> {
    if (!adminDb) throw Object.assign(new Error('Firebase Admin não está inicializado.'), { status: 500 });
    const BASE_URL = process.env.VITE_AFFILIATE_API_BASE_URL || 'https://affiliate-api-prd.partnersotg.com';
    const apiKey = process.env.AFFILIATE_API_KEY;
    if (!apiKey) throw Object.assign(new Error('Chave de API externa não configurada.'), { status: 500 });

    // Resultados do dia, todas as páginas (a OTG entrega pageSize=50).
    const baseParams = new URLSearchParams();
    baseParams.set('startDate', date);
    baseParams.set('endDate', date);
    baseParams.set('groupBy', 'affiliate');
    const MAX_PAGES = 50;
    const rows: any[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const params = new URLSearchParams(baseParams);
      params.set('page', String(page));
      const resp = await fetchImpl(`${BASE_URL}/api/v2/external/results?${params.toString()}`, {
        headers: { 'x-api-key': apiKey, Accept: 'application/json', 'User-Agent': 'AgenciaBoost-App/1.0' },
      });
      const text = await resp.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      if (!resp.ok) {
        const requestId = crypto.randomBytes(8).toString('hex');
        console.error(`[rankings] ${requestId} results upstream ${resp.status} (page ${page}):`, text);
        // code "040" (sem dados) não é erro: grava ranking vazio.
        if (body?.code === '040') break;
        throw Object.assign(new Error('Falha ao consultar o relatório do dia.'), { status: 502, code: body?.code, requestId });
      }
      const d = body?.data;
      const pageRows = Array.isArray(d?.data) ? d.data : (Array.isArray(d) ? d : (Array.isArray(body) ? body : []));
      rows.push(...pageRows);
      const tp = Number(d?.meta?.totalPages);
      totalPages = Number.isFinite(tp) && tp > 0 ? tp : 1;
      page++;
    } while (page <= totalPages && page <= MAX_PAGES);

    // Configs (taxa por afiliado, COM byBrand) e nome+marca do mirror.
    const [cfgSnap, affSnap] = await Promise.all([
      adminDb.collection('affiliate_configs').get(),
      adminDb.collection('affiliates').get(),
    ]);
    // Config COMPLETA (inclui byBrand) — antes guardava só cpaValue/revPercentage e
    // o ranking nunca via o override por casa (R2).
    const configs: Record<string, AffiliateConfig | undefined> = {};
    cfgSnap.forEach((d) => { configs[d.id] = d.data() as AffiliateConfig; });
    const names: Record<string, string> = {};
    const brandIdByAffiliate: Record<string, string> = {};
    affSnap.forEach((d) => {
      const v = d.data() as any;
      if (v?.name) names[d.id] = String(v.name);
      // marca do afiliado (mirror: brand = {id,name}) → aplica a taxa byBrand da casa
      // dele, MESMA atribuição afiliado→casa que o /admin usa (calcNetProfitByHouse).
      const bid = v?.brand?.id ?? v?.brand_id;
      if (bid) brandIdByAffiliate[d.id] = String(bid);
    });

    // Mesma fórmula/repasse dos dashboards (calcAffiliatePayout), com a taxa por casa.
    const entries = computeRankingEntries(rows, configs, {
      brandIdOf: (id) => brandIdByAffiliate[id],
      nameById: names,
    });

    await adminDb.collection('daily_rankings').doc(date).set({
      date,
      entries,
      count: entries.length,
      metric: 'commission',
      generatedByName,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { date, count: entries.length, entries };
  }

  // Lembrete diário aos admins (popup de mensagem direta), CIENTE do resultado da
  // geração automática: gerou com dados / sem dados (OTG ainda não atualizou) / falhou.
  // Garante que o admin master seja avisado todo dia (rede de segurança caso o cron
  // não rode/falhe). Id determinístico por (date,uid) → no máx. 1 lembrete por admin
  // por dia (re-run no mesmo dia ATUALIZA o doc, não acumula).
  async function sendRankingReminderToAdmins(
    date: string,
    outcome: { ok: boolean; count: number; error?: string },
  ): Promise<number> {
    if (!adminDb) return 0;
    const adminsSnap = await adminDb.collection('users').where('role', '==', 'admin').get();
    // Por padrão só o admin MASTER recebe o lembrete (MASTER_ADMIN_EMAIL, case-insensitive).
    // Sem a env — ou se o e-mail não casar com nenhum admin — cai p/ TODOS os admins
    // (fallback seguro: alguém sempre é avisado; o warn sinaliza a má-config).
    const masterEmail = (process.env.MASTER_ADMIN_EMAIL || '').trim().toLowerCase();
    let recipients = adminsSnap.docs;
    if (masterEmail) {
      const matched = adminsSnap.docs.filter(
        (u) => String((u.data() as any)?.email || '').trim().toLowerCase() === masterEmail,
      );
      if (matched.length) recipients = matched;
      else console.warn(`[cron] MASTER_ADMIN_EMAIL "${masterEmail}" sem admin correspondente — lembrete vai a todos os admins.`);
    }
    let title: string;
    let body: string;
    if (outcome.ok && outcome.count > 0) {
      title = `Ranking de ${date} gerado`;
      body = `O ranking diário foi gerado automaticamente com ${outcome.count} afiliado(s). Confira em /ranking.`;
    } else if (outcome.ok) {
      title = `Ranking de ${date} ainda sem dados`;
      body = `A geração automática rodou, mas a OTG ainda não tem resultados de ${date}. Gere novamente em /ranking depois das 14h.`;
    } else {
      title = `Falha ao gerar o ranking de ${date}`;
      body = `A geração automática falhou${outcome.error ? ` (${outcome.error})` : ''}. Gere manualmente em /ranking.`;
    }
    let sent = 0;
    for (const u of recipients) {
      await adminDb.collection('direct_messages').doc(`ranking-reminder__${date}__${u.id}`).set({
        recipientUid: u.id,
        affiliateId: 'system',
        affiliateName: 'Sistema',
        title,
        body,
        createdByName: 'Sistema Boost',
        readAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      sent++;
    }
    return sent;
  }

  // Gate de cron interno: secret de alto-entropia no header `x-cron-secret`, comparado
  // em tempo constante. Sem RANKING_CRON_SECRET no ambiente → 503 (feature off). Permite
  // que um scheduler externo (Cloud Scheduler) dispare rotinas SEM um token de admin
  // Firebase — que ele não tem como obter. NÃO use em rotas de dado sensível por papel.
  const requireCronSecret: express.RequestHandler = (req, res, next) => {
    const secret = process.env.RANKING_CRON_SECRET || '';
    if (!secret) return res.status(503).json({ error: 'Cron não configurado (defina RANKING_CRON_SECRET).' });
    const provided = String(req.headers['x-cron-secret'] || '');
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Secret de cron inválido.' });
    }
    next();
  };

  app.post('/api/rankings/compute', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    // Data: a do corpo (browser, fuso BR) ou hoje no servidor como fallback.
    const date = isoDateRe.test(String(req.body?.date)) ? String(req.body.date) : resolveServerToday();
    try {
      const adminSnap = await adminDb.collection('users').doc((req as any).user.uid).get();
      const generatedByName = (adminSnap.exists ? (adminSnap.data() as any)?.name : null) || 'Gerência Boost';
      const result = await computeAndStoreRanking(date, generatedByName);
      return res.json({ ...result, generatedAt: new Date().toISOString() });
    } catch (error: any) {
      console.error('[rankings] compute:', error);
      return res.status(error.status || 500).json({ error: error.message || 'Erro interno calculando ranking.', code: error.code });
    }
  });

  // Gatilho DIÁRIO (Cloud Scheduler ~14h30 BR, depois da OTG atualizar 13h-14h). Gera o
  // ranking de HOJE no fuso BR (resolveServerToday — R12) e manda um lembrete/relatório
  // aos admins. Secret-gated (fora do requireAdmin — um cron não tem token Firebase).
  // Idempotente: re-rodar no mesmo dia sobrescreve o ranking e o lembrete. Responde 200
  // mesmo "sem dados" (o lembrete cobre; o scheduler não deve re-tentar por isso); 502
  // só na falha real de upstream (aí um retry do scheduler faz sentido).
  app.post('/api/internal/daily-ranking', requireCronSecret, async (_req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    const date = resolveServerToday();
    let outcome: { ok: boolean; count: number; error?: string };
    try {
      const result = await computeAndStoreRanking(date, 'Geração automática');
      outcome = { ok: true, count: result.count };
    } catch (error: any) {
      console.error('[cron] daily-ranking geração falhou:', error);
      outcome = { ok: false, count: 0, error: error?.message };
    }
    let reminders = 0;
    try {
      reminders = await sendRankingReminderToAdmins(date, outcome);
    } catch (e) {
      console.error('[cron] daily-ranking lembrete falhou:', e);
    }
    return res.status(outcome.ok ? 200 : 502).json({ date, ok: outcome.ok, count: outcome.count, reminders, error: outcome.error });
  });

  const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const fetchExternalAffiliates = async (): Promise<any[]> => {
    const BASE_URL = process.env.VITE_AFFILIATE_API_BASE_URL || 'https://affiliate-api-prd.partnersotg.com';
    const apiKey = process.env.AFFILIATE_API_KEY;
    if (!apiKey) throw new Error('Chave de API externa não configurada.');

    const response = await fetchImpl(`${BASE_URL}/api/v2/external/affiliates`, {
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

  // Persiste o funil da v1 em `affiliate_analytics` (1 doc/afiliado×casa, id
  // determinístico → idempotente) e RECONCILIA: resolve o affiliateId por nameKey|casa
  // (afiliado real do mirror tem prioridade; senão o pending) e ENRIQUECE o pending
  // casado com o resumo do funil — é assim que os afiliados SportingBet "desatualizados"
  // (só-funil, ex.: Lucas) passam a mostrar cliques/cadastros. Ver src/lib/analyticsDoc.
  const persistAnalytics = async (
    rows: Array<{ nameKey: string; affiliate: string; house: string; [k: string]: any }>,
    range: { initialDate: string; finalDate: string }
  ): Promise<{ persisted: number; enrichedPending: number }> => {
    if (!adminDb || !rows.length) return { persisted: 0, enrichedPending: 0 };
    // mapas de junção por nameKey|casa (mesma chave da reconciliação de pending)
    const realByKey = new Map<string, string>();
    const affSnap = await adminDb.collection('affiliates').get();
    affSnap.forEach((d) => {
      const a = d.data() as any;
      const nk = normNameKey(a?.name ?? a?.label);
      const hs = normNameKey(brandNameOf(a));
      if (nk) realByKey.set(`${nk}|${hs}`, String(a?.id ?? d.id));
    });
    const pendingByKey = new Map<string, { ref: any; affiliateId: string }>();
    const pendSnap = await adminDb.collection('pending_affiliates').get();
    pendSnap.forEach((d) => {
      const p = d.data() as any;
      const key = `${normNameKey(p?.nameKey)}|${normNameKey(p?.house)}`;
      pendingByKey.set(key, { ref: d.ref, affiliateId: String(p?.affiliateId ?? d.id) });
    });
    let persisted = 0;
    let enrichedPending = 0;
    for (const row of rows) {
      const key = funnelKey(row.nameKey, row.house);
      const real = realByKey.get(key);
      const pend = pendingByKey.get(key);
      const metrics = sanitizeFunnel(row);
      await adminDb
        .collection('affiliate_analytics')
        .doc(analyticsDocId(row.nameKey, row.house))
        .set(
          {
            nameKey: row.nameKey,
            affiliate: row.affiliate,
            house: row.house,
            ...metrics,
            affiliateId: real ?? pend?.affiliateId ?? null,
            funnelOnly: !real, // true = não está no relatório v2 (caso "Lucas")
            range,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      persisted++;
      // enriquece o pending casado (sem tocar no nome) → mostra atividade no /admin.
      if (pend) {
        await pend.ref.set(
          {
            funnel: metrics,
            hasFunnelActivity: hasFunnelActivity(row),
            funnelUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        enrichedPending++;
      }
    }
    return { persisted, enrichedPending };
  };

  // Núcleo compartilhado do refresh do funil: pull + (se alguma casa respondeu)
  // persist/reconcilia. Usado pela rota ADMIN (botão no /otg-roster) e pela rota de
  // CRON (scheduler). Não lança por casa (resiliência em pullAnalytics); só propaga se
  // o pull inteiro falhar (ex.: login durável caiu → o chamador devolve 502).
  const runAnalyticsRefresh = async (range: { initialDate: string; finalDate: string }) => {
    const result = await pullAnalytics(range, fetchImpl);
    const houses = result.houses.map((h) => ({
      house: h.house,
      available: h.available,
      summary: h.summary,
      count: h.rows.length,
      error: h.error,
    }));
    const anyOk = result.houses.some((h) => h.available);
    const firstErr = result.houses.find((h) => h.error)?.error;
    let persisted = 0;
    let enrichedPending = 0;
    if (anyOk) {
      try {
        const p = await persistAnalytics(result.rows, range);
        persisted = p.persisted;
        enrichedPending = p.enrichedPending;
      } catch (e: any) {
        console.warn('Analytics: persistência adiada (falha ao gravar):', e?.message);
      }
    }
    return { result, houses, anyOk, firstErr, persisted, enrichedPending };
  };

  // v1 ANALÍTICA da OTG: traz cliques + funil inicial + NGR por afiliado×casa —
  // inclusive os só-funil (clique/cadastro sem comissão) que a v2 externa esconde
  // (caso "Lucas Guimarães"). Auth via OTG_DASH_ACCESS_TOKEN (dashboard tem 2FA →
  // sem password-grant; ver SPIKE-OTG-V1-ANALYTICS.md). Range default = mês corrente
  // no fuso BR. Por ora pull+retorna (persistência/UI = próxima fatia).
  app.post('/api/analytics/refresh', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    if (!isOtgAnalyticsConfigured()) {
      return res.status(503).json({ error: 'v1 analítica não configurada (defina OTG_DASH_API_BASE + OTG_DASH_ACCESS_TOKEN no Secret Manager).' });
    }
    const today = resolveServerToday();
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const initialDate = isoRe.test(String(req.body?.initialDate)) ? String(req.body.initialDate) : `${today.slice(0, 7)}-01`;
    const finalDate = isoRe.test(String(req.body?.finalDate)) ? String(req.body.finalDate) : today;
    try {
      const { result, houses, anyOk, firstErr, persisted, enrichedPending } = await runAnalyticsRefresh({ initialDate, finalDate });
      // Se NENHUMA casa respondeu (todas indisponíveis/erro) E houve erro real — ex.:
      // login OTG falhou → 401/erro em todas — surfacia 502 em vez de um 200-vazio
      // enganoso. (Só superbet-404, sem erro real, segue 200 com rows da sportingbet.)
      if (!anyOk && firstErr) {
        return res.status(502).json({ error: firstErr, range: { initialDate, finalDate }, houses });
      }
      return res.json({
        source: 'otg-v1-analytics',
        range: { initialDate, finalDate },
        houses,
        persisted,
        enrichedPending,
        rows: result.rows,
        fetchedAt: result.fetchedAt,
      });
    } catch (error: any) {
      console.error('Error pulling OTG v1 analytics:', error);
      return res.status(502).json({ error: error.message || 'Erro ao puxar a v1 analítica da OTG.' });
    }
  });

  // CRON do funil v1: um scheduler externo (Cloud Scheduler) atualiza o funil
  // diariamente SEM token admin (que ele não tem) — gated pelo mesmo `requireCronSecret`
  // do ranking (RANKING_CRON_SECRET, header x-cron-secret). Mesma lógica da rota admin
  // (pull + persist/reconcilia), range = mês corrente BR. Ver boost-v1-analytics + CLAUDE.md.
  app.post('/api/internal/analytics-refresh', requireCronSecret, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    if (!isOtgAnalyticsConfigured()) {
      return res.status(503).json({ error: 'v1 analítica não configurada (defina OTG_DASH_EMAIL/PASSWORD/DEVICE_TOKEN).' });
    }
    const today = resolveServerToday();
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const initialDate = isoRe.test(String(req.body?.initialDate)) ? String(req.body.initialDate) : `${today.slice(0, 7)}-01`;
    const finalDate = isoRe.test(String(req.body?.finalDate)) ? String(req.body.finalDate) : today;
    try {
      const { anyOk, firstErr, persisted, enrichedPending, houses } = await runAnalyticsRefresh({ initialDate, finalDate });
      if (!anyOk && firstErr) {
        return res.status(502).json({ ok: false, error: firstErr, range: { initialDate, finalDate }, houses });
      }
      return res.json({ ok: true, range: { initialDate, finalDate }, persisted, enrichedPending, houses });
    } catch (error: any) {
      console.error('Error in analytics cron:', error);
      return res.status(502).json({ ok: false, error: error.message || 'Erro ao atualizar o funil.' });
    }
  });

  // Cria um convite (token single-use, 7d) ligado a um affiliateId. Extraído p/ ser
  // reusado pelo POST /api/invites E pelo cadastro de afiliado nativo Boost.
  const createInviteDoc = async (affiliateId: string, affiliateName?: string | null) => {
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + INVITE_TTL_MS);
    await adminDb!.collection('invites').doc(token).set({
      token,
      affiliateId: String(affiliateId),
      affiliateName: affiliateName ? String(affiliateName) : null,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
    });
    return { token, expiresAt: expiresAt.toDate().toISOString() };
  };

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
      const { token, expiresAt } = await createInviteDoc(String(affiliateId), affiliateName);
      return res.status(201).json({ token, expiresAt });
    } catch (error: any) {
      console.error('Error creating invite:', error);
      return res.status(500).json({ error: error.message || 'Erro interno criando convite.' });
    }
  });

  // --- Afiliado nativo Boost (sem OTG) + alias de e-mail ----------------------
  // SECURITY: nome vai no mirror `affiliates` (legível por logado, p/ exibição);
  // e-mail (PII) vai SÓ em affiliate_email_aliases (admin-only). Ver firestore.rules.

  // Cria afiliados nativos Boost em lote a partir do import (nome+email+casa).
  // Idempotente por e-mail: se já existe alias, reusa o affiliateId (não duplica).
  app.post('/api/boost-affiliates', requireAdmin, async (req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }
    try {
      const list = Array.isArray(req.body?.affiliates) ? req.body.affiliates : null;
      if (!list || list.length === 0) {
        return res.status(400).json({ error: 'Envie { affiliates: [{ name, email?, house }] }.' });
      }
      const generateInvite = !!req.body?.generateInvite;
      const createdByUid = (req as any).user?.uid ?? null;
      const created: any[] = [];

      for (const item of list) {
        const name = String(item?.name ?? '').trim();
        const house = String(item?.house ?? '').trim();
        const emailKey = normalizeEmailKey(item?.email);
        if (!name) { continue; }

        // Idempotência: e-mail já mapeado -> reusa o afiliado existente.
        let affiliateId: string | null = null;
        let reused = false;
        if (emailKey) {
          const aliasSnap = await adminDb.collection('affiliate_email_aliases').doc(emailKey).get();
          if (aliasSnap.exists && aliasSnap.data()?.affiliateId) {
            affiliateId = String(aliasSnap.data()!.affiliateId);
            reused = true;
          }
        }

        if (!affiliateId) {
          affiliateId = makeBoostAffiliateId(crypto.randomUUID());
          // mirror (name-only) — alimenta a resolução de nome em todo o app.
          await adminDb.collection('affiliates').doc(affiliateId).set({
            id: affiliateId,
            name,
            brand: house ? { name: house } : null,
            source: 'boost',
            createdByUid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          // ativo por padrão (espelha o status dos afiliados gerenciados)
          await adminDb.collection('affiliate_statuses').doc(affiliateId).set({
            status: 'active',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          // e-mail (PII) -> alias admin-only
          if (emailKey) {
            await adminDb.collection('affiliate_email_aliases').doc(emailKey).set({
              email: emailKey,
              affiliateId,
              name,
              kind: 'boost',
              createdByUid,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        }

        let invite: { token: string; expiresAt: string } | null = null;
        if (generateInvite) {
          try { invite = await createInviteDoc(affiliateId, name); } catch (e) { console.error('invite p/ boost-affiliate falhou:', e); }
        }
        created.push({ affiliateId, name, email: emailKey || null, reused, invite });
      }

      return res.status(201).json({ created });
    } catch (error: any) {
      console.error('Error creating boost affiliates:', error);
      return res.status(500).json({ error: error.message || 'Erro interno criando afiliados Boost.' });
    }
  });

  // "Vincular a existente": liga um e-mail (de planilha, sem login) a um afiliado já
  // existente. Persistente — reuploads futuros com esse e-mail passam a casar.
  app.post('/api/affiliate-email-aliases', requireAdmin, async (req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }
    try {
      const emailKey = normalizeEmailKey(req.body?.email);
      const affiliateId = String(req.body?.affiliateId ?? '').trim();
      if (!emailKey || !affiliateId) {
        return res.status(400).json({ error: 'Informe email e affiliateId.' });
      }
      await adminDb.collection('affiliate_email_aliases').doc(emailKey).set({
        email: emailKey,
        affiliateId,
        kind: 'link',
        createdByUid: (req as any).user?.uid ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.json({ email: emailKey, affiliateId });
    } catch (error: any) {
      console.error('Error creating email alias:', error);
      return res.status(500).json({ error: error.message || 'Erro interno criando alias.' });
    }
  });

  // Lista os aliases de e-mail (p/ o roster do import). Admin-only.
  app.get('/api/affiliate-email-aliases', requireAdmin, async (_req, res) => {
    if (!adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }
    try {
      const snap = await adminDb.collection('affiliate_email_aliases').get();
      const aliases = snap.docs.map((d) => {
        const x = d.data();
        return { email: x.email ?? d.id, affiliateId: x.affiliateId, name: x.name ?? null, kind: x.kind ?? null };
      });
      return res.json({ aliases });
    } catch (error: any) {
      console.error('Error listing email aliases:', error);
      return res.status(500).json({ error: error.message || 'Erro interno listando aliases.' });
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
      const isSpecial = resolveIsSpecial(specialSnap.exists ? (specialSnap.data() as any) : null);

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
        // Carrega a sub-rede do especial só no caminho válido (results, sem :id, com
        // affiliateId); resolveScopedAffiliateIds cuida de todos os 403. [[R4]]
        let special: any = null;
        if (adminDb && endpoint === 'results' && !id && user?.affiliateId) {
          try {
            const specialSnap = await adminDb.collection('special_affiliates').doc(String(user.affiliateId)).get();
            special = specialSnap.exists ? (specialSnap.data() as any) : null;
          } catch (e) {
            console.error('Erro ao carregar sub-rede do afiliado especial:', e);
          }
        }
        const decision = resolveScopedAffiliateIds({
          role: user?.role,
          endpoint,
          id,
          ownAffiliateId: user?.affiliateId,
          special,
          requestedAffiliateIds: req.query.affiliateIds as any,
        });
        if (decision.denied) return res.status(decision.denied.status).json({ error: decision.denied.error });
        if (decision.scoped) req.query.affiliateIds = decision.scoped.join(',');
      }

      // A API externa NÃO aceita affiliateIds separados por vírgula (devolve vazio);
      // ela espera o parâmetro REPETIDO (affiliateIds=a&affiliateIds=b). Expandimos
      // aqui — senão o afiliado especial (own + subs) e o filtro multi-marca por
      // campanha (vários ids) recebem 0 linhas. Os demais params passam direto.
      const outParams = new URLSearchParams();
      for (const [key, value] of Object.entries(req.query as Record<string, any>)) {
        if (value == null) continue;
        if (key === 'affiliateIds') {
          expandAffiliateIdsParam(value).forEach((affId) => outParams.append('affiliateIds', affId));
        } else {
          outParams.append(key, String(value));
        }
      }
      const queryString = outParams.toString();
      const targetUrl = id
        ? `${BASE_URL}/api/v2/external/${endpoint}/${id}${queryString ? '?' + queryString : ''}`
        : `${BASE_URL}/api/v2/external/${endpoint}${queryString ? '?' + queryString : ''}`;
        
      console.log(`Proxying request to: ${targetUrl}`);
      
      const response = await fetchImpl(targetUrl, {
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
      return res.status(201).json(payload);
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
        dataSource: b.dataSource ?? 'otg', // sementes vêm da OTG
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
      dataSource: data.dataSource === 'manual' ? 'manual' : 'otg',
      defaultCpa: Number.isFinite(Number(data.defaultCpa)) ? Number(data.defaultCpa) : null,
      defaultRev: Number.isFinite(Number(data.defaultRev)) ? Number(data.defaultRev) : null,
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
      const { name, brandId, registerUrlTemplate, active, order, dataSource, logoBase64 } = req.body || {};
      // Taxa padrão da casa (comissão casa→agência): número finito OU null (vazio).
      const numOrNull = (v: any) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
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
        // Casa nova nasce 'manual' (recebe upload); a OTG fica nas sementes.
        dataSource: dataSource === 'otg' ? 'otg' : 'manual',
        defaultCpa: numOrNull(req.body?.defaultCpa),
        defaultRev: numOrNull(req.body?.defaultRev),
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
      if (body.dataSource !== undefined) patch.dataSource = body.dataSource === 'otg' ? 'otg' : 'manual';
      const numOrNull = (v: any) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
      if (body.defaultCpa !== undefined) patch.defaultCpa = numOrNull(body.defaultCpa);
      if (body.defaultRev !== undefined) patch.defaultRev = numOrNull(body.defaultRev);
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

  // === Resultados MANUAIS por casa (upload) =================================
  // Casas 'manual' recebem resultados via planilha. Cada doc = uma linha
  // (casa, data, afiliado|null=agregado) com as métricas no shape de `results`.
  // O merge com a OTG é feito no cliente (affiliateService) — aqui só persistimos.
  // `hrDocId` (id determinístico = reimport idempotente) e `sanitizeMetrics`
  // (coage as 6 métricas) vivem em src/lib/houseResultsDoc.ts (testados isolados).
  // Commit em lotes (< 500 ops por batch do Firestore).
  const commitChunked = async (ops: ((b: admin.firestore.WriteBatch) => void)[]) => {
    for (let i = 0; i < ops.length; i += 450) {
      const batch = adminDb!.batch();
      ops.slice(i, i + 450).forEach((fn) => fn(batch));
      await batch.commit();
    }
  };

  // Lista linhas manuais no range. Admin → todas; afiliado → só as ATRIBUÍDAS a ele
  // (nunca o agregado/não-atribuído, que revelaria o total da casa).
  app.get('/api/house-results', requireAuth, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Servidor indisponível' });
    try {
      const user = (req as any).user;
      const start = req.query.start ? String(req.query.start) : null;
      const end = req.query.end ? String(req.query.end) : null;
      const houseSlug = req.query.houseSlug ? String(req.query.houseSlug) : null;
      // range de data é single-field (sem índice composto); demais filtros em código.
      let q: admin.firestore.Query = adminDb.collection('house_results');
      if (start) q = q.where('date', '>=', start);
      if (end) q = q.where('date', '<=', end);
      const snap = await q.get();
      let rows = snap.docs.map((d) => d.data() as any);
      if (houseSlug) rows = rows.filter((r) => r.houseSlug === houseSlug);
      if (user?.role !== 'admin') {
        // Escopo da sub-rede resolvido NO SERVIDOR (special_affiliates), MESMO padrão
        // do proxy externo (R4): o especial ATIVO vê o manual atribuído a own + subs;
        // o afiliado comum só ao próprio id. Sem isso a /network do especial
        // subcontava — não via o manual dos subs (o OTG já vem escopado à rede pelo
        // proxy). O agregado/não-atribuído (affiliateId null) nunca entra no escopo
        // permitido, então não vaza o total da casa. [[boost-houses-backoffice]]
        let special: any = null;
        if (user?.affiliateId) {
          try {
            const specialSnap = await adminDb.collection('special_affiliates').doc(String(user.affiliateId)).get();
            special = specialSnap.exists ? (specialSnap.data() as any) : null;
          } catch (e) {
            console.error('Erro ao carregar sub-rede do afiliado especial:', e);
          }
        }
        const decision = resolveScopedAffiliateIds({
          role: user?.role,
          endpoint: 'results',
          ownAffiliateId: user?.affiliateId,
          special,
        });
        if (decision.denied) return res.status(decision.denied.status).json({ error: decision.denied.error });
        const allowed = new Set(decision.scoped ?? []);
        rows = rows.filter((r) => allowed.has(String(r.affiliateId ?? '')));
      }
      rows = rows.map((r) => ({
        houseSlug: r.houseSlug,
        date: r.date,
        affiliateId: r.affiliateId ?? null,
        ...sanitizeMetrics(r),
      }));
      return res.json({ rows });
    } catch (e) {
      console.error('[house-results] erro ao listar:', e);
      return res.status(500).json({ error: 'Erro ao listar os resultados' });
    }
  });

  // Importa (admin): substitui as linhas da casa nas DATAS presentes no upload
  // (apaga as antigas daquelas datas e grava as novas) — reenviar um dia sobrescreve.
  app.post('/api/house-results/import', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Servidor indisponível' });
    try {
      const { houseSlug, rows } = req.body || {};
      const slug = String(houseSlug ?? '').trim();
      if (!slug) return res.status(400).json({ error: 'houseSlug é obrigatório.' });
      if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'Nenhuma linha para importar.' });

      const houseSnap = await adminDb.collection('houses').doc(slug).get();
      if (!houseSnap.exists) return res.status(404).json({ error: 'Casa não encontrada.' });

      // Normaliza e valida as linhas.
      const dates = new Set<string>();
      const clean = rows.map((r: any) => {
        const date = String(r?.date ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Data inválida na linha: "${date}".`);
        dates.add(date);
        const affiliateId = r?.affiliateId != null && String(r.affiliateId).trim() ? String(r.affiliateId).trim() : null;
        return { houseSlug: slug, date, affiliateId, ...sanitizeMetrics(r) };
      });

      // Apaga as linhas existentes da casa nas datas do upload (single-field por
      // houseSlug, sem índice composto; filtra a data em código).
      const existing = await adminDb.collection('house_results').where('houseSlug', '==', slug).get();
      const toDelete = existing.docs.filter((d) => dates.has((d.data() as any)?.date));

      const uid = (req as any).user?.uid ?? null;
      const importedAt = admin.firestore.FieldValue.serverTimestamp();
      const ops: ((b: admin.firestore.WriteBatch) => void)[] = [];
      toDelete.forEach((d) => ops.push((b) => b.delete(d.ref)));
      clean.forEach((row) => {
        const ref = adminDb!.collection('house_results').doc(hrDocId(row.houseSlug, row.date, row.affiliateId));
        ops.push((b) => b.set(ref, { ...row, importedByUid: uid, importedAt }));
      });
      await commitChunked(ops);

      return res.json({ ok: true, imported: clean.length, dates: [...dates].sort(), deleted: toDelete.length });
    } catch (e: any) {
      console.error('[house-results] erro ao importar:', e);
      return res.status(500).json({ error: e?.message || 'Erro ao importar os resultados' });
    }
  });

  // Limpa as linhas de uma casa (admin); ?date= limpa só aquele dia.
  app.delete('/api/house-results', requireAdmin, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Servidor indisponível' });
    try {
      const slug = String(req.query.houseSlug ?? '').trim();
      if (!slug) return res.status(400).json({ error: 'houseSlug é obrigatório.' });
      const date = req.query.date ? String(req.query.date) : null;
      const snap = await adminDb.collection('house_results').where('houseSlug', '==', slug).get();
      const docs = snap.docs.filter((d) => !date || (d.data() as any)?.date === date);
      await commitChunked(docs.map((d) => (b: admin.firestore.WriteBatch) => b.delete(d.ref)));
      return res.json({ ok: true, deleted: docs.length });
    } catch (e) {
      console.error('[house-results] erro ao limpar:', e);
      return res.status(500).json({ error: 'Erro ao limpar os resultados' });
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
      expandAffiliateIdsParam(req.query.affiliateIds).forEach((affId) => baseParams.append('affiliateIds', affId));

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
        const resp = await fetchImpl(`${BASE_URL}/api/v2/external/results?${params.toString()}`, {
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

  return app;
}

// Controle de versão: publica a versão DESTE deploy em app_meta/version (Firestore) no
// boot. Como cada deploy é um processo novo com um version.json novo (gerado no build
// por scripts/gen-version.mjs), a versão "eleva" sozinha a cada deploy — os clientes com
// a aba aberta veem o doc mudar (onSnapshot) e ganham o banner de atualização. Fica FORA
// do createApp (depende de build/FS) p/ não atrapalhar os testes via supertest. Escreve
// só se a versão mudou — o Cloud Run pode reiniciar a instância sem deploy novo, e isso
// manteria o updatedAt refletindo deploys reais. Os secrets do Admin SDK só existem em
// RUNTIME (apphosting.yaml), então a publicação tem que ser no boot, nunca no build.
function readBuildVersion(): AppVersion | null {
  // Em prod a versão vem de dist/version.json (Vite copia public/ -> dist/); em dev,
  // direto de public/version.json (gerado pelo predev). Tenta os dois.
  const candidates = [
    path.join(process.cwd(), 'dist', 'version.json'),
    path.join(process.cwd(), 'public', 'version.json'),
  ];
  for (const file of candidates) {
    try {
      const info = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (info?.version) return info as AppVersion;
    } catch {
      /* arquivo ausente neste ambiente — tenta o próximo */
    }
  }
  return null;
}

async function publishAppVersion(adminDb: admin.firestore.Firestore | null) {
  if (!adminDb) return;
  const info = readBuildVersion();
  if (!info?.version) {
    console.warn('App version: version.json não encontrado — pulando publicação.');
    return;
  }
  try {
    const ref = adminDb.collection('app_meta').doc('version');
    const snap = await ref.get();
    if (snap.exists && snap.data()?.version === info.version) return; // sem mudança
    await ref.set(
      { ...buildVersionPayload(info), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    console.log(`App version published: ${info.version}`);
  } catch (err) {
    console.error('Failed to publish app version:', err);
  }
}

// Sobe o servidor de verdade: inicializa o Admin SDK, monta o app via createApp e
// adiciona a camada específica de ambiente (Vite em dev / estático + fallback SPA em
// prod). Essa camada NÃO entra no createApp p/ manter o app testável e sem dependência
// de build/Vite.
async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const { adminApp, adminDb } = initAdmin();
  const app = createApp({ adminApp, adminDb });

  // Publica a versão deste deploy (best-effort, não bloqueia o boot).
  void publishAppVersion(adminDb);

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

// Auto-start só quando o processo é o servidor (tsx server.ts). Vitest seta
// VITEST=true e NODE_ENV='test'; o guard impede que importar este arquivo p/ pegar
// `createApp` num teste (supertest) suba o Vite e ouça a porta. Dev (NODE_ENV
// undefined) e prod (production) rodam normalmente.
if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  startServer();
}
