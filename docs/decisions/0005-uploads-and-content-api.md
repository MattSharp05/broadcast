# 0005: Uploads go straight to Storage; the content API is two steps

## Context
Reels are up to 50 MB. Vercel functions accept at most a 4.5 MB body. video-editor sessions need a simple way to queue a render.

## Decision
- **Dashboard:**
  1. The browser asks the server for a signed upload URL.
  2. It uploads the file straight to Storage.
  3. It reads the duration and dimensions and grabs a thumbnail frame on a canvas.
  4. It submits the post details (caption, accounts, timing).
- **API** (API key in `Authorization: Bearer`):
  1. `POST /api/content/uploads` returns `{upload_url, upload_id}`.
  2. The client `PUT`s the file to that URL.
  3. `POST /api/content {upload_id, caption, accounts, timing}` queues the posts.

  The server checks the format (9:16, length, size) with ffprobe-free metadata from the client, or an MP4 box parse for API uploads. `scripts/broadcast-upload.mjs` wraps all three steps for video-editor.
- The API only queues. It never publishes.

## Consequences
- No large bodies pass through Vercel.
- API keys are stored hashed and can be revoked.
