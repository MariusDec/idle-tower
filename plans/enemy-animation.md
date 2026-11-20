# Enemy animation: gaits, squash, pops, boss poses

**Status:** 2026-11-20. Steps 0–6 built (a692f60 … 4d41c6a) and reviewed
(c913714). Step 7, the performance check and the option-5 decision (§10),
is still open. Comes out of the
"Enemy animations brainstorm" session, whose options are numbered 1–8. This plan
covers:

| # | Option | Scope here |
|---|---|---|
| 1 | Squash and stretch with the gait | all enemies |
| 2 | Hit squish | all enemies |
| 3 | Spawn pop | all enemies |
| 6 | One movement style per type (`hop`, `waddle`, `slither`, `float`, `skitter`) | all enemies |
| 7 | Animation "frames" | **bosses only**: pose states (§6) |
| 8 | Parts drawn separately | **bosses only**: three ideas, ranked (§7) |
| 5 | Lean into movement | **not built yet**: a bench decides (§10) |
| 4 | Breathing while still | out of scope |

Everything here is presentation only. The renderer reads `RunState` and never
writes it. Animation reads the wall clock, `e.id` and render-side state, never the
sim's RNG, so runs stay deterministic and pacing and balance are unaffected. As
with every cosmetic change, no pacing or sim runs are needed. Typecheck and
the unit tests in §9 are enough.

**How to read this:** §0 is the owner's decisions (all settled). §1 is where things
stand. §2 is the quality and reduced-motion matrix, the rule every later section
follows. §3 is the shared groundwork. §4–§5 are regular enemies. §6–§7 are bosses.
§8 is the build order. §9 is the tests. §10 is the performance check for option 5,
run last. §11 lists the files.

---

## 0. Decisions

All five were decided by the owner on 2026-11-20.

| # | Question | Decision |
|---|---|---|
| D-1 | Under reduced motion, does today's plain bob stay? | **Decided: keep it.** It ships today, it's tiny (≤ 3 world units), and changing it is out of scope. Everything this plan adds is off under reduced motion, except the boss wind-up tell (§6.3), which carries information. |
| D-2 | Hit squish timed by sim ticks (like the flash) or by the wall clock? | **Decided: wall clock.** At 3× a tick-based squish lasts about 2.5 frames and reads as noise. Effects already run on the wall clock. The flash stays on ticks. |
| D-3 | Chorus bodies hop in unison (phase from `e.group` instead of `e.id`)? | **Decided: yes.** It's free, and it shows their shared HP pool at a glance. |
| D-4 | Option 8 on rare non-boss bodies (Champions, a stratum's Keeper)? | **Decided: not for now, bosses only.** The owner will revisit option 8 for other enemies later (§12). These bodies are baked sprites, so any extra part is an extra draw per body. |
| D-5 | If option 5 (lean) passes the bench on `high` only, ship it on `high` only? | **Decided: yes.** `medium` and `low` keep the transform-free path. |

## 1. Where things stand

- **Regular enemies** ([enemies.ts](../src/render/painters/enemies.ts)): one
  sprite per type, baked per view scale (rounded to √2 steps), and one `drawImage`
  per body. The `GAIT` table gives each type a bob frequency and amplitude.
  While `e.moving`, the body shifts by `sin(time·freq + id)·bob`. When the body
  stops, the bob snaps to 0. The hit flash is a white circle that fades over 5
  sim ticks (`tick − e.hitTick`). The fade-in from the dark is `emergence()` →
  `rise`, which is driven by position, not time.
- **Bosses** ([bosses.ts](../src/render/painters/bosses.ts)): drawn as vectors every frame, never baked.
  `traceBoss` samples a 64-point radius profile (`PROFILE[id](a, t)`) and is
  traced 2–4 times a frame (fill, clip for detail, stroke, plus flash or
  wind-up). Some profiles already move (Bog Mother swells, Hunger's mouth,
  Undertow's crests). The boss has a 2% breathe, a wind-up ring and glow,
  stagger stars and an enraged halo.
- **Boss-adjacent bodies:** Forgeheart's plates and the Hollow King's court are
  separate `Enemy` bodies drawn by `paintPlates` and `paintCourt`. The Prism's
  facets (`paintFacets`) are drawn at the boss's position.
- **Events the renderer already consumes** (`Renderer.consume`): `bossArrive`,
  `bossPhase`, `windup {seconds}`, `slam`, `stagger`, `submerge`, `emerge`,
  `enrage`, `surface`, `blink`, `split`, `rise`. None of them carries an enemy
  id. Per-body triggers (§5) must therefore be detected on the render side.
- **Quality** ([quality.ts](../src/render/quality.ts)): `high`, `medium` and `low` set the particles,
  the additive glow and the DPR cap. Android trims `high` and `medium`. The
  dynamic scaler steps down one tier when a 2 s window misses 17 ms.
- **Reduced motion:** the setting is `motionReduced(settings)`, applied by
  `Renderer.setMotion(reduced, shake)`. The renderer already passes it to
  `paintRift` and `paintReliquaries`, which hold their pulses still under it.
- **Pause:** a stopped arena stops drawing once `Renderer.settled` holds, so all
  wall-clock animation freezes, as today's bob does. Nothing in this plan may
  set `dirty` or affect `settled`.
- **Budget:** 300 bodies, 60 fps on a mid-range phone. Measured on desktop on
  2026-10-01: `Renderer.render` 0.6–0.7 ms p50. The phone check is still open
  (docs/performance.md).

**GitNexus blast radius** (run 2026-11-20, upstream):

| Symbol | Risk | Notes |
|---|---|---|
| `QualityProfile` | **MEDIUM** | 6 direct refs, all in `quality.ts` and `tests/quality-detect.test.ts`. Adding a field touches `BASE_QUALITY` and the test fixtures only. |
| `paintBoss` | LOW | 1 caller (`Renderer.render`); flows `frame` and `render` |
| `Renderer.consume` | LOW | 1 caller (`App.frame`) |
| `EnemyPainter.draw` | LOW | Reported 0 callers. The index misses the call through the `this.enemies` field, so the one real caller is `Renderer.render` ([renderer.ts:710](../src/render/renderer.ts:710)). |

Re-run `impact` on each symbol before editing it, as CLAUDE.md requires, and run
`detect_changes()` before each commit.

## 2. The matrix: quality tiers and reduced motion

The rule is that **a lower tier only drops animations, it never swaps in
different ones.** Everything in §4–§5 is free for the GPU: it changes only the
`drawImage` destination rectangle. The tiers therefore differ on CPU work per
body, on render-side bookkeeping, and on aliasing at DPR 1, where a 1–2 px
squash on a small sprite shimmers.

A new `MotionLevel` decides what runs. It's derived once, whenever the tier or
the setting changes, never per body:

```ts
type MotionLevel = 'full' | 'lite' | 'reduced';
// reduced motion wins over any tier; otherwise QUALITY[tier].motion
```

| Animation | high | medium | low | reduced motion |
|---|---|---|---|---|
| **6** Gait style offsets (dx, dy) | ✓ | ✓ | ✓ | today's plain bob (D-1) |
| **1** Gait squash and stretch | ✓ | ✓ | — | — |
| **1** Ease into and out of the gait (no snap on stop) | ✓ | ✓ | — (snaps, as today) | — |
| **2** Hit squish | ✓ | ✓ | ✓ (half amplitude) | — (flash only) |
| **3** Pop while walking in (driven by `rise`) | ✓ | ✓ | ✓ | — (fade only, as today) |
| **3** Pop on birth or re-entry in the light | ✓ | ✓ | — | — |
| Crowd damping of all amplitudes | ✓ | ✓ | ✓ | n/a |
| **7** Boss poses (§6) | ✓ | ✓ | ✓ (no afterimage) | wind-up compression only |
| **7** Release afterimage | ✓ | — | — | — |
| **8c** Boss wind-up tells | ✓ | ✓ | ✓ | ✓ (driven by progress, no oscillation) |
| **8a** Boss follow-through springs | ✓ | ✓ | — | — |
| **8b** Boss gaze | ✓ | ✓ | — | — (pupils centred) |
| **5** Lean and waddle rock (rotation) | after the bench (§10) | after the bench | never | never |

So `QUALITY[tier].motion` is `'full'` for `high` and `medium` and `'lite'` for
`low`. The few `high`-only items (afterimage, possibly lean) check the tier
directly. Android keeps the base values. Its `medium` already has no additive
glow, and every change here is CPU-cheap.

## 3. Groundwork (shared)

### 3.1 `src/render/motion.ts` (new, pure, no DOM)

This module holds every curve, so all of it can be tested in Node:

```ts
export type GaitStyle = 'hop' | 'waddle' | 'slither' | 'float' | 'skitter';
export type MotionLevel = 'full' | 'lite' | 'reduced';

/** Reused per body, never allocated per frame. World units and scale factors. */
export interface BodyMotion { dx: number; dy: number; sx: number; sy: number }

export function gait(out: BodyMotion, style: GaitStyle, freq: number, amp: number,
  phase: number, weight: number, heading: { nx: number; ny: number }, level: MotionLevel, crowd: number): void;
export function hitSquish(since: number /* s */, level: MotionLevel, crowd: number): number; // signed squash, 0 at rest
export function popFromRise(rise: number): number;            // scale; 1 when rise = 1
export function popFromTime(since: number /* s */): number;   // scale; 1 when since ≥ POP_SECONDS
export function crowdDamping(alive: number): number;          // 1 → 0.5
export const MOTION: { … }                                     // every tunable in one table
```

- **Area preservation:** squash is one signed amount `q`, with `sy = 1 − q` and
  `sx = 1 / (1 − q)` clamped to `[0.85, 1.18]`. The volume reads as constant, so
  the body looks elastic, not like it's resizing.
- **Bottom anchor:** for vertical squash the sprite's bottom edge stays put. A
  landing hop flattens onto the ground instead of shrinking toward its centre.
  The draw rectangle is `w = 2·half·k·sx·pop` and `h = 2·half·k·sy·pop`, with
  the centre moved by `half·k·(1 − sy·pop)` toward +y.
- **Crowd damping:** `crowd = 1 − 0.5·clamp((alive − 60) / 240, 0, 1)` scales
  every amplitude. Bodies get full motion up to 60 on the field and half
  motion at 300. This answers the brainstorm's warning that squash above 15%
  at 300-body density looks jittery, not lively. `alive` is counted once per
  frame in the loop that already runs.
- **Phase seed:** `e.group || e.id`, so Chorus bodies share a phase (D-3).

### 3.2 `GAIT` becomes the motion table

Each `GAIT` entry gains a `style` (assigned in §4.1), and `Record<EnemyId, …>`
keeps it exhaustive. `freq` and `bob` keep their meaning and are retuned per
style where needed.

### 3.3 Per-body render state: `EnemyPainter`'s track map

Options 1 (easing), 2 (re-arm) and 3 (re-entry) need a little memory per body.
The sim must not hold it, so `EnemyPainter` keeps it:

```ts
interface Track {
  frame: number;      // last frame this id was drawn, for the sweep
  seenAt: number;     // clock when first drawn
  popAt: number;      // clock a time-driven pop began (−∞: none)
  hitSeen: number;    // the e.hitTick last read
  squishAt: number;   // clock the current squish began
  weight: number;     // gait weight 0..1, eased toward e.moving
  under: boolean;     // last frame's e.under (Burrower)
  shade: boolean;     // last frame's e.shade (Echoes)
  lx: number; ly: number; // last drawn position (Blinker jumps)
}
private tracks = new Map<number, Track>();
private pool: Track[] = [];   // free list: no GC churn at 300 bodies × thousands per run
```

- Stamp `frame` on every draw. Every 30 frames, sweep the entries whose `frame`
  is stale back into the pool. Dead bodies leave no trace after half a second.
- Add `EnemyPainter.reset()` for when the run changes (call it from
  `Renderer.attach`, because ids restart per run). The first frame after a
  reset seeds every live body with `popAt = −∞`, so a resumed save doesn't pop
  its whole field at once.
- On `low` (`'lite'`), still use the map for the squish re-arm. A `Map.get`
  per body costs microseconds at 300. Skip the easing and the time-driven pops.

### 3.4 Wiring the setting and the tier

- `QualityProfile` gains `motion: 'full' | 'lite'`. This is the **MEDIUM**
  blast radius: update `BASE_QUALITY` and `tests/quality-detect.test.ts`.
- `EnemyPainter.setMotion(level: MotionLevel, tier: QualityTier)` is stored on
  the painter, so `draw()`'s long positional signature doesn't grow.
- `Renderer.setQuality` and `Renderer.setMotion` both recompute the level and
  push it to `EnemyPainter` and the `BossAnimator` (§6). Neither sets `dirty`
  beyond what it already does.
- Bench override (dev): `BenchOptions.motion?: 'off' | 'base' | 'lean'`.
  `'off'` forces `reduced` (today's look), so the cost of 1/2/3/6 can be
  measured on the same tier. `'lean'` turns on the option-5 code path (§10).
  The bench restores the setting when it's done, as it restores the tier.

## 4. Gaits: options 6 and 1 (all enemies)

### 4.1 Styles

The heading `(nx, ny)` is the unit vector toward the tower, `(−x, −y)/|…|`.
It's stable and needs no `px` or `py`.

| Style | Offsets (6) | Squash (1, `'full'` only) | Types |
|---|---|---|---|
| `hop` | `dy = −abs(sin p)·2·bob`, an arc with the same peak-to-peak as today's bob | Landing flattens: `q = S·(1 − h/0.25)` while `h = abs(sin p) < 0.25`. The apex stretches: `q = −0.5·S·h`. | grunt, imp, splitter, spitter, bomber, chorus, ram |
| `waddle` | `dx = sin(p)·1.2·bob`, plus `dy = −abs(cos p)·0.5·bob`, a dip on each step | A light squash on each footfall | brute, siege-engine, husk, shieldbearer, maw |
| `slither` | Lateral wave: `(−ny, nx)·sin(p)·1.5·bob` | — (a stretch along the heading needs rotation, see §10) | leech, lurker, burrower (surfaced) |
| `float` | Lissajous drift: `dy = sin(0.5p)·bob`, `dx = sin(0.31p + 1.7)·0.6·bob` | none | phantom, harbinger, tidecaller, summoner, mender, wardstone, blinker |
| `skitter` | `dx` and `dy` are each `(sin 1.7p + sin(2.9p + seed))·0.35·bob` | A ±4% flutter in `sy` | runner, shardling |

Here `p = time·freq + seed`, and `S` is the style's squash amount, at most
`MOTION.gaitSquash = 0.12` before crowd damping. Use smooth sums of sines for
`skitter`, never `Math.random`: random jitter flickers between interpolated
frames.

### 4.2 Starting and stopping (`'full'`)

`weight` eases toward `e.moving ? 1 : 0` at about 8/s (`track.weight += (target
− weight)·(1 − e^(−8·dt))`). The gait's offsets and squash are multiplied by it,
so a Spitter reaching its standoff settles over about 150 ms instead of snapping
mid-hop. `'lite'` keeps today's snap.

### 4.3 What follows the body

- **Follow the offset, not the squash:** elite and Champion halos, the shield
  arc, the Husk's shell, the ward ring, slow and fury rings, the Ram's streak
  and the HP bar. Today they all follow the bob, so behaviour stays the same,
  and rings stay crisp.
- **Follow both:** the hit flash. Draw it as `ctx.ellipse(cx, cy, r·sx, r·sy)`
  at the squashed centre, so it covers the squashed body. The cost is the same
  as the `arc` it replaces.
- **Not touched:** `drawMound` (a Burrower underground) and the Chorus links,
  which join sim positions. The links stay as they are. Their ends move by at
  most a few units, and that slack reads as a tether.

## 5. Hit squish and pops: options 2 and 3 (all enemies)

### 5.1 Hit squish (2)

- **Trigger:** when `e.hitTick !== track.hitSeen` and `clock − track.squishAt ≥
  MOTION.squishRearm` (0.2 s), set `squishAt = clock`. The rearm gap matters:
  under a beam or orbit, `hitTick` changes every tick, and a naive squish would
  stay fully compressed. With the gap, a body under constant fire pulses about 5
  times a second, which reads as being pummelled.
- **Curve:** a damped spring over 0.16 s,
  `q = A·e^(−t/0.05)·cos(t·2π/0.16)`. It compresses, overshoots into a slight
  stretch and settles. `A = 0.16·crowd`, or `0.08·crowd` on `'lite'`.
- It adds to the gait's `q`, and the sum is clamped by §3.1's clamp.
- The flash stays as it is (sim ticks, 5 ticks).

### 5.2 Pops (3)

There are two entrances, and each needs its own curve:

1. **Walking in from the dark** (every tier). The scale comes from `rise`, which
   already rises monotonically as a body crosses the rim: `0.82` at
   `rise = 0`, `1.08` at `0.7`, `1.0` at `1` (smoothstep segments). There is no
   state and no time. A Lurker walking back out (`heading = −1`) plays it in
   reverse and shrinks into the dark, which is correct.
2. **Appearing inside the light** (`'full'` only), driven by time from `popAt`.
   `popFromTime` is a back-out curve over 0.22 s: `0.5 → 1.12 → 1`. Triggers:
   - first sight with `rise ≥ 0.98`: Splitter fragments, a Summoner's imps,
     Chorus bodies, anything spawned inside the light
   - a Burrower surfacing (`track.under && !e.under`)
   - a body rising as a shade (`!track.shade && e.shade`)
   - a Blinker landing: drawn position jumped by more than 3·radius since the
     last frame (`lx`, `ly`)

   On `'lite'`, these bodies appear at full size, as they do today.

## 6. Boss poses: option 7 (bosses only)

The brainstorm's "several frames per type" meant baked frames. Bosses are
already drawn live, so here a "frame" is a **pose**: a transform state driven by
what the boss is doing, blended with springs. This adds no bakes, no memory and
no extra traces.

### 6.1 `BossAnimator` (new, in `src/render/bossMotion.ts`)

The `Renderer` owns it, and it's reset in `attach`. It takes two inputs:

- **Events**, from `consume()`: `bossArrive`, `windup {seconds}` (which gives
  the wind-up's total), `slam`, `stagger`, `bossPhase`, `emerge`, `submerge`,
  `enrage` and boss hits. Each event starts a timed pose on the wall clock,
  like effects.
- **State**, read each frame from `BossState` and the body: `b.windup`
  (progress `q = 1 − windup/total`), `b.staggeredUntil`, `b.enraged`,
  `e.moving` and `e.hitTick`.

Each frame it outputs one `BossPose { dx, dy, sx, sy, shear, after: number /*
afterimage alpha */, tell: number /* 0..1 wind-up progress */, lag: number /*
spring for 8a */ }`.

### 6.2 Per-boss character: the `BOSS_MOTION` table

| Boss | Gait | Squash | Notes |
|---|---|---|---|
| Gatekeeper | heavy stomp, 1.4 Hz | firm | strong release shudder |
| Bog Mother | slow lurch, 1 Hz | very soft (jelly) | the largest follow-through (8a) |
| Prism | glide, no stomp | rigid (≤ 3%) | reacts through 8c glints, not squash |
| Forgeheart | stomp, 1.2 Hz | firm | its plates stay put (§6.4) |
| Hollow King | regal glide plus slight sway | medium | crown follow-through (8a) |
| Blight | locked to the heartbeat (`t·5` already in `PROFILE`) | soft | pulses, doesn't walk |
| Deepwarden | grinding slide | rigid | shudders instead of squashing |
| Hunger | lurch, 1.6 Hz | soft | the largest release lunge |
| Undertow | rolling sway (follows its crests) | medium | rise and sink poses (§6.3) |

### 6.3 The poses

All amplitudes are fractions of `r`, so they read the same at every size.

| Pose | When | What it does | Reduced motion |
|---|---|---|---|
| **Arrive** | `bossArrive` (0.6 s) | Drops from `−1.2r` (with the fade it already has), lands with a 25% squash, and settles over two spring bounces. | Fades in place |
| **Walk** | `e.moving` | Gait from §6.2: a footfall squash of 4–6% and a small `dy`. Enraged: cadence ×1.6 plus a ±1 px tremble. | Still |
| **Wind-up** | `b.windup > 0` | Anticipation: `sy → 1 − 0.14q`, `sx → 1 + 0.10q`, a back-off of `0.05r·q` away from the tower, and a tremble that grows with `q`. It sits on top of the existing ring and glow. | **Kept** (compression only, no tremble). It's slow, small and the tell the player reads. |
| **Release** | `slam` (0.35 s) | Snaps to a stretch (`sy` 1.18) with a lunge of `0.08r` toward the tower, then overshoots into a squash and settles. On `high`, one afterimage: an extra fill at alpha 0.25 at the pre-lunge pose. | Still |
| **Stagger** | `staggeredUntil > simTime` | A dizzy droop (`sy` 0.94) plus a sway of `dx = sin(6t)·0.05r` and `shear ±0.06` (the existing stars stay). | Droop only, no sway |
| **Phase** | `bossPhase` (0.5 s) | A shudder (`dx` ±0.04r, decaying) plus a scale punch 1.12 → 1. It lands on the existing shake and zoom punch. | Still (the banner carries it) |
| **Hit** | `hitTick` changed | A 4% squish, re-armed every 0.25 s, since bosses get hit all the time | — |
| **Sink and rise** | `submerge`, `emerge` (Undertow) | Sinking: `sy → 0.3` as it fades. Rising: `0.3 → 1.1 → 1`. | Fade only |

Poses blend: the walk always runs underneath, the event poses add on top, and
the result is clamped (`|1 − sx|`, `|1 − sy| ≤ 0.25`, `|shear| ≤ 0.08`). The
boss stays mostly upright, as the brainstorm's lighting note asks.

### 6.4 Where the pose is applied

- **`paintBoss`** gains a `pose: BossPose` parameter. The shadow is drawn
  first with only `dx` and `sx` applied, because it stays on the ground. Then
  the pose goes on as `translate(dx, dy)`, an anchor shift to the base,
  `transform(sx, 0, shear, sy, 0, 0)` and the shift back. The body,
  detail, stroke, flash and wind-up glow all go through it with no change to
  the code. The body gradient scales with the path. Within the clamps (scale
  within ±25%, shear ≤ 0.08), the light doesn't visibly move.
- **`paintFacets`** (Prism) takes the same `dx`/`dy`, so the mirror stays on
  the body.
- **`paintPlates`** (Forgeheart): the plates are their own bodies at their own
  sim positions, so they **don't** follow the pose. That's why Forgeheart's
  lunge is capped at `0.04r`, small enough that the body presses into its
  plates without visibly parting from them.
- **`paintCourt`** shades (Hollow King): optional, for consistency. Give them
  the `float` offsets from §4.1, offsets only, at a cost of one `translate` they
  already pay.
- `drawBossMarker` (the off-screen arrow) ignores the pose.

**Cost:** one boss, a few `sin` calls and one `transform`. There are no extra
traces, except the `high`-only afterimage, which adds one 64-point fill for
0.35 s per slam.

## 7. Boss parts: option 8 (bosses only)

Bosses are drawn live and there's only one on screen, so "separate parts"
cost almost nothing here. Regular bodies would each pay an extra draw (D-4).
Three ideas, ranked by impact for the work:

### 8c. Wind-up tells (every tier, reduced motion included)

The part that charges shows the charge. `paintDetail` takes `pose.tell` (0..1)
and changes what it already draws:

- **Gatekeeper:** the portcullis bars rise with `tell` and slam down on release.
  The eye flares.
- **Forgeheart:** the grille's bars spread apart and the molten heart swells and
  brightens.
- **Hunger:** the mouth's opening in `PROFILE` widens from `0.35` toward `0.9`,
  a gape before the bite.
- **Deepwarden:** the ward glyph brightens and its ring closes.
- **Hollow King and Blight:** the eye hollows and the core glow toward blood.
- **Prism:** the inner rays stop turning and converge.
- **Bog Mother and Undertow:** the eggs bulge, and the crests pull in toward the
  centre.

It's driven by progress, not oscillation, so it stays on under reduced motion.
It makes slams easier to read, a gameplay gain on top of the looks. **Highest
impact.**

### 8a. Follow-through springs (`'full'`)

The outer parts lag the body: crown points (Hollow King), thorns (Blight),
crests (Undertow), merlons (Gatekeeper) and the whole jelly outline (Bog
Mother). A single 1D damped spring per boss is driven by pose changes in `sy`
and `dy`. Its displacement `lag` goes into `PROFILE[id](a, t, lag)` and lifts
the top-side samples (`−sin a > 0.3`) by `lag·k_boss`. After a stomp, a landing
or a release, the crown wobbles a beat behind the body. That's the classic
follow-through principle, and the cheapest way to make a big body feel heavy.
The profile is already sampled 64 times per trace, so this adds no extra passes.

### 8b. Gaze (`'full'`)

Bosses with eyes get pupils that move: the Gatekeeper's burning eye, new
pinpoints of light in the Hollow King's hollows, the Undertow's dark eye and
the Hunger's gullet. They drift toward the nearest live projectile within
`2.5r`, or toward the tower otherwise, eased at about 6/s. During a wind-up
they lock onto the tower and narrow. The scan costs one pass over
`run.projectiles` per frame for one boss, so `paintBoss` needs the
projectiles (or a precomputed target point) as input. Under reduced motion the
pupils stay centred.

**Not recommended:** a Bomber fuse or eyes on regular enemies. Too many bodies
pay, for too little.

## 8. Build order

One commit per step, each with typecheck, its tests, `impact` before editing
and `detect_changes()` before committing.

| Step | What | Done when |
|---|---|---|
| 0 | Groundwork: `motion.ts` with tests, `QualityProfile.motion`, the `setMotion` wiring, the track map, `reset`, the bench `motion` override | Nothing visible changes. `motion: 'off'` matches today exactly. |
| 1 | Gait styles (6) plus squash (1) plus easing plus crowd damping. `GAIT` gets `style`. Overlays follow the offset. The flash becomes an ellipse. | Every type moves in its style. `low` shows offsets only. Reduced motion looks as it does today. |
| 2 | Hit squish (2) | A beam on a body pulses and never sticks. Damped at 300 bodies. |
| 3 | Pops (3): from `rise` everywhere, from time on `'full'` | Splitter fragments, imps, surfacing Burrowers, landing Blinkers and risen shades pop. Resuming a save does not pop the field. |
| 4 | `BossAnimator` plus poses (7), with the pose threaded through `paintBoss` and `paintFacets` | Each pose from §6.3 shows, per boss, and the reduced-motion column holds. |
| 5 | Boss parts (8): 8c, then 8a, then 8b. 8c can ship alone. | The tells read clearly in a fight with each of the 9 bosses. |
| 6 | Docs: `render.md` (painters table and a new "Motion" section with the §2 matrix), `ui.md` (reduced-motion bullet), `bosses.md` (poses and tells), `performance.md` (§10's numbers) | |
| 7 | **Performance check, then decide on option 5** (§10) | Numbers are recorded, and lean is shipped on the tiers that pass or dropped. |

Steps 1–3 touch `enemies.ts` and steps 4–5 touch `bosses.ts`. Once step 0 has
landed, the two tracks are independent and can run in parallel.

## 9. Tests

- **`tests/motion.test.ts`** (new, pure):
  - every `EnemyId` has a style (the `Record` makes this a type error too)
  - for each style and level, across a sweep of `t`: `sx·sy ∈ [0.9, 1.1]`,
    `|1 − sy| ≤` the clamp, and `|dx|, |dy| ≤ 3·bob`
  - `'reduced'`: `dx = 0`, `sx = sy = 1`, and `dy` equals today's
    `sin(time·freq + id)·bob` exactly while moving and 0 when still (D-1)
  - `'lite'`: `sx = sy = 1` from the gait
  - `popFromRise(1) = 1`, `popFromTime(t ≥ 0.22) = 1`, and both are continuous
  - hit re-arm: with `hitTick` changing every tick for 2 s, the squish returns
    to 0 between pulses and is never stuck at its peak
  - `crowdDamping(60) = 1`, `crowdDamping(300) = 0.5`
  - same inputs give the same outputs (no hidden state, no `Math.random`)
- **`tests/bossMotion.test.ts`** (new): event sequences (arrive, windup 1.2 s,
  slam, stagger, phase) give the expected pose, within the clamps. Under
  reduced motion, the result is identity except for the wind-up compression.
  The afterimage is 0 unless the tier is `high`.
- **`tests/renderer.test.ts`:** a paused run with bodies mid-squish still
  settles. The new state must never set `dirty`.
- **`tests/quality-detect.test.ts`:** the fixtures gain `motion`.
- Skip the sim and pacing runs: the change is cosmetic (see memory).
- **By eye, in the dev server:** one run per tier and with reduced motion on,
  at about 300 bodies (`tower.bench({ enemies: 300, seconds: 30 })` doubles as
  a stress view), plus one fight with each boss.

## 10. Performance check, then decide on option 5 (lean)

Run this last, once 1/2/3/6/7/8 have landed, so it measures the real frame.

### 10.1 The candidate code path (dev-only until it passes)

Behind the bench's `motion: 'lean'`:

- **Lean (5):** tilt up to ±6° toward the screen-x component of travel,
  `(x − px)` normalised by speed and eased through the track map.
- **Waddle rock:** waddle types swap their `dx` sway for a ±5° rock, which reads
  better.
- **Implementation:** read `ctx.getTransform()` **once per frame**. Per body,
  compose `world × translate × rotate × scale` by hand (six multiplies) into
  `ctx.setTransform(a, b, c, d, e, f)`, then `drawImage` at the origin. Restore
  the world matrix once at the end. Never `save()` or `restore()` per body.
- **Overlays** stay unrotated.

### 10.2 What to measure

Run each case 3 times, 8 s each, at 300 bodies:
`await tower.bench({ enemies: 300, seconds: 8, tier, motion })`.

| | `off` (today) | `base` (1/2/3/6) | `lean` (base + 5) |
|---|---|---|---|
| high | | | |
| medium | | | |
| low | | | |

For each cell, record `p50`, `p95`, `drawP50` and `drawP95`. Run the table on:

1. **Desktop Chromium** with DevTools CPU throttling at 4×. It's the quick
   proxy.
2. **A real mid-range Android phone** in the app's WebView, through
   `chrome://inspect` → the `tower` console. This one decides, and it also
   closes the open phone check in docs/performance.md.
3. **A 2-minute soak with quality on `auto`** at 300 bodies, `motion: 'lean'`,
   on the phone. Record whether the scaler demotes. A demotion that doesn't
   happen with `base` is a fail.

### 10.3 Pass rules

- **`base` must pass first:** at most +0.15 ms `drawP95` over `off` on `low`
  on the phone, and frame `p95` unchanged within noise (±0.3 ms). If it fails,
  tune before deciding on lean, because something in 1/2/3/6 isn't free. Suspects:
  the track map, the flash ellipse, `getTransform`.
- **Lean ships on a tier** only if it adds at most +0.3 ms `drawP95` over `base`
  on that tier on the phone, frame `p95` stays unchanged, and the soak doesn't
  demote.
- **Never on `low`** (§2), and never under reduced motion.
- **The look must pass too:** at ±6°, a lit floor shows no visible mismatch
  between a body's baked highlight and the scene's light. If it does, cap the
  tilt at ±4° or drop lean.
- Record the table and the verdict in docs/performance.md under a new
  "Measured" entry. Then either promote the `lean` path out of dev on the tiers
  that passed (D-5) or delete it.

## 11. Files

| File | Change |
|---|---|
| `src/render/motion.ts` | **new**: curves, `MOTION`, `MotionLevel` |
| `src/render/bossMotion.ts` | **new**: `BossAnimator`, `BOSS_MOTION`, `BossPose` |
| `src/render/painters/enemies.ts` | `GAIT.style`, the track map, `setMotion`, `reset`, the new draw rectangle, the flash ellipse, (lean path) |
| `src/render/painters/bosses.ts` | `pose` in `paintBoss` and `paintFacets`; `tell` and `lag` in `paintDetail` and `PROFILE`; gaze; court offsets |
| `src/render/renderer.ts` | owns `BossAnimator`; forwards events in `consume`; level wiring in `setQuality` and `setMotion`; `reset` in `attach` |
| `src/render/quality.ts` | `QualityProfile.motion` |
| `src/app/bench.ts` | `BenchOptions.motion` |
| `tests/motion.test.ts`, `tests/bossMotion.test.ts` | **new** |
| `tests/renderer.test.ts`, `tests/quality-detect.test.ts` | extended |
| `docs/render.md`, `docs/ui.md`, `docs/bosses.md`, `docs/performance.md` | as in step 6 |

Nothing under `src/sim/`, `src/content/` (except reading `ENEMY_BY_ID`) or the
save format changes.

## 12. Open

- **Contact attacks:** a lunge when a body hits the wall (`inContact` and
  `attackTimer`) would be the next most readable animation. It isn't in 1/2/3/6.
  If wanted, it's a small follow-up on the same track map.
- **Option 8 on other enemies (D-4, deferred):** the owner will revisit it
  later. The candidates are bodies that are rare on screen: a stratum's Keeper
  (exactly one per floor) and overtime Champions. The cheapest first step is
  the 8b gaze glint, one small extra arc per body. Measure it with the §10
  bench before adding it.
- **Lean on `medium` but not `high`?** That can't happen by construction: `high`
  costs more. If the bench shows it anyway, trust the bench.
