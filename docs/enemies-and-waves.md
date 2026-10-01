# Enemies, waves and regions

Code: `sim/systems/waves.ts` (rolling and placing waves, spawning, the
overlap rule, overtime, Abyss floors), `sim/systems/enemies.ts` (movement,
verbs, separation, sweeping). Data: `content/regions.ts`,
`content/enemies.ts` (types and elite auras), `BALANCE.waves`,
`BALANCE.elites`.

## Regions

Six regions in Act 1, each 20 waves: wave 20 is the boss, overtime
follows. Each has three enemy types, a rule and a ground tint.

| # | Region | Rule | Boss |
|---|---|---|---|
| 1 | Ashen Fields | none | The Gatekeeper |
| 2 | Drowned Mire | Mist: 15% less range | The Bog Mother |
| 3 | Glass Wastes | Brittle: area damage +25% | The Prism |
| 4 | Ember Rift | Cinders: kills leave burning ground | Forgeheart |
| 5 | The Hollow | Echoes: one kill in ten rises as a shade | The Hollow King |
| 6 | Blight Heart | Blight: every wave brings an elite | The Blight |

Region 7 is the Abyss ([act2.md](act2.md)). Each region's `surge` is what
the Blight Surge pact does there.

A region's sizes are per-region data: `hpBase` (95, 290, 1450 and 1300 HP
for Regions 3–6), `hpGrowth` per wave (1.17), `damageBase` and
`damageGrowth`, `shardBase`, `waveShards`, and the body count
`count.base + count.perWave × (n − 1)`.

## A wave

`startWave` pre-rolls the whole wave on the `waves` stream (`rollWave`):
the count (× a `swarm` beat's multiplier, × Hordes), packs drawn by weight
from the types unlocked by that wave, beats such as `introduce` (a new
type's first pack) and the elites. Wave 1 comes in from the flanks (the
short walk on a portrait arena) so the first kill lands inside 3 s.
`tickWaves` places each entry when its time comes; while the field holds
`BALANCE.maxEnemies` (300) bodies, spawns wait.

**The overlap rule (§4.2).** The next wave starts once the current one has
finished spawning *and* either at most 25% of its bodies are alive or 10 s
have passed since it finished. Waves overlap; the game never waits for the
last straggler.

Reaching a wave pays the last one's bonus (`waveBonus`). Wave 20 holds
until its boss falls; the first overtime wave follows 3 s later, its HP
growing ×1.25 and its shards ×1.12 a wave until the tower falls.

## Enemy verbs

Every type does one readable thing, its `verb` (§4.3): `walker`, `split`,
`ranged` (Spitter), `heal` (Mender), `shield` (Shieldbearer, a frontal
arc), `burrow`, `shards`, `explode` (Bomber), `blink`, `phase` (Phantom),
`leech`, `summon` (Summoner's Imps), `silence` (Harbinger), `chorus` (a
group linked together), `carapace` (Husk), `charge` (Ram), `ward`
(Wardstone) and `devour` (Maw). Most act from `tickEnemies`; a few act on
death (`lastWord` in `combat.ts`). Each enemy also has `mass` (knockback
resistance), a pack size and a `color`.

`separateEnemies` spreads overlapping bodies apart each step through a
spatial grid (`core/spatialGrid.ts`), tangentially at the wall so a crowd
wraps round the tower instead of stacking.

A type's first sight in a profile shows a Bestiary toast
([collection.md](collection.md)).

## Elites and auras

`region.elites` says which waves bring an elite (from, every) and which
types and auras it draws. An elite has `BALANCE.elites` × HP, size, XP and
shards, and from Region 2 an aura: `haste`, `regen`, `shield`, `split` or
`vengeful` (§4.3), drawn on the canvas as a coloured halo. An elite kill
may drop one of its region's relics once a relic slot exists (30%, more
with Treasure Hunter).
