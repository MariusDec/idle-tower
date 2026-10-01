# Act 2: pacts, Starlight, the Constellations, the Abyss

Act 2 opens when the Blight falls (`act2Open`). There is no wiping
prestige (D5): the player chooses their own difficulty instead, the
*Hades* model. Code: `meta/pacts.ts`, `meta/stars.ts`, `sim/pacts.ts`,
`sim/systems/waves.ts` (floors), `ui/hub/pacts.ts`, `ui/hub/forge.ts`
(`StarsView`). Data: `content/pacts.ts`, `content/stars.ts`,
`content/abyss.ts`, `BALANCE.pacts`, `BALANCE.starlight`,
`BALANCE.abyss`.

## Pacts and heat

Eight pacts, each with 3–5 ranks set between runs:

| Pact | One rank | Ranks |
|---|---|---|
| Hordes | +30% enemies | 5 |
| Vigour | enemies ×1.5 HP | 5 |
| Haste | enemies 15% faster | 3 |
| Elites | +1 elite on every elite wave | 3 |
| Frailty | −15% Max HP | 4 |
| Scarcity | one fewer card a draft | 3 |
| Tyranny | bosses rise once more, +25% HP | 3 |
| Blight Surge | the region's rule turns harsher (`region.surge`) | 3 |

**Heat** is the sum of the ranks. Shards rise × (1 + 0.1 × heat).
`sim/pacts.ts#pactLoad` resolves a run's pacts into one load and is the
only consumer of `PactEffect`. Pacts hold only in the regions, not the
Abyss.

## Starlight

Act 2's currency (the third and last, §8.1). A region's boss felled at a
new heat record pays `BALANCE.starlight.perHeat[region − 1]` for every heat
level the record passes, once (`recordStarlight`, `recordHeat`): the
frontier pays most. A new deepest Abyss floor pays on a log curve,
`12 × log2(1 + floor)` in all (`recordFloor`). The Deep's Stargazer stars
multiply payouts (`starGifts(profile).starlight`).

## The Constellations

A second web (`meta/web.ts`, like the Forge), forty nodes in five figures,
paid in Starlight, and nothing refunds:

| Figure | Holds |
|---|---|
| The Smith | Act 2's four weapons and two passives, the fifth weapon slot |
| The Warden | the Lamplighter and Gravekeeper frames, the walls |
| The Lantern | the Abyss's four relic sets, a sixth relic slot |
| The Crown | the Forge's five masteries |
| The Deep | the descent, and the Stargazers: more Starlight per payout |

Every figure has a node on the root, so the sky opens five ways at once.
Stat, card, slot and behaviour effects reach runs through
`buildRunConfig`; frames, masteries, relic sets, the relic slot and
Starlight's worth are the profile's, read by `starGifts`.

## The Abyss

Region index 7: the only endless mode, and the only place big numbers live.

- Each **floor** is ten waves on one region's template (its enemies and
  rule) with the Abyss's four natives (Husk, Ram, Wardstone, Maw) mixed in.
  Its tenth wave is a boss: the template region's, or every fifth floor one
  of the Abyss's own two (the Deepwarden, the Hunger).
- **Depth sets the size.** Wave numbers run on across floors (floor 3's
  first wave is wave 21); HP, damage and shards grow per global wave with
  no cap, counts and elites by the floor's own wave. A floor's boss is its
  last wave's HP × `def.hp` × 0.35.
- A new floor re-resolves the run's stats with its rule (`enterFloor`).
- No overtime: the descent goes on until the tower falls.
- `core/format.ts#formatNumber` writes big numbers with suffixes up to
  10⁶³ (`Vg`), then in exponent form (`1.23e66`); damage numbers use it
  too. P8's gate asks for clean numbers to about 10³⁰.

## Act 2 feats

Twenty more feats, pointing at heat, the Abyss, the Constellations and the
masteries; they surface once the Blight has fallen.
