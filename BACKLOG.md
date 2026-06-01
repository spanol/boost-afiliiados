# Backlog — Boost Agency

> Esboços capturados de conversa com a diretoria (2026-05-29). **Não implementar ainda** —
> são ideias rascunhadas para refinar em tasks. Cada item tem contexto, escopo aproximado
> e perguntas em aberto.

---

## B1 · Lucro líquido (após repasse aos afiliados)

**Contexto.** A agência recebe comissão das casas (CPA + REV — o `total_commission` que a OTG
reporta). Os afiliados recebem o que está configurado em `affiliate_configs`
(`cpaValue` × CPA qualificados + `revPercentage` × REV). Falta exibir **o que sobra para a agência**.

**Fórmula proposta.**
`Lucro líquido = Σ comissão recebida das casas (OTG total_commission) − Σ comissão repassada aos afiliados (cálculo do Boost por afiliado)`

**Escopo aproximado.**
- Novo card no `AdminDashboard` (lucro líquido consolidado do período).
- Coluna/linha por afiliado em `AffiliatesList` / `AffiliateDetails` (recebido vs. repassado vs. margem).
- Cálculo no `affiliateService` (já temos as duas pontas: `total_commission` da OTG e a comissão calculada por config).

**Respondido pelo Carlos (2026-05-29):**
- Base = exatamente o `total_commission` da OTG (sem acordo por casa). ✅
- Custos fixos a descontar? **Ainda não.** ✅
- Mostrar lucro líquido **por casa e por período**: **sim** → novo item a construir (hoje só temos o consolidado por período via filtro de data).

Ou seja, o `calcNetProfit` atual (`total_commission` direto, sem custos fixos) **deixa de ser provisório** — está correto. Falta só o detalhamento por casa.

---

## B2 · Filtros de data na Boost

**Contexto.** Hoje o Boost fixa o período em `2024-01-01 → hoje` (hardcoded no `affiliateService`).
A dashboard da OTG tem seletor de datas; o Boost precisa do mesmo.

**Escopo aproximado.**
- Date range picker no header das dashboards (admin e client).
- Propagar `startDate` / `endDate` para `fetchAffiliateResults` / `*ByBrand` / `*DailyResults` →
  o proxy `/api/external` já encaminha a query string.
- Presets: hoje, últimos 7 dias, mês atual, mês passado, personalizado.

**Perguntas em aberto.**
- Período padrão ao abrir (mês atual?).
- O afiliado (client) pode escolher livremente o intervalo?

---

## B3 · Afiliado Especial (sub-afiliados / sub-rede)

> Refinado com a diretoria em 2026-05-29. Decisões abaixo travadas; **modelo de comissão
> (spread) ainda a confirmar com o Carlos** — ver "Roteiro p/ o Carlos".

**Conceito.** O MASTER promove um afiliado dele a **afiliado ESPECIAL** e vincula alguns dos
seus afiliados como **sub-afiliados** do especial. O especial ganha uma view parecida com a
do master, porém **escopada à própria sub-rede** e com menos features.

**Decisões (confirmadas com o Carlos em 2026-05-29, salvo Q6).**
- **Papel:** especial = `client` com flag `isSpecial` (NÃO vira admin). Login normal, view diferente.
- **Hierarquia:** modelo **local da Boost** (a OTG não expõe pai/filho). **1 nível** (sub não tem sub-rede própria); 1 especial por afiliado.
- **Poderes do especial:** visualizar a sub-rede + **convidar/gerir** os próprios subs + **definir a comissão dos próprios subs** (limitada à taxa que o MASTER setou para o especial = teto). *(Atualizado: antes era "não mexe em comissão".)*
- **Especial vê o próprio ganho:** spread sobre os subs **+** a própria produção, com **cards separados por afiliado** (dados individuais de cada sub + os dele). A **margem da agência** sobre tudo continua **só no MASTER** (regra do lucro líquido).
- **Comissão = SPREAD (confirmado):** o **MASTER** define a **taxa do especial** sobre os afiliados vinculados (o teto). O **ESPECIAL** define a **taxa de cada sub** (≤ teto). O especial fica com o **spread** = `(taxa do especial − taxa do sub) × produção do sub`, somado por sub, **+** a comissão da produção própria dele (`affiliate_config` normal). Base da casa = `total_commission` exato, **sem custos fixos** (confirmado).
- **⏳ Em aberto (Q6):** quem **desembolsa** o repasse aos subs — agência direto ou sai do bolo do especial. Não bloqueia a exibição/cálculo no Boost (é operacional); reperguntar ao Carlos.

**Modelo de dados (proposto).**
- `special_affiliates/{especialAffiliateId}` = `{ active, subAffiliateIds: string[], networkCpaValue, networkRevPercentage, updatedAt }` — marca o especial, lista os subs e guarda a taxa da sub-rede. **NÃO** guardar hierarquia no mirror `affiliates/` (o sync sobrescreve).
- `users/{uid}.isSpecial` — flag de conveniência p/ roteamento/gating (espelha `special_affiliates`).
- Comissões: `affiliate_configs/{id}` segue valendo p/ produção própria de cada um (especial e subs).

**Permissões / escopo.**
- Proxy: hoje força não-admin ao próprio `affiliateId`. Estender: se `isSpecial`, liberar `results` para os affiliateIds da própria sub-rede (own + subs), **validado no servidor** (lookup em `special_affiliates`).
- `firestore.rules`: `special_affiliates` → leitura p/ signed-in (ou admin + o próprio especial), escrita só admin.

**Fases.**
1. **Modelo + setup do MASTER** — coleção + serviço + rules + UI na lista de afiliados (promover especial, vincular subs, setar as taxas). *(em andamento)*
2. **Escopo no proxy + rules** para a sub-rede do especial.
3. **View do especial** — dashboard escopado (funil da sub-rede + própria produção) + lista de subs + convites; esconder features de master.
4. **Cálculo do spread + exibição** (ganho do especial; margem da agência só no master) — **desbloqueado** (modelo confirmado; só Q6 operacional em aberto, não trava o cálculo).

**Roteiro p/ o Carlos — RESPONDIDO em 2026-05-29** (só falta Q6).
1. Base da casa = exatamente `total_commission`. ✅ *(B1)*
2. Custos fixos a descontar? **Ainda não.** ✅ *(B1)*
3. **Spread** — o master seta a comissão do especial sobre os afiliados vinculados. ✅
4. Ganho do especial = **subs + produção própria**, com **cards separados por afiliado** (dados individuais). ✅
5. O **especial** define a comissão dos próprios subs (teto = a taxa que o master setou pra ele). ✅
6. **⏳ Em aberto** — "não ficou clara". Reperguntar: quem desembolsa o repasse aos subs (agência direto vs. do bolo do especial). Não bloqueia o cálculo no Boost.
7. Lucro líquido **por casa e por período**: **sim.** ✅ *(B1 — novo item a construir)*

Travado: 1 especial por afiliado; **1 nível**; o especial vê só a própria sub-rede.

**Origem da feature (resolvido 2026-05-29).** A "feature de sub-afiliado incompleta" notada em 28/05 **É este afiliado especial** — não há sistema legado a investigar; está especificado aqui e em implementação (Fase 1 feita).

**Dependências.** Escopo por afiliado no proxy (✅ feito) + novo modelo de hierarquia (Fase 1).

**Pendência sinalizada (2026-05-29).** Hoje o afiliado loga direto no próprio painel
(`/affiliates/{id}`), mas a sidebar ainda mostra o item **"Clientes" → `/affiliates`**
(lista completa, que dá 403 no proxy para não-admin). Mantido visível por ora; ao
implementar o "afiliado master", redefinir esse item para mostrar a **própria sub-rede**
em vez de esconder/quebrar. Há um `TODO(B3 · afiliado master)` em `DashboardLayout.tsx`.

---

## B4 · Dados bancários do afiliado (para receber os repasses)

**Contexto.** Os afiliados precisam cadastrar onde recebem os repasses. Novo item na **sidebar**:
"Dados Bancários".

**Escopo aproximado.**
- Novo menu na sidebar + página/formulário: **PIX** (chave + tipo), **Banco** (banco/agência/conta),
  **CNPJ** (ou CPF). Editável pelo próprio afiliado; admin visualiza.
- Persistir em coleção própria (ex.: `banking_info/{uid}` ou campo em `users`).

**⚠️ Segurança (dados sensíveis).**
- CNPJ/CPF e dados de conta são sensíveis: `firestore.rules` deve restringir a leitura/escrita
  ao próprio afiliado (e admin). Não logar; não expor em endpoints abertos.
- Avaliar mascarar dados na visão admin.

**Perguntas em aberto.**
- Campos obrigatórios vs. opcionais (PIX só, ou banco completo também)?
- Validação de CNPJ/CPF e de chave PIX?
- Admin edita ou só visualiza?

---

## B5 · Configurações de acesso/visualização de afiliados (conta admin master)

**Contexto.** Em **Configurações** (conta de admin master), poder **limitar acessos e
visualizações de afiliados** — controlar quem vê o quê.

**Sketch conceitual (a validar).**
- Tela em `/settings` (somente admin master) para definir regras de visibilidade/acesso.
- Possíveis eixos: quais afiliados um admin enxerga (escopo por admin); o que cada afiliado
  pode ver/acessar; ativar/desativar áreas por afiliado.
- Persistir as regras (ex.: coleção `access_rules` ou campos em `users`/`settings`) e
  aplicá-las tanto no front (ocultar) quanto no back (`firestore.rules` + escopo no proxy).

**Relacionado.** Conecta com o escopo por afiliado já feito (proxy) e com B3 (sub-afiliados).
Ver também o bug já corrigido: admins não aparecem mais na listagem de afiliados.

**Perguntas em aberto.**
- O limite é por-admin (cada admin gerencia um subconjunto) ou regras globais sobre afiliados?
- Que "visualizações" exatamente queremos poder restringir (telas? métricas? casas?)?
- Há níveis de admin (master vs. admin comum)?

