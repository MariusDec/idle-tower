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
| ID | Name | baseCost | growth | effect/level | maxLevel | startLevel |
|----|------|----------|--------|-------------|----------|------------|
| damage | Sharper Arrows | 30 | 1.15 | base 3, +1.1^(L-1) | 999 | 1 |
| fireRate | Quick Draw | 50 | 1.20 | +0.06 fire rate | 100 | 0 |
| range | Longbow | 25 | 1.12 | +5 range | 60 | 0 |
| critChance | Eagle Eye | 120 | 1.35 | +1.2% crit | 95 | 0 |
| critDamage | Heavy Quiver | 150 | 1.35 | +12% crit dmg | 999 | 0 |

### Economy (1)
| ID | Name | baseCost | growth | effect/level | maxLevel |
|----|------|----------|--------|-------------|----------|
| goldMulti | Greed | 100 | 1.25 | +5% gold | 999 |

### Utility (1)
| ID | Name | baseCost | growth | effect/level | maxLevel |
|----|------|----------|--------|-------------|----------|
| manaRegen | Meditation | 150 | 1.30 | +0.5 mana/s | 999 |

### Defense (10)
| ID | Name | baseCost | growth | effect/level (scaling) | maxLevel | startLevel |
|----|------|----------|--------|----------------------|----------|------------|
| health | Health | 60 | 1.12 | base 3, +2/level | 999 | 1 |
| healthRegen | Health Regen | 130 | 1.3 | base 0.005, +0.001/level, cap 0.5 | 150 | 0 |
| defense | Defense | 120 | 1.22 | base 0.5, +0.25/level | 999 | 0 |
| armor | Armor | 140 | 1.18 | base 0.01, +0.003/level, cap 0.75 | 200 | 0 |
| knockbackForce | Knockback Force | 180 | 1.08 | base 5, +5/level | 999 | 0 |
| shockwave | Shockwave | 250 | 1.15 | +1 level (size/cooldown formula) | 50 | 0 |
| thorns | Thorns | 220 | 1.25 | base 0.05, +0.01/level | 999 | 0 |
| lifesteal | Lifesteal | 250 | 1.12 | base 0.03, +0.0025/level | 999 | 0 |
| landMines | Land Mines | 400 | 1.12 | base 0.5, +0.25/level | 999 | 0 |
| defenseShield | Defense Shield | 500 | 1.35 | base 60s, -0.5s/level, cap 7s | 55 | 0 |
| wall | Wall | 650 | 1.3 | base 0.2, +0.02/level | 40 | 0 |

## Upgrade Effects Application (`Game.applyUpgradeEffects`)

Called whenever upgrades change or research/prestige updates:
1. Reset all tower stats to `TOWER_BASE`
2. For each upgrade with level > 0, compute value and add to appropriate stat
3. Apply prestige bonuses (AP lifetime damage, TP damage, TP resource)
4. Apply research bonuses (gold multi, mana multi, ability cost reduction)
5. Apply research pierce to projectiles
6. Apply wave skip chance to wave manager

The `damage` and `health` upgrades both have `startLevel: 1`, so they ship at L1 out of the box and contribute to the tower's stats from frame 0. The first purchase moves them to L2 and pays the L1→L2 cost. The first-time `maxHp` gain (going from 0 to >0) sets `hp = maxHp` so the tower spawns with full health.

## Upgrade Panel

3 sub-tabs in UI: Attack, Defense, Utility (economy grouped in Utility).
Each shows: name, current level (or total/next for damage/health), cost, description. Click to buy.

For `damage` and `health`, the level text is replaced with the current total effect and the next level's increase (e.g. `15 +13`). The bonus and per-level delta rows are hidden for these two.
