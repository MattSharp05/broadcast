# Content API

How a video-editor session (or any agent) queues a finished render on Broadcast. The API **only
queues**: the scheduler publishes each post at its time, exactly as for videos added on the
dashboard. Decision record: `docs/decisions/0005-uploads-and-content-api.md`.

## Quick start

1. On the dashboard, open **/dev/api-keys**, name a key (e.g. `video-editor`), pick the
   workspace and create it. Copy the key: it is shown once. Only a hash is stored.
2. Set two environment variables where the session runs:
   - `BROADCAST_URL`: the dashboard's address, e.g. `https://broadcast.example.com`
   - `BROADCAST_API_KEY`: the key (`bc_live_…` or `bc_sandbox_…`)
3. Run the script from this repository (Node 22, no dependencies):

```sh
node scripts/broadcast-upload.mjs --file render.mp4 --caption "Day 42: …" \
  --accounts codingjourney,trip.app
```

It prints where each post landed:

```
Added to 2 queues. First post Tomorrow, 09:00.
  @codingjourney  2026-11-06T09:00:00.000Z
  @trip.app  2026-11-06T12:00:00.000Z
```

Options:

| Option | Meaning |
|---|---|
| `--file <path>` | The video (MP4 or MOV). Required. |
| `--accounts <a,b>` | Handles (with or without `@`) or account ids, comma-separated. Required. |
| `--caption "<text>"` / `--caption-file <path>` | The caption (up to 2,200 characters). |
| `--pin <time>` | Pin to a time instead of the next open slot: `2026-11-08T12:00` is read in the workspace's timezone; `2026-11-08T12:00:00Z` is absolute. |
| `--json` | Print the API's JSON response (`{ ok, media_id, message, posts }` or `{ ok: false, step, status, error, message }`). |

Exit code 0 means queued, 1 refused or failed (the message says why), 2 wrong usage.

## The video

The same rules as the dashboard's Add content: MP4 or MOV, H.264 or HEVC, **9:16** (1080 × 1920
is best, at most 1920 pixels wide), **3 to 90 seconds**, **up to 50 MB**. The server reads the
uploaded file itself (no trust in what the client says) and refuses anything else with the same
messages the dashboard shows. A refused file is deleted; upload a fixed render again.

## Keys

- A key belongs to one workspace and can only queue to that workspace's accounts. A Sandbox key
  naming a Live account gets `403 wrong_workspace` (and the other way round).
- Revoking a key on /dev/api-keys stops it on its next request.
- Sandbox keys are deleted whenever a scenario loads (the Sandbox is reset). Make a new one after.
- Each key may ask for 30 uploads per hour.

## HTTP, step by step

All requests: `Authorization: Bearer <key>`, JSON bodies up to 16 KB. Errors are
`{ "error": "<code>", "message": "<what to do>" }`.

**1. `POST /api/content/uploads`** with `{ "file_name": "render.mp4", "bytes": 12345678,
"content_type": "video/mp4" }` (`content_type` optional) →
`201 { upload_id, upload_url, method: "PUT", content_type, expires_at }`.

**2. `PUT <upload_url>`** with the file as the body and `Content-Type: <content_type>`. The
file goes straight to storage, never through the app. The URL works for two hours.

**3. `POST /api/content`** with

```json
{
  "upload_id": "…",
  "caption": "Day 42: …",
  "accounts": ["codingjourney", "@trip.app"],
  "timing": "next_slot"
}
```

(`timing` may also be `{ "pinned_at": "2026-11-08T12:00" }`) →
`201 { media_id, message, posts: [{ id, account_id, handle, status, scheduled_at }] }`.
`scheduled_at` is UTC; it is null when the account has no posting times yet. `status` is
`queued`, or `paused` when the account needs attention (it posts once reconnected).

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_request` | The body isn't what the endpoint expects (the message says which field). |
| 401 | `unauthorized` | No key, an unknown key or a revoked key. |
| 403 | `wrong_workspace` | An account is in the other workspace. |
| 404 | `upload_not_found` | No such upload in this key's workspace. |
| 409 | `upload_missing` | The file hasn't arrived yet: finish the PUT, then send step 3 again. |
| 409 | `upload_used` | This upload was already queued. Each upload is queued once. |
| 410 | `upload_expired` | The upload is over two hours old. Start again. |
| 413 | `too_large` | The JSON body is over 16 KB. |
| 422 | `invalid_file` / `invalid_video` | The file breaks a Reels rule (message as on the dashboard). |
| 422 | `unknown_account`, `caption_too_long`, `pinned_past`, `pinned_invalid` | Fix and send step 3 again with the same upload. |
| 429 | `rate_limited` | Too many uploads this hour; see `Retry-After`. |
