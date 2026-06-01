import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import admin from 'firebase-admin';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderErrorPage } from './errorPage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let adminApp: admin.app.App | null = null;
let adminDb: admin.firestore.Firestore | null = null;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else {
    adminApp = admin.initializeApp();
  }
  adminDb = adminApp.firestore();
  console.log('Firebase Admin initialized');
} catch (error) {
  console.error('Firebase Admin initialization failed:', error);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

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
  // --------------------------------------------------------------------------

  const serializeTimestamp = (value: any) => {
    if (value?.toDate && typeof value.toDate === 'function') {
      return value.toDate().toISOString();
    }
    return value ?? null;
  };

  // B3 · Afiliado especial define a comissão de um sub-afiliado da própria sub-rede.
  // `affiliate_configs` é admin-only nas rules; este endpoint grava via Admin SDK
  // após validar que o caller é o especial DAQUELE sub e que a taxa respeita o teto
  // (a taxa que o master setou para o especial). requireAuth — o especial é `client`.
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

      // Teto = taxa do especial definida pelo master.
      const ceilCpa = Number(special.networkCpaValue) || 0;
      const ceilRev = Number(special.networkRevPercentage) || 0;
      if (cpa > ceilCpa || rev > ceilRev) {
        return res.status(400).json({ error: `Taxa acima do teto do master (CPA até R$ ${ceilCpa}, REV até ${ceilRev}%).` });
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

  const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const fetchExternalAffiliates = async (): Promise<any[]> => {
    const BASE_URL = process.env.VITE_AFFILIATE_API_BASE_URL || 'https://affiliate-api-prd.partnersotg.com';
    const apiKey = process.env.VITE_AFFILIATE_API_KEY || process.env.AFFILIATE_API_KEY;
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
      return res.json({ synced: written, total: affiliates.length });
    } catch (error: any) {
      console.error('Error syncing affiliates:', error);
      return res.status(500).json({ error: error.message || 'Erro interno sincronizando afiliados.' });
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
  app.get('/api/invites/:token', async (req, res) => {
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
  app.post('/api/accept-invite', async (req, res) => {
    if (!adminApp || !adminDb) {
      return res.status(500).json({ error: 'Firebase Admin não está inicializado.' });
    }
    try {
      const { token, email, password } = req.body ?? {};
      if (!token || !email || !password) {
        return res.status(400).json({ error: 'Token, e-mail e senha são obrigatórios.' });
      }

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
        affiliateId: String(invite.affiliateId),
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
      const apiKey = process.env.VITE_AFFILIATE_API_KEY || process.env.AFFILIATE_API_KEY;

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

      const queryString = new URLSearchParams(req.query as any).toString();
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
        return res.status(response.status).json({ 
          error: `Erro na API Externa (${endpoint}): ${response.status}`,
          code: responseBody?.code || responseBody?.errorCode,
          message: responseBody?.message || responseBody?.error || response.statusText,
          details: responseBody?.details || responseBody || responseText
        });
      }

      if (responseBody !== null) {
        return res.json(responseBody);
      }

      return res.status(502).json({
        error: `Resposta inválida da API Externa (${endpoint})`,
        details: responseText
      });
    } catch (error) {
      console.error('Proxy Exception:', error);
      res.status(500).json({ 
        error: 'Erro interno no servidor proxy', 
        message: error instanceof Error ? error.message : String(error) 
      });
    }
  });

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
