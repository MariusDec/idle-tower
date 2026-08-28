# Art Direction & Design Tokens

**Files:** `src/styles/tokens.css`, `src/data/palette.ts`, `tests/palette.test.ts`,
`public/fonts/`, `src/styles/main.css`

## The rule

> **A literal colour, radius, duration or font size inside a component block is a bug.**

Not a style preference — a bug, the same way a hard-coded `1280` in the render path was a
bug. If a rule needs a value the token layer does not have, the fix is to add it to
`tokens.css` first and then use it. Two consequences follow, and they are the reason the
rule exists:

- **A palette change is one edit.** Before this, `#3ec46d` was typed independently into
  `main.css`, `Renderer.ts` and three `src/ui/` modules; "make the green slightly cooler"
  was a five-file change that would silently miss one.
- **The canvas and the DOM cannot drift.** A damage number painted on the canvas and a
  damage figure printed in the HUD are the same red because they read the same source.

The exceptions, deliberately: **spacing** is not yet swept (`padding: 6px 10px` and
friends still appear literally — Parts 7-8 rebuild those surfaces and will move them onto
`--space-*`), and the **geometry** of a glow or focus ring (`0 0 0 2px`, `0 0 14px -2px`)
stays literal because it is shape, not palette. The ring's *colour* is always a token.

## The direction: "arcane siege"

A deep, desaturated blue-black ground with four colour families that each mean exactly one
thing:

| Family | Means | Token |
|---|---|---|
| **Warm amber** | Everything the player owns — the tower, gold, physical shots, tower XP, achievements | `--fx-gold` |
| **Violet** | The arcane — mana, magic shots, blessings, research, transcendence | `--fx-arcane`, `--fx-mana` |
| **Hostile red** | Enemies and damage. **Nothing else.** | `--fx-blood` |
| **Hot scarlet** | The tower in peril — low HP, the vignette, a wall breach. **Nothing else.** | `--fx-critical` |

Plus three supporting colours that are effects rather than allegiances: `--fx-ember`
(fire, burn, enrage), `--fx-frost` (chill, shields), `--fx-nature` (healing, buffs,
affordability, contract progress).

### Why red got split in three

Before Part 2 a single red (`#d04848`) was the boss aura, the low-HP vignette *and* the
`--bad` button state. That flattened the most urgent signal in the game: the colour that
means "you are about to lose this run" was also the colour of the Clear Save button and of
every enemy on screen at all times. Three separate jobs now have three separate treatments:

- `--fx-blood` — enemies and damage numbers. Present constantly, so it must be calm.
- `--fx-critical` — hotter and brighter than blood, and it appears *only* when the tower is
  being hurt. Because it is rare, it reads as an alarm.
- `--bad` — generic negative UI (destructive buttons, a stat downside, a cancel). It is
  **rose**, not red, because red belongs to the battlefield. A confirmation dialog is not
  an emergency.

`tests/palette.test.ts` asserts all three stay distinct.

## The layers

`tokens.css` is three layers, and only the middle one is for general use.

1. **Primitives** — the hue ramps: `--ink-*`, `--amber-*`, `--ember-*`, `--violet-*`,
   `--azure-*`, `--green-*`, `--blood-*`, `--rose-*`, each `100` (lightest) to `900`
   (darkest). A component block must not reference these; the semantic layer does.
2. **Semantic** — what a thing *means*. This is the layer components use.
3. **Layout** — sizes the JS also reads or writes (`--panel-width`,
   `--ability-bar-height`, `--vignette-alpha`, …). Not art direction, but there should be
   exactly one place to look for "how wide is the panel".

## The token list

| Group | Tokens |
|---|---|
| Ink ramp (canvas only) | `--ink-050..950` |
| Surfaces | `--surface-0..4`, `--surface-raised`, `--surface-sunken`, `--surface-scrim`, `--surface-overlay`, `--surface-overlay-deep` |
| Strokes | `--stroke-subtle`, `--stroke-strong`, `--stroke-hairline` |
| Text | `--text-0..3`, `--text-on-fill`, `--text-on-amber` |
| Effects | `--fx-gold`, `--fx-ember`, `--fx-mana`, `--fx-arcane`, `--fx-blood`, `--fx-frost`, `--fx-nature`, `--fx-critical` |
| Effect channels | `--rgb-{gold,ember,mana,arcane,blood,frost,nature,critical,warn,bad,shadow,light,surface-0..3,surface-sunken,blood-deep}` |
| Rarity | `--rarity-{common,uncommon,rare,epic,legendary}` |
| Status | `--accent`, `--accent-2`, `--good`, `--good-dark`, `--warn`, `--bad`, `--critical` |
| Domain accents | `--research-color`, `--ability-color`, `--perk-color`, `--passive-color`, `--mod-banner-color` |
| Fonts | `--font-ui`, `--font-display`, `--font-mono` |
| Type scale | `--text-3xs` 9 · `--text-2xs` 10 · `--text-xs` 11 · `--text-sm` 12 · `--text-md` 13 · `--text-base` 14 · `--text-lg` 15 · `--text-xl` 16 · `--text-2xl` 18 · `--text-3xl` 20 · `--text-4xl` 22 · `--text-5xl` 24 · `--text-6xl` 28 · `--text-7xl` 34 |
| Type detail | `--weight-{regular,medium,semibold,bold}`, `--leading-{tight,normal,loose}`, `--tracking-{tight,normal,wide,caps}` |
| Spacing | `--space-0..8` (0/4/8/12/16/20/24/32/40) |
| Radii | `--radius-{2xs,xs,sm,md,lg,xl,2xl,full,circle}` (2/3/4/6/8/10/12/999px/50%) |
| Elevation | `--elev-0..5`, `--elev-up`, `--elev-inset` |
| Motion | `--dur-{instant,fast,base,slow,slower,pulse,ambient}` (60/120/220/420/800/1200/1600ms), `--ease-{out,in-out,spring}` |

Deprecated aliases (`--bg-0..3`, `--border`, `--border-strong`, `--font`, `--radius`,
`--shadow`) still resolve so that the two selectors the camera owns keep working. Do not
use them in new rules.

### Notes on individual groups

- **Elevation is a shadow *and* an inset top highlight**, so a raised surface reads as lit
  from above rather than as a rectangle with a blur behind it. `--elev-up` exists because a
  sheet rising from the bottom edge casts its shadow the other way.
- **Motion**: `--dur-fast` is a state change the player is already looking at, `--dur-base`
  is something entering or leaving, `--dur-slow` is a deliberate reveal. `--dur-slower`,
  `--dur-pulse` and `--dur-ambient` are for ambient loops, never for interaction.
- **The type scale is the sizes the UI uses today**, not the tighter ramp the plan sketches.
  Part 2's brief was "no visual change beyond the palette shift", and resizing 260 pieces of
  text is not that. Parts 7-8 tighten it per surface as they rebuild.

## `palette.ts` and why the values are written twice

`src/data/palette.ts` exports `FX`, `RARITY` and `INK`; `tokens.css` declares the same
values as `--fx-*`, `--rarity-*` and `--ink-*`. That duplication is deliberate:

- The **canvas** cannot read a CSS custom property cheaply — `getComputedStyle` in a paint
  loop is a non-starter, so `Renderer.ts` needs the values as JS strings.
- The **stylesheet** must not need the bundle to have run before it can paint. Generating
  the properties from JS at boot would flash unstyled chrome on every load and would leave
  the Capacitor splash unable to read `--surface-0`.

So both files declare, and **`tests/palette.test.ts` fails the build if they disagree** —
name by name, value by value, in both directions, including the `--rgb-*` triplets. Drift
is a red test, not a bug report from someone noticing two slightly different greens.

`palette.ts` also exports `withAlpha(hex, alpha)` and `toRgb(hex)`: the canvas has no
`color-mix()`, so every translucent fill goes through the helper instead of hand-writing a
second copy of the colour.

### Why `INK` is a primitive the canvas may read directly

`--ink-*` is a **primitive**: layer 1, the raw hue ramp, and a DOM rule must go through
`--surface-*` / `--text-*` instead. The canvas is the one exception, and it is exception
enough to be worth naming. A painted battlefield has no "surface" to elevate — it has
rock. Part 3's layered ground, the tower's masonry, the plinth, the wall blocks and every
cast shadow are steps on that ramp, and before it was exported `Renderer.ts` had
`#1c2028`, `#0c0e12`, `#5b6b7a` and `#2a2f38` typed into it with nothing tying them to the
panels sitting on top.

The semantic layer would be the wrong shape for it: the tower's masonry is not "surface 2",
it is a specific stone two steps lighter than the ground it stands on, and the whole
lighting model in `TOWER_VISUAL` is expressed as positions on that one ramp. So the ramp is
exported, and `tests/palette.test.ts` guards it in both directions like the other two
groups.

Equipment and blessing rarity colours (`RARITY_COLORS` in `src/data/equipment.ts`,
`BLESSING_RARITY_COLORS` in `src/data/blessings.ts`) are now re-exports of the same ladder.
A rare blessing and a rare sword are the same blue.

## Typography

Body text keeps the system stack (`--font-ui`): it is already the most legible face on
every platform and costs nothing to load.

The display face is **Oswald**, a condensed grotesque, under the **SIL Open Font License
1.1** (`public/fonts/OFL.txt`). Condensed matters here for a specific reason: a six-figure
gold total and a three-digit wave number have to fit HUD chips sized for a phone, and a
condensed face buys roughly two extra digits at the same width and optical size.

It is **self-hosted** under `public/fonts/` — the Capacitor build must have no runtime
network dependency — as the variable woff2 (weights 400-700), split latin / latin-ext,
~40 KB total, of which only the ~21 KB latin cut is fetched on a normal load. `index.html`
preloads that cut; `@font-face` uses `font-display: swap` over a genuinely condensed
fallback stack (`Arial Narrow`, `Roboto Condensed`, `Helvetica Neue Condensed`) so the
layout during the swap is close to the final one.

Applied at the base layer to `h1`-`h4` and the `.u-display` utility. `.u-tabular` turns on
tabular figures for numbers that must line up in a column. Parts 7-8 route the wave number,
boss name and damage totals through `.u-display`.

## The canvas literal sweep (UI plan §5.E)

`Renderer.ts`, `EffectsManager.ts`, `Game.ts`, `EnemyManager.ts` and `TalentPanel.ts` used to
carry their own hexes and `rgba()` strings, so the canvas and the DOM drifted apart every time
the palette moved. They now all read `src/data/palette.ts`. Two helpers make that possible
without inventing a second hex for every tint:

- `mix(a, b, t)` — linear sRGB blend, `t = 0` → `a`.
- `lighten(hex, amount)` — `mix(hex, INK['050'], amount)`, the common case.

Where a colour appears at several alphas it goes through `withAlpha(token, a)` rather than a
pre-baked second hex. The only literals still allowed anywhere in `src/` are `'#ffffff'` and
`'#000'`. Iron plating is `INK['200']`, chosen because a lighter *stone* reads as a lighting
change rather than a second material.

The mapping, so the next person does not have to ask why `#ff6633` became ember and not blood:

| Literal | Files | Became |
|---|---|---|
| `#ff5050`, `#ff4040`, `#ff4a4a`, `#c44a4a`, `#d04848`, `rgba(220,60,60,…)`, `rgba(255,64,64,…)`, `rgba(255,80,80,…)`, `rgba(255,60,60,…)` | Effects, Renderer, Game | `FX.blood` (± `lighten` / `mix` toward ink) |
| `#ff6633`, `#ff7a1a`, `#ff3a00`, `#ff6a4a`, `#ff8844`, `#ff8a3c`, `#ff6420`, `#cc4422`, `#ff5a28`, `#ffb04a` | Effects, Renderer, Game | `FX.ember` (± `lighten` / `mix` toward gold) |
| `#ffcc00`, `#ffd24a`, `#ffd34a`, `#ffe27a`, `#fff0a0`, `#fff3b0`, `#ffd28a`, `#f7d774`, `#ffd700`, `#e8a93b`, `rgba(255,215,0,…)` | Effects, Renderer, Game | `FX.gold` (± `lighten`) |
| `#3edc81`, `#3edc64`, `#3ec46d`, `#aaf2c0`, `#2ecc71`, `rgba(80,220,120,…)`, `rgba(39,174,96,…)` | Effects, Renderer, Game, TalentPanel | `FX.nature` (± `lighten`) |
| `#a3d2ff`, `#e0f0ff`, `#64b4ff`, `#a0d8ff`, `#3cb4ff`, `#9be7ff`, `rgba(120,220,255,…)` and friends | Effects, Renderer, Game, EnemyManager | `FX.frost` (± `lighten`) |
| `#a020f0`, `#b432dc`, `#c098ff`, `#9b59b6`, `rgba(180,50,220,…)` | Effects, Renderer, TalentPanel | `FX.arcane` (± `lighten`) |
| `#9aa7ff`, `rgba(150,110,255,…)`, `rgba(140,100,250,…)`, `rgba(120,160,255,…)` | Renderer, Game | `FX.mana` |
| `#0c0e12`, `#1c2028`, `#5a2a00`, `#7a5a30`, `rgba(150,170,190,…)` | Renderer, Game | `INK['900']` / `INK['600']` / `INK['200']` / `mix(FX.ember or FX.gold, INK[…])` |
| `#f0f0f0`, `#ff8a8a` (wave banner) | Renderer | `INK['050']`, `mix(FX.blood, INK['050'], 0.45)` |
| `#e74c3c`, `#f1c40f` (talent branches) | TalentPanel | `FX.blood`, `FX.gold` |
| `'#ffffff'`, `'#000'` | anywhere | **allowed** — the only two literals the guard test whitelists |

### `critical` and `blood` are off-limits to the combo flourish

The §5.C combo edge glow and its embers tint with `FX.gold` and `FX.ember` only, cross-faded by
intensity. `FX.critical` and `FX.blood` are reserved: per the split above, critical red means
"the tower is in peril" and blood red means "an enemy". A combo is the opposite of both, so a
reward that borrowed either colour would teach the player the wrong reflex. `Renderer.drawComboEdge`
carries the same note at the call site.

## Adding to the token layer

1. Add the value to `tokens.css`, in the right layer, with a comment saying what it is for.
2. If it is an `--fx-*` or `--rarity-*` colour, add it to `src/data/palette.ts` too — the
   test will tell you if you forget one side.
3. If it is a colour that will also be used translucently, add the `--rgb-*` triplet.
4. Update the table above.
