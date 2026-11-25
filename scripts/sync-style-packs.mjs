// Mirrors video-editor's style list (.claude/skills/animated-video/styles/README.md: the table
// plus each pack README's title) into src/lib/factory/style-packs.json. video-editor is the source
// of truth; example frames stay in public/factory/styles/.
// Usage: node scripts/sync-style-packs.mjs [path to the video-editor checkout]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStylesReadme } from "../src/lib/domain/factory/style-packs.ts";

const repo = resolve(process.argv[2] ?? "../video-editor");
const dir = join(repo, ".claude/skills/animated-video/styles");
const readme = join(dir, "README.md");
if (!existsSync(readme)) {
  console.error(
    `No styles README at ${readme}. Pass the video-editor checkout as the first argument.`,
  );
  process.exit(1);
}
const titles = {};
for (const m of readFileSync(readme, "utf8").matchAll(/\]\(([a-z0-9-]+)\/README\.md\)/g)) {
  const pack = join(dir, m[1], "README.md");
  if (!existsSync(pack)) continue;
  const title = /^#\s+(.+)$/m.exec(readFileSync(pack, "utf8"))?.[1];
  if (title) titles[m[1]] = title.trim();
}
const styles = parseStylesReadme(readFileSync(readme, "utf8"), titles);
if (!styles.length) {
  console.error(`${readme} has no styles table; not writing the mirror.`);
  process.exit(1);
}
// From the repo root whatever the working directory.
const out = fileURLToPath(new URL("../src/lib/factory/style-packs.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(styles, null, 2)}\n`);
execFileSync("pnpm", ["exec", "prettier", "--write", out], { stdio: "ignore" });
console.log(
  `Synced ${out} (${styles.length} styles, ${styles.filter((s) => s.has_pack).length} with packs)`,
);
