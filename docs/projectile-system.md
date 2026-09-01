# Projectile System

**File:** `src/systems/ProjectileManager.ts`

## Projectile State

```typescript
interface Projectile {
  id: number;
  x, y: number;          // position
  targetId: number|null; // which enemy it's aimed at
  vx, vy: number;        // velocity (pixels/sec)
  damage: number;        // damage on hit (after multipliers)
  damageType: 'physical'|'magic';
  isCrit: boolean;
  alive: boolean;
  homingTargetId?: number;   // present on homing shots only
  turnRate?: number;         // max steering rate (rad/s)
  lifetime?: number;         // homing retirement age, in seconds
  homingDelay?: number;      // straight launch-heading seconds before it starts seeking
  cruiseSpeed?: number;      // speed the launch boost decays back to (spread lanes only)
  retargetIn?: number;       // countdown to this shot's next target re-scan
  age?: number;              // seconds alive; every projectile ages
  splashRadius?: number;     // blast radius on impact (Mortar blessing, Artillery core, Rocket Barrage)
  splashFraction?: number;   // share of the landed hit the rest of the blast takes
  visual?: ProjectileVisual; // sprite set to draw with: 'default' | 'rocket'
}
```

## Firing (`fire`)

Called from `Game.update` when tower cooldown is ready.

1. Calculate direction from tower to target (or aim point)
2. Normalize, scale by `PROJECTILE_SPEED = 720`
3. Apply damage multipliers (additive + multiplicative)
4. For each shot variant (main + extra/scatter/back shots):
   - Rotate velocity by angle offset
   - Offset launch position
   - Create projectile, emit `projectile_fired`

**Shot variants** (from AP perks in `Game.buildShotVariants`):

| Variant | Geometry | `damageScale` |
|---|---|---:|
| main | none | 1 (field absent) |
| Twin Arrows (`extra_shots`) | parallel offset left/right, 10 px per lane | **0.55** |
| Scatter Shot (`scatter_shots`) | angled spread, `min(30° + 15° per level, 75°)` both sides | **0.35** each |
| Rear Guard (`back_shots`) | 180° reverse, 10 px per lane | **0.55** |

`ShotVariant.damageScale` is what makes the AP projectile perks a **coverage**
axis rather than a damage multiplier (revamp §7). Every variant used to carry
the full `rawDamage`, which made the suite worth ~x13 — one first ascension
bought a 7x multiplier and the run coasted. Each extra lane now carries a
fraction of the volley's payload, so the whole suite is worth ~x2.8 before
geometry. The three fractions live in one shared block,
`PRESTIGE_PROJECTILE_TUNING` in `src/data/prestige.ts`, read by both
`buildShotVariants` and `sim/model.ts` so the simulator measures what actually
fires. An absent `damageScale` means 1 — the main shot and the talent/evolution
variants (Barrage, `double_shot`) are unscaled.

`FireOptions.visual` passes straight through to each created projectile — `'default'` renders as the core's ordinary bolt, and `'rocket'` swaps in the rocket hull + exhaust sprite set (Rocket Barrage is the only emitter that sets it today).

## Movement & Collision (`tick`)

1. Move: `pos += velocity * dt`
2. Check collision with each enemy: `distance < enemyRadius + 6`
3. On hit:
   - Apply resistances via `Tower.applyResists`
   - Call `enemyMgr.damage(enemy, final, isCrit)`
   - If not killed: apply knockback if tower has it
   - If piercing: decrement pierce count, keep projectile alive
   - Otherwise: mark projectile dead
4. Cleanup: remove off-screen or dead projectiles

## Piercing

- Research nodes `piercing_shots` and `improved_pierce` add pierce count
- Each projectile tracks `piercingRemaining[id]` (number of extra enemies it can hit)
- Default pierce max = `1 + pierceExtra`
- Piercing projectiles stay alive after hitting an enemy
- A `tank` body-blocks: however much pierce the shot has, it stops there

Pierce and the Ricochet bounce are **sequential budgets, not competing ones** —
see *Ricochet* below.

## Ricochet (`plans/bounce.md`)

With the `ricochet` blessing held, the impact that would have retired a shot
instead **deflects it**. The rule, in order, per impact:

1. Damage resolves normally.
2. Pierce left (and not tank-blocked) → the shot passes straight through.
   **No bounce.**
3. Otherwise, bounce budget left and a legal target in range → `tryBounce`
   repositions the shot to the swept-collision point, re-aims it, scales its
   damage and returns `true`.
4. Otherwise the shot dies as usual.

`tryBounce` owns every side effect: position, heading, damage, budgets and the
`hitEnemies` set. `bounceTarget` scores candidates on squared distance with a
flat `BOUNCE.backPenalty` for anything outside the `BOUNCE.cone` forward
half-angle, so a ricochet carries on across a pack instead of folding back —
unless there is genuinely nothing ahead.

A bounced shot **becomes a seeker** for the rest of its life (`BOUNCE.turnRate`,
`BOUNCE.lifetime`, `age` reset to 0, `homingDelay` and `cruiseSpeed` cleared).
Without steering, a bounce aimed from up to 1053 units away would visibly miss a
walking target; with it, `steerHoming` is reused unchanged. A bounce also
**spends whatever pierce is left**, which is what stops a tank-blocked shot
getting its pass-throughs back on the far side of the deflection.

| Constant | Base | With `ricochet_power` |
|---|---|---|
| Search radius | `BLESSING_TUNING.ricochetRange` = `world(300)` | x`ricochetPowerRangeMult` (1.35) |
| Bounces | `ricochetBounces` = 1 | `ricochetPowerBounces` = 2 |
| Damage carried per hop (compounding) | `ricochetDamage` = 0.45 | `ricochetPowerDamage` = 0.85 |

Each bounce emits `projectile_bounced` `{ x, y, inAngle, outAngle, bounces,
magic }`. This is the **only** feedback a bounce produces: `Renderer`'s impact
decals are derived from a projectile *disappearing* from the snapshot, and a
bounced shot does not disappear. `Game` turns the event into
`EffectsManager.emitRicochetFlash`, and `AudioManager` into a throttled ping.
Shards (`splitGen`) never bounce.

## Splinter shards (`plans/bounce.md`)

`fireShards(x, y, rawDamage, damageType)` launches
`BLESSING_TUNING.splitShardCount` homing shards **from a kill point** rather
than from the tower, at the nearest legal enemies inside
`splitShardRange` (`world(280)`), on a `SHARD.fan` spread so the pair visibly
scatters out of the body before curving in.

Shards differ from a tower shot in four ways:

- `splitGen: 1` — they may not bounce, and their kills may not splinter again.
- `piercingRemaining` forced to 1 — a shard never pierces, whatever the tower's
  pierce is.
- `visual: 'shard'` — its own sprite and trail, so a splinter fan is legible
  against a volley.
- They emit `shards_split` `{ x, y, count }`, **not** `projectile_fired` —
  routing them through the tower's shot event would double the shoot sound.

They *do* share `fire`'s damage scaling and the ordinary impact path, which is
the half of the pipeline the old instant-damage version skipped — that omission
is why Splinter used to stop mattering a few dozen upgrades into a run.

`SHARD.speed` / `turnRate` / `lifetime` live in `src/data/tower.ts` next to
`HOMING` and `BOUNCE`.

## Damage Multipliers

- `setDamageMultipliers(additive, multiplicative)` — additive bonus + multiplicative factor
- Applied: `finalDamage = rawDamage * (1 + additive) * multiplicative`

## Public API

| Method | Purpose |
|--------|---------|
| `fire(target, towerState, opts)` | Create projectile(s) |
| `fireShards(x, y, rawDamage, damageType)` | Launch Splinter shards from a kill point |
| `tick(dt)` | Movement + collision |
| `reset()` | Clear all projectiles |
| `setDamageMultipliers(a, m)` | Update damage bonuses |
| `setPierceExtra(n)` | Set additional pierce count |
| `shardImpactInProgress` (getter) | True while a shard's own impact resolves; bounds the Splinter cascade |

## Collision (plan §1.6)

Collision is **swept**, not a point test: `tick` remembers the pre-move
position and finds the nearest enemy along the whole travel *segment*
(closest-point-on-segment against `ENEMY_DEFS[type].radius + 6`). At 720 px/s a
single step can cover far more than an enemy's radius, so a point-in-circle
test at the end position missed most hits at high game speed — the Accelerator
perk actively reduced DPS.

Because the nearest hit along the segment wins, a fast projectile hits the
first thing in its path rather than whichever enemy happens to come first in
the array.

## Homing (`plans/homing.md`)

A homing shot owns its own targeting. The volley's target is only its launch
heading; everything after that is decided by the projectile, from its own
position, in `steerHoming`. `turnRate` is the sole "is this a seeker" gate —
`fire` sets it only for homing shots, and a seeker may legitimately have no
target at all (a clicked volley, or a spread lane still flying straight).

Each step runs the same three stages. First a **straight-flight delay**: for
`homingDelay` seconds the shot holds its launch heading at its launch speed and
does not even look for a target. Then **acquisition**, which prefers the cone
ahead: `seekNearest` asks the enemy grid for everything within
`HOMING.seekRadius` and takes the nearest candidate inside `HOMING.acquireCone`
(75°) of the current heading, falling back to the nearest anywhere only when
that cone is empty. Preferring the cone is what stops a rear or scatter lane
from U-turning onto whatever the front lane is already shooting the instant its
delay expires — a lane adopts something it is broadly already flying at. Then
the **turn**, which eases from 0 to `turnRate` over `HOMING.ramp`, so the shot
banks into its curve instead of snapping onto the target on the first frame.

A shot never re-locks a body it has already pierced. `hitEnemies` bars a second
hit on the same enemy, so chasing it would just orbit a corpse until
`MAX_PROJECTILE_AGE`; dropping the target on pierce is what lets a piercing
seeker walk down a column. When a pierced-out shot finds nothing new it flies
*straight* rather than re-locking the body it went through — straight flight can
still stumble into something before the age cap, a corkscrew cannot.

Re-scans are cheap and rate-limited: `retargetIn` counts down
`HOMING.retargetInterval` (0.12 s) between opportunistic scans, and a rival
enemy only steals a still-valid target if its squared distance is below
`HOMING.switchMargin²` of the current one. That hysteresis is not decoration — a
shot flying between two equidistant enemies dithers between them and hits
neither without it.

Spread lanes launch **fast and slow into their turn**. `fire` scores each lane's
`angleOffset` 0..1 against `HOMING.spreadFullAngle` (45°) and gives it both a
proportional `HOMING.spreadDelay` of extra straight flight and a launch speed up
to `HOMING.spreadLaunchBoost` (1.55x), which then bleeds back to `cruiseSpeed`
on the `HOMING.speedSettle` clock once steering starts. This is what keeps
Scatter Shot and Rear Guard from collapsing into Twin Arrows once Seeker Shots
is drafted: a fully spread lane covers ~460 world units before it so much as
looks for a target, so by the time the lanes steer they are far apart and
pointing at different parts of the field, and they acquire different enemies.
Twin Arrows lanes have `angleOffset` 0, score 0, and converge as tightly as they
always did — it is the tight perk, deliberately.

## Lifetime (plan §5.5)

A projectile retires when it:

1. hits, with pierce exhausted, or
2. leaves the play field by a 120 px margin (`setBounds(width, height)`), or
3. reaches `MAX_PROJECTILE_AGE` (4 s).

Every projectile ages, not just homing ones. The age cap is what retires a shot
that is pinned or circling a target it can never catch — bounds culling alone
would keep it in the list, and in every projectile-vs-enemy loop, indefinitely.

## Splash impacts

A projectile carrying `splashRadius` deals its blast — `splashFraction` of the
landed hit to every other targetable enemy in the radius via `applyBlastSplash`
— and then emits `projectile_exploded` `{ x, y, radius }`. The event is
**presentation only** (the damage already went through the normal impact path):
`Game` turns it into a decorative shockwave ring capped at 40 px plus a few
sparks, and `AudioManager` plays the explosion sound, throttled to one per
60 ms of wall clock so a full barrage doesn't stack booms.

The `splashRadius` / `splashFraction` fire options are one shared channel used
by the Mortar blessing, the Artillery core's `splash_shots`, and Rocket Barrage,
whose rockets each pop half their hit within 60 px.

## Core hooks

`ProjectileManager.setCore(query)` mirrors `setBlessings`: a narrow
`{ has(behavior) }` interface rather than the manager itself, so the impact path
can be driven from a test with a two-line stub and cannot reach anything else.
Only one core behavior fires on impact — frostwork's `chill_shots`, which routes
through `EnemyManager.applyChill`. It shares that call with the Frostbite
blessing, and `applyChill`'s "strongest wins, weaker only refreshes" rule
composes the two rather than letting one dilute the other.

Artillery's blast reuses that same `splashRadius` / `splashFraction` channel
(see *Splash impacts* above) — which is why `Game.simulate` picks the larger of
the two rather than applying both.
See [core-system.md](core-system.md).
