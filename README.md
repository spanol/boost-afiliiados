# Agência Boost

Plataforma de gestão de afiliados (React SPA) para uma agência de marketing. Administradores gerenciam afiliados (configuração CPA/REV, status de ativação, logs de auditoria, contatos); afiliados ("clientes") visualizam apenas os próprios resultados.

A interface e a maior parte do domínio estão em **português (pt-BR)**.

> O projeto nasceu como um applet do Google AI Studio e foi evoluído para uma aplicação completa rodando um servidor Express que envolve um SPA Vite/React.

## Arquitetura

- **Servidor único** (`server.ts`) — um Express que serve o SPA e expõe a API. Em dev, o Vite é montado como middleware; em produção (`NODE_ENV=production`), serve o `dist/` estático com fallback SPA.
- **Backend** — rotas `/api/*` autenticadas via Firebase ID token (`Authorization: Bearer`). Inicializa o Firebase Admin SDK e atua como **proxy para a API de Afiliados externa** (injeta o `x-api-key` no servidor, para que a chave nunca chegue ao navegador).
- **Frontend** (`src/`) — roteamento e auth em `App.tsx` (rotas protegidas por papel `admin` | `client`); contextos de Auth, Theme e Toast; camada de serviços em `src/services/` (componentes chamam serviços, não Firestore/fetch diretamente).
- **Fontes de dados** — API de Afiliados externa (resultados/afiliados) + Firestore (dados próprios do app: configs, usuários, settings, status, auditoria, convites).

Detalhes completos de arquitetura, autenticação e fluxo de onboarding de afiliados estão em [`CLAUDE.md`](CLAUDE.md).

## Pré-requisitos

- Node.js
- Variáveis de ambiente em `.env` (veja `.env.example`). Vars com prefixo `VITE_` são expostas ao navegador; as demais (`FIREBASE_SERVICE_ACCOUNT_KEY`, `AFFILIATE_API_KEY`, `PORT`) são apenas do servidor.
- `service-account.json` (gitignored) ou `GOOGLE_APPLICATION_CREDENTIALS` para o Firebase Admin SDK — sem isso, as rotas `/api/*` falham.

## Rodando localmente

```bash
npm install      # instala dependências
npm run dev      # inicia o app (Express + Vite) na PORT (default 3000)
```

## Scripts

```bash
npm run dev       # inicia o app (tsx server.ts)
npm start         # idem, usado em produção com NODE_ENV=production
npm run build     # build de produção -> dist/
npm run preview   # preview do bundle buildado
npm run lint      # tsc --noEmit (type-check; não há ESLint)
npm run clean     # remove dist/

npm test          # roda os testes uma vez (Vitest)
npm run test:watch
npm run coverage  # relatório de cobertura (v8)
```

**Testes:** Vitest + React Testing Library + jsdom. Convenção `*.test.ts(x)` colocado junto ao código.

## Deploy

Produção roda no **Firebase App Hosting** (Cloud Run, projeto `agencia-boost-app`). Push para a branch conectada dispara o build (`npm run build` → `dist/`) e o start (`npm start`). Configuração em `apphosting.yaml`; segredos (`FIREBASE_SERVICE_ACCOUNT_KEY`, `AFFILIATE_API_KEY`) vêm do Cloud Secret Manager. As regras do Firestore são publicadas à parte:

```bash
firebase deploy --only firestore:rules
```

Veja [`CLAUDE.md`](CLAUDE.md) para o passo a passo completo de deploy e configuração.

## Roadmap

- [`INTEGRATION-PLAN.md`](INTEGRATION-PLAN.md) — roadmap atual (fontes de dados, trilhas A–D, blockers, próximo passo).
- [`BACKLOG.md`](BACKLOG.md) — backlog (lucro líquido, filtros de data, sub-afiliados, dados bancários, settings de acesso).
