# Enemy legibility on mobile — the flier's wingbeat, and everything under it

> **Status:** plan only. Nothing in this document has been implemented.
>
> **Filed as `plans/enemies.md`**, not `.ts` — every other plan in this
> directory is Markdown, and `plans/` is outside both tsconfig `include`
> globs, so a `.ts` here would be an unchecked file pretending to be code.
>
> **Scope:** how enemies are *drawn*. `src/game/Renderer.ts` (the enemy
> passes plus its animation clock), `src/data/arena.ts` (three constants and
> two pure functions), `src/data/enemies.ts` (`ENEMY_GAIT.flying` only),
> `src/game/Game.ts` (one call site), plus tests and docs.
>
> **Out of scope, deliberately:** `ENEMY_DEFS[].radius`. It is a *gameplay*
> number — `ProjectileManager.hitRadius` (`:723`) and
> `EnemyManager.contactRadius` (`:1504`) both read it — so nothing here
> changes it. Every size change below is render-only, and §5.4 is the test
> that keeps it honest.

---

## 0. TL;DR of every change

| Thing | Today | After this plan |
|---|---|---|
| Renderer animation clock | `this.time += 1/60` **per drawn frame** | `this.time += realDt`, clamped to `[1/240, 1/20]` |
| …so at 30 fps | every loop in `Renderer` runs at **half speed** | runs at wall-clock speed |
| Enemy stroke widths | world units, `entity(k)` | world units with a **device-pixel floor** (`this.penWidth`) |
| Body outline on a phone | **0.58–1.16 device px** → antialiased to a tint | pinned to **2.0 device px** |
| Drawn body size | `radius × (elite ? 1.25 : 1)` | `× bodyBoost()` too — **1.45× on a phone**, exactly 1 on a desktop |
| Flier membrane | flat `#2c3e50` (its own `borderColor`) on an ink-800 floor | root→tip gradient, `lighten(borderColor, 0.18 → 0.50)` |
| Flier leading edge | `entity(1.2)` ≈ 0.6 device px on a phone | `penWidth(entity(1.6), 1.5)` — never under 1.5 device px |
| Wingbeat | ±0.45 rad, span `2.1r`, no foreshortening | ±0.62 rad, span `2.35r`, cosine foreshortening |
| Wingbeat under reduced motion | frozen at `-0.15` rad — reads as *no wings* | frozen at `-0.34` rad — a clear raised V |
| Flier bob | `entity(3)` | `entity(4.5)`, and scaled by `bodyBoost()` like the body |
| Flier ground shadow at `low` quality | **absent** (`profile.shadows: false`) | always drawn for airborne enemies |
| Enemy HP bar on a phone | 4 world units ≈ **0.8 device px** | floored at 2.5 device px (3.5 for a boss) |
| Sprite cache vs. a resize | keyed by variant only | dropped whenever `camera.transform.scale` moves |

---

## 1. Measured baseline

Everything in this section was measured against the running game at
`375 × 812` (canvas box `375 × 442` CSS px), not estimated. Re-derive any of
it with the recipe in §7.

### 1.1 The two scales, and where the pixels go

`src/data/arena.ts` defines `WORLD_SCALE = 2.6` (positions, speeds, AoE) and
`ENTITY_SCALE = 1.7` (drawn radii, sprite padding, stroke widths). The camera
then fits the world rectangle into the backing store:
`Camera.applyWorld` does `ctx.setTransform(scale, 0, 0, scale, …)` where
`scale = transform.scale` is **backing-store pixels per world unit**.

Two consequences the rest of this plan turns on:

1. **Every `entity(k)` stroke width is in world units**, so its width in real
   pixels is `entity(k) × scale`. Nothing in the enemy passes checks that this
   lands above one pixel.
2. **Enemy sprites are baked at 1 canvas pixel = 1 world unit**
   (`makeSpriteRect`, `:3551`) and then blitted under that same transform, so
   the bake is downscaled by `scale` as well. The helper in §3 therefore works
   unchanged in both a bake and a live pass.

### 1.2 What `scale` actually is

`cssPerWorld = scale / dpr` is the dpr-independent figure — how big a thing
*looks*. `scale` itself is what strokes are measured in.

| Viewport | dpr cap (tier) | `scale` | `cssPerWorld` |
|---|---|---|---|
| Phone 375 × 442 | 2 (`high`) | 0.4006 | 0.2003 |
| Phone 375 × 442 | 1.5 (`medium`) | 0.3005 | 0.2003 |
| Phone 375 × 442 | 1 (`low`) | 0.2003 | 0.2003 |
| Desktop 900 × 620 | 1 | 0.3312 | 0.3312 |
| Laptop 1000 × 640 | 2 | 0.6838 | 0.3419 |
| Desktop 1140 × 760 | 2 | 0.8120 | 0.4060 |

A phone shows an enemy at **59% of a laptop's apparent size** — and, worse,
resolves it with **as little as 29% of a laptop's pixels per world unit**.

### 1.3 Which quality tier a phone lands on

`Game.initialQualityTier` (`:249`) raises the `high` threshold to 16 cores
when `(pointer: coarse)` matches. No shipping phone reports 16, so a phone
gets `medium` (8 cores) or `low` (< 4) — `dprCap` 1.5 or 1.0, and at `low`,
`shadows: false`. The comment at `Game.ts:238` already says it out loud: *a
four-core mobile SoC does not run this game at 60 fps*.

### 1.4 Stroke widths, in device pixels

| Viewport | outline `entity(1.7)` | detail `entity(1.2)` |
|---|---|---|
| Laptop dpr 2 | 1.98 | 1.39 |
| Desktop dpr 1 | **0.96** | **0.68** |
| Phone `high` | **1.16** | **0.82** |
| Phone `medium` | **0.87** | **0.61** |
| Phone `low` | **0.58** | **0.41** |

Anything under 1.0 is not a line; it is a fraction of a pixel's alpha. The
flier's wing edge is `entity(1.2)` at `withAlpha(def.color, 0.55)` — so on a
phone at `medium` it is **0.61 px at 55% alpha**, i.e. roughly a third of one
pixel's worth of ink. Note that a **dpr-1 desktop monitor is in the same
band**: this is not a mobile bug, it is a bug that mobile makes unmissable.

### 1.5 What the flier looks like right now

Magnified 8× off the live backing store at `375 × 442`, `high` tier:

- The **body** reads fine — pale ellipse, dark head, two red eye dots.
- The **wings** are a flat grey smear about 4 device pixels tall. The
  scalloped trailing edge specified in `drawWings`' own comment is entirely
  gone; what survives is the struts plus a hint of the lit edge.
- Held at the two extremes of the beat (`sin = -1` and `sin = +1`) the pose
  difference *is* large and clear. **The geometry is not the problem.**

So the wing motion is real, and the wing is nearly invisible. Which brings us
to the clock.

### 1.6 The animation clock is frame-counted, not wall-clocked

`Renderer.draw` opens with (`:733`):

```ts
this.time += FRAME_DT;          // FRAME_DT = 1 / 60
```

`this.time` is the argument to every `Math.sin` in the file. So **every loop
in the renderer runs at `fps / 60` of its intended rate**. The wingbeat is
`Math.sin(this.time * 12 + enemy.id) * 0.45` — 1.91 Hz at 60 fps, **0.95 Hz
at 30 fps, 0.64 Hz at 20 fps**. A phone rendering 200 bodies at 25 fps beats
its wings once every 1.25 seconds, through 6.8 CSS pixels of tip travel. That
does not read as flapping; it reads as drift.

Fifteen further sites use `FRAME_DT` the same way (§2.1), including
`advanceCombo`, whose own comment calls it "a frame-rate-independent
smoother". `Camera.update(realDt)` is the one place that already got this
right, and says why in its doc comment.

### 1.7 Reduced motion freezes the flier outright

`drawWings:4681`:

```ts
const flap = this.reducedMotion ? -0.15 : Math.sin(this.time * 12 + enemy.id) * 0.45;
```

`-0.15` rad is 8.6° — visually a flat wing. Under `prefers-reduced-motion`
the gait bob and squash are zero too (`:4525`), so the flier becomes a
perfectly static pale blob with two grey slivers. **Android's "Remove
animations" accessibility setting sets `prefers-reduced-motion: reduce` in
the WebView**, so a phone with it enabled sees exactly "the flying enemy
doesn't flap its wings" while the rest of the game — all event-driven motion
— still looks alive.

**Ask the reporter to check Settings → Accessibility → Remove animations
before starting.** If it is on, §4.4 is the fix that matters most to them;
if it is off, §2 is.

---

## 2. Step 1 — put the renderer on the wall clock

**Why first:** it is the only change that can make a wingbeat that already
exists actually happen at the rate it was written for, and it is independent
of everything else.

### 2.1 `src/game/Renderer.ts`

Replace the constant at `:20`:

```ts
/** Fallback frame step when a caller does not supply one. See `Renderer.dt`. */
const FRAME_DT = 1 / 60;
/**
 * The clamp on a real frame delta.
 *
 * The floor keeps a 240 Hz display from advancing the clock in slivers the
 * `Math.sin` arguments cannot resolve; the ceiling keeps a 300 ms stall —
 * a sprite bake, a save write, a tab coming back — from teleporting every
 * animation in the file forward by a third of a second on the frame after.
 */
const MIN_FRAME_DT = 1 / 240;
const MAX_FRAME_DT = 1 / 20;
```

Add a field next to `private time = 0;` (`:429`):

```ts
/**
 * Seconds the last frame took, clamped. Every age, ease and decay in this
 * file steps by this rather than by a fixed 1/60 — a phone that renders 200
 * bodies at 25 fps used to run every loop here at 42% speed, which is what
 * made the flier's wingbeat read as drift (plans/enemies.md §1.6).
 */
private dt = FRAME_DT;
```

Change the signature and the first line of `draw` (`:732-733`):

```ts
draw(snapshot: RenderSnapshot, options?: RenderOptions, realDt: number = FRAME_DT): void {
  this.dt = Math.min(MAX_FRAME_DT, Math.max(MIN_FRAME_DT, realDt));
  this.time += this.dt;
```

Then replace `FRAME_DT` with `this.dt` at **every remaining use site**. There
are fifteen, all inside methods, all safe:

| Line | Context |
|---|---|
| 890 | `advanceCombo` — the smoother's `k` |
| 904 | ember debt accumulation |
| 911, 912 | ember age and rise |
| 984 | after-image age |
| 1035 | hit-flash decay |
| 1052 | death-dissolve age |
| 1105, 1112 | range ease and bloom |
| 1157 | tracer age |
| 1172, 1173 | recoil and muzzle decay |
| 1204, 1206 | portal open/close |
| 1230 | emergence age |

`FRAME_DT` stays referenced (the field initialiser and the default
parameter), so `noUnusedLocals` is satisfied.

### 2.2 `src/game/Game.ts`

`Game.draw` is called from exactly one place, `Game.loop:5617`. `dt` there is
already the wall-clock delta, already clamped to `≤ 0.05` at `:5586`.

- `:6106` — `private draw(): void` → `private draw(realDt: number): void`
- `:6138` — pass it through as the third argument:
  `}, { …options… }, realDt);`
- `:5617` — `this.draw();` → `this.draw(dt);`

### 2.3 What this is *not*

It does not touch `Game.update`'s fixed simulation substepping. `Renderer` is
presentation only; nothing downstream of `this.dt` is read by the simulation.

---

## 3. Step 2 — a device-pixel floor under every enemy stroke

### 3.1 New pure helpers in `src/data/arena.ts`

Append to the file, after `PROJECTILE_HIT_PAD`:

```ts
/**
 * Least a stroke may measure, in **device** pixels.
 *
 * Below one device pixel the browser does not draw a thin line, it draws a
 * fraction of a pixel's alpha — and an `entity(1.2)` detail stroke is 0.41
 * device px on a phone at the `low` tier, which is why every interior detail
 * on an enemy dissolves there (plans/enemies.md §1.4). 1.25 rather than 1.0
 * so the line survives landing between two pixel centres.
 */
export const MIN_STROKE_PX = 1.25;

/**
 * The `cssPerWorld` a desktop window gets, and the reference the small-viewport
 * body scale-up aims at. Measured: 0.3312 on a 900x620 dpr-1 desktop, 0.3419
 * on a 1000x640 laptop, 0.4060 on a 1140x760 one.
 */
export const REFERENCE_CSS_PER_WORLD = 0.34;

/**
 * Ceiling on that scale-up.
 *
 * Not a taste value: a drawn body must stay inside the radius a projectile
 * actually tests against, which is `radius + PROJECTILE_HIT_PAD`. The tank is
 * the binding case — `entity(18) x 1.45 x ELITE_RADIUS_SCALE` = 55.5 against a
 * 57.6 hit radius — and the ceiling where it breaks is 1.506. See
 * `tests/enemy-scale.test.ts`, which is what stops this being raised blind.
 */
export const MAX_BODY_BOOST = 1.45;

/**
 * A world-unit stroke width with a device-pixel floor.
 *
 * `scale` is `ViewTransform.scale` — backing-store pixels per world unit — so
 * `minPx / scale` is that many device pixels expressed in world units. Works
 * unchanged inside a baked sprite, because a body sprite is baked at 1 canvas
 * pixel per world unit and blitted under the same transform.
 */
export function viewPenWidth(worldWidth: number, scale: number, minPx: number = MIN_STROKE_PX): number {
  if (!(scale > 0)) return worldWidth;
  return Math.max(worldWidth, minPx / scale);
}

/**
 * How much larger than its true radius a body is drawn, so that a phone's
 * 0.20 CSS px per world unit does not turn the roster into a point cloud.
 *
 * Exactly 1 at and above `REFERENCE_CSS_PER_WORLD`, so no desktop changes.
 * Driven by `cssPerWorld`, not by `scale`, so the same phone gets the same
 * apparent size on all three quality tiers.
 */
export function viewBodyBoost(scale: number, dpr: number): number {
  if (!(scale > 0) || !(dpr > 0)) return 1;
  const cssPerWorld = scale / dpr;
  if (cssPerWorld >= REFERENCE_CSS_PER_WORLD) return 1;
  return Math.min(MAX_BODY_BOOST, REFERENCE_CSS_PER_WORLD / cssPerWorld);
}
```

### 3.2 The two wrappers in `src/game/Renderer.ts`

Extend the import at `:3` to
`import { ARENA, ARENA_RANGE_CAP, entity, viewBodyBoost, viewPenWidth, world } from '../data/arena';`
and add both methods next to `enemyDrawRadius` (`:3568`):

```ts
/**
 * A stroke width that survives the viewport it is drawn into (§3).
 *
 * Every `entity(k)` line width in this file is in world units, so its real
 * width is `entity(k) x camera.transform.scale` — 1.98 device px on a laptop
 * and 0.58 on a phone at the `low` tier. This floors it.
 */
private penWidth(worldWidth: number, minPx: number = MIN_STROKE_PX): number {
  return viewPenWidth(worldWidth, this.camera.transform.scale, minPx);
}

/** Render-only body scale-up on a small viewport. 1 on every desktop. */
private bodyBoost(): number {
  const t = this.camera.transform;
  return viewBodyBoost(t.scale, t.dpr);
}
```

(Import `MIN_STROKE_PX` alongside the two functions.)

### 3.3 The mechanical replacement

**Rule:** every `lineWidth = entity(...)` assignment between line **3699** and
line **5085** inclusive, plus line **5159**, becomes
`lineWidth = this.penWidth(entity(...))`. Where the expression adds a term —
`entity(1.5) + ratio * 2`, `entity(1.6) + t * entity(3)`,
`entity(3) + t * 3`, `entity(3) + progress * 4` — wrap **only the leading
`entity(...)`** and leave the added term alone.

Three sites take a higher floor instead of the default, because they are the
silhouette itself rather than an interior mark:

| Line | Current | Becomes |
|---|---|---|
| 3699 | `g.lineWidth = entity(3.4);` (rim light) | `g.lineWidth = this.penWidth(entity(3.4), 2);` |
| 3709 | `g.lineWidth = entity(type === 'tank' \|\| type === 'boss' ? 2.4 : 1.7);` | `g.lineWidth = this.penWidth(entity(type === 'tank' \|\| type === 'boss' ? 2.4 : 1.7), 2);` |
| 3718 | `g.lineWidth = entity(1.6);` (elite rim) | `g.lineWidth = this.penWidth(entity(1.6), 1.5);` |

Line 3709 is the single highest-value line in this plan: it is the outline
that holds an enemy's silhouette against the floor, and on a phone it is
currently 0.58–1.16 device pixels wide.

The full set of lines covered by the rule, for checking off:

```
3699 3709 3718 3875 3904 3979 3995 4014 4035 4057 4092 4110 4122 4151 4175
4199 4210 4215 4238 4255 4456 4488 4604 4625 4661 4703 4707 4815 4848 4872
4891 4911 4936 4950 4968 4973 4989 5049 5081 5085 5159
```

**Excluded, on purpose:** `5124` and `5140` are inside `drawHostileShots`,
which is the projectile pass, not the enemy pass. They have the same problem
and are listed in §9 as follow-up.

### 3.4 Sprite padding has to grow with the strokes

`spritePadding` (`:3588`) reserves `entity(6)` of slack so the outline is not
clipped by the sprite's own bounds. A 2-device-pixel outline on a phone at
`low` is 10 world units wide, half of which sticks out past the silhouette.
Replace the body with:

```ts
private spritePadding(type: Enemy['type']): number {
  const base = type === 'siege' ? entity(12) : SPRITE_PADDING;
  // The outline is floored at 2 device px (§3.3); at a phone's `scale` that is
  // 10 world units wide, and half of it hangs outside the traced silhouette.
  return this.penWidth(base, 4);
}
```

On every desktop transform `entity(6) = 10.2` already exceeds `4 / scale`, so
this is a no-op there.

---

## 4. Step 3 — draw the bodies bigger on a small viewport

### 4.1 `enemyDrawRadius`

`src/game/Renderer.ts:3568`:

```ts
/** Radius an enemy of this type renders at: elite scaling and viewport boost included. */
private enemyDrawRadius(enemy: Enemy): number {
  return ENEMY_DEFS[enemy.type].radius
    * (enemy.elite ? ELITE_RADIUS_SCALE : 1)
    * this.bodyBoost();
}
```

Everything that matters already routes through this — `getEnemySprite`
(`:3610`), `drawEnemy` (`:4511`), and the track record at `:1027` — so the
sprite is *baked* at the boosted radius rather than blitted upscaled, and
loses no fidelity.

### 4.2 The shadow has to follow

`drawEnemyShadow:4498` reads the raw def radius and so never scaled with an
elite either. Change:

```ts
const r = this.enemyDrawRadius(enemy);
```

### 4.3 The gait travels with the body

In `drawEnemy` (`:4521-4531`), scale the bob by the same factor — a 5-world-unit
hover is 1.0 CSS px on a phone, which is no hover at all:

```ts
const gait = ENEMY_GAIT[enemy.type];
const boost = this.bodyBoost();
let bob = 0;
let squash = 0;
if (!this.reducedMotion) {
  const phase = this.time * gait.freq * (enemy.slowed === true ? SLOWED_GAIT : 1)
    + enemy.id * 1.7;
  squash = Math.sin(phase) * gait.squash;
  const lift = Math.sin(phase * 0.5);
  bob = (gait.float ? lift * gait.bob : -Math.abs(lift) * gait.bob) * boost;
}
```

`squash` is a *fraction* of the radius, so it needs no boost.

### 4.4 What this buys, and what it does not

| Viewport | boost | Flier drawn diameter, CSS px |
|---|---|---|
| Phone (any tier) | 1.450 | 7.5 → **10.9** |
| Desktop 900 × 620 dpr 1 | 1.027 | 12.4 → 12.7 |
| Laptop 1000 × 640 | 1.000 | 12.8 (unchanged) |
| Desktop 1140 × 760 | 1.000 | 15.2 (unchanged) |

A phone still shows a smaller flier than a laptop does. That is the honest
outcome: the boost narrows the gap by about half, and §3 and §5 are what make
the remaining size legible. The 2.7% on a dpr-1 desktop is a rounding artefact
of picking a single reference and is not worth a special case.

### 4.5 The safety property

A body drawn larger than the radius the simulation tests against is a lie the
player can feel — a shot that visibly clips an enemy and does nothing. It does
not happen here, because the projectile test is already far more generous than
the drawn body: `ProjectileManager` tests against `radius + PROJECTILE_HIT_PAD`
and `PROJECTILE_HIT_PAD` is **27** world units.

| Type | `radius` | drawn at 1.45 (× 1.25 if elite) | hit radius | slack |
|---|---:|---:|---:|---:|
| tank | 30.6 | 55.5 | 57.6 | **2.1** |
| harbinger | 28.9 | 52.4 | 55.9 | 3.5 |
| boss (never elite) | 51.0 | 74.0 | 78.0 | 4.0 |
| splitter / warden | 27.2 | 49.3 | 54.2 | 4.9 |
| siege / chorus | 25.5 | 46.2 | 52.5 | 6.3 |
| healer / shielded / leech | 23.8 | 43.1 | 50.8 | 7.7 |
| burrower | 22.1 | 40.1 | 49.1 | 9.0 |
| normal / blinker | 20.4 | 37.0 | 47.4 | 10.4 |
| flying / thief | 18.7 | 33.9 | 45.7 | 11.8 |
| fast | 17.0 | 30.8 | 44.0 | 13.2 |

Bosses are never elite — `WaveManager:284` rolls
`wave >= 21 && type !== 'boss' && …`. The tank binds, and the boost where it
would break is 1.506; 1.45 leaves 4% of headroom. §8.4 is the test.

**Accepted consequence:** a boss parked at contact
(`TOWER_HIT_RADIUS + radius + ENEMY_GAP` = 110.6 world units from centre) has
its drawn edge at 36.6, inside the tower drum's 47.6 — an 11-world-unit, ~2.3
CSS px overlap on a phone. It reads as a boss leaning on the tower it is
chewing, which is what is happening.

---

## 5. Step 4 — the flier

### 5.1 New constants in `src/game/Renderer.ts`

Next to `ELITE_RADIUS_SCALE` (`:17`):

```ts
/**
 * The wingbeat (§5).
 *
 * `WING_FREQ` is radians per second on the wall clock now (§2), so 11 rad/s is
 * a real 1.75 Hz rather than 1.75 Hz-at-60-fps. `WING_REST` is the pose held
 * under `prefers-reduced-motion`: a clear raised V, because the old -0.15 rad
 * was a flat wing and a flat wing on a 7 px body is no wing at all.
 */
const WING_FREQ = 11;
const WING_AMPLITUDE = 0.62;
const WING_REST = -0.34;
```

### 5.2 Replace `drawWings` (`:4679-4715`) entirely

Keep the doc comment above it, appending a sentence about the gradient.

```ts
private drawWings(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
  const def = ENEMY_DEFS[enemy.type];
  const flap = this.reducedMotion
    ? WING_REST
    : Math.sin(this.time * WING_FREQ + enemy.id * 1.7) * WING_AMPLITUDE;
  // A wing swept up or down is foreshortened — the span the viewer sees is the
  // true span times the cosine of the beat angle. Without it the two wings are
  // rigid sticks on a hinge, which is the read a rotation alone gives you.
  const foreshorten = 0.82 + 0.18 * Math.cos(flap);
  const span = r * 2.35;
  ctx.save();
  ctx.translate(enemy.x, enemy.y + bob);
  for (const dir of [-1, 1]) {
    ctx.save();
    ctx.rotate(flap * dir);
    ctx.scale(dir * foreshorten, 1);
    // Membrane: a leading edge out to the tip, then three scallops back in.
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -r * 0.15);
    ctx.quadraticCurveTo(span * 0.7, -r * 1.05, span, -r * 0.5);
    ctx.quadraticCurveTo(span * 0.82, -r * 0.05, span * 0.66, -r * 0.3);
    ctx.quadraticCurveTo(span * 0.6, r * 0.2, span * 0.42, -r * 0.1);
    ctx.quadraticCurveTo(span * 0.34, r * 0.32, r * 0.62, r * 0.12);
    ctx.closePath();
    // Root-to-tip wash. The flat `borderColor` fill this replaces is #2c3e50
    // against an ink-800 floor — a contrast that survives a laptop and vanishes
    // at a phone's 0.20 CSS px per world unit. Derived from the token rather
    // than a second literal, so retuning the flier moves its wings with it.
    const wash = ctx.createLinearGradient(r * 0.5, 0, span, 0);
    wash.addColorStop(0, withAlpha(lighten(def.borderColor, 0.18), 0.95));
    wash.addColorStop(1, withAlpha(lighten(def.borderColor, 0.5), 0.95));
    ctx.fillStyle = wash;
    ctx.fill();
    // Lit leading edge, in the body's own pale.
    ctx.strokeStyle = withAlpha(def.color, 0.8);
    ctx.lineWidth = this.penWidth(entity(1.6), 1.5);
    ctx.stroke();
    // Struts. Dark now rather than pale: against a lightened membrane they are
    // structure, and against the old dark one they were the only thing visible.
    ctx.strokeStyle = withAlpha(INK['950'], 0.45);
    ctx.lineWidth = this.penWidth(entity(1.1));
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -r * 0.15);
    ctx.lineTo(span * 0.66, -r * 0.3);
    ctx.moveTo(r * 0.5, -r * 0.15);
    ctx.lineTo(span * 0.42, -r * 0.1);
    ctx.moveTo(r * 0.5, -r * 0.15);
    ctx.lineTo(span, -r * 0.5);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
```

The gradient is built inside the mirrored transform, so it runs root→tip on
both wings without a second code path.

`lighten` and `INK` are already imported (`:8`). No new colour literal enters
the file — `docs/art-direction.md` §"the literals table" is the reason.

### 5.3 Widen the bob — `src/data/enemies.ts`

`ENEMY_GAIT.flying` (`:101`):

```ts
// The bob is the flier's altitude, and at entity(3) it was 1.0 CSS px on a
// phone. Presentation only; nothing outside `Renderer` reads this table.
flying: { freq: 5.5, bob: entity(4.5), squash: 0.03, float: true },
```

### 5.4 Give a flier its shadow back at the `low` tier

`drawEnemies:4379`:

```ts
// The drop shadow is the only thing that says a flier is in the air, and the
// `low` tier — which is exactly the phone where the body is smallest — is
// where it was being dropped. A handful of fliers is a handful of blits.
if (this.profile.shadows || e.type === 'flying') this.drawEnemyShadow(ctx, e);
```

### 5.5 Reduced motion is respected, not overridden

`WING_REST` freezes the wings; it does not slow-animate them. A player who
asked the OS for no animation gets no animation — they get a **legible static
pose** instead of a flat sliver. This is consistent with the policy stated in
`Renderer`'s `reducedMotion` doc comment (`:418`): loops stop, information does
not.

---

## 6. Step 5 — the HP bar

`drawEnemyHpBar:5146-5162`. `barH` is 4 world units — 0.80 device px on a
phone at `low`. Replace the first four lines of the body:

```ts
if (enemy.hp >= enemy.maxHp) return;
// World units per device pixel, so the bar has a floor in real pixels rather
// than in a unit the viewport is free to shrink to nothing.
const px = 1 / this.camera.transform.scale;
const barW = Math.max(20, r * 2);
const barH = Math.max(enemy.type === 'boss' ? 6 : 4, (enemy.type === 'boss' ? 3.5 : 2.5) * px);
const x = enemy.x - barW / 2;
const y = enemy.y - r - Math.max(10, 4 * px) + bob;
```

Chosen so both floors are inert on a desktop: at `scale = 0.6838`,
`2.5 × px = 3.66 < 4` and `4 × px = 5.85 < 10`. On a phone at `low` the bar
becomes 12.5 world units (2.5 device px) and clears the body by 20.

---

## 7. Step 6 — invalidate the sprite cache when the scale moves

Both `penWidth` and `bodyBoost` feed **baked** sprites, so a resize, an
orientation change or a quality-tier change (which moves `dprCap`, and so
`scale`) leaves stale bakes behind. `Game.onCameraResize` already calls
`invalidateBackground()`, but a tier change does not go through it — so the
check belongs in `draw`, where it catches every path.

Add a field next to `bgScale` (`:431`):

```ts
/** Camera scale the enemy sprites were baked at, so a zoom change re-bakes them. */
private spriteScale = 0;
```

And in `draw`, immediately after `this.time += this.dt;`:

```ts
// Body sprites bake their own stroke widths and their boosted radius, both of
// which are functions of the camera scale. A resize, a rotation or a quality
// tier change moves it; `invalidateBackground` does not fire for the last of
// those, so the check lives here rather than there.
const bakeScale = this.camera.transform.scale;
if (bakeScale !== this.spriteScale) {
  this.spriteScale = bakeScale;
  this.enemySprites.clear();
  this.shadowSprites.clear();
  this.partSprites.clear();
}
```

Three map clears on a resize. `towerSprites` is left alone — nothing in this
plan touches the tower's bakes.

---

## 8. Tests

### 8.1 New file `tests/enemy-scale.test.ts`

The two helpers were put in `src/data/arena.ts` precisely so this file needs
no canvas, matching how `tests/camera.test.ts` already drives
`makeViewTransform` and `arenaExtents`.

Export `ELITE_RADIUS_SCALE` from `src/game/Renderer.ts` (it is currently a
module-private `const` at `:17`) so the invariant test can read it.

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BOOST, MIN_STROKE_PX, PROJECTILE_HIT_PAD, REFERENCE_CSS_PER_WORLD,
  entity, viewBodyBoost, viewPenWidth,
} from '../src/data/arena';
import { makeViewTransform } from '../src/game/Camera';
import { ENEMY_DEFS } from '../src/data/enemies';
import { ELITE_RADIUS_SCALE } from '../src/game/Renderer';
```

Cases, all of them assertions this plan's numbers are the ones that shipped:

1. **`viewBodyBoost` is exactly 1 on every desktop transform.** Drive
   `makeViewTransform(900, 620, 1)`, `(1000, 640, 2)` and `(1140, 760, 2)`;
   expect `1` from the first two decimal places up — the 900×620 case is
   1.027, so assert `toBeLessThan(1.05)` there and `toBe(1)` for the other two.
2. **`viewBodyBoost` clamps on a phone.** `makeViewTransform(375, 442, 2)`
   → `MAX_BODY_BOOST`.
3. **`viewBodyBoost` is dpr-independent.** The transforms for
   `(375, 442, 2, 2)`, `(375, 442, 2, 1.5)` and `(375, 442, 2, 1)` — the three
   quality tiers' `dprCap` values — all give the same boost.
4. **The drawn body never exceeds the radius a projectile tests.** For every
   entry in `ENEMY_DEFS`:
   `radius * MAX_BODY_BOOST * (type === 'boss' ? 1 : ELITE_RADIUS_SCALE)
    <= radius + PROJECTILE_HIT_PAD`.
   Name the tank in the failure message; it is the binding case at 2.1 units
   of slack. This is the test that makes `MAX_BODY_BOOST` un-raisable by
   accident.
5. **Bosses are never elite**, which case 4 depends on: assert the guard by
   reading `WaveManager`'s condition indirectly — spawn is out of reach here,
   so instead assert the weaker, sufficient property that a boss at
   `MAX_BODY_BOOST` *without* the elite factor still fits, and leave a comment
   pointing at `WaveManager:284`.
6. **`viewPenWidth` returns at least `minPx / scale`.** Table-drive the five
   viewports in §1.4; assert every result times `scale` is `>= MIN_STROKE_PX`.
7. **`viewPenWidth` is a no-op where the world width already wins.** On the
   laptop transform, `viewPenWidth(entity(1.7), scale, 2)` returns within 2%
   of `entity(1.7)` — i.e. desktop stroke weights do not visibly change.
8. **`viewPenWidth` and `viewBodyBoost` survive a degenerate transform**:
   `scale = 0` returns the input / `1` rather than `Infinity` / `NaN`.

### 8.2 Extend `tests/enemies.test.ts`

One case, in whatever `describe` covers the def table: **`ENEMY_GAIT` has an
entry for every `EnemyType` and every `bob` is positive** — the flying entry
is being edited by hand in §5.3 and the table is a `Record` the compiler
checks for presence but not for sanity.

### 8.3 Do not add a canvas test

There is no jsdom/canvas environment in this suite, and standing one up to
assert a `lineWidth` is a large amount of scaffolding for a value §8.1 already
pins as a pure function. Verify the drawing itself with §10.

### 8.4 Run

```bash
npm run typecheck && npm run test && npm run checks
```

`npm run checks` is unaffected — nothing here touches a simulation value — but
run it to prove that.

---

## 9. Explicitly out of scope

Listed so nobody has to guess whether they were forgotten:

- **`ENEMY_DEFS[].radius`, speeds, HP, damage.** Gameplay. Untouched.
- **`drawHostileShots` (`:5124`, `:5140`)** — same sub-pixel stroke problem,
  projectile pass rather than enemy pass. Follow-up.
- **The tower, wall, plinth, range ring and projectile bakes.** Same problem,
  same helper would fix them; a separate change with its own screenshots.
- **The DOM enemy icons** (`ENEMY_DEFS[].icon`, the codex and threat chips).
  They are SVG sprite symbols at explicit CSS pixel sizes and are already
  legible on a phone; nothing here affects them.
- **`ARENA.minHalfExtent`.** Reducing it would be a real zoom-in, but it feeds
  `ARENA_RANGE_CAP`, the spawn ellipse and therefore walk-in time. That is a
  balance change wearing a rendering change's clothes.
- **Auto-promoting the quality tier.** `Game.demoteQuality` is one-way by
  design.

---

## 10. Verification recipe

The dev server does not need to be poked by hand; this is exactly how the
numbers in §1 were produced. Run `npm run dev`, open the app, and:

1. **Emulate a phone.** 375 × 812 viewport, then reload so the load-time
   quality detect re-runs.
2. **Read the transform.**
   ```js
   const g = window.__theTower.game, t = g.camera.transform;
   ({ scale: t.scale, dpr: t.dpr, cssPerWorld: t.scale / t.dpr, tier: g.qualityTier })
   ```
   Expect `cssPerWorld ≈ 0.2003` and `bodyBoost() === 1.45`.
3. **Put the whole roster on the field, held still.**
   ```js
   const em = g.enemies, cx = g.camera.worldWidth / 2, cy = g.camera.worldHeight / 2;
   ['normal','fast','tank','flying','healer','splitter','shielded','siege',
    'thief','blinker','warden','burrower'].forEach((ty, i) => {
     const e = em.spawn(ty, 5, cx - 330 + (i % 4) * 220, cy - 330 + Math.floor(i / 4) * 260);
     e.speed = 0; e.hp = e.maxHp;
   });
   ```
4. **Magnify one body off the backing store**, which is the only way to judge
   a 7 px sprite:
   ```js
   const e = em.list.find(x => x.type === 'flying');
   const src = document.querySelector('canvas');
   const px = e.x * t.scale + t.offsetX, py = e.y * t.scale + t.offsetY;
   const S = 60, Z = 8;
   const ov = Object.assign(document.createElement('canvas'), { id: '__zoom', width: S * Z, height: S * Z });
   ov.style.cssText = 'position:fixed;left:8px;top:60px;z-index:99999;image-rendering:pixelated;border:2px solid #0f0';
   document.body.appendChild(ov);
   const c = ov.getContext('2d'); c.imageSmoothingEnabled = false;
   c.drawImage(src, px - S / 2, py - S / 2, S, S, 0, 0, S * Z, S * Z);
   ```
5. **Compare the two extremes of the beat** by driving the clock directly:
   ```js
   const r = g.renderer, id = e.id;
   const timeFor = s => { const b = (Math.asin(s) - id * 1.7) / 11; return b + Math.ceil(-b / (Math.PI * 2 / 11)) * (Math.PI * 2 / 11); };
   // set r.time, call g.draw(1/60), re-run the drawImage above for each of timeFor(-1) and timeFor(1)
   ```
   Both poses must be unmistakable at 8×, and the membrane must be visibly
   lighter than the floor at both.
6. **Then let it run and watch it at 1×.** The wings must beat at roughly
   1.75 Hz regardless of the frame rate the phone is managing — that is what
   §2 buys, and the only way to see it is with the FPS readout open.
7. **Toggle reduced motion** (devtools rendering pane, "emulate
   prefers-reduced-motion") and confirm the flier holds a visible raised-V
   pose rather than a flat sliver.
8. **Clean up:** `document.getElementById('__zoom')?.remove()` and reload.

---

## 11. Task order

Each step is independently shippable and independently verifiable; do them in
this order because each makes the next easier to judge.

| # | Step | Files | Verify |
|---|---|---|---|
| 1 | Wall-clock renderer (§2) | `Renderer.ts`, `Game.ts` | §10.6 — animation rate stops tracking fps |
| 2 | `arena.ts` helpers + tests (§3.1, §8.1) | `arena.ts`, `tests/enemy-scale.test.ts` | `npm run test` |
| 3 | Stroke floor (§3.2, §3.3, §3.4) | `Renderer.ts` | §10.4 — outlines resolve at 8× |
| 4 | Cache invalidation (§7) | `Renderer.ts` | resize the window mid-wave, bodies re-bake |
| 5 | Body boost (§4) | `Renderer.ts` | §10.2, §10.3 |
| 6 | Flier (§5) | `Renderer.ts`, `enemies.ts` | §10.4, §10.5, §10.7 |
| 7 | HP bar (§6) | `Renderer.ts` | §10.4 on a damaged body |
| 8 | Docs (§12) | `docs/*` | — |

---

## 12. Docs to update

- **`docs/camera-system.md`** — a subsection under the two world scales:
  `ViewTransform.scale` is what stroke widths are denominated in, `scale / dpr`
  is what apparent size is, and `viewPenWidth` / `viewBodyBoost` are the two
  places that convert. Carry the §1.2 measurement table over.
- **`docs/enemy-system.md`** — a short "How enemies are drawn on a small
  viewport" section: the render-only body boost, why `ENEMY_DEFS[].radius` is
  not it, and the §4.5 slack table as the reason the boost is capped at 1.45.
- **`docs/performance.md`** — the renderer's sprite cache is now keyed by the
  camera scale as well as the variant, and drops on a scale change.
- **`docs/art-direction.md`** — one line under the enemy palette: the flier's
  wing membrane is `lighten(borderColor, 0.18 → 0.50)`, derived from the token,
  not a literal.
- **`AGENTS.md`** — no change. No table count moves.
