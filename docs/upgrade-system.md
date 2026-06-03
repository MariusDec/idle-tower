# Upgrade System

**Files:** `src/systems/UpgradeManager.ts`, `src/data/upgrades.ts`

## Upgrade Manager (`UpgradeManager`)

- Tracks upgrade levels in a `Record<string, number>`
- Provides: buy, cost check, max check, snapshot, reset, replace
- Emits `upgrade_purchased` and `upgrades_changed` events on purchase

## Cost Formula

```
cost = floor(baseCost * growth^level)
```

## 17 Upgrades

### Tower (5)
| ID | Name | baseCost | growth | effect/level | maxLevel |
|----|------|----------|--------|-------------|----------|
| damage | Sharper Arrows | 50 | 1.15 | +2 damage | 999 |
| fireRate | Quick Draw | 75 | 1.25 | +0.1 fire rate | 999 |
| range | Longbow | 40 | 1.15 | +5 range | 999 |
| critChance | Eagle Eye | 200 | 1.50 | +2% crit | 999 |
| critDamage | Heavy Quiver | 250 | 1.45 | +10% crit dmg | 999 |

### Economy (1)
| ID | Name | baseCost | growth | effect/level | maxLevel |
|----|------|----------|--------|-------------|----------|
| goldMulti | Greed | 100 | 1.25 | +5% gold | 999 |

### Utility (1)
| ID | Name | baseCost | growth | effect/level | maxLevel |
|----|------|----------|--------|-------------|----------|
| manaRegen | Meditation | 150 | 1.30 | +0.5 mana/s | 999 |

### Defense (10)
| ID | Name | baseCost | growth | effect/level (scaling) | maxLevel |
|----|------|----------|--------|----------------------|----------|
| health | Health | 50 | 1.07 | base 5, +5.2/level | 999 |
| healthRegen | Health Regen | 80 | 1.25 | base 0.01, +0.002/level, cap 0.7 | 224 |
| defense | Defense | 60 | 1.05 | base 1, +1.5/level | 999 |
| armor | Armor | 150 | 1.15 | base 0.02, +0.004/level, cap 0.8 | 200 |
| knockbackForce | Knockback Force | 180 | 1.08 | base 5, +5/level | 999 |
| shockwave | Shockwave | 250 | 1.15 | +1 level (size/cooldown formula) | 50 |
| thorns | Thorns | 220 | 1.20 | base 0.05, +0.01/level | 999 |
| lifesteal | Lifesteal | 250 | 1.12 | base 0.03, +0.0025/level | 999 |
| landMines | Land Mines | 400 | 1.12 | base 1, +0.5/level | 999 |
| defenseShield | Defense Shield | 500 | 1.35 | base 1, +1/50lvl, cap 5 | 250 |
| wall | Wall | 350 | 1.10 | base 0.25, +0.02/level | 999 |

## Upgrade Effects Application (`Game.applyUpgradeEffects`)

Called whenever upgrades change or research/prestige updates:
1. Reset all tower stats to `TOWER_BASE`
2. For each upgrade with level > 0, compute value and add to appropriate stat
3. Apply prestige bonuses (AP lifetime damage, TP damage, TP resource)
4. Apply research bonuses (gold multi, mana multi, ability cost reduction)
5. Apply research pierce to projectiles
6. Apply wave skip chance to wave manager

## Upgrade Panel

3 sub-tabs in UI: Attack, Defense, Utility (economy grouped in Utility).
Each shows: name, current level, cost, description. Click to buy.
