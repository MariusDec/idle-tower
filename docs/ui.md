# UI

Vanilla DOM over the canvas. Code: `src/ui/`, styles in
`src/styles/tokens.css` (tokens) and `src/styles/main.css`. Portrait
mobile first: every screen is checked at 375×812 (D4); on desktop the same
portrait arena is centred.

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
- **Results** (`results.ts`, §4.6): wave reached, shards and where they came
  from, records broken (the region's own wave record, told as overtime
  past the boss), discoveries, what opened up (feat chips only once the
  Feats tab is open), trophies (N4), what the Foreman bought (N7), a
  Trial won or not yet (N5), a relic at its peak feeding its set (N6),
  the build, the Next goal, and Run
  again / Forge (or Map after a first boss kill); auto-restart counts down
  when owned. *How it went* (U5) opens a sheet over it: damage dealt by
  weapon (T1's tally) and what wore the tower down (`run.takenBy`: at the
  wall, shots, shockwaves, molten pools, blasts); the countdown waits while
  it is open.
- **Toasts** (`toast.ts`): a new enemy's Bestiary card, a relic found, a
  Champion's coming (N4), a Trial beginning (N5).
- **Modal** (`modal.ts`): pause (with the build and stats, U3), welcome
  back, the Act 1 ending.
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
| Display | quality (Auto / High / Medium / Low, with the tier in force under Auto); text size (100 / 115 / 130%); colours (Standard / Colourblind) |
| Motion | screen shake on/off; motion (Device / Reduced / Full) |
| Save | between runs only (U12): copy save, save file, load save (paste or file, then confirm), restore one of the last three runs' backups ([save.md](save.md)) |
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
  shake, the zoom punch and the boss intro's letterbox.
- **Screen shake** can be turned off on its own.
- **Text size.** Every step of the type ramp in `tokens.css` is
  `calc(Npx * var(--text-scale))`; `applySettings` sets `--text-scale`, and
  the renderer scales its banners and damage numbers by the same factor.
  Settings rows stack label over control so 130% still fits 375 px.
- **Colourblind-safe colours** for the canvas ([render.md](render.md)).
- **Touch targets.** Every control declares a 44 px floor;
  `tests/touch-targets.test.ts` audits the list.
- Buttons are real `<button>`s; segmented controls are radio groups with
  `aria-checked`; dialogs are `role="dialog"` with `aria-modal`.

## Rules

- Colours come from tokens; no literal colour in `ui/` (`palette.test.ts`).
- Card, node and relic text is effect first, 15 words at most (R4).
- Only show readouts the player can act on (§10.2).
- `ui/dom.ts`'s cached setters (`setText`, `toggleClass`, `setStyle`) keep
  per-frame HUD updates from touching the DOM when nothing changed.
