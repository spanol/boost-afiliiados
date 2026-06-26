# Spike — integrar a API v1 analítica da OTG (cliques + funil inicial)

> ## ✅ ENTREGUE (2026-06-25/26) — commits `4294b2f` → `78dfe4e` (6), 475 testes verdes
>
> A integração foi **implementada e validada ao vivo contra produção** (smoke test:
> `persisted:33, enrichedPending:33`, doc do Lucas confirmado na Firestore). O que ficou pronto:
>
> **Contrato real da API v1 (capturado ao vivo, não mais palpite):**
> - **Analytics:** `GET {BASE}/api/v1/agency/{casa}-analytics?initialDate&finalDate&scope=AFFILIATES&page&pageSize`
>   → `{data:{summary, rows:[{affiliate,clicks,registrations,ftd,cpa_qual,deposits,bet_amount,ngr}], meta:{totalPages,...}}}`.
>   `scope=AFFILIATES` (maiúsculo; `affiliate` dá 400). Só `sportingbet-analytics` existe — `superbet-analytics` dá **404** (tratado como casa indisponível). Casas em `GET /api/v1/betting-houses`.
> - **AUTH (resolvida):** NÃO é só token manual. `POST /api/v1/auth/login {email,password,deviceToken}` → `{data:{access_token (~15min), deviceToken}}`. O **`deviceToken`** (= localStorage `2fa:login.token`, JWT `type:"verified-2fa"`, **~8h**) PULA o 2FA. NÃO há refresh-token (o login É o refresh). O server loga sob demanda e cacheia o access_token. Carlos só troca o deviceToken a cada ~8h.
>
> **Construído:** `otgAnalyticsPull.ts` (login durável + pull resiliente por casa), `src/lib/otgAnalytics.ts` (mapper puro) + `src/lib/analyticsDoc.ts` (persistência pura); rotas `POST /api/analytics/refresh` (admin), `POST /api/internal/analytics-refresh` (cron, `requireCronSecret`), `GET /api/affiliate-analytics` (escopado por papel); coleção `affiliate_analytics` (admin-only) + enriquecimento dos `pending_affiliates`; UI: botão "Atualizar funil (v1)" no `/otg-roster`, card de cliques no `AffiliateDetails` + **degradação graciosa do crash do Lucas** (mostra o funil em vez de "Algo deu errado").
>
> **Env (server-only):** `OTG_DASH_API_BASE`, `OTG_DASH_EMAIL`, `OTG_DASH_PASSWORD`, `OTG_DASH_DEVICE_TOKEN` (`OTG_DASH_ACCESS_TOKEN` = override manual opcional). Ver `.env.example` + `apphosting.yaml`.
>
> **Pendências de operador (não-código):** criar os secrets de prod (`firebase apphosting:secrets:set otg-dash-{email,password,device-token} --data-file -`); `firebase deploy --only firestore:rules` (inclui `affiliate_analytics`); `git push` dos 6 commits; criar o Cloud Scheduler diário batendo em `/api/internal/analytics-refresh` (header `x-cron-secret` = `RANKING_CRON_SECRET`). O texto abaixo é o registro da investigação original.

**Data:** 2026-06-25 · **Gatilho:** "Lucas Guimarães" aparece com produção no dashboard da OTG mas o Boost o mostra como sem produção (e a tela de detalhes quebra). Investigação via interceptação do dashboard `partners.grupootg.com`.

## 1. Problema confirmado

O Boost integra com a **API v2 externa** (`affiliate-api-prd.partnersotg.com/api/v2/external/*`, auth por `x-api-key`). Essa API **só lista afiliados com produção COMISSIONADA** (CPA/comissão > 0). Um afiliado que só clicou/cadastrou — sem FTD/CPA — **não aparece**.

Caso real (verificado direto na OTG, junho/2026, casa SportingBet):

| Afiliado | Cliques | Cadastros | FTD | CPA qual. | Depósitos | Comissão |
|---|---|---|---|---|---|---|
| **Lucas Guimarães** | **20** | **4** | 0 | 0 | R$ 0 | R$ 0 |

→ Ele **existe** na v1 analítica da OTG, mas é **invisível** na v2 externa que consumimos. Consequências:
- A reconciliação (`reconcilePending`, casa por `nameKey|casa` contra o relatório v2) **nunca o pega** enquanto ele não comissionar → fica preso no id sintético `pending_<nameKey>_<casa>`.
- `AffiliateDetails` consulta os resultados pelo id sintético na v2 → vazio → **crash "Algo deu errado"** (degradação graciosa fica pendente).

## 2. O que o dashboard usa (interceptado)

O "Resultado Analítico" de `partners.grupootg.com` **não** usa a v2 externa. Usa a **API v1 da agência**:

- **Endpoint (por casa):** `GET /api/v1/agency/{casa}-analytics` — confirmado `sportingbet-analytics`; provável `superbet-analytics` análogo.
- **Params:** `initialDate`, `finalDate`, `scope`, `sortBy`, `sortDirection`, `page`, `pageSize` (datas `YYYY-MM-DD`).
- **Resposta:**
  ```jsonc
  { "statusCode": 200, "message": "Success", "data": {
      "summary": { "clicks": 5462, "registrations": 1264, "ftd": 484, "cpa_qual": 306,
                   "deposits": 25264.27, "bet_amount": 139602.89,
                   "ngr": 2172.39, "ngr_sports": -496.6, "ngr_casino": 2668.99, "ngr_poker": 0, "ngr_bingo": 0 },
      "rows": [ { "affiliate": "HelderDosSantosCavalheiro", "campaign": null,
                  "clicks": 164, "registrations": 47, "ftd": 12, "cpa_qual": 10,
                  "deposits": 4645.05, "bet_amount": 62332.32, "ngr": 1467.96 }, /* ... */ ] } }
  ```
  → Traz **CLIQUES, VALORES EM APOSTA (handle) e NGR** — os dados da Trilha C que a v2 não tem — **e inclui TODOS os afiliados** (até os só-clique como o Lucas).
- **Segundo endpoint** (aba campanha/série): `GET /api/v1/agency/...?initialDate&finalDate&bettingHouseId=` → `data:{ summary:{raw_commission, cpa, rvs, registrations, first_deposits, qualified_cpa, deposit}, campaigns:[...], timeSeries:[{date, registrations, first_deposits}], table:[...] }` (mesmo shape monetário da v2).

## 3. Autenticação (o ponto-chave)

Caracterizada por inspeção da sessão autenticada (sem extrair segredos):

- O request de analytics é **cross-origin** (host de API ≠ `partners.grupootg.com`) e responde **401 sem o header de auth** → usa **`Authorization: Bearer <JWT>`**, injetado pelo HTTP client do dashboard.
- O JWT vive no **localStorage** (não em cookie httpOnly) — `localStorage` tem ~4 chaves, uma é o token.
- **NÃO é Supabase** (`sb-*-auth-token` ausente, sem client supabase global) → é **auth custom da OTG**, diferente do backend de **provisionamento** (`links.otgpartners` → Supabase) que o `otgLinksPull.ts` já consome.

**Implicação central:** **não precisamos pedir uma nova API key à OTG** (como a Trilha C/§82 do INTEGRATION-PLAN supunha). A agência **já tem acesso à v1** pelo PRÓPRIO login do dashboard (creds do Carlos). Dá para automatizar server-side, igual já fazemos no provisionamento — só com um fluxo de login **diferente** (custom, não Supabase).

## 4. Abordagem de integração proposta

Espelhar o padrão do `otgLinksPull.ts`, com um **novo módulo server-side** (ex.: `otgAnalyticsPull.ts`):

1. **Login** (creds do Carlos em env/Secret Manager, ex.: `OTG_DASH_EMAIL`/`OTG_DASH_PASSWORD`) → `POST <login endpoint>` → **JWT** (access token).
2. **Pull** `GET {API_HOST}/api/v1/agency/{casa}-analytics?initialDate&finalDate&...` com `Authorization: Bearer <jwt>`, paginando.
3. **Persistir/merge**: gravar cliques/cadastros/FTD por afiliado×casa (coleção nova, ex.: `analytics_daily` ou estender `house_results`), e usar `nameKey|casa` para **reconciliar** afiliados só-funil (como o Lucas) que a v2 não enxerga.
4. **Expor** read-only via endpoint autenticado (escopado por papel, como os demais), para o `/admin` e a tela do afiliado mostrarem cliques/cadastros antes do CPA.
5. **Server-only** (Admin SDK + segredo no Secret Manager), nunca no browser. Núcleo puro (mapper) testável, como `mapApprovedRows`.

## 5. Pendências de operador (necessárias p/ implementar)

Não dá para extrair com segurança via automação (e o harness mascara segredos, corretamente). O operador (Carlos) precisa, **com o DevTools › Network aberto**, fazer **logout + login** em `partners.grupootg.com` e capturar (sanitizando o token):

1. **O request de LOGIN** — host + path + payload (campos) + shape da resposta (onde vem o JWT, se há `refresh_token`, e o **TTL** do access token).
2. **Um request de analytics** completo — **host da API**, e os **valores** de `scope`/`sortBy`/`sortDirection` (as chaves já temos; os valores foram bloqueados).
3. Confirmar se há **endpoint por casa** para cada casa (`superbet-analytics`?) ou um param `bettingHouseId`.
4. Fornecer as **creds do dashboard** do Carlos via Secret Manager (`OTG_DASH_*`), nunca no repo.

## 6. Riscos / decisões

- **TTL do JWT**: tokens de dashboard costumam expirar rápido (~1h, como o Supabase do provisionamento). Precisamos re-login/refresh no puller (igual `signIn()` por execução).
- **ToS/estabilidade**: é uma API **interna** (`/api/v1/agency`), não um contrato externo documentado — pode mudar sem aviso. Mitigar com mapper puro + testes + alarme de schema.
- **Sessões paralelas**: o provisionamento já provou que a OTG não derruba sessões paralelas (memória `boost-partner-api`); validar o mesmo p/ o dashboard.
- **Decisão de produto**: mostrar cliques/cadastros (funil) muda a leitura de "produção" no Boost — alinhar com o Carlos onde exibir (card de funil no /admin e na tela do afiliado).

## 7. Recomendação

Vale integrar — **desbloqueia a Trilha C inteira (cliques/handle/NGR) sem depender da OTG liberar nada**, reusando o padrão de "login com creds do Carlos" que já roda no provisionamento. Próximo passo concreto: operador captura o login + analytics (item §5), e então implementamos `otgAnalyticsPull.ts` + persistência + reconciliação por funil. Em paralelo, fazer a **degradação graciosa do `AffiliateDetails`** (não quebrar para afiliado fora da v2) como fix imediato independente.
