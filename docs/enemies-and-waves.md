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

Five more come after the Blight: the Wake (`act: 2`, plans/late-game/12).
Each one opens when the one before it falls (`after`). Each rule changes how
bodies move or how big they are, not a number on the tower. The rules live in
`sim/systems/wake.ts` and are listed in `content/regions.ts`.

| # | Region | Rule | Natives (1 / 5 / 10) | Boss |
|---|---|---|---|---|
| 9 | The Bell Marches | Toll: bodies move only when the bell tolls (every 3 s, 0.6 s lurch) | Ringer, Sleepwalker, Straggler | The Carillon |
| 10 | The Orrery | Orbit: everything spirals in (`tangent` 0.6) | Satellite, Comet, Moon | The Astrolabe |
| 11 | The Frozen Sea | Glide: pushed bodies slide and bowl others over | Skater, Floe, Sledge | The Leviathan Under the Ice |
| 12 | Giants' Rest | Giants: half the bodies, ×3.5 HP, ×1.6 size, ×2 reward | Titan, Tick, Herdkeeper | The Sleeping Colossus |
| 13 | Stormcrown | Storm: lightning strikes the toughest body every 5 s (8% Max HP); a standing Conductor turns it on the tower | Groundling, Conductor, Squallcaller | The Thunderhead |

**Floes (D-28).** The Frozen Sea's wave Floes are ordinary bodies:
targetable, and they don't melt. The Floes the Leviathan cracks loose
(`crackFloes`) are terrain: no weapon targets them, and they melt after
20 s (`BALANCE.wake.floes.melt`, `Enemy.meltAt`) or when the boss falls.
A Glide impact (source `impact`) still damages and shatters one.

The Thunderhead's first fall opens the Abyss (`abyssOpen`). Indices 7 and 8
are the Abyss and Boss Rush ([act2.md](act2.md)). Each region's `surge` is
what the Blight Surge pact does there. The Frozen Sea's is a `stat` surge
(attacks 10% slower); the other four's are `rule` surges.

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
growing ×1.25 and its shards ×1.12 a wave.

**Overtime has an end (D-26, plans/late-game/12a).** In every region,
Act 1 and the Wake, overtime lasts at most 20 waves
(`BALANCE.overtime.maxWaves`) or 600 sim seconds past the boss's fall
(`maxSeconds`). When wave 40 would advance under the overlap rule, the run
ends instead of starting wave 41. Past 600 s it ends at the wave it is
on. Either way it pays that wave's bonus, as reaching the next would have
(`holdRegion`), and the run ends **won** (`outcome: 'cleared'`, a `cleared` event): the tower
held the region. A tower that falls first ends the run as before. The
Abyss and Boss Rush have no overtime, so neither limit applies there.

**A stalled wave enrages its horde.** Overtime only ends a run while
waves keep coming. A field full of bodies the tower can't kill (Menders
healing a crowd of overtime HP) holds the next spawns back, the wave
never finishes, HP stops growing, and a tower that also can't be hurt
would wait forever, idle or not. So past the boss (and in the Abyss), a
wave held back by the full field with no spawn placed for
`BALANCE.overtime.stallAfter` (30 s) enrages its horde (`hordeEnrage`):
every hit on the tower grows ×1.25 each further 5 s (`hordeFury`) until
the wall falls. A spawn getting in (the tower made room) restarts the
clock. Before the boss a full field is only a hard wave.

**Rage grows past Rampart.** Rampart caps a contact hit at a slice of
Max HP (`BALANCE.behaviours.rampartCap`). `hurtTower` applies that cap
*before* the rage, then multiplies by the horde's fury and the boss's
enrage (`bossRage`: its current damage over its base hit), so a raging
fight still ends. Before, the cap came after the rage and held every hit
to the same slice, and a high-regen tower stalled at the boss for 25–60
sim minutes. A boss enrages after its own `BossDef.enrageAfter`
(`BALANCE.boss.enrageAfter`, 90 s, when absent): the Wake's five set 150,
165, 105, 90 and 105 s ([bosses.md](bosses.md)).

**Champions and trophies (N4).** Every fifth overtime wave (25, 30, …;
`isChampionWave`, never in the Abyss) brings a **Champion**: an elite with
`BALANCE.champions` × an elite's HP and shards, in its region's boss
colours (a second, wider halo), sure to drop one of its region's relics
(once a relic slot exists; at rank III a drop feeds its set, N6, or melts
to shards). Reaching overtime +5, +10 and +15 in a region earns a
**trophy** (`meta/collection.ts#trophiesAt`, read off the region's best
wave): `bankRun` pays it once, `BALANCE.trophies.pay` × that wave's wave
pay; the Map card shows its stars and the tower wears a light for each.
The run tells it as the wave starts (R2 §1: a toast, `meta/results.ts#trophyAt`),
as it tells a Trial won at its boss's fall (`meta/trials.ts#trialPrize`);
the results screen still pays both.

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
`vengeful` (§4.3), drawn on the canvas as a coloured halo. From the Mire on,
each region swaps one of those five for its own (N3), each an old verb made
an elite's:

| Region | Aura | In place of | What it does | Where |
|---|---|---|---|---|
| Drowned Mire | Fog-caller | split | while one lives, the tower's range is ×0.9 again (they don't stack) | `refreshStats` |
| Glass Wastes | Mirrored | shield | turns shots away from every side, like a Shieldbearer all round; blasts, chains and beams pass | `turnedAway` |
| Ember Rift | Molten | split | slain within half range of the wall, it opens a molten pool there | `eliteDeath` |
| The Hollow | Wraith | regen | phases out 1.5 s of every 4, like a Phantom: untargetable and harmless | `applyAuras` |
| Blight Heart | Hungering | regen | heals 8% of its Max HP for each body that falls within 160 (Maw Tooth starves it too) | `feedHungering` |

The Wake's five do the same against its own rules:

| Region | Aura | In place of | What it does |
|---|---|---|---|
| The Bell Marches | Resonant | shield | its neighbours lurch twice as far on every toll |
| The Orrery | Tidal | shield | its neighbours swing round faster, but close in no sooner |
| The Frozen Sea | Anchored | shield | it and its neighbours can't be pushed |
| Giants' Rest | Towering | regen | 40% less damage from anything but a crit |
| Stormcrown | Charged | shield | it and its neighbours are grounded: the storm passes them by |

The auras apply in `applyAuras` (`enemies.ts`). Towering applies in `combat.ts`.

Their numbers are in `BALANCE.elites`. An elite kill
may drop one of its region's relics once a relic slot exists (30%, more
with Treasure Hunter).
