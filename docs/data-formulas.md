# Static Data & Formulas

## Formulas (`src/data/formulas.ts`)

| Function | Formula                                                 |
|----------|---------------------------------------------------------|
| `enemyHPForWave(baseHP, wave)` | `baseHP * 1.12^(wave-1)`                                |
| `bossHPForWave(baseHP, wave)` | `baseHP * 1.12^wave * 1.5^tier` (tier = floor(wave/10)) |
| `enemyDamageForWave(baseDamage, wave)` | `baseDamage + floor((wave-1)/5)`                        |
| `enemySpeedForWave(baseSpeed, wave)` | `baseSpeed * min(3, 1 + 0.03*(wave-1))`                 |
| `goldDropForWave(baseGold, wave)` | `baseGold * 1.1^(wave-1)`                               |
| `enemyCountForWave(wave)` | `5 + floor((wave-1) * 1.5)`                             |
| `spawnIntervalForWave(wave)` | `max(0.3, 2.0 - wave*0.05)`                             |
| `upgradeCost(base, growth, level)` | `floor(base * growth^level)`                            |
| `abilityUpgradeCost(base, growth, level)` | `floor(baseCost * growth^level)` (numeric growth only)  |
| `isBossWave(wave)` | `wave > 0 && wave % 10 === 0`                           |
| `apForWave(waveNumber)` | `max(0, floor(sqrt(waveNumber * 5)))` (if wave >= 20)   |
| `tpForAP(ap)` | `max(0, floor(log10(ap+1) * 3))` (if ap >= 100)         |

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

6 types with individual: baseHP, baseSpeed, armor, magicResist, baseDamage, fireRate, baseGold, radius, shape, color.

## Upgrade Definitions (`src/data/upgrades.ts`)

27 upgrades each with: id, name, description, baseCost, costGrowth, effectPerLevel, effectType (add/mult), maxLevel, category, optional scaling config.

## Ability Definitions (`src/data/abilities.ts`)

10 abilities, each upgradable 1 → `maxLevel` (10; Rocket Barrage goes to 15): id, name, description, manaCost, cooldown, duration, effectType (`aoe_damage` / `slow` / `fire_rate_buff` / `gold_buff` / `single_target_damage` / `chain_damage` / `crit_buff` / `lifesteal_buff` / `execute_damage` / `rocket_barrage`), effectValue, hotkey (1–9 plus 0), **unlockWave**, **maxLevel**, **upgradeBaseCost**, **upgradeCostGrowth**, **manaCostPerLevel**, **cooldownReductionPerLevel**, **effectValuePerLevel**, **durationPerLevel**, **xpPerCast**, and — for Rocket Barrage's volley — optional `effectCount` / `effectCountPerLevel`. See `docs/ability-system.md` for the per-ability table.

### Effect Type Behaviours

- `single_target_damage` (Meteor Strike): heavy hit on highest-HP enemy, 2× splash to all enemies within 60 px of the impact.
- `chain_damage` (Chain Lightning): bounces start at the nearest enemy to the tower; each subsequent bounce picks the nearest unhit enemy within 200 px. Damage = `towerDamage × value × 0.65^index × damageMultiplier`. Bounces = `5 + floor(level / 2)`, capped at 9 (talents can push both).
- `crit_buff` (Precision Shot): adds `(value / 100)` to the tower's crit chance (clamped to 1.0) and multiplies crit damage by `precisionCritMultiplier(level)` = `1.5 + 0.1 × (level − 1)` for the duration.
- `lifesteal_buff` (Vampiric Aura): **adds** `value` (`+6% +2%/level`) to the tower's lifesteal and adds `vampiricRegen(level)` = `1% + 0.5% × (level − 1)` of maxHP/s regen for the duration.
- `execute_damage` (Execute): instantly kills non-boss enemies below `value%` HP; deals 5× damage to bosses below `value / 2%` HP.
- `rocket_barrage` (Rocket Barrage): fires `floor(effectCount)` homing rockets (`6 + 0.3/level`, so ~10 at L15), each dealing `effectValue × towerDamage` (`2 + 0.25/level`) through the normal impact path with a half-damage splash in a 60 px blast.

## Prestige Perks (`src/data/prestige.ts`)

- 5 AP perks + 6 TP perks
- Each: id, name, description, costPerLevel, maxLevel, effectType, optional automationKey
- AP/T perk lookup tables: `AP_PERK_BY_ID`, `TP_PERK_BY_ID`

## Research Nodes (`src/data/research.ts`)

8 nodes each with: id, name, description, cost, category (combat/economy/arcane/scouting), effectType (pierce/gold_multi/gold_luck/mana_regen/ability_cost/start_wave), effectValue, prerequisites array.

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

`kill_streak_gold` (the Avarice evolution) still took its cut: **+5% → +4.7%**
per consecutive kill, derived so the *combined* bonus at the deepest streak a
wave can sustain (~50 kills, `(2.45 - 0.12) / 49`) matches the pre-change figure.
