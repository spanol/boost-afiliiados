# Plano de Revisão Total + Testes — Plataforma Agência Boost

## 0. Status de execução — Fase 1 (money-math) · 2026-06-24

**Entregue** (commits `f7d05d7`, `4e58ec5`, `13c1c21`; 190 testes verdes, lint limpo):

- **NaN no dinheiro (P0.1):** `calcAffiliatePayout`/`calcNetProfit`/`calcAgencyNetProfit`/`calcNetProfitByHouse` agora coagem `qualified_cpa`/`rvs`/`total_commission` com `num()` antes de multiplicar — string não-numérica da API (`'2,5'`) não vira mais NaN. ✓ testado.
- **Ausência ≠ R$0 (P0.2/P0.9):** extraída `rateStatus(config, brandId)` como **fonte única** da regra a0dc467; aplicada na **ClientDashboard** (bug R1 crítico — a view do próprio afiliado mostrava "Configurado"/`R$0` fixo) e na AffiliateDetails (troca a heurística inline). ✓ testado.
- **0 fantasma (finding #8):** `buildBrandConfigTopPayload` faz o BrandConfigEditor gravar só taxas configuradas; editar só o REV não cria mais `cpaValue:0`. `saveAffiliateConfig` aceita payload parcial. ✓ testado.
- **Invariante agregado==Σcards sob filtro (R8):** `composeAdminProfit` unifica headline + cards por casa da MESMA base escopada; o `base` dos cards passou a respeitar o `brandFilter`. Preserva comportamento em "Todas as casas"; corrige o caminho com filtro. ✓ testado COM byBrand, filtro, órfão e casas manuais.

**Fase 1.1 ENTREGUE** (commits `fe01de4`, `cac8f9a`; 220 testes) — fecha a classe byBrand em R2/R9/R10 com a atribuição afiliado→casa (cada afiliado pertence à sua casa via `brand`), MESMO modelo do `houseOf`/`calcNetProfitByHouse` do /admin:

- **`src/lib/commission.ts` (NOVO, puro, sem firebase):** núcleo de comissão (num/resolveBrandRates/rateStatus/calcAffiliatePayout/calcNetProfit) movido p/ fora do affiliateService (que importa o firebase client) e re-exportado — agora o `server.ts` reusa a MESMA fórmula. `src/lib/brand.ts` ganha `buildBrandIdOf` (afiliado→brandId).
- **R2** (`server.ts` ranking): `src/lib/ranking.ts` `computeRankingEntries` (puro) reusa `calcAffiliatePayout` + aplica byBrand pelo brandId do afiliado (mirror). Antes reimplementava só com a taxa de topo.
- **R9** (AffiliateDetails "lucro"): direto + spread da rede passam o brandId de cada afiliado.
- **R10** (SpecialDashboard/SpecialSubAffiliates): `ownConfig` preserva byBrand; payouts/spread/split CPA-REV aplicam a taxa por casa.
- Passar `brandId` é **no-op** p/ afiliado sem override byBrand → sem regressão (validado no app: lucro de afiliado sem byBrand inalterado). O efeito byBrand fica coberto por unit test (sem afiliado byBrand+produção nos dados p/ ver em tela; o editor multi-casa é dev-gated). `server.ts` (R2) precisa reiniciar p/ valer.

## 0.1 Status — Fase 2 (segurança/escopo) · em andamento

**Entregue** (commit `48167d5`; 209 testes verdes):
- **`src/lib/scope.ts` (puro) + 19 testes** — primeiro teste no núcleo do `server.ts` (superfície que estava 100% sem cobertura).
  - `resolveScopedAffiliateIds` trava o **R4** (IDOR do proxy `/api/external`): comum só lê o próprio id, especial lê a sub-rede, id fora do escopo é descartado.
  - `resolveIsSpecial` unifica a definição (`active === true`) — fecha **R7** (o site de Vincular Login usava `active !== false` e divergia).
  - `resolveServerToday` (fuso America/Sao_Paulo) — fecha **R12** (ranking gravado/lido com data UTC errada à noite BR).
- `server.ts` wireado às 3. **Validado em tela** após reiniciar o processo: /admin idêntico (R$ 46.423,38), /ranking renderiza com data BR e estado vazio certo.
- **R5 fechado** (commit `203b127`): `affiliate_configs` não é mais legível por qualquer signed-in. Novo `GET /api/affiliate-configs` (requireAuth, Admin SDK) escopa por papel (admin=todas; afiliado=própria+sub-rede via `resolveIsSpecial`); `fetchAffiliateConfigs()` passou a usá-lo (assinatura igual, páginas inalteradas); rule virou admin-only. Validado no app (admin: repasse/lucro corretos via endpoint; 401 sem token).
- **R6 fechado** (commit `d5bccbc`): a rule de update de `users/{uid}` agora trava `isSpecial` (além de role/affiliateId) — cliente não se auto-marca especial.
- **R17 fechado** (commit `d5bccbc`): `AffiliateDetailsRoute` em `App.tsx` — admin vê qualquer afiliado, especial passa (proxy escopa os dados), comum só o próprio id. Validado no app (admin sem regressão).
- ⚠️ **PENDE `firebase deploy --only firestore:rules`** p/ R5+R6 valerem em produção (ação do operador; não rodo deploy de prod).

**Pendente na Fase 2:** testes de `firestore.rules` (emulator) e de rotas Express (supertest + `createApp(deps)`).

Demais fases (3 services, 4 páginas, 5 tooling) seguem como abaixo.

---

## 1. Resumo executivo

A confiabilidade da plataforma está estruturalmente comprometida por um descasamento entre **onde o risco mora** e **onde os testes medem**. As funções puras de dinheiro em `src/lib` e `src/services/affiliateService.ts` estão bem cobertas (lib 87%), mas a *cola* que escolhe taxa (byBrand vs topo), distingue ausência-de-config de R$0, e garante o invariante "agregado == Σ dos cards" vive embutida em **páginas (`src/pages/**`, ~5000 linhas, 0 testes)** e em **`server.ts` (1880 linhas, 0 testes de rota)** — exatamente os dois arquivos que `vitest.config.ts` **exclui da métrica de cobertura** (`coverage.include` lista só `src/lib`, `src/services`, `src/components`). Os dois bugs já corrigidos (a0dc467 ausência≠zero; 7c1c830 byBrand-vs-topo) nasceram aí, e a caça adversarial confirma que **a mesma classe ainda está aberta** em pelo menos 5 superfícies (ClientDashboard, BrandConfigEditor, AffiliateDetails "lucro", SpecialDashboard, e o ranking server-side). Tese central: **a cobertura mede o lugar errado; a classe de bug que escapa é money-math + resolução de taxa + escopo-por-papel vivendo em páginas/server não cobertos.** Enquanto a detecção de ausência e a seleção de taxa não forem extraídas para funções puras testadas e reusadas por todos os call-sites, cada tela nova reintroduz o bug.

---

## 2. Baseline de cobertura

| Escopo | Cobertura medida | Observação |
|---|---|---|
| Overall (stmts) | **29,71%** | Enganoso — ver furo abaixo |
| `src/lib/**` | **87,48%** | Funções puras, bem testadas |
| `src/services/**` | **19,48%** | `affiliateService` 25,53%; `contactService`/`directMessageService`/`noticeService`/`rankingService` **0%**; `houseService` 3,57% |
| `src/components/**` | **12,48%** | Só `BrandFilter`/`BrandLogo`/`DateRangePicker`; resto 0% |
| `src/pages/**` | **fora da métrica** | ~5000 linhas, 0 testes — **NÃO entra no coverage** |
| `server.ts` (raiz) | **fora da métrica** | 1880 linhas, 0 testes — **NÃO entra no coverage** |
| Total suíte | 171 testes verdes (vitest v8) | — |

**O furo da config** (`vitest.config.ts:23-27`): `coverage.include = ['src/lib/**','src/services/**','src/components/**']`. As duas superfícies de maior risco — dinheiro nas páginas e auth/escopo no `server.ts` — **reportam como inexistentes, não como 0%**. O 29,71% mascara justamente onde a classe de bug auditada acontece. Arquivos grandes sem teste: `server.ts` 1880, `affiliateService.ts` 1339 (parcial), `AffiliateDetails.tsx` 1285, `AffiliatesList.tsx` 983, `Houses.tsx` 824, `Home.tsx` 649, `AdminDashboard.tsx` 595, `SpecialSubAffiliates.tsx` 426, `ClientDashboard.tsx` 406, `SpecialDashboard.tsx` 394.

---

## 3. Registro de riscos (priorizado)

| # | Área | Classe de bug | Sev. | Por que os testes não pegaram |
|---|---|---|---|---|
| R1 | **ClientDashboard mostra R$0 como taxa real + badge "Configurado" fixo** (`ClientDashboard.tsx:219-241`) — a0dc467 nunca foi aplicado na view do próprio afiliado | absence-vs-zero | **CRÍTICA** | Fix aplicado só em `AffiliateDetails`; página fora do `coverage.include`. O afiliado vê o próprio dinheiro errado |
| R2 | **Ranking diário server-computed usa taxa de TOPO, ignora byBrand** (`server.ts:740-751`) — leaderboard público diverge dos dashboards | money-math / byBrand-vs-topo / absence-vs-zero | **CRÍTICA** | Fórmula reimplementada inline na rota; `server.ts` fora da métrica e sem teste. A fórmula correta (`resolveBrandRates`) só é testada no service, nunca toca a versão do ranking |
| R3 | **`calcAffiliatePayout` propaga NaN com métrica string** (`affiliateService.ts:684-688`, `(result?.qualified_cpa \|\| 0) * cpaValue` sem `Number()`) — API externa manda `'2.400,50'`/`'R$ 100'` | money-math / NaN-propagation | **CRÍTICA** | Todos os testes passam métrica como number literal; coerção implícita do JS esconde o caso para inteiros |
| R4 | **Escopo IDOR no proxy `/api/external`** (`server.ts:1143-1175`, `resolveScopedAffiliateIds`) — barreira que impede afiliado ler dinheiro de outro | role-scoping/IDOR | **CRÍTICA** | Lógica embutida na rota; sem supertest, sem mock de `firebase-admin` |
| R5 | **`affiliate_configs` legível por qualquer signed-in** (`firestore.rules:50-53`) — `fetchAffiliateConfigs()` lê a coleção inteira; cliente baixa CPA/REV/byBrand de TODOS | role-scoping (PII comercial) | **ALTA** | `firestore.rules` sem teste no suíte; POCs em `.security-pocs/` fora do glob |
| R6 | **`firestore.rules` update de `users/{uid}` não trava `isSpecial`** (`firestore.rules:36-39` pina role+affiliateId, omite isSpecial) — client se auto-marca especial | role-scoping (privesc parcial) | **ALTA** | Nenhum teste de rules no suíte; POC cobre só CREATE de role admin |
| R7 | **`isSpecial` calculado de 3 jeitos divergentes** (`server.ts:1082` `active===true` vs `:412` `active!==false` vs proxy `special?.active`) — doc sem campo `active` diverge | absence-vs-default | **ALTA** | Lógica espelhada inline em 3 rotas, sem teste; só aparece com doc sem `active` (Eliakim/Bruno em prod) |
| R8 | **Lucro da agência ≠ Σ cards sob `brandFilter`** (`AdminDashboard.tsx:233-276`: topo usa `scopedResults`/`manualScoped`, `houseBreakdown` usa `results`/`brandRows`/`manualRows` NÃO escopados) | money-math / consistency-invariant | **ALTA** | Invariante testada no service só com `houseOf` passado; o wiring do filtro vive no `useMemo` da página não testada |
| R9 | **Card "Lucro líquido do afiliado" ignora byBrand e filtro de casa** (`AffiliateDetails.tsx:426-435`, `calcAffiliatePayout` sem brandId) | money-math / byBrand-vs-topo | **ALTA** | Cálculo inline (IIFE) na página; contradiz o "CPA Calculado" da mesma tela |
| R10 | **SpecialDashboard/SpecialSubAffiliates dropam byBrand no `ownConfig`** (`SpecialDashboard.tsx:89-93`; `SpecialSubAffiliates.tsx:81-85`) — ganho do especial diverge do que o /admin cobra | money-math / byBrand-vs-topo | **ALTA** | `ownConfig` reconstruído sem `byBrand`; lógica de spread duplicada em 3 páginas, nenhuma testada |
| R11 | **Spread do especial sem clamp ≥0** (`SpecialSubAffiliates.tsx:273`, `SpecialDashboard.tsx:121-125`) — sub com taxa > pai → "Seu ganho" negativo; teto só no input client | money-math / validation | **ALTA** | Teto validado só em `server.ts` (sem teste); input client é cosmético/bypassável |
| R12 | **Ranking usa "hoje" em UTC** (`server.ts:699`, `new Date().toISOString().slice(0,10)`) — Cloud Run UTC corta o dia errado p/ America/Sao_Paulo (21h-23:59) | timezone-date / absence-vs-zero (estado) | **ALTA** | `server.ts` fora da métrica; cliente usa data local → "ainda não calculado" espúrio. `toISODate` existe mas o servidor não usa |
| R13 | **`requireAuth`/`requireAdmin` fail-closed + role mutável** (`server.ts:85-105`) — role deriva de `users/{uid}.role` | role-scoping | **ALTA** | Middlewares sem mock de `firebase-admin`/`verifyIdToken`; nenhuma infra exercita `verifyBearer` |
| R14 | **`AuthContext` não reseta `loading` no swap de usuário** (`AuthContext.tsx:33-67`) — profile do usuário anterior + loading=false → ProtectedRoute roteia com papel errado | realtime-state / role-scoping | **ALTA** | `AuthContext` 0 testes; subscribe/unsubscribe com firebase mockado nunca simulado |
| R15 | **`BrandConfigEditor` persiste `cpaValue:0` fantasma** (`BrandConfigEditor.tsx:96-123`) — edita só REV com topo CPA ausente → grava 0, "ausente" vira "0 real" no banco | absence-vs-zero (escrita) | **ALTA** | Componente fora dos testados; converte o estado que a0dc467 distinguia |
| R16 | **Escopo de `house-results`** (`server.ts:1593-1595`) — afiliado deve ver só linhas próprias, nunca o agregado (`affiliateId null` = total da casa) | data-scoping | ALTA | Filtro inline na rota; caso "agregado vaza" nunca exercitado |
| R17 | **`/affiliates/:id` sem guard de papel** (`App.tsx:140`) — client navega para id de outro e vê nome/marca/siteId (R$ protegido pelo proxy) | role-scoping (identidade) | MÉDIA | Rota sem `role`; `affiliates` read `if isSignedIn()`. Combinado com R5 cruza nome→taxa |
| R18 | **Spread trata sub sem config como taxa 0** (`SpecialSubAffiliates.tsx:273`) — especial fica com 100% de spread sobre sub recém-vinculado | absence-vs-zero | MÉDIA | Depende de regra de negócio (confirmar com Carlos); lógica inline sem teste |
| R19 | **`fetchResultsGrouped` extrai array com lógica própria** (`affiliateService.ts:387-388`) divergente de `extractArray` | data-shape | MÉDIA | Função async privada, 0 testes; só `extractArray` é testada |
| R20 | **Convite público TTL/single-use/anti-enumeração** (`accept-invite`/`invites`) — rotas públicas criam usuários reais | validation / role-scoping | MÉDIA | Rotas em `server.ts` sem supertest; rate limiter nunca exercitado |
| R21 | **`isNoticeForUser` sem teste** (`noticeService.ts`) — decide audiência (specials/clients/all) | role-scoping | MÉDIA | `noticeService` 0% coverage; função pura e trivial, mas nunca testada |
| R22 | **`createDailyRanking`/`subscribeToDailyRanking` null-vs-vazio** (`rankingService.ts`) — "não calculado" vs "ninguém pontuou" | absence-vs-zero (estado UI) | MÉDIA | Service 0% coverage; onSnapshot nunca exercitado |
| R23 | **Profile: `mustChangePassword:false` gravado ANTES de `updatePassword`** (`Profile.tsx:109-114`) — se updatePassword falha, usuário escapa do gate sem trocar senha | data-shape | MÉDIA | Encadeamento em `Profile.tsx` (0 testes) |
| R24 | **Import Houses — `canImport` e payload `ResolvedRow→` decididos na página** (`Houses.tsx:566-609`) | money-math/data-shape | MÉDIA | `houseResults.ts` testado isolado; montagem do payload e `canImport` vivem na página |
| R25 | **`create-user` não valida enum de role** (`server.ts`) — `String(role)` verbatim; valor fora de {admin,client} cai no fallback /profile silencioso | data-shape | MÉDIA | `server.ts` sem teste; acoplamento valor-gravado × roteamento nunca exercitado junto |
| R26 | **`getPreviousRange` erra duração em DST** (`dateRange.ts:84-98`) — diferença em ms sobre Datas locais | timezone-date | BAIXA | Teste roda no TZ da máquina (sem DST); nunca rodado com `TZ` setado |
| R27 | **`NotificationBell` dedup por `createdAt.toMillis()??0`** (`NotificationBell.tsx:41`) — serverTimestamp pendente nasce "lido"; clock skew client | data-shape / timezone | BAIXA | 0 teste de componente; caso serverTimestamp pendente nunca simulado |
| R28 | **`extractArray` fallback "primeiro array não-vazio"** (`affiliateService.ts:1218`) — pode pegar `errors:[...]` antes do payload | data-shape | BAIXA | Teste de fallback usa objeto com UM único array |

---

## 4. Bugs candidatos encontrados agora

### Confirmados (precisam fix; alguns também verificação manual da regra de negócio)

1. **ClientDashboard — R$0 como taxa real + "Configurado" fixo** — `src/pages/ClientDashboard.tsx:219-241`. `rates = { cpaValue: config?.cpaValue || 0, ... }` (linha 221) colapsa ausência; badge hardcoded `Configurado` (238-240); exibe `R$ 0/CPA` (252). **Impacto:** o afiliado vê a própria comissão errada (R$0 onde só há byBrand sem topo). **Teste que pega:** render `<ClientDashboard>` com `config = { byBrand: { sb: { cpaValue: 200 } } }` sem topo, `selectedBrand=ALL` → não deve exibir "Configurado"/`R$0` como taxa real.

2. **Ranking server usa taxa de topo (byBrand ignorado)** — `server.ts:740-751`. `commission = qualified_cpa*cfg.cpaValue + rvs*(cfg.revPercentage/100)` só com topo; descarta `byBrand` e não aplica regra do especial-pai. **Impacto:** leaderboard público (premiação) com valor/ordem errados para afiliado com override. **Teste que pega:** extrair `computeRankingEntries(rows, configs, names)` e assertar que afiliado com `byBrand≠topo` ranqueia com a comissão byBrand (hoje sai topo).

3. **Ranking server "hoje" em UTC** — `server.ts:699`. `new Date().toISOString().slice(0,10)`. **Impacto:** 21h-23:59 BR grava ranking de amanhã; cliente (data local) lê doc inexistente → "ainda não calculado". **Teste que pega:** clock fake `2026-06-24T23:30:00-03:00` → date default deve ser `2026-06-24` (não `2026-06-25`).

4. **`calcAffiliatePayout` propaga NaN** — `src/services/affiliateService.ts:684-688`. `(result?.qualified_cpa || 0) * cpaValue` sem `Number()`. **Impacto:** `'2,5' * 100 = NaN` contamina todo total agregado → "R$ NaN". **Teste que pega:** `calcAffiliatePayout({ rvs: '2,5' }, cfg)` não deve retornar NaN (hoje retorna).

5. **Lucro da agência ≠ Σ cards sob `brandFilter`** — `src/pages/AdminDashboard.tsx:233-276`. Topo usa `scopedResults`+`manualScoped`; `houseBreakdown` usa `results`/`brandRows`/`manualRows` não escopados. **Impacto:** ao filtrar uma casa o card de topo encolhe mas os cards por casa somam todas → invariante 7c1c830 reaberta no eixo do filtro. **Teste que pega:** AdminDashboard com 2 casas + `brandFilter=Superbet` → card topo == Σ cards por casa visíveis. **(Latente: seção só renderiza com ≥2 casas — dispara quando a OTG liberar a 2ª casa, sem novo deploy.)**

6. **Card "Lucro líquido do afiliado" ignora byBrand + filtro** — `src/pages/AffiliateDetails.tsx:426-435`. `calcAffiliatePayout(rowFor(id), config)` e por sub sem brandId → taxa de topo; contradiz o "CPA Calculado" (`:611`, que usa `resolveBrandRates(config, selectedBrandRow.id)`). **Teste que pega:** config `{ cpaValue: 300, byBrand: { sb: { cpaValue: 200 } } }` → "direto" usa 200 na SportingBet, não 300.

7. **SpecialDashboard/SpecialSubAffiliates dropam byBrand** — `SpecialDashboard.tsx:89-93,120-137`; `SpecialSubAffiliates.tsx:81-85,273,342`. `ownConfig` reconstruído sem `byBrand` → todo cálculo usa topo. **Teste que pega:** earnings do especial com `ownConfig` byBrand bate com `calcNetProfitByHouse` da mesma rede.

8. **`BrandConfigEditor` grava `cpaValue:0` fantasma** — `src/components/BrandConfigEditor.tsx:96-123`. `hadTopLevel` (linha 120) true quando só `revPercentage` existe → grava `cpaValue:0`, e a detecção a0dc467 passa a ver 0 como taxa real. **Teste que pega:** config `{ revPercentage: 10 }` (sem cpaValue) + base `{ cpa:'', rev:'12' }` → payload NÃO deve conter `cpaValue:0`.

9. **`affiliate_configs` legível por qualquer signed-in** — `firestore.rules:50-53` (`allow read: if isSignedIn()`) + `fetchAffiliateConfigs()` lê coleção inteira (`affiliateService.ts:98-110`), chamado em `ClientDashboard:85`, `SpecialDashboard:61`, `SpecialSubAffiliates:55`. **Impacto:** todo afiliado recebe CPA/REV/byBrand de todos. **Teste que pega:** rules-unit-testing — client lê `affiliate_configs/{outroId}` → NEGADO; admin → OK.

10. **Rules update não trava `isSpecial`** — `firestore.rules:36-39`. **Teste que pega:** rules — client `updateDoc(users/{self}, {isSpecial:true})` deve FALHAR (hoje passa).

11. **`isSpecial` divergente entre caminhos** — `server.ts:412` (`active!==false`) vs `:1082` (`active===true`). **Teste que pega:** `resolveIsSpecial({})` (sem `active`) → mesmo resultado nos 3 call-sites.

12. **`BrandBreakdown` não distingue ausência de zero** — `src/components/BrandBreakdown.tsx:22-30`. Propaga "R$ 0,00" silencioso por casa em 3 telas.

13. **`AuthContext` swap de usuário sem reset de loading** — `AuthContext.tsx:33-67` + `App.tsx:51-58`.

14. **Profile grava `mustChangePassword:false` antes de `updatePassword`** — `Profile.tsx:109-114`.

15. **`DateRangePicker`/`Ranking` congelam o "hoje" no clock do clique/render** — `DateRangePicker.tsx:27,49`; `Ranking.tsx:33`. Defasagem cruzando meia-noite.

### Suspeitos (exigem verificação manual / decisão de regra de negócio com o Carlos antes de tratar como bug)

- **SpecialDashboard "repasse" assume `results == own ∪ subs`** — `SpecialDashboard.tsx:133-134`. Linha fora da sub-rede infla `comissaoTotalRede` mas não `earnings`. *Verificar:* o proxy garante `results ⊆ {own}∪subs`? (`server.ts:1158-1159`).
- **Spread trata sub sem config como repasse 100% ao especial** — `SpecialSubAffiliates.tsx:273`. *Verificar regra:* sub sem comissão acordada = 0 de repasse, ou "não definido"?
- **AdminDashboard headline inclui afiliado órfão (casa desconhecida), cards por casa o descartam** — `AdminDashboard.tsx:233-276` vs `calcNetProfitByHouse` (`affiliateService.ts:772` `if (!house || !house.key) continue`). *Vira ALTA quando houver afiliado de marca não mapeada.*
- **`resolveBrandRates` fallback parcial mistura topo+casa** — `affiliateService.ts:67`. Override só com REV herda CPA de topo silenciosamente.
- **`getPreviousRange` DST** — `dateRange.ts:84-98`. *Verificar* rodando com `TZ=America/New_York`.
- **`house-results` filtro por string ISO sem garantir zero-pad** — `server.ts:1588-1589`. Linha legada `2026-6-1` cairia fora do range.

---

## 5. Plano de testes priorizado

### P0 — money-math + escopo/segurança + bugs confirmados

**P0.1 · `calcAffiliatePayout`/`calcNetProfit`/`calcAgencyNetProfit` — métrica string/null/NaN** (unit, `affiliateService.test.ts`)
Casos: `qualified_cpa='2'`→2×cpa; `rvs='2,5'`→não-NaN (deve falhar hoje, força o fix); `'R$ 100'`/`'abc'`→0; null/undefined→0; uma linha string-inválida não contamina o total das demais.
*Refactor antes:* reusar `parsePtNumber`/`num()` dentro de `calcAffiliatePayout` (linha 686-687) antes de multiplicar — hoje usa `|| 0` cru.

**P0.2 · Função pura `rateStatus(config, brandId)` — ausência-vs-zero** (unit)
Extrair de `AffiliateDetails.tsx:617-623` (`isNum`/`cpaConfigured`) para `affiliateService`/`src/lib`. Casos: config undefined→`{cpa:false,rev:false}`; só byBrand sem topo + brandId com override→cpa true p/ a casa, "Todas as casas"→false; `cpaValue:0` explícito→true (0 é config real); CPA setado + `revPercentage` undefined→cpa true, rev false (lado REV do bug); byBrand inválido + topo numérico→cai no topo, configured.
*Refactor antes:* extrair a heurística e fazer `AffiliateDetails`, `ClientDashboard`, `BrandBreakdown`, `SpecialDashboard` e `server.ts` consumirem a MESMA função.

**P0.3 · Invariante agregado == Σ cards COM overrides byBrand e afiliado órfão** (unit)
Casos: vários afiliados byBrand≠topo em 2+ casas → `calcAgencyNetProfit(...houseOf).netProfit === Σ calcNetProfitByHouse`; afiliado de casa desconhecida presente → provar a divergência esperada e fixar a "verdade"; filtrar 1 casa → lucro nunca negativo artificial; **teste de guarda:** agregado SEM `houseOf` mas com byBrand → DIVERGE (regressão do 7c1c830). **Property-based:** para configs aleatórias com byBrand, Σcards==agregado sempre que mesmo `houseOf`.

**P0.4 · Invariante combinada OTG+manual do /admin** (unit)
*Refactor antes:* extrair `composeAdminProfit(results, brandRows, manualRows, configs, subMap, houseOf, brandFilter)` de `AdminDashboard.tsx:228-276`. Casos: `total == Σ houseBreakdown.netProfit` (OTG+manual); **sob `brandFilter`** topo e breakdown usam o MESMO conjunto escopado (pega R8); casa só-manual aparece com lucro correto; mesma casa OTG+manual não soma 2×.

**P0.5 · `src/lib/scope.ts` (NOVO) — `resolveScopedAffiliateIds`** (unit)
*Refactor antes:* extrair `server.ts:1143-1175` para `(role, ownId, special, requestedCsv) → {ids?, deny?:403}`. Casos: admin→passa sem filtrar; não-admin endpoint≠results→403; results com `:id`→403; sem `affiliateId`→403; comum sem ids→`[ownId]`; comum pede id de outro→interseção vazia→403; especial ativo pede sub válido→passa; especial pede id fora da rede→filtrado; especial inativo→só `[own]`; `subAffiliateIds` number→string casa.

**P0.6 · `src/lib/ranking.ts` (NOVO) — `computeRankingEntries`** (unit)
*Refactor antes:* extrair `server.ts:746-758`; idealmente **reusar `resolveBrandRates`/`calcAffiliatePayout`** em vez de reimplementar. Casos: byBrand≠topo → comissão byBrand (pega R2); afiliado sem config → documentar/decidir (sai do ranking ou marcado "não configurado") e travar; commission≤0 filtrado; ordenação desc, top 100, pos 1..N; empate estável; `count==entries.length`; round 2 casas; linha sem id ignorada.

**P0.7 · Data canônica do servidor — `resolveServerToday`** (unit)
*Refactor antes:* extrair `server.ts:699` p/ helper que usa fuso America/Sao_Paulo (reusar `toISODate`). Casos: clock `2026-06-24T23:30-03:00`→`2026-06-24`; default casa com o que `rankingService.todayISO()` devolve no browser BR.

**P0.8 · `firestore.rules`** (rules, `@firebase/rules-unit-testing` + emulator)
*Refactor antes:* adicionar bloco `emulators` no `firebase.json`, script `test:rules` com `FIRESTORE_EMULATOR_HOST`, promover `.security-pocs/poc-01` para `test/rules/`. Casos: create role `client`→OK, `admin`→FALHA, com `affiliateId`/`isSpecial`→FALHA; update próprio mudando role/affiliateId/`isSpecial`(false→true)→FALHA (pega R6); update name/avatar/phone→OK; **`affiliate_configs` read por client de outro→NEGADO** (pega R5); `payment_profiles`/`houses`/`house_results`/`audit_logs` read não-admin→NEGADO; `direct_messages` read só `recipientUid==uid`; `contacts` create fora do shape→FALHA.

**P0.9 · ClientDashboard porta a regra absence-vs-zero** (component)
*Fix antes:* aplicar a0dc467 ao ClientDashboard. Casos: só byBrand sem topo, "Todas as casas"→não exibe `R$0/CPA` nem "Configurado"; cpaValue válido→comissão correta; afiliado NUNCA vê "Lucro líquido" no DOM.

**P0.10 · `src/services/noticeService.ts` `isNoticeForUser`** (unit) — pega R21
Casos: `all`+active→true p/ qualquer (client/special/null); `specials`→só isSpecial; `clients`→só não-special; `active:false`→sempre false; profile null→false sem quebrar.

**P0.11 · `subscribeToDailyRanking` null-vs-vazio** (unit) — pega R22
Casos: doc inexistente→`onData(null)`; doc com `entries:[],count:0`→`onData({entries:[],count:0})` (NÃO null); `count` ausente→`entries.length`; `entries` não-array→`[]`; erro→`onError`.

**P0.12 · `vitest.config.ts`** — incluir `src/pages/**` e `server.ts` no `coverage.include` (ver §7).

### P1 — escopo/segurança server + services + spread

**P1.1 · `src/lib/specialCommission.ts` — `validateSubConfigCap`** (unit) extraída de `server.ts:200-218`: cpa/rev negativos→400; `cpa==teto`→permitido; `cpa>teto`→erro; teto ausente (`ownCfg` vazio)→documentar armadilha; coerção `Number()`.

**P1.2 · `src/lib/isSpecial.ts` — `resolveIsSpecial`** (unit) unificada (pega R7): inexistente→false; `active:true`→true; `active:false`→false; **sem `active`→definir e usar nos 3 caminhos**.

**P1.3 · `calcSpecialEarnings`/`computeSubSpread` (NOVO)** (unit) extraídas de `SpecialDashboard.tsx:120-137`, `AffiliateDetails.tsx:426-435`, `SpecialSubAffiliates.tsx:273,342` (pega R9/R10/R11/R18): sem subs→`earnings==ownPayout`, spread=0; spread>0 quando sub<pai; **sub>pai→decidir clamp ≥0** e testar; repasse nunca > comissaoTotalRede; sub com byBrand coerente; sub sem config→spread=payout pai inteiro (verificar regra); `comissaoTotalRede` (rede inteira) vs grade (casa).

**P1.4 · `server.ts` rotas via supertest + `firebase-admin` mockado** (integration) — pega R4/R13/R16/R20
*Refactor antes:* exportar `app` (factory `createApp(deps)`), mockar `verifyIdToken`+Firestore+`fetch`. Casos: `GET /api/external/affiliates` como client→403; `results?affiliateIds=<outro>`→query forçada ao próprio (assertar URL no fetch mockado); `GET /api/house-results` como client→só linhas próprias, nunca `affiliateId null`; `accept-invite` token usado→410, expirado→410, inexistente→404; `requireAdmin` doc ausente→403, role client→403, admin→passa; `publicAuthLimiter` 31ª→429; `create-user` role fora de {admin,client}→rejeita (R25).

**P1.5 · `src/App.tsx` — `DashboardRedirect`/`ProtectedRoute`/`clientHome`** (component) — pega R14 (parcial), fail-safe
*Refactor antes:* exportar de `App.tsx`. Casos: loading→spinner/null; `!user`→/login; role mismatch→redirect; `mustChangePassword`→/profile; já em /profile→children (não loop); profile null+role exigido→/profile; **role desconhecido→/profile (nunca /admin)**; `clientHome`: isSpecial→/network, com affiliateId→/affiliates/:id, senão /profile.

**P1.6 · `src/contexts/AuthContext.tsx`** (component) — pega R14
Casos: sem login→profile null, loading false; login→snapshot seta profile; doc inexistente→null; erro→`handleFirestoreError`, não trava loading; **swap A→B: unsubscribe de A antes de B; snapshot tardio de A NÃO sobrescreve B; loading reseta na transição**; unmount→ambos unsubscribe.

**P1.7 · `houseService` contrato authFetch + mappers** (unit): `fetchHouses` não-ok→`[]`, JSON inválido→`[]`; `createHouse` não-ok→throw com msg; `importHouseResults` body `{houseSlug,rows}`; `houseToBrandMeta` null→undefined preserva dataSource/order; `syncKnownBrandsFrom` ordena order→nome, lista vazia→DEFAULT_BRANDS.

**P1.8 · `directMessageService`/`contactService`/`subscribeToNotices` mappers** (unit): ordenação `createdAt desc` com null→fim (`toMillis()??0`); query `recipientUid==uid`; `readAt` null preservado; `socialMedia`/legado `instagram`; `onError` no erro.

**P1.9 · `fetchAffiliateById` fallback de scan** (integration ou extrair `findAffiliateInList(list,id)` puro) — pega R19 parcial: doc local existe→retorna; ausente→escaneia por `a.id`; `a._id` sem `a.id`→casa; id number vs string→`String()`; não acha→null (não throw).

**P1.10 · Register/InviteAccept/Profile handlers** (component): Register CPF inválido bloqueia antes de `createUser`; **email NÃO normalizado antes de `createUserWithEmailAndPassword`** (R; teste deve falhar e expor); `setDoc` grava role `client`; InviteAccept ordem senha<6→confirm→telefone→CPF; **Profile: `updatePassword` falha DEPOIS de `updateDoc({mustChangePassword:false})`→usuário escapa do gate** (pega R23).

### P2 — robustez, datas, import, componentes

**P2.1 · `extractArray` múltiplos arrays e vazios em paths prioritários** (unit) — pega R28: `{data:{data:[]},results:[{}]}` (confirmar comportamento de `data.data` vazio); `{errors:[],affiliates:[{}]}`→prefere affiliates; `{warnings:[1],data:[{}]}`→data; `data.data` objeto vazio→não quebra.

**P2.2 · `extractApiError` codes não-canônicos** (unit): `{code:'0'}`/`{code:'00'}`→não-erro; `200`/`201`→null; erro em `payload.meta`; `success:false`; mensagem neutra→null.

**P2.3 · `src/lib/houseImport.ts` (NOVO) — `canImport`/`buildImportPayload`** (unit) extraída de `Houses.tsx:566-609`: `canImport` false com parseErrors/unresolved/rows=0; true só com rows>0 sem erro sem unresolved; payload preserva `date`+`affiliateId`+6 METRIC_KEYS, `affiliateId null`→agregado; não vaza `affiliateLabel`.

**P2.4 · `houseResults.ts` cenários extremos** (unit): `unattributedByHouse` clamp 0 quando atribuído>agregado; 2 casas mesmo dia não misturam slug; agregado explícito 0 + atribuídas>0→usa explícito (0); `aggregateByDate` soma casas diferentes.

**P2.5 · `Ranking.tsx` validação `?date` + estado vazio** (unit, extrair `resolveRankingDate`/`rankingEmptyState`): `?date` válido usado, ausente→`todayISO()`; **`2026-13-40` (regex passa mas impossível)→rejeitar/corrigir**; `ranking===null`→"não calculado", `entries:[]`→"sem comissão"; re-subscribe na virada de meia-noite (R; fake timers).

**P2.6 · `dateRange.ts` DST** (unit com `process.env.TZ='America/New_York'`) — pega R26: range de 30 dias cruzando DST mantém 30 dias.

**P2.7 · Componentes de dinheiro** (component): `BrandBreakdown` override byBrand vs topo, data vazio, config null sem quebrar; `NotificationBell` serverTimestamp pendente conta como não-lido (R27); `OtgRoster` stats pending vs reconciled.

**P2.8 · `server.ts` import house-results idempotência** (integration, exige emulator ou extrair `hrDocId`/`sanitizeMetrics`): re-import não duplica; agregado depois atribuído mesmo dia sem double-count; `hrDocId` determinístico.

**P2.9 · `src/lib/affiliateIdsParam.ts` (NOVO) — `expandAffiliateIdsParam`** (unit) des-duplicando `server.ts:1181-1194` e `:1761-1764`: CSV→repetido; array→repetido; vazios filtrados; dedup.

---

## 6. Refactors de testabilidade

**Funções de dinheiro/seleção de taxa a EXTRAIR de páginas para puras testáveis:**

1. **`rateStatus(config, brandId): {cpaConfigured, revConfigured}`** ← `AffiliateDetails.tsx:617-623` (`isNum`/`cpaConfigured`). **Fonte única da classe absence-vs-zero.** Consumida por AffiliateDetails, ClientDashboard, BrandBreakdown, SpecialDashboard, server.ts. Enquanto a detecção viver fora do helper, cada tela reintroduz o bug.
2. **Coerção de métrica dentro de `calcAffiliatePayout`** (`affiliateService.ts:686-687`) — trocar `result?.qualified_cpa || 0` por `num(result?.qualified_cpa)` (helper já existe no service).
3. **`composeAdminProfit(results, brandRows, manualRows, configs, subMap, houseOf, brandFilter)`** ← `AdminDashboard.tsx:228-276` (`netProfit`+`houseBreakdown`+`buildHouseOf`). Trava o invariante combinado OTG+manual e o eixo `brandFilter`.
4. **`calcSpecialEarnings(results, ownConfig, subIds, configs)` + `computeSubSpread(row, ownConfig, subConfig)`** ← duplicado em `SpecialDashboard.tsx:120-137`, `AffiliateDetails.tsx:426-435`, `SpecialSubAffiliates.tsx:273,342`. **Preservar `byBrand` no `ownConfig`** (hoje dropado) e decidir clamp ≥0.
5. **`resolveCommissionView(config, selectedBrandRow, isAllBrands)`** ← `ClientDashboard.tsx:219-225` + `AffiliateDetails.tsx:606-626`.
6. **`needsConfig`/`needsAccess`** ← `AffiliatesList.tsx:315-318`.
7. **`computeRankingEntries(rows, configs, names)`** ← `server.ts:746-758` (reusar `resolveBrandRates`).
8. **`resolveScopedAffiliateIds`** ← `server.ts:1143-1175` → `src/lib/scope.ts`.
9. **`resolveIsSpecial(specialDocData)`** ← unificar `server.ts:412/1082` + proxy.
10. **`validateSubConfigCap`** ← `server.ts:200-218`.
11. **`resolveServerToday`** ← `server.ts:699` (reusar `toISODate`).
12. **`canImport`/`buildImportPayload`** ← `Houses.tsx:566-609` → `src/lib/houseImport.ts`.
13. **`resolveRankingDate`/`rankingEmptyState`** ← `Ranking.tsx:33`.
14. **`expandAffiliateIdsParam`/`hrDocId`/`sanitizeMetrics`** ← extrair de `server.ts`.
15. **`baseRates` derivation** ← `BrandConfigEditor.tsx:96-123` (preservar ausência no topo).

**Tornar rotas Express testáveis:**
- Refatorar `server.ts` para exportar uma factory `createApp(deps)` (hoje `startServer()` só chama `listen`); injetar `adminApp`/`adminDb`/`fetch` mockáveis.
- Adicionar **`supertest`** a devDependencies (confirmado ausente).
- Mockar `verifyIdToken` para simular tokens admin/client/sem-token.
- Mover handlers e middlewares (`requireAuth`/`requireAdmin`) para módulo importável.

**Tornar rules testáveis:**
- Bloco `emulators` no `firebase.json`; script `npm run test:rules` com `FIRESTORE_EMULATOR_HOST`; promover `.security-pocs/poc-01`/`poc-03` para `test/rules/` (hoje fora do glob `src/**`).
- Exportar `DashboardRedirect`/`clientHome`/`ProtectedRoute` de `App.tsx` (poc-03 depende disso).

**Setup de teste:** mock de `window.matchMedia` em `src/test/setup.ts` (destrava ThemeContext e páginas que leem `prefers-color-scheme`).

---

## 7. Mudanças de tooling/processo

**`vitest.config.ts` (`coverage.include`):**
```
include: ['src/lib/**', 'src/services/**', 'src/components/**', 'src/pages/**', 'src/contexts/**', 'server.ts']
```
Sem isso a métrica continua escondendo a superfície de risco (R: meta-causa). `server.ts` e `App.tsx` precisam estar importáveis (refactor §6).

**Thresholds de cobertura** (`coverage.thresholds`, piso por pasta, subindo a cada fase):
- `src/lib/**`: lines 90 / branches 85 (manter o que já é alto).
- `src/services/**`: começar em 40 (Fase 3), meta 70.
- `src/pages/**`: começar em 25 após Fase 1/4, meta 50 (foco em money-math e gates, não pixel).
- `server.ts`: começar em 40 (Fase 2), meta 65.
- Global: meta progressiva 29% → 50% → 65%. CI falha abaixo do piso.

**Testes de `firestore.rules`:** `@firebase/rules-unit-testing` já é dep; falta `firebase-tools` (emulator) + script `test:rules`. Promover os 2 POCs existentes.

**CI:** pipeline rodando `npm run lint` (tsc) + `npm test` + `npm run test:rules` (job separado com emulator) em cada push/PR; bloquear merge abaixo do threshold. Hoje não há CI rodando testes.

**Property-based** (fast-check) para invariantes-chave: agregado==Σcards com configs aleatórias byBrand; `resolveScopedAffiliateIds` (afiliado nunca vê id fora do escopo); spread ≥0 quando sub≤pai.

**`supertest`** em devDependencies (rotas Express).

---

## 8. Roadmap sequenciado

### Fase 1 — Blindar a classe de bug que já escapou (money-math)
**Entregáveis:** extrair `rateStatus`, `composeAdminProfit`, `calcSpecialEarnings`/`computeSubSpread`, `resolveCommissionView`; coerção `num()` em `calcAffiliatePayout`; aplicar a0dc467 ao ClientDashboard; fix `BrandConfigEditor` (ausência não vira 0); testes P0.1–P0.4, P0.9 + property-based dos invariantes.
**Pronto quando:** (a) 0 lógica de dinheiro/seleção-de-taxa fora de função pura testada nas páginas de dinheiro; (b) invariante "agregado==Σcards" provado COM byBrand, COM `brandFilter` e COM órfão; (c) ClientDashboard e BrandConfigEditor distinguem ausência de R$0 com teste; (d) `calcAffiliatePayout` não produz NaN com string pt-BR.

### Fase 2 — Segurança/escopo (server.ts + rules)
**Entregáveis:** factory `createApp(deps)` + `supertest`; extrair `resolveScopedAffiliateIds`, `resolveIsSpecial`, `validateSubConfigCap`, `computeRankingEntries`, `resolveServerToday`; fechar R5 (`affiliate_configs` read), R6 (rules isSpecial), R17 (guard `/affiliates/:id`); testes P0.5–P0.8, P0.11, P1.1–P1.5; emulator + `test:rules`.
**Pronto quando:** (a) proxy IDOR e house-results scope com teste de integração verde; (b) rules com regressão verde para privesc (create/update role+isSpecial) e leitura cruzada de `affiliate_configs`/`payment_profiles`/`direct_messages`; (c) ranking server usa byBrand e fuso BR com teste; (d) `isSpecial` resolvido por função única nos 3 caminhos.

### Fase 3 — Services + tempo real
**Entregáveis:** testes P0.10, P0.11, P1.6–P1.8, P2.4; cobrir `noticeService`/`rankingService`/`directMessageService`/`contactService`/`houseService` mappers e contratos authFetch; AuthContext swap/cleanup.
**Pronto quando:** os 5 services saem de 0% para ≥60%; `isNoticeForUser`, null-vs-vazio do ranking, e o swap de usuário do AuthContext têm teste; `loading` reseta na troca de conta.

### Fase 4 — Páginas/fluxos + componentes
**Entregáveis:** testes P1.9–P1.10, P2.3, P2.5, P2.7; component tests dos gates (`AffiliateDetails` lucro líquido não vaza p/ afiliado; `ClientDashboard` nunca mostra lucro); import Houses (`canImport`/payload); Register/InviteAccept/Profile handlers; `BrandBreakdown`/`NotificationBell`/`OtgRoster`.
**Pronto quando:** todo gate de papel por página tem teste; fluxos de cadastro/convite/troca-de-senha cobertos; `pages/` cruza o threshold inicial.

### Fase 5 — Tooling/CI/thresholds
**Entregáveis:** `vitest.config` incluindo pages+server+contexts; thresholds por pasta no CI; `test:rules` no pipeline; property-based estabilizado; testes P2.1–P2.2, P2.6, P2.8–P2.9.
**Pronto quando:** CI falha abaixo do piso; métrica reflete a superfície real (não esconde pages/server); POCs de segurança rodam no `npm test`/`test:rules`.

---

## 9. Métrica de sucesso

A plataforma é considerada confiável quando:

1. **0 lógica de dinheiro ou seleção de taxa fora de função pura testada** — `rateStatus`, `calcSpecialEarnings`, `composeAdminProfit`, `computeRankingEntries` extraídas e consumidas por todos os call-sites (nenhuma reimplementação inline em `*.tsx`/`server.ts`).
2. **Invariantes-chave com teste (alguns property-based):** agregado==Σcards (COM byBrand, COM `brandFilter`, COM órfão); ausência≠R$0 em todas as telas de comissão; spread do especial ≥0 quando sub≤pai; `resolveScopedAffiliateIds` nunca devolve id fora do escopo; ranking usa a MESMA fórmula byBrand dos dashboards.
3. **Threshold de cobertura em `pages/` e `server.ts`** ativo e no CI — métrica deixa de esconder a superfície de risco; `src/pages/**` ≥25% (foco money/gate) e `server.ts` ≥40% no primeiro corte, subindo.
4. **`firestore.rules` com suíte de regressão verde** rodando no CI (`test:rules` + emulator): privesc de role/isSpecial (create e update) e leitura cruzada de `affiliate_configs`/`payment_profiles`/`direct_messages` provados NEGADOS.
5. **Os 15 bugs confirmados da §4 têm teste de regressão** que falha no estado bugado e passa após o fix.
6. **CI bloqueia merge** abaixo do threshold e em falha de `lint`/`test`/`test:rules`.
7. **Datas canônicas:** servidor e cliente concordam no "dia" (fuso BR) com teste de clock fake; ranking não some por off-by-one UTC.

**Arquivos-âncora citados:** `D:\code\boost-afiliiados\src\services\affiliateService.ts` (`:58` resolveBrandRates, `:684` calcAffiliatePayout, `:729`/`:762` net profit, `:1218` extractArray), `D:\code\boost-afiliiados\server.ts` (`:200-218`, `:412`, `:699`, `:740-758`, `:1082`, `:1143-1175`, `:1593-1595`), `D:\code\boost-afiliiados\firestore.rules` (`:28-39` users, `:50-53` affiliate_configs), `D:\code\boost-afiliiados\src\pages\AdminDashboard.tsx` (`:228-276`), `D:\code\boost-afiliiados\src\pages\AffiliateDetails.tsx` (`:426-435`, `:606-626`), `D:\code\boost-afiliiados\src\pages\ClientDashboard.tsx` (`:219-241`), `D:\code\boost-afiliiados\src\pages\SpecialDashboard.tsx` (`:89-137`), `D:\code\boost-afiliiados\src\pages\SpecialSubAffiliates.tsx` (`:81-85`, `:273`), `D:\code\boost-afiliiados\src\components\BrandConfigEditor.tsx` (`:96-123`), `D:\code\boost-afiliiados\src\components\BrandBreakdown.tsx` (`:22-30`), `D:\code\boost-afiliiados\src\contexts\AuthContext.tsx` (`:33-67`), `D:\code\boost-afiliiados\src\App.tsx` (`:51-58`, `:140`), `D:\code\boost-afiliiados\src\pages\Profile.tsx` (`:109-114`), `D:\code\boost-afiliiados\src\pages\Houses.tsx` (`:566-609`), `D:\code\boost-afiliiados\src\pages\Ranking.tsx` (`:33`), `D:\code\boost-afiliiados\src\services\rankingService.ts`, `D:\code\boost-afiliiados\src\services\noticeService.ts`, `D:\code\boost-afiliiados\src\lib\dateRange.ts` (`:84-98`), `D:\code\boost-afiliiados\vitest.config.ts` (`:23-27`), `D:\code\boost-afiliiados\.security-pocs\` (poc-01/poc-03).