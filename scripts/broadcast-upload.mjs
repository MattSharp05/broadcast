#!/usr/bin/env node
// Queues a finished video on Broadcast through the content API (BC-17, docs/content-api.md).
// For video-editor sessions and any other agent: no dependencies, Node 22's fetch only.
//
//   BROADCAST_URL=https://… BROADCAST_API_KEY=bc_live_… \
//   node scripts/broadcast-upload.mjs --file render.mp4 --caption "Day 42" \
//     --accounts codingjourney,trip.app [--pin 2026-11-08T12:00] [--json]
//
// Three steps: ask for an upload URL, PUT the file straight to storage, queue it. The API only
// queues; the scheduler publishes at the scheduled time. Prints each post's scheduled time.
// Exit codes: 0 queued, 1 refused or failed, 2 wrong usage.
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `Usage: node scripts/broadcast-upload.mjs --file <video.mp4> --accounts <handle,handle>
         [--caption "<text>" | --caption-file <path>] [--pin <YYYY-MM-DDTHH:MM>] [--json]
Environment: BROADCAST_URL (the dashboard's address) and BROADCAST_API_KEY (from /dev/api-keys).`;

function usage(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

let args;
try {
  args = parseArgs({
    options: {
      file: { type: "string" },
      caption: { type: "string" },
      "caption-file": { type: "string" },
      accounts: { type: "string" },
      pin: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  }).values;
} catch (err) {
  usage(err.message);
}
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const base = (process.env.BROADCAST_URL ?? "").trim().replace(/\/+$/, "");
const key = (process.env.BROADCAST_API_KEY ?? "").trim();
if (!base) usage("BROADCAST_URL is not set.");
if (!key) usage("BROADCAST_API_KEY is not set.");
if (!args.file) usage("--file is required.");
const accounts = (args.accounts ?? "")
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean);
if (accounts.length === 0) usage("--accounts is required (comma-separated handles).");

const caption =
  args["caption-file"] !== undefined
    ? (await readFile(args["caption-file"], "utf8")).trim()
    : (args.caption ?? "");

/** Never prints the key: errors show the API's message only. */
function fail(step, status, body) {
  const message = body?.message ?? `HTTP ${status}`;
  if (args.json) console.log(JSON.stringify({ ok: false, step, status, ...body }));
  else
    console.error(`${step} failed (${status}${body?.error ? `, ${body.error}` : ""}): ${message}`);
  process.exit(1);
}

async function api(path, body, step) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    fail(step, 0, { error: "network", message: `Couldn't reach ${base}: ${err.message}` });
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: "bad_response", message: text.slice(0, 200) };
  }
  if (!res.ok) fail(step, res.status, json);
  return json;
}

const file = args.file;
let bytes;
try {
  bytes = (await stat(file)).size;
} catch {
  usage(`Can't read ${file}.`);
}
const contentType = extname(file).toLowerCase() === ".mov" ? "video/quicktime" : "video/mp4";

// 1. An upload URL for this file.
const ticket = await api(
  "/api/content/uploads",
  { file_name: basename(file), bytes, content_type: contentType },
  "Upload request",
);

// 2. The file goes straight to storage (never through the app's server).
const put = await fetch(ticket.upload_url, {
  method: ticket.method ?? "PUT",
  headers: { "content-type": ticket.content_type ?? contentType },
  body: await readFile(file),
});
if (!put.ok) {
  fail("Upload", put.status, { error: "upload_failed", message: (await put.text()).slice(0, 200) });
}

// 3. Queue it.
const queued = await api(
  "/api/content",
  {
    upload_id: ticket.upload_id,
    caption,
    accounts,
    timing: args.pin ? { pinned_at: args.pin } : "next_slot",
  },
  "Queueing",
);

if (args.json) {
  console.log(JSON.stringify({ ok: true, ...queued }));
} else {
  console.log(queued.message);
  for (const post of queued.posts) {
    const when = post.scheduled_at ?? "waiting for a slot (the account has no posting times)";
    console.log(
      `  @${post.handle}  ${when}${post.status === "paused" ? "  (paused: the account needs attention)" : ""}`,
    );
  }
}
