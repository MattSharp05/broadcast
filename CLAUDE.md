# Broadcast

Broadcast is Matthew's own system for posting short videos to social media automatically. Brands
(e.g. Coding Journey) own one or more social accounts; each account has daily time slots and a
backlog of videos. A scheduler publishes due posts through the platforms' official APIs
(Instagram Reels in the MVP, TikTok in v1) and collects stats afterwards. Videos arrive through
the dashboard's **Add content** or `POST /api/content` (used by video-editor sessions). The
dashboard has three tabs: Workflow (a pan/zoom canvas of every account's timeline around "now"),
Accounts (a table with tags, descriptions and the Add account wizard) and Content Factory (a
placeholder until v1).

## Workflow
Follows the `dev-workflow` skill (ticket-driven: Notion → branch → PR → QA → merge).
- Notion project page: https://app.notion.com/p/40f24983f3ca81b69b0be91b3b8dc5ff
- Tickets data source: collection://f5f00270-522e-4418-b749-5c70c838fb60   (ID prefix: BC)
- Epics data source: collection://f3f4b478-9212-46ac-9dd4-7c9ba75bbb33
- GitHub: MattSharp05/broadcast
- Project slug: broadcast (session tags `project:broadcast`; see run-state.md → Session tags)
- Preview URLs: batched QA mode: none (`vercel.json` → `"git": { "deploymentEnabled": { "**": false, "main": true } }`), since CI builds every PR and QA happens on production. Production: https://broadcast-iota-murex.vercel.app (Vercel project `broadcast`, team mattsharp05's projects; production deploys from `main`)
- QA mode: batched (2–3 waves per batch; batch ends at checkpoints). Always tested before building on them: Instagram connection (OAuth + token storage), the scheduler's publish step, the content API's auth.
- Parallel builders: 2 (3 only when Files touched are clearly separate)
- Merge policy: fast
  - `fast` (personal projects; nobody uses main during a run): merge now; main's full suite checks the combination and a red main is reverted. Main can be red for ~15 min.

## Design
UI work follows `docs/DESIGN.md` (written in `/plan-work` from the approved vision mockup,
`docs/vision-mockup.html`) and the workflow's `ui-design` skill. In short: light work area,
navy navigation rail, one cobalt accent, colour only for state, IBM Plex Sans with tabular
numerals, no monospace labels or all-caps eyebrows.

## Rules
- Never store social media passwords. Only OAuth tokens, encrypted server-side; the browser never
  sees them.
- The content API only queues videos. Posting happens only through the scheduler and the
  dashboard.
- Never post the same queue item twice; check the account's Instagram quota before publishing.

## Stack
Next.js 15 (App Router, TypeScript strict, React 19) on Vercel Hobby · Supabase (Postgres + RLS,
Auth magic link, Storage, `pg_cron` + `pg_net`) · plain CSS with tokens + CSS Modules · Vitest ·
Playwright · MSW. Details and reasons: `docs/TDD.md`, ADRs in `docs/decisions/`.

## Commands
(Set up by BC-1 and BC-5; keep this list current.)
- `pnpm install` · `pnpm dev` (app on :3000) · `pnpm build` · `pnpm start` (serve the build)
- `pnpm lint` · `pnpm typecheck` (`next typegen` + `tsc`) · `pnpm format` / `pnpm format:check`
- `pnpm test` (Vitest, `src/**/*.test.ts`) · `pnpm test:watch`
- `pnpm supabase start` / `stop` (local stack in Docker; Mailpit on :54324 catches magic-link
  emails) · `pnpm db:reset` (migrations + `supabase/seed.sql`) · `pnpm db:types` (regenerates
  `src/lib/db/types.ts`; CI fails if it's stale) · `pnpm -s db:env >> .env.local` (local URL + keys)
- `pnpm test:integration` (Vitest, `tests/integration/`; needs `supabase start`; the sign-in gate
  test also needs a running app: `E2E=1 pnpm start` and `APP_TEST_URL=http://localhost:3000`)
- `pnpm e2e` (Playwright: builds and serves the app on :3100 with `E2E=1`, signs in through
  `/auth/test-sign-in`; needs `supabase start`). `pnpm e2e --project=desktop` for desktop only.
  Specs use `test`/`loadScenario` from `tests/e2e/fixtures.ts`; tests run one at a time (one shared Sandbox).
- `pnpm tick`: one scheduler tick (`POST $APP_URL/api/cron/tick` with `CRON_SECRET` from the env or
  `.env.local`; the app must run with the same secret). `/dev` → "Run tick now" ticks the Sandbox only.
- `node scripts/broadcast-upload.mjs --file x.mp4 --accounts a,b [--caption …] [--pin …]`: queues a
  video through the content API (`BROADCAST_URL` + `BROADCAST_API_KEY` from `/dev/api-keys`);
  see `docs/content-api.md`.
- Scenarios: `/workflow?scenario=<name>[&now=ISO]` (signed in) resets the Sandbox and loads one;
  `/dev` lists them. Register new ones in `src/lib/scenarios/index.ts`.

## Structure
`src/app` routes · `src/features/{canvas,accounts,content,drawers}` · `src/components` shared UI ·
`src/lib/{domain,providers,db,crypto,scenarios}` · `src/styles/tokens.css` · `supabase/migrations` ·
`tests/e2e` · `scripts/`. Full tree in `docs/TDD.md`.

## Conventions
- pnpm, Node 22, ESLint + Prettier. Conventional commits with the ticket ID.
- Pure logic in `src/lib/domain` (no I/O), unit tested. Handlers are thin.
- All provider calls go through `SocialProvider` (`instagram` | `fake`). Never call the Graph API elsewhere.
- Every query is scoped by `workspace_id` (helpers in `src/lib/db`). Service-role client only in `src/lib/db/admin.ts` (`server-only`).
- New tables (new migration file in `supabase/migrations`): `workspace_id` + composite FK to the
  parent, RLS on with an `allowed_user_all` policy (or none for service-role-only data), an
  explicit `grant … to authenticated` (browser roles get nothing by default), add it to `ALL_TABLES` in `tests/integration/helpers.ts`, then `pnpm db:types`.
- Times stored in UTC; workspace timezone only for display and slot maths.
- UI: tokens only (no literal colours), sentence case, IBM Plex Sans; follow `docs/DESIGN.md`.

## Testing
- Scenario rule: every testable state has a scenario (`/workflow?scenario=…`, listed on `/dev`). Scenarios only touch the **Sandbox** workspace (fake provider), so they work on production.
- Unit for domain logic and adapters (MSW fixtures for Instagram); integration against local Supabase incl. RLS; one Playwright spec per feature, driven by scenarios.
- CI: PR gate (lint/types/build, unit, e2e desktop sharded) each job ≤ 5 min; main runs the full suite (phone, visual, `@full`) then deploys.
- Live checks with a real tester account only in checkpoint tickets (Instagram connect, publish, stats).
- Definition of Done: `dev-workflow` skill.
