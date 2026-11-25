/**
 * Parsing video-editor's style list (`.claude/skills/animated-video/styles/README.md`, pure) into
 * the mirror `src/lib/factory/style-packs.json` (scripts/sync-style-packs.mjs). Plain TypeScript
 * only (no enums), so Node runs it as is from the script.
 */

export interface StyleEntry {
  key: string;
  label: string;
  /** The style's full name in the table, e.g. "Flat infographic, kinetic type, product UI film". */
  name: string;
  suits: string;
  signature: string;
  typical_failure: string;
  has_pack: boolean;
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const sentence = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The styles table: one entry per row. A row has a pack when its Pack cell links to
 * `<key>/README.md` in the styles folder; its label is then the pack README's title (before any
 * colon), passed in `titles`. Other rows get their key and label from the style's name.
 */
export function parseStylesReadme(
  markdown: string,
  titles: Readonly<Record<string, string>> = {},
): StyleEntry[] {
  const lines = markdown.split("\n");
  const head = lines.findIndex((l) => /^\|\s*Style\s*\|/.test(l));
  if (head < 0) return [];
  const out: StyleEntry[] = [];
  for (const line of lines.slice(head + 2)) {
    if (!line.trim().startsWith("|")) break;
    const [style = "", suits = "", signature = "", failure = "", pack = ""] = cells(line);
    const link = /\]\(([a-z0-9-]+)\/README\.md\)/.exec(pack);
    const short = (style.split(":")[0] ?? style).replace(/\s*\(.*?\)\s*/g, " ").trim();
    const first = short.split(",")[0]?.trim() ?? short;
    const key = link?.[1] ?? slug(first);
    const title = link ? (titles[key] ?? first) : first;
    out.push({
      key,
      label: sentence((title.split(":")[0] ?? title).trim()),
      name: style,
      suits: sentence(suits),
      signature: sentence(signature),
      typical_failure: sentence(failure),
      has_pack: Boolean(link),
    });
  }
  return out;
}
