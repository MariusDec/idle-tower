# Tower System

**Files:** `src/systems/Tower.ts`, `src/data/tower.ts`

## Tower State (`TowerState` in `types.ts`)

| Field | Default | Description |
|-------|---------|-------------|
| `x, y` | canvas center | Position |
| `baseDamage` | 5 | Raw damage per shot |
| `fireRate` | 1 | Shots per second (normal mode) |
| `activeFireRate` | 1.3 | Shots per second (manual aim mode) |
| `range` | 280 | Targeting radius in pixels |
| `critChance` | 0.05 | 5% base crit |
| `critMultiplier` | 2 | Double damage on crit |
| `damageType` | `'physical'` | Physical vs magic (affects resist calc) |
| `targetingMode` | `'nearest'` | Targeting strategy |
| `hp` | 5 | Current tower health |
| `maxHp` | 5 | Max tower health |
| `healthRegen` | 0 | % of max HP regen per second |
| `defense` | 0 | Flat damage reduction |
| `armor` | 0 | % damage reduction |
| `knockbackForce` | 0 | Pushback on hit |
| `shockwaveSize` | 0 | Periodic pushback radius |
| `shockwaveCooldown` | 0 | Time between shockwaves |
| `lifesteal` | 0 | Fraction of damage healed |

**Visual constants** (`src/data/tower.ts`):
- `TOWER_VISUAL.bodyRadius: 28`
- `PROJECTILE_SPEED: 720` pixels/sec
- `TOWER_HIT_RADIUS: 32` (bodyRadius + 4) — enemies touching this are in melee range

## Targeting (`Tower.acquireTarget`)

1. Filter enemies within `range^2` distance squared
2. Apply mode:
   - `'nearest'` — closest to tower
   - `'lowest_hp'` — lowest current HP
   - `'first'` — closest to tower (same as nearest)
3. Returns `Enemy | null`

## Damage Calculation

**Shot roll** (`rollShot`):
- `isCrit = Math.random() < critChance`
- `damage = isCrit ? baseDamage * critMultiplier : baseDamage`

**Resistance application** (`applyResists`):
- Physical: `damage -= enemy.armor` (min 1)
- Magic: `damage *= (1 - enemy.magicResist)` (min 1)

**Fire rate** (`effectiveFireRate`):
- Normal mode: `fireRate * fireRateMultiplier`
- Manual aim (mouse held): `activeFireRate * fireRateMultiplier`
- `consumeCooldown`: `cooldown = 1 / effectiveFireRate`

## Manual Aim Mode

- When mouse is held down on canvas, tower enters active mode
- Tower targets the mouse cursor position instead of auto-acquiring enemies
- Uses `activeFireRate` (faster base) instead of `fireRate`
- Aim line is rendered (currently disabled — `if (true || !snap.aimLine) return`)

## Upgrade Effects Applied (from `Game.applyUpgradeEffects`)

All upgrades reset tower stats to base, then accumulate from `UpgradeManager` levels:
- `damage` → additive to `baseDamage`
- `fireRate` → additive to `fireRate`
- `range` → additive to `range`
- `critChance` → additive (capped at 100%)
- `critDamage` → additive to `critMultiplier`
- `health` → additive to `maxHp`
- `healthRegen` → set to total value
- `defense` → set to total value
- `armor` → set to total value
- `knockbackForce` → set to total value
- `lifesteal` → set to total value
- `shockwave` → `size = 110 + (level-1)*5`, `cooldown = max(3, 30 + (level-1)*-0.5)`

Plus prestige bonuses:
- Lifetime AP: `damage *= (1 + lifetimeAP * 0.02)`
- TP damage perk: multiplicative factor
