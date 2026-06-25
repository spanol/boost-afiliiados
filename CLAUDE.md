# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Agência Boost** — an affiliate-management platform (React SPA) for a marketing agency. Admins manage affiliates (CPA/REV configuration, activation status, audit logs, contact inquiries); affiliates ("clients") view their own results. UI text and most domain naming are in **Portuguese (pt-BR)** — match this when writing user-facing strings and error messages.

Originated as a Google AI Studio applet (see README / `firebase-applet-config.json` / `metadata.json`).

## Planning & roadmap

- **`INTEGRATION-PLAN.md`** — current roadmap: data sources (v2 ✅ / v1 ❌ / Firebase), Fase 0 (done), trilhas A–D, blockers, and the recommended next step (**B2 · date filters**, which also fixes the OTG×Boost commission discrepancy). The external **v1 API is NOT accessible** with our `x-api-key` (401); clicks/wager/channels/payment-cycle are blocked pending OTG access.
- **`BACKLOG.md`** — sketches B1 (lucro líquido), B2 (date filters), B3 (sub-affiliates), B4 (banking data), B5 (admin access/visibility settings).
- **`REVIEW-TEST-PLAN.md`** — plano de revisão total + testes (auditoria 2026-06). §0–§0.4 rastreiam **Fases 1–4 ENTREGUES** (money-math, byBrand, segurança + rules-emulator + supertest, services + AuthContext, páginas/fluxos + componentes; 381 testes + 42 de rules). **Falta só a Fase 5** (tooling/CI: `coverage.include`, thresholds por pasta, CI, fast-check, `firebase-tools` no devDeps). **Leia antes de continuar a revisão.**
- **`public/mvp-inventario.html`** — static page (served at `/mvp-inventario.html`) cataloguing OTG dashboard data for the boss to qualify MVP scope.

## Commands

```bash
npm install          # install deps
npm run dev          # start the app (Express + Vite middleware) on PORT (default 3000)
npm start            # same as dev (tsx server.ts) — used in production with NODE_ENV=production
npm run build        # vite build -> dist/
npm run preview      # vite preview of the built bundle
npm run lint         # tsc --noEmit (type-check only; there is no ESLint)
npm run clean        # rm -rf dist

# Tests (Vitest + React Testing Library + jsdom)
npm test             # run the suite once (vitest run)
npm run test:watch   # watch mode
npm run coverage     # v8 coverage report

# Firebase (CLI, project: agencia-boost-app)
firebase deploy --only firestore:rules    # deploy firestore.rules after editing
firebase projects:list                    # confirm logged-in account / projects
```

**Testing.** Test runner is **Vitest** (`vitest.config.ts`, jsdom env, setup in `src/test/setup.ts` registering jest-dom matchers). Convention: `*.test.ts(x)` colocated with the code. Current coverage is the B2 work (`lib/dateRange`, the `affiliateService` parsing helpers, `DateRangePicker`); see **Trilha E** in `INTEGRATION-PLAN.md` for the strategy — each new phase ships with its tests. `npm run lint` (TypeScript type-check) remains the other automated check.

Dev and production both run through `server.ts` via `tsx` — there is no `vite dev` standalone path. In dev the Express server mounts Vite as middleware (`appType: 'spa'`); in production (`NODE_ENV=production`) it serves static `dist/` and falls back to `dist/index.html` for SPA routing.

## Architecture

This is a **single Express server wrapping a Vite/React SPA** — not two separate apps. `server.ts` is the entry point for both serving the frontend and exposing the backend API.

### API authentication (`server.ts`)
Clients send their Firebase ID token as `Authorization: Bearer <token>` (added by `authFetch` in `src/lib/api.ts`, used throughout `affiliateService.ts`). Two middlewares guard routes: `requireAuth` (verifies the token) and `requireAdmin` (verifies token **and** `users/{uid}.role === 'admin'`). Admin routes (`create-user`, `affiliate-statuses`, `PATCH /affiliates/:id`, `audit-logs`, `affiliates/sync`, `invites` POST) use `requireAdmin`; the external proxy uses `requireAuth`; `GET /api/invites/:token` and `POST /api/accept-invite` are intentionally public (the affiliate has no account yet). `requireAuth` loads the caller's `role` + `affiliateId` from Firestore onto `req.user`. **Per-affiliate scoping:** in the external proxy, non-admin callers may only hit the `results` endpoint and the server forces `affiliateIds` to their own `affiliateId` (ignoring client-supplied values); every other external endpoint returns 403 for non-admins. Admins are unrestricted.

### Backend (`server.ts`)
Express server that:
- Initializes **Firebase Admin SDK** (from `FIREBASE_SERVICE_ACCOUNT_KEY` env var if present, else default app credentials). All `/api/*` routes return 500 if Admin failed to initialize.
- Exposes API routes:
  - `POST /api/create-user` — creates a Firebase Auth user **and** the matching `users/{uid}` Firestore doc (admin-privileged; this is why user creation goes through the server, not the client SDK).
  - `GET/PATCH /api/affiliate-statuses` / `/api/affiliates/:id` — affiliate active/inactive status stored in the `affiliate_statuses` collection.
  - `GET/POST /api/audit-logs` — audit trail in the `audit_logs` collection.
  - `GET /api/external/:endpoint/:id?` — **proxy to the external Affiliate API** (`VITE_AFFILIATE_API_BASE_URL`, default `https://affiliate-api-prd.partnersotg.com/api/v2/external/...`). Injects the `x-api-key` header server-side so the key never reaches the browser. Forwards query strings.
  - **Affiliate onboarding ("model C" invite flow)** — Boost is a wrapper over the external API: `POST /api/affiliates/sync` mirrors the external affiliate list into the `affiliates` collection; `POST /api/invites` (admin) creates a single-use, 7-day token in `invites/{token}` bound to an `affiliateId`; `GET /api/invites/:token` (public) validates it; `POST /api/accept-invite` (public) lets the affiliate self-register with their own email/password, creating their Auth user + `users/{uid}` doc (role `client`, linked `affiliateId`) and marking the invite used. The affiliate then logs in and `ClientDashboard` shows only their own `/results`. The `invites` collection is server-only (no Firestore rule → clients are denied).

### Frontend (`src/`)
- **Routing/auth** — `src/App.tsx`. `ProtectedRoute` gates routes by auth state and `role` (`admin` | `client`). Users with `mustChangePassword` are forced to `/profile`. `/dashboard` redirects to `/admin` or `/client` by role.
- **Contexts** (`src/contexts/`) — `AuthContext` (Firebase auth + live `users/{uid}` profile via `onSnapshot`), `ThemeContext` (dark mode), `ToastContext` (notifications). All three wrap the app in `App.tsx`.
- **Services** (`src/services/`) — the data layer. Components should call services, not Firestore/fetch directly.
  - `affiliateService.ts` — central service. Mixes **two data sources**: external Affiliate API (via the `/api/external` proxy) for affiliate/results data, and Firestore for app-owned data (`affiliate_configs`, `users`, `settings`). Also wraps the server's status/audit/create-user endpoints.
  - `contactService.ts` — contact inquiries (`contacts` collection), real-time via `onSnapshot`.
- **Pages** (`src/pages/`) — `Home`, `Login`, `Register`, `AdminDashboard`, `ClientDashboard`, `Profile`, `Settings`, `Contacts`, `AffiliatesList`, `AffiliateDetails`.
- **`src/lib/firebase.ts`** — client Firebase init from `firebase-applet-config.json`. Exports `db`, `auth`, `storage`, and the shared `handleFirestoreError` / `OperationType` error helper used by contexts/services.

### Affiliate API response handling
The external API has inconsistent response shapes, so `affiliateService.ts` is deliberately defensive:
- `extractArray` probes many nested paths (`data.data`, `affiliates`, `results`, etc.) to find the payload array.
- `extractApiError` / `isNoDataError` distinguish a real error from an empty "no data" result (e.g. code `040`) so the UI can show empty state instead of an error.
- `fetchAffiliateById` falls back to scanning the full affiliate list when the by-id endpoint 404s or returns no data.

When touching affiliate data fetching, preserve these fallbacks rather than assuming a single canonical shape.

## Invariantes de domínio & convenções — LEIA antes de mexer em dinheiro/segurança

Esta seção destila os bugs reais que escaparam dos testes (auditoria 2026-06) e os padrões que os impedem. **Quebrar um destes invariantes é uma regressão**, mesmo com os testes passando.

### Comissão/dinheiro: fonte ÚNICA em `src/lib/commission.ts`
- O núcleo de comissão é **puro e sem Firebase**: `num`, `resolveBrandRates`, `rateStatus`, `calcAffiliatePayout`, `calcNetProfit` (+ tipos `AffiliateConfig`/`BrandRates`). `affiliateService.ts` re-exporta tudo — importe de `services/affiliateService` (client) ou direto de `src/lib/commission` (server). **NUNCA reimplemente a fórmula inline** numa página ou rota: foi a causa de TODOS os bugs de dinheiro (7c1c830, a0dc467, R2, R9, R10).
- **`server.ts` NÃO pode importar `services/affiliateService`** (puxa o Firebase client no boot). O servidor importa só de `src/lib/{commission,scope,ranking,brand,...}`. Toda lógica que o server precisar reusar tem que viver em `src/lib`.
- **Taxa POR CASA (`byBrand[brandId]`) sobrepõe a de topo.** Resolva o brandId do afiliado com `buildBrandIdOf` (client) ou pelo mirror `affiliates` (server) — modelo "1 afiliado → 1 casa" (campo `brand`), o MESMO que `houseOf`/`calcNetProfitByHouse` do /admin. Passar `brandId` a `calcAffiliatePayout` é **no-op** p/ quem não tem override → seguro adicionar em qualquer call-site.
- **Ausência de config ≠ R$0.** Use `rateStatus(config, brandId)` (detecta `typeof number`) p/ decidir "configurado" vs "não configurado" no display — nunca `cpaValue || 0`, que mostra um zero enganoso.
- **Invariante "agregado == Σ dos cards".** O headline de lucro e o detalhamento por casa SAEM DA MESMA base escopada (`composeAdminProfit`); ao filtrar por marca, os dois escopam juntos.
- **Nunca propague NaN.** `num()` = `Number.isFinite(Number(v)) ? Number(v) : 0` — guarda contra NaN/Infinity (string não-numérica/`null` → 0, não NaN) antes de multiplicar. **ATENÇÃO (achado 2026-06-24):** `num` só entende decimal com PONTO (`'2.5'`→2.5); **NÃO parseia vírgula pt-BR** (`'2,5'`→0, igual a `Number(v)||0`). Em prod os totais batem (a OTG manda número parseável), então é adequado — mas NÃO confie em `num` p/ parsear formato pt-BR (`'2.400,50'`→0). `parsePtNumber` foi cogitado no plano mas nunca implementado.
- **Lucro líquido/margem da agência só no `/admin` do master** — nunca na view do afiliado. O gate do card "lucro líquido do afiliado" (`AffiliateDetails`) é `canViewAffiliateNetProfit` (`src/lib/affiliateView.ts` — admin OU especial vendo sub ≠ próprio id); `ClientDashboard` não importa NENHUMA função de lucro/margem. A margem da agência (`composeAdminProfit`) só existe no `AdminDashboard`.

### Segurança/escopo
- **Dado sensível (taxas, PII) é mediado pelo servidor (Admin SDK) + rule `admin-only`; o cliente NUNCA lê direto.** Ex.: `affiliate_configs` → `GET /api/affiliate-configs` (escopa por papel: admin=todas; afiliado=própria+sub-rede). Espelha `payment_profiles`/`houses`. Ao adicionar dado sensível, siga este padrão (não `read: isSignedIn()`).
- **IDOR do proxy:** `resolveScopedAffiliateIds` (`src/lib/scope.ts`) é a barreira — não-admin só lê o próprio id / sub-rede do especial. Teste qualquer mudança de escopo nele.
- **`resolveIsSpecial` (= `active === true`) é a definição ÚNICA** de especial ativo. Não reescreva `active !== false`/`=== true` inline.
- **Campos server-only no `users/{uid}`:** `role`, `affiliateId`, `isSpecial` — as rules travam o self-update deles. Não os exponha a escrita do cliente.
- **Datas no servidor:** `resolveServerToday` (fuso `America/Sao_Paulo`), nunca `new Date().toISOString()` (Cloud Run = UTC → corta o dia errado à noite BR).

### Testabilidade & processo
- **Lógica testável vive em `src/lib/*` com teste colocado** (`*.test.ts`, descrições pt-BR, mock de `lib/firebase` e `lib/api`). Ao corrigir dinheiro/escopo numa página/rota, **extraia a função pura** e teste-a — não deixe a regra só no JSX/handler.
- **Rotas Express são testáveis via `createApp(deps)`** — `server.ts` exporta a factory (`startServer()` a chama e adiciona Vite/listen); `server.test.ts` (supertest) injeta mocks de Firestore/Auth (`adminApp.auth().verifyIdToken`)/`fetch`. **Use `// @vitest-environment node` no topo de QUALQUER teste que importe `server.ts`** — importar puxa `vite`→esbuild, cujo invariante de `TextEncoder` quebra sob jsdom.
- **`firestore.rules` tem regressão no emulator:** `npm run test:rules` (`firebase emulators:exec` + `test/rules/*.spec.ts`, env node). Fica FORA do glob `src/**`, então `npm test` não a roda sem o emulator. Requer o **firebase CLI + Java** (convenção do repo; não está no devDeps ainda — Fase 5).
- **Mock-padrão dos testes de service** (`services/*.test.ts`): `vi.mock` de `firebase/firestore` (collection/query/where/onSnapshot/...) + `../lib/firebase` (db) + `../lib/api` (authFetch); dirige o `onSnapshot` por `vi.mocked(onSnapshot).mock.calls[0][1]` (onNext) / `[0][2]` (onError). Template: `src/services/noticeService.test.ts`. Componentes que tocam `firebase/auth` → padrão `vi.hoisted` de `src/contexts/AuthContext.test.tsx`.
- **`vitest.config.ts` `coverage.include` EXCLUI `pages/`, `server.ts` e `contexts/`** (dívida conhecida — Fase 5 do REVIEW-TEST-PLAN). Há testes reais cobrindo essas superfícies (`server.test.ts`, `AuthContext.test.tsx`, etc.), mas a MÉTRICA os ignora; não confie no número global como prova de cobertura.
- **`server.ts` roda código ANTIGO até reiniciar o processo** (`tsx server.ts`, sem watch) — mudanças no servidor não aparecem no app rodando até `kill` + `npm run dev`. O frontend tem HMR (Vite middleware), então mudanças de página/lib aparecem na hora.
- **Verificação no app usa o Firestore de PROD + rules DEPLOYADAS** (o client SDK fala direto com o Firestore). Mudança de `firestore.rules` só vale após `firebase deploy --only firestore:rules` (deploy é ação do operador).

## Configuration & conventions

- **Path alias**: `@/*` → repo root (configured in both `vite.config.ts` and `tsconfig.json`).
- **Env vars**: `VITE_`-prefixed vars are exposed to the browser (`import.meta.env`); non-prefixed vars (`FIREBASE_SERVICE_ACCOUNT_KEY`, `PORT`, `AFFILIATE_API_KEY`) are server-only. `.env*` is gitignored except `.env.example`.
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` (no `tailwind.config.js`; config lives in `src/index.css`). UI uses `lucide-react` icons, `recharts` charts, `motion` animations, and the `clsx` + `tailwind-merge` (`cn`) pattern in `src/lib/utils.ts`.
- **HMR**: controlled by `DISABLE_HMR` env var — disabled inside AI Studio to prevent flicker during agent edits. Don't re-enable it unconditionally.

## Firebase setup

- **Project: `agencia-boost-app`** (created May 2026; the original `agencia-boost` project from the first dev is inaccessible). Web config lives in `firebase-applet-config.json`; Firestore is in `southamerica-east1`.
- **Server Admin SDK** authenticates via `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json` (gitignored). Without it, all `/api/*` routes fail with "Unable to detect a Project Id". `server.ts` falls back to `admin.initializeApp()` (ADC) when `FIREBASE_SERVICE_ACCOUNT_KEY` is unset.
- **`firestore.rules`** is role-based (`isAdmin()` checks `users/{uid}.role == 'admin'`). Deploy changes with `firebase deploy --only firestore:rules`. Known hardening gap: self-register currently lets a client set its own `role` (needed to bootstrap the first admin) — lock this down once admin/affiliate creation is fully server-side.

## Deploy (Firebase App Hosting)

Production runs on **Firebase App Hosting** (Cloud Run under the hood, same `agencia-boost-app` project). App Hosting doesn't have a Vite server adapter, so it falls back to the **generic Node.js buildpack**: it runs the `build` script (`npm run build` → `dist/`) then the `start` script (`npm start` → `tsx server.ts`). With `NODE_ENV=production` the server serves `dist/` + `/api/*`. `PORT` is injected by Cloud Run; `server.ts` already listens on `0.0.0.0:$PORT`.

- **Config**: `apphosting.yaml` (repo root) — `runConfig` + env. Secrets (`FIREBASE_SERVICE_ACCOUNT_KEY`, `AFFILIATE_API_KEY`) come from Cloud Secret Manager; plain env (`NODE_ENV`, `VITE_AFFILIATE_API_BASE_URL`) is inline. `tsx` and `vite` are in `dependencies` (not just `devDependencies`) so `npm start` works in the runtime container.
- **One-time setup**:
  ```bash
  # Create the two secrets (paste the service-account.json contents / the x-api-key)
  firebase apphosting:secrets:set firebase-service-account-key
  firebase apphosting:secrets:set affiliate-api-key
  # Create the backend (pick region southamerica-east1 to match Firestore; connect the GitHub repo)
  firebase apphosting:backends:create --project agencia-boost-app
  ```
- **Deploy**: push to the connected branch (App Hosting auto-builds), or trigger manually:
  ```bash
  firebase apphosting:rollouts:create <backend-id> --project agencia-boost-app
  ```
- Firebase Admin auth in production uses `FIREBASE_SERVICE_ACCOUNT_KEY` (the secret), same as local — no ADC/IAM-role wiring needed. `firestore.rules` is still deployed separately with `firebase deploy --only firestore:rules`.
- **Cron diário do ranking** (`POST /api/internal/daily-ranking`, gated por `requireCronSecret`/header `x-cron-secret`): gera o `daily_rankings/{hoje-BR}` E manda um popup-lembrete ao admin master. Sem isso o ranking só sai por clique manual do admin no `/ranking`. Secrets: `ranking-cron-secret` (alto-entropia, gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) e `master-admin-email` (e-mail do admin que recebe o lembrete; vazio = todos os admins). Operador cria o **Cloud Scheduler** diário ~14h30 BR batendo no endpoint com o header. Sem `RANKING_CRON_SECRET` no ambiente a rota responde 503 (feature off). Ver memória `boost-notifications-ranking` p/ o comando `gcloud`.

## Important caveats

- `firebase-applet-config.json` contains the (public, client-side) Firebase web config committed to the repo. The sensitive `service-account.json`, `FIREBASE_SERVICE_ACCOUNT_KEY`, and affiliate `x-api-key` are server-side only and gitignored.
- `src/lib/firebase.ts` no longer runs the old `testConnection()` debug write (it pinged `system/connection_test_ping` on load and failed with a permission error under the role-based rules). Removed along with the noisy/PII console logs (Firebase config dump, profile data, theme, affiliate-fetch breadcrumbs) — keep production console clean; don't reintroduce debug `console.log`s of config or user data.
