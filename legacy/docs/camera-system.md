# Camera system

How the world is sized, how it is drawn, and why the tower's range ring is small.

Files: `src/data/arena.ts` (the numbers), `src/game/Camera.ts` (the transform and the resize
path). Introduced by `plans/ui-improvements.md` §1.

---

## 1. Before: the canvas *was* the world

`index.html` hard-coded `<canvas width="1280" height="720">` and that backing store was the
coordinate space. `Game` seated the tower at `canvas.width/2, canvas.height/2`, `EnemyManager` and
`ProjectileManager` took the same two numbers as their bounds, and `WaveManager` spawned 20 px
outside that rectangle. CSS then scaled the element to fit with `aspect-ratio: 16/9`.

Three consequences, all of them bugs:

- **The range ring did not fit.** Half the canvas height is 360; `TOWER_BASE.range` is 300. The
  tower's reach covered 83% of the vertical half-extent on wave 1, so every enemy was in range from
  the frame it spawned and `range` as a stat had no visible meaning.
- **Everything was blurry.** No `devicePixelRatio` handling: a 1280-wide buffer upscaled into a
  2560-wide CSS box on any hi-DPI screen.
- **Nothing reflowed.** There was no resize listener in the project. A rotation or a window resize
  changed the CSS box and nothing else, and portrait got a letterboxed strip.

## 2. The idea

Enemies in this game **do not pass through** the tower's range. `EnemyManager.tick` walks them to
their contact radius and parks them there until they die. "Time in range" is therefore not a window
a bigger arena would shrink — the only thing a bigger arena costs is walk-in dead time before the
first shot. Which gives the whole design in one line:

> Multiply every world-space **distance and speed** by the same factor and every timing in the game
> is unchanged. Leave **range** out of that multiplication, and the range ring shrinks relative to
> the arena by exactly that factor.

Two scales, applied at *data-definition time* so the ~40 call sites downstream never learn either
number exists:

| Scale | Value | Applies to | Why |
|---|---:|---|---|
| `WORLD_SCALE` | 2.6 | positions, speeds, bounds, spawn ring, AoE/splash radii, knockback | keeps every timing identical |
| `ENTITY_SCALE` | 1.7 | body radii, sprite padding, drawn orb size | the actual zoom-out you see |
| *neither* | — | `range` | the point: the ring shrinks against the arena |

`ENTITY_SCALE < WORLD_SCALE` is deliberate — that gap *is* the zoom-out, rather than a mere
resolution change. Its cost is that an enemy is a ~35% smaller target in world terms, paid back by
`PROJECTILE_HIT_PAD`.

### Stroke widths and apparent size

`ViewTransform.scale` is the same `scale` `Camera.applyWorld` multiplies the world by — **backing-store pixels per world unit**. It is what stroke widths are denominated in: an `entity(1.7)` outline is `entity(1.7) × scale` device pixels wide.

Apparent size is `scale / dpr` — the dpr-independent figure, `cssPerWorld`, which says how big a thing *looks* in CSS pixels per world unit. The two conversions live in `src/data/arena.ts`:

- `viewPenWidth(worldWidth, scale, minPx?)` floors a world-unit stroke at `minPx` device pixels (`MIN_STROKE_PX = 1.25`).
- `viewBodyBoost(scale, dpr)` returns a render-only scale-up that is exactly 1 at and above `REFERENCE_CSS_PER_WORLD = 0.34` (a desktop reference) and is capped at `MAX_BODY_BOOST = 1.45` for the smallest phones.

Measured across the realistic viewport / tier band:

| Viewport | dpr cap (tier) | `scale` | `cssPerWorld` |
|---|---|---|---|
| Phone 375 × 442 | 2 (`high`) | 0.4006 | 0.2003 |
| Phone 375 × 442 | 1.5 (`medium`) | 0.3005 | 0.2003 |
| Phone 375 × 442 | 1 (`low`) | 0.2003 | 0.2003 |
| Desktop 900 × 620 | 1 | 0.3312 | 0.3312 |
| Laptop 1000 × 640 | 2 | 0.6838 | 0.3419 |
| Desktop 1140 × 760 | 2 | 0.8120 | 0.4060 |

A phone shows an enemy at **59% of a laptop's apparent size** — and, worse, resolves it with **as little as 29% of a laptop's pixels per world unit**. On a phone the `entity(1.7)` outline resolves at **0.58–1.16 device px without the floor** that `viewPenWidth` enforces; that is the gap `plans/enemies.md` §1.4 measured and §3 fixed.

## 3. The arena

`arenaExtents(viewWidth, viewHeight)` takes a viewport *shape* (any units) and returns the world
rectangle:

- The **short** axis always gets exactly `ARENA.minHalfExtent` = `360 × 2.6` = **936** world units.
- The **long** axis gets that times the viewport aspect, clamped to `[0.62, 2.20]` so an ultrawide
  monitor is not handed a telescope and a very tall phone does not get a sliver of a field. Every
  realistic viewport sits inside the band, where the clamp is a no-op.

So 16:9 gives a 3328×1872 world, and phone portrait gives roughly 1872×2153 — the same 936 short
half-extent either way. The tower is always at the centre of the world rectangle.

### Range, measured against it

| | World units | ÷ short half-extent |
|---|---:|---:|
| Base (`TOWER_BASE.range`) | 300 | **0.320** |
| Flat maximum (`Longbow` ×60 at +3) | 480 | 0.513 |
| `ARENA_RANGE_CAP` | 655 | **0.700** |

The cap is enforced by `STAT_CLAMPS.range.max`. When it bites, `resolve.ts` records an `Arena cap`
row in the stat breakdown, so it is never a silent dead stat.

### Spawning

`spawnPointOnEllipse` replaced `WaveManager`'s rectangle. The rectangle made a corner spawn take
~1.4× as long to walk in as an edge spawn — a real difference in wave length that no player could
see the cause of. `ARENA.spawnRingScale` is 1.04, so enemies materialise a touch off-screen on the
short axis and just on-screen on the long one.

## 4. `Camera`

### Sizing

A `ResizeObserver` on `.canvas-wrap` (handed over by `Game.setCanvasWrap`, defaulting to the canvas
itself), plus `resize` and `orientationchange` listeners — the latter because `orientationchange`
can fire before layout settles, and `ResizeObserver` is not guaranteed to see a rotation that keeps
the element's box the same size but changes `devicePixelRatio`. All three paths call `measure()`,
which is a no-op when nothing moved.

`measure()` sets `canvas.width/height = cssBox × min(devicePixelRatio, dprCap)`. The cap is
`ARENA.maxDevicePixelRatio` for the `high` quality tier, 1.5 for `medium`, and 1.0 for `low` — a 3×
phone buffer is a 2.25× fill-rate tax over a 2× one for a difference nobody can see at arm's length,
and this game's frame budget is spent on 200+ enemies. The quality tier (UI plan §9.D) feeds the
cap in via `camera.setDprCap(QUALITY[tier].dprCap)`; the per-tier table lives in
`src/data/quality.ts`.

> **Note when testing in a headless or hidden pane:** `ResizeObserver` callbacks are delivered as
> part of the rendering steps. A page with `document.hidden === true` is not running them, so a
> programmatic viewport change will not reflow until the page is visible. Call `camera.measure()`
> directly to verify the path.

When the world rectangle changes, `onResize` fires and `Game.onCameraResize` re-seats the tower,
pushes new bounds to the enemy and projectile managers, rescales live entity positions
proportionally (a resize mid-wave must not teleport anything out of bounds) and invalidates the
renderer's background bake. When only the *buffer* changed — including the §9.D case of a DPR cap
change — `onResize` still fires so the background can be re-baked at the new resolution, but the
rescale path is skipped (`previousWorldWidth === worldWidth`, so `sx === sy === 1`). That is the
**§9.D rescale guard**: a DPR change leaves the world extents identical, and the only thing moving
is the backing store and `scale`. `tests/camera.test.ts` pins both halves — that
`setDprCap` changes `pixelWidth`/`pixelHeight`/`scale` but leaves `worldWidth`/`worldHeight`
untouched.

### Transform

- `applyWorld(ctx)` — one unit is one world unit, origin at the world rectangle's top-left. Almost
  everything draws here.
- `applyScreen(ctx)` — CSS pixels. The wave banner, the screen flash and the low-HP vignette, i.e.
  anything that should not scale with the zoom.
- `applyDevice(ctx)` — raw backing-store pixels.
- `worldToScreen` / `screenToWorld` — `main.ts` maps pointer and touch events through
  `game.screenToWorld` rather than the old `canvas.width / rect.width` arithmetic.

### Shake and punch

`shake()` is a camera translate applied inside `applyWorld`, replacing the old
`.canvas-wrap.is-shaking` CSS animation — that jiggled the whole element including the DOM overlays
pinned to it. `zoomPunch()` scales about the centre of the backing store, so a punch during a boss
death does not slide the arena sideways. Both are no-ops under `prefers-reduced-motion`.

## 5. Verification

`tests/camera.test.ts` covers aspect clamping at both ends, world/screen round-tripping, the DPR
cap, the spawn ellipse and the range clamp. `npm run sim` is the balance guard: after the change,
every curve in the simulator is byte-identical to before it, the sole diff being the charged shot's
splash radius printing as 234 px instead of 90 px — which is `WORLD_SCALE` doing exactly its job.
