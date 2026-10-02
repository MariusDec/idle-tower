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
  the boss bar while a boss stands; the XP bar and level, the speed toggle,
  the Autocaster switch (each once owned) and the ultimate at the bottom,
  under the thumb. Nothing else: no kills counter, no DPS meter (§10.2).
- **Draft** (`draft.ts`, §10.1): tall cards with an icon, a name, one line
  with the key number highlighted and level pips; NEW stamps; evolution
  cards glow; the suggestion is marked; a countdown bar; tap to pick,
  long-press for details; past four cards, two rows of three.
- **Results** (`results.ts`, §4.6): wave reached, shards and where they came
  from, records broken (the region's own wave record, told as overtime
  past the boss), discoveries, what opened up (feat chips only once the
  Feats tab is open), the Next goal, and Run
  again / Forge (or Map after a first boss kill); auto-restart counts down
  when owned.
- **Toasts** (`toast.ts`): a new enemy's Bestiary card, a relic found.
- **Modal** (`modal.ts`): pause, welcome back, the Act 1 ending.
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
