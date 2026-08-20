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
every cadence below is correct at `dt = 1/120` and at 6.5x game speed alike.

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
  (Chain Lightning), Execute, Multishot, and the field-wide AoE

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

## Elites

Unchanged. From wave 21, a non-boss spawn has a `2% → 20%` (linear to wave 100)
chance to be an elite: `2.5×` HP, `2.5×` gold, a guaranteed RP drop, and one of
five auras (haste, thorns, greed, vitality, retribution). The elite roll happens
per pack member, so packing `fast` does not change the elite rate.

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
