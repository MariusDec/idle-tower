# Tower System

**Files:** `src/systems/Tower.ts`, `src/data/tower.ts`

## Tower State (`TowerState` in `types.ts`)

| Field | Default | Description |
|-------|---------|-------------|
| `x, y` | canvas center | Position |
| `baseDamage` | 0 | Raw damage per shot (provided by the damage upgrade at L1) |
| `fireRate` | 0.9 | Shots per second |
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

## Upgrade marks

A **mark** is a small integer 0..N derived from one or two upgrade levels by a
threshold table in `src/data/towerMarks.ts`. It is **presentation only**: `Game`
computes it, the render snapshot carries it, `Renderer` paints with it, and
nothing anywhere branches on it for behaviour. The tower's `detailTiers` do the
same job for tower-XP level; this is the same idea for the thing the player
spends gold on.

`computeTowerMarks(levels)` is called only when upgrade levels change — never
per frame. The result is frozen, stamped with a precomputed cache key, handed
to every snapshot as the same object, and reused by the renderer's "did this
change" check as a reference compare rather than sixty string builds a second.
The precomputed `key` is the `marks.key` value; it is concatenated with the
core and the detail tier to form the full `towerSig` that decides when the
evictable `towerSprites` cache is dropped wholesale (see
[performance.md](performance.md#renderer-sprite-cache)).

### The mark → anatomy map

Each mark owns a **distinct piece of the tower**, so ten marks compose into one
object instead of fighting over the same pixels.

| Mark | Fed by | Anatomy it rebuilds | Painted in |
|---|---|---|---|
| `barrel` | `damage` | the turret barrel — length, bands, blade, prongs, inlay | `drawTurret` |
| `autoloader` | `fireRate` | magazine drums and feed rails at the breech | `drawTurret` |
| `optics` | `critChance` + `critDamage` | sight post, scope tube, lens and crosshair | `drawTurret` |
| `masonry` | `health` | courses, merlon count, arrow slits, parapet, buttresses | `paintDrum`, `paintPlinth` |
| `plating` | `defense` + `armor` | riveted iron straps, girdle plate, faceted plate ring | `paintDrum` |
| `gilding` | `goldMulti` + `prospecting` | gilded joints, filigree, coin studs, banner fringe | `paintDrum` |
| `conduits` | `manaRegen` + `maxMana` | violet channels feeding the crystal, and a live pulse | `paintDrum`, `drawTowerTop` |
| `mast` | `range` | a spotter's mast, pennant, lantern; ticks on the range rim | `paintDrum`, `drawRangeRing` |
| `resonator` | `shockwave` | raised emitter rings on the plinth face | `paintPlinth` |
| `bulwark` | `wall` | merlon caps, thicker blocks, iron banding on the wall ring | `getWallSegment` |

Colour discipline, per [art-direction.md](art-direction.md):

- Stone is the `INK` ramp (`TOWER_VISUAL.stoneLit/Mid/Dark/Deep`, `mortar`,
  `plinth`).
- Everything the player *owns* is `FX.gold` (`TOWER_VISUAL.rim`,
  `TOWER_VISUAL.banner`).
- Iron plate is `INK['200']` — colder and brighter than stone, so plating reads
  as a different material rather than as lighter masonry.
- Mana conduits are `FX.mana`. Resonator nodes are `FX.frost` (its evolution is
  a slow).
- **`FX.blood` and `FX.critical` appear nowhere on the marks.** Blood means "an
  enemy" and critical means "the tower is in peril"; a purchase is the
  opposite of both.

## Targeting (`Tower.acquireTarget`)

1. Filter to enemies that are **targetable** and within `range^2`
2. Apply the mode
3. Returns `Enemy | null`

The candidate filter is `isTargetable(enemy)`, not `enemy.alive`: a burrowed
burrower and a splitter child inside its spawn protection are on the field and
cannot be hit, so offering them here would stall the tower on a target it can
never damage. See [enemy-system.md](enemy-system.md#targetability).

### Lock-on

The chosen target is **remembered across shots**. Every mode keeps it until the
enemy dies, leaves the field, leaves range, or becomes un-targetable — a
second, better candidate of the same mode does not pull fire. This is what lets
a `nearest` tower finish a kill instead of hopping between two enemies whose
distances cross mid-volley, and it changes what `lowest_hp`/`strongest` mean:
they pick "the weakest/strongest enemy *when I picked*", then commit.

The lock is dropped by anything that should re-open the question:

- the locked enemy dies, leaves the list, leaves range, or fails `isTargetable`
- the mode is changed (`setTargetingMode` clears it — a new mode means new rules)
- manual aim begins (`Game.setMouseInput` calls `clearTargetLock` on the
  rising edge, so releasing the hold re-acquires fresh; a press consumed by an
  orb or ability placement never raises `isDown` and does not disturb the lock)
- any run reset (`Game.clearSave` / `applySavedStateReset`), so a stale enemy
  object never crosses the run boundary

`priority` makes one exception: a **higher-tier** enemy appearing in range and
targetable displaces the lock immediately — a warden showing up unseats a
locked healer, and any listed type unseats a locked trash mob, because that
enemy's *job* is the problem. Equal-tier enemies never displace each other.

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
- `fireRate * fireRateMultiplier`, in every mode
- `consumeCooldown`: `cooldown = 1 / effectiveFireRate`

## Shot Cadence

Two stats compose the tower's per-second damage output, and each has exactly one
additive source so the curve stays predictable: `baseDamage` from the `damage`
upgrade, and `fireRate` from the `fireRate` upgrade. The shot-cadence rebase
shipped in v16 cut the fire-rate additive ceiling from 5.50 down to **3.15 shots/s
at L45** (~57% of the old cap), then raised `damage` by 1.2x to pay part of it
back. Net effect on DPS by depth: deliberately **down ~30% at deep waves** (where
the cadence cap used to dominate) and **up ~8% at the opener** (where the
damage bump outweighs the lost fire rate before the player has bought into
fireRate). The discipline is that the cap on `fireRate` + 1.2x `damage` is the
only DPS axis — no separate "attack speed" upgrade, no per-shot procs that are
priced in *one* shot (those got the same x1.5 raise; see the links below).

Saves are unaffected by the rebase: tower stats are recomputed from upgrade
levels each load, not persisted, so players don't lose progress when the
formulas change.

Full reasoning, before/after tables, and the per-shot proc list live in
[`plans/firerate.md`](../plans/firerate.md).

## Manual Aim Mode

- When mouse is held down on canvas, tower enters active mode
- Tower targets the mouse cursor position instead of auto-acquiring enemies
- **No fire-rate bonus.** Holding used to be worth a flat x1.3, which the
  gameplay plan's §0.1 named as the game's first design problem: it was
  strictly better than not holding, so it was a tax on attention rather than a
  choice, and §4.5 measured it filling the entire active-play budget on its own
  (+33.9…+38.9%) before the charged shot contributed anything.
- What holding buys instead is the **charged shot** (see
  [loot-system.md](loot-system.md) §4.2). The trade is real in both directions:
  while the button is down the tower fires at the cursor rather than
  auto-acquiring, so holding without ever releasing a charge is *worse* than
  never touching the mouse.
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
