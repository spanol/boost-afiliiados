// ============================================================================
// Exportar afiliados APROVADOS da OTG (sistema de provisionamento de links)
// ----------------------------------------------------------------------------
// CONTEXTO: a OTG tem DOIS backends separados:
//   1) Relatório (partners.grupootg.com + affiliate-api-prd / nossa x-api-key)
//      -> só lista afiliados que JÁ produziram; é o que o Boost lê hoje.
//   2) Provisionamento (links.otgpartners.com.br -> Supabase) -> tem o roster
//      REAL de aprovados (status=completed), mesmo antes de produzirem.
// Este script lê o (2) para gerar o snapshot de "aprovados" que usamos no
// PRÉ-CADASTRO manual no Boost, enquanto a OTG não expõe um id de relatório.
// A ponte entre os dois sistemas é o NOME normalizado (`nameKey`): a OTG deriva
// o `name` do relatório tirando espaços/acentos do `affiliate_name`. Ver
// memória [[boost-external-api-state]] (probes de 2026-06-15).
//
// COMO USAR (atualização manual):
//   1. Logar em https://links.otgpartners.com.br (conta da agência).
//   2. Abrir o DevTools (F12) -> aba Console, NESSA aba.
//   3. Colar TODO este arquivo e dar Enter.
//   4. Ele baixa `otg-approved-snapshot.json` (e também copia p/ a área de
//      transferência e loga no console como fallback).
//   5. Salvar o arquivo em scripts/otg-approved/snapshot-YYYY-MM-DD.json
//      (substituindo a data) e commitar.
//
// REQUISITOS: precisa de SESSÃO LOGADA (RLS bloqueia a anon key sozinha).
// Não há MFA neste app (login só senha) — ver memória.
// ============================================================================
(async () => {
  const ref = 'pxzqtmnegzygikwvdaqj';                 // projeto Supabase da OTG (links)
  const base = `https://${ref}.supabase.co/rest/v1/`;
  const authBase = `https://${ref}.supabase.co/auth/v1/`;

  // --- sessão (token) do localStorage; renova via refresh token se expirado ---
  let session = null;
  try { session = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`)); } catch (e) {}
  if (!session) { console.error('Sem sessão. Faça login em links.otgpartners.com.br e rode de novo.'); return; }
  let token = session.access_token;
  const expired = (t) => { try { return JSON.parse(atob(t.split('.')[1])).exp * 1000 < Date.now() + 5000; } catch (e) { return true; } };

  // --- anon key (pública): extraída do bundle do app ---
  const srcs = [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => s.includes('assets/'));
  let anon = null;
  for (const src of srcs) {
    try {
      const txt = await fetch(src).then(r => r.text());
      for (const cand of (txt.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [])) {
        try { const p = JSON.parse(atob(cand.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (p.role === 'anon' && p.ref === ref) { anon = cand; break; } } catch (e) {}
      }
    } catch (e) {}
    if (anon) break;
  }
  if (!anon) { console.error('Não achei a anon key no bundle.'); return; }

  if (token && expired(token) && session.refresh_token) {
    const rr = await fetch(`${authBase}token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(r => r.json());
    if (rr.access_token) token = rr.access_token;
  }
  const headers = { apikey: anon, Authorization: `Bearer ${token}` };

  // nameKey = chave de reconciliação com o relatório (sem espaço/acento, minúsculo)
  const norm = (str) => (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // --- puxa todos os APROVADOS (status=completed) ---
  const cols = 'id,batch_id,affiliate_name,betting_house,status,email,phone,social_link,delivered_urls,delivered_at';
  const raw = await fetch(`${base}link_requests?select=${cols}&status=eq.completed&order=betting_house.asc,affiliate_name.asc&limit=5000`, { headers }).then(r => r.json());
  if (!Array.isArray(raw)) { console.error('Falha na consulta:', raw); return; }

  const rows = raw.map(r => ({
    name: (r.affiliate_name || '').trim(),
    nameKey: norm(r.affiliate_name),               // <- ponte com o relatório/API
    house: r.betting_house,
    email: r.email || null,
    phone: r.phone || null,
    social: r.social_link || null,
    registerUrl: (r.delivered_urls && r.delivered_urls[0] && r.delivered_urls[0].url) || null,
    deliveredAt: r.delivered_at,
    requestId: r.id,
    batchId: r.batch_id,
  }));
  const byHouse = rows.reduce((a, r) => { a[r.house] = (a[r.house] || 0) + 1; return a; }, {});
  const snapshot = {
    generatedAt: new Date().toISOString(),
    agencyId: 'd13641b9-3199-4122-a7fe-a546d7d159c7',
    source: 'links.otgpartners.com.br · link_requests · status=completed',
    total: rows.length,
    byHouse,
    rows,
  };
  const json = JSON.stringify(snapshot, null, 2);

  // baixa o arquivo
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = 'otg-approved-snapshot.json';
  document.body.appendChild(a); a.click(); a.remove();
  // fallbacks: clipboard + console
  try { await navigator.clipboard.writeText(json); console.log('Snapshot também copiado p/ a área de transferência.'); } catch (e) {}
  console.log(`Aprovados: ${rows.length}`, byHouse);
  console.log(json);
  return snapshot;
})();
