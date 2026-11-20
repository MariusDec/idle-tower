# Visual identity guidelines

A calm, translucent, sky-colored look: **frosted glass over a soft diagonal
gradient**, one violet-indigo accent, rounded friendly type, and a single
filled button per screen. Two themes that are the same sky at two times of
day:

| Theme | Name | Ground (135°) |
| --- | --- | --- |
| Light | **Sunrise** | lavender `#E8DEFF` → periwinkle `#C8DCFF` → mint `#D4F5E2` |
| Dark | **Blue hour** | afterglow violet `#2A1E4C` → indigo `#1D2148` → navy `#16294A` → petrol teal `#0F2B3C` |

Reference screenshots of the original app are in [`screenshots/`](screenshots/).
The values below live in [`tokens/`](tokens/). This file says how to use them.

---

## 1. Principles

1. **The sky is the ground.** Every screen sits on the full-viewport gradient
   (`background: var(--bg-gradient) fixed`). Never paint a page a flat color.
   Never put a solid white or solid gray card on it.
2. **Glass, not paper.** Containers are translucent washes over the gradient,
   with a bright hairline border and a soft tinted shadow. The ground shows
   through, so the screen reads as one piece.
3. **One loud thing.** The only opaque surface is the primary button (the
   accent gradient with a white label). Use **at most one per screen**, on the
   action that moves the user forward. Everything else is quieter.
4. **Color has a job.** Accent = interactive / selected / progress. Green =
   correct / done. Amber = "almost". Blue = info. **Red only for real faults**
   (a failed save, a refused permission). It is never used for a user's
   mistake. A wrong answer gets a muted outline, and the right answer lights up
   green.
5. **Tinted, never neutral.** Shadows are indigo in light and near-black navy in
   dark. Dark-mode glass is cool blue-white, never neutral white, because a white
   wash over a colored dark ground reads as gray dirt. Scrollbars and tracks are
   tinted too.
6. **Accessible by construction.** Every text color is at least 4.5:1 on every
   gradient stop. Touch targets are at least 44px. Focus rings are visible. Motion
   respects `prefers-reduced-motion`.

---

## 2. Color

### Text (contrast measured against each gradient stop)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--text-primary` | `#2A1F4A` (10.9–12.9:1) | `#E9E6F7` (11.8–12.6:1) | Titles, body, option labels |
| `--text-secondary` | `#5B5380` (5.1–6.0:1) | `#B0B8D8` (7.4–7.8:1) | Subtitles, meta lines, inactive tabs |
| `--text-muted` | `#625A86` (4.6–5.4:1) | `#949DBD` (5.4–5.7:1) | Uppercase section labels, eyebrows |
| `--text-dim` | `#4A4170` (6.6–7.9:1) | `#9EA7C8` (6.1–6.5:1) | Sub-headings, helper text, secondary readings |

The light theme's text is a deep **violet-ink**, not black or gray. The dark
theme's text is a **lavender-white**.

### Accent

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--accent` | `#6B5BD9` | `#B3A5FF` | Borders, fills, icons, progress, focus ring |
| `--accent-text` | `#5246B8` | `#B3A5FF` | The accent **as text**: links, secondary/tertiary button labels |
| `--accent-gradient` | `#6B5BD9 → #4A5FD0` | `#7A6AE4 → #5A71DD` | Primary button, selected segment |
| `--accent-tint` | accent @ 12% | accent @ 12% | Chip/badge fill, icon tile, active tab pill |

In light mode, `--accent` is only 3.7–4.4:1 on the ground. That's fine for
icons and borders, which need 3:1, but body-size text must use `--accent-text`.
White on the light gradient is 5.1:1. White on the dark gradient is 4.2:1, so
keep primary labels **bold and at least 16px** there.

### Status

| Token | Light | Dark | Rule |
| --- | --- | --- | --- |
| `--success` (+`-bg`, `-border`) | `#2E7D32` | `#6FD9A6` | Correct, done, goal met |
| `--warning` (+`-bg`) | `#EF6C00` | `#FFC078` | "Almost", needs attention |
| `--info` (+`-bg`) | `#1E5A8B` | `#7FC4F5` | Informational highlight, secondary data series |
| `--error` (+`-bg`, `-border`) | `#C62828` | `#FF9A94` | **Real faults and destructive actions only** |

In light mode, use the status colors for icons, borders, and **bold** labels
on their own `-bg` tint. Don't use them for small regular-weight text on the
bare gradient (warning is only 2.4:1 there).

### Category hues (icons)

When a set of items (topics, features, tiles) needs distinct icon colors,
use these **light/dark pairs**. Never use a single hex for both themes. The dark
half of each pair is lifted to 6–9:1.

`teal #00838F/#6FD0DE` · `pine #00695C/#6FD3C3` · `orange #E65100/#FFA366` ·
`amber #EF6C00/#FFB570` · `coral #FF7043/#FFA183` · `orchid #8E24AA/#D79BE0` ·
`violet #7B1FA2/#C79BE8` · `azure #0277BD/#7FC0EE` · `rose #E53935/#FF8A80`

Section washes (`--tint-violet`, `--tint-blue`, `--tint-pink`, `--tint-mint`)
are soft fills for badges or grouped areas.

---

## 3. Surfaces: three, and only three

| Surface | What | Recipe |
| --- | --- | --- |
| **Card** (glass) | The default container: tiles, rows, options, header, tab bar | `--glass-fill` + 1px `--glass-border` + `--glass-shadow`, radius 12 |
| **Inset** | A quiet area *inside* a card: a readout, a row, a note | `--panel-subtle`, no border, no shadow, radius 8 |
| **Callout** | Tips, hints, "why" explanations | `--glass-fill-subtle` + 1px `--border-light`, small uppercase heading |

Glass variants:

- `default`: a normal card.
- `strong`: **elevated or selected**, such as a picked option or a confirm row in
  a sheet. In dark mode it's a directional sheen gradient, not a flat lift.
- `subtle`: idle options and the quietest containers.
- `accent`: accent border with an accent wash. Use it sparingly for a featured card.
- `sheet`: bottom sheets and dialogs. This is the page gradient at 72–76% opacity
  plus blur, so a sheet looks like the same sky, not a different app.
- `primary`: the opaque CTA (see Buttons).

**Blur policy.** In-page glass only applies `saturate(140%)`, because a blurred
smooth gradient looks identical to an unblurred one and blur is expensive.
Glass **over moving content** also blurs (`--blur`: 25px light, 20px dark):
the fixed header, the tab bar, sticky action bars, sheets, toasts, and floating
controls. Glass nested in glass has no backdrop filter.

**Never** use an accent outline on a callout or a container. The accent
outline means "this option is selected."

---

## 4. Typography

- **Face:** **Sarabun** (Google Fonts, OFL), a friendly, slightly rounded
  humanist sans with Latin and Thai. The alternate is **Kanit** (more geometric, "modern").
  Fall back to `system-ui`. Use two weights: **400** and **700** (600 for inline links).
- **Line height is unitless** (1.2 headings, 1.25 button labels, 1.4 body). Never
  use px line heights, because they clip diacritics when the OS text size is enlarged.

| Role | Size / weight | Color | Notes |
| --- | --- | --- | --- |
| Page title (`h1`) | 28 / 700, lh 1.2 | primary | One per page. The header shows a compact 16–18px title once it scrolls away |
| Eyebrow above a title | 12 / 700, UPPERCASE, +1px | muted | "TODAY'S SESSION", "WEEK 1, DAY 1" |
| Card hero title | 24 / 700 | primary | |
| Section header (`h2`) | 12 / 700, UPPERCASE, +1px | muted | "SHORTCUTS", "REVIEW". Optional 12px subtitle in `--text-dim` |
| Sub-group (`h3`) | 12 / 700, +0.4px, *not* uppercase | dim | |
| Tile title | 18–20 / 700 | primary | |
| Body | 16 / 400, lh 1.4 | primary | |
| Secondary / meta | 13–14 / 400 | secondary | "~14 min · 8 new · 34 reviews" (join with ` · `) |
| Button label | 18 (lg) / 16 (md) / 14 (sm), 700 | per kind | |
| Badge | 12 / 700 | per tone | UPPERCASE only for a type label (WORD, SIGN) |

Uppercase is reserved for **eyebrows, section headers, callout titles and type
badges**. Don't invent new uppercase styles.

---

## 5. Spacing, radius, layout

- **4px grid:** 4, 8, 12, 16, 20, 24, 32, 48.
- **Page gutter:** 16px on every screen. Content column max **720px**, centered
  (a phone never hits it; tablets and desktop do). The tab bar's max width is 480px.
- **Card padding:** 16px. Callout padding is 12px vertical and 16px horizontal.
- **Gaps:** 12px between cards in a list, 24px between sections, 4px between a heading and its subtitle.
- **Radius by surface (fixed, never per-screen):** card / row / option **12** ·
  button **14** · sheet / toast **16** · chip / badge / segmented / progress
  **999** (fully round).
- **Grids:** two-column tile grids. An odd last tile spans the full row.

---

## 6. Components

**Buttons.** There are three weights, and the call site never restyles the label:

| Kind | Look | When |
| --- | --- | --- |
| `primary` | Opaque `--accent-gradient`, white bold label, no border | The one forward action per screen |
| `secondary` | Glass, `--accent-text` bold label | Other actions |
| `tertiary` | Text only, `--accent-text` bold label, same height | Not now / Skip / Cancel / Adjust |

Heights are 52 (lg, the bottom action bar), 48 (md), and 40 (sm, inside a card).
A button can take a leading icon in the label color and a 12px caption line
under the label. `danger` tone means the label and hairline use `--error`. It's
only for secondary or tertiary buttons that destroy data. Press feedback is
`scale(0.98)` over 120ms. A disabled button uses 50% opacity.

**Pill shortcuts.** These are glass with radius 999, a colored line icon, and a primary-ink bold label
(Home's "Survival Card / Favorites / My Phrases").

**Chips.** An accent tint fill (≈10–12%), an accent-tint border (25%), radius 20, 13px
bold `--accent-text`, and a 48px minimum height. Use them for asides under the main content.

**Badges.** These are **flat**, with no border and no glass, so they never look
tappable. They're 12px bold with 2px × 8px padding and radius 999. Tones are
neutral, accent, success, warning, and error.

**Segmented control.** A round track (`--surface` + `--border-light`) with
**one** sliding `--accent-gradient` indicator behind the options. The selected
label is white, the others are `--text-secondary`, and the visible height is 40px.

**Switch.** Every yes-or-no setting is a switch row: a subtle glass row
(radius 16, at least 48px tall) holding a bold label, an optional muted
one-line hint, and a 40 × 24 track at the end. Off is `--surface` with a
`--border` hairline; on fills with `--accent`. The white 18px thumb carries a
small drop shadow and travels 16px. The whole row is the hit target and has
`role="switch"` with `aria-checked`, so a screen reader announces on/off rather
than a choice. The label says what the switch turns on and never changes with
the state. Don't use On/Off segmented pairs or ON/OFF pills for this.

**Options (choices / quiz answers).**

| State | Surface | Border | Text |
| --- | --- | --- | --- |
| idle | subtle glass | glass border | primary, 400 |
| selected | strong glass | 2px `--accent` | primary |
| correct | `--success-bg` | 2px `--success` | `--success`, 700, ✓ icon |
| wrong (the pick) | default glass | 2px `--text-muted` | primary, ✕ icon in muted |
| close / almost | default glass | 2px `--warning` | primary 700, ! icon |
| others after answering | — | — | 45% opacity |

**Progress.** A bar is 4px (rows, tiles) or 6px (a run's main progress). It's fully
round with an `--surface` track and an `--accent` fill. Use `--success` only for a met
goal. A ring has a 2.5px stroke, an `--progress-track` track, round caps, starts at
12 o'clock, and shows a `value/max` label.

**App chrome.** There's a fixed blurred-glass header (64px plus the safe area) with the
page title left and round-rect glass icon buttons right, and a fixed
blurred-glass bottom tab bar with 4 tabs: a line icon over a label. The active tab
has `--accent-text`, a bold label, and a soft accent pill behind the icon.

**Icon tiles.** A 48px rounded square (radius 16) with an `--accent-tint` fill
and an accent line icon. Use it as the leading visual on a feature row.

**Icons.** Use **outline line icons** (the app uses Ionicons *Outline*: `ionicons`
/ `solid-icons/io`; Lucide is a close substitute) at 16–24px in the label color.
Use filled glyphs only for state: a filled ✓ circle for done or correct, and a filled ✕ circle for a miss.
Don't use emoji as UI icons, because they vary by platform and ignore the theme.

**Lists of tappable rows.** Show a glass row, a chevron-forward at the end, and on hover
an accent border, a 1px lift, and the chevron nudging 2px right.

---

## 7. Motion

| Token | ms | Use |
| --- | --- | --- |
| `instant` | 120 | Press, hover, ack |
| `fast` | 180 | Toggles, the success "pop" |
| `base` | 280 | Default transition, progress fills, the segment slide |
| `slow` | 420 | Page-level reveals, count-ups |
| `deliberate` | 700 | Celebrations, boot |

Easings: `standard cubic-bezier(0.2,0,0,1)` (confident pluck),
`decelerate cubic-bezier(0,0,0,1)` (settling in), `accelerate
cubic-bezier(0.3,0,1,1)` (leaving). Don't use the named CSS easings.

Use these signature moves:

- **Reveal-in:** fade with an 8px rise over 280ms, decelerating. Lists stagger
  by 60ms per item, capped at 240ms.
- **Pop:** scale 0.92 → 1.06 → 1 over 180ms, for a correct answer or a completed item.
- **Count-up:** numbers ramp with ease-out-cubic over 420ms.
- **Celebration:** a confetti burst from the stat row, used only on real milestones.
- **Switch:** the thumb slides 16px while the track fills with the accent, both
  over 180ms on `standard`, so the fill lands with the thumb.
- **Segment slide:** the gradient indicator glides to the chosen option over
  280ms on `standard`, and the labels cross-fade their color with it.
- **Page change:** a push lays the new page over the old one like a card; back
  lifts the top card off. Both layers move over 280ms on `decelerate`, locked
  together:

  | | Leaving page | Entering page |
  | --- | --- | --- |
  | Forward (push) | 0 → −25%, opacity 1 → 0.55, *underneath* | 100% → 0, opaque, *on top* |
  | Backward (back) | 0 → 100%, opaque, *on top* | −25% → 0, opacity 0.55 → 1, *underneath* |

  The page underneath moves a quarter as far as the one on top, and that
  parallax is what reads as depth. The top layer stays fully opaque (a card,
  not a cross-fade), and each sliding layer paints the background gradient
  itself, or the two pages show through each other. The leaving page keeps the
  scroll position it was left at. Switching tabs uses the same slide, its
  direction set by tab order (a tab to the right slides forward). An in-page
  screen swap (setup → run → results) slides forward too, even with no URL
  change. The header and tab bar don't move. The first paint after launch is a
  plain 200ms fade. A rapid second navigation cancels the first; never let two
  leaving pages stack. `components.css` has both a class-based version
  (`.page-enter--forward` …) and a View Transitions one (`<html data-nav>`).

A mistake never shakes, buzzes, or turns red. Under `prefers-reduced-motion`
everything snaps to its end state.

---

## 8. Voice in the UI

The identity includes the tone of the copy. Write short, warm, and plain copy in sentence
case. Buttons are verbs ("Start today's session", "Adjust today's session").
Meta lines are compact and joined with ` · `. Encourage the user and never
scold them: "Not quite, the answer: X", never "Wrong!". Use American English.

---

## 9. Platform details

- Set `<meta name="theme-color">` to `#6B5BD9` (light) or `#1D2148` (dark) with `media` queries.
- Theme selection order: an explicit user choice (`data-theme` on `<html>`), then the OS.
- **Mouse and trackpad only:** use an 8px scrollbar track with a 4px indigo-tinted thumb (accent on hover).
  Touch devices keep the native overlay bar.
- Use one focus ring everywhere: 2px `--accent` outline at 2px offset (`:focus-visible`).
- Lay an invisible 44×44 hit area over any smaller control, without changing how it looks.
- Without `backdrop-filter` support, fall back to an 85% white glass (light) or
  92% indigo glass (dark).

---

## 10. Adapting it to another app

- **Keep these. They are the identity:** the gradient ground (both themes), the
  glass recipe, the violet-indigo accent and its gradient CTA, Sarabun, the
  radius-by-surface table, the three-surface rule, and "one primary per screen".
- **You can change these:** category hues, the icon set (stay outline), the tab
  count, the content width, and density (for example, a data-heavy desktop app can use the
  `sm` controls and 12px gaps).
- **Brand variants:** to give a sibling app its own flavor, shift only the
  *third* gradient stop and the category hues, and keep the accent. For example, a
  finance app might go lavender → periwinkle → pale sky. Re-run the contrast check
  (every text token ≥ 4.5:1 on every stop) after any change.
- **Charts:** series 1 is `--accent`, series 2 is `--info`, and series 3 is `--success`, then
  the category hues. Gridlines use `--border-light`, and axis labels use `--text-muted` 12px.
