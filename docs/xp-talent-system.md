# Tower XP & Talent Tree

Character-level progression that persists through both prestige layers.

## Tower XP (`TowerXpManager`, `src/data/xpTables.ts`)

| Source | Function |
|---|---|
| Enemy kill | `xpPerKill(type, wave)` |
| Wave clear | `xpPerWaveClear(wave)` |

`xpPerKill` scales with the enemy's *wave-scaled HP* through `log2`
(`enemyXpWeight`), not with a flat per-wave bonus. Before this, a wave-50 kill
was worth 2 XP no matter that the enemy had a thousand times the HP of a
wave-1 kill, and tower level froze in the teens.

`TOWER_XP_TABLE` is cumulative `120 * level^TOWER_XP_CURVE_EXPONENT` with the
exponent at 1.8, for 2 000 levels. `xpToLevel` binary-searches it (it runs on
every kill). `xpForNextLevel` and `getProgressToNextLevel` drive the HUD bar.

`setXpGainMultiplier` carries research/prestige XP bonuses.

## Talent points

`talentPointsAtLevel(level)` = one point per level, plus a bonus point every
`TALENT_BONUS_LEVEL_INTERVAL` (5th) level. On level-up `TowerXpManager` grants
the *delta* between the two levels' totals, which is what makes a multi-level
jump grant the right number.

## Talent tree (`TalentManager`, `src/data/talentTree.ts`)

37 talents across 4 branches (offense, defense, utility, magic), in tiers, with
`prerequisites` and an `exclusive` flag for mutually exclusive pairs.

Each talent declares `effect` and optionally `secondary`, both
`{ stat: TalentStat, perPoint: number }`.

### TalentStat is a closed union

`TALENT_STATS` is a `const` array; `TalentStat` is derived from it.
`Game.applyTalentEffect(stat, value, ...)` switches exhaustively over it, so a
new talent whose stat has no consumer is a **compile error**. This is the
mechanism that fixed the twenty inert talents the plan's §1.4 found — do not
widen the switch with a `default` branch that silently swallows unknown stats.

`TalentManager.getAllEffectValues()` returns the summed value per stat; `Game`
drives the switch from that map once per stat recompute.

### Respec

`branchRespecCost(branch)` and `fullRespecCost()` charge
`TALENT_RESPEC_COST_PER_POINT` (500) gold **per allocated point**.
`refundBranch` / `refundAll` charge that gold and return the points to the
unspent pool; both refuse and change nothing if the gold is not there.

## Persistence

Tower XP, level and talent allocation survive **both** ascension and
transcendence. Only gold, upgrades, ability levels and the ascension layer
reset.
