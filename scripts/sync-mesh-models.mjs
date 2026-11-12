// Copies the hero 3D (mesh) model registry from a video-editor checkout (default ../video-editor)
// into src/lib/factory/mesh-models.json. The video-editor file is the source of truth: gen_mesh.py
// quotes from it and Broadcast re-quotes from this mirror, so prices, statuses (a pilot flipping a
// model to "ready"), inputs, outputs and licences must match on both sides.
// Usage: node scripts/sync-mesh-models.mjs [path]
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(process.argv[2] ?? "../video-editor");
const src = join(repo, ".claude/skills/hero-assets/scripts/mesh_models.json");
if (!existsSync(src)) {
  console.error(`No registry at ${src}. Pass the video-editor checkout as the first argument.`);
  process.exit(1);
}
const parsed = JSON.parse(readFileSync(src, "utf8"));
if (!Array.isArray(parsed.models)) {
  console.error(`${src} has no "models" array; not copying it.`);
  process.exit(1);
}
const out = "src/lib/factory/mesh-models.json";
copyFileSync(src, out);
// The upstream file is hand-formatted; keep the mirror in Prettier style so format:check passes.
execFileSync("pnpm", ["exec", "prettier", "--write", out], { stdio: "ignore" });
console.log(`Synced ${out} (${parsed.models.length} models)`);
