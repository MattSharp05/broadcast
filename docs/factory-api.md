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
```

`BROADCAST_TOKEN` is a **factory token**: scoped to this one video, valid for 24 hours, stored by
Broadcast as a hash only. It is not the content API key and never a provider key (fal and the
others stay in Broadcast; see "Generation proxy"). Every request sends
`Authorization: Bearer $BROADCAST_TOKEN`. A token for another video gets 403; an expired or
unknown one gets 401.

Errors are JSON `{"error": "<code>", "message": "<what to do>"}`.

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
  "budget": { "spent_video_usd": 0.84, "spent_month_usd": 2.04, "cap_video_usd": 4, "cap_month_usd": 50, "remaining_usd": 3.16 }
}
```

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
| `visuals` | `{"stills": [{"url", "scene", "caption"}]}` (`scene` ids `s1`…, used by "redo a scene") |
| `face_quote` | `{"model", "slots": [{"slot", "seconds"}], "quote": {"model", "seconds", "baseUsd", "rerollUsd", "totalUsd", "free"}}`, from `gen_face.py quote` |
| `render` | `{"upload": "<path from /assets>", "duration_s", "face_share", "imagery_credits": ["Earth imagery: NASA."], "caption_options"?: ["…"]}` |

For `render`, upload the final MP4 through `/assets` first (`content_type: "video/mp4"`); Broadcast
checks it like any Reel (9:16, MP4, ≤ 50 MB), stores it with the video's **recipe** (style, avatar
and version, face model, face share, voice, music, hook, script version, cost) and drafts caption
options with the credit lines. Do **not** queue it: posting happens only from the dashboard's
Schedule section.

### `POST /api/factory/{id}/fail`
`{"step": "style", "message": "Remotion couldn't load the paper texture."}` → `204`. The page
shows the message and a Redo button.

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
(`references/broadcast-contract.md`); registry mirrored in `src/lib/factory/mesh-models.json`.

```
POST /api/factory/hero-proposals
  {"proposal_id","video_id","object","scene","reason","why_generate","on_screen",
   "input":{"mode":"image|text","prompt","image"},"suggested_model","estimate_usd","options":[…],
   "stills":[{"label","image"}],"stage":"proposal|comparison"}
  -> 200 {"proposal_id","status":"pending"}   idempotent on proposal_id + stage; a comparison adds its stills
GET  /api/factory/hero-proposals/{proposal_id}
  -> {"stage","status":"pending|decided","decision":null|{"choice","model","budget_usd","notes","reason","decided_at"}}
GET  /api/factory/hero-decisions
  -> [{proposal_id,video_id,object,stage,choice,model,cost_usd,reason,decided_at}]   (every decision: the skill learns from it)
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
In the Sandbox workspace no session runs: a fake runner posts canned outputs for every step and
the proxy's fake provider "generates" clips at once at the quoted price, so the whole page can be
tested on production with no money (`/dev` → `factory-*` scenarios).
