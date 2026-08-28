# Homing rework: seekers that hunt the nearest enemy without eating the spread

**Status:** plan, not yet implemented.

**Goal:** three complaints, one mechanism.

1. A homing shot chases the volley's locked target instead of **the nearest
   enemy**, and once it has pierced something it keeps chasing the body it can
   no longer hit.
2. It steers too hard — it snaps onto the target almost immediately.
3. With **Scatter Shot** (`ap_scatter_shots`) or **Rear Guard**
   (`ap_back_shots`) drafted, every lane converges onto the same point within a
   few frames, so both perks collapse into **Twin Arrows** (`ap_extra_shots`).

Plus: homing must also apply to a **manually aimed (clicked) shot**, which today
is excluded outright (`Game.ts:4684`).

The fix is one idea: **a homing projectile owns its own targeting.** The volley's
target is only its launch heading. After a short straight-flight delay it hunts
the nearest targetable enemy *in the cone it is already flying into*, re-hunts
when that enemy dies or gets pierced, and eases into its turn instead of
snapping. Spread lanes get a longer delay and a launch speed boost, so they are
already far apart — and pointing at different parts of the field — by the time
they start steering.

Everything is inside `ProjectileManager`, plus a constants block, three call
sites in `Game`, and the `Projectile` type.

---

## 0. What exists today

Read these before touching anything.

| Where | What it does now |
|---|---|
| `src/systems/ProjectileManager.ts:219-275` (`fire`) | Sets `homingTargetId = opts.targetId`, `turnRate = opts.turnRate ?? Math.PI * 3`, `lifetime = opts.lifetime ?? 3`, all only when `opts.isHoming`. Every variant launches at exactly `PROJECTILE_SPEED`. |
| `src/systems/ProjectileManager.ts:297-319` (`tick`) | If `homingTargetId !== undefined && turnRate !== undefined`: `enemies.list.find(...)` by id, then rotate the velocity toward it by up to `turnRate * dt`. No re-acquisition, ever. Never runs without an id. |
| `src/game/Game.ts:4681-4684` | `const homing = target !== null && this.blessingMgr.has('homing');` — a clicked (manual-aim) volley passes `target === null`, so it never homes. |
| `src/game/Game.ts:2716-2736` (`fireChargedShot`) | Never homes. |
| `src/systems/AbilityManager.ts:764-776` | Rocket Barrage passes `isHoming: true, turnRate: Math.PI * 3, lifetime: 3` **explicitly**. Those explicit values must keep working — `tests/abilities.test.ts:327-329` asserts them. |
| `src/data/tower.ts:54` | `PROJECTILE_SPEED = world(720)` = **1872** world units/s. |
| `src/data/arena.ts` | `WORLD_SCALE = 2.6`; `ARENA.minHalfExtent = world(360)` = **936**; range caps at **655**. So a shot crosses half the short axis in **0.5 s** — every duration below is sized against that. |

Two invariants the current code relies on and this plan keeps:

- `turnRate` is set **only** for homing shots, so `p.turnRate !== undefined` is a
  sound "is this a seeker" test. (Today the gate also requires `homingTargetId`;
  that requirement is exactly what blocks a targetless seeker, and it goes.)
- `MAX_PROJECTILE_AGE` (4 s) retires anything that circles forever. Do not
  weaken it — the new fallbacks lean on it.

---

## 1. Part A — the tuning block

### A.1 `src/data/tower.ts`, immediately after `PROJECTILE_SPEED` (line 54)

```ts
/**
 * Seeker steering (`plans/homing.md`).
 *
 * A homing shot owns its own targeting: the volley's target is only its launch
 * heading, and from there it hunts the nearest enemy it is already flying at.
 * Three of these numbers exist purely so that Scatter Shot and Rear Guard stay
 * *different perks* while Seeker Shots is drafted — `spreadDelay`,
 * `spreadLaunchBoost` and `acquireCone` are what stop every lane from folding
 * onto the same enemy within three frames and turning both perks into Twin
 * Arrows.
 *
 * Sizing note: at `PROJECTILE_SPEED` (1872 u/s) a shot crosses half the arena's
 * short axis in 0.5 s, so every duration here is a fraction of a *quarter* of a
 * flight, not of a flight.
 */
export const HOMING = {
  /**
   * Default steering rate, rad/s. Was `Math.PI * 3` (9.42) — deliberately only
   * ~27% slower, not halved: the ask was "a bit slower, but not by much".
   */
  turnRate: Math.PI * 2.2,
  /** Seconds over which the turn eases from 0 to `turnRate` once steering starts. */
  ramp: 0.28,
  /** Extra straight-flight seconds a *fully spread* lane gets before steering. */
  spreadDelay: 0.16,
  /** Launch speed multiplier of a fully spread lane. */
  spreadLaunchBoost: 1.55,
  /** `|angleOffset|` at which a lane counts as fully spread, in radians (45°). */
  spreadFullAngle: Math.PI / 4,
  /** Time constant for the launch boost bleeding back to `PROJECTILE_SPEED`. */
  speedSettle: 0.30,
  /** Radius searched for a target, world units (two thirds of the short axis). */
  seekRadius: world(620),
  /** Half-angle of the acquisition cone around the current heading (75°). */
  acquireCone: (75 * Math.PI) / 180,
  /** Seconds between opportunistic re-scans while the current target is fine. */
  retargetInterval: 0.12,
  /**
   * How much closer a rival must be to steal a *still-valid* target: squared
   * distance below `switchMargin²` of the current one. Pure hysteresis — without
   * it a shot flying between two enemies dithers and hits neither.
   */
  switchMargin: 0.75,
  /** Straight-flight seconds for a clicked (manual-aim) volley. */
  manualDelay: 0.10,
  /** Straight-flight seconds for the charged shot. */
  chargedDelay: 0.20,
  /** The charged shot steers at this fraction of `turnRate` — it stays a skill shot. */
  chargedTurnScale: 0.6,
} as const;
```

`world` is already imported in `src/data/tower.ts` (line 2).

**Why these numbers.** `spreadDelay` 0.16 s at the boosted 2902 u/s is ~460
world units of straight flight for a fully spread lane — half the arena's short
half-extent, which at a 45° scatter angle is ~325 units of lateral separation
before the lane so much as looks for a target. That is the whole fix for
complaint 3.

---

## 2. Part B — `Projectile` gains four fields

### B.1 `src/types.ts:274-300`

Add to `interface Projectile`, next to the existing homing fields:

```ts
  // Homing (optional — present for homing projectiles)
  homingTargetId?: number;
  turnRate?: number;
  lifetime?: number;
  /**
   * Seconds of straight launch-heading flight before steering (and target
   * seeking) begins. Spread lanes carry a larger one; see `HOMING`.
   */
  homingDelay?: number;
  /**
   * Speed the launch boost decays back to once steering starts. Absent on a
   * shot that launched at the ordinary `PROJECTILE_SPEED`.
   */
  cruiseSpeed?: number;
  /** Countdown, in seconds, to this shot's next target re-scan. */
  retargetIn?: number;
  age?: number;
```

### B.2 `src/types.ts:371-377` — delete `HomingProjectile`

```ts
// Homing Projectile (extends Projectile)
export interface HomingProjectile extends Projectile { ... }
```

`grep -rn "HomingProjectile" src tests sim` returns **only its own definition**.
It is dead, and after this change it is also wrong (a seeker routinely has no
`homingTargetId`). Delete the interface and its comment. If you would rather not
delete a public type in this commit, at minimum make `homingTargetId` optional
there — but deleting is the honest option.

---

## 3. Part C — `ProjectileManager`

All of Part C is in `src/systems/ProjectileManager.ts`.

### C.1 Imports

```ts
import { HOMING, PROJECTILE_SPEED } from '../data/tower';
```

### C.2 New manager state

Next to `hitEnemies` (line 99):

```ts
  /**
   * The enemy each homing shot is currently steering at, by projectile id.
   *
   * A *reference*, not an id, and that is the point: steering needs the
   * target's live position every step, and resolving an id against
   * `enemies.list` every step would be an O(enemies) scan per seeker per tick.
   * With the reference cached, the per-step cost is two field reads and the
   * O(enemies-in-radius) re-scan only runs on `HOMING.retargetInterval` or when
   * the target stops being valid. Cleaned up in exactly the three places
   * `hitEnemies` is.
   */
  private homingTargets: Record<number, Enemy> = {};
  /**
   * Scratch buffer for `seekNearest`'s radius query. Safe to share — unlike
   * every other `queryRadius` caller in this file, the seek does not damage
   * anything, so no handler can re-enter and refill the buffer mid-loop.
   */
  private readonly seekScratch: Enemy[] = [];
```

### C.3 `fire` — spread delay and launch boost

Replace the body of the variant loop (lines 237-272). The changes are: a
`spreadOf` helper, a per-variant `delay` / `launchSpeed`, and four extra fields
on the projectile.

Above the loop (after `const created: Projectile[] = [];`, line 235):

```ts
    /**
     * How "spread" a lane is, 0..1, from its angle off the volley heading.
     *
     * Twin Arrows (parallel lanes, `angleOffset` 0) scores 0 and keeps today's
     * instant-seek behaviour — that perk *is* the tight one. Scatter Shot
     * (30-75°) and Rear Guard (180°) score high and get the delay and the
     * launch boost, which is what keeps the three perks distinct once Seeker
     * Shots is drafted. Relentless's ±0.18 rad lanes score ~0.23, i.e. nearly
     * nothing, which is correct — they are a burst, not a spread.
     */
    const spreadOf = (angleOffset: number): number => {
      let a = Math.abs(angleOffset) % (Math.PI * 2);
      if (a > Math.PI) a = Math.PI * 2 - a;
      return Math.min(1, a / HOMING.spreadFullAngle);
    };
```

Inside the loop, replacing lines 238-262:

```ts
      const a = baseAngle + (v.angleOffset ?? 0);
      // Spread lanes launch *fast and straight*, then settle. Only homing shots
      // are boosted: without the steering that follows it, a faster scatter
      // lane would be a silent, unpriced buff to a perk this plan is not
      // rebalancing.
      const spread = opts.isHoming ? spreadOf(v.angleOffset ?? 0) : 0;
      const delay = opts.isHoming
        ? (opts.homingDelay ?? 0) + HOMING.spreadDelay * spread
        : 0;
      const launchSpeed = PROJECTILE_SPEED
        * (1 + (HOMING.spreadLaunchBoost - 1) * spread);
      const vx = Math.cos(a) * launchSpeed;
      const vy = Math.sin(a) * launchSpeed;
      const ox = v.posOffsetX ?? 0;
      const oy = v.posOffsetY ?? 0;

      const proj: Projectile = {
        id: nextId(),
        x: towerState.x + ox * cosA - oy * sinA,
        y: towerState.y + ox * sinA + oy * cosA,
        targetId: opts.targetId,
        vx,
        vy,
        damage: scaled * Math.max(0, v.damageScale ?? 1),
        damageType: opts.damageType,
        isCrit: opts.isCrit,
        alive: true,
        // A delayed lane launches *untargeted* on purpose: it acquires from
        // wherever it has got to when the delay expires, which is how two
        // scatter lanes end up on two different enemies.
        homingTargetId: opts.isHoming && delay <= 0 ? opts.targetId ?? undefined : undefined,
        turnRate: opts.isHoming ? (opts.turnRate ?? HOMING.turnRate) : undefined,
        lifetime: opts.isHoming ? (opts.lifetime ?? 3) : undefined,
        homingDelay: opts.isHoming && delay > 0 ? delay : undefined,
        cruiseSpeed: opts.isHoming && launchSpeed > PROJECTILE_SPEED ? PROJECTILE_SPEED : undefined,
        // Zero, not `retargetInterval`: the first steering step re-scans, so a
        // shot fired at a locked target that is *not* the nearest one corrects
        // as soon as it starts steering rather than 0.12 s later.
        retargetIn: opts.isHoming ? 0 : undefined,
        age: 0,
        splashRadius: opts.splashRadius,
        splashFraction: opts.splashFraction,
        visual: opts.visual,
      };
```

Note `baseVx` / `baseVy` (lines 225-226) are only used to derive `baseAngle`;
leave them at `PROJECTILE_SPEED`.

### C.4 `FireOptions` — one new field (line 63-86)

```ts
  isHoming?: boolean;
  turnRate?: number;
  /**
   * Straight-flight seconds every lane of this volley gets before it starts
   * seeking, on top of whatever its own spread angle earns it. Set by the
   * manual-aim and charged-shot paths so a clicked shot visibly goes where the
   * player pointed before it hunts. Ignored unless `isHoming`.
   */
  homingDelay?: number;
  lifetime?: number;
```

### C.5 `tick` — replace the homing block (lines 297-319)

```ts
      // ── Homing (plans/homing.md) ──
      // `turnRate` alone is the gate now: `fire` sets it only for homing shots,
      // and a seeker may legitimately have no target yet (a clicked volley, or
      // a spread lane still inside its launch delay).
      if (p.turnRate !== undefined) {
        if (p.lifetime !== undefined && age >= p.lifetime) {
          p.alive = false;
          continue;
        }
        this.steerHoming(p, age, dt);
      }
```

### C.6 Three new private methods

Put them just after `pierceMax` (line 217), before `fire`.

```ts
  /**
   * One steering step for a homing shot.
   *
   * Three things happen, in this order, and each is one of the three
   * complaints in `plans/homing.md`:
   *
   * 1. **Straight-flight delay.** For `homingDelay` seconds the shot keeps its
   *    launch heading at its launch speed. This is what keeps Scatter Shot and
   *    Rear Guard from collapsing into Twin Arrows the moment Seeker Shots is
   *    drafted, and what makes a clicked shot go where it was pointed.
   * 2. **Its own target**, picked from its own position — never the volley's
   *    lock, never a body it has already pierced.
   * 3. **A ramped turn**, easing from 0 to `turnRate` over `HOMING.ramp`, with
   *    the launch boost bleeding back to cruise on the same clock.
   */
  private steerHoming(p: Projectile, age: number, dt: number): void {
    const delay = p.homingDelay ?? 0;
    if (age < delay) return;

    // The boost only bleeds off *after* the delay — burst out straight, then
    // settle into the hunt.
    const cruise = p.cruiseSpeed ?? PROJECTILE_SPEED;
    let speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (speed > cruise) {
      speed = cruise + (speed - cruise) * Math.exp(-dt / HOMING.speedSettle);
    }

    let angle = Math.atan2(p.vy, p.vx);
    const target = this.homingTarget(p, dt);
    if (target) {
      const desired = Math.atan2(target.y - p.y, target.x - p.x);
      let diff = desired - angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const ease = HOMING.ramp > 0 ? Math.min(1, (age - delay) / HOMING.ramp) : 1;
      const rate = p.turnRate ?? HOMING.turnRate;
      const maxTurn = rate * ease * dt;
      angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
    }
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
  }

  /**
   * The enemy this shot should be steering at, re-acquiring when it must.
   *
   * A target is dropped when it dies, becomes un-targetable, **or has already
   * been pierced by this same shot** — `hitEnemies` bars a second hit, so
   * chasing it would just orbit a body until `MAX_PROJECTILE_AGE`. That last
   * clause is the "gets a new target after it passes through an enemy" half of
   * the ask. Where the ask says "or the same if no other", this keeps flying
   * *straight* instead: re-locking a body it can no longer hit produces a
   * corkscrew that hits nothing, whereas straight flight can still stumble into
   * something new before the lifetime cap.
   */
  private homingTarget(p: Projectile, dt: number): Enemy | null {
    const hitSet = this.hitEnemies[p.id];
    let current: Enemy | null = this.homingTargets[p.id] ?? null;

    // First steering step of a shot that launched with a volley target: resolve
    // the id once, then hold the reference. Clearing the id on a failed resolve
    // is what stops this scan repeating every tick for a target that is gone.
    if (!current && p.homingTargetId !== undefined) {
      current = this.enemies.list.find(e => e.id === p.homingTargetId) ?? null;
      if (current) this.homingTargets[p.id] = current;
      else p.homingTargetId = undefined;
    }
    if (current && (!isTargetable(current) || (hitSet !== undefined && hitSet.has(current.id)))) {
      current = null;
      delete this.homingTargets[p.id];
      p.homingTargetId = undefined;
    }

    const remaining = (p.retargetIn ?? 0) - dt;
    if (current && remaining > 0) {
      p.retargetIn = remaining;
      return current;
    }
    p.retargetIn = HOMING.retargetInterval;

    const found = this.seekNearest(p, hitSet);
    if (!current) {
      if (found) {
        this.homingTargets[p.id] = found;
        p.homingTargetId = found.id;
      }
      return found;
    }
    if (found && found.id !== current.id) {
      const cdx = current.x - p.x;
      const cdy = current.y - p.y;
      const fdx = found.x - p.x;
      const fdy = found.y - p.y;
      const margin = HOMING.switchMargin * HOMING.switchMargin;
      if (fdx * fdx + fdy * fdy < (cdx * cdx + cdy * cdy) * margin) {
        this.homingTargets[p.id] = found;
        p.homingTargetId = found.id;
        return found;
      }
    }
    return current;
  }

  /**
   * The nearest enemy this shot could still hit, preferring the cone ahead.
   *
   * The cone is what stops a Rear Guard or Scatter lane from U-turning into
   * whatever the front lane is already shooting the instant its delay expires:
   * a lane adopts something it is broadly already flying at, and only falls
   * back to "nearest anywhere" when its cone is empty. Bodies this shot has
   * already pierced are never candidates.
   */
  private seekNearest(p: Projectile, hitSet: Set<number> | undefined): Enemy | null {
    const heading = Math.atan2(p.vy, p.vx);
    const found = this.enemies.queryRadius(p.x, p.y, HOMING.seekRadius, this.seekScratch);
    let inCone: Enemy | null = null;
    let inConeD = Infinity;
    let anywhere: Enemy | null = null;
    let anywhereD = Infinity;
    for (const e of found) {
      if (!isTargetable(e)) continue;
      if (hitSet !== undefined && hitSet.has(e.id)) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < anywhereD) {
        anywhere = e;
        anywhereD = d2;
      }
      let diff = Math.atan2(dy, dx) - heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) <= HOMING.acquireCone && d2 < inConeD) {
        inCone = e;
        inConeD = d2;
      }
    }
    return inCone ?? anywhere;
  }
```

### C.7 Clean up `homingTargets` in all three retirement paths

A leak here is a retained `Enemy` per dead projectile, so all three matter.

1. **On impact with pierce exhausted** (line 474-478):

```ts
        } else {
          p.alive = false;
          delete this.piercingRemaining[p.id];
          delete this.hitEnemies[p.id];
          delete this.homingTargets[p.id];
        }
```

2. **In the cull filter** (lines 485-492):

```ts
    this.projectiles = this.projectiles.filter(p => {
      if (!p.alive || p.x < -margin || p.x > maxX || p.y < -margin || p.y > maxY) {
        delete this.hitEnemies[p.id];
        delete this.piercingRemaining[p.id];
        delete this.homingTargets[p.id];
        return false;
      }
      return true;
    });
```

3. **In `reset`** (lines 643-649):

```ts
  reset(): void {
    this.projectiles = [];
    this.piercingRemaining = {};
    this.hitEnemies = {};
    this.homingTargets = {};
    this.focusTargetId = -1;
    this.focusStacks = 0;
  }
```

---

## 4. Part D — the three `Game` call sites

All in `src/game/Game.ts`. Add `HOMING` to the existing `../data/tower` import.

### D.1 Homing no longer requires an auto-acquired target (lines 4681-4684)

```ts
        // Blessing: Seeker Shots — the shot does its own targeting now, so a
        // clicked volley homes too: the cursor sets the launch heading,
        // `HOMING.manualDelay` holds it long enough to read as "it went where I
        // pointed", and then the shot hunts the nearest enemy from wherever it
        // has got to. `target` is null while the mouse is down, which is
        // exactly the case that used to be excluded here.
        const homing = this.blessingMgr.has('homing');
```

### D.2 Pass the manual delay (line 4692-4693)

```ts
        const blessingShot = {
          isHoming: homing,
          homingDelay: this.mouseDown ? HOMING.manualDelay : 0,
```

`blessingShot` is spread into all three `fire` calls in the block (the main
shot, the Killing Spree follow-up at ~4758, the double-shot at ~4771), so all
three pick this up with no further edits.

### D.3 The charged shot homes too (`fireChargedShot`, lines 2716-2736)

```ts
  private fireChargedShot(): void {
    const ts = this.tower.snapshot;
    const shot = this.tower.rollShot();
    const damage = shot.damage * ts.fireRate * MANUAL_AIM.chargeDpsSeconds;
    this.projectileMgr.fire(null, ts, {
      rawDamage: damage,
      damageType: ts.damageType,
      isCrit: shot.isCrit,
      targetId: null,
      aimX: this.mouseX,
      aimY: this.mouseY,
      extraPierce: MANUAL_AIM.chargeExtraPierce,
      splashRadius: MANUAL_AIM.chargeSplashRadius,
      splashFraction: MANUAL_AIM.chargeSplashFraction,
      // Seeker Shots applies to the charged shot as well, but weakly on
      // purpose: a long straight lead-out and 60% of the turn rate, so the
      // pierce line the player aimed still goes where they aimed it and the
      // homing only sweeps up what it passes near. Its extra pierce plus the
      // "never re-target a body I already went through" rule is what makes it
      // walk down a column instead of orbiting the first thing it hits.
      isHoming: this.blessingMgr.has('homing'),
      turnRate: HOMING.turnRate * HOMING.chargedTurnScale,
      homingDelay: HOMING.chargedDelay,
    });
```

(`turnRate` and `homingDelay` are ignored when `isHoming` is false, so no
conditional spread is needed.)

### D.4 Do **not** touch

- `Tower.acquireTarget` and the targeting-mode lock. Seeker Shots deliberately
  overrides the mode *for the flight* — that is the requested behaviour — but
  the tower still aims, still locks, and every non-homing build is unchanged.
- `AbilityManager.applyRocketBarrage`. Its explicit `turnRate: Math.PI * 3` and
  `lifetime: 3` are asserted by tests and keep working; rockets now also
  re-acquire when their target dies, which is a strict improvement and needs no
  code change there.
- `buildShotVariants`. The spread delay is derived from `angleOffset` inside
  `fire`, so no perk data has to know about homing.

---

## 5. Part E — tests

Add one `describe` block to `tests/projectiles.test.ts`. Its `harness()`
(lines 27-45) already gives a tower at `(100, 300)` with `range: 2000` and
`baseDamage: 1e9`; `projectiles.setBounds(1280, 720)` means the cull margin is
`world(120)` = 312, so shots survive out to x ≈ 1592. Speed is 1872 u/s, so
`tick(1/60)` moves ~31 units.

Add to the imports at the top of the file:

```ts
import { HOMING, PROJECTILE_SPEED } from '../src/data/tower';
```

(`PROJECTILE_SPEED` is already imported on line 18 — just add `HOMING`.)

```ts
describe('homing (plans/homing.md)', () => {
  const step = 1 / 60;
  const run = (projectiles: ProjectileManager, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / step); i++) projectiles.tick(step);
  };
  const beef = (...list: Array<{ hp: number; maxHp: number }>) => {
    for (const e of list) { e.hp = 1e12; e.maxHp = 1e12; }
  };

  it('defaults to a gentler turn than the old snap', () => {
    const { enemies, towerState, projectiles } = harness();
    const e = enemies.spawn('normal', 1, 400, 300);
    projectiles.fire(e, towerState, {
      rawDamage: 1, damageType: 'physical', isCrit: false, targetId: e.id, isHoming: true,
    });
    expect(projectiles.list[0].turnRate).toBe(HOMING.turnRate);
    expect(HOMING.turnRate).toBeLessThan(Math.PI * 3);
  });

  it('seeks the nearest enemy when the volley had no target at all', () => {
    const { enemies, towerState, projectiles } = harness();
    const e = enemies.spawn('normal', 1, 500, 400);
    beef(e);
    // Fired flat along y = 300 — a straight shot passes 100 units clear.
    projectiles.fire(null, towerState, {
      rawDamage: 1000, damageType: 'physical', isCrit: false, targetId: null,
      aimX: 1200, aimY: 300, isHoming: true,
    });
    run(projectiles, 1.5);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('leaves a non-homing shot dead straight (control for the case above)', () => {
    const { enemies, towerState, projectiles } = harness();
    const e = enemies.spawn('normal', 1, 500, 400);
    beef(e);
    projectiles.fire(null, towerState, {
      rawDamage: 1000, damageType: 'physical', isCrit: false, targetId: null,
      aimX: 1200, aimY: 300,
    });
    run(projectiles, 1.5);
    expect(e.hp).toBe(e.maxHp);
  });

  it('abandons the volley target for a much nearer enemy', () => {
    const { enemies, towerState, projectiles } = harness();
    const far = enemies.spawn('normal', 1, 1100, 300);
    const near = enemies.spawn('normal', 1, 400, 360);
    beef(far, near);
    projectiles.fire(far, towerState, {
      rawDamage: 1000, damageType: 'physical', isCrit: false, targetId: far.id, isHoming: true,
    });
    run(projectiles, 1.0);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBe(far.maxHp);
  });

  it('picks up a new target after piercing the first', () => {
    const { enemies, towerState, projectiles } = harness();
    const a = enemies.spawn('normal', 1, 400, 300);
    const b = enemies.spawn('normal', 1, 700, 460);
    beef(a, b);
    projectiles.fire(a, towerState, {
      rawDamage: 1000, damageType: 'physical', isCrit: false, targetId: a.id,
      isHoming: true, piercing: true,
    });
    run(projectiles, 2);
    expect(a.hp).toBeLessThan(a.maxHp);
    // `b` is well off the line through `a`; only a re-acquisition reaches it.
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('never re-locks the body it just pierced', () => {
    const { enemies, towerState, projectiles } = harness();
    const a = enemies.spawn('normal', 1, 400, 300);
    beef(a);
    projectiles.fire(a, towerState, {
      rawDamage: 1000, damageType: 'physical', isCrit: false, targetId: a.id,
      isHoming: true, piercing: true,
    });
    run(projectiles, 0.5);
    const p = projectiles.list[0];
    // Either it has retired or it is still flying, but it is not orbiting `a`.
    if (p) expect(p.homingTargetId).not.toBe(a.id);
  });

  it('keeps a scatter volley spread instead of merging it', () => {
    const { enemies, towerState, projectiles } = harness();
    enemies.spawn('normal', 1, 700, 300);
    projectiles.fire(null, towerState, {
      rawDamage: 1000, damageType: 'physical', isCrit: false, targetId: null,
      aimX: 1200, aimY: 300, isHoming: true,
      variants: [{ angleOffset: -0.7 }, { angleOffset: 0.7 }],
    });
    const [left, right] = projectiles.list;
    // Boosted out of the barrel...
    expect(Math.hypot(left.vx, left.vy)).toBeGreaterThan(PROJECTILE_SPEED * 1.3);
    run(projectiles, 0.1);
    // ...and still 1.4 rad apart a tenth of a second later. Before this plan
    // they were within a few hundredths of each other by now.
    const angle = (p: { vx: number; vy: number }) => Math.atan2(p.vy, p.vx);
    expect(Math.abs(angle(left) - angle(right))).toBeGreaterThan(1.2);
  });

  it('settles the launch boost back to cruise speed', () => {
    const { towerState, projectiles } = harness();
    // The harness' 1280x720 bounds are small next to 1872 u/s, so a full
    // settle does not fit inside them. Widen the field for this one case and
    // fire into empty space, down and to the right so nothing culls it.
    projectiles.setBounds(6000, 6000);
    projectiles.fire(null, towerState, {
      rawDamage: 1, damageType: 'physical', isCrit: false, targetId: null,
      aimX: 1200, aimY: 300, isHoming: true, lifetime: 3,
      variants: [{ angleOffset: 1.2 }],
    });
    const p = projectiles.list[0];
    expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(PROJECTILE_SPEED * 1.5);
    run(projectiles, 1.2);
    // ~1903 u/s at 1.2 s: the boost is spent, the shot is back at cruise.
    expect(Math.hypot(p.vx, p.vy)).toBeGreaterThanOrEqual(PROJECTILE_SPEED);
    expect(Math.hypot(p.vx, p.vy)).toBeLessThan(PROJECTILE_SPEED * 1.05);
  });

  it('does not U-turn a rear lane into the front target on frame one', () => {
    const { enemies, towerState, projectiles } = harness();
    enemies.spawn('normal', 1, 500, 300).hp = 1e12;
    projectiles.fire(null, towerState, {
      rawDamage: 1, damageType: 'physical', isCrit: false, targetId: null,
      aimX: 1200, aimY: 300, isHoming: true, variants: [{ angleOffset: Math.PI }],
    });
    run(projectiles, 0.1);
    const p = projectiles.list[0];
    expect(p.vx).toBeLessThan(0);
    expect(p.x).toBeLessThan(towerState.x);
  });

  it('retires a seeker that finds nothing', () => {
    const { towerState, projectiles } = harness();
    projectiles.fire(null, towerState, {
      rawDamage: 1, damageType: 'physical', isCrit: false, targetId: null,
      aimX: 120, aimY: 300, isHoming: true, lifetime: 1,
    });
    run(projectiles, 2);
    expect(projectiles.list).toHaveLength(0);
  });
});
```

### E.1 What a reference implementation of §1-§3 actually produces

Every case above was run through a standalone model of the exact math in C.3 and
C.6 (same constants, same `dt = 1/60`, same swept-collision test, Grunt radius
`entity(12)` = 20.4 plus `PROJECTILE_HIT_PAD` = 27). If your numbers differ
materially from these, the implementation has drifted from the plan:

| Case | Observed |
|---|---|
| No volley target, Grunt at (500, 400) | hits at **t = 0.217 s** |
| Volley target at (1100, 300), Grunt at (400, 360) | hits the **near** one at t = 0.15 s; the far one is never touched |
| Pierce through (400, 300) then Grunt at (700, 460) | hits at t = 0.15 s and **t = 0.333 s** |
| Two lanes at ±0.7 rad, 0.1 s in | still **exactly ±0.7** (delay is 0.143 s), launch speed **2790** |
| Rear lane (π), 0.1 s in | `vx = -2902`, `x = -190` — still going backwards |
| Full-spread lane, 1.2 s in, empty field | speed **1903** (1.017x cruise), 2692 units travelled |

### E.2 Existing tests to re-run and what to expect

- `tests/abilities.test.ts` "Rocket Barrage through tryCast" — asserts
  `turnRate === Math.PI * 3`, `lifetime === 3`, `homingTargetId` defined for
  live rockets and undefined for duds. All still hold: rockets pass those
  explicitly, and with `homingDelay` absent their `delay` is 0, so they keep the
  volley target at fire time.
- `tests/projectiles.test.ts` swept-collision and lifetime blocks fire
  **non-homing** shots, which take no new code path.
- `npm run test`, `npm run typecheck`, and `npm run checks` must all pass.
  `npm run sim` is not affected by any of this (see §6.3).

---

## 6. Part F — documentation and data text

### 6.1 `src/data/blessings.ts`

- Line 49, the behavior comment:
  `| 'homing'            // projectiles seek the nearest enemy, re-targeting on pierce`
- Line 73, `BLESSING_BEHAVIOR_CONSUMERS.homing`:
  `homing: 'Game.simulate / fireChargedShot → ProjectileManager.steerHoming'`
- Line 313, the card description: `'Projectiles curve toward their target'` →
  `'Projectiles seek the nearest enemy'`.
  `tests/content-coverage.test.ts` only checks these are non-empty, but re-run it.

### 6.2 `docs/`

- `docs/projectile-system.md` — add `homingDelay`, `cruiseSpeed`, `retargetIn`
  to the `Projectile` block, and add a **Homing** section between *Collision*
  and *Lifetime* covering: the delay → cone acquisition → ramped turn sequence,
  the pierce re-target rule, the hysteresis, and why spread lanes launch fast.
- `docs/blessing-system.md:191` — the table row currently reads
  `| \`homing\` | \`fire({ isHoming })\`, only for an auto-acquired target |`.
  Replace with `| \`homing\` | \`fire({ isHoming })\` on every volley, clicked or auto; the shot then seeks nearest |`.
- `docs/performance.md`, under *Projectile lifetime* — one paragraph: the seek
  re-scan is a spatial-grid query per **homing** projectile on a
  `HOMING.retargetInterval` (0.12 s) cadence into a shared scratch buffer, and
  between scans steering is two field reads off a cached `Enemy` reference. The
  old code did an O(enemies) `list.find` per homing projectile **per tick**, so
  this is cheaper than what it replaces even with seeking added.

### 6.3 `sim/model.ts:363` — leave it alone

`BEHAVIOR_DPS_CREDIT.homing` is `0.02`. Seeking does make the blessing better
(fewer misses on moving targets, pierce chains further), so `0.03` would be
defensible — but the model has no enemy positions, the credit is explicitly
"deliberately conservative", and moving one rare blessing by 1% of a shot's DPS
cannot move any band in `npm run sim`. Raise it only if the user asks.

---

## 7. Accepted consequences — do **not** try to compensate these

1. **Seeker Shots now overrides the targeting mode during flight.** A `priority`
   build's shot can end up in a nearby trash mob if that mob is much closer than
   the locked warden. That *is* the request ("it should steer towards the
   closest enemy"); the 0.75 hysteresis is what keeps it from being constant.
2. **Twin Arrows lanes still converge**, because their `angleOffset` is 0 and
   they earn no spread delay. That is deliberate — Twin Arrows is the tight
   perk, and Scatter/Rear are now the ones that fan out.
3. **A pierced-out seeker with no fresh target flies straight to the age cap**
   rather than re-locking the body it just went through, which is a small
   deviation from the letter of the ask; see the `homingTarget` doc comment.
4. **The charged shot behaves differently with the blessing drafted.** With a
   0.2 s lead-out and 60% turn rate it is still a directed line, but it will
   bend. If it feels wrong in play, `HOMING.chargedTurnScale` → 0 is the dial,
   or drop D.3 entirely — it is the one part of this plan that is separable.
5. **Rocket Barrage rockets re-target.** Rockets that outlive their target now
   pick a new one instead of flying on. Strictly better; no tuning change.

---

## 8. Commit plan

Three commits, each independently verifiable:

1. `Homing: seekers pick their own nearest target (homing plan Parts A-C)`
   — `src/data/tower.ts`, `src/types.ts`, `src/systems/ProjectileManager.ts`.
   Verified by the Part E tests plus the existing suite.
2. `Homing: clicked and charged shots seek too (homing plan Part D)`
   — `src/game/Game.ts`.
3. `Homing: spread lanes keep their spread, plus docs (homing plan Parts E-F)`
   — the tests, `src/data/blessings.ts` text, `docs/`.

Per `CLAUDE.md`: run `impact({target: "fire"})` and `impact({target: "tick"})`
scoped to `ProjectileManager` before editing them — both are high-fan-in — and
`detect_changes()` before each commit, confirming the affected symbols are only
the ones this plan names.
