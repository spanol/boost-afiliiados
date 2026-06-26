# Plano de Integração — Boost Agency

> Consolidação da estratégia de integração após o mapeamento da dashboard da OTG e a
> sondagem das APIs (2026-05-29). As trilhas são separadas por **de onde vêm os dados**,
> porque é isso (e não a dificuldade) que define o que é construível agora.
> Itens de backlog detalhados em [`BACKLOG.md`](./BACKLOG.md).

## Fontes de dados

| Fonte | Acesso | O que oferece |
|-------|--------|---------------|
| **API v2 externa** (`/api/v2/external`, `x-api-key` via proxy) | ✅ temos | `affiliates`, `results` (groupBy `affiliate`/`brand`/`date`/`campaign`), `campaigns` |
| **API v1 interna** (`/api/v1/agency/{casa}-analytics`, JWT custom da agência) | ✅ **INTEGRADA** (2026-06-26) — login durável server-side (`POST /api/v1/auth/login {email,password,deviceToken}`); ver `SPIKE-OTG-V1-ANALYTICS.md` | **cliques**, NGR, handle (bet_amount), depósitos — e **TODOS os afiliados** (inclui só-funil que a v2 esconde, ex.: "Lucas") |
| **Firebase** (Auth + Firestore) | ✅ nosso | usuários/roles, configs CPA/REV, status, auditoria, convites, espelho de afiliados |

**Conclusão-chave:** o MVP é 100% construível sobre a **v2 + Firebase**. Os dados exclusivos
do v1 dependem de a OTG liberar acesso (ver Trilha C).

---

## Fase 0 — Concluído ✅
- Migração para o Firebase novo (`agencia-boost-app`) + regras por role.
- Onboarding de afiliados (modelo C: convite → auto-cadastro vinculado ao `affiliateId`).
- Exibição de dados reais do afiliado (KPIs, funil, por casa, série diária).
- Autenticação das rotas `/api/*` (`requireAuth`/`requireAdmin`) + **escopo por afiliado** no proxy.
- Correções: admins fora da listagem de afiliados; input de CPA/REV.

---

## Trilha A — MVP sobre a v2 (sem bloqueio, construível já)

| Item | Escopo | Observação |
|------|--------|------------|
| **B2 · Filtros de data** ✅ | date range picker (admin + client) propagando `startDate`/`endDate` ao proxy | **Feito** — `DateRangePicker` + `lib/dateRange` (presets: hoje/7d/30d/mês atual/mês passado/personalizado); padrão = mês atual; client filtra livremente. Removido o `2024-01-01` fixo do `affiliateService`. Conserta a divergência OTG×Boost ao permitir alinhar o período. |
| **B1 · Lucro líquido** | `Σ comissão da casa (results.total_commission) − Σ repasse ao afiliado (config)` | Card no AdminDashboard + por afiliado |
| **Depósitos** | surfacing do campo `deposit` (já vem no results) | trivial |
| **Multi-marca** ⚙️ UI pronta · 🔴 dados bloqueados na OTG | UI multi-marca implementada (filtro por marca + badge no AdminDashboard e AffiliatesList; `lib/brand`). **Verificado 2026-05-30: a API externa retorna SÓ Superbet (37/37 afiliados, `groupBy=brand` só traz Superbet).** O filtro fica oculto com 1 marca e aparece sozinho quando a OTG vincular afiliados SportingBet à nossa `x-api-key`. **Não é tarefa de código — é onboarding operacional na OTG.** |
| **Por Campanha** ✅ | visão analítica por campanha | **Feito** — `aggregateByCampaign` + `CampaignBreakdown` (tabela em sm+, cards no mobile) no `/admin` (rede) e no painel do afiliado (própria comissão). |

## Trilha B — Produto / decisão (v2 + Firebase)

| Item | Bloqueio |
|------|----------|
| **Qualificação do MVP** (quais KPIs entram) | decisão do chefe — usar `public/mvp-inventario.html` |
| **B4 · Dados bancários** (PIX/banco/CNPJ) | decisão + segurança (`firestore.rules` restrito) |
| **B5 · Acessos/visualizações** (settings do admin master) | depende de definir os eixos (por-admin? por-tela?) |

## Trilha C — ✅ ENTREGUE (2026-06-26) · cliques + funil da v1 (era 🟡, antes 🔴)
Dados desbloqueados: **Cliques · Handle (bet_amount) · NGR · Depósitos · TODOS os afiliados**
(inclui os só-funil que a v2 esconde — caso "Lucas Guimarães"). Canais/ciclo de pagamento
seguem fora (não vêm neste endpoint).
**Como ficou** (ver **`SPIKE-OTG-V1-ANALYTICS.md › ✅ ENTREGUE`** p/ o contrato completo):
- Auth **durável server-side**: `POST /api/v1/auth/login {email,password,deviceToken}` → access_token
  (~15min, cacheado); o `deviceToken` (verified-2fa, ~8h) pula o 2FA. Sem pedir API key nova à OTG.
- Pull resiliente por casa (`sportingbet-analytics` 200; `superbet-analytics` 404 → indisponível),
  persistência em `affiliate_analytics` + reconciliação/enriquecimento dos `pending_affiliates`.
- Rotas: `POST /api/analytics/refresh` (admin, botão no `/otg-roster`), `POST /api/internal/analytics-refresh`
  (cron), `GET /api/affiliate-analytics` (escopado). UI: card de cliques + fix do crash do Lucas.
- **Validado ao vivo em prod** (smoke test: 33 gravados / 33 pendentes enriquecidos).
**Pendência só de operador:** secrets de prod + deploy rules + push + Cloud Scheduler (ver SPIKE).

## Trilha D — B3 · Afiliado especial (sub-afiliados) 🟡 em implementação
- A "feature incompleta" de 28/05 **era este afiliado especial** (não havia sistema legado).
  Especificado e refinado no `BACKLOG.md › B3` (modelo local, 1 nível, comissão = spread provisório).
- **Fase 1 feita** (modelo `special_affiliates` + setup do master). Faltam: Fase 2 (escopo no proxy),
  Fase 3 (view do especial), Fase 4 (cálculo do spread — bloqueada até o Carlos confirmar a comissão).

## Trilha E — Testes 🧪 (em andamento)
Antes não havia test runner. Fundação montada com **Vitest + React Testing Library + jsdom**
(`vitest.config.ts`, setup em `src/test/setup.ts`). Scripts: `npm test`, `npm run test:watch`,
`npm run coverage`. Convenção: arquivos `*.test.ts(x)` ao lado do código.

| Cobertura | Estado |
|-----------|--------|
| `lib/dateRange` (presets, fuso, matchPreset) | ✅ coberto |
| `affiliateService` — helpers defensivos (`extractArray`/`extractApiError`/`isNoDataError`) | ✅ coberto |
| `components/DateRangePicker` (presets, intervalo custom, normalização) | ✅ coberto |
| Demais services, contexts e páginas | ⬜ crescer por fase |
| Handlers de API do `server.ts` (com mock do Firebase Admin) | ⬜ pendente |

**Regra de ouro:** cada nova fase (B1, multi-marca, etc.) entra com seus testes junto.

---

## Bloqueadores a resolver (fora de código)
1. ~~**Acesso à API v1 da OTG**~~ ✅ **resolvido** (2026-06-26) — login durável com as creds do Carlos (não precisou de API key nova). Trilha C entregue.
2. ~~Origem da feature de sub-afiliado~~ ✅ **resolvido** — era o afiliado especial (B3), em implementação.
3. **Comissão do especial + regras do lucro líquido (B1)** → roteiro consolidado pro Carlos em `BACKLOG.md › B3`; destrava o B1 e a Fase 4 do B3.
4. **Qualificação do MVP pelo chefe** → trava o escopo da Trilha B.

## Rascunho — pedido de acesso à OTG (v1)
> Olá, equipe OTG. Estamos integrando o painel Boost via a API externa
> (`/api/v2/external`, com `x-api-key`), que cobre afiliados, resultados e campanhas.
> Precisamos também dos dados que hoje só aparecem na dashboard de vocês e não estão na v2:
> **cliques, valores em aposta (handle), canais e ciclo/relatório de pagamento**.
> Vocês conseguem (a) expor esses campos na API v2 externa, ou (b) nos fornecer uma
> credencial/escopo de API para os endpoints `/api/v1/...` correspondentes? Seguem os
> endpoints que identificamos: `/api/v1/system/global-config`, `/api/v1/payment-cycle/*`.

---

## Sequenciamento recomendado
1. ~~**B2** (rápido + corrige a divergência)~~ ✅ → 2. **B1** (lucro líquido) → 3. **Multi-marca + Por Campanha**
   → 4. **B4/B5** (após decisão do chefe) → 5. **Trilha C** (quando a OTG liberar v1)
   → 6. **B3** (após discovery).
