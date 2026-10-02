# The Map and the Collection

Code: `meta/collection.ts` (what is unlocked: regions, frames, relic slots,
hub tabs; relics worn and gained), `meta/recipes.ts`, `ui/hub/map.ts`,
`ui/hub/collection.ts`. Data: `content/regions.ts`, `content/frames.ts`,
`content/relics.ts`, `content/evolutions.ts`.

Everything here is a pure function over the profile; the UI,
`buildRunConfig` and the pacing bot all ask the same functions.

## Hub tabs

Tabs appear as they unlock (R3), in the order Forge → Map → Collection →
Feats → Stars (`hubUnlocks`):

| Tab | Opens when |
|---|---|
| Forge | after the first run |
| Map | the Gatekeeper has fallen |
| Collection | enough enemy types seen for a Bestiary |
| Feats | the Gatekeeper has fallen |
| Stars | the Blight has fallen (Act 2) |

Tactics and Pacts have no tab: they open from the home view once the
Tactician is owned, and once Act 2 opens.

## The Map (§5.2)

The regions as a path from the tower's light toward the Blight Heart.
`regionUnlocked(profile, k)` is true once region k − 1's boss has fallen;
`frontier` is the furthest one open. Selecting a region sets
`profile.region` for the next run. Each region shows its best wave and its
boss trophy (kills, fastest kill). A first boss kill's ceremony plays here:
the light spreads to the next region (skipped under reduced motion).

## Frames (§4.4, §11.6)

| Frame | Unlock |
|---|---|
| Arcanist | start |
| Bastion | the Bog Mother falls |
| Stormcaller | Forgeheart falls |
| Artificer | the secret feat *Tinkerer* |
| Lamplighter, Gravekeeper | Constellations (Act 2) |

The selected frame is `profile.frame`. Each Tactician II list is per frame.

## Relics (§5.3)

Twenty-four in Act 1, four per region: the boss's first-kill relic and
three its elites drop. Act 2 adds twelve in four sets, dropped by the
Abyss's elites once their Lantern stars are lit. Relics are qualitative and
each leans on a weapon family or the region's verb. A duplicate ranks a
relic up to III; `perRank` is what each rank adds. A duplicate past III is
melted down for that wave's wave pay (`relics.peakWaves`; five cut Act 1 by ~2.7 h).

**Relic sets** (N6, `RELIC_SETS`): a region's three elite relics worn
together give a bonus that leans on its verb (`activeSets`, applied by
`buildRunConfig` like a relic). Each set has ranks I–III: a duplicate past
a relic's rank III adds a point of its set's progress (D-12), and every
`BALANCE.sets.perRank` (5) points is a rank (+5% damage each past I); once
the set is at III, duplicates melt to shards again. Boss relics and the
Abyss's belong to no set.

| Set | Region | Bonus |
|---|---|---|
| Field Kit | Ashen Fields | crits knock enemies back |
| Mire Lore | Drowned Mire | Splitter fragments die to any blast, pulse or burn |
| Glasswright | Glass Wastes | Burrowers surface twice as far out |
| Rift Warden | Ember Rift | Bombers slain short of the wall leave fire for their pack |
| Gravewatch | The Hollow | risen shades pay full shards and XP |
| Blightbane | Blight Heart | each elite slain restores 5% of Max HP |

Relic slots: one per boss with `relicSlot` felled, plus the
Constellations' gift (`relicSlots`). `equipped` lists what is worn;
`equippedRelics` trims it to the slots. Relics drop only in live runs,
never offline.

## Trials (N5)

Three authored runs per region (`content/trials.ts`), opened by its boss
(`meta/trials.ts`). Each is an ordinary run in that region under fixed
rules, won by felling the boss, and pays once:

| Rule | What it does to the run (`buildRunConfig`) |
|---|---|
| `frame` | the run is that frame's |
| `weapons` | the first is mounted at the start (`RunConfig.startingWeapon`); the pool's weapons are those, unlocked or not |
| `slots` | a ceiling on weapon and passive slots |
| `omen` | Act 2's pacts as Act 1 omens, in place of the pacts; they pay no heat record |

| Reward | |
|---|---|
| `relic` | a rank of the region's boss relic |
| `trim` | a decoration on the tower, in the hub and in runs (N2) |
| `notable` | effects no Forge node gives, applied to every run like a node's: Drill Sergeant (starting weapon +1 level), Mire Sight (+1 reroll), Deep Arc (Chain Lightning leaps to burrowed bodies first and surfaces them), Heavy Shells (+2 bomblets), Clear Mind (+1 Banish), Dawn Muster (start two levels higher) |

The Map's region card lists them; **Begin** sets `profile.trial` (and the
region) and starts the run at once. `bankRun` marks a win, pays it
(`winTrial`), and clears `profile.trial` either way: the next run is an
ordinary one. A run's trial is `RunState.trial`, so a resumed snapshot
stays one.

## The Bestiary

Every enemy type seen (`profile.seenEnemies`) with its verb text, lore and
lifetime kills (`profile.killsBy`). The first sight of a type in a run
shows a toast.

## The Recipe Book

Evolutions show as "??? + ???" until found. Runs carrying a weapon reveal
its half of the recipe (`BALANCE.recipes`); runs taking it to its last
level add the riddle (`hint`) pointing at the other half. The page opens
once a first weapon is half revealed, so its hints can lead to the find.
`run.recipes` (the found ones) is what the draft scorer steers toward.
