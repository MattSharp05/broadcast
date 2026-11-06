# Design system: Broadcast

Source of truth for every UI ticket. It's distilled from the approved vision mockup
(`docs/vision-mockup.html`, v3) and the workflow's `ui-design` skill. When the mockup and this file
disagree, this file wins. If a ticket needs something this file doesn't cover, extend this file
in the same PR.

## Direction
- **Mode:** Operate. Broadcast is a working tool used at a desk in daylight. Its category sets
  the layout (side navigation, tables, drawers, standard controls). The brand adds type,
  palette, density and one signature move.
- **Signature move:** the Workflow canvas reads like a **departures board**. Accounts sit on a
  shaded band along the "now" line, each with a countdown to its next post printed on the line.
  Upcoming posts stack above (the next one nearest the line) and posted ones below (newest
  first), with arrows showing the order.
- **Light first, with a real dark theme.** Colour shows state. It is never decoration.

## Tokens
Defined once in `src/styles/tokens.css` on `:root`. The dark values apply under
`@media (prefers-color-scheme: dark)` (guarded with `:root:not([data-theme="light"])`) and under
`:root[data-theme="dark"]`. Components only ever use tokens, never literal colours.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f4f5f7` | `#111317` | page ground |
| `--canvas` | `#eceef2` | `#15181d` | Workflow canvas ground |
| `--dot` | `#d6dae1` | `#262b33` | canvas dot grid |
| `--surface` | `#ffffff` | `#1b1f25` | cards, tables, drawers, modals |
| `--surface-2` | `#f8f9fb` | `#20252c` | table header, secondary panels |
| `--hover` | `#f1f3f6` | `#262c34` | hover fills, tag background |
| `--line` | `#e2e5ea` | `#2b313a` | hairlines |
| `--line-2` | `#cbd0d8` | `#3a424e` | stronger borders, inputs |
| `--ink` | `#141922` | `#e7eaef` | primary text |
| `--ink-2` | `#465061` | `#a9b1be` | secondary text |
| `--ink-3` | `#737c8b` | `#7c8594` | tertiary text, labels |
| `--accent` | `#2350d1` | `#6f93ff` | primary buttons, scheduled state, focus |
| `--accent-hover` | `#1b41b0` | `#8aa8ff` | |
| `--accent-soft` | `#e9effc` | `#1d2945` | selection, focus halo, chart fill |
| `--accent-ink` | `#1c3f9f` | `#a8bfff` | accent text on light grounds, links |
| `--on-accent` | `#ffffff` | `#0b1020` | text on accent |
| `--rail` / `--rail-2` | `#14203a` / `#1d2c4d` | `#0d1424` / `#17223a` | navigation rail, active item |
| `--rail-ink` / `--rail-ink-hi` / `--rail-line` | `#b9c4d9` / `#fff` / `#26365a` | `#a3afc6` / `#fff` / `#1f2b45` | rail text, borders |
| `--band` / `--band-line` | `#e1e6ef` / `#c9d1df` | `#1a1f2b` / `#2a3242` | the account band on the canvas |
| `--hdr` / `--hdr-ink` / `--hdr-ink-2` / `--hdr-line` | `#14203a` / `#fff` / `#b4c0d6` / `#2a3a5e` | `#22335a` / `#fff` / `#b4c0d6` / `#36497a` | account header cards |
| `--hdr-warn` | `#f3bd63` | `#f3bd63` | needs-attention marker on a header |
| `--good` / `--good-soft` | `#17784a` / `#e8f5ee` | `#58c48e` / `#15301f` | ready, live, granted |
| `--warn` / `--warn-soft` / `--warn-line` | `#a5560a` / `#fff5e3` / `#f1cd8c` | `#efb25a` / `#30240f` / `#5c4519` | needs attention, paused |
| `--bad` / `--bad-soft` / `--bad-line` | `#c42f22` / `#fdeeec` / `#f2b9b2` | `#f0796c` / `#371b18` / `#62302a` | failed, destructive |
| `--now` / `--on-now` | `#141922` / `#fff` | `#e7eaef` / `#111317` | the now-line, its tag, toasts |
| `--shadow` | `0 1px 2px rgba(20,25,34,.06), 0 1px 3px rgba(20,25,34,.04)` | `0 1px 2px rgba(0,0,0,.4)` | resting surfaces |
| `--shadow-lg` | `0 16px 40px -12px rgba(20,25,34,.22), 0 2px 6px rgba(20,25,34,.06)` | `0 16px 40px -12px rgba(0,0,0,.7)` | hover, popovers, drawers, HUD |

Avatar colours (white initials, the same in both themes): `#2f6f8f`, `#3a5bb8`, `#6a5a9a`,
`#a3562d`, `#2c7a55`, `#5b6577`. Each account gets one, picked from its id.

## Type
- **IBM Plex Sans** (Google Fonts, `next/font`), weights 400 / 500 / 600 only.
  `font-variant-numeric: tabular-nums` on `body`.
- Scale: 12 (meta, small labels), 12.5 (help, secondary), 13 (table cells, card titles), 14 (body,
  buttons), 15 (section headings in drawers, lane titles), 17 (modal titles), 19 (page titles),
  24 (big numbers in drawers).
- Sentence case everywhere. No all-caps, no letter-spaced eyebrows, no monospace (except code
  paths in the Content Factory).

## Shape, space, depth
- Radius: 8px for cards, tables, drawers and popovers; 6px for buttons, inputs and selects; 4px
  for tags and small chips; 12px for modals; 50% for avatars and status dots.
- Spacing steps: 4, 6, 8, 10, 12, 14, 16, 20, 24. Page gutter 24px (16px on phones). Use flex or
  grid `gap`, not margins.
- Borders are 1px hairlines. Shadows always have an offset and a blur. No glows or coloured
  halos (the only halo is the 3px `--accent-soft` focus and selection ring).

## Layout
- **Shell:** a 220px navy rail on the left (logo, Workflow, Accounts, Content Factory "v1", and
  the scheduler status in its footer) plus a work area. Each tab has a 56–60px white top bar:
  title, an inline stats line (items split by 1px dividers, e.g. "13 scheduled | Next post in
  9 h 46 min | 9 posted today | 1 failed"), then actions on the right. Below 760px the rail
  becomes a bottom tab bar.
- **Workflow canvas:**
  - Infinite pan and zoom with transform scale between 0.28 and 1.8. Drag to pan, wheel to
    scroll, ctrl/cmd + wheel or pinch to zoom.
  - The zoom HUD sits bottom-left (−, %, +, Fit all, Back to now) and the minimap bottom-right
    (190×116).
  - Geometry: columns 372px apart; cards 256px wide; account header 104px tall; post cards 104px
    tall; 40px vertical gaps holding the arrows.
  - The account band is `--band`, extending 14px above and below the headers, with a 1.5px
    `--now` line through it. The "Now: Thu 5 Nov, 22:14" tag sits at the left. Each column's
    "Next in 10h 46m" chip is centred in the gap to its right.
  - Lane labels ("Upcoming", "Posted") with one line of help sit to the left of the first column.
  - Below 60% zoom, small text hides and times and handles grow (semantic zoom).
- **Accounts:** a table in one bordered surface, grouped by brand (group rows). Columns: Account
  (avatar, handle linked to the profile, platform), Status (dot + word + reason), Tags (inline
  add/remove), Description (inline textarea, autosaves), Followers, Slots a day, Backlog,
  Details. Toolbar: search, Tag select, Status select.
- **Drawers** slide in from the right (440px max). **Modals** are 720px max; the wizard has a
  vertical stepper on the left.

## Components
- **Buttons:** primary (accent fill), secondary (surface + `--line-2` border), ghost, danger
  (red text). 34px tall. Verb-first labels ("Add to queue", "Reconnect Instagram").
- **Status:** a 7px dot in the state colour plus a word ("Ready", "Needs attention", "Not
  connected", "Live"). No pills.
- **Tags:** 22px, 4px radius, `--hover` background; the × appears on hover and focus.
- **Post card:**
  - A 9:16 thumbnail (50×88) with a 3px top strip in the account colour, a play mark and the
    duration. The real thumbnail replaces the placeholder once uploaded.
  - Then the time ("Tomorrow, 13:00") with a status word on the right (Scheduled, Pinned,
    Paused, Failed), the 2-line title, and a footer (queue slot / fixed time / metrics with
    icons).
  - Open slots are dashed, empty cards. Failed cards have a `--bad-soft` fill and a `--bad-line`
    border.
- **Account header:** an `--hdr` navy card with a 42px avatar (platform badge), the handle, "Brand,
  Instagram", an open-profile icon link (new tab), and a hairline-divided footer (followers,
  backlog). Needs attention: a 3px `--hdr-warn` inset top edge and an amber footer message.
- **Icons:** one stroke set, 1.6px stroke, 16px (Lucide in code). Platform glyphs for Instagram
  and TikTok.
- **Charts:** inline SVG coloured from tokens. Stats bars: `--accent-soft` with an `--accent`
  outline, the latest bar solid `--accent`, missing refreshes dashed. Followers: an area line
  with an emphasised endpoint.
- **Toasts:** bottom centre, `--now` background, a check icon, and words that echo the action
  ("Added to 2 queues. First post Tomorrow, 13:00.").

## Copy
- The user's words: "account", "queue", "slot", "backlog", "post", "Needs attention".
- Times as "Today, 19:00", "Tomorrow, 09:00", "Sat 7 Nov, 12:00"; relative as "in 9 h 46 min" or
  "3 h ago".
- Errors say what went wrong and how to fix it ("Instagram rejected the video because it is
  1080 × 1350. Reels must be 9:16 (1080 × 1920).").

## Avoid (from `ui-design`)
Dark background with one glowing accent, purple or indigo, gradient text, monospace or all-caps
labels, eyebrows, rows of KPI tiles, " · " meta strings, "→" on links, pills everywhere, fake
gradient artwork, and fade-in animations on every element. Motion only answers actions:
drawers sliding in, a toast, the fresh-card highlight after adding content.
