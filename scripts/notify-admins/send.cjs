#!/usr/bin/env node
// Dispara uma mensagem direta (popup 1:1 "Mensagem da gerência") aos admins do Boost.
// Espelha a forma do ranking-reminder do server.ts (coleção `direct_messages`,
// affiliateId:'system'); o popup é o DirectMessagePopup, montado no DashboardLayout,
// que escuta por recipientUid em tempo real. Pensado p/ anunciar uma RELEASE.
//
// Uso:
//   node scripts/notify-admins/send.cjs --title "..." --body "linha1\n\nlinha2"
//   node scripts/notify-admins/send.cjs --title "..." --body-file notes.md --to all
//   node scripts/notify-admins/send.cjs --title "..." --body "..." --to carlos@x.com,bruno@y.com --send
//
// Flags:
//   --title <txt>        (obrigatório) título do popup
//   --body  <txt>        corpo; use \n p/ quebras de linha       (ou --body-file)
//   --body-file <path>   lê o corpo de um arquivo (ex.: release notes)
//   --to <all|emails>    destinatários: "all" (todos os admins) ou lista por vírgula. Default: all
//   --id <slug>          id determinístico da mensagem (1 por release → re-run ATUALIZA).
//                        Default: slug do título. Doc id = `${id}__${uid}`.
//   --from <txt>         remetente exibido. Default: "Gerência Boost"
//   --send               GRAVA. Sem ela = dry-run (só lista quem receberia).
//
// Auth (mesma ordem do server.ts): FIREBASE_SERVICE_ACCOUNT_KEY (env/secret, p/ CI)
//   senão ../../service-account.json (local). Sem nenhum → erro.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { to: 'all', from: 'Gerência Boost', send: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--send') out.send = true;
    else if (a === '--title') out.title = next();
    else if (a === '--body') out.body = next();
    else if (a === '--body-file') out.bodyFile = next();
    else if (a === '--to') out.to = next();
    else if (a === '--id') out.id = next();
    else if (a === '--from') out.from = next();
    else { console.error(`Flag desconhecida: ${a}`); process.exit(2); }
  }
  return out;
}

const slugify = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'mensagem';

function initAdmin() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    return 'FIREBASE_SERVICE_ACCOUNT_KEY';
  }
  const saPath = path.resolve(__dirname, '../../service-account.json');
  if (fs.existsSync(saPath)) {
    admin.initializeApp({ credential: admin.credential.cert(require(saPath)) });
    return 'service-account.json';
  }
  console.error('Sem credencial: defina FIREBASE_SERVICE_ACCOUNT_KEY ou coloque service-account.json na raiz.');
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.title) { console.error('Faltou --title.'); process.exit(2); }
  const body = args.bodyFile ? fs.readFileSync(args.bodyFile, 'utf8') : String(args.body || '').replace(/\\n/g, '\n');
  if (!body.trim()) { console.error('Faltou --body ou --body-file.'); process.exit(2); }
  const msgId = args.id || slugify(args.title);

  const credSource = initAdmin();
  const db = admin.firestore();

  const adminsSnap = await db.collection('users').where('role', '==', 'admin').get();
  let admins = adminsSnap.docs.map((d) => ({ uid: d.id, email: d.data().email, name: d.data().name }));
  if (args.to !== 'all') {
    const allow = args.to.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    admins = admins.filter((a) => allow.includes(String(a.email || '').trim().toLowerCase()));
  }

  console.log(`\nAuth: ${credSource} | id: ${msgId} | de: ${args.from}`);
  console.log(`Destinatários (${admins.length}):`);
  admins.forEach((a) => console.log(`  - ${a.name || '(sem nome)'} <${a.email || '?'}>  uid=${a.uid}`));
  console.log(`\nTítulo: ${args.title}\nCorpo:\n${body.split('\n').map((l) => '  ' + l).join('\n')}`);

  if (!admins.length) { console.error('\nNenhum destinatário casou — nada a fazer.'); process.exit(1); }
  if (!args.send) { console.log('\n[DRY-RUN] Nada gravado. Rode de novo com --send para enviar.'); return; }

  let sent = 0;
  for (const a of admins) {
    await db.collection('direct_messages').doc(`${msgId}__${a.uid}`).set({
      recipientUid: a.uid,
      affiliateId: 'system',
      affiliateName: 'Sistema',
      title: args.title,
      body,
      createdByName: args.from,
      readAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    sent++;
  }
  console.log(`\n[SEND] Mensagem entregue a ${sent} admin(s).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
