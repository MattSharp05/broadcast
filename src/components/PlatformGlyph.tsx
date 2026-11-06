import type { SVGProps } from "react";

interface PlatformGlyphProps extends SVGProps<SVGSVGElement> {
  /** `instagram`, `fake` (drawn as Instagram: it mimics it), `tiktok` or `youtube`. */
  platform: string;
}

/** The platform's glyph in the Lucide stroke style (Lucide ships no brand icons). */
export function PlatformGlyph({ platform, ...rest }: PlatformGlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {platform === "youtube" ? (
        <>
          <rect x="2.5" y="5" width="19" height="14" rx="4" />
          <path d="m10 9 5 3-5 3z" />
        </>
      ) : platform === "tiktok" ? (
        <>
          <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
          <path d="M14 3c.4 2.6 2.2 4.4 5 4.6" />
        </>
      ) : (
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.3" cy="6.7" r=".7" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/** "Instagram" / "TikTok" for copy such as "Coding Journey, Instagram". */
export function platformName(platform: string): string {
  return platform === "tiktok" ? "TikTok" : "Instagram";
}
