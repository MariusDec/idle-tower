# Enemy System

**Files:** `src/systems/EnemyManager.ts`, `src/data/enemies.ts`

Thirteen types. Eight of them are the original roster; five are *behavioural*
types added by gameplay plan §2.1, and every one of the thirteen now has a
verb — a thing it does that a stat block cannot do.

The design rule the roster is built on:

> Each type should make at least one defensive choice **correct** and the others
> **wrong**. A tower build that is a single scalar ("damage over the approach
> corridor") has no answer to anything in particular; that is what this roster
> exists to break.

## Types

| Type | baseHP | Speed | Armor | MR | baseDmg | Gold | Shape | Unlock | The answer it demands |
|------|-------:|------:|------:|---:|--------:|-----:|-------|-------:|---|
| normal | 6 | 60 | 0 | 0 | 1 | 1 | circle | 1 | — (the baseline; deliberately legible) |
| fast | 4 | 120 | 0 | 0 | 1 | 2 | diamond | 3 | Clear speed — it arrives three at a time |
| tank | 20 | 30 | 3 | 0 | 1 | 3 | circle | 5 | Single-target damage; pierce stops dead on it |
| flying | 7 | 90 | 0 | 0 | 2 | 3 | winged | 8 | Raw DPS — mines and the wall do nothing |
| boss | 120 | 40 | 6 | 0.15 | 5 | 10 | circle | 10 | Sustained damage — three phases, one pattern each ([boss-encounters.md](boss-encounters.md)) |
| splitter | 16 | 55 | 0 | 0 | 1 | 3 | diamond | 12 | AoE that lands *after* the split, not during it |
| healer | 12 | 50 | 0 | 0 | 2 | 4 | circle+glyph | 15 | Burst and target priority |
| shielded | 10 | 40 | 0 | 0.3 | 1 | 5 | circle | 20 | Sustained fire — pot-shots let it rebuild |
| **siege** | 12 | 42 | 2 | 0 | 2 | 2 | square | 25 | **Range** and priority; knockback/slow are useless |
| **thief** | 7 | 135 | 0 | 0.1 | 1 | 3 | diamond+`$` | 30 | **Burst** — sustain watches the economy leave |
| **blinker** | 9 | 28 | 0 | 0.25 | 2 | 2 | circle+`✦` | 35 | **DPS and AoE** — control has no answer |
| **warden** | 14 | 44 | 2 | 0.2 | 2 | 3 | hex | 40 | **Target priority** — the `priority` mode, or manual aim |
| **burrower** | 9 | 52 | 1 | 0 | 3 | 2 | mound | 45 | **Close-range defence** — shockwave, thorns, mines |
| **harbinger** | 13 | 40 | 1 | 0.1 | 3 | 3 | hex | 120 | **Burst windows** — it takes the field away on a timer |
| **leech** | 10 | 50 | 0 | 0.3 | 2 | 3 | diamond | 180 | **Kill it before contact** — it wears your mana as armour |
| **chorus** | 11 | 42 | 1 | 0.15 | 3 | 3 | circle | 240 | **Coverage** — three bodies, one HP pool |

The last three are the deep roster (plans/progress.md §7.1). Before them the
roster's last new type arrived at wave 45, so from there to the wall the game
presented one composition of one roster with no new mechanic. Their unlock
waves — 120 / 180 / 240 — line up with the `SPAWN_WEIGHT_BANDS` steps below,
so each band both re-weights the pool *and* introduces something.

They take their draw weight from the bands rather than from a flat cut to
`normal` and `fast`: those two are already multiplied down from wave 120, which
is exactly where the first of the three unlocks. Cutting the table as well would
have taken the weight twice — and taken it from waves 1-119, where none of the
three has unlocked and nothing replaces it.

Per-wave scaling is unchanged (`src/data/formulas.ts`):

- **HP:** `baseHP * 1.12^(wave-1)` (boss: `bossMaxHpForWave`, which is
  `bossHPForWave` divided by what the boss's phase machine holds outside its bar
  — see [boss-encounters.md](boss-encounters.md#the-durability-budget))
- **Speed:** `baseSpeed * min(3, 1 + 0.03*(wave-1))`
- **Gold:** `baseGold * 1.1^(wave-1)`
- **Damage:** `baseDamage + floor((wave-1)/5)`

## Behaviours

`EnemyManager.tick` runs shared timers, then asks `resolveStance(enemy, …)`
what this enemy wants to do, then runs the shared contact / melee / travel code.
`resolveStance` is an exhaustive switch over `EnemyType` with a `never` default,
so a new type cannot reach the field without someone deciding what it does.

A stance is one of:

| Stance | Meaning |
|---|---|
| `advance` | Walk at the tower; melee at contact radius |
| `hold` | Stand still and do not melee (siege at standoff, burrower surfacing, the substep a blinker teleports on) |
| `retreat` | Run — a loaded thief to the nearest edge, a wounded healer away from the tower |
| `escaped` | Removed itself from the field this substep (a thief that got away) |

All tuning lives in `ENEMY_BEHAVIOR` in `src/data/enemies.ts`, in **simulation**
seconds. Everything is integrated inside `Game.simulate`'s fixed substeps, so
every cadence below is correct at `dt = 1/120` and at 4.5x game speed alike.

### siege

Halts at **260 px** and lobs a shell every **3 s** for `damage × 3`, with a
**1.2 s** flight time drawn as an arc plus a tightening impact ring. Knockback
and slow do nothing about it; more range, or shooting it first, does.

The reload is clamped at zero while it is still approaching, so arriving in
range fires **one** shell rather than a stockpile.

### thief

Beelines, and on contact takes
`min(6% of current gold, 30 × a normal wave drop)`, bounded by what is left of a
**15% of current gold** ceiling for the wave. Then it turns and runs for the
nearest arena edge at `1.35×` speed.

- Killed before it escapes → drops the stolen gold **×2** (`gold_recovered`).
- Escapes → the gold is gone (`gold_escaped`).
- It never melees; it takes what it came for and leaves.

Stealing from *current* gold is the safety valve: a player who spends what they
earn has nothing worth taking. `WaveManager` caps it at **one per wave** — two
thieves is a tax, not a threat.

### blinker

Teleports **140 px** toward the tower every **3 s**, leaving an after-image.
During a **0.3 s** window after the blink it ignores knockback and land mines,
and it walks through the wall's extended contact band at all times. Its base
speed is deliberately low — the blink is how it covers ground.

### warden

Every **4 s**, projects an absorb pool worth **15% of its own max HP** onto up
to **5** allies within **190 px**. The pool is *set*, never added to, so a pair
of wardens is no worse than one, and wardens never shield each other. Killing
the warden collapses every pool it was maintaining, immediately.

`EnemyManager.damage` spends `absorbShield` before HP, so sustained fire still
gets through: this is a tax on ignoring the warden, not an immunity.

### burrower

Spawns **burrowed**: invulnerable, untargetable, and moving at `1.6×` speed. It
surfaces at **120 px** from the tower with a **1 s** telegraph during which it
cannot act. Long-range sniping is bypassed entirely; the answer is whatever you
have placed close in.

### Verbs for the original roster

| Type | Behaviour |
|---|---|
| `healer` | Below **40%** HP it flees from the tower — and keeps healing while it runs |
| `tank` | **Body-blocks**: a shot that hits a tank never pierces past it, whatever its pierce count |
| `flying` | Ignores land mines and the wall contact band |
| `fast` | Arrives in **packs of 3** from one shared spawn point (they take slots, not extra slots) |
| `splitter` | Children get **2 s** of spawn protection and scatter outward before turning in |
| `shielded` | Rebuilds one charge every **6 s**, but only after **3 s** with no damage taken |
| `normal` | Unchanged — it is the baseline and should stay legible |
| `boss` | Enrages at 50% HP, **and** runs the three-phase encounter — see [boss-encounters.md](boss-encounters.md) |

## Targetability

One predicate, `isTargetable(enemy)` in `src/data/enemies.ts`, answers "can the
tower shoot this?" for every target-selection site in the game:

- `Tower.acquireTarget`
- the swept-collision loop and every blessing bounce in `ProjectileManager`
- every picker in `AbilityManager` — highest-HP (Meteor), chain-bounce
  (Chain Lightning), Execute, Rocket Barrage, and the field-wide AoE

It is false for a **burrowed burrower**, for a **splitter child inside its spawn
protection**, and for a **boss mid-phase-transition** (§3.1's invulnerable
flash). `EnemyManager.damage` also returns `false` for all three, so the
invulnerability holds even if some future call site forgets to ask.

> The boss flash goes through this predicate rather than a flag of its own on
> purpose: a second invulnerability mechanism is a second thing all eight
> target-selection sites have to remember.

> Adding a new target picker without consulting `isTargetable` is how burrowers
> become shootable underground. There is one predicate on purpose.

## Hostile shots

Siege shells are `HostileShot` records owned by `EnemyManager`
(`hostileShotList`), ticked in `EnemyManager.tick` and drawn by `Renderer`.

They deliberately do **not** reuse `ProjectileManager`: every loop in that class
assumes tower ownership — pierce, crit, armour penetration, ricochet, the
blessing behaviours — and none of it has any meaning for an incoming shell.

On arrival a shell emits **`tower_damaged`**, so the entire existing mitigation
chain applies to it unchanged and in the same order as a melee hit:

```
dodge (Evasion talent) → research DR → mana-shield evolution → wall
  → shield charges → armour → defense → mana-shield talent
```

The list is capped at 64 shells; the oldest is dropped rather than letting the
draw loop grow without bound.

## Elites and champions

From wave 21, a non-boss spawn has a `2% → 20%` (linear to wave 100) chance to
be an elite: `2.5×` HP, `2.5×` gold, a guaranteed RP drop, and one of five auras
(haste, thorns, greed, vitality, retribution). The elite roll happens per pack
member, so packing `fast` does not change the elite rate.

**Champions** (plans/progress.md §7.2, `CHAMPION_WAVE = 150`). From wave 150 an
elite is worth `5.0×` HP and `6.0×` gold instead — the same entity, the same
aura, the same code path, twice as loud on both sides of the trade. The rate
gets a second, deliberately shallower ramp on top of the first: `20% → 30%` over
waves 150–400 (`eliteChanceForWave`). The escalation past 150 is carried by what
an elite *is* rather than by how many there are, because body count is what
`MAX_WAVE_BODIES` is capping.

### The deep roster's verbs

- **Harbinger** (`harbingerInterval` 6 s) makes every ally within
  `harbingerRange` (200 px) untargetable for `harbingerPhase` (2 s). It is not
  durable itself; what it costs is *uptime*, so a pure sustained-DPS build
  spends a third of its shots on an empty field. It writes `phasedOut`, which
  is a term inside `isTargetable` rather than a second invulnerability
  mechanism — the same discipline the boss's phase flash follows.
- **Leech** drains `leechManaSteal` (8) mana on contact and converts each point
  into `leechShieldPerMana` (3) × its own base HP of absorb **on itself**. It
  reuses the warden's `absorbShield` pool rather than adding a second one, and
  carries no `wardenId`, so nothing can strip it by killing a warden. An empty
  mana bar yields it nothing — which is what makes Meditation and Mana Well
  defensive purchases at depth rather than purely offensive ones.
- **Chorus** spawns as `chorusVoices` (3) bodies sharing one HP pool. Every
  voice's `hp` *is* the pool, so a hit on any one is a hit on all three and the
  group dies together; `EnemyManager.spawn` multiplies the bar by the voice
  count, so the group's total HP is exactly three bodies' worth. Pierce and
  splash spend that one bar once per body they touch; single-target spends it
  once. The voices are linked by a `chorusId` assigned in
  `WaveManager.buildRoster`, the way the splitter's children are linked.

## Crowd compression

`crowdCompression(wave)` = natural roster ÷ capped roster — 1.00 up to wave 97,
2.03 at wave 200, 4.53 at wave 450, and always 1 on a boss wave. Above
`MAX_WAVE_BODIES` (120) the wave fields fewer bodies and each one carries the
share of the ones that were cut, so **`count × per-body` is unchanged at every
depth** and every balance table stays valid.

It multiplies **HP, gold and XP**, at exactly these sites: `EnemyManager.spawn`
(hp, gold), `xpPerKill` / `passiveXpPerKill`, `SaveManager.averageKillGoldForWave`,
`Game.estimateWaveGold` and `sim/model.ts`'s `waveProfile`.

It deliberately does **not** multiply `enemyDamageForWave`. Total incoming chip
damage falls with the body count, which is a margin the player cannot exploit;
compressing it instead would mean a single wave-450 body hitting for 4.5×, which
is a new way to die rather than the same wave in fewer pieces.

## Depth bands

`SPAWN_WEIGHT_BANDS` re-weights the spawn pool with depth (plans/progress.md
§7.1). The weight table itself is flat, so a wave-500 roster used to be drawn
from the same distribution as a wave-50 one. Each band multiplies the baseline
weights; bands do **not** stack — the deepest one reached wins.

| From wave | Band | Shift |
|---:|---|---|
| 120 | The line thickens | `normal ×0.6`, `fast ×0.8`, `tank ×2.0`, `shielded ×1.8`, `warden ×1.5` |
| 240 | The clever ones | `normal ×0.4`, `fast ×0.6`, `blinker ×2.2`, `burrower ×2.0`, `siege ×1.8`, `warden ×2.0` |
| 380 | The deep muster | `normal ×0.3`, `fast ×0.5`, `tank ×2.0`, `shielded ×2.0`, `healer ×2.5`, `warden ×2.5`, `blinker ×2.0`, `thief ×1.8` |

Composition moves; totals do not. `SaveManager`'s offline averages and
`sim/model.ts`'s `typeMix` both read `spawnPoolForWave`, so the model prices the
re-weighted wave. Each band is announced in the milestone strip.

## Combat

**Damage from tower** — `EnemyManager.damage(enemy, amount, isCrit)`, in order:

1. Burrowed, spawn-protected or mid-boss-phase-flash → return `false` silently
   (it is not there to hit)
2. Reset `undamagedFor` (this is what gates shielded regeneration)
3. `shielded` charge absorbs the whole hit, if any charge remains
4. `bossShield` (bulwark) soaks up to `amount`, then bleeds through; emptying it
   emits `boss_shield_broken` and stops the heal clock for the phase
5. `absorbShield` (warden ward) soaks up to `amount`, then bleeds through
6. HP, thorns reflection, boss 50%-HP enrage check
7. On death: retribution aura, thief recovery ×2, warden ward collapse, gold, RP

**Gold** (`computeGold`): `base × multiplier`, then kill-streak, mana-full,
elite, greed, gold-luck, double-gold, flat on-kill and crit bonuses.

## Crowd control

| Method | Effect |
|--------|--------|
| `applySlow(factor, duration)` | Global movement multiplier (min factor wins, extends duration) |
| `applyChill(enemy, factor, duration)` | Per-enemy chill (Frostbite blessing); `isSlowed` reads it |
| `applyKnockback(enemy, force, x, y)` | Push away from a point — **skipped during a blinker's immunity window** |
| `applyShockwave(radius, x, y)` | Push everything inside the radius to its edge |
| `setSpeedMult` / `setHPMult` / `setEnrage` / `setBlessing*` | Composable spawn and live multipliers |

## Radius queries

`EnemyManager` owns a `SpatialGrid` and exposes `queryRadius(x, y, radius, out?)`,
used by mine detonation, AoE splash, chain-kill AoE, the shockwave damage band
and crit splash.

The aura passes, the healer's target search, the warden's ward pass, retribution
and shockwave displacement deliberately keep their direct scans: their outer
loop is over a handful of elites, healers, wardens or rings rather than over
every enemy, and measured at 64–420 enemies the grid is 1.6–4x *slower* there
than the flat walk. See [performance.md](performance.md).

> Any code that moves an enemy must set `gridStale`. `tick` sets it
> unconditionally at the end, `applyShockwave` sets it, and the **blink** sets it
> at the point of teleport — not only at the end of the tick, because a mine
> detonation triggered later in the same substep would otherwise test the
> position the blinker had already left.

`queryRadius` returns a fresh array by default. Pass `out` to reuse a buffer only
where nothing in the loop can trigger another query — damaging an enemy emits
events whose handlers query again, and a shared buffer would be cleared
underneath the loop still walking it.

## Events emitted

| Event | Payload | Consumer |
|---|---|---|
| `enemy_damaged` / `enemy_killed` / `enemy_healed` | — | `Game`, effects, XP, achievements |
| `shield_break` / `shield_restored` | `{x, y}` | Shielded charge feedback |
| `ward_projected` / `ward_absorbed` | `{x, y, …}` | Warden ring + absorb flash |
| `siege_fired` / `siege_impact` | `{x, y}` | Shell audio and impact burst |
| `enemy_blinked` | `{x, y, toX, toY}` | Blink ring |
| `burrower_surfaced` | `{x, y}` | Surface burst + telegraph |
| `gold_stolen` / `gold_recovered` / `gold_escaped` | `{x, y, amount}` | Toasts — a theft the player does not notice is a bug report, not a mechanic |
| `tower_damaged` | `number` | The single mitigation chain — melee, shells and boss slams alike |
| `boss_*` | see [boss-encounters.md](boss-encounters.md#events) | Phases, patterns, telegraphs, enrage and rewards |

## How enemies are drawn on a small viewport

The presentation layer scales bodies up on a small viewport so that an `entity(1.7)` outline and a 35 px tank do not turn into a point cloud on a phone. The scale-up is **render-only** — it never feeds back into gameplay.

### Render-only body boost

`ENEMY_DEFS[].radius` is a *gameplay* number. `ProjectileManager.hitRadius` and `EnemyManager.contactRadius` both read it, and so does every collision, projectile and AoE test in the simulation. It must stay where it is — that is the rule the legibility work operates under.

What changes is the *drawn* radius. `Renderer.enemyDrawRadius` returns

```
ENEMY_DEFS[enemy.type].radius
  × (enemy.elite ? ELITE_RADIUS_SCALE : 1)
  × Renderer.bodyBoost()
```

The first factor is gameplay, the second is the elite silhouette, the third is the viewport scale-up. `bodyBoost()` is `viewBodyBoost(camera.transform.scale, camera.transform.dpr)` from `src/data/arena.ts`, and is exactly **1** on every desktop transform (where `cssPerWorld ≥ REFERENCE_CSS_PER_WORLD = 0.34`) and **1.45** on a phone. So the boost is **not** a radius change — it is a presentation change layered on top of the gameplay number.

### Why `ENEMY_DEFS[].radius` is not it

`ENEMY_DEFS[].radius` is the only field every gameplay test reads. Raising it on a phone would change collision, projectile hit and contact radius alike — out of scope for a legibility fix, and a cheat the simulation would never be able to undo. The boost wraps around it instead: every read of `ENEMY_DEFS[].radius` in `EnemyManager` and `ProjectileManager` keeps the gameplay value, and only the renderer sees the multiplied version.

### The slack that bounds the boost

A body drawn larger than the radius the simulation tests against is a lie the player can feel — a shot that visibly clips an enemy and does nothing. The projectile test is `radius + PROJECTILE_HIT_PAD` (27 world units), so the drawn size can grow into that pad without changing a single hit:

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

The tank binds, and the boost where it would break is **1.506**. `MAX_BODY_BOOST = 1.45` leaves 4% of headroom; `tests/enemy-scale.test.ts` pins the invariant by asserting every entry's `radius × MAX_BODY_BOOST × (boss ? 1 : ELITE_RADIUS_SCALE)` is `≤ radius + PROJECTILE_HIT_PAD`, so raising the ceiling by hand turns into a red test before it can ship.
