# UI

Vanilla DOM over the canvas. Code: `src/ui/`, styles in
`src/styles/tokens.css` (tokens) and `src/styles/main.css`. Portrait
mobile first: every screen is checked at 375×812 (D4), and swept at 360×640
and 412×915 at 100% and 130% text (R7). Large screens get their own
layouts (plans/large-screens.md): `src/app/formFactor.ts` classifies the
`#app` box as `compact` (short side < 600 px, or landscape under 500 px
tall: every phone, which keeps the 480 px portrait stage), `medium` (a
tablet held upright: the arena spans the stage, the HUD, the hub's views
and the results keep to a centred `--content-max` column of 640 px) or
`expanded` (landscape: the HUD in the corners, the hub docked as a
`--hub-width` panel on the right with the arena in the rest, the Forge's
web in that arena region). It writes `<html data-form>`; every large-screen
rule sits at the end of `main.css` under it, so none can reach a phone.
Android locks portrait below 600 dp smallest width and turns freely above
(`MainActivity.applyOrientation`; `appCategory="game"` keeps Android 16
from overriding the phone's lock).

## Layers (`index.html`)

| Element | Holds |
|---|---|
| `#game-canvas` | the arena (the only `touch-action: none` surface besides the Forge web and the Tactics grip) |
| `#hud-root` | the battle HUD |
| `#screen-root` | full-stage screens: the hub, the results |
| `#overlay-root` | the draft panel, toasts, modals, settings |

## Screens and panels

- **HUD** (`hud.ts`, §10.1): HP, wave, region and the run's shards on top,
  the boss bar while a boss stands; the build strip (U3), the XP bar and
  level, the speed toggle, the Autocaster switch (each once owned) and the
  ultimate at the bottom, under the thumb. Nothing else: no kills counter,
  no DPS meter (§10.2).
- **Build** (`build.ts`, U3, U5): one icon per weapon and passive with its
  level as pips, in the draft cards' colours (weapons arcane, passives gold); an evolved weapon shows its evolution and glows; one a
  Harbinger silenced is slashed. The HUD strip redraws only when the build
  changes (`buildKey`). The pause menu lists it with the tower's stats
  (`statsList`: each value, and what this run's passives add).
- **Draft** (`draft.ts`, §10.1): tall cards with an icon, a name, one line
  with the key number highlighted, badges (U4: *Recipe*, *Completes*,
  *Strong here*, *Slot n/m*) and level pips; NEW stamps; evolution cards
  glow; the suggestion is marked; a countdown bar; tap to pick, long-press
  for details; past four cards, two rows of three. With two or more drafts
  banked, *Take suggested ×N*; a run that starts with drafts banked opens
  on the **Opening** ([draft.md](draft.md), U2). With Banish charges (N1),
  *Banish · n* beside Reroll arms the panel: the cards it may strike (new
  items) wear a scarlet ✕ and the rest dim; the next tap on one strikes
  it, any other tap disarms.
- **Results** (`results.ts`, §4.6): wave reached; on a run short of the
  region's best, a gold line under the headline with what did move
  (R2 §4, `plateauLine`): the wave against the median of the last 3–5
  ordinary runs there (`regions[i].recent`), and the Forge's next node
  before → after; the boss line; one card of three stats (kills, time
  held, shards). Then **New this run**, one list of rows, each an icon, a
  name (and a dimmer note) and a tag on the right saying what kind of gain
  it is: records broken first (old value struck through; the region's own
  wave record, told as overtime past the boss), then Starlight records,
  trophies (N4), what the Foreman bought (N7), a Trial won or not yet (N5),
  a contract paid or not, what opened up, relics (new, ranked up, or at
  their peak feeding a set, N6; a new cursed one with Wear), feats (only
  once the Feats tab is open), then discoveries (recipes, enemies,
  secrets, cards). A miss (Trial not yet, contract not met) is a dashed
  row. *Run details* (U5), a link above the list (so a long list never
  pushes it out of view), opens a sheet over it: where the shards came
  from (with Stored Light), the build, damage dealt by weapon (T1's
  tally), what wore the tower down (`run.takenBy`: at the wall, shots,
  shockwaves, molten pools, blasts), and *Along the way* (rifts,
  reliquaries faded, an anomaly let go); the countdown waits while it is
  open. Last, the Next upgrade bar, and Run again / Forge (or Map after a
  first boss kill) pinned under a fade; auto-restart counts down when
  owned.
- **Toasts** (`toast.ts`): a new enemy's Bestiary card, a relic found, a
  Champion's coming (N4), a Trial beginning (N5).
- **Modal** (`modal.ts`): pause (with the build and stats, U3), welcome
  back, the Act 1 ending, and the **paywall** (`paywall.ts`): what one
  purchase opens in three lines, the store's price, Buy, Restore purchase
  and Not now; back closes it. On the free plan the run that first opens
  Ember Rift says so on the results with one button to it, and the Map's
  locked card is its door after that ([monetization.md](monetization.md)).
- **Forge** (`hub/forge.ts`, U8): it opens fitted to what is on show (every
  node, else all but the fog, else what can be bought), never zoomed out
  past a tappable 0.7; ⌖ recentres. A stat node's card adds the web's
  total on that stat, now and after the next level ("Forge total · Damage
  +60% → +75%"). With the Foreman (N7), the card has **Pin** / **Unpin #n**,
  and a pinned node wears its place in the queue over a dashed gold rim.
- **Map** (`hub/map.ts`): a region's best wave is told as `20 · +n` past
  its boss, with its trophy stars (N4); a cleared region has **Trials n/3**
  under its card (N5), opening its three trials, each with its rule, what
  it pays and **Begin** (or **Again**), which starts that run at once.
- **Collection, Relics** (`hub/collection.ts`): below the relics, the sets
  (N6) once one of a set is found: found n/3, or its rank and the progress
  to the next, and *worn* when all three are.
- **Tactics** (`hub/tactics.ts`, U7): Priority, Never and Not listed; with
  Tactician II, the frame's lists for all regions or kept for one.
- **Hub** (`hub/hub.ts`): the home view (title, shards, the selected region's best wave or the Abyss's deepest floor, the next
  run's frame and region, the Next goal) and, as they unlock, the Forge,
  Map, Collection, Feats and Stars behind bottom tabs; Tactics and Pacts
  from the home view; the gear (settings) in its top-right corner; the
  Begin run button always on screen. A dot on a tab means something there
  is ready.

## Settings (`settings.ts`)

Behind the hub's gear, and in the pause menu mid-run. The panel asks the
app to change the profile's settings (`SettingsActions.change`); the app
applies and saves them through `app/settings.ts#applySettings`, the only
place settings reach the game. A volume slider is heard while it is
dragged and saved when it is let go.

| Section | Controls |
|---|---|
| Sound | sound on/off; master, effects and music sliders |
| Display | quality (Auto / High / Medium / Low, with the tier in force under Auto); text size (100 / 115 / 130%); colours (Standard / Colourblind); frame rate (30 / 60 / Device, default 60: [performance.md](performance.md#frame-cap)); screen on in runs (On / Off, default On) |
| Motion | screen shake on/off; motion (Device / Reduced / Full) |
| Full game | the plan (Full game, or Free: Regions 1–3); Restore purchase; between runs on free, a button to the paywall; in dev and debug builds, a Plan (dev) switch (Store / Free / Full) ([monetization.md](monetization.md)) |
| Save | between runs only (U12): copy save, save file, load save (paste or file, then confirm), restore one of the last three runs' backups; on Android, a line that Android backup carries the save (R9) ([save.md](save.md)) |
| Progress | reset, between runs only, asking twice |

A **Stats** page lists the numbers the HUD leaves out (§10.2): runs, best
wave, enemies and elites slain, bosses felled, most shards in a run,
relics, evolutions, feats, the deepest Abyss floor, days played.

## Accessibility

- **Reduced motion.** `motionReduced(settings)`: forced on or off, or the
  device's `prefers-reduced-motion` under Device (followed live).
  `applySettings` writes `data-motion` on the root; CSS animations key off
  `:root[data-motion='reduce']`, the UI asks `ui/dom.ts#motionReduced`
  (the Forge ripple, the Map's light spreading), and the renderer drops
  shake, the zoom punch and the boss intro's letterbox. Enemies keep only
  their plain bob (no gait styles, squash, hit squish or pops), and bosses
  only the wind-up's crouch, the stagger's droop and the wind-up tells,
  which carry information ([render.md](render.md#motion)).
- **Screen shake** can be turned off on its own.
- **Text size.** Every step of the type ramp in `tokens.css` is
  `calc(Npx * var(--text-scale))`; `applySettings` sets `--text-scale`, and
  the renderer scales its banners and damage numbers by the same factor.
  Settings rows stack label over control so 130% still fits 375 px. What
  can't wrap is capped at what its box fits, never below its 100% size: the
  hub's tab labels and a draft card's pills, via container units (`cqi`).
  What grows past the stage scrolls instead of clipping: the hub's home and
  the draft (`justify-content: safe flex-end`, so a tall draft keeps its
  title), and a draft card's height is a floor, not a size.
- **Colourblind-safe colours** for the canvas ([render.md](render.md)).
- **Touch targets.** Every control declares a 44 px floor;
  `tests/touch-targets.test.ts` audits the list.
- Buttons are real `<button>`s; segmented controls are radio groups with
  `aria-checked`; a yes-or-no setting is a switch row (`role="switch"`,
  the whole row the target, its label fixed whatever the state), never an
  On/Off pair; dialogs are `role="dialog"` with `aria-modal`.
- **Page change.** The hub's views slide like stacked cards (tabs by tab
  order; Tactics, Pacts, Contracts and the Omen push over the Tower), the
  dock still; `src/ui/pageNav.ts`. Reduced motion swaps at once.

## Visual identity

The UI wears the shared identity ("Sunrise / Blue hour", vendored in
[`docs/visual-identity/`](visual-identity/), with Blue Hour's changes in its
`VARIANT.md`), as the "Last light" variant
([plans/visual-identity.md](../plans/visual-identity.md)):

- **Ground.** Blue hour at 135° with a warm fourth stop, `--bg-last-light`,
  that each region tints (`LAST_LIGHT` in `content/regions.ts`, written by
  `applyGround`). Dark only.
- **Surfaces.** Glass card, inset, callout, plus the sheet for modals.
  Over the running arena glass is `--glass-fill-solid` and never blurs;
  over a stopped arena it blurs only on the `high` quality tier.
- **Colour jobs.** The violet accent is the UI's (interactive, selected,
  progress, focus); one `.btn-primary` per screen. Gold (`--fx-gold`) stays
  the player's: shards, the tower, rewards, legendary. Can't-afford is
  muted, never red; `--error` is for real faults and destructive actions.
- **Type.** Sarabun 400/600/700, self-hosted, tabular numerals, a 12px
  floor, sentence case (uppercase only for eyebrows, section headers and
  type badges).
- **Icons.** Two families in one sprite and one `IconId` union
  (`scripts/fetch-icons.mjs`): game-icons.net artwork for content (`gi-…`,
  bare ids: weapons, passives, relics, enemies, Forge nodes), drawn inside
  the identity's icon tile; Ionicons 7.4.0 *Outline* for UI chrome (`io-…`:
  gear, pause, close, chevrons, tabs, lock, the shard mark). Content tables
  may not name an `io-` icon (`content/lint.ts`). No emoji as UI icons. The
  few glyphs CSS paints itself are `mask` tokens (`--glyph-close`).
  Content marks stay text: ☾ on a cursed relic, ✦ Starlight, ★ trophies.
- **Copy.** Sentence case, a verb on every button, meta lines joined with
  ` · `, encouraging rather than scolding ("Not enough shards yet · 80 to
  go"). Lore voice (taglines, boss intros) stays the game's own.
- **App icon.** "The halo": the tower in gold inside the accent ring, on
  the Last light ground (`assets/icon*.svg`, `public/favicon.svg`). Edit
  the SVGs, render the PNGs with `rsvg-convert`, then run
  `npx capacitor-assets generate --android` with `#1d2148` backgrounds.

## Rules

- Colours come from tokens; no literal colour in `ui/` (`palette.test.ts`).
- Card, node and relic text is effect first, 15 words at most (R4).
- Only show readouts the player can act on (§10.2).
- `ui/dom.ts`'s cached setters (`setText`, `toggleClass`, `setStyle`) keep
  per-frame HUD updates from touching the DOM when nothing changed.
