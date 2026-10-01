# The sim

`src/sim/` is DOM-free and deterministic. A run is `RunState`, plain data
created by `createRun(config, seed)` and advanced by `step(run, dt, input)`.

## Determinism

- No `Date.now`, no `Math.random`, no DOM. Time is `run.tick × SIM_DT`.
- Randomness comes from `core/rng.ts`: a seeded, splittable generator.
  `createRun` splits the seed into one stream per system — `waves`, `crit`,
  `draft`, `loot`, `arms`, `foes` — stored as raw state in `run.streams`,
  so a change in how often one system rolls never shifts another's rolls.
- Input lands only through `applyInput`, on a step boundary.
- `RunState` is plain data, so it can be hashed (`tests/sim.test.ts`) and
  written as the run snapshot.

**Invariant:** same `RunConfig` + seed + inputs by tick ⇒ the same final
state hash. A system that needs a scratch structure (the separation grid
in `systems/enemies.ts`, the `DEVOURERS` set in `systems/combat.ts`) keeps
it outside `RunState` and rebuilds or derives it, never carrying state
between steps.

## Step order

The order is part of the contract (`sim/run.ts#step`):

1. input (`applyInput`: retreat, reroll, pick, ultimate)
2. `tickWaves` — waves place bodies; wave 20 brings the boss
3. `tickBoss` — the boss's patterns
4. `tickEnemies` — walk, and act on their verb (hit the wall, lob, mend…)
5. `separateEnemies` — crowds spread (tangentially at the wall)
6. `tickWeapons`, `tickUltimate` — weapons fire
7. `tickProjectiles` — shots fly and kill; kills feed XP, shards and the
   ultimate, a Splitter bursts, an elite's aura has its last word and may
   drop a relic; reaching a wave pays for the last
8. `tickRunes`, `tickBurns`, `tickShots`, `tickRings`, `tickPools` —
   hostile shots and shockwaves land (`systems/tower.ts#hurtTower` is the
   one way the tower takes damage)
9. sweep the dead bodies and spent projectiles
10. `tickDraft` — a banked level-up opens its draft
11. the tower rises on Second Wind, falls, or regenerates

## Outcome

`run.outcome` is `null` while the run lives, then `{ kind: 'fell' |
'retreat', wave, time }`. `step` is a no-op after it. A fall plays out on
screen for `FALL_SECONDS` before the app banks it; a retreat banks at once.

## Events

`run.events` is the sim's only outward channel: `SimEvent`, a tagged union
in `sim/state.ts` (`hit`, `kill`, `fire`, `levelUp`, `bossArrive`,
`bossPhase`, `relicDrop`, `evolve`, `fell` and about fifty more). The sim
pushes, the app hands the list to the renderer, the cues and `announce`,
then clears it each frame. The headless tools clear it each step.
`Renderer.consume` switches over every kind and ends in `never`, so a new
event kind is a compile error until presentation decides what it looks
like.

## Stats

`sim/stats.ts` resolves about twenty keys (damage, attack speed, crit
chance and multiplier, area, duration, range, projectile speed, pierce,
Max HP, regen, armour, XP gain, shard gain, ultimate charge, …) as
`(base + Σadd) × (1 + Σpct) × Πmult` from a list of `StatMod`s. The run
resolves once at start (Forge, frame, relics, stars, pacts, the region's
rule) and again whenever a passive changes or an Abyss floor swaps its
rule. `run.outerMods` keeps the part that never changes within a run.

## RunConfig

`RunConfig` is frozen meta, built by `meta/runConfig.ts#buildRunConfig`:
the stat mods, behaviour counts (`run.behaviours`, read by the systems that
own each behaviour), the card pool, slots, frame, region, pacts, relics
worn, recipes found, the Tactician's priority list and the first draft's
authored cards. See [forge.md](forge.md).

## The pacts' consumer

`sim/pacts.ts#pactLoad` resolves the pacts a run is under into one load
(enemy count, HP, speed, elites, Max HP, card choices, boss phases, rule
surge). It is the only consumer of `PactEffect`; everything else in the sim
asks it. See [act2.md](act2.md).
