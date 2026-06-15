# OTG — afiliados aprovados (pré-cadastro)

Snapshot do **roster de afiliados aprovados** na OTG, para fazer o **pré-cadastro
manual** no Boost — assim eles já aparecem na dashboard enquanto aguardam receber
um `affiliateId` do sistema de relatório quando a OTG disponibilizar.

## Por que isso existe

A OTG tem **dois backends separados**:

| Sistema | URL | O que tem | Acesso |
|---|---|---|---|
| **Relatório** | `partners.grupootg.com` + `affiliate-api-prd` | Só afiliados que **já produziram** (recebem valor). É o que o Boost lê hoje. | nossa `x-api-key` |
| **Provisionamento** | `links.otgpartners.com.br` (Supabase) | Roster **real de aprovados** (`status=completed`), mesmo sem produção. | sessão logada da agência |

Um afiliado aprovado no provisionamento **só aparece no relatório/API quando
produz** — e, hoje, a casa SportingBet aparece agregada num único registro
(`PedroEliasMoreli`). Por isso o Boost "não vê" os afiliados SportingBet ainda.
Este snapshot preenche essa lacuna até a OTG expor um acesso oficial.

## A ponte entre os dois sistemas: `nameKey`

Não há id compartilhado entre provisionamento e relatório. A ligação é o **nome**:
a OTG gera o `name` do relatório **tirando espaços/acentos** do `affiliate_name`
do provisionamento (confirmado pelo link Gerador `.../BrunoEduardoSantosRodrigues`).

`nameKey = nome normalizado` = sem espaços, sem acentos, minúsculo, só `[a-z0-9]`.
Ex.: `"Leonardo Portugal Vasconcelos"` → `leonardoportugalvasconcelos`.

→ No pré-cadastro, grave o `nameKey` (+ `house`). Quando o afiliado aparecer no
relatório/API, reconcilie por `nameKey` para anexar o `affiliateId` real (que o
Boost precisa para mostrar resultados). **Único risco: homônimos** → confirmar à mão.

## Arquivos

- **`snapshot-YYYY-MM-DD.json`** — export (status=completed). Estrutura:
  ```jsonc
  {
    "generatedAt": "ISO",
    "agencyId": "d13641b9-...",
    "source": "links.otgpartners.com.br · link_requests · status=completed",
    "total": 71,
    "byHouse": { "Sportingbet": 16, "Superbet": 55 },
    "rows": [
      {
        "name": "Leonardo Portugal Vasconcelos",
        "nameKey": "leonardoportugalvasconcelos",   // ponte com o relatório
        "house": "Sportingbet",
        "email": "...", "phone": "...", "social": "...",
        "registerUrl": "https://brsportingbet.net/registro16232",
        "deliveredAt": "ISO",
        "requestId": "uuid", "batchId": "uuid"        // ids do Supabase de links
      }
    ]
  }
  ```
- **`fetch-approved-console.js`** — script para **regerar** o snapshot à mão
  (colar no Console do DevTools, logado em `links.otgpartners.com.br`).

## Atualizar o snapshot (manual)

1. Logar em `https://links.otgpartners.com.br` (conta da agência).
2. DevTools (F12) → Console → colar `fetch-approved-console.js` → Enter.
3. Baixa `otg-approved-snapshot.json` (também copia p/ clipboard / loga no console).
4. Salvar como `snapshot-<data>.json` aqui e commitar.

> Precisa de sessão logada: a anon key sozinha é bloqueada por RLS (retorna 0 linhas).
> O app de links não tem MFA (login só senha).

## Próximo passo (tirar o "manual")

Para automatizar, a OTG precisa expor leitura dos aprovados (endpoint próprio ou
login de serviço read-only escopado ao `agency_id`). Aí o servidor do Boost puxa
sozinho e o pré-cadastro deixa de ser manual. Ver memória `boost-external-api-state`.
