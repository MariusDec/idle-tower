# AI brief: paste this into another project

Copy the block below into the target project's `CLAUDE.md` (or `AGENTS.md`,
`.cursorrules`, a system prompt…). Also copy `tokens/` and `components.css`
into that project, at a path the brief can point to. The brief is
deliberately short. The long-form rationale is in `GUIDELINES.md`. Point the agent to it
for anything the brief doesn't cover.

---

```markdown
## Visual identity ("Sunrise / Blue hour")

This app uses our shared visual identity. Tokens: `<path>/tokens/tokens.css`
(CSS variables), `<path>/tokens/theme.ts` (JS values), `<path>/tokens/tailwind.preset.js`.
Base components: `<path>/components.css`. Full guidelines: `<path>/GUIDELINES.md`.
Read the guidelines before building a new screen or component.

Look: frosted glass over a soft 135° full-viewport gradient, one violet-indigo
accent, rounded friendly type, a single filled button per screen.

Hard rules:
- Ground: `body { background: var(--bg-gradient) fixed }`. Light "sunrise"
  #E8DEFF→#C8DCFF→#D4F5E2; dark "blue hour" #2A1E4C→#1D2148→#16294A→#0F2B3C.
  Never a flat page color, never a solid white/gray card.
- Theme: `data-theme="light|dark"` on <html> if the user chose; else the OS
  preference. Use tokens (`var(--text-primary)` …), never raw hex in components.
- Surfaces, only three: **glass card** (`--glass-fill`, 1px `--glass-border`,
  `--glass-shadow`, radius 12), **inset** inside a card (`--panel-subtle`, no
  border), **callout** for tips (`--glass-fill-subtle`, 1px `--border-light`,
  12px uppercase muted heading). `strong` glass = selected/elevated. Blur only
  on glass over moving content (header, tab bar, sheets, toasts, sticky bars).
- Buttons: `primary` = opaque `--accent-gradient` + white bold label — at most
  ONE per screen; `secondary` = glass + `--accent-text` label; `tertiary` = text
  only. Heights 52/48/40, radius 14, press = scale(.98) 120ms.
- Color jobs: accent = interactive/selected/progress; success = correct/done;
  warning = "almost"; info = informational; error = real faults and
  destructive actions only — never for a user's mistake (a miss gets a muted
  outline; the right answer lights green). Text in accent uses `--accent-text`.
- Dark mode glass/borders are cool blue-white (rgba(173–198,190–208,255,…)),
  never neutral white; shadows are tinted (indigo light, navy dark).
- Type: Sarabun (Google Fonts) 400/700, system-ui fallback. Page h1 28/700;
  section headers and eyebrows 12/700 UPPERCASE +1px in `--text-muted`; body
  16/1.4; meta 13–14 `--text-secondary`, joined with " · ". Unitless line
  heights only. Uppercase only for eyebrows, section headers, callout titles,
  type badges.
- Spacing on a 4px grid (4 8 12 16 20 24 32 48); 16px page gutter; 720px max
  content width; card padding 16; 24 between sections.
- Radius by surface: card/row/option 12, button 14, sheet/toast 16,
  chip/badge/segmented/progress 999.
- Badges are flat (no border, no glass) so they never look tappable. Chips are
  accent-tinted pills, 48px min height. Segmented control = round track + one
  sliding gradient indicator.
- Icons: outline line icons (Ionicons Outline or Lucide), 16–24px, in the label
  color; filled only for state (✓ done). No emoji as UI icons.
- Motion: 120/180/280/420/700ms; easings standard cubic-bezier(.2,0,0,1),
  decelerate (0,0,0,1). Reveal = fade + 8px rise, stagger 60ms capped 240ms.
  Success "pop" 0.92→1.06→1. Errors never shake. Honor prefers-reduced-motion.
- Accessibility: every text token ≥ 4.5:1 on every gradient stop (re-check if
  you add colors); 44px min hit area; 2px `--accent` focus ring, offset 2.
- Copy: sentence case, short, warm, encouraging; buttons are verbs.
```

---

## Prompt starters

Use these when asking an AI to build or restyle something:

- *"Restyle this app to our visual identity in `visual identity/`. Start by
  importing `tokens/tokens.css` and `components.css` globally, then replace
  every hard-coded color, radius and shadow with tokens. Follow GUIDELINES.md;
  list anything that doesn't map cleanly."*
- *"Build a settings screen in our visual identity: page title + eyebrow,
  sections with uppercase headers, glass rows with switches, one primary
  button at the bottom in a sticky blurred action bar. Check both themes."*
- *"Make a dark/light toggle that sets `data-theme` on `<html>`, defaulting to
  the OS preference, and update `<meta name=theme-color>`."*
- *"Audit this screen against GUIDELINES.md: count primary buttons, check
  surfaces are one of the three, check that no text uses raw `--accent` in light
  mode, and that errors aren't red for user mistakes."*

## Non-web targets

- **React Native / Expo:** use `tokens/theme.ts` (`getPalette(scheme)`). Glass
  is `expo-blur`'s `BlurView` (intensity ≈ 35 light / 28 dark) with the fill
  as an overlay. Draw the gradient with `expo-linear-gradient` (start {0,0} →
  end {1,1} = 135°).
- **Flutter / native:** import `tokens/tokens.json` (W3C token format; Style
  Dictionary can emit Dart/Swift/Kotlin). Glass = `BackdropFilter` /
  `UIVisualEffectView` / `RenderEffect` blur + fill + 1px border.
- **Figma:** import `tokens/tokens.json` with Tokens Studio.
