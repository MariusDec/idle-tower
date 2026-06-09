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

17 upgrades each with: id, name, description, baseCost, costGrowth, effectPerLevel, effectType (add/mult), maxLevel, category, optional scaling config.

## Ability Definitions (`src/data/abilities.ts`)

9 abilities (slots 1–4 general purpose, 5–9 boss-killing kit), each upgradable 1 → 10: id, name, description, manaCost, cooldown, duration, effectType (`aoe_damage` / `slow` / `fire_rate_buff` / `gold_buff` / `single_target_damage` / `chain_damage` / `crit_buff` / `lifesteal_buff` / `execute_damage`), effectValue, hotkey (1-9), **unlockWave**, **maxLevel**, **upgradeBaseCost**, **upgradeCostGrowth**, **manaCostPerLevel**, **cooldownReductionPerLevel**, **effectValuePerLevel**, **durationPerLevel**. See `docs/ability-system.md` for the per-ability table.

### New Effect Types (slots 5–9)

- `single_target_damage` (Meteor Strike): heavy hit on highest-HP enemy, 2× splash to all enemies within 60 px of the impact.
- `chain_damage` (Chain Lightning): bounces start at the nearest enemy to the tower; each subsequent bounce picks the nearest unhit enemy within 200 px. Damage = `towerDamage × value × 0.65^index × damageMultiplier`. Bounces = `5 + (level - 1)`, capped at 9.
- `crit_buff` (Precision Shot): adds `(value / 100)` to the tower's crit chance (clamped to 1.0) and 1.5× to the crit multiplier for the duration.
- `lifesteal_buff` (Vampiric Aura): multiplies the tower's lifesteal by `value` and adds +1% maxHP/s regen for the duration.
- `execute_damage` (Execute): instantly kills non-boss enemies below `value%` HP; deals 5× damage to bosses below `value / 2%` HP.

## Prestige Perks (`src/data/prestige.ts`)

- 5 AP perks + 6 TP perks
- Each: id, name, description, costPerLevel, maxLevel, effectType, optional automationKey
- AP/T perk lookup tables: `AP_PERK_BY_ID`, `TP_PERK_BY_ID`

## Research Nodes (`src/data/research.ts`)

8 nodes each with: id, name, description, cost, category (combat/economy/arcane/scouting), effectType (pierce/gold_multi/gold_luck/mana_regen/ability_cost/start_wave), effectValue, prerequisites array.
