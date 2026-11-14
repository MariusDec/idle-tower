# C. The Abyss strata

**Status:** 2026-11-03. Outline, to be expanded. Ideas 8 (strata with a
bottom) and 3 (cursed relics) from the late-game review ([README](README.md)).
This is the biggest of the four plans, and it ships one stratum at a time.

**In one line:** replace the repeating six-floor cycle with authored bands,
each with its own rule, enemies, boss, palette and music, down to a real
ending at floor 30. Endless mode opens only after that.

---

## 1. The problem

`content/abyss.ts` builds each floor from `ORDER = [1, 3, 2, 5, 4, 6]`, so
floor 7 is floor 1's region with bigger numbers:

- **Nothing is new after floor 10.** The four natives have all arrived by floor 4,
  and both guardians have appeared by floor 10.
- **It opens on old ground.** Floor 1 wears the Ashen Fields, the game's first
  region.
- **There's no destination.** Act 1's ending promises "something stirs
  below" (`App.ts`), but the Blight is the game's only finale. Depth pays 2
  Starlight a floor, plus 10 per guardian, and the star web runs out.
- Arguably **R7**: an endless curve, with the only authored goals (the
  guardians) inside it.

## 2. The shape

| Stratum | Floors | Rule (proposal) | New | Ends in |
|---|---|---|---|---|
| I. The Gate | 1–6 | none: the natives, introduced one by one | its own template, not the Ashen Fields' | the Deepwarden |
| II. The Inversion | 7–12 | enemies spawn at the wall and walk **outward**; an escapee drains ultimate charge | 1 native | new boss |
| III. The Narrowing | 13–18 | the light `L` shrinks each wave; a floor's boss restores it | 1 native | the Hunger, reworked |
| IV. The Lightless | 19–24 | you only see what the tower's light reaches; crits flare and light up an area for a moment | 1 native | new boss |
| V. The Root | 25–30 | whatever stirs below: the region's earlier rules return, one per floor | 1 native | **the Act 2 finale** |
| The Below | 31+ | endless: strata II–V in turn, on the growth curve | none | records only |

The rules lean on plans/camera-and-fog.md (the light `L`, the fog), which
is already built. That makes II–IV cheap to make look different.

### The bottom

- Floor 30's boss is the **real end of Act 2**: ending text, a credits
  screen, and the Act 1 line paid off. It's a ceremony like the Blight's
  (§7.3).
- **The Below** opens after it, as an epilogue: records, Starlight per floor,
  cursed relics, and no new authored goals (R7).
- Waypoints are needed (§4): 30 floors × 10 waves is far too long for one
  run.

### Making floors 1–30 authored (R7)

Each stratum carries its own numbers (`hpBase`, `hpGrowth`, `count`, …),
like a region, instead of one global curve. The global curve
(`BALANCE.abyss`) applies only to the Below.

## 3. Data and code

- `content/strata.ts` (new): `StratumDef { id, name, floors, rule,
  natives, boss, palette, music, numbers, landmark }`. `abyssFloor(floor)`
  takes its overrides from `stratumOf(floor)` instead of `floorTemplate`.
  It already builds each floor from `...base`, so this is a data swap, not a
  new mode.
- **Rules:** `StratumRule`, a closed union read by `sim/systems/waves.ts`
  (spawn side, for the Inversion), `sim/light` (the Narrowing), and
  `render/` fog (the Lightless). Each has one exhaustive consumer (R8).
- **Enemies:** about four new natives (`content/enemies.ts`, sprite cache in
  `render/enemies.ts`), and three new bosses (`content/bosses.ts`; see
  docs/bosses.md for the phase format).
- **Look:** a ground tint and palette per stratum (`render/`, palette test);
  a synthesised track per stratum (`audio/music.ts`). Neither needs asset
  files.
- **The Map:** the Abyss node becomes a **vertical shaft**. Cleared strata are
  drawn in colour, and the next one shows only its landmark's silhouette.
  This is where the pull to go deeper comes from.

## 4. Waypoints

A run can start at the first floor of any stratum whose boss the player has
felled, with the tower at a level and banked drafts sized to that depth
(like Boss Rush's level 16). The Deep's stars (`content/stars.ts`) already
hold "the descent", so a waypoint star could go there. Records and
Starlight count from the floor the run reaches, wherever it started.

## 5. Starlight and rewards

- A **stratum boss** pays a lump the first time it falls (proposal: 30, 40, 50, 60, 100).
  This replaces the per-guardian 10.
- Per floor stays at 2, but only for floors 1–30, then 1 in the Below.
- Check the totals against the sky (B7: every region at top heat already pays
  more than the whole sky). Strata shouldn't make heat pointless, so let
  `act2.ts` show each source's share.
- **Migration:** a profile with a record past floor 6 keeps it. Stratum
  bosses pay on their first fall even if the player is already past that
  depth, since the bosses are new. Nothing is paid twice for old floors.

## 6. Cursed relics

Relics that drop **only in the Abyss**, from stratum elites and bosses.
Each has **one boon and one curse that changes how you play**. It's the
endgame loot chase.

| Relic | Boon | Curse |
|---|---|---|
| Unreturning | Glaives split on kill | Glaives never return |
| Glass Crown | +60% damage | Max HP −40% |
| Hollow Bell | the ultimate charges twice as fast | it hits half as hard |
| Starving Lamp | +1 draft choice | every heal is halved |
| Mirror of Debt | relic drops ×2 | one random relic is off each floor |

- **Slots:** a separate cursed slot (one; the Lantern can grant a second),
  so they don't compete with the sets.
- **Rolls:** each drop rolls its boon's size, so better copies are worth
  chasing. Duplicates raise the boon's rank and **never** shrink the curse.
- **Active-only (I9):** a drop is a chest on the floor that has to be tapped
  before the floor ends. The idle bot never takes one.
- **R4:** the boon and the curse share the card's 15 words.
- Data: `RelicSource` gets `{ kind: 'cursed', stratum }` (`content/types.ts`),
  and the effects reuse `Effect` where they can (R8).

## 7. Checks

- `tools/act2.ts` reports per stratum: the floor reached per hour, the time to
  each stratum boss, and Starlight by source. Target: a stratum takes about an
  evening (1–2 h) at the expected star state, and floor 30 lands about when
  the sky is nearly lit.
- Nothing in the first stratum should feel like an Act 1 region. Check it by
  playing, with the art in place.
- `formatNumber` stays clean through floor 30's numbers (P8's 10³⁰ gate).
- Determinism: a stratum floor is the same region for the same floor
  (`abyssFloor` caches by floor; keep that).

## 8. Shipping order

1. **The framework + stratum I.** `StratumDef`, `stratumOf`, the shaft on
   the Map, waypoints, and stratum I's own template and look. Floors past 6
   stay on today's cycle.
2. **Stratum II** with its rule, native, boss and silhouette. This is the
   test: does authored depth bring the curiosity back? Decide on III–V
   only after it.
3. **Cursed relics** can ship with step 2 (stratum II's elites drop the first
   few).
4. III, IV, V, the finale, then the Below.

## Open

- Should the finale be the end of the story, or a cliffhanger?
- How much new art is acceptable per stratum? The minimum is a palette, a
  native, a boss and a track.
- Should pacts hold in the strata? Today they hold only in the regions.
- Can cursed relics be worn in the regions, or only in the Abyss?
