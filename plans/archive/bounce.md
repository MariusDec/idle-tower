# Shot Bounce & Splinter — mechanics rework + VFX

> **Status:** plan only. Nothing in this document has been implemented.
> **Scope:** the `ricochet` / `ricochet_power` blessings (bounce) and the
> `split_on_kill` blessing (Splinter). Both become **real projectiles** instead
> of invisible instant damage, both get a bigger search radius, and both get
> dedicated visual + audio feedback.

---

## 0. TL;DR of every behavioural change

| Thing | Today | After this plan |
|---|---|---|
| Ricochet bounce | Instant, invisible damage to the nearest other enemy within **200 world units** | The **actual projectile** is redirected at the new target, becomes a seeker, and flies there |
| Bounce range | `200` (raw, **not** world-scaled → ~21% of the arena's short half-extent) | `world(300)` = **780**, ×1.35 with `ricochet_power` = **1053** |
| Bounce damage | 30% / 60% of the landed hit, applied instantly | 45% / 85% of the projectile's carried damage, **compounding per hop**, resolved through the normal impact pipeline |
| Bounce vs pierce | Both fire on every hit, independently | **Sequential budgets**: pierce is spent first (pass straight through), a bounce is what happens *instead of the shot dying* |
| Bounce VFX | **None at all** | Deflection flash + directed spark fan + a bounce halo on the projectile + a `ricochet` sound |
| Splinter | Instant direct damage to 2 enemies within **220 units**, bypassing resists *and* all damage multipliers | 2 **homing shard projectiles** fired from the corpse, within `world(280)` = **728**, through the normal damage pipeline |
| Splinter damage | `baseDamage × 0.125` (card says 15%, code comment says 40% — all three disagree) | `baseDamage × 0.25`, card text corrected to match |
| Splinter VFX | 4 frost sparks *at each victim* | A gold/white starburst at the corpse + visible shard projectiles with their own sprite + a `shards_split` sound |

---

## 1. How it works today (read this before editing anything)

### 1.1 Bounce — `ricochet`

`src/systems/ProjectileManager.ts:646-648`, inside the impact block of `tick`:

```ts
if (this.blessings.has('ricochet')) {
  this.applyRicochet(enemy, final);
}
```

`applyRicochet` (`src/systems/ProjectileManager.ts:754-779`) walks 1 hop (or 2
with `ricochet_power`), each hop calling `nearestOthers(...)` and then
`this.enemies.damage(next, dmg, false)` directly. There is **no projectile
motion, no event, and no visual**. `BLESSING_TUNING.ricochetRange` is `200`
(`src/data/blessings.ts:140`).

### 1.2 Splinter — `split_on_kill`

Triggered from `Game`'s `enemy_killed` handler (`src/game/Game.ts:1142`):

```ts
if (this.blessingMgr.has('split_on_kill')) this.fireSplitShards(e.x, e.y);
```

`Game.fireSplitShards` (`src/game/Game.ts:5079-5098`) queries a radius, takes
the first 2 enemies **in grid order** (not nearest — `.slice(0, 2)` after
`queryRadius`), emits 4 frost sparks on each and calls
`this.enemyMgr.damage(target, damage, false)`. The damage is
`floor(ts.baseDamage × 0.125)` — it never passes through
`Tower.applyResists`, so armour and magic resist are ignored, and it never
passes through `ProjectileManager.setDamageMultipliers`.

`Game.splitOnKillActive` (`src/game/Game.ts:764`) is a reentrancy guard,
because `EnemyManager.damage` emits `enemy_killed` synchronously.

### 1.3 Pierce (what "pass-through shots" means here)

`ProjectileManager.pierceMax(id)` (`:242-245`) returns
`piercingRemaining[id]`, or `1 + pierceExtra` if there is no record yet. At the
bottom of the impact block (`:661-672`):

```ts
const blocked = enemy.type === 'tank';
const remaining = blocked ? 1 : this.pierceMax(p.id);
if (remaining > 1) {
  this.piercingRemaining[p.id] = remaining - 1;
  if (!this.hitEnemies[p.id]) this.hitEnemies[p.id] = new Set();
  this.hitEnemies[p.id].add(enemy.id);
} else {
  p.alive = false;
  delete this.piercingRemaining[p.id];
  delete this.hitEnemies[p.id];
  delete this.homingTargets[p.id];
}
```

`hitEnemies[p.id]` is the set of bodies this shot may never hit again; the
collision scan at `:520-542` skips them, and `seekNearest` (`:359-385`) refuses
to steer at them.

### 1.4 The renderer only sees impacts by *disappearance*

`Renderer.advanceImpacts` (`src/game/Renderer.ts:949-987`) decides "this shot
hit something" by noticing that a projectile id that was in last frame's
snapshot is gone from this frame's. **A bounced projectile does not
disappear**, so it will produce no decal and no spark cone at the bounce point.
This is exactly why §5 adds a dedicated bounce effect — do not try to make
`advanceImpacts` detect bounces.

---

## 2. Problems this plan fixes

1. **Bounce range is not world-scaled.** Every other radius in
   `BLESSING_TUNING` that is a world distance uses `world(...)`
   (`mortarRadius: world(90)` = 234). `ricochetRange: 200` and
   `splitShardRange: 220` are raw legacy numbers, so after the `WORLD_SCALE`
   zoom-out they cover ~40% of the ground they were designed for.
2. **A bounce is invisible.** The card promises "Shots bounce"; nothing on
   screen bounces.
3. **Bounce and pierce are unrelated systems that both fire on the same hit**,
   so a high-pierce shot silently ricochets off every body it passes through.
4. **Splinter's three numbers disagree**: card says 15%, `BLESSING_TUNING`
   says 12.5%, the `BlessingBehavior` comment
   (`src/data/blessings.ts:48`) says 40%.
5. **Splinter does not scale.** It reads `ts.baseDamage` and bypasses the
   `ProjectileManager` damage multipliers, so it is a fixed fraction of a
   single stat while everything else in the game compounds.
6. **Splinter picks arbitrary targets** — `queryRadius(...).slice(0, 2)` is
   grid-bucket order, not nearest.

---

## 3. Design

### 3.1 The bounce rule, in one sentence

> **Pierce is spent first; a bounce is what happens instead of the shot dying.**

Per impact, in this order:

1. Damage resolves exactly as it does today (nothing in the damage pipeline
   changes).
2. If the shot has **pierce left** (`remaining > 1`) and was not tank-blocked
   → it passes straight through, unchanged. **No bounce.**
3. Otherwise, if it has **bounce budget left** and a legal target exists → it
   **bounces**: it is repositioned to the impact point, re-aimed at the new
   target, has its damage scaled down, and becomes a **seeker** for the rest of
   its life.
4. Otherwise it dies, as today.

Consequences to be aware of (these are intended):

* A tank body-block ends the pierce budget *and* the shot may still bounce off
  it. Thematically the shot deflects off the armour; mechanically the tank still
  stops the line, which is its job.
* A bounce **spends the remaining pierce budget** (`piercingRemaining[p.id]` is
  forced to `1`). Without this, a tank-blocked shot with pierce would bounce and
  then get its unspent pierce back, which is a loophole.
* A bounced shot can bounce again while budget remains; damage compounds
  (0.45 → 0.2025 at hop 2).
* A bounce can now **miss** (the target dies mid-flight and no other target is
  in seek range, or lifetime expires). That is why the damage fractions go up.
* Splinter shards (§3.3) **never** bounce.

### 3.2 "Becomes a seeker" — why

A straight-line bounce at 1872 u/s against an enemy 780 units away needs
0.42 s of flight; a 90 u/s enemy walks ~38 units in that time, which is roughly
one hitbox radius. Half of all bounces would visibly miss. Giving the bounced
shot `turnRate` makes it track, and reuses `steerHoming` /
`homingTarget` / `seekNearest` verbatim — no new steering code.

### 3.3 Splinter becomes real shards

Two homing shard projectiles are launched **from the corpse**, on a fanned
heading (so they visibly scatter out of the body before curving in), aimed at
the two nearest legal enemies. They:

* carry `splitGen: 1`, which makes them ineligible to bounce and marks their
  kills as "do not splinter again";
* have `piercingRemaining` forced to `1` (a shard never pierces, whatever the
  tower's pierce is);
* go through `fire`'s damage multipliers and the impact path's resists, so
  Splinter finally scales with the run.

Reentrancy is now handled by a generation flag rather than a boolean latch:
`ProjectileManager.shardImpactInProgress` is true only while a `splitGen`
projectile's impact is being resolved, and `Game`'s kill handler consults it.
The trigger stays in `enemy_killed`, so **any** kill source (abilities, DoT,
shockwaves) still splinters — only a shard's own kill does not.

---

## 4. Code changes

Every change below is exact. Apply them in order.

### 4.1 `src/types.ts`

**(a)** Extend the visual union (line 274):

```ts
export type ProjectileVisual = 'default' | 'rocket' | 'shard';
```

Update the doc comment above it to:

```ts
/**
 * How a projectile draws itself. `'rocket'` opts into the Rocket Barrage
 * sprite set (hull + exhaust flame), `'shard'` into the Splinter sliver;
 * anything else renders as the core's bolt.
 */
```

**(b)** Add three fields to `interface Projectile`, immediately **after**
`visual?: ProjectileVisual;` (line 313) and before the closing `}`:

```ts
  /**
   * Bounces this shot has already made (Ricochet). Absent on a shot that has
   * never bounced, so the renderer's halo costs one `undefined` check.
   */
  bounces?: number;
  /**
   * Bounces still available. Resolved lazily on the first bounce attempt from
   * the live blessing state, so an ordinary shot carries nothing.
   */
  bouncesLeft?: number;
  /**
   * Splinter generation. `undefined` on a shot the tower fired, `1` on a shard
   * thrown by a kill. A shard may not bounce and its kills may not splinter,
   * which is what bounds the cascade.
   */
  splitGen?: number;
```

### 4.2 `src/data/tower.ts` — two new tuning blocks

Append these **after** the existing `HOMING` block (which ends at line 107).
`world` is already imported in this file (`PROJECTILE_SPEED = world(720)`).

```ts
/**
 * Ricochet deflection (`plans/bounce.md` §3.1).
 *
 * A bounce is not a new steering mode — it re-aims an existing projectile and
 * then hands it to `steerHoming`, so everything here is about *choosing* the
 * next body and about how long the shot has to reach it.
 */
export const BOUNCE = {
  /**
   * Half-angle of the forward cone a bounce prefers, in radians (100°).
   *
   * Wide, because a deflection is not a turn: anything roughly ahead of the
   * shot should be reachable without the ricochet reading as a U-turn.
   */
  cone: (100 * Math.PI) / 180,
  /**
   * Squared-distance penalty on a candidate *behind* the shot. 2.25 = a 1.5x
   * handicap on real distance, so a body behind is only taken when it is
   * clearly the closest thing on the field.
   */
  backPenalty: 2.25,
  /** Candidates closer than this are skipped; guards degenerate headings. */
  minDistance: world(10),
  /**
   * Steering rate a bounced shot gets, rad/s. Sharper than `HOMING.turnRate`
   * because the bounce already aimed it — this is tracking, not hunting.
   */
  turnRate: Math.PI * 2.4,
  /**
   * Seconds a bounced shot lives, measured from the bounce. The longest legal
   * bounce (1053 units with `ricochet_power`) takes 0.56 s at
   * `PROJECTILE_SPEED`, so this is flight plus a margin and never a cap the
   * player feels.
   */
  lifetime: 0.9,
} as const;

/**
 * Splinter shards (`plans/bounce.md` §3.3).
 *
 * A shard is a small, fast, hard-turning seeker with a short leash. The fan is
 * what makes it read as shrapnel: it leaves the corpse sideways and curves in,
 * rather than teleporting damage onto a neighbour.
 */
export const SHARD = {
  /** Launch and cruise speed. */
  speed: PROJECTILE_SPEED * 0.75,
  /** Steering rate, rad/s. High: it has to recover from the launch fan fast. */
  turnRate: Math.PI * 3.2,
  /** Seconds a shard lives. Covers `splitShardRange` with room to spare. */
  lifetime: 0.85,
  /** Angle between adjacent shard launch headings, in radians (34°). */
  fan: (34 * Math.PI) / 180,
} as const;
```

### 4.3 `src/data/blessings.ts`

**(a)** `BLESSING_TUNING` (starts line 139). Replace the ricochet block and the
split block. `world` is already imported (used by `mortarRadius`).

Replace:

```ts
  ricochetRange: 200,
  ricochetDamage: 0.30,
  ricochetPowerDamage: 0.6,
  /** Bounces per shot: 1 with `ricochet`, this many with `ricochet_power`. */
  ricochetPowerBounces: 2,
```

with:

```ts
  /**
   * How far a bounce may look for its next body, in **world** units.
   *
   * `world(...)`, unlike the raw 200 this replaces: every other distance in
   * this table that means "on the ground" is world-scaled, and the unscaled
   * version covered ~40% of the ground it was designed for after the
   * `WORLD_SCALE` zoom-out (`plans/bounce.md` §2.1).
   */
  ricochetRange: world(300),
  /** `ricochet_power` widens the search by this much. */
  ricochetPowerRangeMult: 1.35,
  /** Bounces per shot with the base card. */
  ricochetBounces: 1,
  /** Bounces per shot with `ricochet_power`. */
  ricochetPowerBounces: 2,
  /**
   * Fraction of the shot's damage carried into each hop, compounding.
   *
   * Higher than the 0.30 of the instant version because a bounce is now a
   * projectile that has to arrive: it can be outrun, and its target can die
   * first (`plans/bounce.md` §3.1).
   */
  ricochetDamage: 0.45,
  ricochetPowerDamage: 0.85,
```

Replace:

```ts
  splitShardCount: 2,
  splitShardDamage: 0.125,
  splitShardRange: 220,
```

with:

```ts
  splitShardCount: 2,
  /**
   * Shard damage as a fraction of `baseDamage`, before the projectile damage
   * multipliers and the target's resists. Raised from 0.125 because a shard is
   * now a projectile that travels, resolves through `applyResists` and can
   * miss — and because the card, this constant and the behavior comment used
   * to name three different numbers (`plans/bounce.md` §2.4).
   */
  splitShardDamage: 0.25,
  /** World-scaled, for the same reason `ricochetRange` is. */
  splitShardRange: world(280),
```

> `critChainRange: 180` and `overkillRange: 200` have the same unscaled-units
> problem. **Do not change them in this plan** — they belong to Chain Crit and
> Overkill, which stay instant-damage effects and are out of scope.

**(b)** Behaviour comments (lines 41-48). Replace those three lines:

```ts
  | 'ricochet'          // shots bounce to one extra target for 60% damage
  | 'ricochet_power'    // ricochet bounces deal full damage and can chain twice
```
→
```ts
  | 'ricochet'          // the shot itself deflects onto one more target
  | 'ricochet_power'    // ricochet deflects twice, further, for more damage
```

```ts
  | 'split_on_kill'     // a kill fires two 40% shards at nearby enemies
```
→
```ts
  | 'split_on_kill'     // a kill throws two homing shards at nearby enemies
```

**(c)** `BLESSING_BEHAVIOR_CONSUMERS` (lines 64-72):

```ts
  ricochet: 'ProjectileManager.tryBounce',
  ricochet_power: 'ProjectileManager.tryBounce (bounce count + range + damage)',
```
```ts
  split_on_kill: 'Game enemy_killed handler → ProjectileManager.fireShards',
```

**(d)** Card text. `bl_ricochet` (line 271):

```ts
    description: 'Shots ricochet off a target onto another for 45% damage',
```

`bl_ricochet_power` (line 498):

```ts
    description: 'Ricochets travel 35% further, twice, for 85% damage',
```

`bl_split` (line 303):

```ts
    description: 'Kills throw 2 homing shards for 25% damage each',
```

### 4.4 `src/systems/ProjectileManager.ts`

**(a)** Imports. Line 4 becomes:

```ts
import { BOUNCE, HOMING, PROJECTILE_SPEED, SHARD } from '../data/tower';
```

**(b)** Module constant — add below `NO_CORE` (line 36):

```ts
/** Shared empty exclusion set for `nearestOthers`. Never mutated. */
const NO_EXCLUSIONS: ReadonlySet<number> = new Set<number>();
```

`nearestOthers`'s parameter type must widen to accept it — change its signature
(line 722) from `exclude: Set<number>` to `exclude: ReadonlySet<number>`. No
other change; the body only calls `.has`.

**(c)** New private fields — add next to `seekScratch` (after line 127):

```ts
  /**
   * Scratch buffer for the bounce target search. Separate from `seekScratch`
   * because the two run in different phases of `tick` and sharing one buffer
   * would make the safety argument depend on call ordering. Safe to reuse
   * across bounces: the search happens *after* every damage handler for this
   * impact has already run, and it damages nothing itself.
   */
  private readonly bounceScratch: Enemy[] = [];
  /**
   * True only while a Splinter shard's own impact is being resolved.
   *
   * `Game`'s `enemy_killed` handler reads it and skips the splinter, which is
   * what bounds the cascade now that shards are real projectiles and their
   * kills land on a later frame than the kill that spawned them.
   */
  private resolvingShard = false;
```

**(d)** Public accessor — add next to the other getters (after `get list()`,
line 167):

```ts
  /** See `resolvingShard`. Read by `Game`'s Splinter trigger. */
  get shardImpactInProgress(): boolean {
    return this.resolvingShard;
  }
```

**(e)** In `tick`, at the very top of the per-projectile loop body, right after
`if (!p.alive) continue;` (line 482), add:

```ts
      // Belt and braces: no path out of the impact block below leaves this set,
      // but a stale `true` would silently disable Splinter for the whole run.
      this.resolvingShard = false;
```

**(f)** In `tick`, inside `if (hit) {` (line 543), immediately after
`const enemy = hit;`:

```ts
        // Splinter reentrancy (plans/bounce.md §3.3): everything `enemies.damage`
        // reaches from here is a *shard's* doing if this projectile is one.
        this.resolvingShard = p.splitGen !== undefined;
```

**(g)** Delete the ricochet call site (lines 646-648):

```ts
          if (this.blessings.has('ricochet')) {
            this.applyRicochet(enemy, final);
          }
```

**(h)** Replace the pierce/retire block at the end of `if (hit)`
(lines 660-672) with:

```ts
        // Plan §2.2: a tank body-blocks. However much pierce the shot has, it
        // stops here — which is what gives the tank a job in a formation
        // instead of making it a fat circle that pierce walks through.
        const blocked = enemy.type === 'tank';
        const remaining = blocked ? 1 : this.pierceMax(p.id);
        if (remaining > 1) {
          this.piercingRemaining[p.id] = remaining - 1;
          if (!this.hitEnemies[p.id]) this.hitEnemies[p.id] = new Set();
          this.hitEnemies[p.id].add(enemy.id);
        } else if (this.tryBounce(p, enemy, prevX + segX * hitT, prevY + segY * hitT)) {
          // `plans/bounce.md` §3.1: pierce is spent first, and a bounce is what
          // happens *instead of* the shot dying. `tryBounce` owns all of the
          // bookkeeping — position, heading, damage, budgets, hit set.
        } else {
          p.alive = false;
          delete this.piercingRemaining[p.id];
          delete this.hitEnemies[p.id];
          delete this.homingTargets[p.id];
        }
        this.resolvingShard = false;
```

`prevX`, `prevY`, `segX`, `segY` and `hitT` are all already in scope
(declared at lines 486-487 and 513-517, assigned at 538-541).

**(i)** Delete `applyRicochet` entirely (lines 747-779, including its doc
comment).

**(j)** Add the three new methods. Put them **after** `nearestOthers`
(i.e. where `applyRicochet` used to be), so the bounce code sits next to the
helper it uses.

```ts
  // ── Ricochet: the shot itself deflects (plans/bounce.md §3) ──

  /**
   * Turn a lethal-to-the-shot impact into a deflection, if it can.
   *
   * Returns `true` when the projectile survives and is now flying at a new
   * body; `false` when the caller should retire it as usual. Every side effect
   * lives here so the impact block stays a two-line branch.
   *
   * `impactX/impactY` is the swept-collision point, not `p.x/p.y`: at
   * `PROJECTILE_SPEED` a step can carry the shot most of a body-width past the
   * thing it hit, and bouncing from the far side of the target looks like a
   * teleport.
   */
  private tryBounce(p: Projectile, from: Enemy, impactX: number, impactY: number): boolean {
    if (!this.blessings.has('ricochet')) return false;
    // A shard is already a secondary projectile; letting it ricochet turns one
    // kill into an unbounded fan (plans/bounce.md §3.3).
    if (p.splitGen !== undefined) return false;

    const powered = this.blessings.has('ricochet_power');
    if (p.bouncesLeft === undefined) {
      p.bouncesLeft = powered
        ? BLESSING_TUNING.ricochetPowerBounces
        : BLESSING_TUNING.ricochetBounces;
    }
    if (p.bouncesLeft <= 0) return false;

    const radius = powered
      ? BLESSING_TUNING.ricochetRange * BLESSING_TUNING.ricochetPowerRangeMult
      : BLESSING_TUNING.ricochetRange;

    let hitSet = this.hitEnemies[p.id];
    if (!hitSet) {
      hitSet = new Set();
      this.hitEnemies[p.id] = hitSet;
    }
    hitSet.add(from.id);

    const next = this.bounceTarget(p, impactX, impactY, hitSet, radius);
    if (!next) {
      // No legal body: the shot dies here. The set is cleaned up by the caller.
      return false;
    }

    // Speed is read *before* `cruiseSpeed` is cleared: a spread lane that is
    // still riding its launch boost settles to the ordinary cruise on bounce
    // rather than keeping the boost for the rest of its life.
    const speed = p.cruiseSpeed ?? PROJECTILE_SPEED;
    const dx = next.x - impactX;
    const dy = next.y - impactY;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));

    const inAngle = Math.atan2(p.vy, p.vx);
    p.x = impactX;
    p.y = impactY;
    p.vx = (dx / d) * speed;
    p.vy = (dy / d) * speed;
    p.damage *= powered
      ? BLESSING_TUNING.ricochetPowerDamage
      : BLESSING_TUNING.ricochetDamage;
    p.bouncesLeft -= 1;
    p.bounces = (p.bounces ?? 0) + 1;
    // A bounce spends whatever pierce is left. Without this a tank-blocked shot
    // (which reaches this branch with its pierce record untouched) would get
    // its pass-throughs back on the far side of the bounce.
    this.piercingRemaining[p.id] = 1;

    // The rest of its life it is a seeker: it was aimed at a moving target from
    // up to 1053 units away, and a straight line would miss most of them
    // (plans/bounce.md §3.2). This reuses `steerHoming` unchanged.
    p.turnRate = BOUNCE.turnRate;
    p.lifetime = BOUNCE.lifetime;
    p.homingDelay = undefined;
    p.cruiseSpeed = undefined;
    p.retargetIn = 0;
    p.homingTargetId = next.id;
    this.homingTargets[p.id] = next;
    // Both lifetime caps in `tick` measure from `age`, so the bounce is what
    // buys the shot its new leash.
    p.age = 0;

    this.bus.emit('projectile_bounced', {
      x: impactX,
      y: impactY,
      inAngle,
      outAngle: Math.atan2(p.vy, p.vx),
      bounces: p.bounces,
      magic: p.damageType === 'magic',
    });
    return true;
  }

  /**
   * The body a bounce should deflect onto.
   *
   * Scored on squared distance with a flat penalty for anything outside the
   * forward cone, so a ricochet carries on across the pack rather than folding
   * back onto whatever is behind the shot — unless there is genuinely nothing
   * ahead, which is when a bounce backwards is the right answer.
   */
  private bounceTarget(
    p: Projectile,
    x: number,
    y: number,
    hitSet: Set<number>,
    radius: number,
  ): Enemy | null {
    const heading = Math.atan2(p.vy, p.vx);
    const minD2 = BOUNCE.minDistance * BOUNCE.minDistance;
    const found = this.enemies.queryRadius(x, y, radius, this.bounceScratch);
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of found) {
      if (!isTargetable(e)) continue;
      if (hitSet.has(e.id)) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2) continue;
      let diff = Math.atan2(dy, dx) - heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const score = Math.abs(diff) <= BOUNCE.cone ? d2 : d2 * BOUNCE.backPenalty;
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best;
  }

  // ── Splinter: shards thrown by a kill (plans/bounce.md §3.3) ──

  /**
   * Launch Splinter shards from a kill point.
   *
   * Not `fire`: `fire` launches from the tower with the volley's spread model,
   * and a shard launches from a corpse on a fan of its own. It shares `fire`'s
   * *damage* scaling on purpose — that is the half of the pipeline the old
   * instant-damage version skipped, which is why Splinter stopped mattering
   * after a few dozen upgrades (`plans/bounce.md` §2.5).
   *
   * @param rawDamage per-shard damage before the projectile multipliers.
   * @returns the shards created; empty when nothing was in range.
   */
  fireShards(x: number, y: number, rawDamage: number, damageType: DamageType): Projectile[] {
    const targets = this.nearestOthers(
      x,
      y,
      BLESSING_TUNING.splitShardRange,
      NO_EXCLUSIONS,
      BLESSING_TUNING.splitShardCount,
    );
    if (targets.length === 0) return [];

    const additive = 1 + this.damageMultipliers.additive;
    const scaled = Math.max(1, rawDamage * additive * this.damageMultipliers.multiplicative);
    const created: Projectile[] = [];

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      // Fanned off the true bearing, so the pair visibly scatters out of the
      // body before the steering pulls each one back in.
      const bearing = Math.atan2(t.y - y, t.x - x);
      const a = bearing + SHARD.fan * (i - (targets.length - 1) / 2);
      const proj: Projectile = {
        id: nextId(),
        x,
        y,
        targetId: t.id,
        vx: Math.cos(a) * SHARD.speed,
        vy: Math.sin(a) * SHARD.speed,
        damage: scaled,
        damageType,
        isCrit: false,
        alive: true,
        homingTargetId: t.id,
        turnRate: SHARD.turnRate,
        lifetime: SHARD.lifetime,
        retargetIn: 0,
        age: 0,
        splitGen: 1,
        visual: 'shard',
      };
      // A shard never pierces, whatever the tower's pierce is: it is already
      // the second hit this kill has paid for.
      this.piercingRemaining[proj.id] = 1;
      this.homingTargets[proj.id] = t;
      this.projectiles.push(proj);
      created.push(proj);
    }

    // Deliberately *not* `projectile_fired`: that event is the tower's shot,
    // and routing shards through it would fire the shoot sound twice per kill.
    this.bus.emit('shards_split', { x, y, count: created.length });
    return created;
  }
```

**(k)** `reset()` (line 840) — add the flag:

```ts
  reset(): void {
    this.projectiles = [];
    this.piercingRemaining = {};
    this.hitEnemies = {};
    this.homingTargets = {};
    this.resolvingShard = false;
    this.focusTargetId = -1;
    this.focusStacks = 0;
  }
```

### 4.5 `src/game/Game.ts`

**(a)** Delete the `splitOnKillActive` field and its comment (lines 759-764).

**(b)** Replace `fireSplitShards` (lines 5071-5098) with:

```ts
  /**
   * Splinter: a kill throws two homing shards at the nearest survivors.
   *
   * The shards are real projectiles now (`plans/bounce.md` §3.3), so they
   * travel, they resolve through the ordinary impact path — resists, crits,
   * every on-hit blessing — and they scale with the run instead of being a
   * fixed slice of `baseDamage`. The cascade is bounded by `splitGen`: a
   * shard's own kill sets `ProjectileManager.shardImpactInProgress`, and the
   * caller below skips the splinter while it is set.
   */
  private fireSplitShards(x: number, y: number): void {
    const ts = this.tower.snapshot;
    const raw = ts.baseDamage * BLESSING_TUNING.splitShardDamage;
    const shards = this.projectileMgr.fireShards(x, y, raw, ts.damageType);
    if (shards.length > 0) this.effects.emitSplinterBurst(x, y, shards.length);
  }
```

**(c)** The trigger (line 1142):

```ts
      if (this.blessingMgr.has('split_on_kill') && !this.projectileMgr.shardImpactInProgress) {
        this.fireSplitShards(e.x, e.y);
      }
```

**(d)** New event subscriptions. Add both immediately after the
`chain_lightning` subscription (which ends at line 1960):

```ts
    // Ricochet: the shot survived and is on its way somewhere else. There is no
    // impact decal for a bounce — the renderer derives those from a projectile
    // *disappearing* — so this flash is the only thing that says it happened.
    this.bus.on('projectile_bounced', (payload: unknown) => {
      const p = payload as {
        x: number; y: number; inAngle: number; outAngle: number;
        bounces: number; magic: boolean;
      };
      this.effects.emitRicochetFlash(
        p.x, p.y, p.inAngle, p.outAngle,
        p.magic ? FX.arcane : FX.gold,
      );
    });
```

`FX` and `lighten`/`mix` are already imported in `Game.ts`. The
`shards_split` event needs no `Game` subscription — the visual is emitted
directly by `fireSplitShards`; only `AudioManager` listens.

**(e)** `lighten` may become unused in `Game.ts` after the old
`fireSplitShards` body goes. Check with `npm run checks` and drop it from the
import list only if TypeScript flags it.

### 4.6 `src/systems/AudioManager.ts`

Add two subscriptions to the list at lines 133-144:

```ts
      this.bus.on('projectile_bounced', () => this.playRicochet()),
      this.bus.on('shards_split', () => this.playShards()),
```

And two methods next to `playHit` (line 218):

```ts
  /**
   * Ricochet: a short metallic *ping* that rises, so it reads as "went
   * somewhere" rather than as a second hit. Rate-limited like the explosion —
   * a pierce+ricochet build lands several per frame.
   */
  private playRicochet(): void {
    const now = performance.now();
    if (now - this.lastRicochetAt < 45) return;
    this.lastRicochetAt = now;
    this.playTone({ freq: 1150, type: 'triangle', duration: 0.06, volume: 0.13, freqEnd: 1750 });
  }

  /** Splinter: a dry scatter under the kill chirp. */
  private playShards(): void {
    const now = performance.now();
    if (now - this.lastShardsAt < 60) return;
    this.lastShardsAt = now;
    this.playNoiseHit(0.05, 0.09);
    this.playTone({ freq: 900, type: 'square', duration: 0.05, volume: 0.10, freqEnd: 1400 });
  }
```

Declare the two throttles next to the existing `lastExplosionAt` field:

```ts
  private lastRicochetAt = 0;
  private lastShardsAt = 0;
```

> Confirm the exact signature of `playNoiseHit` before using it — it is called
> as `this.playNoiseHit(0.18, 0.2)` in `playExplosion`
> (`src/systems/AudioManager.ts:327`). Match that argument order.

---

## 5. Visual effects

### 5.1 `EffectsManager.emitRicochetFlash`

Add to `src/systems/EffectsManager.ts`, next to `emitHitSparks` (after line
136). Everything goes through `this.n(...)` so the quality knob still governs
it.

```ts
  /**
   * A ricochet deflection (`plans/bounce.md` §5.1).
   *
   * Three readable parts, and they are three because a bounce has to answer
   * three questions at a glance: *something was struck* (the ring), *the shot
   * did not stop* (the outgoing lance of sparks), and *it came from there*
   * (the thin back-spray along the incoming line).
   *
   * @param inAngle  heading the shot arrived on, radians.
   * @param outAngle heading it left on, radians.
   */
  emitRicochetFlash(
    x: number,
    y: number,
    inAngle: number,
    outAngle: number,
    color: string,
  ): void {
    // The ring: small, bright, gone in a fifth of a second. Undamaging — it
    // carries no `damage` field, so `tick` never calls `onShockwaveDamage`.
    this.shockwaves.push({
      x,
      y,
      currentRadius: 0,
      maxRadius: 26,
      age: 0,
      life: 0.2,
      color: withAlpha(lighten(color, 0.5), 0.85),
      lineWidth: 2.5,
    });

    // The lance: a tight cone along the *outgoing* heading. This is the part
    // that says "it kept going", so it gets the most particles and the longest
    // life of the three.
    const lance = this.n(9);
    for (let i = 0; i < lance; i++) {
      const angle = outAngle + (Math.random() - 0.5) * 0.55;
      const speed = 180 + Math.random() * 200;
      this.pushParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.2 + Math.random() * 0.16,
        size: 1.4 + Math.random() * 1.6,
        color: i % 2 === 0 ? lighten(color, 0.45) : '#ffffff',
        layer: 'additive',
      });
    }

    // The back-spray: a thin fan mirrored about the impact, along the reverse
    // of the incoming heading. Half the count, half the speed — it is the
    // shrapnel the deflection shed, not the shot.
    const back = this.n(4);
    const backAngle = inAngle + Math.PI;
    for (let i = 0; i < back; i++) {
      const angle = backAngle + (Math.random() - 0.5) * 1.1;
      const speed = 70 + Math.random() * 110;
      this.pushParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        age: 0,
        life: 0.16 + Math.random() * 0.12,
        size: 1.2 + Math.random() * 1.2,
        color: withAlpha(color, 0.8),
        layer: 'front',
      });
    }
  }
```

### 5.2 `EffectsManager.emitSplinterBurst`

Add directly below `emitRicochetFlash`. Note this is **not** `emitSplitBurst`
(line 691) — that one belongs to the splitter *enemy* and stays untouched;
the two must not be confused.

```ts
  /**
   * Splinter: the corpse comes apart (`plans/bounce.md` §5.2).
   *
   * Gold-and-white rather than the frost tint the instant version used: these
   * are the player's own shrapnel, and `art-direction.md` reserves frost for
   * chill and shields. Scaled by shard count so a one-shard splinter is
   * visibly smaller than a two-shard one.
   *
   * Only the burst is drawn here — the shards themselves are projectiles and
   * the renderer draws them.
   */
  emitSplinterBurst(x: number, y: number, shards: number): void {
    const n = this.n(6 + shards * 5);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 170;
      this.pushParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        age: 0,
        life: 0.28 + Math.random() * 0.22,
        size: 1.5 + Math.random() * 2,
        color: i % 3 === 0 ? '#ffffff' : lighten(FX.gold, 0.35),
        layer: 'additive',
      });
    }
    this.shockwaves.push({
      x,
      y,
      currentRadius: 0,
      maxRadius: 34,
      age: 0,
      life: 0.26,
      color: withAlpha(lighten(FX.gold, 0.4), 0.7),
      lineWidth: 2,
    });
  }
```

`FX`, `lighten` and `withAlpha` are already imported at the top of
`EffectsManager.ts` (line 1).

### 5.3 `Renderer` — the shard sprite

In `src/game/Renderer.ts`, `drawProjectiles` (line 5107) currently picks its
sprites with two ternaries. Extend both.

**Pass 1** (additive, line 5119-5123) becomes:

```ts
      const sprite = p.visual === 'rocket'
        ? this.getRocketExhaustSprite()
        : p.visual === 'shard'
          ? this.getShardTrailSprite(core)
          : magic
            ? this.getMagicShotSprite(core)
            : this.getTrailSprite(core, (p.splashRadius ?? 0) > 0);
```

**Pass 2** (ordinary, line 5137-5139) becomes:

```ts
      const sprite = p.visual === 'rocket'
        ? this.getRocketSprite()
        : p.visual === 'shard'
          ? this.getShardSprite(core)
          : this.getBoltSprite(core, (p.splashRadius ?? 0) > 0);
```

Note pass 2 is guarded by `if (!p.alive || p.damageType === 'magic') continue;`
— a shard fired by a magic-damage tower therefore draws only its additive
trail, which is the same rule every other shot already follows. Leave it.

Add the two painters next to `getTrailSprite` (line 5358):

```ts
  /**
   * A Splinter shard: a short bright sliver, pointing along +x.
   *
   * Deliberately unlike the core's bolt — a shard is not a shot the tower
   * fired, and the player should be able to tell a splinter fan from a volley
   * without reading the blessing bar.
   */
  private getShardSprite(core: CoreId): HTMLCanvasElement {
    const tint = CORE_BY_ID[core].color;
    const L = BOLT_LENGTH * 0.55;
    return this.part(`shard|${core}`, L * 4, (g) => {
      g.fillStyle = lighten(tint, 0.35);
      g.beginPath();
      g.moveTo(L, 0);
      g.lineTo(-L * 0.6, -L * 0.34);
      g.lineTo(-L * 0.25, 0);
      g.lineTo(-L * 0.6, L * 0.34);
      g.closePath();
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.6);
      g.lineWidth = entity(0.8);
      g.stroke();
    });
  }

  /** The shard's trail: shorter and thinner than a bolt's, same construction. */
  private getShardTrailSprite(core: CoreId): HTMLCanvasElement {
    const glow = SHOT_STYLES[core].glow;
    const len = BOLT_LENGTH * 1.6;
    return this.part(`shard-trail|${core}`, len * 2.4, (g) => {
      const w = BOLT_LENGTH * 0.2;
      const grad = g.createLinearGradient(-len, 0, BOLT_LENGTH * 0.3, 0);
      grad.addColorStop(0, withAlpha(glow, 0));
      grad.addColorStop(1, withAlpha(lighten(glow, 0.4), 0.85));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(BOLT_LENGTH * 0.3, -w);
      g.lineTo(BOLT_LENGTH * 0.3, w);
      g.lineTo(-len, 0);
      g.closePath();
      g.fill();
    });
  }
```

> Before writing these, open `getTrailSprite` (line 5358) and
> `getBoltSprite` (line 5154) and **copy their exact structure** — in
> particular whether `this.part`'s `size` argument is a diameter or a radius,
> and whether the painter's origin is the sprite centre. Mirror what those two
> do; do not invent a convention.

### 5.4 `Renderer` — the bounce halo

A bounced shot should look *charged*. Add, at the **end** of pass 1 in
`drawProjectiles`, immediately before `this.drawSparks(ctx, core);`
(line 5130):

```ts
    // A bounced shot carries a halo that grows with its hop count, so a
    // ricochet chain is legible as one shot doing three things rather than as
    // three unrelated shots (`plans/bounce.md` §5.4).
    for (const p of projectiles) {
      if (!p.alive || !p.bounces) continue;
      const halo = this.getBounceHaloSprite(core);
      const scale = 1 + Math.min(3, p.bounces) * 0.22;
      const size = halo.width * scale;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.drawImage(halo, p.x - size / 2, p.y - size / 2, size, size);
      ctx.restore();
    }
```

And the painter, next to `getShardTrailSprite`:

```ts
  /** Soft radial glow worn by a projectile that has ricocheted. */
  private getBounceHaloSprite(core: CoreId): HTMLCanvasElement {
    const glow = SHOT_STYLES[core].glow;
    const r = BOLT_LENGTH * 1.5;
    return this.part(`bounce-halo|${core}`, r * 2, (g) => {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, withAlpha('#ffffff', 0.7));
      grad.addColorStop(0.35, withAlpha(lighten(glow, 0.3), 0.45));
      grad.addColorStop(1, withAlpha(glow, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
    });
  }
```

Gate it on quality: the halo is pure decoration, so wrap the loop in
`if (this.profile.additive) { … }` — on `low` the additive pass is off and the
halo would read as a flat white blob. Check how `drawProjectiles` already
handles `this.profile.additive` (the `ctx.globalCompositeOperation = 'lighter'`
at line 5115) and follow the same gate; if the existing code sets `lighter`
unconditionally, leave the halo ungated too and note it.

### 5.5 What is deliberately **not** added

* **No ground decal at a bounce point.** `Renderer.advanceImpacts` creates
  decals from projectiles that *ended*; a bounce is a shot that did not end,
  and scorching the ground there would read as a miss.
* **No persistent ricochet ribbon.** The projectile itself is visible and
  curving; a second trail object would double the cost for no information.
* **No change to `emitSplitBurst`** — that is the splitter *enemy*.

---

## 6. Tests

Add to `tests/projectiles.test.ts`, reusing the existing `harness()` helper at
the top of the file. `harness()` builds a tower at `(100, 300)` with
`baseDamage: 1e9` and `range: 2000`; `projectiles.setBounds(1280, 720)`.

For blessing-gated behaviour, drive `setBlessings` with the two-line stub the
file already documents:

```ts
const withBlessings = (...held: string[]) => ({ has: (b: string) => held.includes(b) });
// cast at the call site: projectiles.setBlessings(withBlessings('ricochet') as BlessingQuery);
```

### 6.1 Bounce

| # | Test | Setup | Assert |
|---|---|---|---|
| 1 | no bounce without the blessing | one enemy at (400,300), fire at it, step until impact | the projectile is gone from `projectiles.list` |
| 2 | a bounce keeps the shot alive | `ricochet` held; enemies at (400,300) and (500,300); fire at the first | after the impact step, `projectiles.list.length === 1` and that projectile's `bounces === 1` |
| 3 | the bounce re-aims | same as #2 | the surviving projectile's `vx/vy` points within 0.2 rad of the bearing from (400,300) to (500,300) |
| 4 | the bounce carries reduced damage | same as #2, capture `damage` before and after | `after ≈ before * BLESSING_TUNING.ricochetDamage` (use `toBeCloseTo`) |
| 5 | the bounce cannot re-hit its source | same as #2, step until the second impact | the enemy at (400,300) is hit exactly once (compare hp deltas) |
| 6 | budget is respected | `ricochet` only, 3 enemies in a line at x = 400/500/600 | the third enemy is never damaged; the shot dies after 1 bounce |
| 7 | `ricochet_power` bounces twice | `ricochet` + `ricochet_power`, same 3 enemies | all three take damage |
| 8 | range gate | `ricochet`, enemies at (400,300) and (400 + `BLESSING_TUNING.ricochetRange` + 50, 300) | no bounce: the shot dies at the first impact |
| 9 | **pierce wins over bounce** | `ricochet`, `setPierceExtra(1)`, enemies at (400,300) and (500,300) | after the first impact the shot's `bounces` is `undefined` (it pierced, it did not bounce) |
| 10 | pierce exhausts, then bounces | `ricochet`, `setPierceExtra(1)`, enemies at (400,300), (500,300) and (500,360) | the third takes damage and `bounces === 1` |
| 11 | a bounce spends leftover pierce | `ricochet`, `setPierceExtra(2)`, a **tank** at (400,300) then normals at (500,300) and (600,300) | the tank blocks, the shot bounces to the second, and dies there — the third is never hit |
| 12 | no legal target ⇒ ordinary death | `ricochet`, single enemy | the shot is gone after impact |
| 13 | forward preference | `ricochet`; shot flies left→right. Enemies at (400,300) [the one struck], (300,300) [**behind**, 100 away] and (540,300) [**ahead**, 140 away] | the bounce goes to (540,300). Scores: behind `100² × 2.25 = 22 500`, ahead `140² = 19 600` → ahead wins. Keep these exact distances; the margin is deliberate |
| 13b | …but falls back behind when nothing is ahead | `ricochet`; only (400,300) and (300,300) | the bounce goes to (300,300) |
| 14 | lifetime | `ricochet`, second enemy far but in range, then kill it via `enemies.damage` right after the bounce | the shot retires within `BOUNCE.lifetime + dt` of the bounce |

### 6.2 Splinter shards

| # | Test | Setup | Assert |
|---|---|---|---|
| 15 | `fireShards` returns nothing with no targets | empty field | `[]`, and `projectiles.list` is unchanged |
| 16 | shard count | 4 enemies inside `splitShardRange` | exactly `BLESSING_TUNING.splitShardCount` projectiles created, each with `splitGen === 1` and `visual === 'shard'` |
| 17 | shards pick the **nearest** | enemies at 100, 150, 900 units from the origin point | the two shards target the first two |
| 18 | range gate | one enemy beyond `splitShardRange` | `[]` |
| 19 | damage multipliers apply | `setDamageMultipliers(1, 2)` then `fireShards(x, y, 10, 'physical')` | each shard's `damage === 10 * 2 * 2 === 40` |
| 20 | a shard never pierces | 2 enemies in a line, `setPierceExtra(5)`, fire a shard through both | only the first is damaged |
| 21 | a shard never bounces | `ricochet` held, 2 enemies in a line, fire a shard | only the first is damaged; the shard is gone |
| 22 | `shardImpactInProgress` | subscribe to `enemy_killed` and record `projectiles.shardImpactInProgress` inside the handler; kill an enemy with a shard | `true` inside the handler |
| 23 | …and false for a tower shot | same, but the kill comes from `fire()` | `false` inside the handler |
| 24 | …and false again afterwards | after `tick` returns | `projectiles.shardImpactInProgress === false` |

### 6.3 Existing tests that must keep passing

* `tests/projectiles.test.ts` — every swept-collision and lifetime case.
  **Watch out:** these run with no blessings, so `tryBounce` returns `false` on
  its first line and behaviour is unchanged.
* `tests/blessings.test.ts:244-281` — `has('ricochet')` / persistence. No
  change needed.
* `tests/content-coverage.test.ts` — asserts every
  `BLESSING_BEHAVIOR_CONSUMERS` entry is non-empty. The §4.3(c) rewrites keep
  them non-empty.

---

## 7. Docs to update

| File | Change |
|---|---|
| `docs/projectile-system.md` | New section **"Ricochet"**: the pierce-then-bounce rule, `BOUNCE` constants, `tryBounce` / `bounceTarget`, and the "becomes a seeker" consequence. New section **"Splinter shards"**: `fireShards`, `splitGen`, `shardImpactInProgress`. |
| `docs/blessing-system.md` | Update the Ricochet, Ricochet Power and Splinter rows with the new numbers and the new consumer names. |
| `docs/effects-system.md` | Add `emitRicochetFlash(x, y, inAngle, outAngle, color)` and `emitSplinterBurst(x, y, shards)` to the **Particle Types** table. |
| `docs/event-bus.md` | Add `projectile_bounced` `{x, y, inAngle, outAngle, bounces, magic}` and `shards_split` `{x, y, count}` to the event catalog, with their consumers (`Game`, `AudioManager`). |
| `docs/audio-system.md` | Add the two new subscriptions and their throttles. |
| `docs/data-formulas.md` | If it lists `BLESSING_TUNING`, update `ricochetRange`, `ricochetDamage`, `ricochetPowerDamage`, `ricochetPowerRangeMult`, `ricochetBounces`, `splitShardDamage`, `splitShardRange`. |
| `AGENTS.md` | No count changes (no new blessings, no new enemy types). Leave it. |

---

## 8. Order of work

1. `src/types.ts` (§4.1) — the fields everything else references.
2. `src/data/tower.ts` (§4.2) — `BOUNCE`, `SHARD`.
3. `src/data/blessings.ts` (§4.3) — tuning, comments, card text.
4. `src/systems/ProjectileManager.ts` (§4.4) — the mechanics. Run
   `npx vitest run tests/projectiles.test.ts` here; it must still pass before
   any UI work.
5. `src/game/Game.ts` (§4.5) — the Splinter trigger and the bounce event.
6. `src/systems/EffectsManager.ts` (§5.1, §5.2).
7. `src/game/Renderer.ts` (§5.3, §5.4).
8. `src/systems/AudioManager.ts` (§4.6).
9. Tests (§6).
10. Docs (§7).

---

## 9. Verification

```bash
npm run checks
```

Then, in the browser (see `docs/testing.md`):

1. Force-hold the blessings for a run and watch a dense wave. Expect: shots
   visibly leave a body on a new heading, curve into a second enemy, and carry
   a halo while doing so.
2. Add `ricochet_power` and confirm two hops and a wider reach.
3. Take Piercing Shots research + `ricochet`: the shot must **pass straight
   through** its first bodies and only deflect on the hit that would have
   ended it.
4. Take `split_on_kill` and confirm two gold slivers leave every corpse and
   curve into neighbours — and that killing something *with a shard* does not
   produce more shards.
5. Drop the quality tier to `low` and confirm nothing goes white or blocky.
6. Run at 6.5× game speed and confirm bounces still land (the swept collision
   already covers this; the bounce reuses it).

### Regression risks to check explicitly

* **Projectile leak.** A bounced shot resets `p.age`, so `MAX_PROJECTILE_AGE`
  no longer bounds its total life at 3 s — the bound is now
  `3 + bounces × BOUNCE.lifetime` (worst case 4.8 s with `ricochet_power`).
  Confirm `projectiles.list.length` returns to 0 during an intermission.
* **Damage throughput.** Bounce damage now goes through armour, resists,
  Overwatch, Skewer, Focus Fire and every other on-hit modifier, where the
  instant version went through none of them. Watch the DPS readout on a
  ricochet run; if it overshoots, tune `ricochetDamage` down before touching
  anything structural.
* **Splinter trigger surface.** The trigger is still `enemy_killed`, so
  ability kills still splinter. Only a shard's own kill is suppressed.
* **`hitEnemies` growth.** A shot with high pierce plus two bounces can
  accumulate a large hit set; it is still cleaned up in the same three places
  (`tick`'s retire branch, the bounds filter, `reset`).
