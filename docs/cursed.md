# Cursed relics

Plan: [plans/late-game/03-cursed-relics.md](../plans/late-game/03-cursed-relics.md).
The Abyss's elites, Keepers and guardians leave a reliquary that only a tap
claims; inside is a relic with one boon and one curse, worn in its own slot,
in the Abyss only. The Autocaster, auto-restart and the idle bot never claim
(I9).

**Built:** phases 1–2: the whole frame, and Glass Crown from today's
Deepwarden (floors 5, 15, 25…). The strata's twenty relics, Keeper drops,
`curseArms`, `bias`, T5 and the second cursed slot wait on plan 08 (§8).

## Where it lives

| Layer | File | What |
|---|---|---|
| content | `content/cursed.ts` | `CURSED_RELICS` (spread into `RELICS`), `isCursed`, `curseLine` ("Curse:" → ☾), `cursedTable(stratum)` |
| content | `content/types.ts` | `RelicSource` kind `'cursed'`, `CurseDef`, `RelicDef.curse` / `leans`, `StratumId`, behaviour `unrisen` |
| content | `content/balance.ts` | `BALANCE.cursed`: drop chances, the claim window, `bindAt`, `maxWorn`, Glass Crown's numbers |
| content | `content/lint.ts` | `cursedRelics`: source ⇔ curse, boon + curse ≤ 15 words, "Curse:" first, no `pct` damage, `leans` a weapon, a stratum whole or absent |
| sim | `sim/systems/reliquaries.ts` | `eliteReliquary`, `guardianReliquary` (rolls on the `curse` stream), `claimReliquary`, `tickReliquaries`, `fadeReliquaries` |
| sim | `sim/run.ts` | `RunInput.claim` in `applyInput`; the fade tick after the draft; a retreat or fall fades the rest; Glass Crown's `unrisen` stops the revive |
| meta | `meta/collection.ts` | `cursedSlots`, `isBound`, `cursesWorn`, `wornCursed` (empty outside the Abyss), `toggleCursed`, `swapCursed`; `gainRelic` never wears a cursed relic |
| meta | `meta/runConfig.ts` | Boons at rank and curses once, in the Abyss only; `reliquaryConfig` (the pool filter, sure guardians, the first window) |
| meta | `meta/results.ts` | Binding past III, then melt; `cursedBest`; `reliquaries: { claimed, faded }`; `activeOnly` kind `'reliquary'` |
| app | `App#claimReliquary`, `syncReliquaries`, `compareCursed`, `wearFromResults` | The claim, the chip, the compare sheet, the results' Wear |
| ui | `ui/claim.ts`, `ui/hud.ts`, `ui/cursed.ts`, `ui/hub/collection.ts`, `ui/results.ts` | The canvas tap (shared with rifts), the HUD chip, the card, the Cursed segment, Wear and the faded line |
| render | `render/painters/reliquary.ts` | The chest and its draining ring, above the dark, never under 44 px on screen |

## The rules

- **Drops.** A guardian's relic is sure while it is unowned, then rolls at
  `bossDrop` (0.35). An elite rolls at `eliteDrop` (0.04, × Treasure Hunter's
  luck), after the ordinary relic and on its own stream; the Gate's elites
  have nothing to drop. A relic leaning on a weapon outside the pool never
  drops.
- **The window.** `claimSeconds` (40) of sim time, `firstClaimSeconds` (80)
  until the profile claims one. A draft slows it; a hidden app stops it.
- **Wearing.** One cursed slot opens with the first cursed relic owned.
  Duplicates rank the boon to III; past III, `bindAt` (5) more bind it, and
  a Bound relic may also sit in an ordinary slot. At most `maxWorn` (3)
  curses worn. Curses never lift; taking a relic off is the only lift.
- **Abyss only.** Region runs, Boss Rush and Trials never feel a curse.

## Determinism

`curse` is a `split` of the root, which leaves the root as it is: a run with
no reliquary config draws nothing from it, and every older seed plays as
before (`tests/cursed.test.ts` pins a run with and without the field).
`SNAPSHOT_VERSION` 15, profile v18.
