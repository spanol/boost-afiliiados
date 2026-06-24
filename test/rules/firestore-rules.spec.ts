/**
 * Suíte de regressão de `firestore.rules` contra o emulator do Firestore.
 *
 * Tese (REVIEW-TEST-PLAN.md §0.1 / P0.8): a superfície de segurança vivia 100%
 * sem teste. Os fixes R5 (affiliate_configs deixa de ser legível por qualquer
 * signed-in) e R6 (update de users trava role/affiliateId/isSpecial) precisam de
 * uma rede de regressão que FALHE se alguém reabrir a brecha — não um POC
 * "vulnerável vs patched" (o patch JÁ está no arquivo real), mas asserções
 * diretas sobre o `firestore.rules` deployado afirmando o comportamento SEGURO.
 *
 * Pré-requisito: emulator do Firestore no ar. Rodado por `npm run test:rules`
 * (firebase emulators:exec sobe o emulator e injeta FIRESTORE_EMULATOR_HOST).
 * Fora do glob `src/**` → `npm test` nunca tenta rodar sem o emulator.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, afterAll, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-boost-rules-test';
// Lê as regras REAIS do projeto — a regressão é contra o que vai a produção.
const RULES = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

const ADMIN_UID = 'admin-uid';
const CLIENT_UID = 'client-uid';
const OTHER_UID = 'other-uid';

let env: RulesTestEnvironment;

// --- helpers -----------------------------------------------------------------
async function withDisabled(fn: (db: any) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore());
  });
}
async function seedDoc(path: string, id: string, data: Record<string, unknown>) {
  await withDisabled(async (db) => {
    await setDoc(doc(db, path, id), data);
  });
}
async function seedAdmin() {
  // isAdmin() faz get(users/{uid}); o doc precisa existir com role:'admin'.
  await seedDoc('users', ADMIN_UID, { uid: ADMIN_UID, role: 'admin' });
}
function asAdmin() {
  return env.authenticatedContext(ADMIN_UID).firestore();
}
function asClient(uid: string = CLIENT_UID) {
  return env.authenticatedContext(uid).firestore();
}
function asAnon() {
  return env.unauthenticatedContext().firestore();
}

const VALID_CONTACT = {
  name: 'Fulano',
  email: 'fulano@example.com',
  phone: '+5511999999999',
  socialMedia: '@fulano',
  affiliateExperience: 'sim',
  presentation: 'Quero ser afiliado.',
  createdAt: Date.now(),
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
});

afterAll(async () => {
  await env?.cleanup();
});

// =============================================================================
// users/{uid} — create/update travados (R6 + privesc de role no self-create)
// =============================================================================
describe('users/{uid}', () => {
  it('create: self como client (uid coerente, sem campos de confiança) → OK', async () => {
    const db = asClient();
    await assertSucceeds(
      setDoc(doc(db, 'users', CLIENT_UID), { uid: CLIENT_UID, role: 'client' }),
    );
  });

  it('create: self forjando role:admin → NEGADO (privesc)', async () => {
    const db = asClient();
    await assertFails(
      setDoc(doc(db, 'users', CLIENT_UID), { uid: CLIENT_UID, role: 'admin' }),
    );
  });

  it('create: self client mas com affiliateId → NEGADO (campo server-only)', async () => {
    const db = asClient();
    await assertFails(
      setDoc(doc(db, 'users', CLIENT_UID), {
        uid: CLIENT_UID,
        role: 'client',
        affiliateId: 'AFF-1',
      }),
    );
  });

  it('create: self client mas com isSpecial → NEGADO (campo server-only)', async () => {
    const db = asClient();
    await assertFails(
      setDoc(doc(db, 'users', CLIENT_UID), {
        uid: CLIENT_UID,
        role: 'client',
        isSpecial: true,
      }),
    );
  });

  it('create: uid do payload diverge do {userId} da rota → NEGADO', async () => {
    const db = asClient();
    await assertFails(
      setDoc(doc(db, 'users', CLIENT_UID), { uid: OTHER_UID, role: 'client' }),
    );
  });

  it('create: doc de OUTRO uid → NEGADO', async () => {
    const db = asClient();
    await assertFails(
      setDoc(doc(db, 'users', OTHER_UID), { uid: OTHER_UID, role: 'client' }),
    );
  });

  it('read: próprio doc → OK; doc de outro como não-admin → NEGADO', async () => {
    await seedDoc('users', CLIENT_UID, { uid: CLIENT_UID, role: 'client' });
    await seedDoc('users', OTHER_UID, { uid: OTHER_UID, role: 'client' });
    const db = asClient();
    await assertSucceeds(getDoc(doc(db, 'users', CLIENT_UID)));
    await assertFails(getDoc(doc(db, 'users', OTHER_UID)));
  });

  it('read/list: admin lê qualquer doc e lista a coleção; client NÃO lista', async () => {
    await seedAdmin();
    await seedDoc('users', OTHER_UID, { uid: OTHER_UID, role: 'client' });
    await assertSucceeds(getDoc(doc(asAdmin(), 'users', OTHER_UID)));
    await assertSucceeds(getDocs(collection(asAdmin(), 'users')));
    await assertFails(getDocs(collection(asClient(), 'users')));
  });

  it('update: self muda só o nome (role/affiliateId/isSpecial intactos) → OK', async () => {
    await seedDoc('users', CLIENT_UID, {
      uid: CLIENT_UID,
      role: 'client',
      affiliateId: 'AFF-1',
      isSpecial: false,
      name: 'Antigo',
    });
    await assertSucceeds(
      updateDoc(doc(asClient(), 'users', CLIENT_UID), { name: 'Novo' }),
    );
  });

  it('update: self tenta virar admin → NEGADO', async () => {
    await seedDoc('users', CLIENT_UID, {
      uid: CLIENT_UID,
      role: 'client',
      affiliateId: 'AFF-1',
      isSpecial: false,
    });
    await assertFails(
      updateDoc(doc(asClient(), 'users', CLIENT_UID), { role: 'admin' }),
    );
  });

  it('update: self tenta se reapontar a outro affiliateId (IDOR) → NEGADO', async () => {
    await seedDoc('users', CLIENT_UID, {
      uid: CLIENT_UID,
      role: 'client',
      affiliateId: 'AFF-1',
      isSpecial: false,
    });
    await assertFails(
      updateDoc(doc(asClient(), 'users', CLIENT_UID), { affiliateId: 'AFF-9' }),
    );
  });

  it('update: self tenta se auto-marcar isSpecial:true → NEGADO (R6)', async () => {
    await seedDoc('users', CLIENT_UID, {
      uid: CLIENT_UID,
      role: 'client',
      affiliateId: 'AFF-1',
      isSpecial: false,
    });
    await assertFails(
      updateDoc(doc(asClient(), 'users', CLIENT_UID), { isSpecial: true }),
    );
  });

  it('update/delete: admin faz qualquer coisa; client não deleta o próprio doc', async () => {
    await seedAdmin();
    await seedDoc('users', CLIENT_UID, {
      uid: CLIENT_UID,
      role: 'client',
      affiliateId: 'AFF-1',
      isSpecial: false,
    });
    await assertSucceeds(
      updateDoc(doc(asAdmin(), 'users', CLIENT_UID), { isSpecial: true }),
    );
    await assertFails(deleteDoc(doc(asClient(), 'users', CLIENT_UID)));
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'users', CLIENT_UID)));
  });
});

// =============================================================================
// affiliate_configs — R5: taxas (dado comercial) NÃO legível por signed-in
// =============================================================================
describe('affiliate_configs/{id} (R5 — taxas mediadas pelo servidor)', () => {
  beforeEach(async () => {
    await seedDoc('affiliate_configs', 'AFF-1', { cpaValue: 200, revPercentage: 30 });
  });

  it('client NÃO lê a config de ninguém (nem a própria, direto)', async () => {
    await assertFails(getDoc(doc(asClient(), 'affiliate_configs', 'AFF-1')));
  });

  it('client NÃO lista a coleção inteira (era o vetor do R5)', async () => {
    await assertFails(getDocs(collection(asClient(), 'affiliate_configs')));
  });

  it('client NÃO escreve config', async () => {
    await assertFails(
      setDoc(doc(asClient(), 'affiliate_configs', 'AFF-1'), { cpaValue: 999 }),
    );
  });

  it('admin lê e escreve config', async () => {
    await seedAdmin();
    await assertSucceeds(getDoc(doc(asAdmin(), 'affiliate_configs', 'AFF-1')));
    await assertSucceeds(
      setDoc(doc(asAdmin(), 'affiliate_configs', 'AFF-2'), { cpaValue: 100 }),
    );
  });
});

// =============================================================================
// Coleções admin-only — leitura/escrita do cliente sempre NEGADA
// (PII de pagamento, logs, casas, resultados manuais, links, partner keys)
// =============================================================================
describe('coleções admin-only (servidor via Admin SDK; client direto negado)', () => {
  const ADMIN_ONLY = [
    'payment_profiles',
    'affiliate_statuses',
    'audit_logs',
    'affiliate_links',
    'link_clicks',
    'link_click_stats',
    'houses',
    'house_results',
    'api_partners',
  ];

  for (const col of ADMIN_ONLY) {
    it(`${col}: client não lê nem escreve; admin lê`, async () => {
      await seedDoc(col, 'X1', { secret: 'top', pixKey: '123' });
      await assertFails(getDoc(doc(asClient(), col, 'X1')));
      await assertFails(getDocs(collection(asClient(), col)));
      await assertFails(setDoc(doc(asClient(), col, 'X2'), { x: 1 }));
      await seedAdmin();
      await assertSucceeds(getDoc(doc(asAdmin(), col, 'X1')));
    });
  }
});

// =============================================================================
// Coleções legíveis por signed-in (leitura ok; escrita só admin)
// =============================================================================
describe('coleções legíveis por signed-in (escrita só admin)', () => {
  const SIGNED_IN_READ = [
    'affiliates',
    'special_affiliates',
    'settings',
    'notices',
    'daily_rankings',
  ];

  for (const col of SIGNED_IN_READ) {
    it(`${col}: client lê; client NÃO escreve; admin escreve`, async () => {
      await seedDoc(col, 'X1', { foo: 'bar' });
      await assertSucceeds(getDoc(doc(asClient(), col, 'X1')));
      await assertFails(setDoc(doc(asClient(), col, 'X2'), { foo: 'baz' }));
      await seedAdmin();
      await assertSucceeds(setDoc(doc(asAdmin(), col, 'X3'), { foo: 'qux' }));
    });
  }

  it('signed-in read exige login: anônimo NÃO lê affiliates', async () => {
    await seedDoc('affiliates', 'X1', { name: 'Casa' });
    await assertFails(getDoc(doc(asAnon(), 'affiliates', 'X1')));
  });
});

// =============================================================================
// direct_messages — leitura escopada ao destinatário (recipientUid == uid)
// =============================================================================
describe('direct_messages/{id} (escopo por destinatário)', () => {
  beforeEach(async () => {
    await seedDoc('direct_messages', 'M1', {
      recipientUid: CLIENT_UID,
      body: 'oi',
    });
  });

  it('destinatário lê a própria mensagem → OK', async () => {
    await assertSucceeds(getDoc(doc(asClient(), 'direct_messages', 'M1')));
  });

  it('outro afiliado logado NÃO lê mensagem alheia → NEGADO', async () => {
    await assertFails(getDoc(doc(asClient(OTHER_UID), 'direct_messages', 'M1')));
  });

  it('anônimo NÃO lê → NEGADO', async () => {
    await assertFails(getDoc(doc(asAnon(), 'direct_messages', 'M1')));
  });

  it('client NÃO escreve direct_messages; admin escreve', async () => {
    await assertFails(
      setDoc(doc(asClient(), 'direct_messages', 'M2'), { recipientUid: CLIENT_UID }),
    );
    await seedAdmin();
    await assertSucceeds(
      setDoc(doc(asAdmin(), 'direct_messages', 'M3'), { recipientUid: OTHER_UID }),
    );
  });
});

// =============================================================================
// contacts — create público restrito ao shape; leitura só admin
// =============================================================================
describe('contacts/{id} (create público restrito ao shape)', () => {
  it('anônimo cria com o shape válido completo → OK', async () => {
    await assertSucceeds(
      setDoc(doc(asAnon(), 'contacts', 'C1'), { ...VALID_CONTACT }),
    );
  });

  it('create com chave extra (hasOnly) → NEGADO', async () => {
    await assertFails(
      setDoc(doc(asAnon(), 'contacts', 'C2'), { ...VALID_CONTACT, role: 'admin' }),
    );
  });

  it('create com affiliateExperience fora de [sim,nao] → NEGADO', async () => {
    await assertFails(
      setDoc(doc(asAnon(), 'contacts', 'C3'), {
        ...VALID_CONTACT,
        affiliateExperience: 'talvez',
      }),
    );
  });

  it('create com presentation acima de 2000 chars → NEGADO', async () => {
    await assertFails(
      setDoc(doc(asAnon(), 'contacts', 'C4'), {
        ...VALID_CONTACT,
        presentation: 'x'.repeat(2001),
      }),
    );
  });

  it('create com tipo errado (name número) → NEGADO', async () => {
    await assertFails(
      setDoc(doc(asAnon(), 'contacts', 'C5'), { ...VALID_CONTACT, name: 123 }),
    );
  });

  it('leitura de contacts: client NEGADO; admin OK', async () => {
    await seedDoc('contacts', 'C6', { ...VALID_CONTACT });
    await assertFails(getDoc(doc(asClient(), 'contacts', 'C6')));
    await seedAdmin();
    await assertSucceeds(getDoc(doc(asAdmin(), 'contacts', 'C6')));
  });
});
