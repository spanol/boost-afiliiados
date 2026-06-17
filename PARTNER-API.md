# API do Parceiro (read-only)

Superfície **versionada e somente-leitura** que a Agência Boost expõe a um parceiro
externo. Separada da API interna (que usa login Firebase): o parceiro autentica por
uma **API key emitida pela Boost**, não tem conta nem acessa o app.

Base: `https://<host-da-boost>/api/partner/v1`

## Rotas abertas (resumo)

| Método | Rota | Scope | Retorna |
|--------|------|-------|---------|
| GET | `/pending-affiliates` | `pending-affiliates` | Aprovados na OTG aguardando produção (dado-chave) |
| GET | `/affiliates` | `affiliates` | Reconciliados/ativos (id, nome, marca, link) |
| GET | `/results` | `results` | Produção agregada — **só contagem, nada de R$** |

Todas read-only, autenticadas por API key da Boost, com envelope fixo `{ data, total, generatedAt }`.

> **Explorer interno:** o admin tem em `/parceiros-api` (sidebar → "API Parceiros") um
> painel para disparar essas rotas, ver a resposta e **auditar os campos** — confirma
> visualmente que só saem os dados liberados (sem valores monetários).

## O que NÃO é exposto

- **Nenhum valor monetário (R$)** em `/results`: `total_commission`, `cpa` (R$), `rvs`,
  `deposit` (R$), comissão, repasse, lucro — removidos no servidor por whitelist
  (`src/lib/partnerResults.ts`). Decisão do Carlos (2026-06-17).
- Endpoints de escrita, configuração, taxas/`affiliate_configs`, lucro líquido da agência,
  e qualquer rota interna do app (essas exigem login Firebase, fora desta superfície).

## Autenticação

Toda requisição envia a key no header:

```
x-boost-api-key: bsk_xxxxxxxxxxxxxxxxxxxx
```

- A key é emitida pelo admin (`scripts/partners/create-partner.mjs`) e mostrada **uma vez**.
- No servidor guardamos só o **hash** (sha-256) em `api_partners/{id}` — nunca a key crua.
- Cada key tem **scopes** (`pending-affiliates`, `affiliates`, `results`, ou `*` = todos).
- Rate limit: 120 req/min por key.

Respostas de erro: `401` (key ausente/inválida), `403` (key desativada ou sem o scope),
`4xx/5xx` com `{ "error": "..." }`.

## Envelope

Todas as rotas retornam:

```json
{ "data": [ ... ], "total": 123, "generatedAt": "2026-06-17T12:00:00.000Z" }
```

## Endpoints

### GET /pending-affiliates  · scope `pending-affiliates`
Afiliados **aprovados na OTG aguardando produção** (o dado-chave). Filtros opcionais:
`?status=pending|reconciled` · `?house=Superbet`.

Campos por item: `id, name, nameKey, house, status, email, phone, social, registerUrl,
affiliateId (quando reconciliado), createdAt, updatedAt`.

```bash
curl -H "x-boost-api-key: $KEY" \
  "https://<host>/api/partner/v1/pending-affiliates?status=pending"
```

### GET /affiliates  · scope `affiliates`
Afiliados reconciliados/ativos (espelho do relatório da OTG).
Campos: `id, name, siteId, brand, registerUrl` (link de cadastro quando disponível).

### GET /results  · scope `results`
Produção agregada (proxy do relatório da OTG). **Obrigatório**: `startDate`, `endDate`
(`YYYY-MM-DD`). Opcional: `groupBy=affiliate|brand|date|campaign` (default `affiliate`),
`affiliateIds=a,b`.

**Somente CONTAGEM — nenhum valor (R$).** Por decisão do Carlos (2026-06-17), o
parceiro recebe apenas as métricas de **cadastro, depósitos e CPA** em contagem, mais
as dimensões de identidade. Os campos monetários da OTG (`total_commission`, `cpa` em
R$, `rvs`, `deposit` em R$, etc.) são **removidos no servidor** por uma whitelist
(`src/lib/partnerResults.ts`) — nem campo monetário novo/desconhecido passa.

Campos por item:
- **Métricas (contagem):** `registrations` (cadastros), `first_deposits` (depósitos/FTD),
  `qualified_cpa` (CPA qualificado). *Note:* é a CONTAGEM — `deposit`/`cpa` (valores R$) NÃO vêm.
- **Dimensões** (conforme `groupBy`): `affiliate_id`/`affiliate_name`/`id`/`label`,
  `brand`/`brand_id`/`brand_name`, `date`, `campaign`/`campaign_id`/`campaign_name`.

```bash
curl -H "x-boost-api-key: $KEY" \
  "https://<host>/api/partner/v1/results?startDate=2026-06-01&endDate=2026-06-30&groupBy=affiliate"
```

## Origem do dado (frescor)

`pending-affiliates` vem de `pending_affiliates`, alimentado pelo **pull do roster da
OTG** (`POST /api/pending-affiliates/refresh`, admin → lê o Supabase de provisionamento
com as creds `OTG_LINKS_*`). Rode-o (ou um scheduler batendo nele) para manter o dado
fresco. Ver `otgLinksPull.ts`, `scripts/otg-approved/README.md` e a memória
`boost-partner-api`.

## ⚠️ LGPD

`pending-affiliates` e `affiliates` carregam **PII de terceiros** (email, telefone,
social). Garanta base legal/contrato para o compartilhamento com o parceiro antes de
liberar a key.
