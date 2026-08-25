# UI System

**Files:** `src/ui/UIManager.ts`, `src/ui/HUD.ts`, `src/ui/UpgradePanel.ts`, `src/ui/AbilityPanel.ts`, `src/ui/PrestigePanel.ts`, `src/ui/TranscendencePanel.ts`, `src/ui/ResearchPanel.ts`, `src/ui/WelcomeBackModal.ts`, `src/styles/main.css`

## Architecture

```
UIManager
  ├── HUD (top bar, never changes tab)
  ├── UpgradePanel (Attack / Defense / Utility sub-tabs)
  ├── AbilityPanel (4 ability cards)
  ├── PrestigePanel (Ascension card + AP perks)
  ├── TranscendencePanel (Transcendence card + TP perks + Automation)
  ├── ResearchPanel (4-category research tree)
  └── WelcomeBackModal (offline progress dialog)
```

## Tab System

5 tabs: Upgrades, Research, Abilities, Prestige, Transcendence.

`UIManager.showTab(id)`:
1. Sets `activeTab`
2. Activates tab button CSS
3. Clears contentRoot
4. Mounts the panel's DOM into contentRoot
5. Calls update() with latest state

## UI Callback Wiring

Callbacks are set from `main.ts` via setter methods on `UIManager`:
- `setOnBuyUpgrade` → `upgradeManager.buy(id)`
- `setOnCastAbility` → `game.castAbility(id)`
- `setOnAscend` → `game.ascend()`
- `setOnTranscend` → `game.transcend()`
- `setOnSpendAP` → `game.spendAP(perkId)`
- `setOnUnlockResearch` → `game.unlockResearch(id)`
- `setOnToggleAutomation` → `game.setAutomationEnabled(key, enabled)`
- `setOnTargetWaveChange` → `game.setTargetAscendWave(wave)`
- Speed/wave controls → corresponding Game methods

## API Interfaces

UI reads state through cached API interfaces (set via setters, refreshed in `syncUiApis`):
- `AbilityAPI`: canCast, reasonBlocked
- `PrestigeAPI`: canAscend, canTranscend, previewAP, previewTP, canSpend, automation checks
- `ResearchAPI`: rp, unlocked, reasonBlocked
- `SpeedAPI`: speeds, currentIndex, maxIndex
- `WaveControlAPI`: autoProgress, currentWave, isIntermission

## HUD Components

UI plan §7. Three vocabularies — chips, bars and the wave header — plus the
speed stepper and the two stat popups.

| Element | Reads | Notes |
|---|---|---|
| Gold / Kills / DPS chips | `resources.gold`, `stats.enemiesKilled`, smoothed DPS | icon + caption + display-face value |
| Tower HP bar | `tower.hp / maxHp` | critical at ≤40% |
| Mana bar | `resources.mana / maxMana` | locked until wave 10 |
| Tower XP bar | `towerXp` | level badge in the head |
| Wave header | `wave.number`, `PacingHudData` | focal number, boss state, threat marks, controls, risk dial |
| Speed stepper | `SpeedAPI` | right-hand group |
| FPS | written by `Game` into `getFpsEl()` | a diagnostic, styled as a lesser citizen |

### The DPS readout

The DPS chip and the Stats tooltip's DPS row read the **same smoothed
value**: a 10 s EMA of real damage dealt, composed per frame in
`UIManager.update`. The tooltip renders that value directly; the chip tweens
toward it per frame (τ = 0.2 s) and writes its text every frame rather than on
the throttled `update()`, so the number eases instead of stepping at 10 fps.
The `setText` cache keeps a settled value at zero DOM writes.

The EMA freezes through an intermission — the 10 s damage window drains to
zero after the last hit, and tracking that would show the tower "losing" DPS
it still has. After the wave resumes there is a 3 s ease hold, then a 10 s
refill window during which the reading only tracks **up**: an early window
under-reports the true rate, so chasing it down would dip the pill below the
value it held and drag it back up as the window filled. The HUD target is
pushed at a fast cadence (250 ms) while the reading is moving and a slow one
(3 s) once it settles, so the tween always has a fresh target.

Under 10 the readout always carries one decimal (`5.0`, not `5`) via
`formatWithOptionalDecimal`'s `keepTrailingZeros` option, so a whole-number
rate is visibly a rate and not a count.

### Resource chips (`.hud-pill`)

`HUD.addPill` builds icon + caption + value; `HUD.setPillValue` writes it. Two
pieces of motion, and they say different things:

- **the tick** fires whenever the resource goes up;
- **the flare** fires only when the gain is worth ≥12% of what was already there
  — proportional, because "a lot of gold" means something different at wave 3
  and at wave 300.

DPS gets neither: it is a rate, and a rate drifting up every frame would flicker
continuously without marking anything the player did. Its motion is the
per-frame tween described above instead — the number eases between readings
rather than jumping.

Gain detection reads the **authoritative** state number, not the tweened display
one. The tween lags by a few frames, so detecting on it re-fires the tick for
every frame the number spends easing towards its target.

Both animations exist twice under two class names that alternate. That is what
restarts them on a repeat gain; the usual `offsetWidth` read forces a
synchronous layout on every gold pickup. The same trick is used by the bar
pulse, the ability ready-flash and the boss phase flash — if you see an `-a` /
`-b` class pair in this part, that is why.

On a phone a chip drops its written caption and keeps its mark. The name stays
as an `aria-label`.

### Bars (`.hud-bar-block`)

One `HUD.makeBar` and one rule set for HP, mana and XP. Beyond the fill:

| Part | What it answers |
|---|---|
| Gradient lit along the top edge | makes the bar a surface, not a coloured rectangle |
| **Ghost** | "how much did that hit take", as a length |
| Segment ticks at each 25% | at HUD size, 61% and 74% are the same bar without them |
| **Threshold pulse** | the frame the reading changed meaning |

The ghost's hold is re-armed by every further drop, so a tower under sustained
fire keeps it pinned and only pays it out once the hitting stops — the read
wanted is the damage from *this* exchange. XP suppresses it: XP wraps to zero on
a level-up, and a trail across the whole bar would read as a loss.

Fills and ghosts run on the per-frame `tickDisplay`, not the throttled `update`.
The fill is already smoothed by the number tween, so a CSS width transition on
top of it double-smoothed and visibly lagged a hit; and a ghost stepping at
10 fps is a stutter, not a trail. The caching `dom` helpers keep a still bar at
zero writes. Each bar seeds itself on its first real reading — without that,
mana on a fresh save opens the run with a full-width ghost draining away.

HP's critical state is **`--fx-critical`**, never `--bad`: Part 2 split those so
this surface could out-shout a Clear Save button rather than match it. It also
carries hazard stripes, because colour alone puts the whole signal on one axis.

### The wave header (`.hud-wave-block`)

The wave number is the focal element — `--font-display` at `--text-7xl`, tabular
— with step chevrons flanking it and everything that *qualifies* the wave
arranged around it on one grid: state, threat, controls, risk dial, momentum.

`focal`, `side` and `controls` are direct children of that grid, which is what
lets the phone layout drop the controls to a full-width row underneath instead
of squeezing five controls into the 200px left beside the number.

Boss-wave state reads off `isBossWave` — the same predicate `WaveManager` spawns
from, so the header and the spawner cannot disagree about what wave 40 is.

The **threat marks** are the coming wave's named types as icon+count chips, from
the enemy table's own icons. Trash is counted and never named, exactly as the
arena overlay does it. The row rebuilds only when the composition signature
changes, so an intermission does not re-create a dozen `<svg>`s ten times a
second. The arena's `PacingOverlay` keeps the readable sentence next to the
spawn arrows it describes; the header is the glance in the persistent chrome,
and on a phone it stands down rather than saying the same thing twice.

The **risk dial** lives here rather than beside the speed stepper: risk is a
statement about the next wave, so the number it prices should be on screen with
it.

## Canvas overlays

`#overlay-root` sits over the canvas and is `pointer-events: none` by default;
each overlay opts back in. Two live there:

| Overlay | File | Shown when |
|---|---|---|
| Run-stalled banner | `RunStalledBanner.ts` | A wave has overrun and started enraging |
| **Boss bar** | `BossBar.ts` | Any boss is alive |
| **Placement prompt** | `PlacementPrompt.ts` | An ability is armed and waiting for a click |
| **Pacing overlay** | `PacingOverlay.ts` | A combo is live, or an intermission is running |

The boss bar (gameplay plan §3.5) is the readout for the whole boss encounter:
tier name, HP with phase pips at 66/33%, the bulwark shield overlay, the active
pattern and its answer, the slam telegraph countdown, and the enrage or
swift-kill clock. `Game.frameUpdate` resolves it from the lead boss and pushes
it via `UIManager.setBossBarData`; passing `null` hides it. See
[boss-encounters.md](boss-encounters.md#the-boss-bar).

### The placement prompt (gameplay plan §4.3)

With `instantCast` turned off, a hotkey *arms* Rain of Arrows, Frost Nova or
Meteor Strike instead of casting it, and the next canvas click places it. That
is a modal input state — the next click means something different from usual —
and the one thing an input state must never be is invisible. `PlacementPrompt`
is a strip near the top of the arena naming the ability and how to cancel
(`Esc`, or the hotkey again). It is `pointer-events: none` and deliberately not
a dialog: the simulation keeps running while the player decides, because
stopping the game to ask where the meteor goes would break the idle contract.

`Game` drives it through `UIManager.setPlacementPrompt(text | null)`, and every
path that leaves placement mode — Escape, the hotkey, a wave transition, a
failed cast, an ascension — clears it. See
[loot-system.md](loot-system.md#click-placed-abilities).

## Corner overlays: the milestone strip and the contract tracker

Two fixed elements share the bottom-left corner, both appended next to the HUD
root rather than inside it (`HUD.renderMilestoneStripSlot` /
`HUD.renderContractTrackerSlot`) — the HUD bar's layout has nothing to say
about a corner overlay.

The **contract tracker** (gameplay plan §5.3) owns the corner: three rows of
`name · 12 / 40` over a progress fill, with the reward on the right. The
**milestone strip** sits directly above it, its `bottom` offset by
`--contract-tracker-height` (96px — the tracker is always exactly three rows,
so a constant beats measuring). The mobile branch applies the same offset on
top of the ability bar and bottom nav, and drops the reward column so three
rows still fit a phone.

Tracker rows key on the contract's **instance id**, so a completed row can
flourish in place while its replacement slides in underneath — including when
the replacement is the same contract drawn again. The flourish is driven by the
`contract_reward` event rather than by a row disappearing: an ascension and a
save load also empty the tracker, and neither deserves a celebration. See
[contract-system.md](contract-system.md#ui).

## Things drawn on the canvas rather than in the DOM

Two Part 4 readouts live in `Renderer` rather than in an overlay, because both
track the cursor and a DOM element chasing the pointer would lag the canvas by
a frame:

- **The charge ring** (§4.2) — a ring at the cursor with three states: filling
  while the hold builds, bright and pulsing once the shot is armed, and dim and
  draining while it is on cooldown. `Game.chargeSnapshot()` resolves it from
  `ChargeTracker`; it is absent entirely when the button is not held.
- **The placement disc** (§4.3) — a dashed, rotating ring at the cursor at the
  ability's radius, with a crosshair, showing exactly what the next click will
  cover.

## The battlefield: ground, tower, range ring, portals

UI plan §3. Owned by `src/game/Renderer.ts` and `src/data/tower.ts`
(`TOWER_VISUAL`); every colour comes from `src/data/palette.ts`.

### The discipline first

Everything below obeys one rule, the one `getEnemySprite` already established:
**if it is static per variant, it is baked into an offscreen canvas once and
blitted afterwards.** A `createRadialGradient` or a `shadowBlur` inside a
per-frame loop is a bug, not a style choice. `Renderer.part(key, size, paint)`
is the single memoised sprite factory the whole part goes through; a full run
lives inside about a dozen sprites.

Measured in-browser at a 1520×860 backing store with 261 enemies and ~250
particles on screen: `Renderer.draw` p50 **1.7 ms**, p95 7.7 ms; the whole loop
(simulate + draw + UI) p50 3.2 ms, p95 8 ms. Baking the ground costs ~5 ms and
happens on a resize or a core change, never in a steady frame.

### The ground, in three baked layers

Composited into one offscreen canvas keyed by `(backing-store size, world
scale, core id)`, blitted 1:1 in device space. It replaces a two-stop radial
gradient plus an 80 px grid at 4% white.

1. **Far field** — a tinted vignette so the arena has a centre and a periphery,
   a weak wash of the run's core colour around the tower, and a seeded field of
   stars and embers at a fixed density per unit area.
2. **Terrain** — a 128 px seeded noise tile filled as a `createPattern` at two
   different context scales (a per-pixel pass over the whole backing store would
   be three and a half million writes on every resize), a handful of large soft
   blotches so the floor has geography, and short cracks radiating out of the
   tower's footing.
3. **Lattice** — concentric arcs and radial spokes **centred on the tower**, so
   the floor's geometry points at the tower from anywhere in the arena. It fades
   out at `ARENA_RANGE_CAP × 1.18` — the furthest any build's range can ever
   reach — rather than at the current `range`, because a lattice keyed on
   `range` would re-bake on every upgrade purchase for a boundary the range ring
   already draws.

Seeding is `mulberry32` over `(size, core)`, so the same viewport always bakes
the same world; `Math.random` would redraw the floor on every resize.

### The range ring

The most important non-entity element on screen, and it was a 1 px dashed
circle at 6% white. Four parts, tinted by the run's core:

| Part | How it is drawn |
|---|---|
| Falloff annulus | One cached sprite of a normalised disc, scaled to the radius. "In range" is a readable *region*, not a line. |
| Crisp rim | A plain stroked arc, so it stays ~2 px at any range. A scaled sprite would thicken as range grew. |
| Sweep | Seven trailing arc strokes rotating at 0.5 rad/s. No allocation. Static under `prefers-reduced-motion`. |
| Change bloom | On a new resolved `range`, the radius eases over **400 ms** (`easeOutCubic`) and a ghost ring blooms outward for 750 ms. |

The ease is the point: buying `Longbow` used to move a nearly invisible line by
three pixels between two frames.

### The tower

`TOWER_VISUAL` carries the geometry and the palette; `Renderer` composites it.
One key light (`TOWER_VISUAL.lightAngle`, up and slightly left) drives every rim
light, band highlight and cast shadow, which is most of what separates "drawn"
from "assembled from primitives".

Split across two passes, along the line where the tower stops being part of the
floor and starts being an object standing on it:

- `drawTowerBase` — cast shadow and stone plinth, **before** the enemies, so a
  mob at contact range walks over them.
- `drawTowerTop` — masonry drum, battlements, tier detail, crystal glow, turret,
  crystal, **after** the enemies, so the player's tower is never occluded by the
  things attacking it. (Previously only the roof was on top and the body was
  under, so enemies overlapped the tower.)

**Detail tiers** come from the tower-XP level via `TOWER_VISUAL.detailTiers`
(`0 / 10 / 25 / 50`), passed through `RenderSnapshot.towerLevel`:

| Tier | Level | Adds |
|---|---:|---|
| 0 | 0 | one masonry course, 8 merlons |
| 1 | 10 | a second course, 12 merlons |
| 2 | 25 | amber banners, turret side vanes, a third barrel band |
| 3 | 50 | a slowly rotating arcane ring in the core's colour |

**The core crystal** is the only place a run's core is visible during play. It
is tinted by `CORE_BY_ID[coreId].color` (via `RenderSnapshot.coreId`) and
charges over the shot cadence — `1 - cooldown × fireRate` — so a tower with fire
rate visibly beats faster than one without.

**The turret** rotates to whatever the tower is shooting, kicks back on firing
and flashes at the muzzle. The heading is read off the projectiles themselves:
every projectile in the game leaves the tower, ids come from a monotonic counter
and the list is append-ordered (both managers prune with `filter`, which
preserves order), so "is there an id above the last one I saw, starting at the
tower" is an exact read of "did we fire, and where at" — without the simulation
carrying a presentation field or the renderer keeping a second copy of the
targeting rules. While the pointer is held the barrel tracks the cursor instead.

**Wall and shield** keep their behavioural reads and gain a shape:

- The wall is a ring of `TOWER_VISUAL.wallSegments` (16) stone blocks that go
  `full → cracked → rubble → gone` in order as `wallHp` drops. Three cached block
  sprites, up to sixteen rotate-and-blits. Previously two stroked circles whose
  width and alpha tracked the ratio, which made a breach a non-event.
- The shield is a six-facet hex barrier; an absorb lights the facets unevenly
  (a deterministic per-facet offset) rather than pulsing the whole ring. Charges
  are countable orbiting pips. This pass previously allocated a fresh
  `createRadialGradient` **per pip per frame**.

### Spawn portals

`RenderSnapshot.spawnLanes` (the real pre-rolled spawn points) opens a rift at
each lane during the intermission — one cached sprite, scaled on its short axis
as it widens, with a rotating ember swirl over it. The **threat arrow is kept
exactly**: it is the only thing that says which way the wave is coming from.

Arrivals are caught renderer-side: an enemy id above the watermark, appearing at
a normalised ellipse radius ≥ `0.88`, gets a 0.4 s rift flare and an expanding
ground dust ring at the point it appeared. The ellipse test is what keeps
splitter children and mid-field summons — which did not walk out of a portal —
from being given one. The list is pooled and capped at 64.

This is what makes on-screen spawning at `ARENA.spawnRingScale` = 1.04 read as
intentional rather than as things popping into existence.

### Reduced motion

Everything that *loops* — the crystal's breath, the range sweep, the tier-3
arcane ring, the rift swirl, the shield's drift — holds still under
`prefers-reduced-motion`. Event-driven motion (the recoil, the range bloom, a
rift opening, an arrival) stays: it is feedback for something that just
happened, and removing it removes information rather than motion.

## Frame Update (`UIManager.update`)

Called every frame from `Game.loop`:
1. Updates the ability bar and the **boss bar** — both *above* the throttle
   below, because both animate continuously and a 2 s slam countdown read at
   10 fps visibly stutters
2. Updates HUD with fresh state
3. Updates active panel if mounted
4. Computes DPS: `expectedHit * fireRate`, averages over 30 samples, updates HUD every 0.5s

`tickDisplayHud` additionally runs the milestone strip's and the contract
tracker's presentation clocks on wall-clock `dt` — the latter is what drains a
completed row's flourish.

Everything after step 1 is throttled to every 6th frame. The caching helpers in
`utils/dom.ts` (`setText` / `setStyle` / `toggleClass`) make an unchanged frame
cost nothing, which is what lets the un-throttled overlays run every frame.

## CSS

Two files, and the order matters:

- **`src/styles/tokens.css`** — the design token layer, imported first from
  `main.css`. Every colour, radius, duration, font size and elevation the app is
  allowed to use, plus the self-hosted display face. **A literal colour, radius,
  duration or font size in a component block is a bug** — see
  [art-direction.md](art-direction.md), which documents the palette, what each
  colour family is allowed to mean, and how `src/data/palette.ts` keeps the
  canvas and the DOM from drifting.
- **`src/styles/main.css`** — the components themselves, ~5400 lines, dark theme:
  - Responsive breakpoints at 1100px, 860px and 768px (the mobile branch)
  - Panel grid layout, tab styling
  - HP/mana/XP bar animations
  - Toast notification styling
  - Modal overlays
  - Scrollable panel content

Spacing is the one group not yet swept onto tokens; Parts 7-8 of the UI plan move
it as they rebuild each surface.

The last section of `main.css` is `Icons`, added by Part 6: the `.icon` base
rule (which is what makes `fill: currentColor` work), the semantic tone classes,
the `.icon-frame` variants and the `data-rarity` frames, and the per-host
`--icon-size` overrides for every surface that used to hold a text glyph.

## Icons

Every icon in the DOM is an `<svg class="icon"><use href="#gi-…">` pointing at a
`<symbol>` in `public/icons/sprite.svg`, built by `src/ui/Icon.ts`:

```ts
renderIcon(host, def.icon);                                   // panels, on update
iconFrame(u.icon, { variant: 'upgrade' });                    // framed
iconFrame(e.icon, { variant: 'item', rarity: eq.rarity });    // rarity-framed
iconMarkup(def.icon, { className: 'eq-compare-icon' });       // string templates
```

The sprite must be in the document before the first `<use>` exists — Chromium
does not resolve external `<use>` references — so `main.ts` awaits
`loadIconSprite()` before mounting the UI. Rarity is a CSS frame over shared
artwork, never a second asset. Full details, including how to add an icon and
the attribution the CC BY licence requires, in
[icon-system.md](icon-system.md).

## The pacing overlay (gameplay plan §7.2 / §7.3)

`PacingOverlay.ts` owns the bottom-centre of the arena — the opposite corner
from the boss bar — and holds two readouts that are never both interesting at
once: a combo dies two seconds after the last kill, and the preview only exists
during an intermission.

**Combo meter (§7.2).** Kill count, tier name, the bonus it is paying, the next
threshold, and a bar that **drains**. The drain is the point: a number that only
counts up is a score, whereas a bar visibly emptying is a clock the player can
beat. It carries no CSS transition, because a 0.18 s ease would make the last
fifth of a two-second window unreadable. Tier drives the colour, so the meter
reads at a glance without being read.

**Threat preview (§7.3).** `31 enemies · 4 Siege · 3 Shielded · 1 Elite
(Retribution)`, plus a `Space: call it now for +3% gold` hint when the wave is
callable. Threat types are *named* and trash is only counted — see
`ENEMY_THREAT_CLASS`. Naming the threat rather than the headcount is what makes
the intermission a preparation window: "4 Siege" tells the player to change
targeting mode or save a cooldown; "31 enemies" tells them nothing they could
act on. The canvas draws matching **spawn-edge arrows** for the lanes the wave
will actually use (`Renderer.drawSpawnLanes`), clustered and capped at 8 —
nineteen arrows measured in-browser rings the arena in noise.

Both are pushed once per frame from `Game.frameUpdate` via
`UIManager.setPacingData`, for the same reason the boss bar is pushed rather
than polled: the combo lives in `PacingManager` and the preview in
`WaveManager`, neither of which `UIManager` can see. One snapshot feeds the HUD
controls, the overlay and the canvas lane markers, so the three cannot disagree.

Both update **above** the UI throttle, like the boss bar: a two-second drain
read at 10 fps is a stutter, not a clock. The caching `dom` helpers make an
unchanged frame free.

## `UIManager.isModalOpen()`

Reports whether any modal this manager owns (welcome-back, run summary, run
failed, keybinds) has the player's attention. `Game.isModalOpen` combines it
with the three it owns itself (wave modifier, blessing draft, core picker) plus
the run-failed flag, and that composite gates the §7.1 `Space` binding.

A bare `modalRoot.childElementCount` check would have been shorter and wrong:
the boss bar, the placement prompt, the pacing overlay and the contract tracker
all live in overlay roots that fall back to `modalRoot`, and none of them is a
modal.

## Capacitor

UI plan §9.E. The game ships to Capacitor as a static `dist/`; nothing in
this repo provisions the native project. Three things make that work:

- `index.html` carries `<meta name="theme-color" content="#0a0d14">`. The
  value pairs with `--surface-0` in `src/styles/tokens.css`; both are the
  ground the app sits on, and keeping them in sync is what makes a notched
  device look continuous from chrome to canvas. Update both together.
- `vite.config.ts` sets `base: './'`. The `dist/` is therefore path-agnostic
  and resolves from a `capacitor://` or `https://` host without re-bundling.
  The icon sprite is already loaded as a relative path
  (`src/ui/Icon.ts:28`) and via `new URL(url, document.baseURI)`, so the
  sprite resolves the same way at runtime.
- No runtime network. Fonts and the icon sprite are both committed under
  `public/`; `src/styles/tokens.css` does not import any web font, and
  `tests/palette.test.ts` scans `index.html` and `src/styles/*.css` for any
  `http://` / `https://` URL outside a comment. A future `@import` of a
  web font fails that test.

To add the native project:

```bash
npm run build
npx cap add android     # or ios
npx cap copy android
npx cap open android
```

The splash background is `--surface-0`. The status-bar style is whatever
`@capacitor/status-bar` is set to in the native project; with the
`theme-color` meta above, the OS picks a dark variant by default.
