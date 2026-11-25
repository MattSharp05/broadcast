# ADR 0009: Routines (autonomous planning, building and scheduling), video tags and genre

Status: Accepted (2026-11-25) · Builds on [ADR 0007](0007-content-factory.md) and
[ADR 0008](0008-studio.md) · Amends ADR 0008's "Posting stays Matthew's action"

## Context
The Content Factory makes one video at a time, and Matthew approves each step or turns on
autopilot per step. He wants to say "post 10 times a day on account A from the 26th to the 28th"
and have every video planned, made, checked, given a cover and caption, and scheduled without
him, each one built before its slot. He also wants rules he can reuse (references, a genre mix,
which voices to test, styles), no repeated ideas, and a way to compare how videos did by genre,
voice, song, routine and campaign tag.

## Decision
- **Templates and routines.** `routine_templates` keep the reusable part as `config` jsonb
  (`src/lib/domain/routines.ts` → `RoutineConfig`: references, styles, genre mix, voices, music,
  avatar, free-text rules). A `routines` row adds the time frame, posts a day per account, a
  daily window, lead time, how many videos build at once, a budget, tags, the accounts
  (`routine_accounts`), and **approval**: `auto` (a finished video that passes every check is
  scheduled at its slot) or `review` (it waits on the routine's page for Matthew's Approve).
  A routine copies the template's config, so editing a template never changes a running routine.
- **The schedule comes first.** Saving a routine lays out `routine_slots` with the pure
  `layoutSlots`: on each local day, `posts_per_day` times spread evenly across the window, for
  every account, inside `[starts_at, ends_at)`; `build_at = post_at − lead_minutes`. At most
  25 posts a day per account (Instagram's 50-per-24 h limit is shared with every other post) and
  400 slots per routine.
- **One planner session per routine.** "Plan videos" fires the same routines API trigger as the
  factory with `STEP=plan` and a routine-scoped factory token (`factory_tokens.routine_id`; a
  video's token can't call the planner API and vice versa). The session reads
  `GET /api/routines/{id}/brief` (rules, references, genre targets, allowed styles/voices/music,
  every past idea: the workspace's videos plus other routines' unbuilt briefs) and posts one brief
  per slot to `POST /api/routines/{id}/plan`. The plan is checked as a whole (every slot once,
  allowed keys only, genres in the mix, no idea repeating a past video or another slot:
  `duplicateOf`, word-overlap ≥ 0.5 or the same title) and refused with every issue otherwise.
  Matthew sees the plan and approves it ("Approve plan and start"). In the Sandbox the fake
  planner (`fakePlan`) answers at once.
- **One session per video.** A routine's video is a normal production with every step on
  autopilot, `run_mode = one_session`, the routine's tags, the brief's genre, style, voice and
  music, and `compare_styles = false`. It fires once with `STEP=all`: the session runs every step
  and posts each checkpoint; an auto-approved step marks the next one running without a new fire.
  A redo (Matthew's, or the routine's automatic retry) switches the video back to one session per
  step. Hero 3D assets are off for routine videos (the brief says `hero_assets: false`).
- **The check.** A routine's render checkpoint also carries the session's own review of its
  render (`review: {passed, notes}`), a cover (`cover`, a JPEG from `/assets`, and `cover_t_s`),
  `caption` and `hashtags`. Broadcast then saves the pack (credits added if missing), places the
  cover where the scheduler reads it and runs Mark ready's checks. A failed self-review, a failed
  step or failed checks redo the render (or the failed step) once, with the reason as the note;
  a second failure fails the slot. The video stays in the Content Factory either way.
- **The builder is a tick step** (`routines`, after `publishDue`): for each running or paused
  routine it follows scheduled posts (posted, failed, removed), advances building slots
  (finish, retry, fail, or note what a waiting video waits for), marks slots missed whose time
  passed more than 15 minutes ago before they were scheduled, and, while running and under
  budget, starts due slots (earliest post first, up to `max_parallel` building). A slot is
  claimed with a conditional update, so two ticks never start it twice. Over budget, the routine
  pauses itself with the reason.
- **Posting (amends ADR 0008).** Sessions still never queue or publish. Approving a routine's plan
  with approval `auto` is Matthew's decision to post its finished videos: the builder schedules
  them through the same `scheduleVersion` as "Assign and schedule" (pinned at the slot, or now
  inside the 15-minute grace time), and the scheduler publishes them like any post, with the
  quota check. With approval `review`, nothing is scheduled until Matthew approves each video.
- **Genre and tags on videos.** `productions.genre` (suggested list in `src/lib/domain/genres.ts`,
  any short label allowed) and `productions.tags` / `posts.tags` (campaign tags such as "Trip";
  a post shows its own tags plus its video's). The **Posts tab** lists every post with its video's
  title, idea, hook, script, genre, style, voice, song, routine, tags and stats, filters and
  sorts on all of them, compares stats at the same age (1 h … 7 d snapshots), and sums the
  filtered posts.

## Consequences
- The video-editor skill (`.claude/skills/broadcast-factory/SKILL.md`) needs two additions:
  `STEP=plan` (the planner) and `STEP=all` with the routine's render fields
  (`docs/factory-api.md` → Routines). Until then, live routines plan and build with sessions that
  don't know these steps; the Sandbox runs the whole loop with the fake planner and runner.
- The routines API trigger has an hourly fire limit; a routine posting every hour on several
  accounts can reach it. `max_parallel` and the lead time spread the fires out.
- Scheduled posts made by a routine are ordinary posts: they show on the canvas, can be moved or
  removed, and a removed post skips its slot.
- Every new table follows the usual rules (workspace_id with composite FKs, RLS
  `allowed_user_all`, explicit grants); `reset_sandbox()` clears the Sandbox's routines.
