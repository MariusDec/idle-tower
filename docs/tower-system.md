# Tower System

**Files:** `src/systems/Tower.ts`, `src/data/tower.ts`

## Tower State (`TowerState` in `types.ts`)

| Field | Default | Description |
|-------|---------|-------------|
| `x, y` | canvas center | Position |
| `baseDamage` | 0 | Raw damage per shot (provided by the damage upgrade at L1) |
| `fireRate` | 1.2 | Shots per second~~~~ |
| `range` | 300 | Targeting radius in pixels |
| `critChance` | 0.05 | 5% base crit |
| `critMultiplier` | 2 | Double damage on crit |
| `damageType` | `'physical'` | Physical vs magic (affects resist calc) |
| `targetingMode` | `'priority'` | Targeting strategy |
| `hp` | 0 | Current tower health (provided by the health upgrade at L1) |
| `maxHp` | 0 | Max tower health (provided by the health upgrade at L1) |
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

1. Filter to enemies that are **targetable** and within `range^2`
2. Apply the mode
3. Returns `Enemy | null`

The candidate filter is `isTargetable(enemy)`, not `enemy.alive`: a burrowed
burrower and a splitter child inside its spawn protection are on the field and
cannot be hit, so offering them here would stall the tower on a target it can
never damage. See [enemy-system.md](enemy-system.md#targetability).

| Mode | Picks |
|---|---|
| `'priority'` **(default)** | Warden → healer → thief → siege, nearest within each tier; then nearest overall |
| `'nearest'` | Closest to the tower |
| `'lowest_hp'` | Lowest current HP |
| `'strongest'` | Highest max HP |
| `'boss'` | Bosses first, then nearest |
| `'flying'` | Flying first, then nearest |
| `'last'` | Furthest away (backline) |

`'priority'` is the default for new games (`TOWER_BASE.targetingMode`). With the
behavioural roster on the field, "nearest" is now actively a bad default: the
enemy that matters — a warden shielding the line, a thief carrying your gold to
the edge — is rarely the closest one. The order lives in `PRIORITY_TARGET_ORDER`
(`src/data/enemies.ts`).

**`'first'` is gone.** It was a dead alias of `'nearest'`; a save carrying it is
migrated to `'nearest'` in `Game.applyPersistedState`, deliberately *not* to the
new `'priority'` default, because silently changing how an existing run plays is
worse than leaving it on the mode it actually had.

### Where the selector lives

The mode is a live tactical choice, not a preference, so the dropdown sits in
the HUD next to the wave controls (`hud-targeting-select`). The Settings panel
keeps a copy for players who have always changed it there; both render from
`TARGETING_MODES` in `src/data/tower.ts` and share one `TargetingAPI` object, so
they cannot drift or disagree.

## Damage Calculation

**Shot roll** (`rollShot`):
- `isCrit = Math.random() < critChance`
- `damage = isCrit ? baseDamage * critMultiplier : baseDamage`

**Resistance application** (`applyResists`):
- Physical: `damage -= enemy.armor` (min 1)
- Magic: `damage *= (1 - enemy.magicResist)` (min 1)

**Fire rate** (`effectiveFireRate`):
- Normal mode: `fireRate * fireRateMultiplier`
- Manual aim (mouse held): `fireRate * 30% * fireRateMultiplier`
- `consumeCooldown`: `cooldown = 1 / effectiveFireRate`

## Manual Aim Mode

- When mouse is held down on canvas, tower enters active mode
- Tower targets the mouse cursor position instead of auto-acquiring enemies
- Applies a 30% increase to `fireRate`
- Aim line is rendered (currently disabled — `if (true || !snap.aimLine) return`)

## Upgrade Effects Applied

Composed by `resolveStats` and written by `Game.applyResolvedStats` — see
[stat-pipeline.md](stat-pipeline.md). The tower itself computes nothing.

All upgrades reset tower stats to `TOWER_BASE` (which is 0 for damage/HP), then accumulate from `UpgradeManager` levels. `damage` and `health` start at L1 via `startLevel: 1`, so the tower spawns with the L1 totals:
- `damage` → additive to `baseDamage`
- `fireRate` → additive to `fireRate`
- `range` → additive to `range`
- `critChance` → additive (capped at 100%)
- `critDamage` → additive to `critMultiplier`
- `health` → additive to `maxHp` (and `hp` is set to `maxHp` on first gain)
- `healthRegen` → set to total value
- `defense` → set to total value
- `armor` → set to total value
- `knockbackForce` → set to total value
- `lifesteal` → set to total value
- `shockwave` → `size = 110 + (level-1)*5`, `cooldown = max(3, 30 + (level-1)*-0.5)`

Plus prestige bonuses:
- Lifetime AP: `damage *= (1 + lifetimeAP * 0.02)`
- TP damage perk: multiplicative factor
