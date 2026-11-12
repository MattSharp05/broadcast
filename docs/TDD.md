# Technical Design: Broadcast
Status: Approved (2026-11-06, with the PRD) · PRD: https://app.notion.com/p/40f24983f3ca81b69b0be91b3b8dc5ff

## Stack
| Piece | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language for UI, API, scheduler and tests |
| App | Next.js 15 (App Router, React 19, server actions + route handlers) | UI and API in one deploy; Vercel's native framework |
| Styling | Plain CSS with design tokens (`src/styles/tokens.css`) + CSS Modules | `docs/DESIGN.md` is token-based; no utility-class soup, no UI kit look |
| Database | Supabase Postgres + RLS, migrations in `supabase/migrations` | Free tier, Postgres, local stack in Docker for tests |
| Auth | Supabase Auth, email magic link, one allowed email (`ALLOWED_EMAIL`) | Single user; no passwords to manage |
| File storage | Supabase Storage, private bucket `videos`, signed URLs | Instagram fetches from a short-lived signed URL; browser uploads direct |
| Scheduler | Supabase `pg_cron` + `pg_net` calling `POST /api/cron/tick` every minute | Vercel Hobby cron is daily only; logic stays in the Next.js codebase (ADR 0002) |
| Hosting | Vercel Hobby (production deploys from `main` only) | Free; previews off in batched QA mode |
| Unit tests | Vitest | Fast, TS-native |
| E2E | Playwright (Chromium desktop + one phone layout), runner + `playwright install --with-deps` in CI (needs Docker for Supabase) | Matches the workflow's CI rules |
| HTTP mocking | MSW for Instagram Graph API in tests | Recorded responses; live checks happen in checkpoint tickets |

## Architecture
```
Browser (dashboard) ──server actions / route handlers──► Next.js on Vercel
                                                          │  lib/domain (pure: queue planner, state machines)
                                                          │  lib/providers (SocialProvider: instagram | fake)
                                                          │  lib/db (typed Supabase clients: user + service role)
pg_cron (every min) ──pg_net POST /api/cron/tick──────────┘
                                                          ▼
                                    Supabase Postgres + Storage ◄── Instagram Graph API (fetches video URL)
video-editor session ── POST /api/content/uploads + /api/content (API key) ──► same handlers
```
- **Domain core is pure** (`src/lib/domain`): the queue planner (slots + backlog + pins → times), the publish state machine and the stats schedule are plain functions with unit tests. Handlers load rows, call the core, save the result.
- **`SocialProvider` interface** (`src/lib/providers`): `authorizeUrl`, `exchangeCode`, `refreshToken`, `getProfile`, `getPublishingQuota`, `createReelContainer`, `getContainerStatus`, `publishContainer`, `getMediaInsights`, `getFollowerCount`. Implementations: `instagram` (Instagram API with Facebook Login on graph.facebook.com v25.0, signed in through Facebook Login for Business with a configuration; ADR 0006) and `fake` (deterministic, in-DB, used by the Sandbox workspace, scenarios and e2e). TikTok is a third implementation in v1.
- **Scheduler tick** is idempotent and short (< 20 s): each call claims due work rows with `UPDATE … WHERE status = … RETURNING` (no double processing), advances each one step, and returns. Long waits (Instagram processing a container) span several ticks.

## Project structure
```
src/
  app/                    routes: (app)/workflow, (app)/accounts, (app)/factory, login, dev, api/*
  components/             shared UI (Button, Drawer, Modal, Table, Toast, Popover…)
  features/
    canvas/               Workflow canvas: engine (pan/zoom/minimap) + content (band, cards, arrows)
    accounts/             Accounts table, wizard
    content/              Add content modal, upload
    drawers/              post / account / slot detail drawers
  lib/
    domain/               pure logic (queue planner, publish machine, stats schedule)
    providers/            SocialProvider + instagram + fake
    db/                   Supabase clients, generated types, queries
    crypto/               token encryption
    scenarios/            scenario definitions + loader
  styles/                 tokens.css, globals.css
supabase/migrations/      SQL migrations (schema, RLS, cron)
tests/e2e/                Playwright specs (one per feature) + fixtures
scripts/                  broadcast-upload.mjs (CLI for video-editor), dev helpers
docs/                     TDD, DESIGN, decisions/, vision-mockup.html
```

## Data & state
All tables carry `workspace_id`. Two workspaces exist from the first migration: **Live** (real accounts) and **Sandbox** (fake-provider accounts used by scenarios, e2e and demos). See ADR 0003.

| Table | Key columns |
|---|---|
| `app_settings` | one row: allowed_email (written by the server from `ALLOWED_EMAIL`; RLS reads it). Service role only |
| `workspaces` | id, name, kind (`live`/`sandbox`); fixed ids `…0001` Live, `…0002` Sandbox (`src/lib/db/workspaces.ts`) |
| `settings` | workspace_id, timezone (IANA; default set from the browser at first login) |
| `brands` | id, workspace_id, name |
| `social_accounts` | id, brand_id, platform (`instagram`/`fake`; `tiktok` in v1), platform_user_id, handle, profile_url, description, tags text[], slots text[] (`HH:MM`), status (`ready`/`needs_attention`/`not_connected`), status_reason, vault_url, followers |
| `oauth_credentials` | account_id, access_token_enc, refresh_token_enc, expires_at, scopes text[], last_refreshed_at. **No RLS policy for the browser**: service role only |
| `oauth_states` | state, platform, brand_id, created_at (10-min expiry) |
| `media_assets` | id, workspace_id, storage_path, thumbnail_path, duration_s, width, height, bytes, deleted_at |
| `posts` | id, account_id, media_id, caption, timing (`queue`/`pinned`), queue_position, scheduled_at, status (`queued`/`publishing`/`published`/`failed`/`paused`/`removed`), container_id, media_ig_id, permalink, attempts, next_attempt_at, last_error, published_at |
| `post_metrics` | post_id, stat_offset (`1h`/`6h`/`24h`/`48h`/`7d`; `offset` is reserved in SQL and PostgREST), due_at, taken_at, views, reach, likes, comments, shares, saves |
| `account_metrics` | account_id, day, followers |
| `api_keys` | id, workspace_id, name, key_hash (not readable by browser roles), last_used_at, revoked_at |
| `job_log` | id, kind, post_id/account_id, ok, message, at |
| `productions` | Content Factory video (ADR 0007): idea, style, use_avatar, avatar_id + version, face_model override, voice_key, music_key, account_id (one), status, step_modes, script, caption + options, media_id, post_id, remake_of, session_url |
| `production_steps` | production_id, step (`idea`/`script`/`style`/`visuals`/`face_quote`/`render`), status, progress, output (checkpoint), attempt |
| `production_reworks` | production_id, target (script_line/scene/voice/music/caption/avatar_slot), ref, quote_usd, status |
| `avatars` / `avatar_versions` | one avatar per account; profile (avatar.json), studio state, current_version; versions keep each saved profile |
| `factory_settings` | per workspace: caps ($5/video, $50/month), enabled face models, default + fallback, default step modes |
| `factory_voices` / `factory_music` | shared catalogues (no workspace_id): label, licence, credit, source_url, sample_url |
| `gen_keys` | provider keys, encrypted (TOKEN_ENC_KEY), last4. Service role only |
| `gen_jobs` | the spend log: slot, model, idempotency_key (unique), seconds, quote_usd, cost_usd, status, output_url |
| `factory_tokens` | hashed, expiring session tokens for one production. Service role only |

- **Queue planning:** after any change to an account's slots or posts, `planQueue(slots, timezone, now, posts)` recomputes `scheduled_at` for that account's `queue` posts (pinned posts keep their time and take their slot). Open slots are derived, not stored.
- **Publishing:** `queued` → (due, quota ok) create container → `publishing` (container_id stored) → poll status each tick → publish → `published` (media id + permalink) → delete the video file, keep the thumbnail. Errors: backoff 1, 2, 4 min; after 3 failures `failed` with `last_error`. A post whose account is `needs_attention` is `paused`. A container is never created twice for one post; the container is checked before every publish, and one that is already `PUBLISHED` (a timed-out or crashed publish) is matched to the account's recent media by caption and time instead of being published again. Quota used up → the post waits for the account's next slot (no retry used). Publishing queues the stats rows (trigger in `0004_publish.sql`). Instagram posts are only claimed when `IG_APP_ID`/`IG_APP_SECRET`/`IG_LOGIN_CONFIG_ID` and `TOKEN_ENC_KEY` are set.
- **Stats:** after publishing, rows are due at +1h, +6h, +24h, +48h, +7d; the tick's `collectStats` step (after publishing, in what is left of the budget) claims up to 5 posts with a due row (`claim_work('stats')`) and makes one insights call each. After downtime only the latest due offset gets the numbers; earlier overdue ones are marked `missed` (no numbers). A metric Instagram doesn't report is stored as null and shown as "—". Failures back off the post (15 min, or 60 min for rate limits and token problems). Followers once a day per ready account (workspace-local day), at most 5 accounts per tick; a failed count waits an hour.
- **Tokens:** long-lived tokens (about 60 days) are refreshed when older than 24 h and within 7 days of expiry; failure → account `needs_attention`. Instagram's are Facebook Login user tokens, which Meta doesn't renew for a server (`refreshToken` → `not_renewable`): the account waits until 3 days before expiry, then goes `needs_attention` with the date, and a Reconnect stores a new 60-day token (ADR 0006). The stored expiry is the earliest of the token's and the data-access expiry (`debug_token`).
- **Connect (Instagram):** Facebook dialog with `config_id` → code → short-lived → long-lived user token → `debug_token` (permissions, expiry, shared Instagram accounts) + `/me/accounts` (Page → `instagram_business_account`). One login can share several accounts: Reconnect takes its own, a new connect the only (new) one, else it asks to share one (`chooseAccount`). Every user-token call sends `appsecret_proof`.

## Scenario system
- Scenarios live in `src/lib/scenarios/*.ts`, each a function that resets the **Sandbox** workspace and seeds a deterministic state (fixed clock via `?now=` and a seeded RNG). Examples: `canvas-busy` (5 accounts, queues, posted history, one failure, one expired account), `empty-account`, `add-content`, `publish-due-now`, `quota-exhausted`, `stats-due`.
- Load with `/workflow?scenario=canvas-busy` (switches to Sandbox, resets it, then shows the page). `/dev` lists every scenario with a link.
- Scenarios only ever touch the Sandbox workspace and the `fake` provider, so they stay **enabled in production** (QA happens there in batched mode). The Live workspace is never reset.
- e2e tests use the same scenario links.

## Testing strategy
- **Unit (Vitest):** domain core (queue planner incl. DST and pins, publish machine, backoff, stats schedule), crypto, provider adapters against MSW fixtures, route handler validation.
- **Integration:** handlers against the local Supabase stack (`supabase start` in CI), RLS checks (browser role can't read `oauth_credentials`).
- **E2E (Playwright):** each feature has a spec driven by a scenario. Desktop Chromium on PRs; phone layout + visual baselines on main.
- **Live checks** (checkpoint tickets, manual): real Instagram OAuth with a tester account; one real Reel published to a test account; stats fetched for it.
- **CI pipeline (two levels, every PR job ≤ 5 min):**
  - PR gate in parallel: lint + typecheck + build; unit; e2e desktop (sharded) with local Supabase.
  - "What changed" job adds phone e2e + visual when UI/CSS changes; everything when CI/config/deps change; nothing extra for docs-only.
  - Push to main: full suite (all projects, visual, `@full` tests), then Vercel production deploy (Vercel's Git integration) and `supabase db push` to the production project.
  - e2e jobs run on the GitHub runner (Supabase needs Docker, which a Playwright-image container job lacks), with Chromium from `playwright install --with-deps` at the lockfile's Playwright version (BC-8).

## Environments & deploy
- **Local / cloud sessions:** `pnpm dev` + `supabase start` (Docker). `.env.local` from `.env.example`; Instagram calls use the fake provider unless `IG_APP_ID` is set.
- **PRs:** CI only (no Vercel previews in batched QA mode).
- **Production:** Vercel project `broadcast`, deploys from `main`; Supabase project `broadcast` (free tier). Migrations applied by the main pipeline.
- **Secrets** (Vercel env + GitHub Actions secrets): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD` (CI migrations), `ALLOWED_EMAIL`, `TOKEN_ENC_KEY` (32 random bytes, base64; also encrypts generation keys), `CRON_SECRET`, `FACTORY_ROUTINE_ID` + `FACTORY_ROUTINE_TOKEN` (Content Factory routine; optional), `IG_APP_ID`, `IG_APP_SECRET` (the Meta app's App ID and secret), `IG_LOGIN_CONFIG_ID` (Facebook Login for Business configuration), `APP_URL`.

## Conventions
- Package manager pnpm; Node 22. ESLint (next + typescript-eslint strict) and Prettier.
- Server-only modules import `server-only`; the service-role client lives only in `src/lib/db/admin.ts`.
- Times are stored in UTC (`timestamptz`); converted with the workspace timezone only for display and slot maths.
- UI follows `docs/DESIGN.md`. User-facing copy in sentence case, verbs on buttons.
- Every new state gets a scenario and an e2e spec (Scenario rule).

## Risks & open questions
- **Meta tester access long-term:** App Review may be needed as accounts grow. Spike after the MVP works.
- **Supabase free-tier pausing** after 7 days without activity: the per-minute cron calls the app, not the database API; if the project still pauses, Supabase Pro is about $25/mo (decision for Matthew, not taken).
- **Vercel Hobby function limits:** ticks are kept short by design; uploads never pass through Vercel (signed URLs).
- **Instagram format rules:** Reels must be 9:16, 3–90 s for full reach. The uploader checks before queueing.
- **50 MB per file** on Supabase free storage; the uploader rejects larger files with a clear message.
