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

Relic slots: one per boss with `relicSlot` felled, plus the
Constellations' gift (`relicSlots`). `equipped` lists what is worn;
`equippedRelics` trims it to the slots. Relics drop only in live runs,
never offline.

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
