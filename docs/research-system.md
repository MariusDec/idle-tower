# Research System

**Files:** `src/systems/ResearchTree.ts`, `src/data/research.ts`

## Overview

Research Points (RP) earned on each Ascension (RP = AP gained). Spent on
permanent upgrades in **5 categories** — combat, economy, arcane, scouting,
and research — across **19 nodes**. Most nodes are single-level with a
fixed cost and time, but four are laddered: `veteran_scouts` (5 levels
of start-wave), `rp_gain` (10 levels of passive-RP multiplier) and
`rp_drop_chance` (10 levels of enemy RP-drop chance). The walls between
categories are visual, not data-driven — `ResearchCategory` is purely a
rendering key for the panel.

RP arrives in two channels, and the §2.2 rebalance is what kept them
honest:

1. **Passive RP** — wall-clock drip, calculated per second.
2. **Killed-enemy drop** — a small chance per kill (the *drop channel*),
   weighted by the enemy's `rpChance`. `rp_drop_chance` and `rp_gain`
   research both feed into the same trickle.

## Categories & nodes (`RESEARCH_NODES` in `src/data/research.ts`)

| Category | ID | Name | Cost (RP) | Time (s) | Max | Prereq | Effect |
|---|---|---|---:|---:|---:|---|---|
| **combat** | `piercing_shots` | Piercing Shots | 125 | 300 | 1 | — | +1 enemy pierced |
| combat | `improved_pierce` | Splintering Volley | 500 | 1 800 | 1 | piercing_shots | +1 enemy pierced (stacks) |
| combat | `reinforced_structure` | Reinforced Structure | 100 | 300 | 1 | — | −20% damage taken |
| combat | `chain_reaction` | Chain Reaction | 2 500 | 14 400 | 1 | improved_pierce | kills AoE 25% of max HP |
| **economy** | `alchemy` | Alchemy | 60 | 300 | 1 | — | +25% gold (multiplicative) |
| economy | `transmutation` | Transmutation | 380 | 1 800 | 1 | alchemy | 5% chance for 3× gold |
| economy | `prosperity` | Prosperity | 250 | 900 | 1 | alchemy | +50% gold (stacks with Alchemy) |
| economy | `golden_age` | Golden Age | 1 900 | 7 200 | 1 | transmutation + prosperity | +100% gold |
| **arcane** | `mana_font` | Mana Font | 125 | 600 | 1 | — | +50% mana regen |
| arcane | `arcane_mastery` | Arcane Mastery | 750 | 3 600 | 1 | mana_font | −30% ability mana cost |
| arcane | `arcane_recovery` | Arcane Recovery | 380 | 1 200 | 1 | mana_font | crits restore 3 mana |
| arcane | `elemental_fury` | Elemental Fury | 3 000 | 21 600 | 1 | arcane_mastery + arcane_recovery | +30% ability damage |
| arcane | `arcane_expansion` | Arcane Expansion | 2 250 | 14 400 | 1 | arcane_mastery | +35% ability area |
| **scouting** | `swift_prep` | Swift Preparation | 190 | 1 200 | 1 | — | −50% intermission time |
| scouting | `veteran_scouts` | Veteran Scouts | 120 → 5 000 (5 lvls) | 600 → 14 400 (5 lvls) | 5 | swift_prep | +3 waves start per level (15 max) |
| scouting | `battle_intel` | Battle Intel | 1 000 | 7 200 | 1 | swift_prep | −10% enemy HP |
| **research** | `rp_gain` | Increased Focus | 40 → 9 600 (10 lvls) | 600 → 28 800 (10 lvls) | 10 | — | +12% passive RP per level (×2 at L10) |
| research | `rp_drop_chance` | Loot Insights | 60 → 12 000 (10 lvls) | 1 200 → 43 200 (10 lvls) | 10 | rp_gain | +0.1% drop chance per level (+1% at L10) |
| research | `field_studies` | Field Studies | 2 000 → 1 441 151 (15 lvls) | 3 600 → 2 594 071 (15 lvls) | **999** | rp_gain | +5% gold per level — repeatable forever |

**`field_studies` is the tree's only unbounded node** (plans/progress.md §7.5),
and the reason RP is not a dead currency once the eighteenth project lands: the
bounded tree costs 66 730 RP against a faucet that pays `RP = AP gained`, which
is tens of thousands by run 3.

It is gated by **time, not cost**. Research runs one project at a time on the
wall clock and its time ladder grows 1.6× per level: level 10 is 6.9 hours,
level 15 is ~30 days, and past the array's last entry every further level costs
that same 30 days — which is what makes "repeatable forever" a fifteen-entry
table rather than a 999-entry one.

It grants **gold rather than damage** because `ResearchDef.effectType` is a
closed union with no damage arm; adding one would mean a new effect type, a new
`ResearchInputs` field and a new contributor line for a node whose whole job is
to be a sink. `gold_multi` already has a consumer
(`ResearchTree.getGoldMultiplicative`), so the node is live purely by being in
the table — and since the upgrade ceilings now rise with the player
([upgrade-system.md](upgrade-system.md)), a gold multiplier is a damage
multiplier with one more step in the chain.

`cost` and `researchTime` are typed as `number | number[]` — a flat value
for single-level nodes, an array that drives the per-level ladder for the
three laddered nodes. `getResearchCost` / `getResearchTime` walk the array
by `min(level − 1, lastIndex)`, so the ladder caps at the last entry
rather than extrapolating. Two nodes also carry an `effectDefinitions`
override table: `rp_gain` jumps to a 2.0× multiplier at L10 (not 2.08×),
and `rp_drop_chance` jumps to a flat 1% at L10 — the curve kneels into
the cap so the last level feels like a *milestone*, not arithmetic.

## Passive RP (the §2.2 rebalance)

`ResearchTree.getPassiveRPRate(wave, gainMultiplier)` is the wall-clock
drip. The current formula is

```
rate (RP/s) = 0.20 × √wave / 60 × (1 + gainMultiplier)
```

with `wave = max(1, lifetimeHighestWave)`. The old `0.05 × wave / 60`
paid `3 × wave` RP/h — wave 200 earned 8× what wave 25 did purely for
being deeper, and the drop channel already scales with depth through the
body count. Square-root in depth keeps depth worth something without
making it the whole economy:

| Wave | Old (`3 × wave` RP/h) | New (`12 × √wave` RP/h) |
|---:|---:|---:|
| 25 | 75 | 60 |
| 100 | 300 | 120 |
| 200 | 600 | 170 |
| 400 | 1 200 | 240 |

The `gainMultiplier` term is `sumEffect('rp_gain')` — the per-level
contribution of `Increased Focus` (0.12 per level, 2.0 at L10 via the
override table). `ResearchTree.tickWallClock` (called from
`Game.tickWallClockSystems`) calls `addPassiveRP(dt, wave, gainMultiplier)`
once per real-time frame, which keeps the trickle honest while the
run-over prompt is up.

## The drop channel — enemies, elites, and §2.8 cost table

The **drop channel** is per-kill: every targetable enemy that dies rolls
its `rpChance` (in `ENEMY_DEFS`) and, on a hit, drops **1 RP**. The base
rates run from 0.5% (trash) to 3.5% (the heaviest non-elite) — these are
the same `rpChance` values the old code used, but the rebalance names
two new levers:

- **Elite kills roll the elite drop.** `ELITE_RP_DROP_CHANCE = 0.25` in
  `src/systems/EnemyManager.ts` replaces the old "every elite drops RP"
  guarantee with a 25% per-kill roll. The rationale: the old guarantee
  was visible *only* on elite deaths and made the drop channel feel
  deterministic on elites and random on everything else. A flat 25%
  unifies the channel — every RP drop is a roll — and keeps elites
  inside it (a 25% chance per kill is dramatically higher than the
  0.5-3.5% chance the trash channel rolls, and an elite cluster is
  dozens of kills). On a hit the elite drops `ELITE_RP_DROP` (1 RP);
  the per-enemy `rpChance` channel still applies alongside.
- **`rp_drop_chance` (research)** is the multiplier on `rpChance` — it
  adds a flat per-level bonus (0.001 per level, +1% at L10) that pushes
  the trash channel from negligible to meaningful late game.

The §2.8 cost table for the drop channel is in `enemies.ts`: each enemy
type carries its own `rpChance`. Because every RP drop is a roll and the
drop channel is the bulk of pre-L10 income, the §2.9 income curve reads
deepest when the research multiplier is stacked:

| Depth | Trash-only base | + `rp_drop_chance` L10 | + `rp_gain` L10 | + both L10s |
|---:|---:|---:|---:|---:|
| wave 50 | 6 drops/h | 24/h | 11/h | 44/h |
| wave 100 | 30/h | 60/h | 22/h | 90/h |
| wave 200 | 80/h | 160/h | 35/h | 140/h |

*(passive RP is wall-clock; the per-kill channel is in game-time and
follows the body count the wave composition actually produces.)* The
trade is **passive is steady and depth-bounded; drop is bursty and
proportional to bodies killed**, and the two channels sum on the RP bar.

## Effect Queries (`ResearchTree`)

| Method | Effect type(s) summed | Composition |
|---|---|---|
| `getPierceCount()` | `pierce` | sum |
| `getTowerDefense()` | `tower_defense` | sum, clamped to 90% |
| `getChainKillAoE()` | `chain_kill_aoe` | sum |
| `getCritManaRestore()` | `crit_mana` | sum (per crit mana restored) |
| `getAbilityPowerBonus()` | `ability_power` | sum |
| `getAbilityAreaBonus()` | `ability_area` | sum |
| `getIntermissionSpeedReduction()` | `intermission_speed` | sum, clamped to 90% |
| `getEnemyHPReduction()` | `enemy_hp_reduce` | sum, clamped to 50% |
| `getGoldMultiplicative()` | `gold_multi` | multiplicative `factor += value` per node |
| `getGoldLuckChance()` | `gold_luck` | sum, clamped to 100% |
| `getManaRegenMultiplicative()` | `mana_regen` | multiplicative `factor += value` per node |
| `getAbilityCostReduction()` | `ability_cost` | sum, clamped to `[-0.9, 0]` |
| `getStartWave()` | `start_wave` | max across the ladder |
| `getRPGainMultiplier()` | `rp_gain` | sum (feeds `getPassiveRPRate`) |
| `getRPDropChanceBonus()` | `rp_drop_chance` | sum (added to every per-kill roll) |

## Locking / Unlocking (`ResearchTree`)

- `canStartResearch(id)`: not maxed, no other research running, prerequisites
  met (only enforced on the first level), RP sufficient for the next level
- `reasonBlocked(id)`: returns one of — `Max level reached`, `Another
  research in progress`, `Requires {name}`, `Need {n} more RP`
- `startResearch(id)`: deducts RP, sets `inProgress = {id, elapsed, targetLevel}`,
  emits `research_started`
- `cancelResearch()`: refunds RP, clears `inProgress`, emits
  `research_cancelled` — refunds are *not* part of v23 → v24 (see
  [save-system.md](save-system.md#migration-ladder))
- `tick(dt)`: wall-clock ticks `inProgress.elapsed`; when `elapsed >= total`,
  promotes the level and emits `research_unlocked`
- `addRP(amount)`: increments `runtime.rp`, emits `rp_changed {rp, delta}`
- `replaceLevels(levels, rp, inProgress)`: used on save load; rebuilds the
  internal map from a plain record

## Wall-clock guarantees

Research ticks on **wall-clock** time (`realDt`), not simulation time —
it must not accelerate when the player raises the game speed, and a 30 s
research must cost 30 s of the player's life at 1x and at 4.5x alike.

It also ticks while the run-over prompt is up: `Game.tickWallClockSystems`
sits outside the `if (!this.runFailed) this.update(...)` gate, so research
progress and passive RP gain continue while `RunFailedModal` waits for the
player to pick Ascend or Retry Wave. A player who walks away from the
prompt comes back to in-progress research, not a frozen one.

## Reset

- `resetForAscension()` — clears all unlocked levels; *not* called by
  ascension itself (research is **meta-progression**). The function exists
  for tests and for any future "wipe research" affordance.
- `replaceLevels(levels, rp, inProgress?)` — used when loading a save,
  the only reset-style operation a real run hits.