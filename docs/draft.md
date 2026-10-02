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

- a ready **evolution** (weapon at its last level, partner passive owned,
  Alchemy owned) — always in the hand;
- the next level of every owned weapon and passive below level 5;
- a **new** weapon or passive from the pool, only while a slot of its kind
  is free.

`rollOffer` fills the hand: evolutions first, then a uniform sample by
partial Fisher–Yates on the `draft` stream, padded with **fallback** cards
(heal 30%, a pinch of shards) when nothing else is left. The hand is
`BALANCE.draft.choices` (3), plus Choice and Foresight and Jackpot, less
Scarcity, clamped to 2–6. Past four cards the panel wraps into
two rows of three.

The profile's **first draft** is authored (`meta/runConfig.ts`): one card
of each kind, nothing to misread. It is the only draft that stops the
arena, and it cannot be rerolled.

**Invariant:** the draft never offers a new item for a slot type that is
already full (`tests/draft.test.ts`).

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

**Specialist** (S4): until its first weapon card, its one slot may be
swapped. A new weapon on offer takes the starting weapon's place at its
level (`run.swap`; the card reads "Swap weapon"); any weapon card locks it.

The suggested card is highlighted, and taken when the timer runs out. The
same scorer drives every bot in `tools/`, so a better bot is better idle
play (§13).

With the Tactician ([idle.md](idle.md)), `run.priority` ranks first: an
evolution ahead of everything, then the listed items in the player's order,
then the scorer for anything unlisted.

## Timing (the app's)

The sim never stops for a draft. While one is open the app runs the arena
at 15% speed (`BALANCE.draft.slowMotion`) and the panel counts down
`BALANCE.draft.seconds` (10 s) of wall time, or 6 s with the Tactician,
then picks the suggestion. Picks and rerolls go through `applyInput`.

## Rerolls

Fortune's reroll notable gives rerolls per run (`run.rerolls`). A reroll
replaces the open hand with a fresh one from the same stream.

## NEW stamps

`profile.seenCards` remembers every card key ever offered; a card not in it
wears a NEW stamp, and the results screen lists the run's discoveries.
