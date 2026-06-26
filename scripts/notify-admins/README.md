# notify-admins

Dispara uma **mensagem direta** (popup 1:1 "Mensagem da gerência") aos admins do Boost —
pensado para **anunciar uma release**.

Grava na coleção `direct_messages` com a mesma forma do lembrete do ranking (`server.ts`,
`affiliateId: 'system'`). O popup é o `DirectMessagePopup` (montado no `DashboardLayout`),
que escuta por `recipientUid` em tempo real e mostra ao admin no próximo load logado.

## Uso

```bash
# dry-run (só lista quem receberia; nada é gravado)
node scripts/notify-admins/send.cjs --title "Nova release" --body "Resumo da mudança."

# corpo de um arquivo (ex.: release notes), para TODOS os admins, enviando de verdade
node scripts/notify-admins/send.cjs --title "Release v1.4" --body-file notes.md --to all --send

# destinatários específicos (lista por vírgula)
node scripts/notify-admins/send.cjs --title "..." --body "..." \
  --to carlos@carlossantos.org,bruno@previlabel.com --send
```

### Flags

| flag | descrição |
|---|---|
| `--title <txt>` | **obrigatório** — título do popup |
| `--body <txt>` | corpo; use `\n` para quebras de linha (ou `--body-file`) |
| `--body-file <path>` | lê o corpo de um arquivo (markdown/texto) |
| `--to <all\|emails>` | `all` (todos os admins) ou lista por vírgula. Default: `all` |
| `--id <slug>` | id determinístico da mensagem. Default: slug do título |
| `--from <txt>` | remetente exibido. Default: `Gerência Boost` |
| `--send` | **grava**. Sem ela = dry-run |

### Idempotência

O doc id é `${id}__${uid}`. Rodar de novo com o **mesmo `--id`** atualiza a mensagem em vez
de duplicar. Para uma release, passe um id único por versão, ex.: `--id release-v1.4.0`.
(Sem `--id`, o slug do título serve — então mude o título a cada anúncio ou passe `--id`.)

## Auth

Mesma ordem do `server.ts`:
1. `FIREBASE_SERVICE_ACCOUNT_KEY` (env/secret) — usado em CI;
2. senão `service-account.json` na raiz do repo — uso local.

## Integrar a uma release (opcional, ainda NÃO ligado)

Para disparar automaticamente quando uma release é publicada, um job assim já basta — ele
usa o secret que o App Hosting já tem (`FIREBASE_SERVICE_ACCOUNT_KEY`) e a release notes
do próprio GitHub Release como corpo:

```yaml
# .github/workflows/notify-admins.yml
name: notify-admins
on:
  release:
    types: [published]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: |
          printf '%s' "${{ github.event.release.body }}" > /tmp/notes.md
          node scripts/notify-admins/send.cjs \
            --title "${{ github.event.release.name || github.event.release.tag_name }}" \
            --body-file /tmp/notes.md \
            --id "release-${{ github.event.release.tag_name }}" \
            --to all --send
        env:
          FIREBASE_SERVICE_ACCOUNT_KEY: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_KEY }}
```

> Decisão de produto antes de ligar: anunciar **toda** release a **todos** os admins? Se só
> releases "maiores", troque o gatilho (ex.: tags `v*.*.0`) ou rode o script manual. O secret
> `FIREBASE_SERVICE_ACCOUNT_KEY` precisa existir no repositório do GitHub Actions.
