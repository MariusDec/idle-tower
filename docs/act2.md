# Act 2: pacts, Starlight, the Constellations, the Abyss, Boss Rush

Act 2 opens when the Blight falls (`act2Open`). There is no wiping
prestige (D5): the player chooses their own difficulty instead, the
*Hades* model. Code: `meta/pacts.ts`, `meta/stars.ts`, `sim/pacts.ts`,
`sim/systems/waves.ts` (floors and stages), `ui/hub/pacts.ts`,
`ui/hub/forge.ts` (`StarsView`). Data: `content/pacts.ts`,
`content/stars.ts`, `content/abyss.ts`, `content/rush.ts`,
`content/fusions.ts`, `BALANCE.pacts`, `BALANCE.starlight`,
`BALANCE.abyss`, `BALANCE.rush`, `BALANCE.fusions`, `BALANCE.ascend`.

## Pacts and heat

Eight pacts, each with 3–9 ranks set between runs:

| Pact | One rank | Ranks |
|---|---|---|
| Hordes | +30% enemies | 5 |
| Vigour | enemies ×1.25 HP | 9 |
| Quickening | enemies 15% faster | 3 |
| Elites | +1 elite on every elite wave | 3 |
| Frailty | −15% Max HP | 4 |
| Scarcity | one fewer card a draft | 3 |
| Tyranny | bosses rise once more, +25% HP | 3 |
| Blight Surge | the region's rule turns harsher (`region.surge`) | 3 |

**Heat** is the sum of the ranks (33 at most). Shards rise × (1 + 0.1 ×
heat). Vigour is graded by its weight (S7, D-7): a rank of ×1.5 HP was
several times the load of a Scarcity or Haste rank, and made a wall at heat
6 in the Blight Heart; nine ranks of ×1.25 reach the same top.
`sim/pacts.ts#pactLoad` resolves a run's pacts into one load and is the
only consumer of `PactEffect`. Pacts hold only in the regions, not the
Abyss.

## Starlight

Act 2's currency (the third and last, §8.1). It comes from four places
(S7):

| Source | Pays |
|---|---|
| A region's boss felled at a new heat record | `1 + floor(h / 5)` for each heat level h the record passes, once, the same in every region (D-8: the hard part is the high heat, not the late region) (`heatStarlight`, `recordHeat`) |
| A new deepest Abyss floor | 2 for each floor it passes, and 10 more for each guardian's (every fifth) (`abyssStarlight`, `recordFloor`) |
| A Boss Rush record | 4 for each stage first cleared, and a full clear's time on a curve (`rushStarlight`, `recordRush`) |
| Act 2's feats | 5–40 each, on top of their shards, when claimed |

The Deep's Stargazer stars multiply every payout
(`starGifts(profile).starlight`). Every region at the top heat pays 792,
more than the whole sky costs (B7), so *Firmament* can be earned without
the Abyss; in practice the bot lights the last star from the three
together.

## The Constellations

A second web (`meta/web.ts`, like the Forge), forty-four nodes in five
figures, paid in Starlight, and nothing refunds:

| Figure | Holds |
|---|---|
| The Smith | Act 2's four weapons and two passives, the fifth weapon slot, the four fusions (N9, [combat.md](combat.md)) |
| The Warden | the Lamplighter and Gravekeeper frames, the walls |
| The Lantern | the Abyss's four relic sets, a sixth relic slot |
| The Crown | the Forge's five masteries |
| The Deep | the descent, and the Stargazers: more Starlight per payout |

Every figure has a node on the root, so the sky opens five ways at once.
Stat, card, slot and behaviour effects reach runs through
`buildRunConfig`; frames, masteries, relic sets, the relic slot and
Starlight's worth are the profile's, read by `starGifts`.

**Ascension** (N10): once every star is lit, the minors whose stat is a
percentage go on past their last level, at twice the curve's price, each
level a compounding multiplier of half a level's percentage (Starforged's
+20% damage ascends at ×1.10 a level). It is the long tail, and nothing is
wiped (D5) ([forge.md](forge.md)).

## The Abyss

Region index 7: the only endless mode, and the only place big numbers live.

- Each **floor** is ten waves on one region's template (its enemies and
  rule) with the Abyss's four natives (Husk, Ram, Wardstone, Maw) mixed in.
  Its tenth wave is a boss: the template region's, or every fifth floor one
  of the Abyss's own two (the Deepwarden, the Hunger).
- **Depth sets the size.** Wave numbers run on across floors (floor 3's
  first wave is wave 21); HP, damage and shards grow per global wave with
  no cap, counts and elites by the floor's own wave. A floor's boss is its
  last wave's HP × `def.hp` × 0.35; a guardian's (every fifth floor) × 0.25
  (S7.5: the Deepwarden was a wall at floor 5).
- A new floor re-resolves the run's stats with its rule (`enterFloor`).
- No overtime: the descent goes on until the tower falls.
- `core/format.ts#formatNumber` writes big numbers with suffixes up to
  10⁶³ (`Vg`), then in exponent form (`1.23e66`); damage numbers use it
  too. P8's gate asks for clean numbers to about 10³⁰.

## Boss Rush (N8)

Region index 8 on the Map, opened by the Deepwarden's fall. The six Act 1
bosses back to back, then the Deepwarden and the Hunger: every wave is a
boss, its own stage (`rushStage`), with its home region's enemies for its
summons and no rule. Stage n is sized like the guardian of Abyss floor
`BALANCE.rush.floors[n − 1]` (2, 2, 3, 3, 4, 4, 5, 6). The tower starts at
level 16 with its drafts banked, since there are no waves to grow on. The
last boss down ends the run, won (`outcome: 'cleared'`), and the HUD shows
the clock.

The record (`profile.rush`) is the most stages cleared, then a full clear's
time. New records pay Starlight: 4 for each stage first cleared, and a full
clear `20 × log2(1 + 600 / seconds)` in all, so each faster record pays the
difference. Its bosses keep no kills or first falls: they are their
regions'. No pacts, no Trials.

## Act 2 feats

Twenty more feats, pointing at heat, the Abyss, the Constellations and the
masteries; they surface once the Blight has fallen, and pay Starlight as
well as shards (S7.2): by then shards buy only masteries.
