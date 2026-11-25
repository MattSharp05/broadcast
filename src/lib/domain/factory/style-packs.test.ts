import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import mirror from "@/lib/factory/style-packs.json";
import { parseStylesReadme } from "./style-packs";
import { STYLE_PACKS } from "./styles";

const readme = readFileSync(join(__dirname, "__fixtures__", "styles-README.md"), "utf8");

describe("style packs synced from video-editor", () => {
  it("parses the README table into 10 styles, 5 with packs", () => {
    const styles = parseStylesReadme(readme, {
      "motion-graphics": "Motion graphics: flat infographic",
    });
    expect(styles).toHaveLength(10);
    expect(styles.filter((s) => s.has_pack).map((s) => s.key)).toEqual([
      "handmade-2d",
      "editorial-collage",
      "motion-graphics",
      "luminous-3d",
      "realistic-3d",
    ]);
    expect(styles.find((s) => s.key === "motion-graphics")).toMatchObject({
      label: "Motion graphics",
      suits: "Data, processes, quotes, software launches",
    });
    expect(styles.find((s) => s.key === "map-documentary")).toMatchObject({
      label: "Map documentary",
      has_pack: false,
    });
  });

  it("the mirror is what the script makes, and the pickable styles are its packs", () => {
    expect(mirror).toHaveLength(10);
    expect(STYLE_PACKS.map((s) => s.key).sort()).toEqual(
      mirror
        .filter((s) => s.has_pack)
        .map((s) => s.key)
        .sort(),
    );
  });
});
