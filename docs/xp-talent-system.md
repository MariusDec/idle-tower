# Tower XP & Talent Tree

Character-level progression that persists through both prestige layers.

## Tower XP (`TowerXpManager`, `src/data/xpTables.ts`)

| Source | Function |
|---|---|
| Enemy kill | `xpPerKill(type, wave)` |
| Wave clear | `xpPerWaveClear(wave)` |
| Pioneer bonus | `pioneerBonusXp(wave, lifetimeHighestWave)` |

### Kill XP

`xpPerKill` = `KILL_XP_WEIGHT[type] * killXpWaveScale(wave)`, floored at 1.
`KILL_XP_WEIGHT` is a per-type table (normal: 1, boss: 12, thief/warden: 2.4,
etc.) that tracks how much *attention* a type costs, not its HP bar.
`killXpWaveScale(wave)` = `1 + 0.20 * wave`, so a wave-200 kill is 41x a
wave-1 kill. The scale is linear so the roster weights stay legible.

### Wave-clear XP

`xpPerWaveClear(wave)` = `1.5 * wave^1.5`, floored at 1. This is superlinear:
clearing deep waves is the real XP faucet.

### Pioneer bonus

Clearing deeper than you ever have pays the clear XP again, doubled
(`PIONEER_CLEAR_MULTIPLIER = 2.0`). Total for a record wave is therefore 3x
the normal clear XP.

### XP curve (polynomial + geometric hybrid)

The requirement to go from level L-1 to level L is:

```
XP_CURVE_BASE * (L-1)^XP_CURVE_POLY * XP_CURVE_GEO^(L-2)
```

with `XP_CURVE_BASE = 25`, `XP_CURVE_POLY = 1.6`, `XP_CURVE_GEO = 1.028`.

Polynomial early (so the first twenty levels land inside the first hour) and
geometric late (so the cap is a horizon rather than a milestone). The old curve
was polynomial all the way, which is why XP gain — itself ~w^2 per wave —
outran it and the tree filled in one run.

`TOWER_XP_TABLE` is cumulative, with `TOWER_LEVEL_CAP + 1` entries (index 0
unused, index 1 is 0). `xpToLevel` binary-searches it (it runs on every kill).
`xpForNextLevel` and `getProgressToNextLevel` drive the HUD bar.

`setXpGainMultiplier` carries research/prestige/evolution XP bonuses (including
the Enlightenment evolution, which is now an XP multiplier rather than a
talent-point faucet).

## 1-based levels

A fresh save starts at level 1, not level 0. The v17 migration converts old
0-based levels to 1-based (`level = oldLevel + 1`, clamped to the cap).

## Talent points

`talentPointsAtLevel(level)` = `min(200, floor(level))`. One talent point per
level, capped at `TOWER_LEVEL_CAP` (200). No bonus every 5th level — the old
`TALENT_BONUS_LEVEL_INTERVAL` mechanic is removed.

On level-up `TowerXpManager` grants the *delta* between the two levels' totals,
which is what makes a multi-level jump grant the right number.

## Talent tree (`TalentManager`, `src/data/talentTree.ts`)

60 talents across 4 branches (Wrath, Bulwark, Fortune, Arcana), arranged in a
lattice of 5 rows × 3 columns per branch, plus one endless node per branch.

### Branch layout

Each branch has 15 non-endless nodes (rows 1-5, 3 per row) and 1 endless node.
Row 5 contains three **keystones** in an `exclusiveGroup` — the player picks
one. The endless node sits below an overflow divider and has `maxPoints: 999`.

### Gate rules

- **`requiresBranchPoints`**: each row has a branch-point gate (row 2: 4, row
  3: 12, row 4: 22, row 5: 32). The player must have that many points invested
  in the branch before any node in that row unlocks.
- **`prerequisites`**: most nodes require ≥1 rank in one or more parent nodes.
- **`exclusiveGroup`**: keystones (row 5) are mutually exclusive — taking one
  blocks the other two in the same branch.

### Effects and behaviours

Each talent declares `effects` (an array of `{ stat: TalentStat, perPoint:
number }`) and optionally a `behavior` from the `TalentBehavior` union.

`TALENT_BEHAVIOR_CONSUMERS` maps each behaviour to the code that consumes it:

| Behaviour | Consumer |
|---|---|
| `relentless` | `Game.simulate` (shot cadence) → `ProjectileManager.fire` |
| `retaliation` | `Game` hostile-shot resolution → `EnemyManager.damage` (thorns) |
| `juggernaut` | `Game.damageTower` (wall check) + wall-break handler |
| `archivist` | `TalentManager.respecCost` → 0 |
| `quartermaster` | `AutomationManager.runAutoBuy` (ability upgrades + gold reserve) |
| `archmage` | `Game` ability_cast handler → `BuffRegistry` (fireRate) |
| `battery` | `stats/contributors/talents` (reads `ctx.manaFraction`) |

`ar_frostbite` (Magic, row 3) is the tree's cold node and carries three stats per point: `+8%`
slow effect, `+7%` chilled damage, and `+5%` **ability area** (`ability_area_pct` →
`abilityAreaMultiplier`). The area stat is what makes a cold build's Frost Nova disc grow as it is
invested in; it stacks multiplicatively with the `arcane_expansion` research and the arcane core,
inside the `[0.5, 3]` clamp on the stat key.

### TalentStat is a closed union

`TALENT_STATS` is a `const` array; `TalentStat` is derived from it.
`contributors/talents.ts` switches exhaustively over it, so a new talent whose
stat has no consumer is a **compile error**. Do not widen the switch with a
`default` branch that silently swallows unknown stats.

`TalentManager.getAllEffectValues()` returns the summed value per stat; `Game`
drives the switch from that map once per stat recompute.

### Respec

`talentRespecCost(p)` = `floor(250 * p^1.35)`, where `p` is the number of
points being refunded. `branchRespecCost` and `fullRespecCost` charge that gold
and return the points to the unspent pool; both refuse and change nothing if the
gold is not there. The `archivist` keystone reduces the cost to 0.

## Persistence

Tower XP, level and talent allocation survive **both** ascension and
transcendence. Only gold, upgrades, ability levels and the ascension layer
reset.

## Presentation: the tree is DOM, not canvas

`TalentPanel.ts` renders per-branch CSS Grid layouts of nodes. The grid uses
`grid-template-columns: 30px repeat(5, minmax(46px, 1fr))` — a 30px gutter
column for gate chips, then 5 columns for the 3 node columns plus spacing.

**Gate chips** sit in the gutter column at each gated row, showing the branch
point requirement (4, 12, 22, 32).

**SVG link layer** (`talent-link-layer`, one `<svg>` per branch,
`pointer-events: none`) draws orthogonal elbow paths between prerequisite nodes.
Geometry is measured with `getBoundingClientRect()` relative to the grid and
recomputed on mount, on `ResizeObserver`, and on tab switch — never per frame.

**Five node states**, distinguished by glyph and CSS class (never by colour
alone):

| State | Glyph | Meaning |
|---|---|---|
| `maxed` | ★ | All points invested |
| `spent` | ✓ | Some points invested, can allocate more |
| `available` | ○ | Can allocate (prereqs met, gate met, points available) |
| `gated` | (gate number) | Branch-point gate not yet met |
| `locked` | 🔒 | Prerequisites not met |

**Sticky detail card** at the bottom shows the selected node's name, rank,
description, effect deltas, and a Learn button. Click-to-select,
click-again-to-allocate interaction. Keyboard navigation with arrow keys
(Enter/Space to allocate, Escape to deselect).

**Keystone row** is marked "Choose one" — the three keystones in each branch
are mutually exclusive.

**Overflow divider** separates the main grid from the endless node, labeled
"Overflow — no limit".

**Pan/pinch is deliberately not implemented.** The branch panel is
`overflow: auto` with `touch-action: pan-x pan-y` and the platform scrolls it.
