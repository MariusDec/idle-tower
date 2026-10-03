# The draft

The level-up draft is the only in-run economy (D2): no gold, no shop. Every
level-up is a choice that changes what the tower does. Code:
`sim/systems/draft.ts` (XP, offers, picks), `sim/suggest.ts` (the
scorer), `ui/draft.ts` (the panel), `App#syncDraft` (timing).

## XP and levels

Kills pay XP (× XP gain). Level 1 → 2 needs `BALANCE.xp.first` (8), each
level `perLevel` (4) more, then × `growth` (1.1), so the first draft lands
near 0:15 and late levels stretch to 30–40 s. Several level-ups at once
bank as `pendingDrafts`; `tickDraft` opens them one at a time. Head Start
and Gatekeeper's Seal start a run above level 1, each level a banked draft.

## The offer

`candidateCards` lists what may be offered now:

- a ready **fusion** (N9: its Smith star lit, both its weapons carried and
  evolved) — always in the hand;
- a ready **evolution** (weapon at its last level, partner passive at its
  last level, Alchemy owned) — drawn like any other card, so it may wait a
  level-up or two;
- the next level of every owned weapon and passive below level 5;
- a **new** weapon or passive from the pool, only while a slot of its kind
  is free.

`rollOffer` fills the hand: fusions first, then a uniform sample by
partial Fisher–Yates on the `draft` stream, padded with **fallback** cards
(heal 30%, a pinch of shards) when nothing else is left. The hand is
`BALANCE.draft.choices` (3), plus Choice and Foresight and Jackpot, less
Scarcity, clamped to 2–6. Past four cards the panel wraps into
two rows of three.

The profile's **first draft** is authored (`meta/runConfig.ts`): one card
of each kind, nothing to misread. It is the only draft that stops the
arena, and it cannot be rerolled.

**Invariant:** the draft never offers a new item for a slot type that is
already full (`tests/draft.test.ts`). A fusion's second half rides on its
partner's mount (`joined`) and takes no slot (`slotsUsed`).

## The suggestion

`sim/suggest.ts#scoreCard` values each card as a fraction of the build's
current strength:

| Term | What it values |
|---|---|
| offence | DPS gain: `damageDps` (fitted to the sim, T2) through the wave's armour and the weapon's weaknesses, times its control's `utility` |
| defence | survival gain, weighted by how much danger the tower is in |
| counters | a new weapon that answers what walks in this region, less what blunts it there (`weakAgainst`) |
| recipes | a step toward a *known* evolution (unknown ones are found by chance) |
| slots | a new weapon in an empty slot: a second line of fire |

The panel lets taps through (B3): pause, speed, the Autocaster and the
ultimate stay live during a draft, and the cards sit above the HUD's
bottom row.

The Windfall fallback pays three of this wave's wave pays (at least 10),
through the shard multiplier, so it keeps pace with the region.

`damageDps` is checked against the sim by `npm run calibrate` (T2): each
weapon at levels 1, 3 and 5 and evolved, on a fixed frontier-like crowd
(eight bodies in loose pairs, refilled as they fall); it fails past 25%
drift (`tests/calibration.test.ts`). Its constants are fitted there, not
by hand. Greed is valued at what it will be over the rest of a typical run.

The suggested card is highlighted, and taken when the timer runs out. The
same scorer drives every bot in `tools/`, so a better bot is better idle
play (§13).

With the Tactician ([idle.md](idle.md)), `run.priority` ranks first: a
fusion or an evolution ahead of everything, then the listed items in the player's order,
then the scorer for anything unlisted. A card on `run.never` (U7) is never
suggested while anything else is offered.

**Badges** (U4): `cardBadges` names how a card fits the build, from the
scorer's own terms, and the card shows each as a word: *Recipe* (a step
toward a known evolution) or *Completes* (the one that readies it),
*Strong here* (a new weapon whose `counters` walk in this region), and
*Slot n/m* (a new item into an empty slot). Long-press says each in full.

## Timing (the app's)

The sim never stops for a draft. While one is open the app runs the arena
at 15% speed (`BALANCE.draft.slowMotion`) and the panel counts down
`BALANCE.draft.seconds` (10 s) of wall time, or 6 s with the Tactician,
then picks the suggestion. Picks and rerolls go through `applyInput`.

**Take suggested ×N** (U2): with two or more drafts banked, one tap takes
every suggestion (`applyInput({ takeAll })` → `takeSuggested`): each hand
is rolled and scored in turn, exactly as one-by-one picks would be. A run
that starts with drafts banked (Head Start, Veteran, the Seal) opens on
the **Opening**: the same panel, titled "Opening · 1 of N", with take-all
as its primary button. Once the Tactician is owned, the Opening takes
everything by itself after `BALANCE.automation.openingSeconds` (2 s); any
touch on the panel stops that count, so the player can review card by
card. Cards taken unseen are marked seen: they are on the tower.

## Rerolls and Banish

Fortune's reroll notable gives rerolls per run (`run.rerolls`). A reroll
replaces the open hand with a fresh one from the same stream.

**Banish** (N1): Fortune's Banish (ring 2, up to 3) and Clean Slate (ring
4, up to 2) give a charge a level (`run.banishes`); so does a Trial's
notable. `applyInput({ banish: i })` strikes card `i`'s item from the run
(`run.banished`): `candidateCards` never offers it again, and the card is
replaced from the draft stream (another candidate, else a fallback). Only a
**new** item can be banished: what the tower carries is never clutter, and
an evolution or a fallback is no item. The first, authored draft can't be.
With the Tactician's Never list (U7), the run spends its charges on Never
items by itself as each hand is dealt. Banished items are part of the run's
state, so a snapshot keeps them.

## NEW stamps

`profile.seenCards` remembers every card key ever offered; a card not in it
wears a NEW stamp, and the results screen lists the run's discoveries.
