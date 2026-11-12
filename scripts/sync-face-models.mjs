// Copies the face model registry from a video-editor checkout (default ../video-editor) into
// src/lib/factory/face-models.json (ADR 0007). Usage: node scripts/sync-face-models.mjs [path]
import { copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(process.argv[2] ?? "../video-editor");
const src = join(repo, ".claude/skills/avatar-cutins/scripts/face_models.json");
if (!existsSync(src)) {
  console.error(`No registry at ${src}. Pass the video-editor checkout as the first argument.`);
  process.exit(1);
}
copyFileSync(src, "src/lib/factory/face-models.json");
console.log("Synced src/lib/factory/face-models.json");
