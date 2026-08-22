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

## Presentation: the tree is DOM, not canvas (UI plan §8.D)

The UI plan's parent document asked for "keep the canvas, restyle it". There is
no canvas: `TalentPanel.ts` renders per-branch DOM lists of nodes. Rebuilding
them as a canvas would cost the tree its keyboard access, its screen-reader
text, its text selection and its free hit-testing, to buy curved lines — so the
DOM nodes stay and an **SVG link layer** (`.talent-link-layer`, one `<svg>` per
branch, `pointer-events: none`) draws the prerequisite edges behind them.

Geometry is measured with `getBoundingClientRect()` relative to the branch's
tree box (so it survives the panel's scroll and its resizable width) and is
recomputed on mount, on `ResizeObserver` of the visible tree, and on tab switch
— never per frame. Each pass reads every node rect first and writes every path
afterwards; interleaving would force a layout per node.

Links and nodes carry the same tri-state — `spent` / `available` / `locked` —
and never by colour alone: the link is solid gold, flowing dashed green, or a
thin static dash, and the node carries a check, a ring or a padlock plus an
`sr-only` label. The flow animation is disabled under
`prefers-reduced-motion: reduce`.

**Pan/pinch is deliberately not implemented.** The branch panel is
`overflow: auto` with `touch-action: pan-x pan-y` and the platform scrolls it; a
bespoke pinch layer over DOM nodes is a lot of gesture code for a tree that fits
a phone screen one branch at a time.
