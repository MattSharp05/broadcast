# Factory API (for Claude sessions in video-editor)

How a Claude Code session makes one step of a Content Factory video (ADR 0007). The dashboard
starts the session through the routines API; the session reads the brief from Broadcast, does
the step in `video-editor`, and posts the result back. Sessions are stateless: everything they
need is in Broadcast's database and the project folder (`projects/<project_slug>/`).

The video-editor side follows `.claude/skills/broadcast-factory/SKILL.md`.

## What a session is given
The routine's fire payload (or the prompt Matthew pastes) has these lines:

```
Broadcast Content Factory step. Follow .claude/skills/broadcast-factory/SKILL.md.
BROADCAST_URL=https://broadcast-iota-murex.vercel.app
BROADCAST_TOKEN=bcf_live_…
BROADCAST_VIDEO_ID=<production id>
STEP=script
NOTE=shorter hook            (only on a redo)
BATCH=<review batch id>      (only on STEP=revise)
```

`STEP` is one of the pipeline steps below, or `revise`: answer a batch of Matthew's notes on a
version with a new version (see "Versions and revise").

`BROADCAST_TOKEN` is a **factory token**: scoped to this one video, valid for 24 hours, stored by
Broadcast as a hash only. It is not the content API key and never a provider key (fal and the
others stay in Broadcast; see "Generation proxy"). Every request sends
`Authorization: Bearer $BROADCAST_TOKEN`. A token for another video gets 403; an expired or
unknown one gets 401.

Errors are JSON `{"error": "<code>", "message": "<what to do>"}`.

**Intent.** `progress`, `checkpoint`, `fail` and `versions` take an optional `intent`: one line
saying what you are doing and why ("Re-timing the title so it lands on the beat"), at most 160
characters (longer is cut). Each one is shown in the video's activity feed with the step and your
session link. Send one on every call.

## Steps
`idea → script → style → visuals → face_quote (avatar videos only) → render`. Each step is
`running` while the session works, then `waiting` (Matthew approves on the page) or approved at
once on autopilot. Approving a step starts the next one in a new session. A session only ever
works on `STEP`.

## Endpoints

### `GET /api/factory/{id}/brief`
Everything the step needs:

```json
{
  "video": {
    "id": "…", "title": "How tides work", "idea": "…", "style": "realistic-3d",
    "project_slug": "how-tides-work-1a2b3c", "account": "@maya.explains",
    "use_avatar": true, "avatar": { "name": "Maya", "version": 1, "profile": { "…avatar.json…": "" } },
    "face_model": { "key": "fal-kling-avatar-std", "fallback": "placeholder", "price_usd_per_s": 0.0562, "max_s": 300 },
    "voice": { "key": "design-m2", "label": "…", "model": "Qwen3-TTS-12Hz-1.7B-Base", "sample_url": "https://…/factory/voices/design-m2.mp3", "credit": "Voice: AI (Qwen3-TTS)" },
    "music": { "key": "floating-cities", "title": "Floating Cities", "artist": "Kevin MacLeod", "licence": "CC BY 4.0", "credit": "Music: …", "source_url": "https://incompetech.com/…" },
    "script": { "version": 2, "hook": "…", "lines": [{ "id": "l1", "text": "…", "slot": "hook" }] }
  },
  "step": { "name": "render", "attempt": 2, "note": "warmer voice" },
  "outputs": { "idea": { }, "script": { }, "style": { }, "visuals": { }, "face_quote": { } },
  "reworks": [{ "target": "voice", "ref": null, "note": "warmer", "status": "running" }],
  "face_clips": [{ "slot": "hook", "job_id": "…", "status": "completed", "output_url": "…", "kept": true }],
  "budget": { "spent_video_usd": 0.84, "spent_month_usd": 2.04, "cap_video_usd": 4, "cap_month_usd": 50, "remaining_usd": 3.16 },
  "versions": [{ "id": "…", "number": 2, "url": "https://…signed, 2 h…", "duration_s": 58.4, "fps": 30, "git_sha": "3f2c1ab", "made_by": "render" }],
  "batch": {
    "id": "…", "version_number": 2,
    "notes": [
      { "id": "…", "number": 1, "kind": "moment", "t_s": 3.2, "frame": 96, "box": null, "text": "Title lands late", "crop_url": "https://…" },
      { "id": "…", "number": 2, "kind": "region", "t_s": 12.5, "frame": 375, "box": { "x": 0.1, "y": 0.6, "w": 0.4, "h": 0.2 }, "text": "Make this label bigger", "crop_url": "https://…" },
      { "id": "…", "number": 3, "kind": "general", "t_s": null, "frame": null, "box": null, "text": "Music a little quieter", "crop_url": null }
    ]
  }
}
```

`versions` lists every kept version, newest first; `url` is the 720p proxy when there is one, else
the full file (signed, valid 2 hours; `null` once a version is pruned). `batch` is the open review
batch (only while one is open, so on `STEP=revise`): its notes are on version `version_number`.
`frame = round(t_s × fps)` of that version; `box` is normalised 0–1 from the top left. `crop_url`
is the frame Matthew pointed at, as he saw it in the browser (JPEG).

`voice.key` names a voice in video-editor's `lab/voice-picker/library/voices.json` (its reference
clip and text); the session clones every line from that clip, so the video sounds like the sample.
A new voice in `factory_voices` needs its reference clip added there under the same key.

`face_clips` lists the paid clips already made. **On any rework other than an avatar slot, reuse
them and keep each avatar slot's audio exactly as it was**: the proxy returns the kept clip for a
slot whatever idempotency key is sent, so nothing is generated or charged again.

### `POST /api/factory/{id}/progress`
`{"step": "render", "progress": 60, "message": "Rendering scene 3 of 5."}` → `204`. Shown as the
progress bar. Send it every minute or so on long steps.

### `POST /api/factory/{id}/assets`
`{"name": "s1.jpg", "content_type": "image/jpeg"}` → `{"path": "storage:…", "upload_url": "…"}`.
`PUT` the file to `upload_url` (no auth header; the URL is signed, valid 2 hours). Use the
returned `path` in a checkpoint (`frames`, `stills`), or as an `image`/`audio` for the
generation proxy when a data URI would be over 3 MB. Images: JPEG only; audio: `audio/wav`,
`audio/mpeg`; video: `video/mp4`.

### `POST /api/factory/{id}/checkpoint`
`{"step": "<STEP>", "output": { … }}` → `{"status": "waiting" | "approved", "next_step": "…" | null}`.
Outputs per step (extra fields are kept):

| Step | `output` |
|---|---|
| `idea` | `{"title", "brief", "audience", "hook"}` |
| `script` | `{"version", "hook", "lines": [{"id", "text", "slot"?}]}` (`slot` marks avatar cut-in lines) |
| `style` | `{"frames": [{"url", "caption"}]}` |
| `visuals` | `{"stills": [{"url", "scene", "caption"}], "cards"?: [{"scene", "text", "seconds", "still"}]}` (`scene` ids `s1`…, used by "redo a scene"; `cards` is the storyboard, below) |
| `face_quote` | `{"model", "slots": [{"slot", "seconds"}], "quote": {"model", "seconds", "baseUsd", "rerollUsd", "totalUsd", "free"}}`, from `gen_face.py quote` |
| `render` | `{"upload": "<path from /assets>", "proxy"?: "<path from /assets>", "git_sha", "duration_s", "fps"?, "loudness_lufs"?, "true_peak_db"?, "face_share", "imagery_credits": ["Earth imagery: NASA."], "caption_options"?: ["…"]}` |

For `render`, upload the final MP4 through `/assets` first (`content_type: "video/mp4"`); Broadcast
checks it like any Reel (9:16, MP4, ≤ 50 MB), stores it with the video's **recipe** (style, avatar
and version, face model, face share, voice, music, hook, script version, cost) and drafts caption
options with the credit lines. `git_sha` (required, `git rev-parse HEAD` after committing the
film) and the optional `proxy` (a 720p MP4 ≤ 15 MB, also through `/assets`) are kept with the
version; `loudness_lufs` / `true_peak_db` come from `ffmpeg … ebur128` and feed the ready-to-post
checks. Each render becomes a new numbered **version** (see below). Do **not** queue it: posting
happens only from the dashboard.

**Storyboard (`visuals.cards`, BC-40).** Send the board with the visuals step: one card per beat,
in order, with what happens or is said (`text`, ≤ 280), its length (`seconds`), its scene id and a
still (`url`/`storage:` path). Broadcast replaces the board with them (and bumps `board_rev`).
Without `cards`, Broadcast estimates one card per still (text = caption, seconds = that scene's share
of the script at 2.5 words/s, marked "estimated"). Matthew edits, reorders and approves the board on
the Board tab; approving it approves the visuals step. The brief's `board` is
`{"rev", "approved_at", "cards": [{"position", "scene", "text", "seconds", "still_url", "status"}]}`:
render and revise sessions build from the approved board (Matthew's edits included).

### `POST /api/factory/{id}/fail`
`{"step": "style", "message": "Remotion couldn't load the paper texture."}` → `204`. The page
shows the message and a Redo button.

## Versions and revise (BC-36, ADR 0008)
Every render is kept as a numbered version (v1, v2, …) instead of replacing the last one. The
video's current version is the newest, unless one is already posted or scheduled. Storage (ADR 0008):
posted versions and the one chosen for posting are kept whole; of the others, the newest keeps its
full file and the newest 3 keep their proxy; anything older is pruned after each new version (files
deleted, the row stays with `pruned_at` and its `git_sha`, so it can be rebuilt).

Matthew watches a version on the page, pins notes to moments (`moment`: a time), regions
(`region`: a time and a box) or the whole video (`general`), and sends them as one **batch**. That
starts a session with `STEP=revise` and `BATCH=<id>`; only one batch per video is open at a time.

A revise session: reads `batch` from the brief, extracts each note's exact frame from its version
(`ffmpeg -ss <t_s> -i <url> -frames:v 1`), changes only what the notes ask, renders, uploads the
full MP4 and the proxy through `/assets`, then posts the new version with one answer per note:

### `POST /api/factory/{id}/versions`
```json
{
  "batch_id": "…", "upload": "storage:videos/…", "proxy": "storage:videos/…",
  "git_sha": "3f2c1ab", "duration_s": 58.4, "fps": 30, "loudness_lufs": -14.2, "true_peak_db": -1.5,
  "intent": "Moved the title in 6 frames and enlarged the label; music left as is.",
  "answers": [
    { "note_id": "…", "verdict": "answered", "reply": "The title now lands on the beat (frame 90)." },
    { "note_id": "…", "verdict": "not_changed", "reply": "The label is the brand font's maximum size at 1080 wide." }
  ]
}
```
→ `201 {"version": "<version id>", "number": 3}`.

- Every note in the batch gets exactly one answer, `answered` or `not_changed` (with the reason in
  `reply`). Missing, duplicate or unknown notes → `422 answers_incomplete` and nothing is saved.
- The upload is checked like a render (9:16, MP4, ≤ 50 MB; the proxy ≤ 15 MB). `git_sha` is
  required.
- A batch of another video → `403 wrong_batch`; a batch that isn't open → `409 batch_closed`.
- The notes get your verdict and reply ("in v3"), the batch is answered, and the activity feed
  shows your intent. Still never queued.

## Import an existing project (BC-44)
For a video-editor project made before the factory (`projects/<slug>/`), a session brings it into
the studio as a video with v1. The call uses the **content API key** (`/dev/api-keys`, the same
`Authorization: Bearer` key as `/api/content`), not a factory token; it never queues anything.

```
POST /api/factory/import
  {"project_slug": "moon-tides-01", "title": "Moon tides", "idea": "<brief.md summary>", "style"?: "realistic-3d"}
  -> 201 {"video_id", "token"}                   token: a factory token for this video (24 h)
  -> 409 {"error":"already_imported","video_id"} the slug was imported before
```

The video has no account yet (Matthew picks one before scheduling) and every step is `skipped`
except `render`, which waits for v1. Upload the render (and proxy) through `/assets` with the token,
then post `POST /api/factory/{id}/versions` **without** `batch_id`:
`{"upload", "proxy"?, "git_sha", "fps"?, "loudness_lufs"?, "true_peak_db"?, "imagery_credits"?, "intent"}`
→ `201 {"version", "number": 1}` (`made_by: import`). The render then waits for Matthew like any
render. A video made in the pipeline refuses a version without a batch (`422 bad_batch`).

## Generation proxy (avatar clips)
Provider keys never leave Broadcast. `gen_face.py` with `FACE_VIA=broadcast` sends its paid calls
here; the caps and the job log live here.

```
POST {BROADCAST_URL}/api/gen/face-jobs        Authorization: Bearer {BROADCAST_TOKEN}
  {"video_id","slot","model","idempotency_key","image","audio","prompt","seed","seconds"}
  -> 200 {"job_id","status":"queued|running|completed","quote_usd","reused"?: "same_key|slot_kept"}
  -> 402 {"error":"budget","remaining_usd"}     cap would be exceeded: nothing started
  -> 200 + the existing job if the idempotency_key was seen before (never charge twice)
GET  {BROADCAST_URL}/api/gen/face-jobs/{job_id}
  -> {"status":"queued|running|completed|failed","output_url","cost_usd","error"}
GET  {BROADCAST_URL}/api/gen/models  -> {"default","fallback","models":[enabled models with price, max_s, status]}
```

- `video_id` must be the token's video. `image` and `audio` are data URIs, URLs, or `storage:`
  paths from `/assets`.
- A slot that already has a clip returns that clip (`reused: "slot_kept"`) unless Matthew asked to
  redo that avatar slot on the page (a paid rework, priced before it runs).
- Caps: the per-video cap (Settings, lowered by the avatar's `cost_cap_per_video_usd`) and the
  monthly cap. Over either: `402 budget`, nothing is submitted.
- `output_url` stays valid at least an hour (fal keeps results for an hour); download it at once.

## Hero 3D assets (BC-30)
For a film's focal object (a landmark, a product), a session can propose an AI-generated 3D model
instead of the three.js one. Contract agreed with video-editor's `hero-assets` skill
(`references/broadcast-contract.md`); registry mirrored in `src/lib/factory/mesh-models.json` with `node scripts/sync-mesh-models.mjs` (video-editor is the source of truth).

```
POST /api/factory/hero-proposals
  {"proposal_id","video_id","object","scene","reason","why_generate","on_screen","score",
   "input":{"mode":"image|text","prompt","image"},"suggested_model","estimate_usd","options":[…],
   "stills":[{"label","image"}],"stage":"proposal|comparison"}
  -> 200 {"proposal_id","status":"pending"}   idempotent on proposal_id + stage; a comparison adds its stills
GET  /api/factory/hero-proposals/{proposal_id}
  -> {"stage","status":"pending|decided","decision":null|{"choice","model","budget_usd","notes","reason","decided_at"}}
GET  /api/factory/hero-decisions
  -> [{proposal_id,video_id,object,score,stage,choice,model,cost_usd,reason,decided_at}]   (every decision: the skill learns from it)
POST /api/gen/mesh-jobs
  {"proposal_id","video_id","model","idempotency_key","mode","image","prompt","seed","options"}
  -> 200 {"job_id","status","quote_usd"} · 403 not_approved · 402 budget · 200 + the same job for a seen key
GET  /api/gen/mesh-jobs/{job_id} -> {"status","output_url" (Broadcast's copy of the .glb),"outputs","cost_usd","error"}
```

- Images are a PNG/JPEG data URI (stored by Broadcast), an https URL or a `storage:` path.
- Matthew decides on the production page: Keep three.js, Redo three.js with notes, or Generate with a
  model (each listed with its price and licence). After a comparison: Use generated, Keep three.js,
  Redo, or Generate again. A reason is always required. Autopilot never decides these.
- A mesh job runs only when the proposal's latest decision is `generate` with that model, and the
  server's quote (registry price + options) fits the decision's budget and the caps. The fal input is
  rebuilt from the registry; the client's `fal_input` and `quote_usd` are advisory.
- A result without a `.glb` fails the job. A finished `.glb` is copied into Broadcast's storage, so
  the URL outlives fal's.

## Sandbox
In the Sandbox workspace no session runs: a fake runner posts canned outputs (and a canned intent)
for every step, answers a sent batch at once with a new version and a canned reply per note, and
the proxy's fake provider "generates" clips at once at the quoted price, so the whole page can be
tested on production with no money (`/dev` → `factory-*` scenarios).
