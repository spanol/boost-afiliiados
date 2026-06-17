// ============================================================================
// Emite uma API key de PARCEIRO (M2M) para a API read-only da Boost.
// ----------------------------------------------------------------------------
// Guarda só o HASH (sha-256) em api_partners/{id}; a key CRUA é mostrada UMA vez
// aqui (não fica salva em lugar nenhum). Entregue a key ao parceiro por canal
// seguro. Ele autentica enviando o header `x-boost-api-key: <key>`.
//
// Auth do Admin SDK (igual ao server.ts): usa FIREBASE_SERVICE_ACCOUNT_KEY se
// presente, senão as credenciais default (GOOGLE_APPLICATION_CREDENTIALS=
// ./service-account.json). Rode da raiz do repo.
//
// USO:
//   node scripts/partners/create-partner.mjs "Nome do Parceiro" [scopes]
//   # scopes (csv): pending-affiliates,affiliates,results  (ou "*" = tudo)
//   # default: pending-affiliates  (o dado-chave da integração)
//
// Ex.:  node scripts/partners/create-partner.mjs "ParceiroX" pending-affiliates,affiliates
// ============================================================================
import 'dotenv/config';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import admin from 'firebase-admin';

const name = process.argv[2];
const scopesArg = process.argv[3] || 'pending-affiliates';
if (!name) {
  console.error('Uso: node scripts/partners/create-partner.mjs "Nome do Parceiro" [scopes csv|*]');
  process.exit(1);
}
const scopes = scopesArg.trim() === '*' ? ['*'] : scopesArg.split(',').map((s) => s.trim()).filter(Boolean);

// init admin (mesma lógica do server.ts)
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
} else {
  try {
    const sa = JSON.parse(readFileSync('./service-account.json', 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } catch {
    admin.initializeApp(); // ADC (GOOGLE_APPLICATION_CREDENTIALS)
  }
}
const db = admin.firestore();

// key crua: prefixo legível + 32 bytes aleatórios em base64url
const raw = `bsk_${crypto.randomBytes(32).toString('base64url')}`;
const keyHash = crypto.createHash('sha256').update(raw).digest('hex');

const ref = await db.collection('api_partners').add({
  name,
  keyHash,
  scopes,
  active: true,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  lastUsedAt: null,
});

console.log('\n✅ Parceiro criado.');
console.log('   id      :', ref.id);
console.log('   nome    :', name);
console.log('   scopes  :', scopes.join(', '));
console.log('\n🔑 API KEY (copie agora — não será mostrada de novo):\n');
console.log('   ' + raw + '\n');
console.log('   O parceiro envia no header:  x-boost-api-key: ' + raw + '\n');
process.exit(0);
