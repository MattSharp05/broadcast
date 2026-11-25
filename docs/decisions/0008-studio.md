# ADR 0008: Studio (versions, review notes, batches, delivery packs)

Status: Accepted (2026-11-24, BC-34) · Tickets BC-34…BC-45 · Builds on [ADR 0007](0007-content-factory.md) ·
Amended by [ADR 0009](0009-routines.md) (a routine with approval "auto" schedules its finished videos)

## Context
The Content Factory (ADR 0007) keeps one render per video: `productions.media_id`, and
`recordCheckpoint` deletes the previous media asset on every re-render. Reviewing a video means
comparing renders, pinning notes to frames, getting each note answered by the next render, and
ending with a pack that is ready to post. None of that works if each render overwrites the last.

## Decision
- **Versions instead of overwriting.** Every render is a row in `production_versions`, numbered
  per production from 1 (`unique (production_id, number)`), with its file (`media_id`, set once
  the full file is stored), a 720p proxy and a contact sheet in the `factory` bucket, its facts
  (duration, fps, size, bytes, loudness, true peak), who made it (`render`, `revise`, `import`)
  and a one-line intent (≤ 160). Rows never change after insert (trigger
  `production_versions_immutable`); the only updates allowed are filling in the file, proxy and
  facts once (from null) as the render finishes, pruning once (`media_id` / `proxy_path` cleared,
  `pruned_at` set; nothing is refilled after) and a deleted batch clearing `batch_id`. Batches,
  notes and packs reference versions through `(id, production_id, workspace_id)`, so they can
  never mix two productions' versions.
  `productions.media_id` stays the version chosen for posting (BC-36 sets it).
- **`git_sha` is required.** Each version records the video-editor commit it was rendered from,
  so a pruned version can be rebuilt exactly and every note answer points at real code.
- **Notes and batches.** `review_notes` are pinned to a version: `moment` (a time and its frame),
  `region` (a time, frame and a normalised `{x, y, w, h}` box) or `general` (neither); numbered
  per version; text 1–2000 characters. Lifecycle: `draft` → `sent` (sent together as one
  `review_batches` row: `sent → running → answered | failed`) → the next version answers the
  batch, and every sent note gets exactly one answer, `answered` or `not_changed`, with a reply
  (`src/lib/domain/factory/notes.ts` → `applyAnswers`; a missing, duplicate or unknown answer
  rejects the whole set) → Matthew marks it `resolved`. The batch records `answered_by_version`.
- **Activity feed.** `production_events`: one-line intents from the session, Matthew or the system,
  optionally with the step and the session link.
- **Storyboard.** `board_cards` (position, text ≤ 280, seconds, still, scene, `planned → approved →
  built`); `productions.board_rev` counts edits and `board_approved_at` records the approval.
- **Storage policy** (`src/lib/domain/factory/versions.ts` → `pruneSelection`): posted versions
  and the chosen one keep everything; the newest of the rest keeps its full file; the newest 3 of the
  rest keep their proxy; everything older is cleared down to the row and its contact sheet.
- **Delivery packs.** One `delivery_packs` row per version: cover (path and time), caption,
  hashtags, checks and a manifest, `ready_at` once every check passes
  (`src/lib/domain/factory/delivery.ts`: 9:16, ≤ 50 MB and 3–90 s from `src/lib/media/checks.ts`,
  caption ≤ 2200 as posted (with the pack's hashtags added) and with every credit line, ≤ 30 hashtags, the AI flag on avatar videos, and loudness
  −16…−12 LUFS / true peak ≤ −1 dBTP when the render reports them). `media_assets.cover_path` is
  the source of Instagram's `cover_url` (BC-43).
- **Posting stays Matthew's action.** A ready pack means the video can be posted, nothing more.
  Sessions never queue or publish; posting goes through the dashboard and the scheduler, as
  before (CLAUDE.md → Rules).

## Consequences
- Every studio table follows the usual rules: `workspace_id` with composite FKs, RLS with
  `allowed_user_all`, explicit grants, and everything cascades from `productions`, so
  `reset_sandbox()` clears the Sandbox's studio rows with its productions.
- Storage grows with renders until pruning runs; the pruning job itself (deleting files) comes with
  the API work (BC-36).
- Note and answer rules live in pure functions shared by the API routes and the UI.
