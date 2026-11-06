import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md → Rules: the content API only queues videos; posting happens only through the
// scheduler and the dashboard. This walks every module the content API's routes can load and
// checks that none of them can reach a provider, the scheduler or the stored tokens.

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const ENTRIES = ["src/app/api/content/route.ts", "src/app/api/content/uploads/route.ts"];
const FORBIDDEN = [
  "src/lib/providers/",
  "src/lib/scheduler/",
  "src/lib/db/scheduler.ts",
  "src/lib/db/credentials.ts",
  "src/lib/db/connections.ts",
  "src/lib/crypto/",
];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // a package
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  throw new Error(`Can't resolve ${spec} from ${relative(ROOT, from)}`);
}

function importGraph(entries: readonly string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const todo = entries.map((e) => join(ROOT, e));
  for (let file = todo.pop(); file; file = todo.pop()) {
    if (graph.has(file)) continue;
    const source = readFileSync(file, "utf8");
    const specs = [...source.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g)].map(
      (m) => m[1] ?? "",
    );
    specs.push(...[...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? ""));
    const deps = specs.flatMap((s) => resolveImport(file, s) ?? []);
    graph.set(file, deps);
    todo.push(...deps);
  }
  return graph;
}

describe("the content API never publishes", () => {
  const graph = importGraph(ENTRIES);
  const files = [...graph.keys()].map((f) => relative(ROOT, f));

  it("walks the routes' imports", () => {
    expect(files).toContain("src/lib/db/posts.ts");
    expect(files).toContain("src/lib/db/videos.ts");
  });

  it("can't reach a provider, the scheduler or the tokens", () => {
    const reached = files.filter((f) => FORBIDDEN.some((bad) => f.startsWith(bad)));
    expect(reached).toEqual([]);
  });
});
