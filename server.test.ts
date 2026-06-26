// @vitest-environment node
//
// Roda em env NODE (não jsdom): importar server.ts puxa `vite`→esbuild, cujo
// invariante de TextEncoder quebra sob jsdom ("incorrectly false"). Estes testes são
// server-side puros (supertest + mocks) e não precisam de DOM.
/**
 * Testes de integração das rotas do server.ts via supertest (P1.4).
 *
 * Tese (REVIEW-TEST-PLAN.md §0.1): a AUTORIZAÇÃO e o ESCOPO viviam embutidos nas
 * rotas do server.ts (1900 linhas, 0 teste de rota). As funções puras (scope.ts)
 * já têm teste, mas o WIRING — a rota chamar resolveScopedAffiliateIds, forçar os
 * affiliateIds, devolver 403, filtrar linhas — nunca era exercitado. Aqui montamos
 * o app real via `createApp(deps)` com Firestore/Auth/fetch MOCKADOS (sem rede nem
 * Firebase real) e batemos nas rotas de verdade.
 *
 * Cobre: R4 (IDOR do proxy externo), R13 (requireAdmin fail-closed), R16 (escopo do
 * house-results — agregado não vaza), R20 (convite público TTL/single-use + rate
 * limit), R25 (create-user valida o enum de role).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from './server';

// =============================================================================
// Doubles em memória — Firestore + Admin Auth. Cobrem só o que as rotas testadas
// usam: collection/doc/get/set + where/get; auth().verifyIdToken/createUser.
// =============================================================================
function makeFirestore(seed: Record<string, Record<string, any>> = {}): any {
  const store = new Map<string, Map<string, any>>();
  for (const [col, docs] of Object.entries(seed)) {
    store.set(col, new Map(Object.entries(docs)));
  }
  const getCol = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  const docRef = (col: string, id: string): any => ({
    id,
    get ref() {
      return this;
    },
    async get() {
      const m = getCol(col);
      const data = m.get(id);
      return { exists: m.has(id), id, data: () => data, ref: docRef(col, id) };
    },
    async set(data: any, opts?: any) {
      const m = getCol(col);
      if (opts?.merge) m.set(id, { ...(m.get(id) || {}), ...data });
      else m.set(id, data);
    },
  });
  const query = (col: string, filters: Array<[string, string, any]> = []): any => ({
    where(field: string, op: string, val: any) {
      return query(col, [...filters, [field, op, val]]);
    },
    limit() {
      return query(col, filters);
    },
    doc(id: string) {
      return docRef(col, id);
    },
    async get() {
      const m = getCol(col);
      let docs = [...m.entries()].map(([id, data]) => ({
        id,
        data: () => data,
        ref: docRef(col, id),
      }));
      for (const [field, op, val] of filters) {
        docs = docs.filter(({ data }) => {
          const v = (data() as any)?.[field];
          if (op === '==') return v === val;
          if (op === '>=') return v >= val;
          if (op === '<=') return v <= val;
          return true;
        });
      }
      return { docs, empty: docs.length === 0, size: docs.length, forEach: (cb: any) => docs.forEach(cb) };
    },
  });
  return {
    collection: (name: string) => query(name),
    __store: store,
  };
}

function makeAdminApp(opts: {
  verify?: (token: string) => any;
  createUser?: (props: any) => any;
  getUserByEmail?: (email: string) => any;
} = {}): any {
  return {
    auth: () => ({
      // Por default, o token Bearer É o uid (mock simples). requireAuth/requireAdmin
      // resolvem role/affiliateId lendo users/{uid} no Firestore mockado.
      verifyIdToken: async (token: string) =>
        opts.verify ? opts.verify(token) : { uid: token, email: `${token}@test` },
      createUser: async (props: any) =>
        opts.createUser ? opts.createUser(props) : { uid: 'new-uid', ...props },
      getUserByEmail: async (email: string) =>
        opts.getUserByEmail ? opts.getUserByEmail(email) : { uid: 'existing-uid', email },
    }),
  };
}

function buildApp(args: { seed?: any; adminAppOpts?: any; fetchImpl?: any } = {}) {
  return createApp({
    adminApp: makeAdminApp(args.adminAppOpts),
    adminDb: makeFirestore(args.seed),
    fetchImpl: args.fetchImpl,
  });
}

// fetch mock que devolve uma Response-like e captura a URL chamada (p/ o proxy).
function captureFetch() {
  const calls: string[] = [];
  const fetchImpl = async (url: any) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [] }),
    } as any;
  };
  return { fetchImpl, calls };
}

// =============================================================================
// R13 — requireAdmin fail-closed (rota admin-only /api/affiliate-statuses)
// =============================================================================
describe('requireAdmin (R13)', () => {
  const seed = {
    users: { 'admin-uid': { role: 'admin' }, 'client-uid': { role: 'client' } },
  };

  it('sem token → 401', async () => {
    await request(buildApp({ seed })).get('/api/affiliate-statuses').expect(401);
  });

  it('token de usuário client → 403', async () => {
    await request(buildApp({ seed }))
      .get('/api/affiliate-statuses')
      .set('Authorization', 'Bearer client-uid')
      .expect(403);
  });

  it('token de admin → 200', async () => {
    await request(buildApp({ seed }))
      .get('/api/affiliate-statuses')
      .set('Authorization', 'Bearer admin-uid')
      .expect(200);
  });
});

// =============================================================================
// R4 — IDOR no proxy externo /api/external/:endpoint
// =============================================================================
describe('proxy externo / IDOR (R4)', () => {
  const seed = {
    users: {
      'admin-uid': { role: 'admin' },
      'aff1-uid': { role: 'client', affiliateId: 'AFF-1' },
      'noaff-uid': { role: 'client' },
    },
  };

  beforeAll(() => {
    process.env.AFFILIATE_API_KEY = 'test-key';
  });
  afterAll(() => {
    delete process.env.AFFILIATE_API_KEY;
  });

  it('client em endpoint != results → 403 e NÃO chama o upstream', async () => {
    const { fetchImpl, calls } = captureFetch();
    await request(buildApp({ seed, fetchImpl }))
      .get('/api/external/affiliates')
      .set('Authorization', 'Bearer aff1-uid')
      .expect(403);
    expect(calls).toHaveLength(0);
  });

  it('client em results SEM affiliateIds → escopa ao próprio id no upstream', async () => {
    const { fetchImpl, calls } = captureFetch();
    await request(buildApp({ seed, fetchImpl }))
      .get('/api/external/results')
      .set('Authorization', 'Bearer aff1-uid')
      .expect(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('affiliateIds=AFF-1');
  });

  it('client pedindo id de OUTRO afiliado → 403 (interseção vazia) e sem upstream', async () => {
    const { fetchImpl, calls } = captureFetch();
    await request(buildApp({ seed, fetchImpl }))
      .get('/api/external/results?affiliateIds=AFF-999')
      .set('Authorization', 'Bearer aff1-uid')
      .expect(403);
    expect(calls).toHaveLength(0);
  });

  it('client sem affiliateId vinculado → 403', async () => {
    await request(buildApp({ seed }))
      .get('/api/external/results')
      .set('Authorization', 'Bearer noaff-uid')
      .expect(403);
  });

  it('admin passa sem escopo — múltiplos affiliateIds preservados no upstream', async () => {
    const { fetchImpl, calls } = captureFetch();
    await request(buildApp({ seed, fetchImpl }))
      .get('/api/external/results?affiliateIds=A&affiliateIds=B')
      .set('Authorization', 'Bearer admin-uid')
      .expect(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('affiliateIds=A');
    expect(calls[0]).toContain('affiliateIds=B');
  });
});

// =============================================================================
// R16 — escopo do house-results: o agregado (affiliateId null) não vaza
// =============================================================================
describe('house-results scope (R16)', () => {
  // AFF-1 é ESPECIAL ativo com a sub-rede [AFF-2]; AFF-3 é afiliado comum.
  const seed = {
    users: {
      'admin-uid': { role: 'admin' },
      'aff1-uid': { role: 'client', affiliateId: 'AFF-1' },
      'aff3-uid': { role: 'client', affiliateId: 'AFF-3' },
    },
    special_affiliates: {
      'AFF-1': { active: true, subAffiliateIds: ['AFF-2'] },
    },
    house_results: {
      r1: { houseSlug: 'sb', date: '2026-06-01', affiliateId: 'AFF-1' },
      r2: { houseSlug: 'sb', date: '2026-06-01', affiliateId: 'AFF-2' },
      r3: { houseSlug: 'sb', date: '2026-06-01', affiliateId: 'AFF-3' },
      agg: { houseSlug: 'sb', date: '2026-06-01', affiliateId: null },
    },
  };

  it('afiliado comum vê só as próprias linhas — nunca a de outro nem a agregada (null)', async () => {
    const res = await request(buildApp({ seed }))
      .get('/api/house-results')
      .set('Authorization', 'Bearer aff3-uid')
      .expect(200);
    const rows = res.body.rows as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].affiliateId).toBe('AFF-3');
    expect(rows.some((r) => r.affiliateId === null)).toBe(false);
    expect(rows.some((r) => r.affiliateId !== 'AFF-3')).toBe(false);
  });

  it('especial ativo vê o manual de own + subs — mas nunca o agregado nem fora da rede', async () => {
    const res = await request(buildApp({ seed }))
      .get('/api/house-results')
      .set('Authorization', 'Bearer aff1-uid')
      .expect(200);
    const rows = res.body.rows as any[];
    const ids = rows.map((r) => r.affiliateId).sort();
    expect(ids).toEqual(['AFF-1', 'AFF-2']); // own + sub
    expect(rows.some((r) => r.affiliateId === null)).toBe(false); // agregado não vaza
    expect(rows.some((r) => r.affiliateId === 'AFF-3')).toBe(false); // fora da rede não vaza
  });

  it('admin vê todas as linhas, inclusive a agregada', async () => {
    const res = await request(buildApp({ seed }))
      .get('/api/house-results')
      .set('Authorization', 'Bearer admin-uid')
      .expect(200);
    expect((res.body.rows as any[]).length).toBe(4);
  });
});

// =============================================================================
// R20 — convite público: TTL / single-use / 404 + rate limit
// =============================================================================
describe('convite público (R20)', () => {
  const future = () => ({ toMillis: () => Date.now() + 3_600_000 });
  const past = () => ({ toMillis: () => Date.now() - 1_000 });

  it('GET token inexistente → 404', async () => {
    await request(buildApp({ seed: {} })).get('/api/invites/nope').expect(404);
  });

  it('GET token já usado → 410', async () => {
    const seed = { invites: { t1: { status: 'used', affiliateId: 'AFF-1', expiresAt: future() } } };
    await request(buildApp({ seed })).get('/api/invites/t1').expect(410);
  });

  it('GET token expirado → 410', async () => {
    const seed = { invites: { t1: { status: 'pending', affiliateId: 'AFF-1', expiresAt: past() } } };
    await request(buildApp({ seed })).get('/api/invites/t1').expect(410);
  });

  it('GET token válido → 200 com affiliateId', async () => {
    const seed = {
      invites: { t1: { status: 'pending', affiliateId: 'AFF-1', affiliateName: 'Casa', expiresAt: future() } },
    };
    const res = await request(buildApp({ seed })).get('/api/invites/t1').expect(200);
    expect(res.body.affiliateId).toBe('AFF-1');
  });

  it('POST accept-invite sem campos obrigatórios → 400', async () => {
    await request(buildApp({ seed: {} }))
      .post('/api/accept-invite')
      .send({ token: 't1' })
      .expect(400);
  });

  it('POST accept-invite com token usado → 410', async () => {
    const seed = { invites: { t1: { status: 'used', affiliateId: 'AFF-1', expiresAt: future() } } };
    await request(buildApp({ seed }))
      .post('/api/accept-invite')
      .send({ token: 't1', email: 'a@b.com', password: 'secret123', phone: '11999999999' })
      .expect(410);
  });

  it('POST accept-invite válido → 201, cria user client e marca o convite usado', async () => {
    const fs = makeFirestore({
      invites: { t1: { status: 'pending', affiliateId: 'AFF-1', affiliateName: 'Casa', expiresAt: future() } },
    });
    const app = createApp({
      adminApp: makeAdminApp({ createUser: () => ({ uid: 'fresh-uid' }) }),
      adminDb: fs,
    });
    const res = await request(app)
      .post('/api/accept-invite')
      .send({ token: 't1', email: 'a@b.com', password: 'secret123', phone: '11999999999' })
      .expect(201);
    expect(res.body.uid).toBe('fresh-uid');
    const userDoc = fs.__store.get('users').get('fresh-uid');
    expect(userDoc.role).toBe('client'); // self-register nunca vira admin
    expect(userDoc.affiliateId).toBe('AFF-1'); // vínculo vem do convite, não do cliente
    expect(fs.__store.get('invites').get('t1').status).toBe('used'); // single-use
  });

  it('publicAuthLimiter: a 31ª requisição → 429', async () => {
    const app = buildApp({ seed: {} }); // limiter próprio deste app
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      lastStatus = (await request(app).get('/api/invites/x')).status;
    }
    expect(lastStatus).toBe(429);
  });
});

// =============================================================================
// R25 — create-user valida o enum de role
// =============================================================================
describe('create-user enum de role (R25)', () => {
  const seed = { users: { 'admin-uid': { role: 'admin' } } };

  it('role fora de {admin,client} → 400 e NÃO cria no Auth', async () => {
    let created = false;
    const app = createApp({
      adminApp: makeAdminApp({
        createUser: () => {
          created = true;
          return { uid: 'x' };
        },
      }),
      adminDb: makeFirestore(seed),
    });
    await request(app)
      .post('/api/create-user')
      .set('Authorization', 'Bearer admin-uid')
      .send({ name: 'X', email: 'x@y.com', password: 'secret123', role: 'superadmin' })
      .expect(400);
    expect(created).toBe(false);
  });

  it('role client válido → 200 com uid', async () => {
    const app = createApp({
      adminApp: makeAdminApp({ createUser: () => ({ uid: 'new-c' }) }),
      adminDb: makeFirestore(seed),
    });
    const res = await request(app)
      .post('/api/create-user')
      .set('Authorization', 'Bearer admin-uid')
      .send({ name: 'X', email: 'x@y.com', password: 'secret123', role: 'client' })
      .expect(200);
    expect(res.body.uid).toBe('new-c');
  });
});

// =============================================================================
// Afiliado nativo Boost + alias de e-mail (Boost-first)
// =============================================================================
describe('boost-affiliates + email aliases', () => {
  const seed = () => ({ users: { 'admin-uid': { role: 'admin' }, 'client-uid': { role: 'client' } } });

  it('cria afiliado nativo: mirror name-only + alias (PII) + status ativo', async () => {
    const fs = makeFirestore(seed());
    const app = createApp({ adminApp: makeAdminApp(), adminDb: fs });
    const res = await request(app)
      .post('/api/boost-affiliates')
      .set('Authorization', 'Bearer admin-uid')
      .send({ affiliates: [{ name: 'Vanesa Cristina', email: 'Vanesa@X.com', house: 'Betfair' }] })
      .expect(201);

    expect(res.body.created).toHaveLength(1);
    const c = res.body.created[0];
    expect(c.affiliateId).toMatch(/^boost_/);
    expect(c.reused).toBe(false);
    expect(c.email).toBe('vanesa@x.com');
    expect(c.invite).toBeNull();

    // mirror: nome SIM, e-mail NÃO (PII fica só no alias)
    const aff = fs.__store.get('affiliates').get(c.affiliateId);
    expect(aff).toMatchObject({ name: 'Vanesa Cristina', source: 'boost', brand: { name: 'Betfair' } });
    expect(aff.email).toBeUndefined();
    // alias por e-mail normalizado
    const alias = fs.__store.get('affiliate_email_aliases').get('vanesa@x.com');
    expect(alias).toMatchObject({ affiliateId: c.affiliateId, kind: 'boost' });
    // status ativo
    expect(fs.__store.get('affiliate_statuses').get(c.affiliateId).status).toBe('active');
  });

  it('idempotente por e-mail: 2º cadastro reusa o affiliateId (não duplica mirror)', async () => {
    const fs = makeFirestore(seed());
    const app = createApp({ adminApp: makeAdminApp(), adminDb: fs });
    const first = await request(app).post('/api/boost-affiliates').set('Authorization', 'Bearer admin-uid')
      .send({ affiliates: [{ name: 'A', email: 'a@x.com', house: 'Betfair' }] }).expect(201);
    const id = first.body.created[0].affiliateId;
    const second = await request(app).post('/api/boost-affiliates').set('Authorization', 'Bearer admin-uid')
      .send({ affiliates: [{ name: 'A again', email: 'A@x.com', house: 'Betfair' }] }).expect(201);
    expect(second.body.created[0].reused).toBe(true);
    expect(second.body.created[0].affiliateId).toBe(id);
    expect(fs.__store.get('affiliates').size).toBe(1);
  });

  it('generateInvite → cria convite e devolve token', async () => {
    const fs = makeFirestore(seed());
    const app = createApp({ adminApp: makeAdminApp(), adminDb: fs });
    const res = await request(app).post('/api/boost-affiliates').set('Authorization', 'Bearer admin-uid')
      .send({ affiliates: [{ name: 'B', email: 'b@x.com', house: 'Betfair' }], generateInvite: true }).expect(201);
    expect(res.body.created[0].invite?.token).toBeTruthy();
    expect(fs.__store.get('invites').size).toBe(1);
  });

  it('client → 403; body vazio → 400', async () => {
    const app = createApp({ adminApp: makeAdminApp(), adminDb: makeFirestore(seed()) });
    await request(app).post('/api/boost-affiliates').set('Authorization', 'Bearer client-uid')
      .send({ affiliates: [{ name: 'X' }] }).expect(403);
    await request(app).post('/api/boost-affiliates').set('Authorization', 'Bearer admin-uid')
      .send({ affiliates: [] }).expect(400);
  });

  it('alias "vincular a existente" grava kind:link; GET lista; client 403', async () => {
    const fs = makeFirestore(seed());
    const app = createApp({ adminApp: makeAdminApp(), adminDb: fs });
    await request(app).post('/api/affiliate-email-aliases').set('Authorization', 'Bearer admin-uid')
      .send({ email: 'JS@Gmail.com', affiliateId: '8a58' }).expect(200);
    expect(fs.__store.get('affiliate_email_aliases').get('js@gmail.com')).toMatchObject({ affiliateId: '8a58', kind: 'link' });

    const list = await request(app).get('/api/affiliate-email-aliases').set('Authorization', 'Bearer admin-uid').expect(200);
    expect(list.body.aliases).toEqual([{ email: 'js@gmail.com', affiliateId: '8a58', name: null, kind: 'link' }]);

    await request(app).get('/api/affiliate-email-aliases').set('Authorization', 'Bearer client-uid').expect(403);
    await request(app).post('/api/affiliate-email-aliases').set('Authorization', 'Bearer admin-uid').send({ email: 'x' }).expect(400);
  });
});

// =============================================================================
// Cron interno: /api/internal/daily-ranking (auto-gera o ranking + lembra o admin)
// =============================================================================
describe('cron interno daily-ranking', () => {
  const seed = { users: { 'admin-uid': { role: 'admin', name: 'Boss' }, 'cli-uid': { role: 'client' } } };

  beforeAll(() => {
    process.env.AFFILIATE_API_KEY = 'cron-key';
  });
  afterAll(() => {
    delete process.env.AFFILIATE_API_KEY;
    delete process.env.RANKING_CRON_SECRET;
    delete process.env.MASTER_ADMIN_EMAIL;
  });

  it('sem RANKING_CRON_SECRET no ambiente → 503 (feature off)', async () => {
    delete process.env.RANKING_CRON_SECRET;
    await request(buildApp({ seed })).post('/api/internal/daily-ranking').expect(503);
  });

  it('secret ausente/errado → 401', async () => {
    process.env.RANKING_CRON_SECRET = 'right-secret';
    await request(buildApp({ seed })).post('/api/internal/daily-ranking').expect(401);
    await request(buildApp({ seed }))
      .post('/api/internal/daily-ranking')
      .set('x-cron-secret', 'wrong')
      .expect(401);
  });

  it('secret correto → 200, grava daily_rankings e manda lembrete a CADA admin (não a clients)', async () => {
    process.env.RANKING_CRON_SECRET = 'right-secret';
    delete process.env.MASTER_ADMIN_EMAIL; // sem master definido → fallback a todos os admins
    const fs = makeFirestore(seed);
    const { fetchImpl } = captureFetch(); // upstream devolve { data: [] } → 0 linhas
    const app = createApp({ adminApp: makeAdminApp(), adminDb: fs, fetchImpl });
    const res = await request(app)
      .post('/api/internal/daily-ranking')
      .set('x-cron-secret', 'right-secret')
      .expect(200);
    expect(res.body.ok).toBe(true);
    const date = res.body.date as string;
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // ranking do dia gravado (mesmo vazio)
    expect(fs.__store.get('daily_rankings').get(date)).toBeTruthy();
    // lembrete determinístico ao admin; cliente NÃO recebe
    expect(res.body.reminders).toBe(1);
    expect(fs.__store.get('direct_messages').get(`ranking-reminder__${date}__admin-uid`)).toBeTruthy();
    expect(fs.__store.get('direct_messages').get(`ranking-reminder__${date}__cli-uid`)).toBeUndefined();
  });

  it('re-rodar no mesmo dia é idempotente (não acumula lembrete)', async () => {
    process.env.RANKING_CRON_SECRET = 'right-secret';
    const fs = makeFirestore(seed);
    const { fetchImpl } = captureFetch();
    const app = createApp({ adminApp: makeAdminApp(), adminDb: fs, fetchImpl });
    await request(app).post('/api/internal/daily-ranking').set('x-cron-secret', 'right-secret').expect(200);
    await request(app).post('/api/internal/daily-ranking').set('x-cron-secret', 'right-secret').expect(200);
    // id determinístico por (date,uid) → só 1 doc de lembrete para o admin
    const dmIds = [...fs.__store.get('direct_messages').keys()];
    expect(dmIds.filter((id) => id.includes('admin-uid'))).toHaveLength(1);
  });

  it('MASTER_ADMIN_EMAIL setado → lembrete SÓ ao master, não aos demais admins', async () => {
    process.env.RANKING_CRON_SECRET = 'right-secret';
    process.env.MASTER_ADMIN_EMAIL = 'boss@boost.com';
    const seed2 = {
      users: {
        'master-uid': { role: 'admin', name: 'Boss', email: 'Boss@Boost.com' }, // casa case-insensitive
        'other-admin': { role: 'admin', name: 'Outro', email: 'outro@boost.com' },
      },
    };
    const fs = makeFirestore(seed2);
    const { fetchImpl } = captureFetch();
    const app = createApp({ adminApp: makeAdminApp(), adminDb: fs, fetchImpl });
    const res = await request(app)
      .post('/api/internal/daily-ranking')
      .set('x-cron-secret', 'right-secret')
      .expect(200);
    const date = res.body.date as string;
    expect(res.body.reminders).toBe(1);
    expect(fs.__store.get('direct_messages').get(`ranking-reminder__${date}__master-uid`)).toBeTruthy();
    expect(fs.__store.get('direct_messages').get(`ranking-reminder__${date}__other-admin`)).toBeUndefined();
  });
});

// =============================================================================
// v1 ANALÍTICA da OTG — POST /api/analytics/refresh
// Trava o WIRING da rota: admin-only, 503 sem creds, param fix repassado ao pull,
// resiliência (superbet-404 → 200 parcial) e auth expirada (401 em todas → 502).
// =============================================================================
describe('POST /api/analytics/refresh (v1 analítica)', () => {
  const seed = { users: { 'admin-uid': { role: 'admin' }, 'cli-uid': { role: 'client' } } };
  const aresp = (status: number, data: any) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  });
  const sbBody = (rows: any[]) => ({
    statusCode: 200,
    message: 'Success',
    data: { summary: { clicks: 5462 }, rows, meta: { currentPage: 1, totalPages: 1, totalRows: rows.length, pageSize: 500 } },
  });
  const LUCAS = { affiliate: 'LucasGuimaraes', clicks: 20, registrations: 4, ftd: 0, cpa_qual: 0, deposits: 0, bet_amount: 0, ngr: 0 };

  beforeEach(() => {
    process.env.OTG_DASH_API_BASE = 'https://api.test';
    process.env.OTG_DASH_ACCESS_TOKEN = 'tok-123';
    process.env.OTG_DASH_HOUSES = 'sportingbet,superbet';
  });
  afterEach(() => {
    delete process.env.OTG_DASH_API_BASE;
    delete process.env.OTG_DASH_ACCESS_TOKEN;
    delete process.env.OTG_DASH_HOUSES;
  });

  it('não-admin → 403', async () => {
    await request(buildApp({ seed })).post('/api/analytics/refresh').set('Authorization', 'Bearer cli-uid').expect(403);
  });

  it('sem credenciais OTG → 503', async () => {
    delete process.env.OTG_DASH_API_BASE;
    delete process.env.OTG_DASH_ACCESS_TOKEN;
    await request(buildApp({ seed })).post('/api/analytics/refresh').set('Authorization', 'Bearer admin-uid').expect(503);
  });

  it('sportingbet 200 + superbet 404 → 200 parcial; Lucas nas rows, superbet indisponível', async () => {
    const fetchImpl: any = async (url: string) =>
      String(url).includes('superbet') ? aresp(404, {}) : aresp(200, sbBody([LUCAS]));
    const app = createApp({ adminApp: makeAdminApp(), adminDb: makeFirestore(seed), fetchImpl });
    const res = await request(app)
      .post('/api/analytics/refresh')
      .set('Authorization', 'Bearer admin-uid')
      .send({ initialDate: '2026-06-01', finalDate: '2026-06-25' })
      .expect(200);
    expect(res.body.source).toBe('otg-v1-analytics');
    expect(res.body.range).toEqual({ initialDate: '2026-06-01', finalDate: '2026-06-25' });
    expect(res.body.rows.some((r: any) => r.nameKey === 'lucasguimaraes')).toBe(true);
    const sup = res.body.houses.find((h: any) => h.house === 'superbet');
    expect(sup.available).toBe(false);
    expect(res.body.houses.find((h: any) => h.house === 'sportingbet').available).toBe(true);
  });

  it('401 em todas (token OTG expirado) → 502 surfacia o erro', async () => {
    const fetchImpl: any = async () => aresp(401, { message: 'Unauthorized' });
    const app = createApp({ adminApp: makeAdminApp(), adminDb: makeFirestore(seed), fetchImpl });
    const res = await request(app)
      .post('/api/analytics/refresh')
      .set('Authorization', 'Bearer admin-uid')
      .expect(502);
    expect(res.body.error).toMatch(/HTTP 401/);
  });

  it('persiste o funil em affiliate_analytics + reconcilia (real vs Lucas só-funil) e enriquece o pending', async () => {
    const HELDER = { affiliate: 'HelderDosSantosCavalheiro', clicks: 164, registrations: 47, ftd: 12, cpa_qual: 10, deposits: 0, bet_amount: 0, ngr: 1467.96 };
    const fetchImpl: any = async (url: string) =>
      String(url).includes('superbet') ? aresp(404, {}) : aresp(200, sbBody([HELDER, LUCAS]));
    const fs = makeFirestore({
      users: { 'admin-uid': { role: 'admin' } },
      affiliates: { 'AFF-H': { id: 'AFF-H', name: 'Helder Dos Santos Cavalheiro', brand: 'SportingBet' } },
      pending_affiliates: {
        pending_lucasguimaraes_sportingbet: { id: 'pending_lucasguimaraes_sportingbet', nameKey: 'lucasguimaraes', house: 'sportingbet', status: 'pending', name: 'Lucas Guimarães' },
      },
    });
    const app = createApp({ adminApp: makeAdminApp(), adminDb: fs, fetchImpl });
    const res = await request(app)
      .post('/api/analytics/refresh')
      .set('Authorization', 'Bearer admin-uid')
      .expect(200);

    expect(res.body.persisted).toBe(2);
    expect(res.body.enrichedPending).toBe(1);
    // affiliate_analytics: id determinístico nameKey__casa; Lucas só-funil vs Helder real
    const an = fs.__store.get('affiliate_analytics');
    expect(an.get('lucasguimaraes__sportingbet')).toMatchObject({ clicks: 20, registrations: 4, affiliateId: 'pending_lucasguimaraes_sportingbet', funnelOnly: true });
    expect(an.get('helderdossantoscavalheiro__sportingbet')).toMatchObject({ clicks: 164, affiliateId: 'AFF-H', funnelOnly: false });
    // pending do Lucas: enriquecido com o funil SEM perder o nome bonito
    const pend = fs.__store.get('pending_affiliates').get('pending_lucasguimaraes_sportingbet');
    expect(pend.name).toBe('Lucas Guimarães');
    expect(pend.hasFunnelActivity).toBe(true);
    expect(pend.funnel.clicks).toBe(20);
  });

  describe('CRON /api/internal/analytics-refresh (sem token admin)', () => {
    afterEach(() => { delete process.env.RANKING_CRON_SECRET; });

    it('sem RANKING_CRON_SECRET no ambiente → 503', async () => {
      delete process.env.RANKING_CRON_SECRET;
      await request(buildApp({ seed })).post('/api/internal/analytics-refresh').expect(503);
    });

    it('secret ausente/errado → 401', async () => {
      process.env.RANKING_CRON_SECRET = 'right-cron';
      await request(buildApp({ seed })).post('/api/internal/analytics-refresh').expect(401);
      await request(buildApp({ seed })).post('/api/internal/analytics-refresh').set('x-cron-secret', 'wrong').expect(401);
    });

    it('secret certo → 200 ok + persiste o funil (scheduler, sem auth Firebase)', async () => {
      process.env.RANKING_CRON_SECRET = 'right-cron';
      const fetchImpl: any = async (url: string) => (String(url).includes('superbet') ? aresp(404, {}) : aresp(200, sbBody([LUCAS])));
      const fs = makeFirestore({ users: { 'admin-uid': { role: 'admin' } } });
      const app = createApp({ adminApp: makeAdminApp(), adminDb: fs, fetchImpl });
      const res = await request(app).post('/api/internal/analytics-refresh').set('x-cron-secret', 'right-cron').expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.persisted).toBe(1);
      expect(fs.__store.get('affiliate_analytics').get('lucasguimaraes__sportingbet')).toMatchObject({ clicks: 20, funnelOnly: true });
    });
  });
});

// =============================================================================
// GET /api/affiliate-analytics — leitura do funil escopada por papel
// =============================================================================
describe('GET /api/affiliate-analytics (escopo por papel)', () => {
  const seed = {
    users: { 'admin-uid': { role: 'admin' }, 'cli-uid': { role: 'client', affiliateId: 'AFF-1' } },
    affiliate_analytics: {
      joao__sportingbet: { affiliateId: 'AFF-1', nameKey: 'joao', clicks: 10 },
      maria__sportingbet: { affiliateId: 'AFF-2', nameKey: 'maria', clicks: 5 },
    },
  };

  it('sem token → 401', async () => {
    await request(buildApp({ seed })).get('/api/affiliate-analytics').expect(401);
  });

  it('admin vê o funil de todos', async () => {
    const res = await request(buildApp({ seed })).get('/api/affiliate-analytics').set('Authorization', 'Bearer admin-uid').expect(200);
    expect(res.body.analytics).toHaveLength(2);
  });

  it('afiliado vê só o próprio funil (por affiliateId) — não vaza o do outro', async () => {
    const res = await request(buildApp({ seed })).get('/api/affiliate-analytics').set('Authorization', 'Bearer cli-uid').expect(200);
    expect(res.body.analytics).toHaveLength(1);
    expect(res.body.analytics[0].affiliateId).toBe('AFF-1');
  });
});
