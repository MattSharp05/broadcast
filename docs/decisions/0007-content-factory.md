# ADR 0007: Content Factory (productions, runner, generation proxy)

Status: Accepted (2026-11-12, BC-24) · Tickets BC-24…BC-28

## Context
Matthew wants one Content Factory page for every video: idea → style → UGC avatar (yes/no) →
voiceover → music → visuals and render → rework → caption → schedule. Each production step runs
in a Claude Code cloud session in `video-editor`; paid generation (avatar face clips on fal) must
be visible, capped and never charged twice. Spec: video-editor `lab/avatar-studio-handoff.md`.

## Decision
- **State lives in Broadcast.** `productions` (one per video, one target account),
  `production_steps` (idea, script, style, visuals, face_quote for avatar videos, render; each
  `pending → running → waiting → approved`, or `failed`), `production_reworks`. Sessions are
  stateless: they read the brief and post checkpoints (`docs/factory-api.md`).
- **Runner.** Live fires the routines API (`FACTORY_ROUTINE_ID`, `FACTORY_ROUTINE_TOKEN`); while
  they are unset, the page shows the same payload as a prompt to paste. The **Sandbox uses a fake
  runner** that posts canned outputs at once (`src/lib/domain/factory/fake-outputs.ts`), like the
  fake social provider, so scenarios, e2e and production QA need no session and no money.
- **Approval or autopilot per step** (`step_modes` on the video, defaults in `factory_settings`).
  Autopilot approves the paid step (the face-clip quote) only when the quote fits under the caps.
- **Generation proxy** (`/api/gen/face-jobs`, `/api/gen/models`): provider keys in `gen_keys`,
  encrypted with `TOKEN_ENC_KEY` (AAD `gen_keys:<workspace>:<provider>`), service role only, never
  sent to the browser or a session. Every job is in `gen_jobs` (the spend log). Caps: per video
  (workspace setting, lowered by the avatar's `cost_cap_per_video_usd`) and per UTC month; over a
  cap → 402 `budget`, nothing starts. Defaults $5 / $50.
- **Paid clips are kept.** The proxy returns the existing job for a repeated idempotency key and
  for any slot that already has a clip, unless an open `avatar_slot` rework names that slot. So a
  voice, music, script or scene rework can never pay for face clips again.
- **Recipe on the media** (`media_assets.recipe`): style, avatar + version, face model, face share,
  voice, music, hook, script version, series, cost. A factory video (media with a recipe) can be
  posted to one account only (trigger `posts_one_account_per_video`); "Remake for account B"
  starts a new production from it.
- **Libraries** (`factory_voices`, `factory_music`) are shared catalogues without workspace_id,
  read-only for the browser, seeded by migrations. Sample clips are served from `public/factory/`
  (small, publicly licensed); new entries can point `sample_url` at Supabase Storage.
- **Factory tokens** (`bcf_<kind>_…`, SHA-256 in `factory_tokens`, 24 h, one production) are what
  a session uses; not the content API key.

## Consequences
- A real session needs the video-editor skill `.claude/skills/broadcast-factory/SKILL.md`.
- Avatar videos set `posts.is_ai_generated`, which the Instagram container creation passes on.
- Face model registry is mirrored from video-editor (`src/lib/factory/face-models.json`); re-sync
  with `node scripts/sync-face-models.mjs`.
