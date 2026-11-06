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
- Preview URLs: batched QA mode: none (`vercel.json` → `"git": { "deploymentEnabled": { "**": false, "main": true } }`), since CI builds every PR and QA happens on production. Production: TBD (Epic 0)
- QA mode: batched (2–3 waves per batch; batch ends at checkpoints). Always tested before building on them: Instagram connection (OAuth + token storage), the scheduler's publish step, the content API's auth.
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
TBD in the technical design (`/plan-work`). Proposed: Next.js (React + TypeScript) on Vercel,
Supabase (Postgres, auth, storage, `pg_cron`).

## Commands
TBD after the technical design.

## Structure
TBD after the technical design.

## Conventions
TBD after the technical design.

## Testing
TBD after the technical design.
