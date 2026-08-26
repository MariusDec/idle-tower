# The Tower — UI, Art & Presentation Plan

**Date:** 2026-08-21
**Branch base:** `gameplay-improvements` (all of `plans/gameplay-improvements.md` is implemented)
**Baseline:** `tsc --noEmit` clean · 387/387 vitest · `npm run sim` / `npm run checks` reproduce the
documented curves. Every part below must land with that baseline still green.

**Scope reviewed:** `src/game/Renderer.ts` (1535 lines), `src/game/Game.ts` render/input path,
`src/styles/main.css` (5383 lines), all 35 modules in `src/ui/`, `src/systems/EffectsManager.ts`,
every icon/`glyph`/`sprite` field in `src/data/`, `index.html`, `main.ts` input wiring, and a live
build at `localhost:5173` at desktop and phone viewports.

This plan is about **presentation only**. The gameplay plan answered "is it fun to play?"; this one
answers "does it look like a game you *want* to play, on a desktop and on a phone?" The one place
the two touch is Part 1 — the zoom-out has a balance consequence and is priced explicitly.

---

## 0. Diagnosis

### 0.1 The camera does not exist

`index.html` hard-codes `<canvas width="1280" height="720">`. That backing store *is* the world:
`Game` puts the tower at `canvas.width/2, canvas.height/2`, `EnemyManager.setBounds` and
`ProjectileManager.setBounds` take the same two numbers, and `WaveManager` spawns 20 px outside that
rect. CSS then scales the element with `aspect-ratio: 16/9; max-width/height: 100%`. Consequences:

| Symptom | Cause |
|---|---|
| Blurry on every hi-DPI screen and every phone | No `devicePixelRatio` handling; a 1280-wide buffer is upscaled to a 2560-wide CSS box |
| Nothing reflows on resize/rotate | There is no resize listener anywhere in the project (`grep -rn "resize" src/` → one hit, unrelated) |
| Portrait phones get a letterboxed strip | `aspect-ratio: 16/9` is unconditional |
| Corner enemies take twice as long to walk in as edge enemies | Rectangular spawn band around a square-ish arena |

### 0.2 The range ring is bigger than the arena

Half the canvas height is 360. `TOWER_BASE.range` is **300**. So at wave 1 the tower's reach already
covers 83% of the vertical half-extent — the ring is clipped by the top and bottom edges the moment
the game starts. `range` upgrades add `5 × 60 = +300` (→ 600), talents add up to `+30%`, the `Reach`
blessing up to `+45%`, equipment `range_pct` more on top: a stacked build resolves past **1300**,
roughly 3.6× the visible half-extent. Enemies are therefore in range from the frame they spawn, the
approach reads as nothing, and range as a stat has no visible meaning.

This is the single most-requested fix and it drives Part 1.

### 0.3 Everything on the battlefield is a canvas primitive

There is not one raster or vector asset in the render path. `paintEnemyBody` is a `switch` over six
shapes drawn with `arc`/`moveTo`/`fillRect` and a 2 px stroke. The tower is a filled circle, a
triangle roof and a 3-point flag (`drawTowerBase` / `drawTowerTop`). The background is a two-stop
radial gradient plus an 80 px grid at `rgba(255,255,255,0.04)`. Physical projectiles are a
14 px arrowhead; magic ones a 16 px radial blob.

The *information design* here is genuinely good — burrowed vs surfaced silhouettes, ward lattices,
slam telegraphs, thief escape arrows — and Part 3/4 must preserve every one of those reads. What is
missing is craft: no lighting, no rim light, no texture, no depth, no material.

### 0.4 The icon layer is ASCII

- **Abilities** (`src/data/abilities.ts`): `glyph` is a single letter — `'R'`, `'F'`, `'L'`, `'P'`,
  `'B'`, `'M'`, `'G'`, `'E'`, `'W'`, `'V'`. Ten abilities, ten letters.
- **Research** (`src/data/research.ts`): a mix of letters and emoji (`'P'`, `'🛡'`, `'💥'`, `'👑'`),
  so the panel renders in two visually unrelated styles at once.
- **Upgrades** (27), **talents** (37), **blessings** (30), **cores** (5), **passives** (8): no icon
  field at all.
- **Equipment** (10 items): the only real assets — `public/sprites/equipment/*.svg`, each a 3–4 path
  monochrome `#888` outline at 32×32. Better than nothing, well below the bar.

### 0.5 The chrome is a spreadsheet

`:root` defines a competent dark palette (`--bg-0`…`--bg-3`, `--text-0`…`--text-3`) and then almost
nothing uses it for anything but flat fills. Base font is 14 px, buttons are `6px 10px` with a 6 px
radius, and the tab nav is a **12-button grid that wraps to four rows** before the panel content
starts. No elevation, no gradients, no focus states worth the name, no transitions beyond three
`0.12s ease` on buttons, and 5383 lines of CSS with no token layer to change any of it centrally.

### 0.6 Mobile is a media query, not a design

`@media (max-width: 768px)` hides the side panel and swaps in `BottomNav` + `MobileSheet`. That
plumbing works. What is absent: safe-area insets (the `viewport-fit=cover` meta is set but no
`env(safe-area-inset-*)` is ever read, so a notch/gesture bar will eat the HUD and the ability bar),
a portrait arena, touch targets at the 44 px minimum, `overscroll-behavior` (pull-to-refresh will
fire mid-run), `-webkit-touch-callout`/tap-highlight suppression, and any quality tier for a
mid-range Android GPU. This all has to be right *before* the Capacitor build, not after.

### 0.7 What is already good (do not regress it)

- **Performance discipline.** `Renderer` caches enemy bodies, shadows, auras, crowns and orbs into
  offscreen canvases keyed by `(type, variant)`; `EffectsManager` pools particles (600) and damage
  numbers (80) and merges numbers within 16 px / 0.22 s; `SpatialGrid` bounds the broadphase. Every
  new effect in Parts 3–5 must arrive with the same discipline.
- **Behavioural readability.** Burrower mound vs dome, warden hex lattice, siege stance, thief coin +
  escape arrow, boss slam ring / bulwark arc / siphon beam, spawn-lane arrows, charge ring,
  placement disc. These are load-bearing gameplay reads. Restyle them; never remove one.
- **Existing juice.** Screen shake, boss slow-mo, low-HP vignette, hit sparks, death bursts, chain
  lightning, shockwave rings, damage-number merge.
- **The idle contract.** Nothing here may cost throughput or require attention.

### 0.8 Rules for every part

1. **Green baseline or it does not land**: `npm run typecheck`, `npm test`, `npm run checks`.
2. **Frame budget**: 200+ enemies, 600 particles, 80 damage numbers must hold 60 fps on desktop and
   ≥45 fps at the `low` quality tier on a 1080p phone-class viewport. Anything per-entity and static
   gets cached the way `getEnemySprite` already does.
3. **Mobile-first**: every rule is authored so the phone case is the default, not the exception.
   No hover-only affordance may be the *only* route to an action.
4. **Tokens, not literals**: after Part 2, a new colour or radius in a component file is a bug.
5. **Docs follow code**: each part updates `docs/ui-system.md` (and adds `docs/camera-system.md`,
   `docs/art-direction.md`, `docs/icon-system.md`) plus the `AGENTS.md` index.

---

## 1. Camera, arena and the zoom-out

**Owns:** `src/data/arena.ts` (new), `src/game/Camera.ts` (new), `src/game/Renderer.ts` (transform
only), `src/game/Game.ts` (sizing/resize/input), `src/main.ts` (pointer mapping), `index.html`,
`src/systems/{EnemyManager,ProjectileManager,WaveManager}.ts` (bounds/spawn), `src/data/enemies.ts`,
`src/data/tower.ts`, `src/data/abilities.ts`, `src/data/loot.ts`, `src/stats/resolve.ts`,
`docs/camera-system.md` (new).

### 1.1 The geometry, and why it is shaped this way

The ask is "zoom out, and leave plenty of space outside the range ring." Those are two different
numbers and it matters which one moves.

Enemies in this game **do not pass through** the tower's range — `EnemyManager.tick` walks them to
the contact radius and parks them there until they die. So "time in range" is not a fixed window that
a bigger arena would shrink; the only thing a bigger arena costs is **walk-in dead time before the
first shot**. That single fact is what makes the zoom-out cheap:

> Multiply every world-space **distance and speed** by the same factor, and every timing in the game
> is unchanged. Leave **range** out of that multiplication, and the range ring shrinks relative to
> the arena by exactly that factor.

So:

```ts
// src/data/arena.ts
export const WORLD_SCALE  = 2.6;   // positions, speeds, spawn bounds, AoE/splash radii
export const ENTITY_SCALE = 1.7;   // body radii, sprite sizes, particle sizes
export const ARENA = {
  /** World units guaranteed visible from the tower along the SHORT viewport axis. */
  minHalfExtent: 936,              // = 360 × WORLD_SCALE
  /** Long-axis half-extent is derived from viewport aspect, clamped so ultrawide
   *  does not hand the player a telescope and portrait does not crush the field. */
  aspectClamp: [0.62, 2.20] as const,
  /** Spawn ellipse, as a multiple of the matching half-extent. */
  spawnRingScale: 1.04,
  /** Hard ceiling on resolved `range`, as a fraction of `minHalfExtent`. */
  maxRangeFraction: 0.70,          // → 655 world units
} as const;
```

`WORLD_SCALE` and `ENTITY_SCALE` are applied **at data-definition time** (a `scaled()` helper in
`arena.ts` used by the `ENEMY_DEFS`, `TOWER_VISUAL`, `MANUAL_AIM`, `LOOT_TUNING`, ability-radius and
projectile-speed tables) so the ~40 call sites downstream never learn about them.

What each number buys, on screen:

| | Today | After |
|---|---|---|
| Visible world area | 1280 × 720 | 2433 × 1369 (16:9), reflows to any aspect |
| Range ring ÷ short half-extent, wave 1 | **0.83** | **0.32** |
| Range ring ÷ short half-extent, flat max | 1.67 | 0.51 |
| Range ring ÷ short half-extent, hard cap | ~3.6 | **0.70** |
| Enemy on-screen size | 1.00 | 0.65 (a real zoom-out; Part 4's art detail pays it back) |
| Enemy on-screen speed | 1.00 | 1.00 |
| Walk-in time, projectile flight, wave duration | 1.00 | 1.00 |

### 1.2 Range rebalance

`ENTITY_SCALE < WORLD_SCALE` and range being unscaled together mean range is *relatively* nerfed by
2.6× — which is the zoom-out, stated honestly. Two follow-on changes keep the stat meaningful
instead of merely smaller:

- `src/data/upgrades.ts` → `range`: `effectPerLevel` **5 → 3**, `maxLevel` **60 → 60** (flat max
  `300 + 180 = 480`, i.e. 0.51 of the half-extent). The upgrade goes from +100% to +60% of base.
- `src/stats/resolve.ts` → the existing `range: { min: 1 }` clamp gains
  `max: ARENA.minHalfExtent * ARENA.maxRangeFraction` (655). A range-stacked build (480 × 1.30
  talents = 624, plus one `Reach` stack) reaches the cap; the cap is surfaced in the stats
  breakdown as an `Arena cap` row so it is never a silent dead stat.

**Acceptance:** `npm run sim` wave-time curve within ±10% of the pre-change table across waves
1–200; `npm run checks` idle-parity unchanged. If knockback/slow/mine value has drifted more than
that (they are the stats most coupled to approach geometry), tune `spawnRingScale` first, then the
enemy `baseSpeed` table, and record the before/after in this file.

### 1.5 Measured (2026-08-21)

**Balance: zero drift.** `npm run sim` was captured at `HEAD` in a scratch worktree and again on the
implemented tree. The two outputs are **byte-identical except for one line**:

```
- Charged shot: 0.9 DPS-seconds of damage, +3 pierce, 90px splash, every 5.2s of wall-clock time.
+ Charged shot: 0.9 DPS-seconds of damage, +3 pierce, 234px splash, every 5.2s of wall-clock time.
```

`90 × 2.6 = 234` — that is `WORLD_SCALE` doing exactly its job, reported by a print statement. Every
curve the simulator produces (wall wave by AP tier, gold, AP/run, the risk-dial table, the idle drift
check) is unchanged. This is a stronger result than the ±10% the plan asked for, and it is the
§1.1 thesis confirmed: scaling distance and speed by the same factor leaves every timing untouched.
No `spawnRingScale` or `baseSpeed` tuning was needed.

`npm run checks` passes in full. `npm test` is 418/418 (387 before, +31 from `tests/camera.test.ts`
and `tests/palette.test.ts`).

**Geometry, measured live in the browser:**

| | Measured | Target |
|---|---|---|
| World at 16:9 | 3028 × 1872, tower centred | — |
| Short half-extent, landscape | 936 | 936 |
| World in phone portrait (375×812) | 1872 × 2153, tower centred | — |
| Short half-extent, portrait | 936 | 936 |
| Backing store | = CSS box × DPR exactly (680×420 @1, 840×966 @2) | DPR-exact |
| Range ring ÷ short half-extent, base 300 | 0.320 | ~0.32 |
| … flat upgrade max 480 | 0.513 | — |
| … at `ARENA_RANGE_CAP` 655 | 0.700 | ≤0.70 |

The `aspect-ratio: 16/9` lock is gone: portrait produces a genuinely tall arena rather than a
letterboxed strip, and the short axis holds its 936 half-extent across both orientations.

One testing note worth keeping: `ResizeObserver` callbacks are delivered as part of the rendering
steps, so a page with `document.hidden === true` will not reflow on a programmatic viewport change.
Call `camera.measure()` directly when verifying in a hidden pane. This is documented in
`docs/camera-system.md` §4 so it is not re-diagnosed as a bug later.

### 1.3 `Camera`

A small class, not a framework. It owns:

- **Sizing.** A `ResizeObserver` on `.canvas-wrap` plus `orientationchange`. On change: read the CSS
  box, compute `dpr = min(devicePixelRatio, 2)` (capped — a 3× phone buffer is a 2.25× fill-rate tax
  for no visible gain), set `canvas.width/height = cssPx × dpr`, derive world half-extents from
  `minHalfExtent` and the clamped aspect, and emit a `resize` so `Game` can re-seat the tower, push
  new bounds to the enemy/projectile managers, rescale live enemy positions proportionally (a resize
  mid-wave must not teleport anything out of bounds), and invalidate the renderer's background cache.
- **Transform.** `applyWorld(ctx)` sets `setTransform(s, 0, 0, s, ox, oy)`; `applyScreen(ctx)` sets
  `setTransform(dpr, 0, 0, dpr, 0, 0)`. The wave banner, screen flash and vignette move to screen
  space; everything else stays in world space.
- **Conversion.** `screenToWorld` / `worldToScreen`, used by `main.ts` pointer handling (replacing
  the `canvas.width / rect.width` arithmetic) and by any DOM overlay that must track a world point.
- **Shake and punch.** Shake becomes a camera translate, not the current
  `.canvas-wrap.is-shaking` CSS animation — today the whole element jitters, including the DOM
  overlays pinned to it. A short `zoomPunch` (≤3%, ≤180 ms) is available for boss death and enrage.
  Both respect `prefers-reduced-motion` and the Settings toggle from Part 9.

### 1.4 Spawning

`WaveManager.randomSpawnPoint` moves from a rectangle to an **ellipse** matched to the viewport
half-extents × `spawnRingScale`. This removes the corner/edge asymmetry, works at any aspect
including portrait, and gives Part 3's spawn portals a well-defined place to open.

At `spawnRingScale = 1.04` enemies materialise just off-screen on the short axis and *just* on-screen
on the long axis — which is fine, because Part 3 gives them a 0.4 s rift-emergence animation. The
existing `spawnLanes` threat preview keeps working unchanged; it simply points at portals now.

---

## 2. Design tokens and art direction

**Owns:** `src/styles/tokens.css` (new), `src/styles/main.css` (`:root` + a mechanical sweep),
`index.html` (font links), `docs/art-direction.md` (new).

Nothing else can be done well until there is a vocabulary. This part ships no new feature; it makes
Parts 3–9 cheap and consistent.

### 2.1 The direction

**"Arcane siege."** Deep desaturated blue-black ground, warm amber for everything the player owns
(tower, gold, physical shots), violet for arcane (mana, magic shots, blessings), and hostile reds
reserved *exclusively* for enemies and damage — today red is used for both the boss aura and the
low-HP vignette and the `--bad` button state, which flattens the most urgent signal in the game.
High-contrast rim lighting on every battlefield entity so silhouettes read at the new zoom level.

### 2.2 The token layer

```
--space-1..8            4px baseline scale
--radius-sm/md/lg/full
--text-xs..3xl          type scale, 12/13/15/17/20/24/32
--font-display          a display face for wave/boss/number moments
--font-ui               the existing system stack
--elev-0..3             layered shadow + inset highlight, not a single --shadow
--dur-fast/base/slow    120/220/420ms
--ease-out/spring
--surface-0..3          replaces --bg-0..3, with an explicit "raised" vs "sunken" pair
--stroke-subtle/strong
--fx-gold/mana/arcane/blood/frost/nature   semantic effect colours, shared with the canvas
--rarity-common..legendary                 one source of truth for equipment + blessings
```

The `--fx-*` group is exported to TypeScript from a single `src/data/palette.ts` so the canvas and
the DOM cannot drift — today `#3ec46d` appears in `main.css`, `Renderer.ts` and three UI modules
independently.

Two Google Fonts, loaded with `font-display: swap` and a real fallback stack: a condensed display
face for numbers and headings, and the system UI stack for body text. Self-host them under
`public/fonts/` so the Capacitor build has no network dependency.

### 2.3 The sweep

Mechanical, and the only part of this plan that touches every file: replace literal colours, radii,
shadows and durations in `main.css` with tokens. No visual change is intended in this part beyond
the palette shift; anything that *looks* different afterwards is a bug to fix here, not later.

---

## 3. The battlefield: ground, tower, range

**Owns:** `src/game/Renderer.ts` (background/tower/range/wall/shield/portals),
`src/data/tower.ts` (`TOWER_VISUAL`), `src/data/palette.ts`.

### 3.1 Layered ground

Replace the two-stop gradient + 80 px grid with three cached layers, composited once per frame (and
re-baked only on resize or core change):

1. **Far field** — a dark tinted vignette gradient plus a sparse, seeded star/ember field.
2. **Terrain** — a seeded value-noise stone/ash texture baked once into an offscreen canvas, with
   subtle large-scale blotching so the arena has a centre and a periphery rather than reading as
   graph paper. Cracks radiating from the tower base.
3. **Grid** — kept, but as a faint hex or concentric-arc lattice centred on the tower, so the
   geometry of the arena tells you where the tower is even off-screen. Fades out past the range ring.

### 3.2 The range ring, redesigned

It is the most important non-entity element on screen and it is currently a 1 px 6% dashed circle.
Replace with:

- A soft radial **falloff annulus** — the inside of the ring lifted a few percent in brightness, so
  "in range" is a readable region and not just a line.
- A crisp rim at `range` with a slow rotating sweep highlight (one cached sprite, rotated).
- A **change animation**: when `range` resolves to a new value, the ring eases to it over 400 ms with
  a brief bloom — so buying `Longbow` has a visible payoff, which today it does not.
- Tinted by the equipped core (Part 3.3).

### 3.3 The tower

The tower is the player's avatar and is currently a grey circle with a party hat. Rebuild as a
composited, layered sprite that reads at the new zoom:

- **Base**: a stone plinth with an ambient-occlusion ring and a cast shadow.
- **Body**: banded masonry with rim light from a fixed key direction; battlements.
- **Core**: a glowing crystal at the centre, **tinted by the selected tower core**
  (`src/data/cores.ts`, 5 cores), pulsing on the fire cadence. This is the cheapest possible way to
  make cores — the run's identity — visible during play, where today they are invisible.
- **Turret**: a barrel/ballista that **rotates to the current target** and recoils on fire, with a
  muzzle flash. Today nothing on the tower reacts to firing at all.
- **Tiers**: the silhouette gains detail at tower-level thresholds (banners, a second tier of
  masonry, arcane rings) so levelling is visible on the battlefield.
- **Wall / shield**: the wall becomes a segmented stone ring whose segments crack and fall as
  `wallHp` drops; the shield becomes a faceted hex barrier that flickers per-facet on absorb.

All of it cached per `(coreId, tier, wallSegments, shieldCharges)` and blitted — same discipline as
`getEnemySprite`.

### 3.4 Spawn portals

The pre-rolled `spawnLanes` become rift portals that open during the intermission (swirl + ember
spill, one cached sprite rotated and scaled) and disgorge each enemy with a 0.4 s emergence
(scale-in + alpha + a ground dust ring). This is what makes on-screen spawning at
`spawnRingScale = 1.04` read as intentional.

---

## 4. Enemies, projectiles and impacts

**Owns:** `src/game/Renderer.ts` (enemy/projectile paint), `src/data/enemies.ts` (visual fields),
`public/sprites/enemies/` (new).

### 4.1 Bodies

Keep the six-shape `switch` as the *silhouette* contract — it is what `content-coverage.test.ts`
asserts against and what makes types identifiable — and paint each one properly inside it:

- Two-tone body fill with a rim light and a contact shadow, per type.
- A per-type detail pass: chitin plates on the tank, a cracked shell on the splitter, tattered wings
  on the flyer, a glowing sigil on the warden, a smoking barrel on the siege engine.
- **Elites** get a metallic overlay and an aura-coloured rim rather than only a `♛` glyph.
- **Bosses** get a distinct silhouette per tier and a dedicated cached body — a boss must never be
  "a big circle" again.

Everything still bakes into `enemySprites` keyed by `(type, elite, enraged, buried)`; the added cost
is one-time per key, not per frame.

### 4.2 Motion and reaction

- **Hit flash**: a 60 ms white-additive blit of the same sprite. Currently a hit produces sparks but
  the body itself never acknowledges it.
- **Death**: a directional dissolve (shards flung along the killing blow's vector) instead of the
  current symmetric burst.
- **Locomotion**: a 2-frame squash/bob per type driven by `time + id`, so a crowd of 200 does not
  read as a static point cloud sliding across the ground.
- **Status**: slow → frost crust + slower bob; burn → ember drip; stun → orbit ring.

### 4.3 Projectiles

- Physical: a fletched bolt with a fading motion trail (a short cached polyline, not a per-frame
  particle spawn) and a rotation locked to velocity.
- Magic: a core + corona + trailing wisps, additively blended.
- **Core-specific shot visuals** for all 6 behaviours in `src/data/cores.ts` — again, cores should be
  visible in play.
- Impacts: a decal on the ground (pooled, capped at 48, fading over 2 s) and a directional spark cone
  aligned to the impact normal.

### 4.4 Muzzle and tracers

A muzzle flash at the turret on every shot, and a one-frame tracer line for very high fire rates
where individual projectiles blur — this is what makes a maxed tower *feel* maxed.

---

## 5. Effects, juice and the additive layer

**Owns:** `src/systems/EffectsManager.ts`, `src/game/Renderer.ts` (effect passes),
`src/game/Game.ts` (event → effect wiring).

- **An additive pass.** Glows, magic, crits and explosions currently composite in `source-over` and
  read as flat paint. Introduce one `globalCompositeOperation = 'lighter'` pass, drawn between
  entities and UI, with every glow-class effect routed into it. This alone is the single biggest
  visual upgrade per line of code in this plan.
- **Damage numbers** move to **screen space** (so they are legible at any zoom), gain a size and
  colour tier by damage-relative-to-enemy-max-HP, a small pop-then-settle curve, and crits get a
  punch scale plus a chromatic edge instead of the current `!` glyph hack. The 16 px / 0.22 s merge
  window is kept — it is doing real work.
- **Combo / momentum flourish**: the pacing system's combo tiers (`src/data/pacing.ts`, 4 tiers) get
  escalating screen furniture — edge glow, a heat tint, faster ember drift — so momentum is felt on
  the battlefield and not only in the overlay.
- **Boss intro**: a short, skippable cinematic — camera punch, letterbox bars, a portal, the boss
  name and pattern. Reuses the existing slow-mo and `BossBar`; must be skippable on tap/key and must
  auto-skip when the speed multiplier is above 2× (idle contract).
- **Pool caps hold.** New effect kinds get their own caps and are drawn from the same pooled arrays.
  A `quality` tier (Part 9) scales particle counts by 1.0 / 0.5 / 0.25.

---

## 6. The icon system

**Owns:** `scripts/fetch-icons.mjs` (new), `public/icons/` (new), `src/ui/Icon.ts` (new),
`src/data/*.ts` (icon ids), `ATTRIBUTION.md` (new), `docs/icon-system.md` (new).

### 6.1 Source

[game-icons.net](https://game-icons.net) — ~4200 hand-drawn monochrome SVG game icons, mirrored at
`github.com/game-icons/icons`, licensed **CC BY 3.0** (a handful are CC0). Verified reachable from
this machine. They are single-path, uniform in weight, and designed for exactly this: ability,
upgrade, talent and item icons in a dark fantasy game.

Because they are single-path and monochrome they can be **tinted from CSS** (`currentColor` /
`mask-image`), which means one asset serves the rarity tiers, the disabled state and the
core-specific accent without a second file.

A `scripts/fetch-icons.mjs` pins an explicit manifest of `{ id, author, slug }` and writes:
- `public/icons/sprite.svg` — one `<symbol>` per icon, referenced via `<svg><use href="#id">`.
- `ATTRIBUTION.md` — per-icon author + licence, generated from the manifest.

The sprite is committed, so a clean checkout and the Capacitor build need no network. Re-running the
script is only needed when the manifest changes.

### 6.2 Coverage

| Surface | Count | Today |
|---|---:|---|
| Active abilities | 10 | single letters |
| Passive abilities | 8 | none |
| Upgrades | 27 | none |
| Research nodes | 17 | letters + emoji, mixed |
| Talents | 37 | `glyph` chars |
| Blessings | 30 | none |
| Tower cores | 5 | none |
| Equipment items | 10 | crude local SVGs (replaced) |
| Equipment slots / rarities | 8 / 5 | none |
| Enemy types (for the threat preview) | 13 | none |
| Resources / stats (gold, mana, XP, RP, AP, TP, DPS, crit, range…) | ~16 | none |

Every data table gains an `icon: IconId` field, typed as a union generated from the manifest so a
missing or misspelled icon is a **compile error** — the same closed-union discipline the enemy shapes
already use, and `content-coverage.test.ts` gets a matching assertion.

### 6.3 `Icon.ts`

One helper: `icon(id, { size, tone, className })` → an `<svg><use>` element, plus a CSS class set for
the framed variants (ability tile, rarity-framed item, talent node, upgrade row). Rarity frames are
CSS (gradient border + inner glow + a corner notch per tier), not per-rarity assets.

---

## 7. HUD, ability bar and combat overlays

**Owns:** `src/ui/{HUD,AbilityBar,BossBar,MilestoneStrip,ContractTracker,PacingOverlay,BottomNav}.ts`
and their CSS sections.

- **Resource pills**: gold / mana / XP become icon + value chips with a tick-up animation on gain and
  a brief flare on a large gain, instead of the current bare `<span>`s.
- **Bars**: HP / mana / XP get a gradient fill, a lagging "damage taken" ghost bar, a segment overlay
  at 25% intervals, and a pulse when crossing a threshold. HP gains a distinct critical state that is
  *not* the same red as the vignette (Part 2.1).
- **Wave header**: the wave number becomes a display-face focal element with the boss-wave state,
  the threat preview and the risk dial arranged around it, instead of four unrelated controls sharing
  a row with a `...` button.
- **Ability bar**: a proper dock — icon (Part 6), a **radial** cooldown sweep, a mana-cost badge that
  greys when unaffordable, a ready-flash, a hold-to-inspect popover on touch (today the upgrade
  popover has no touch route), and a level pip row. 56 px targets, 8 px gutters, safe-area padded.
- **Boss bar**: segmented by the 66/33% phase thresholds, with a phase-transition flash, the enrage
  timer as a draining rim, and the pattern name + its icon.
- **Toasts / notifications**: stack with a shared motion curve, tier by importance, and never overlap
  the ability bar or the safe area.

---

## 8. Panels, tabs and content surfaces

**Owns:** `src/ui/{UIManager,UpgradePanel,AbilityPanel,EquipmentPanel,ResearchPanel,TalentPanel,`
`PrestigePanel,TranscendencePanel,ProgressionPanel,StatsPanel,AchievementPanel,SettingsPanel,`
`MobileSheet}.ts` and their CSS.

- **Navigation.** The 12-button, four-row wrapping grid becomes a **two-level nav**: a compact
  icon rail of five groups — *Build* (Upgrades, Abilities, Equipment), *Research* (Research,
  Talents), *Prestige* (Prestige, Transcendence), *Progress* (Progression, Achievements, Stats),
  *System* (Settings) — with a sub-tab strip inside the panel. On mobile the same grouping drives the
  bottom nav, so the two stop being separate information architectures.
- **Cards.** Upgrade / ability / research rows become cards with an icon, a clear name/level/effect
  hierarchy, an affordability state that is legible at a glance, and an evolution ribbon at the
  thresholds where `evolutions` fire.
- **Equipment.** Rarity-framed slots on a tower silhouette rather than a list; drag-or-tap to equip;
  a stat-delta preview against the currently equipped item.
- **Talent tree.** Keep the canvas, restyle it: curved links, a spent/available/locked tri-state that
  survives colour-blind checks, branch tinting, pan/pinch on touch.
- **Blessing draft.** The one modal that already has presentational ambition — bring it up to the new
  rarity frames and give the three cards a stagger-in and a hover/press tilt.
- **Modals.** One shared shell (backdrop blur, spring-in, focus trap, escape/tap-out, safe-area
  padding) that `RunSummary`, `RunFailed`, `WaveModifier`, `CorePicker`, `WelcomeBack`,
  `BlessingDraft` and `Keybinds` all adopt — today each rolls its own.

---

## 9. Mobile and the Capacitor build

**Owns:** `index.html`, `src/styles/tokens.css` + mobile CSS, `src/ui/{MobileSheet,BottomNav}.ts`,
`src/ui/SettingsPanel.ts` (quality tier), `src/game/Camera.ts` (portrait), `docs/ui-system.md`.

- **Safe areas.** `env(safe-area-inset-*)` applied to the HUD, ability bar, bottom nav, toasts and
  every modal. Without this the notch and gesture bar will clip the two most-tapped surfaces.
- **Portrait.** With Part 1's aspect-driven arena this mostly falls out, but portrait needs its own
  layout pass: HUD compressed to two rows, ability bar above the nav, panel as a full-height sheet.
- **Touch.** ≥44 px targets everywhere; `touch-action: none` on the canvas only; `overscroll-behavior:
  none` on the app root (pull-to-refresh mid-run is a lost run); `-webkit-tap-highlight-color:
  transparent`; `-webkit-touch-callout: none`; no long-press text selection. Every hover affordance
  gains a press/long-press equivalent.
- **Quality tiers.** A Settings control — `high` / `medium` / `low` — scaling DPR cap, particle
  counts, the additive pass, background layer count and shadow work. Auto-selected on first run from
  `hardwareConcurrency` + a 2-second frame-time probe, then user-overridable.
- **Capacitor readiness.** Status-bar style, splash background matched to `--surface-0`, `dist/`
  assets all relative-pathed, fonts and the icon sprite self-hosted (no runtime network), and a
  documented `npx cap add android` path in `docs/ui-system.md`. Actually adding the Capacitor project
  is out of scope for this plan — the point is that nothing here blocks it.

---

## 10. Performance, verification and docs

**Owns:** `src/game/Renderer.ts` (layer compositing), `docs/performance.md`, `docs/ui-system.md`,
`AGENTS.md`, `tests/`.

- **Layer canvases.** Static ground on one offscreen canvas (re-baked on resize/core change), the
  entity pass on the main context, effects in the additive pass, screen-space UI last.
- **Budget check.** A dev-only harness (`window.__theTower` already exists) that spawns 250 enemies +
  saturated particles and reports p50/p95 frame time at each quality tier. Recorded in
  `docs/performance.md` before and after.
- **Tests.** `content-coverage.test.ts` gains: every ability/upgrade/research/talent/blessing/core/
  enemy has a valid `icon` id; every enemy shape is still rendered; every `--fx-*` token used by
  `Renderer` exists in `palette.ts`. New `tests/camera.test.ts` covers aspect clamping, world/screen
  round-tripping, the spawn ellipse and the range cap.
- **Docs.** `docs/camera-system.md`, `docs/art-direction.md`, `docs/icon-system.md` written; the
  `AGENTS.md` index and content table updated.

---

## 11. Execution order and file ownership

`Renderer.ts` and `main.css` are touched by most parts, so the parts run **sequentially** in the
order below. Each part is one sub-agent, and each finishes with a green
`typecheck` + `test` + `checks` and its own commit.

| # | Part | Depends on | Primary files |
|---|---|---|---|
| 1 | Camera & zoom-out | — | `data/arena.ts`, `game/Camera.ts`, `Renderer`, `Game`, `main.ts`, spawn/bounds, `stats/resolve.ts` |
| 2 | Design tokens | — | `styles/tokens.css`, `data/palette.ts`, `main.css` sweep |
| 3 | Ground, tower, range, portals | 1, 2 | `Renderer`, `data/tower.ts` |
| 4 | Enemies, projectiles, impacts | 1, 2, 3 | `Renderer`, `data/enemies.ts` |
| 5 | Effects & additive layer | 3, 4 | `EffectsManager`, `Renderer`, `Game` |
| 6 | Icon system | 2 | `scripts/fetch-icons.mjs`, `public/icons/`, `ui/Icon.ts`, all `data/*` |
| 7 | HUD & combat overlays | 2, 6 | `ui/HUD`, `AbilityBar`, `BossBar`, `PacingOverlay`, … |
| 8 | Panels & tabs | 2, 6, 7 | the remaining `ui/*` panels |
| 9 | Mobile & Capacitor readiness | 1, 7, 8 | `index.html`, mobile CSS, `MobileSheet`, `BottomNav`, `SettingsPanel` |
| 10 | Performance, tests, docs | all | `Renderer`, `tests/`, `docs/` |

Parts 6 and 3/4/5 touch disjoint files and may overlap in time if needed; everything else is strictly
ordered.

## 12. Acceptance criteria

The plan is done when, on a fresh save:

1. At wave 1 the range ring's diameter is ~32% of the viewport's short dimension, and a fully
   range-stacked build never exceeds 70% of it — at 16:9, at 4:3, and in phone portrait.
2. The canvas is pixel-crisp at `devicePixelRatio` 1, 2 and 3, and reflows correctly on window
   resize and device rotation without teleporting live enemies.
3. `npm run sim` wave-time and gold curves are within ±10% of the pre-Part-1 tables.
4. Every ability, upgrade, research node, talent, blessing, core, equipment item and enemy type has a
   real icon; no single ASCII letter remains as an icon anywhere in the UI.
5. No literal hex colour, px radius or ms duration remains in a component CSS block.
6. 250 enemies + saturated particles hold ≥60 fps at `high` on desktop and ≥45 fps at `low` at a
   phone-class viewport.
7. Every interactive target on mobile is ≥44 px, respects safe-area insets, and has a touch route
   that does not depend on hover.
8. `typecheck`, `test` and `checks` are green, and `docs/` describes what shipped.
