# Visual identity — "Last light"

**Status:** 2026-11-18. Built: parts 1–6 are in. Brings the shared identity
("Sunrise / Blue hour", from Learn Thai, copied into `visual identity/`)
to The Tower. The game won't look like Learn Thai, but it should read as
part of the same family.

**Decisions taken** (from the options shown on 2026-11-18):

| Question | Choice |
|---|---|
| Direction | **B · Last light**: the identity's dark *Blue hour* ground, with the last gradient stop turned to a warm ember horizon that each region tints |
| Main button | **Identity violet** (`--accent-gradient`). Gold stays the player's colour: shards, the tower, rewards, legendary |
| Number face | **Sarabun everywhere**, with tabular numerals. Oswald is retired |

**How to read this:** §1 says what carries over and what the game keeps.
§2 is the token system. §3–§8 are the build parts, in order. §9 lists the
files each part touches. §10 covers checks. §11 is what's still open.

`plans/rebuild.md`'s rules still hold, in particular §10.5's colour meanings:
amber is the player's, violet is arcane, red is enemies only, scarlet means
the tower is in danger. Nothing here touches `sim/`, so no pacing invariant
has to be re-measured. Per `CLAUDE.md`, run `impact` on every TS symbol
before editing it (§7 is the part that touches named functions) and
`detect_changes` before each commit.

---

## 1. What carries over, and what the game keeps

The identity's own adaptation rules (`GUIDELINES.md` §10) name seven things
as *the identity*. For each, this table gives what The Tower does with it:

| Identity element | In The Tower |
|---|---|
| The gradient ground | **Kept, as a brand variant.** Blue hour's first three stops, plus a fourth "last light" stop that's warm and tinted per region (§2.2). Dark only: no Sunrise theme |
| The glass recipe | **Kept for every DOM surface**, with a performance rule: no backdrop blur over the running arena (§2.4) |
| Violet-indigo accent and its gradient CTA | **Kept.** The accent now means *interactive / selected / progress* in the UI. Gold stops being the UI accent |
| Sarabun | **Kept**, self-hosted (the Capacitor build has no network) |
| Radius by surface | **Kept**: card 12, button 14, sheet and toast 16, chip, badge, segmented control and progress bar 999 |
| The three surfaces | **Kept**: card (glass), inset, callout. The game's ad-hoc panels map onto them (§4) |
| One primary per screen | **Kept**: Begin run on the hub, Run again on results, Begin on a Trial. Everything else is secondary or tertiary |

**What the game keeps that the identity doesn't have:**

- **The battlefield palette** (`--fx-*`, `FX` in `render/palette.ts`) and
  its rules: blood is for enemies only, critical only for the tower in
  peril, plus the colourblind-safe `SAFE_FX`. In identity terms these are
  the game's *category hues*, which the guidelines allow each app to choose.
- **The rarity ladder** (`--rarity-*`), re-checked for contrast on the new
  ground.
- **Gold as the player's colour.** Shards, the tower, XP, rewards and
  legendary stay `--fx-gold`. Gold is no longer the colour of buttons,
  selected tabs or focus rings. That moves to the accent.
- **game-icons.net artwork** for content (weapons, passives, relics,
  enemies, bosses, Forge nodes). These are illustrations, not UI glyphs.
  They sit inside the identity's icon tile (§4.6). UI chrome glyphs switch
  to outline icons.
- **The z-index ladder, the layout tokens, the safe-area tokens and
  `--text-scale`.**

**Where the two systems agree already:** the identity's "red never marks a
user's mistake" matches the game's "red belongs to the battlefield". The
game's rose `--bad` gets split (§2.3): *unaffordable* becomes muted, not
coloured, and *destructive* becomes the identity's `--error`.

---

## 2. Tokens

### 2.1 Structure

`src/styles/tokens.css` stays the single source of truth, with the same
three layers (primitives, semantic, layout). What changes:

- **The semantic layer takes the identity's names** (`--text-primary`,
  `--glass-fill`, `--accent-text`, `--panel-subtle`, …), so a rule written
  for Learn Thai reads the same here, and `components.css` patterns port
  directly. The game-only groups (`--fx-*`, `--rarity-*`, `--rgb-*`,
  `--z-*`, layout, safe area) keep their names.
- **Dark only.** `:root { color-scheme: dark }`, no `data-theme` and no
  `prefers-color-scheme` block. The token names leave room for a Sunrise
  theme later (§11), but this plan doesn't build one.
- **Old names are removed, not aliased.** `main.css` is nearly the only
  consumer (880 `var()` uses), so a one-time rename is cleaner than a
  permanent alias layer. The rename map:

| Old | New |
|---|---|
| `--surface-0` / `--surface-sunken` | the body gradient (`--bg-gradient`); a flat fallback is `--bg-stop-2` |
| `--surface-1`, `--surface-2` | `--glass-fill` (card) |
| `--surface-3`, `--surface-4`, `--surface-raised` | `--glass-fill-strong` (elevated, selected, hover lift) |
| `--surface-overlay`, `--surface-overlay-deep` | `--glass-fill-solid` (new, §2.4: glass over the running arena) |
| `--surface-scrim` | `--scrim` (navy-tinted, not black) |
| `--stroke-subtle`, `--stroke-strong` | `--glass-border-subtle`, `--glass-border` |
| `--stroke-hairline` | `--border-light` |
| `--text-0` / `-1` / `-2` / `-3` | `--text-primary` / `--text-secondary` / `--text-dim` / `--text-muted` |
| `--accent` (was gold) | `--accent` (now violet). Every gold *UI* use becomes `--accent` or `--accent-text`. Every gold *meaning* use (shards, rewards) becomes `--fx-gold` explicitly |
| `--accent-2` | removed (it was arcane: use `--fx-arcane`) |
| `--good` / `--warn` / `--bad` | `--success` / `--warning` / `--error` or muted (§2.3) |
| `--elev-1…5`, `--elev-up` | `--glass-shadow`, `--glass-shadow-up` (navy-tinted) |
| `--font-display`, `--font-ui` | `--font-sans` |
| `--radius-*` | the identity's names plus the role aliases (`--radius-card`, `--radius-button`, `--radius-chip`, `--radius-sheet`) |
| `--dur-*`, `--ease-*` | the identity's (120/180/280/420/700; standard, decelerate, accelerate). `--dur-pulse` and `--dur-ambient` stay for ambient loops |

### 2.2 The ground: Blue hour with a last light

A 135° gradient on `body`, `background-attachment: fixed`:

| Stop | Value | Note |
|---|---|---|
| 0% | `#2a1e4c` | Blue hour's afterglow violet, unchanged |
| 34% | `#1d2148` | indigo, unchanged |
| 66% | `#211d3f` | Blue hour's navy, pulled a little toward violet so the warm stop blends |
| 100% | `--bg-last-light` | warm, and the region's (below) |

`--bg-last-light` defaults to `#3b2422` (ember dusk). The hub sets it from
the selected region, and so does a run from its region. It's written from
TS as a custom property on `:root`, like `--vignette-alpha`. The
values are each region's `tint` mixed 60% into the ember, then darkened
until every text token clears 5:1 (computed 2026-11-18):

| Region | `tint` | `--bg-last-light` | Worst text contrast (`--text-muted`) |
|---|---|---|---|
| Ashen Fields | none | `#3b2422` | 5.35 |
| Drowned Mire | `#1d4a3c` | `#24312f` | 5.03 |
| Glass Wastes | `#4a5a66` | `#2f2c39` | 5.08 |
| Ember Rift | `#4a2416` | `#44241b` | 5.16 |
| The Hollow | `#1e1a33` | `#2a1e2c` | 5.92 |
| Blight Heart | `#3a0f1a` | `#3a171d` | 5.92 |

The values live in data: a `lastLight` field on each region in
`content/regions.ts`, plus one for the Abyss and one for Boss Rush. They
aren't derived at runtime, so the contrast test can read them (§10). A raw
60% mix fails on Glass Wastes (muted text 3.6:1), and that's the reason for
the darkening step and the test.

The change is animated: `--bg-last-light` is registered with
`@property` as a `<color>`, so switching region on the Map moves the
horizon over `--dur-slow`. Under reduced motion it snaps.

### 2.3 Colour jobs

| Job | Token | Value |
|---|---|---|
| Interactive, selected, progress, focus | `--accent` / `--accent-text` | `#b3a5ff` (6.7:1 on the ground) |
| The one primary button | `--accent-gradient` | `#7a6ae4 → #5a71dd`, white label. It's 4.2:1, so the label is always **bold and ≥ 16px** |
| The player's: shards, the tower, rewards, XP, legendary | `--fx-gold` | `#f0b23c` (7.6:1 as text) |
| Done, claimed, affordable | `--success` | `#6fd9a6` |
| Almost there, a warning | `--warning` | `#ffc078` |
| Informational, second data series | `--info` | `#7fc4f5` |
| Real faults (save failed, import refused) and destructive actions (reset, delete a backup) | `--error` | `#ff9a94` |
| Can't afford yet, locked | **no colour**: `--text-muted` and the lock glyph | — |
| Enemies, damage, boss chrome | `--fx-blood` | unchanged |
| The tower in peril | `--fx-critical` | unchanged |
| A cursed relic's curse line | `--curse` | unchanged, always beside ☾ |

The game's rose ramp (`--rose-*`) goes away.

### 2.4 Glass, and the performance rule

The identity's glass recipe, as written: `--glass-fill`
`rgba(173,190,255,.07)`, 1px `--glass-border` `rgba(196,208,255,.24)`,
`--glass-shadow` `0 8px 24px rgba(6,8,24,.5)`. Strong glass is the
directional sheen. Accent glass is the violet wash. All glass is cool
blue-white, never neutral white.

**Blur.** Today `main.css` has no `backdrop-filter` at all, and the Android
WebView has a GPU-crash history (`plans/android-gpu-crash.md`). The rule:

1. **Over the running arena: never blur.** The HUD, the draft, the boss
   bar, toasts and the corner stack use `--glass-fill-solid`: the
   identity's no-blur fallback, an indigo glass at 88–92% opacity (exact
   value tuned on device). Over a moving battlefield it reads as glass,
   and costs a plain fill.
2. **Over a stopped or hidden arena** (the hub, results, modals, settings,
   sheets): blur with `--blur` 20px, **only** when
   `:root[data-quality='high']`. Every other tier uses `--glass-fill-solid`.
   `app/settings.ts` already applies the quality tier, so it writes the
   attribute too.
3. **Glass inside glass never blurs**, as the identity says.
4. In-page glass gets `saturate(140%)` only where it already blurs.

### 2.5 Type

- **Sarabun 400 and 700** (600 for inline links), self-hosted as woff2 in
  `public/fonts/`: latin and latin-ext, about 20 KB per weight per subset.
  It replaces the Oswald files and `@font-face` blocks. Preload the latin
  700 file in `index.html`, the one that the title and buttons use.
  `tests/palette.test.ts` already bans a Google Fonts `@import`, so the
  self-hosting is enforced.
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) on every
  figure that changes in place: HP, wave, shards, timers, costs, the
  draft countdown.
- **The ramp** is the identity's (12 / 13 / 14 / 16 / 18 / 20 / 22 / 24 /
  28 / 36 / 48), each step still `calc(… * var(--text-scale))`. **The
  floor rises from 9px to 12px.** Today the game uses 9–11px in the HUD,
  badges and pips (`--text-3xs` … `--text-xs`, 24 rules). Each
  of those rules either moves up to 12px or turns into a glyph or a shape
  (pips are bars, not text). This is the biggest layout risk in the plan,
  so §5 and §6 check every screen at 375×812.
- **Unitless line heights** (1.2 / 1.25 / 1.4).
- **Case.** Sentence case everywhere: "Begin run", "Level 2", "Run again".
  Uppercase only for eyebrows, section headers, callout titles and type
  badges ("NEW", "WEAPON"). The one exception is the wordmark on the home
  screen, "The Tower", in Sarabun 700 at `--fs-display` (36px) and
  sentence case, as in the mockup.
- **Big HUD numbers.** Without Oswald, Sarabun needs about 18% more width
  per digit. The wave number keeps 28px. A five-digit shard count gets
  `--fs-xl` and the compact formatter (`core/format.ts`), as it does now.

### 2.6 Motion

UI motion takes the identity's tempo and signature moves: reveal-in (fade
plus an 8px rise, 60ms stagger capped at 240ms), the pop (0.92 → 1.06 → 1
over 180ms) for a claim, a purchase or a pick, and count-ups over 420ms
on results. **Canvas juice is untouched** (hit-stop, shake, the evolution
spotlight): those are the game's, and they're governed by the shake and
motion settings. Mistakes never shake, as the identity asks. The game has
none anyway: an unaffordable tap just shows the cost. `data-motion='reduce'`
snaps everything, as today.

---

## 3. Part 1 — Foundations

1. **Move the folder.** `visual identity/` → `docs/visual-identity/` (no
   space in the path; it sits with the other docs). It's a **vendored
   copy**: nothing in `src/` imports it, and the build never reads it. Add
   `docs/visual-identity/VARIANT.md`: what The Tower changes (this plan's
   §1–§2 in short) and the date of the copy, so a later update from Learn
   Thai can be diffed.
2. **Rewrite `src/styles/tokens.css`** per §2: primitives (a new indigo
   `--ink-*` ramp, §7), the identity's semantic layer, game groups,
   layout. Keep the header comment's rule ("a literal in a component block
   is a bug").
3. **Fonts.** Add the Sarabun woff2 files and `public/fonts/OFL.txt`'s
   Sarabun notice. Remove Oswald. Update `ATTRIBUTION.md`.
4. **Ground.** `body { background: var(--bg-gradient) fixed }`.
   `--bg-last-light` is written by a new `applyGround(regionId)` in
   `app/settings.ts`'s neighbourhood (the hub calls it on region select,
   `App` on run start).
5. **Platform colours.** `index.html` theme-color → `#1d2148`;
   `capacitor.config.ts` `backgroundColor` → `#1d2148`; status bar stays
   light-on-dark. Splash (`assets/splash*.svg`) gets the gradient; then
   regenerate with `@capacitor/assets`.
6. **Rename pass** over `main.css` and the few TS `setProperty` calls, from
   the §2.1 map, in one commit. At this point the game looks broken in
   places (gold buttons turn violet before they're restyled). That's
   expected, and Part 2 follows straight away.

**Done when:** the game boots on the gradient in Sarabun, `npm test`
passes with the new contrast test (§10), and nothing references a removed
token (`grep` for each old name returns nothing).

## 4. Part 2 — Base components

Port `docs/visual-identity/components.css` patterns into `main.css`'s
existing component blocks, in the game's own class names. Don't import the
file: the game keeps one stylesheet, and the identity's class names would
collide with the game's (`.btn`, `.chip`).

1. **Buttons.** Three kinds, no more: `.btn-primary` (accent gradient,
   white bold label, no border), `.btn` (secondary: glass with an
   `--accent-text` label), `.btn-tertiary` (text only, same height).
   Heights 52 / 48 / 40, radius 14, press `scale(.98)` over 120ms, disabled at
   50% opacity. `.btn-danger` becomes a *tone* on secondary or tertiary
   (`--error` label and hairline). `.btn-big` becomes the lg size.
   **Audit:** at most one `.btn-primary` per screen. Known cases today:
   the hub (Begin run), results (Run again; Forge and Map become
   secondary), the draft (none: cards are the choice, Reroll and Banish are
   secondary), Trials (Begin), modals (the one forward action).
2. **Surfaces.** Every panel class maps to one of the three surfaces:
   - *Card* (glass): hub cards, Map region cards, Collection and Feats
     rows, Forge node card, Contract cards, the Daily Omen card, draft
     cards, results sections.
   - *Inset*: stat rows inside a card, the run's shard breakdown, Forge
     totals, tally bars' track area.
   - *Callout*: the Next goal, explainers (`explainer.ts`), the welcome
     back summary, rules text under a Trial.
   - *Sheet*: modals, the mobile sheet, *How it went*: the page gradient at
     76% plus blur (where §2.4 allows), radius 16.
3. **Selected state.** Strong glass plus a 2px `--accent` border. Used for
   the draft's suggested card, the selected region, the selected frame, an
   armed Banish target set, a pinned Forge node. The accent outline means
   *selected* and nothing else: callouts and containers never get one.
4. **Chips and badges.** Badges are flat, 12px bold, radius 999, no border
   ("NEW", "SUGGESTED", "Recipe", "Completes", "Strong here", "Slot n/m",
   rarity labels). Chips (feat chips on results, filters) are accent-tint
   pills, 48px tall.
5. **Segmented control** (`ui/controls.ts`, used in settings): a round
   track with **one** sliding gradient indicator behind the options. The
   indicator is a pseudo-element positioned by a CSS variable that the
   component sets, so the existing API doesn't change.
6. **Icon tile.** A 48px rounded square (radius 16) with a tinted fill and
   the icon in its family colour: the identity's icon tile, used for every
   game-icons artwork in cards and rows. The tint is the item's colour at
   12%, so weapons (arcane) and passives (gold) keep the draft's colour
   coding.
7. **Progress.** Bars are 4px (rows) or 6px (the XP bar, a run's main
   progress), fully round, `--surface` track, `--accent` fill;
   `--success` only for a goal met. **Exceptions the game keeps:** the HP
   bar (green → critical scarlet, the game's own meaning) and the boss bar
   (blood). The ultimate's ring follows the identity's ring (2.5px stroke,
   round caps, from 12 o'clock) in arcane.
8. **Focus ring.** One everywhere: 2px `--accent`, 2px offset, on
   `:focus-visible`.
9. **Scrollbars** on fine pointers: 8px track, a 4px indigo-tinted thumb.
10. **Hit areas.** `tests/touch-targets.test.ts` already holds 44px. Keep
    it, and add the identity's invisible 44×44 overlay for 40px controls.

**Done when:** a dev-only specimen route (`/?specimen`, stripped from
production builds) shows every component in the game's classes, next to
`docs/visual-identity/preview.html` for comparison.

## 5. Part 3 — The hub

Check each at 375×812 first, then desktop (hub docked at 420px).

1. **Home** (`hub/hub.ts`): as in the mockup. Gear in a round-rect glass
   icon button, top right. An eyebrow with the region and its number. The
   wordmark. The tagline in `--text-secondary`. One glass card with Shards
   (gold) and Best wave (`20 · +4`). The Next goal as a callout, its cost
   in gold. The frame and region of the next run as a secondary row with
   a chevron. **Begin run** as the one primary, in a sticky action bar
   above the tabs. The canvas oval behind the home view stays (§7), so the
   home sits on the arena.
2. **Bottom tabs**: a glass bar, outline icons over labels, the active tab
   in `--accent-text` and bold with a soft accent pill behind its icon. The
   "something is ready" dot is `--accent`, not gold. Glass over moving
   content, so it blurs only per §2.4.
3. **Forge** (`hub/forge.ts`): the web keeps its shape and its colours per
   branch (`--branch`). Node rims are glass. *Affordable* gets
   `--success` on the cost, *owned* the branch colour, *locked* muted, a
   *selected* node strong glass with the accent ring, a *pinned* node its
   queue number on a flat accent badge (the dashed gold rim goes). The
   purchase ripple uses the accent. The node card is a sheet.
4. **Map** (`hub/map.ts`): region cards are glass rows. The selected one is
   strong with the accent border. The trophy stars stay gold. Selecting a
   region moves the horizon (§2.2). Trials are a secondary button per card.
5. **Collection, Feats, Stars, Pacts, Tactics, Contracts, Daily Omen**:
   lists of glass rows with an icon tile, a title, a meta line joined with
   ` · `, and a chevron. Section headers are 12px uppercase muted. Claimable
   feats get a *Claim* secondary button. "Claim all", where it exists,
   becomes that screen's one primary.
6. **Settings** (`ui/settings.ts`): glass rows, segmented controls, and
   the volume sliders restyled (accent fill, round thumb). *Reset save* and
   *Delete backup* are tertiary buttons in the danger tone. Export and
   Import are secondary. A failed import says so in `--error` on an
   `--error-bg` inset, the identity's one legitimate red.

## 6. Part 4 — The run's UI

1. **HUD** (`hud.ts`): no panels. Text sits on the arena with a soft navy
   text shadow (no glass slab over the battlefield). The wave as
   `Wave 7 / 20` in sentence case, the number 28px tabular. The region in
   `--text-secondary`, shards in gold. Pause, speed and the Autocaster as
   40px round-rect glass buttons (`--glass-fill-solid`). The XP bar is 6px
   and accent. HP stays green → scarlet.
2. **Build strip** (`build.ts`): icon tiles at 32px, level pips as 3px
   bars in the item's colour. The evolved glow stays (it's game juice).
3. **Draft** (`draft.ts`): cards are glass (`--glass-fill-solid`, no
   blur). A 12px uppercase type label ("WEAPON", "NEW PASSIVE"). The name
   in 16/700. The effect line with its key number bold in the item's
   colour. Flat badges. Pips as bars. The suggested card wears the
   *selected* state (strong glass plus accent border), not a gold border.
   Evolution cards keep their glow, in arcane. The countdown is a 4px
   accent bar. "Level 2" is a 22/700 sentence-case title. Cards flip in
   with the reveal-in stagger, and a pick pops.
4. **Boss bar**: keeps blood. Its panel becomes `--glass-fill-solid` with a
   blood hairline instead of the near-black blood panel.
5. **Toasts** (`toast.ts`): glass, radius 16, an icon tile, a title and a
   meta line. They slide in with decelerate easing.
6. **Pause and welcome-back modals** (`modal.ts`): sheets. The pause menu's
   build and stats are inset rows. Resume is the primary.
7. **Results** (`results.ts`): the wave reached as the hero number
   (count-up). Shard sources as inset rows. Records, discoveries and
   trophies as sections with uppercase headers. **Run again** is the one
   primary, with Forge and Map secondary. Auto-restart's countdown is a
   ring on the primary button. *How it went* is a sheet, and its bars
   follow the identity's chart rule (series 1 accent, 2 info, 3 success,
   then the weapon colours).

## 7. Part 5 — The canvas

Run `impact` on `paintGround`, `INK`, `Renderer.render` and
`setPaletteMode` first, and report the blast radius.

1. **Re-hue the ink ramp.** `INK` (`render/palette.ts`) and `--ink-*` move
   from blue-grey (`#0a0d14` …) to the Blue hour family: navy-indigo darks
   (`#0b0d1f`, `#12142b`, `#181b38` …) and lavender-grey lights. Same
   lightness steps, so the contrast of enemies and projectiles on the
   ground doesn't change. Check it by measuring each `FX` colour against
   the three ground stops before and after: no pair may lose more than
   0.3 of contrast. `tests/palette.test.ts` keeps the CSS and TS lists in
   step.
2. **Inside the light** (`paintGround`): the radial ground keeps its
   structure (ink 600 → 800, mixed with the region tint). It just inherits
   the new ink.
3. **Outside the light**: today a flat `INK['950']`. It becomes the Last
   light gradient, dimmed by the existing fog: one memoised linear
   gradient fill, so it costs no more than today's flat fill. Hub and arena
   then share one ground, and the hub's glass sits on the same sky the run
   is played under. The Abyss keeps its darker mix (`ABYSS_DARK`).
4. **The oval's rim**: today an arcane stroke. It becomes `--accent`
   (`#b3a5ff`) at the current alpha, the identity's violet holding back the
   dark. The home view's oval is the same stroke.
5. **Letterbox bars** (`renderer.ts` ~770): `--bg-stop-2` at 92%, not
   ink black.
6. **Untouched:** every `FX` colour, `SAFE_FX`, rarity, damage numbers,
   particles, shake, hit-stop and the low-HP vignette. The battlefield's
   meaning stays exactly as it is.

**Done when:** a seeded run (`npm run inspect -- --seed 7` for the state,
then the same seed in the browser) shows no loss of readability in
Region 1, Ember Rift and Blight Heart, in both palettes, and `tower.bench`
reports no frame-time regression on the `low` tier.

## 8. Part 6 — Icons, brand and docs

1. **UI glyphs.** Chrome icons (gear, pause, play, close, back, chevron,
   recentre, speed, lock, tabs, export, import, info) switch to **Ionicons
   Outline** (MIT), the identity's set. Add them to
   `scripts/fetch-icons.mjs`'s pinned manifest under an `io-` prefix, in
   the same sprite and the same `IconId` union, so a misspelt glyph is
   still a `tsc` error. Content keeps game-icons (`gi-`). No emoji as UI
   icons. The `◆` shard glyph becomes a small outline gem icon. `☾` on
   cursed relics stays, because it's a content mark.
2. **App icon and favicon.** Redraw `assets/icon-*.svg` and
   `public/favicon.svg`: the tower silhouette in gold on the Last light
   gradient, with an accent-violet ring for the light. Then regenerate with
   `@capacitor/assets`. Two variants to choose from at that point (§11).
3. **Copy pass.** Sentence case, verbs on buttons, ` · ` in meta lines,
   encouraging rather than scolding ("Not enough shards yet · 80 to go",
   never a red "Can't afford"). The lore voice in taglines and boss
   intros stays the game's: the identity's voice rules cover UI copy, not
   fiction.
4. **Docs.** `docs/ui.md` gets a "Visual identity" section that points to
   `docs/visual-identity/` and summarises §1–§2. `docs/render.md` notes
   the ink re-hue and the outside-the-light gradient. `AGENTS.md`'s
   "Colours come from…" rule gains the identity rules, as a trimmed copy
   of `AI_BRIEF.md`'s block adapted per this plan (dark only, gold for the
   player, the blur rule, game-icons for content).

## 9. Files touched

| Part | Files |
|---|---|
| 1 | `visual identity/` → `docs/visual-identity/` (+ `VARIANT.md`), `src/styles/tokens.css`, `src/styles/main.css` (rename pass), `public/fonts/*`, `index.html`, `capacitor.config.ts`, `assets/splash*`, `src/app/settings.ts` (`applyGround`, `data-quality`), `src/content/regions.ts` (`lastLight`), `src/content/abyss.ts`, `src/content/rush.ts`, `ATTRIBUTION.md` |
| 2 | `src/styles/main.css` (buttons, surfaces, chips, badges, progress, focus, scrollbars), `src/ui/controls.ts` (indicator variable), a specimen module under `src/ui/` (dev only) |
| 3 | `src/ui/hub/*.ts`, `src/ui/settings.ts`, `src/styles/main.css` |
| 4 | `src/ui/hud.ts`, `build.ts`, `draft.ts`, `toast.ts`, `modal.ts`, `results.ts`, `rift.ts`, `src/styles/main.css` |
| 5 | `src/render/palette.ts`, `src/render/painters/arena.ts`, `src/render/renderer.ts` |
| 6 | `scripts/fetch-icons.mjs`, `public/icons/sprite.svg`, `src/content/icons.ts`, `src/ui/icon.ts`, `assets/icon-*`, `public/favicon.svg`, `docs/ui.md`, `docs/render.md`, `AGENTS.md` |

Parts 1 and 2 must land together, or close together, because Part 1 alone
leaves the game half-styled. Parts 3, 4 and 5 are independent of each
other once Part 2 is in (different files, apart from their own blocks in
`main.css`). Part 6 can go anytime after Part 1.

## 10. Checks

1. **Contrast test (new, `tests/contrast.test.ts`).** It parses
   `tokens.css` and each region's `lastLight`, and asserts every text token
   ≥ 4.5:1 against every ground stop (the identity's rule), the accent as
   text ≥ 4.5:1, and white on both CTA stops ≥ 4.1:1 (paired with a CSS
   check that `.btn-primary` is bold and ≥ 16px). Adding a region with a
   bad `lastLight` then fails CI.
2. **Palette test** (existing): extend it to the re-hued `INK`/`--ink-*`
   pair, and to ban `--rose-*` and the removed semantic names.
3. **One primary per screen.** A Playwright script, `tools/shots.ts`
   (Playwright is already a dev dependency), loads fixture profiles (fresh,
   mid–Act 1, late Act 2, built with the pacing bot and saved as export
   files) through the save import. It visits every screen at 375×812 and
   1280×800, writes screenshots to `node_modules/.tmp/shots/`, and fails if
   a screen shows more than one `.btn-primary` or any text under 12px. Run
   it before and after each part. The before set is the reference for
   the review.
4. **Performance.** `await tower.bench({ enemies: 400, seconds: 20, tier: 'low' })`
   before Part 1 and after Parts 4 and 5. No regression beyond noise.
   Check on the Galaxy S23 build that the hub (blur on high) and a run (no
   blur) hold 60 fps.
5. **Accessibility.** Text size at 1.3× (`--text-scale`): no clipping on
   the draft cards or the HUD. The colourblind palette still separates
   weapons on the new ground. Reduced motion snaps every UI transition and
   the horizon change.
6. **`npm run typecheck`, `npm test`, `detect_changes`** before each
   commit.

## 11. Still open

- ~~**App icon:** two or three drafts to pick from in Part 6.~~ Decided
  2026-11-18: "the halo", the gold tower inside a full accent ring.
- **The exact `--glass-fill-solid` opacity** over the arena: to tune on
  device. Somewhere between 88% (more glass) and 92% (more legible).
- **A Sunrise (light) theme** isn't planned. The token names allow it
  later, but the arena would stay dark, so it would only ever cover the
  hub. Revisit only if players ask.
- **Feeding back to the shared identity.** Two things here could be useful
  to every app, and could go upstream to Learn Thai's `visual identity/`:
  the per-context last stop (§2.2), and the "no blur over a moving canvas"
  rule (§2.4).
