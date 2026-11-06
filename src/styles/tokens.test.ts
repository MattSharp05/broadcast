import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(ROOT, "src");
const TOKENS_FILE = join(SRC, "styles", "tokens.css");
const tokensCss = readFileSync(TOKENS_FILE, "utf8");

type TokenMap = Map<string, string>;

function parseDecls(block: string): TokenMap {
  const map: TokenMap = new Map();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1] ?? "", (m[2] ?? "").trim());
  }
  return map;
}

/** Body of the first `{ … }` block (no nesting) that follows `selector`. */
function blockAfter(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const light = parseDecls(blockAfter(tokensCss, ":root {"));
const darkMedia = parseDecls(blockAfter(tokensCss, ':root:not([data-theme="light"])'));
const darkAttr = parseDecls(blockAfter(tokensCss, ':root[data-theme="dark"]'));

/** Lower-case, expand #abc to #aabbcc, drop spaces, ".5" → "0.5", so DESIGN.md and CSS compare equal. */
function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/g, "#$1$1$2$2$3$3")
    .replace(/\s+/g, "")
    .replace(/(^|[^\d])\.(\d)/g, "$10.$2");
}

function hexToRgb(hex: string): [number, number, number] {
  const h = norm(hex).replace("#", "");
  if (!/^[0-9a-f]{6}$/.test(h)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("design tokens", () => {
  it("match every token in docs/DESIGN.md → Tokens, light and dark", () => {
    const design = readFileSync(join(ROOT, "docs", "DESIGN.md"), "utf8");
    const rows = design.split("\n").filter((l) => l.startsWith("| `--"));
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      const names = (cells[1] ?? "").split(" / ").map((s) => s.replaceAll("`", "").trim());
      const lights = (cells[2] ?? "").split(" / ").map((s) => s.replaceAll("`", "").trim());
      const darks = (cells[3] ?? "").split(" / ").map((s) => s.replaceAll("`", "").trim());
      names.forEach((name, i) => {
        expect(norm(light.get(name) ?? "missing"), `${name} light`).toBe(norm(lights[i] ?? ""));
        expect(norm(darkMedia.get(name) ?? "missing"), `${name} dark`).toBe(norm(darks[i] ?? ""));
      });
    }
  });

  it("keeps the two dark blocks identical and complete", () => {
    expect(Object.fromEntries(darkAttr)).toEqual(Object.fromEntries(darkMedia));
    for (const name of darkMedia.keys()) expect(light.has(name), name).toBe(true);
  });

  describe.each([
    ["light", light],
    ["dark", darkMedia],
  ] as const)("%s theme contrast (WCAG AA, ≥ 4.5:1)", (_theme, tokens) => {
    const t = (name: string) => {
      const v = tokens.get(name) ?? light.get(name);
      if (!v) throw new Error(`missing token ${name}`);
      return v;
    };
    it.each([
      ["--ink", "--bg"],
      ["--ink", "--surface"],
      ["--ink", "--surface-2"],
      ["--ink-2", "--bg"],
      ["--ink-2", "--surface"],
      ["--ink-2", "--surface-2"],
      ["--accent-ink", "--surface"],
      ["--on-accent", "--accent"],
      ["--rail-ink", "--rail"],
      ["--rail-ink-hi", "--rail-2"],
      ["--hdr-ink", "--hdr"],
      ["--on-now", "--now"],
      ["--bad", "--surface"],
    ])("%s on %s", (fg, bg) => {
      expect(contrast(t(fg), t(bg))).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe("no literal colours outside tokens.css", () => {
  const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;
  const THIS_FILE = join(SRC, "styles", "tokens.test.ts");

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.(css|ts|tsx)$/.test(name) ? [p] : [];
    });
  }

  it("finds none in src/", () => {
    const offenders = walk(SRC)
      .filter((p) => p !== TOKENS_FILE && p !== THIS_FILE)
      .flatMap((p) =>
        readFileSync(p, "utf8")
          .split("\n")
          .map((line, i) => ({ line, at: `${relative(ROOT, p)}:${i + 1}` }))
          .filter(({ line }) => COLOUR.test(line))
          .map(({ at, line }) => `${at}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });
});
