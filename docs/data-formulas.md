# Static Data & Formulas

## Formulas (`src/data/formulas.ts`)

| Function | Formula                                                                          |
|----------|----------------------------------------------------------------------------------|
| `enemyHPForWave(baseHP, wave)` | `baseHP * ENEMY_HP_GROWTH^(wave-1)`, `ENEMY_HP_GROWTH = 1.11`                    |
| `bossHPForWave(baseHP, wave)` | `baseHP * 1.11^(wave-1) * 1.07^tier` (`tier = floor((wave-1)/10)`)               |
| `enemyDamageForWave(baseDamage, wave)` | `baseDamage * 1.1^wave`                                                          |
| `enemySpeedForWave(baseSpeed, wave)` | `baseSpeed * min(3, 1 + 0.03*(wave-1))`                                          |
| `goldDropForWave(baseGold, wave)` | `baseGold * GOLD_GROWTH^(wave-1)`, `GOLD_GROWTH = 1.08`                          |
| `enemyCountForWave(wave)` | `5 + floor((wave-1) * 1.2)`                                                      |
| `bossEncounterWeight(wave)` | `2 + (tier - 1)`, `tier = max(1, floor(wave/10))`                                |
| `bossEscortCountForWave(wave)` | `bossEncounterWeight(wave)`                                                      |
| `spawnCountForWave(wave)` | boss wave: `1 + escort`; otherwise `enemyCountForWave`                           |
| `spawnIntervalForWave(wave)` | `max(0.4, 2.0 - wave*0.04)`                                                      |
| `upgradeCost(base, growth, level)` | `floor(base * growth^level)`                                                     |
| `abilityUpgradeCost(base, growth, level)` | `floor(baseCost * growth^level)` (numeric growth only)                           |
| `isBossWave(wave)` | `wave > 0 && wave % 10 === 0`                                                    |
| `apForWave(wave)` | `15 + floor(5 * 1.06^d * sqrt(d+1))`, `d = wave - 20`; `0` below wave 20         |
| `tpForAP(ap)` | `floor(4 * ap^0.4)` (if `ap >= 100`)                                             |
| `lifetimeAPDamageBonus(ap)` | `0.02 * ap^0.7` — sub-linear. `lifetimeAPGoldBonus` is the same curve            |
| `perkCost(def, level)` | `floor(costPerLevel * costScaling^level)`                                        |

`ENEMY_HP_GROWTH` and `GOLD_GROWTH` are the single most important pair in the
game: the gap between them is the rate at which the economy falls behind the
difficulty. At 1.11 vs 1.08, gold-per-HP decays ~`1.028^wave` — a factor of ten
every ~85 waves instead of every ~21.

Bosses are anchored to `ENEMY_HP_GROWTH` with only a per-tier bump
(`BOSS_TIER_GROWTH = 1.07`). On their own exponent they ran away from the trash
curve — a wave-100 boss was 724x a wave-100 trash mob.

### Wave pacing and enrage

| Constant / function | Value | Notes |
|---|---|---|
| `TARGET_WAVE_KILL_SECONDS` | `20` | Flat kill window a non-boss wave gets beyond its own spawn cadence |
| `TARGET_BOSS_KILL_SECONDS` | `28` | Kill window a **single** boss is expected to need |
| `ENRAGE_THRESHOLD_MULTIPLIER` | `2` | A wave running longer than `expected x 2` starts enraging |
| `ENRAGE_STACK_INTERVAL` | `8` | Seconds between stacks once it has overrun |
| `ENRAGE_DAMAGE_PER_STACK` | `0.4` | Additive damage-to-tower per stack |
| `ENRAGE_SPEED_PER_STACK` | `0.15` | Additive movement speed per stack |
| `expectedWaveSeconds(wave, count?)` | `spawnIntervalForWave(wave) * max(0, count-1) + kill` | `kill` is `TARGET_WAVE_KILL_SECONDS`, or `TARGET_BOSS_KILL_SECONDS * bossEncounterWeight(wave)` on a boss wave |
| `enrageThresholdSeconds(wave, count?)` | `expectedWaveSeconds * 2` | |
| `enrageStacksFor(wave, elapsed, count?)` | `1 + floor(over / 8)` past the threshold | |

`enemyCount` defaults to the wave's natural size but **must** be passed when a
mutator has changed it — a Swarm wave spawns 3x the enemies and legitimately
takes 3x as long to spawn them.

A boss wave's kill window is sized off `bossEncounterWeight`, **not** off its
body count. Counting bodies would hand the encounter a fresh 28-second window
for every piece of escort trash walking in behind the boss, which `npm run sim`
prices at boss-wave budget use falling from ~82% to ~54% — a boss wave has to
stay the wall it has always been. The escort is paid for through the spawn
cadence, like any other body on any other wave.

### Economy ceilings (revamp §6.2)

| Constant / function | Value | Bounds |
|---|---|---|
| `AVARICE_STREAK_GOLD_CAP` | `0.75` | Avarice's kill-streak gold |
| `avariceStreakGoldBonus(streak, perKill)` | `min(0.75, (streak-1) * perKill)` | |
| `DRAGON_HOARD_GOLD_CAP` | `0.50` | Dragon's Hoard's waves-survived gold |
| `WAVE_MASTERY_CHAIN_PER_WAVE` / `_MAX_WAVES` | `0.1` / `20` | |
| `waveMasteryChainMultiplier(cleared)` | `1 + min(cleared, 20) * 0.1` — **x3 max** | Wave Mastery's clear chain |

See [upgrade-system.md](upgrade-system.md#economy-caps-revamp-62).

## XP System (`src/data/xpTables.ts`)

### §4.1 Kill XP

`xpPerKill(type, wave)` = `KILL_XP_WEIGHT[type] * killXpWaveScale(wave)`,
floored at 1.

`KILL_XP_WEIGHT` per type:

| Type | Weight |
|---|---:|
| normal, fast | 1 |
| splitter | 0.8 |
| flying | 1.1 |
| tank, siege | 1.8 |
| healer, shielded, burrower | 1.6 |
| blinker | 1.5 |
| thief, warden | 2.4 |
| boss | 12 |

`killXpWaveScale(wave)` = `1 + 0.20 * wave` (linear; a wave-200 kill is 41x a
wave-1 kill).

### §4.2 Wave-clear XP

`xpPerWaveClear(wave)` = `1.5 * wave^1.5`, floored at 1. Superlinear — clearing
deep waves is the real XP faucet.

### §4.3 Pioneer bonus

`pioneerBonusXp(wave, lifetimeHighestWave)` = `xpPerWaveClear(wave) * 2.0` when
`wave > lifetimeHighestWave`, else 0. Total for a record wave is 3x the normal
clear XP.

### §5.1 XP curve (polynomial + geometric hybrid)

XP to go from level L-1 to level L:

```
25 * (L-1)^1.6 * 1.028^(L-2)
```

Polynomial early (first twenty levels inside the first hour), geometric late
(cap is a horizon). `TOWER_XP_TABLE` is cumulative with `TOWER_LEVEL_CAP + 1`
entries. `xpToLevel` binary-searches it.

### §5.2 Talent points

`talentPointsAtLevel(level)` = `min(200, floor(level))`. One point per level,
capped at `TOWER_LEVEL_CAP` (200). No bonus every 5th level.

## Upgrade Value Computation (`computeUpgradeValue`)

```typescript
if (def.scaling):
  increments = step > 0 ? floor(level / step) : (level - 1)
  value = base + perLevel * increments
  clamp to cap (min/max)
else:
  value = effectPerLevel * level
```

## Tower Base Stats (`src/data/tower.ts`)

- Damage: 0, Fire Rate: 1 (active: 1.3), Range: 280
- Crit: 5% chance, 2x multiplier
- HP: 0, Health Regen: 0
- Defense: 0, Armor: 0
- Projectile Speed: 720 px/s

The tower itself has no base damage or HP. Both are provided by the `damage` and `health` upgrades, which start at L1. Their starting totals are defined by their upgrade formulas (see `src/data/upgrades.ts`).

## Enemy Definitions (`src/data/enemies.ts`)

13 types with individual: baseHP, baseSpeed, armor, magicResist, baseDamage, fireRate, baseGold, radius, shape, color.

## Upgrade Definitions (`src/data/upgrades.ts`)

29 upgrades (11 tower, 5 economy, 4 utility, 9 defense) each with: id, name, description, baseCost, costGrowth, effectPerLevel, effectType (add/mult), maxLevel, category, optional scaling config.

## Ability Definitions (`src/data/abilities.ts`)

10 abilities, each upgradable 1 → `maxLevel` (10; Rocket Barrage goes to 15): id, name, description, manaCost, cooldown, duration, effectType (`aoe_damage` / `slow` / `fire_rate_buff` / `gold_buff` / `single_target_damage` / `chain_damage` / `crit_buff` / `lifesteal_buff` / `execute_damage` / `rocket_barrage`), effectValue, hotkey (1–9 plus 0), **unlockWave**, **maxLevel**, **upgradeBaseCost**, **upgradeCostGrowth**, **cooldownReductionPerLevel**, **effectValuePerLevel**, **durationPerLevel**, **xpPerCast**, and — for Rocket Barrage's volley — optional `effectCount` / `effectCountPerLevel`.

Mana-cost growth is **not** a per-def field anymore. `MANA_COST_GROWTH_PER_LEVEL = 0.08` (a fraction of the level-1 cost, applied per level above 1) and the `abilityManaCost(def, level)` helper in `src/data/abilities.ts` are the single source — `computeEffectiveStats`, `AbilityManager.getBaseManaCost` and the §7 tooltip all route through it. See `docs/ability-system.md` for the per-ability table.

### Effect Type Behaviours

- `single_target_damage` (Meteor Strike): heavy hit on highest-HP enemy, 2× splash to all enemies within 60 px of the impact.
- `chain_damage` (Chain Lightning): bounces start at the nearest enemy to the tower; each subsequent bounce picks the nearest unhit enemy within 200 px. Damage = `towerDamage × value × 0.65^index × damageMultiplier`. Bounces = `5 + floor(level / 2)`, capped at 9 (talents can push both).
- `crit_buff` (Precision Shot): adds `(value / 100)` to the tower's crit chance (clamped to 1.0) and multiplies crit damage by `precisionCritMultiplier(level)` = `1.5 + 0.1 × (level − 1)` for the duration.
- `lifesteal_buff` (Vampiric Aura): **adds** `value` (`+6% +2%/level`) to the tower's lifesteal and adds `vampiricRegen(level)` = `1% + 0.5% × (level − 1)` of maxHP/s regen for the duration.
- `execute_damage` (Execute): instantly kills non-boss enemies below `value%` HP; deals 4.2× damage to bosses below `value / 2%` HP. (The boss multiplier was 5× pre-v16; the shot-cadence rebase divided it by 1.2 with everything else whose cadence is a cooldown, see `plans/firerate.md` Part B.)
- `rocket_barrage` (Rocket Barrage): fires `floor(effectCount)` homing rockets (`6 + 0.3/level`, so ~10 at L15), each dealing `effectValue × towerDamage` (`1.65 + 0.21/level`) through the normal impact path with a half-damage splash in a 60 px blast. (Pre-v16: 2 + 0.25/level; see `plans/firerate.md` Part B.)

## Prestige Perks (`src/data/prestige.ts`)

- 13 AP perks in four tiers + 18 TP perks across three branches (`wrath` / `fortune` / `dominion`)
- Each: id, name, description, costPerLevel, costScaling, maxLevel, effectType, optional `baseEffect`, `automationKey`, `branch`, `tier`, `prerequisites` (OR-based), `exclusive`
- `PRESTIGE_PROJECTILE_TUNING` carries the per-lane `damageScale` for the three projectile perks (0.55 / 0.55 / 0.35)
- AP/T perk lookup tables: `AP_PERK_BY_ID`, `TP_PERK_BY_ID`

## Research Nodes (`src/data/research.ts`)

18 nodes each with: id, name, description, cost, category (combat/economy/arcane/scouting), effectType (pierce/gold_multi/gold_luck/mana_regen/ability_cost/start_wave), effectValue, prerequisites array.

## Pacing (`src/data/pacing.ts`)

Gameplay plan §7. Four mechanics whose numbers live together because they are
balanced together — the early-call bonus, the combo meter and the risk dial are
all gold faucets pointed at the same curve, and `npm run sim` measures the three
against one table.

| Constant / function | Value                                               | Notes |
|---|-----------------------------------------------------|---|
| `EARLY_CALL_GOLD_PER_SECOND` | `0.01`                                              | Gold per second of intermission skipped (§7.1) |
| `MOMENTUM_CAP` | `0.06`                                              | Ceiling on the accumulated momentum counter |
| `COMBO_WINDOW_SECONDS` | `2`                                                 | **Simulation** seconds a combo survives without a kill |
| `COMBO_TIERS` | 10/25/50/100 kills → +10/20/50/100% gold **and** XP | |
| `comboTierIndex(kills)` | 0-4                                                 | 0 = no combo; doubles as the meter's pip count |
| `MAX_RISK` | `5`                                                 | The dial is `0..5` inclusive |
| `RISK_HP_PER_STEP` | `0.18`                                              | Additive per step, like `ENRAGE_DAMAGE_PER_STACK` |
| `RISK_SPEED_PER_STEP` | `0.08`                                              | |
| `RISK_GOLD_PER_STEP` | `0.25`                                              | |
| `RISK_AP_PER_STEP` | `0.10`                                              | Multiplied into `previewAP`, outside the +50% banked cap |
| `OVERKILL_CARRY_BASE` | `0.10`                                              | Raised to `BLESSING_TUNING.overkillCarry` (0.25) by the card |
| `BASE_INTERMISSION_SECONDS` | `5`                                                 | Re-exported by `WaveManager` as `WAVE_INTERMISSION` |
| `intermissionSecondsForWave(w)` | 5 / 3 / 2                                           | Steps past wave 20 and wave 50 |
| `intermissionFactorForWave(w)` | 1 / 0.6 / 0.4                                       | Multiplied into `intermissionMultiplier` |
| `ENEMY_THREAT_CLASS` | `Record<EnemyType, 'trash' \| 'threat' \| 'boss'>`  | Which types the §7.3 preview names |

### Why nothing here is priced per shot or per kill

The follow-up to Part 4 recorded the lesson twice: a bonus denominated in *one
shot* is not a constant, because it is divided by every fire-rate purchase the
player will ever make; Part 6 found the mirror image, where the same shape was
far *too* strong at low fire rate. Nothing in this table is denominated that
way. The early-call bonus is per second of intermission, and a second is the
same length at every tower size. The combo's tiers are counted in *kills within
a window*, which is throughput-proportional by construction — a tower with twice
the fire rate reaches tier 3 twice as fast and holds it just as long, so the
tier tracks how the wave is going rather than how many upgrades are bought. Risk
and the combo pay as gold multipliers, which scale with the curve. Overkill
carry is a fraction of damage *already dealt*.

The lesson fed back into the v16 shot-cadence rebase: Vorpal Arrows and
Adrenaline Rush *were* priced per shot (1.5% instant-kill at L60, ceiling
18.4% per shot at L30, respectively). The cadence cut shaved their per-second
value by the same `1 / fireRateRatio` factor as everything else; both were
raised to restore across-shot value rather than removed — Vorpal landed at
**2.5%** and Adrenaline Rush at **27.6% per shot** at the same caps. See
[`plans/firerate.md`](../plans/firerate.md) for the full table and the
uptime-formula derivation.

### Where the plan's numbers moved, and why

Two of §7's stated values did not survive measurement. Both are recorded in full
at their definitions; in short:

- **§7.1's +3%/second capped at +40%** measured at four times what the curve can
  pay for. Momentum is a flat multiplier on an active run's gold, and the
  idle-parity budget was already spent before Part 7 opened; at +40% the active
  advantage measured +60-69% against a +50% hard gate. Cut proportionally to
  1%/s and +6%, which is the only way to cut it — the cap has to sit a few calls
  above one call's worth or momentum stops being a streak.
- **§7.2's 5/12/25/40** measured at +8.0% of a deep wave's entire income, and
  moved the 0-AP idle wall a full boss decade on six of eight draft seeds. The
  combo is a *baseline* faucet — nothing the player does builds it — and §7.2's
  only stated compensation (cutting `kill_streak_gold`) cannot pay for it,
  because that evolution is a level-25 unlock while the combo pays from wave 1.
  Shipped at roughly half: 3/6/12/20.

`kill_streak_gold` (the Avarice evolution) took its cut here, and the upgrades
revamp then cut it again and put a ceiling on it: it now pays **+2.5% per
consecutive kill to a hard +75%** (`AVARICE_STREAK_GOLD_CAP`). A deep wave can
sustain a streak as long as its own enemy count, so uncapped this one purchase
was worth over +200% gold.
