# Large screens: tablets, desktops, foldables

**Status:** 2026-11-19. Plan only, nothing built. It reverses one earlier
call: R7 §3 (`plans/review-risks.md`) and D4 (`plans/rebuild.md`) settled
large screens as a **letterbox**, the 480 px portrait stage centred on the
brand gradient. That works, but the game looks like a phone app on a tablet
or a monitor: a tall pill of light in a narrow column, two thirds of the
screen spent on gradient.

**How to read this:** §1 says where things stand, with numbers. §2 is the
goal and what's out of scope. §3 defines the form factors. §4–§6 are the
arena: its shape (game logic), its drawing, and the camera. §7–§9 are the
DOM: the stage, the HUD, the hub and the overlays. §10 is Android. §11 is
balance and determinism. §12 is the order to build it in. §13 is how to
check it, §14 what's still open, §15 the files it touches.

`plans/rebuild.md`'s rules R1–R8 and invariants I1–I6 still hold.
`plans/camera-and-fog.md` §2 still holds: **what the tower can hit ⊆ what's
lit ⊆ what's on screen.** §5 here touches the sim (spawn points and
`inLight`), so I1, I2 and I5 must be re-measured.

---

## 0. Decisions for the owner

Each has a recommendation; §14 has the smaller open questions.

| # | Question | Recommendation |
|---|---|---|
| D-1 | Unlock landscape on Android tablets and foldables, or stay portrait-only? | **Decided (owner, 2026-11-19): unlock at ≥ 600 dp** (§10). Phones stay portrait. |
| D-2 | The light's shape on large screens: keep the ellipse, or a squarer shape? | **Decided (owner, 2026-11-20): a superellipse ("squircle") whose squareness grows with the stage** (§5.1). Phones keep today's ellipse exactly. The exact `n` per class is still tuned by eye (§14). |
| D-3 | Should a bigger screen show the same world bigger, or more world? | **The same world, bigger, up to a cap** of ~0.6 CSS px per world unit (§6.2). Past the cap the light stays centred and the dark and sky take the margin. |
| D-4 | A stage shape changes how far enemies walk. Normalise it? | **Measure first** (§11.2). If any of I1/I2/I5 moves, normalise the mean spawn distance to the phone's. |
| D-5 | Where does the hub go in landscape? | **Docked beside the arena** (D4's original idea, `--hub-width` already exists and is unused). |

## 1. Where things stand

**The stage.** `.stage` caps at `--stage-max-width: 480px` and `#app`
centres it (`src/styles/main.css:55`, `src/styles/tokens.css:457`).
`tests/r7.test.ts` pins both. Every overlay (`#hud-root`, `#screen-root`,
`#overlay-root`) is `inset: 0` inside the stage, so the whole game is one
480 px column. `--hub-width: 420px` is declared for a docked hub (D4) that
was never built.

**The light.** `src/content/arena.ts`: an oval whose short half-axis `L` is
`max(500, range + 70)` and whose long half-axis is `L + 500 · (aspect − 1)`.
The aspect comes from the stage at run start (`stageOval` in
`src/render/camera.ts:47`, via `Renderer.stageOval` → `RunConfig.arena` in
`src/app/App.ts:560`), clamped to [1, 2.4], and is kept in `RunState.arena`
for the whole run. The sim reads it in three places: `spawnPoint` (waves,
boss emerge and summons), `inLight` (targeting in `combat.ts:170` and
`enemies.ts:301`), and the gates (`paintGates` / `floorGates`). Headless
tools and the Daily Omen play `PHONE_OVAL` (1 × 1.92).

So the oval *already* follows the stage's aspect. What it can't do is be
anything but an ellipse, and the stage it follows is the 480 px column.

**The drawing.** `src/render/painters/arena.ts` relies on one trick: under
`ctx.scale(kx, ky)` the ellipse is a circle, so the ground and the dark are
each one radial gradient, memoised, and the rim is one `ctx.ellipse` stroke.
Any non-elliptic shape breaks that trick (§5.3).

**What a stage looks like today** (rim box from `rimBox`, `L = 500`):

| Viewport | Stage | Oval aspect | CSS px / world unit | Mean spawn distance* |
|---|---|---|---|---|
| Phone 375×812 | full | 1.94 tall | 0.35 | 677 |
| Phone 412×915 | full | 2.03 tall | 0.38 | 691 |
| Desktop / tablet, letterboxed | 480 × h | 1.5–1.7 tall | 0.44 | ~640 |
| *Unletterboxed:* tablet 768×1024 | full | 1.24 tall | 0.71 | 556 |
| *Unletterboxed:* tablet 1280×800 | full | 1.54 wide | 0.74 | 613 |
| *Unletterboxed:* desktop 1440×900 | full | 1.56 wide | 0.83 | 617 |
| *Unletterboxed:* desktop 1920×1080 | full | 1.78 wide | 1.00 | 653 |

\* The rim's mean radius over a uniform spawn angle, world units, before
`spawnScale`. Enemies spawn at a uniform angle (`waves.ts:206`), so this is
roughly the mean walk before range. Two things fall out:

- **A squarer stage is a harder run.** A 4:3 tablet's ellipse has an 18 %
  shorter mean walk than a phone's. The letterboxed desktop already plays
  about 5 % shorter. Nobody has measured either (§11.2).
- **A large screen draws everything 2–3× bigger.** Fine on a tablet held at
  arm's length; too much on a 27″ monitor (§6.2).

## 2. Goal and non-goals

**Goal.** On a tablet (either orientation), an unfolded foldable, a desktop
window or a Chromebook, the game uses the screen: the arena fills the space
and its light has a shape that suits the screen, the HUD sits where a
large screen's eyes and thumbs are, and the hub, sheets and draft are laid
out for the width instead of being a phone column.

**Non-goals.**

- Phones change by **nothing**: same layout, same oval, same numbers. Every
  rule below is behind a form-factor check that a phone never passes.
- No new content, no new zoom features, no panning.
- No keyboard-first redesign. A few desktop shortcuts are in §9.5 as an
  optional extra.
- The Daily Omen keeps `PHONE_OVAL`: a shared seed plays the same field on
  every device.

## 3. Form factors

One classification, computed once from the **stage's CSS box** (not the
window, not the user agent), so a desktop window resized narrow behaves like
a phone and a split-screen tablet half behaves like whatever it is.

| Class | Rule (CSS px) | Examples |
|---|---|---|
| `compact` | short side < 600 | every phone, a narrow desktop window, a folded foldable |
| `medium` | short side ≥ 600, portrait (h ≥ w) | tablet portrait, an unfolded book-style foldable (~ square) |
| `expanded` | short side ≥ 600, landscape (w > h) | tablet landscape, desktop, Chromebook |

Plus a height guard: a landscape window shorter than 500 px is `compact`
even if wide (a phone in landscape in a desktop browser, a short window).

**How it's exposed.** A small module, `src/app/formFactor.ts`, measures the
viewport (`ResizeObserver` on `#app`), computes the class, and writes
`document.documentElement.dataset.form = 'compact' | 'medium' | 'expanded'`.
The camera, the hub and the HUD read the same value from the module rather
than each measuring. CSS keys off `:root[data-form='…']` for layout and uses
**container queries** (`container-type: inline-size` on the stage, the hub
panel and the sheet) for component sizing, which the codebase already uses
(`.hub-tab`, `.draft-card`). Media queries on the viewport are avoided:
the hub panel in §7.2 makes the arena narrower than the viewport.

The class is recomputed on resize. Changing class mid-screen re-lays out the
DOM at once. The arena is the exception (§10.3).

## 4. The stage

### 4.1 `medium`: a portrait tablet

- `.stage` fills the viewport: `--stage-max-width` becomes `none` under
  `:root[data-form='medium']`.
- The canvas fills the stage; the camera fits the light to it as today.
- The HUD, hub home and overlays keep their portrait structure but sit in a
  **content column** of `--content-max: 640px`, centred (§8, §9). The arena
  spans the full width behind them.

### 4.2 `expanded`: landscape

Two layouts, by screen:

- **In a run:** the arena is full-bleed. The HUD moves to the corners
  (§8.2). Overlays (draft, pause, results) float centred over the arena.
- **In the hub:** the stage splits into **arena + docked panel**. The panel
  is `--hub-width` (420 px, up to 480 px past 1600 px wide) on the right,
  full height, glass. The arena takes the rest, and the backdrop tower sits
  at *its* centre, not the window's. This is D4 as first written.

The canvas always fills the whole stage; the camera's rim box is computed
for the arena's region (the stage minus the panel), and the world origin
moves to that region's centre (§6.3). One canvas, no resize on entering or
leaving the hub; only the camera's framing box changes, and it eases.

### 4.3 The page behind

With no letterbox, the body's brand gradient only shows through the sky
past the dark. `paintSky` already draws it. Nothing to add.

## 5. The light's shape (game logic)

### 5.1 A superellipse (D-2, decided)

Generalise `Oval` to a **superellipse**:
`|x / a|ⁿ + |y / b|ⁿ = 1`, where `a, b` are today's `rimAxes` and `n` is the
**squareness**. `n = 2` is exactly today's ellipse. `n = 4` is a squircle,
a rounded rectangle with no straight edges, which still reads as a pool of
light rather than a box.

```ts
export interface Oval {
  readonly sx: number;
  readonly sy: number;
  /** Squareness: 2 is an ellipse (every phone), up to 4 on a large stage. */
  readonly n: 2 | 3 | 4;
}
```

How much of the stage's rim box the light covers:

| n | Share of the rim box lit |
|---|---|
| 2 | 78.5 % (π/4) |
| 3 | 88.3 % |
| 4 | 92.7 % |

**The rule for `n`** (in `stageOval`, from the class in §3 and the aspect):

| Class | n |
|---|---|
| `compact` | 2, always. Phones unchanged. |
| `medium` | 3 (tablet portrait: the aspect is low, ~1.2–1.5, so an ellipse leaves big dark corners) |
| `expanded` | 3, or 4 at aspect ≤ 1.4 |

These are starting values. §12 step 1 is a dev slider to choose them by eye
on real screens. Restricting `n` to the integers 2, 3, 4 keeps the hot path
free of `Math.pow` (§5.4).

### 5.2 Points on the rim

Everything that places something on the rim goes through one function, so
spawns, gates and the drawn rim agree:

```ts
/** The rim point at angle `t` (0 = right, π/2 = down), scaled by `k`. */
export function rimPoint(t: number, light: number, oval: Oval, k = 1): { x: number; y: number };
```

For `n = 2` it's today's `(cos t · a, sin t · b)`. For general `n`, the
standard parametrisation `x = a · sgn(cos t) · |cos t|^(2/n)` (and the same
for y) keeps arcs between angles even-looking but **is not the polar
angle**. Use the polar form instead: the point on the ray at angle `t`,
`r(t) = (|cos t / a|ⁿ + |sin t / b|ⁿ)^(−1/n)`. Then a spawn "at angle t" is
literally in that direction from the tower, which is what the opening
(`waves.ts:207`, angles 0 and π) and the gates (`strata.ts`) assume. It
costs one `pow` per spawn, which is nothing.

`spawnPoint`, `emergence` (`painters/arena.ts:31`) and `paintGates` all move
onto `rimPoint`.

### 5.3 What's "lit"

`inLight` becomes the superellipse test, the same shape scaled by
`darkScale` and grown by the body's radius:

```ts
const u = Math.abs(x) / ax, v = Math.abs(y) / ay;
// n is 2, 3 or 4: multiplications only.
return n === 2 ? u*u + v*v <= 1 : n === 4 ? (u*u)*(u*u) + (v*v)*(v*v) <= 1 : u*u*u + v*v*v <= 1;
```

Growing a shape by a body's radius `r` isn't exactly "axes + r", because
that isn't an offset curve. Today's ellipse is off in the safe direction:
along its flanks it grows by a little less than `r`, so it may refuse a body
that's just touching, and never accepts one that's outside. A squircle is
off the other way at its corners: on the 45° ray, "axes + r" moves the edge
out by `2^(1/2 − 1/n) · r` (1.19 r at n = 4). That could accept a body a few
units past the opaque dark. Fix: for `n > 2`, grow the axes by
`g = r · 2^(1/n − 1/2)` (0.84 r at n = 4, 0.89 r at n = 3). That's exact on
the diagonal and conservative on the axes. `g / r` is a constant per run, so
nothing is added to the hot path. `tests/light.test.ts` already checks the
invariant that matters ("never hits a body wholly outside"); run it over
every `n`.

### 5.4 Cost

`inLight` runs inside every targeting loop. The branch on `n` is constant
for the run, and integer powers are multiplications. Add one case to the
perf bench (`tests/perf.test.ts`) with `n = 4` and check it stays within
noise of `n = 2`.

### 5.5 The opening and the long axis

The first wave spawns at angles 0 and π (`waves.ts:207`): the ends of the
**short** axis on a phone, so the first enemy arrives quickly. On a landscape
oval (`sx > 1`), 0 and π are the ends of the **long** axis, and the first
contact comes up to ~1.5× later. Fix: the opening picks the short axis's
ends, `±π/2` when the oval is wide. Today a landscape desktop window can
already produce a wide oval, so this is a latent bug worth fixing first, on
its own (§12 step 0).

## 6. Drawing the fog

### 6.1 Ground, dark, rim, guides

The `scale(kx, ky)` + radial-gradient trick only works for ellipses. Per
layer:

| Layer | `n = 2` (phones) | `n > 2` |
|---|---|---|
| Ground | unchanged | the same radial gradient (still stretched by `kx, ky`), **clipped** to the superellipse path. The lit ground's falloff stays round inside; only its edge changes, and the dark covers that edge anyway. |
| Dark | unchanged | a **baked field** (below) |
| Rim | `ctx.ellipse` | a cached `Path2D` of the superellipse, ~160 points, rebuilt when `L` or the oval changes, stroked with the same four widths |
| Guides (⅓, ⅔) | `ctx.ellipse` | the same `Path2D` under `ctx.scale(f, f)` |
| Gates | `ctx.ellipse` arc | the polyline between `rimPoint(a ± w/2)` |

**The baked dark.** A soft band that follows a superellipse can't be one
canvas gradient. Bake it instead, but not the way `bakeArena` used to
(window-sized, rebuilt on every resize, camera-and-fog §4):

- An offscreen canvas of fixed size (512 × 512 on high, 256 on low), in
  **normalised rim units**: the pixel at (u, v) holds the dark's alpha at
  the superellipse "radius" `q = (|u|ⁿ + |v|ⁿ)^(1/n)`, with the same stops
  as today's gradient (`inner`, half-dark, `outer`, `DARK_HOLD`, fade to
  `DARK_FADE`). One `ImageData` pass, ~260 k `pow` calls at 512², a few ms.
- Key: `(n, palette)` only, plus the band's relative width. In normalised
  units the band is the same for any `L` and aspect, since `darkScale` is a
  multiple of the rim. So it bakes **once per run**, not per range upgrade.
- Draw: `drawImage` under `ctx.scale(rim.x · k, rim.y · k)` with smoothing
  on. Soft gradients survive the stretch (camera-and-fog §4 made the same
  argument). The texture is the dark only; the clear centre costs a
  transparent blit, which on the low tier is acceptable, and can be skipped
  by drawing four edge strips if the bench says otherwise.
- Beyond the texture's extent (its edge is at `DARK_FADE` × outer, already
  transparent), nothing is drawn: the sky shows through, as today.

Phones keep the gradient path untouched (`n === 2` branches to today's
code), so their look and their frame time can't regress.

### 6.2 How big things are drawn (D-3)

`fitExtent` fits the light to the stage, so a bigger stage draws a bigger
world: 0.35 px/unit on a phone, 0.71 on a tablet, 1.0 on a 1080p monitor.
Enemy bodies were sized for ~0.35 (`content/arena.ts` header).

Add **`RIM.maxScale = 0.6`** CSS px per world unit at `L_base`. When the rim
box would exceed it, shrink the box uniformly (keeping its aspect, so the
shape is unchanged) and centre it. The margin is dark and sky, which is
what lies past the light anyway. At 0.6:

| Stage | Box used | Margin |
|---|---|---|
| Tablet 768×1024 | ~85 % of the stage | small |
| Desktop 1440×900 | ~72 % | moderate |
| Desktop 2560×1440 | ~40 % | large; consider 0.75 at `expanded` |

`maxScale` is per class so it can be tuned by eye (§14). The cap applies to
the **fit** only; manual zoom (`ZOOM.close = 270`) still zooms in past it.

Because the oval is taken from the rim box (`stageOval`), the cap doesn't
change the shape: shrinking the box uniformly keeps its aspect.

### 6.3 The world origin

Today the tower is at the canvas centre (`offsetX = pixelWidth / 2`). In the
`expanded` hub (§4.2) it must be at the arena region's centre. Add an
**arena inset** to the camera: `setInsets({ right })` (CSS px the docked
panel covers). `makeViewTransform` places the origin at the centre of the
uncovered region and `rimBox` fits within it. The inset eases with the
same `ZOOM.ease` as the extent, so entering the hub slides the tower over
rather than jumping. In a run the inset is 0.

Pointer conversions (`screenToWorld`) already go through the transform, so
long-press on enemies and the Forge-free stage gestures keep working.

## 7. The hub and screens

### 7.1 `medium` (portrait tablet)

The structure stays: home with two groups around the backdrop tower, the
dock with Begin run and the tabs at the bottom. Changes:

- `.hub-home` and each tab view's content cap at `--content-max` (640 px)
  and centre. The groups' rows (`.hub-group > *`, today
  `min(100%, 340px)`) widen to `min(100%, 420px)`.
- The tab bar spans the full width, but its tabs cap at ~120 px each and
  centre, so seven tabs aren't stretched across 1024 px.
- **Map:** region cards in a 2-column grid.
- **Collection, Feats, Stars, Contracts:** grid of 2 where they're lists of
  cards today, 3 for small tiles (the Bestiary).
- **Forge:** the web already fits what's on show; a bigger viewport shows
  more at the same zoom. The node detail card (`.forge-detail`) docks to the
  bottom-right at 360 px instead of spanning the width.

### 7.2 `expanded` (landscape)

The hub is a **docked panel** on the right, `--hub-width` wide:

- Top: title, shards, the gear. Middle: the active view, scrolling. Bottom:
  Begin run (full panel width) above a **vertical-label tab bar**, or the
  same horizontal bar at the panel's width if seven tabs fit 420 px (they
  fit 375 today, so they do).
- The arena region shows the backdrop tower and the light, and nothing on
  top of it: the hub's home groups move into the panel.
- **The Forge is the exception:** a web wants space. When the Forge tab is
  open, the web takes the **arena region** (full height, left of the panel)
  and the panel shows the selected node's detail and the Foreman's queue.
  This is the biggest single UI change; it can ship after the rest (§12).
- The Map can do the same later (regions drawn across the arena region),
  but a 2-column list in the panel is enough for v1.

### 7.3 Results

`medium` and `expanded`: the report card caps at 520 px (today
`min(360px, …)`, `main.css:1166`) and the stats move to a 2-column grid.
*How it went* opens as a side sheet on `expanded` rather than over the card.

## 8. The HUD

### 8.1 `medium`

Same rows, in the content column (640 px) centred at the top and the bottom.
The arena behind spans the full width. The zoom column stays on the stage's
right edge, not the column's.

### 8.2 `expanded`

A landscape screen's long axis is horizontal, so the rim runs near the left
and right edges and the top and bottom are the short axis. The HUD goes to
the **corners**, not full-width bars:

| Corner | Holds |
|---|---|
| Top-left | Wave, the HP bar (max 360 px), region and shards, Stored Light |
| Top-centre | the boss bar while a boss stands (max 520 px) |
| Top-right | pause; the zoom column below it |
| Bottom-left | level, the build strip, the XP bar (max 360 px) |
| Bottom-right | speed, Autocaster, reliquary, rift, the ultimate |

`rimBox`'s `endInset` (70 px, the HP bar's middle on the long axis) only
applies on portrait stages, where the HP bar is at an end of the long axis.
On a landscape stage the long axis is horizontal and the corners are free
of the rim, so the long-axis inset becomes the short `sideShare` margin.
Check that the rim's top and bottom don't run under the corner clusters:
they sit outside a superellipse's corners for `n ≤ 3`, and at `n = 4` the
clusters may need ~16 px more inset.

### 8.3 Text and targets

On touch (`pointer: coarse`) at `medium` or `expanded`, raise the base text
scale to 1.1 (multiplying the player's `--text-scale`, not replacing it).
Desktop with a mouse keeps 1.0. The 44 px hit areas stay; nothing gets
smaller.

## 9. Overlays

### 9.1 The draft

Today: anchored to the bottom, cards in a row, two rows of three past four
(`draft.ts:327`, `.draft-row.is-many`). On `medium` and `expanded` there's
room for **one row of up to six**: cap the panel at 960 px, centred, cards
at a fixed 150–170 px. Keep the bottom anchor on `medium` (thumbs), centre
it vertically on `expanded` (eyes). Long-press details still work; on a
mouse, hover shows the details card after 400 ms.

### 9.2 Modals and settings

`.modal-card` and settings cap at 520 px and centre. Settings' two tabs
become two columns side by side on `expanded`.

### 9.3 Toasts

Top-centre on `medium`; top-right under the zoom column on `expanded`, so
they don't cover the HP bar.

### 9.4 The specimen

`/?specimen` gets a form-factor switcher so each component can be checked in
all three classes.

### 9.5 Desktop extras (optional)

With `pointer: fine`: `Space` pauses, `1`–`6` pick a draft card, `R`
rerolls, `Q` fires the ultimate, `+`/`-` zoom. One `keydown` handler in
`src/ui/controls.ts`, ignored while a text field has focus. Cheap and
expected on desktop, but not needed for this plan's goal.

## 10. Android

### 10.1 Orientation (D-1, decided: unlock)

Today: `appCategory="game"` + `screenOrientation="portrait"`, so a tablet
shows the portrait game letterboxed. To allow landscape on large screens
only:

- Manifest: `android:screenOrientation="unspecified"` (or remove it).
- `MainActivity.onCreate`: if `getResources().getConfiguration()
  .smallestScreenWidthDp < 600`, `setRequestedOrientation(PORTRAIT)`;
  else `FULL_USER`. Phones stay locked.
- Keep `appCategory="game"`: it's what exempts the lock on phones-that-
  report-large (Android 16+ ignores locks at ≥ 600 dp for non-games; the
  portrait lock below 600 dp is ours and still honoured).
- `configChanges` already includes `orientation|screenSize|screenLayout|
  smallestScreenSize`, so the WebView isn't recreated on rotation and the
  run survives.
- `tests/r7.test.ts` pins the portrait line: update it to pin the
  `MainActivity` rule instead.

So Android tablets and unfolded foldables get both `medium` and
`expanded`, the same as desktop and Chromebooks. This also means a tablet
can rotate mid-run, which makes §10.3 a real path, not an edge case: check
it on an emulator in step 9.

### 10.2 Foldables

A book-style foldable unfolded is ~square (`medium`, n = 3 or 4). Folding
it mid-run drops to `compact`: the DOM re-lays out at once, the arena keeps
its run shape (§10.3).

### 10.3 The arena when the stage changes mid-run

The run's shape is fixed at its start (determinism, `RunState.arena`). If the
stage rotates or folds mid-run, the camera's `fitExtent` already shrinks the
fit so the whole light shows (`min(hw/rim.x, hh/rim.y)`): a wide light on a
now-tall stage is drawn smaller with dark above and below. That's acceptable
for the rest of the run; the next run takes the new shape. Add a one-line
toast the first time it happens: "The light keeps its shape until the next
run." The hub's backdrop light follows the stage live, as today.

### 10.4 Pixels

A 2560×1600 tablet at DPR 2 is a 16 MP backing store; full-screen gradients
and the dark at that size cost fill rate. Add a **pixel budget** to
`Camera`: cap `pixelWidth × pixelHeight` at ~4 MP (high), 2.5 MP (medium),
1.5 MP (low) by lowering the effective DPR below `dprCap`. The quality
auto-detection (`quality.ts`) then has headroom to keep. Measure on a
tablet emulator with `?bench` (`src/app/bench.ts`).

## 11. Determinism and balance

### 11.1 What's game logic

- `Oval.n` joins `sx, sy` in `RunState.arena` and `RunConfig.arena`. Runs
  aren't saved mid-run, so no save migration; `PHONE_OVAL` gains `n: 2`.
- Replays and the golden-number tests use `PHONE_OVAL`: unchanged.
- The Daily Omen keeps `PHONE_OVAL` (`meta/omen.ts:343`): the same field for
  everyone, whatever the device.

### 11.2 Is a tablet run easier or harder? (D-4)

§1's table: mean spawn distance runs from ~556 (4:3 tablet, ellipse) to
~745 (a phone at n = 4). That's a ±15 % swing in walk time against the
phone's 677, enough to move I1/I2/I5 if it shows in the pacing bot.

**Measure first.** Add `--arena phone|tablet-p|tablet-l|desktop|square` to
`tools/pacing.ts` (a `RunConfig.arena` override; today it always plays
`PHONE_OVAL`). Run the standard reading
(`npm run pacing -- --hours 12 --seeds 4`, plus `--act2`) for each shape.

**If any invariant moves,** normalise: at run start, compute the shape's
mean rim radius at `L_base` (numerically, 64 samples, once) and scale both
axes by `k = max(1, phoneMean / shapeMean)`, clamped to ≤ 1.25. Store `k`
in the `Oval`. Properties:

- `L ≥ range + margin` still holds (`k ≥ 1` only ever widens the light).
- The mean walk matches the phone's within a few percent for every shape.
- The camera fits the scaled rim, so a normalised tablet light draws a
  little smaller, which is invisible.

The cost: on a near-square stage, `k` widens the **short** axis too, so
the opening's first contact (§5.5) is up to 25 % later. Check the first
30 s in the pacing trace for `square`.

### 11.3 Tests

- `tests/light.test.ts`: the "never hits outside" sweep runs over
  `n ∈ {2, 3, 4}` and the five shapes above.
- New `tests/arena-shape.test.ts`: `rimPoint` is on the `inLight` boundary
  (at `r = 0`, `darkScale = 1`); `spawnPoint` is outside the rim and inside
  the dark; `stageOval` returns `n = 2` for every compact viewport
  (360×640 to 430×932) so phones can't drift; normalisation `k` is 1 for
  `PHONE_OVAL`.
- `tests/camera.test.ts`: `VIEWPORTS` already has 1280×800 and 900×400; add
  768×1024, 1440×900, 2560×1440 and the insets; check the rim box respects
  `maxScale` and the origin sits in the uncovered region.

## 12. Order of work

Each step lands on its own and leaves the game shippable.

| # | Step | Size | Touches the sim? |
|---|---|---|---|
| 0 | Opening spawns on the short axis (§5.5). A fix on its own. | S | yes, phones unaffected |
| 1 | `--arena` in the pacing tool; measure today's letterbox shape and the five shapes at n = 2 (§11.2). | S | no |
| 2 | Form-factor module and `data-form` (§3). No visible change. | S | no |
| 3 | Superellipse in `content/arena.ts`: `n`, `rimPoint`, `inLight`, `spawnPoint`. Drawing for `n > 2` (§6.1). A dev-only `?fog=2..4` override to pick `n` by eye. | M | yes |
| 4 | Re-measure pacing at n = 3, 4; decide D-4; add normalisation if needed. | S–M | yes |
| 5 | Camera: `maxScale`, insets, pixel budget (§6.2, §6.3, §10.4). | M | no |
| 6 | `medium`: lift the stage cap, content column, HUD, hub grids, draft row, modals (§4.1, §7.1, §8.1, §9). | M | no |
| 7 | `expanded` in a run: full-bleed arena, corner HUD (§4.2, §8.2). | M | no |
| 8 | `expanded` hub: docked panel, arena inset (§7.2 minus the Forge). | M | no |
| 9 | Android: orientation rule in `MainActivity`, the mid-run toast (§10). Emulator checks. | S | no |
| 10 | `expanded` Forge in the arena region (§7.2). | M–L | no |
| 11 | Desktop shortcuts (§9.5). Optional. | S | no |
| 12 | Docs: `docs/ui.md` (drop "letterboxed" from the intro), `docs/render.md` (the shape, the baked dark), `docs/architecture.md` (D4), R7 §3's status line, `plans/rebuild.md` D4. | S | no |

Steps 2 and 5–8 are pure presentation; per the project's habit they need no
pacing run. Steps 0, 3 and 4 do.

## 13. How to check it

- **Phones unchanged.** The R7 sweep (360×640, 375×812, 412×915 at 100 %
  and 130 %) shows no diff from before step 2. `stageOval` returns `n = 2`
  for all of them (test). Pacing with `PHONE_OVAL` is byte-identical.
- **The sweep, extended.** Every screen at 768×1024, 820×1180, 1024×1366
  (`medium`), 1280×800, 1440×900, 1920×1080 (`expanded`), and the
  boundaries 599×900 / 600×900 and 1000×499 / 1000×500. Same script as R7
  §2: nothing past the stage edge, no clipped text, no target under 44 px.
- **The rule (§2 of camera-and-fog), headless:** for every shape, no enemy
  is hit outside the light, `range + margin ≤ L` every tick.
- **Look.** Screenshots of the hub and a mid-run at each size, n = 2/3/4,
  side by side, for D-2 and the `maxScale` values. The rim stays crisp
  (live path), the dark has no banding, enemies fade in at the corners as
  they do on the sides.
- **Rotation.** On a tablet emulator: rotate mid-run (the run survives, the
  light keeps its shape and refits, the toast shows once); rotate in the
  hub (the backdrop follows, the panel docks and undocks).
- **Performance.** `?bench` on the low tier at 2560×1600 and on a mid-range
  tablet: frame time within the budget in `docs/performance.md`, with the
  baked dark and the pixel budget on.

## 14. Still open

- **`n` per class** (the squircle itself is decided, D-2): 3 vs 4 on tablets is a matter of taste; decide
  with the dev override on a real tablet. Possibly let `n` grow smoothly
  with the stage's short side instead of by class (only if it can stay an
  integer at the moment the run starts).
- **`maxScale`** per class (D-3): 0.6 is a guess. A 27″ monitor at 1440p
  may want 0.75 so the light isn't small.
- **The docked panel's side.** Right matches D4. Left-handed tablet
  players in landscape might prefer it left; a setting is cheap once the
  inset exists.
- **The Forge in the arena region** (§7.2): does the web go over a dimmed
  arena (the backdrop tower stays visible) or over the plain ground?
  *Built (step 10) on the plain ground*, as the phone's Forge is: the web's
  root glyph is the tower already, and node bases wear `--web-bg`, which
  would show as dark discs over a lit arena. Revisit by eye if wanted.
- **Hover details** on mouse for draft cards, Forge nodes and relics: a
  general tooltip pattern, or per component?

## 15. What this touches

**Game logic (deterministic; pacing re-measured)**
- `src/content/arena.ts`: `Oval.n`, `rimPoint`, `inLight`, `spawnPoint`,
  optional normalisation `k`, `PHONE_OVAL`.
- `src/sim/systems/waves.ts`: the opening's angles (§5.5).
- `src/sim/systems/boss.ts`: through `spawnPoint`, no change of its own.
- `src/sim/strata.ts`: gate angles stay polar; check `gateAngle` with
  `rimPoint`.
- `tools/pacing.ts`: `--arena`.

**Drawing**
- `src/render/camera.ts`: `stageOval` (n), `rimBox` (`maxScale`, landscape
  insets), `makeViewTransform` (origin in the uncovered region), insets,
  pixel budget.
- `src/render/painters/arena.ts`: clipped ground, baked dark, rim `Path2D`,
  guides, gates, `emergence`.
- `src/render/renderer.ts`: pass insets, own the dark texture's lifetime.

**DOM**
- `src/app/formFactor.ts` (new), `src/app/main.ts` (start it).
- `src/styles/tokens.css`: `--content-max`, `--stage-max-width` per class,
  `--hub-width` used.
- `src/styles/main.css`: stage, HUD (corner layout), hub (column, panel,
  grids), draft, results, modal, toasts.
- `src/ui/hud.ts`: class hooks for the corner clusters (markup mostly
  unchanged; CSS grid areas do the moving).
- `src/ui/hub/hub.ts`, `forge.ts`, `map.ts`, `collection.ts`: panel mode,
  grids, the Forge's arena-region mode.
- `src/ui/draft.ts`: single-row layout, hover details.
- `src/ui/controls.ts`: shortcuts (optional).

**Android**
- `android/app/src/main/AndroidManifest.xml`, `MainActivity.java`.

**Tests**
- `tests/r7.test.ts` (the letterbox and portrait pins change),
  `tests/light.test.ts`, `tests/camera.test.ts`, `tests/perf.test.ts`,
  new `tests/arena-shape.test.ts`, `tests/screens.test.ts` if it pins
  layout.

**Note for whoever builds it:** the working tree has uncommitted changes to
`src/styles/main.css` and `src/ui/hub/map.ts` (the R1/R2 review work). Land
those first; steps 6–8 rewrite parts of both files.
