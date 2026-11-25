# The Contract board: readings

Plan: [plans/late-game/10-contracts.md](../plans/late-game/10-contracts.md).
Code: `src/meta/contracts.ts` (grammar, generator, settling),
`src/content/contracts.ts` (quarry, omens, milestone trims, the text
templates), `src/ui/hub/contracts.ts` (the board), `tools/contractBot.ts`
(the bots' policy).

## How to read it

- `npm run pacing -- --hours 12 --seeds 8`: the active bot takes a card every
  4th run once Forgeheart falls (`CONTRACT_EVERY`, offset from the Trials'
  turn). The seeds summary prints runs taken and success by tier; completions
  and milestones are reveals in the timeline.
- `npm run pacing -- --act2 --reuse --hours 12 --seeds 4 --contracts 0.33`:
  that share of Act 2 runs is a card. Read Starlight per hour against the same
  command without `--contracts`; it also prints riders and milestones per
  hour of contracts (want ≥ 1) and success by tier.
- `tools/idle.ts` fails hard if a hands-off run ever settles a contract (I9).

## 2026-11-15, first build

### Act 1 (8 seeds, 12 h)

| | `main` (1b81cbd) | with contracts |
|---|---|---|
| the Blight first falls, median | 262:01 | 245:23 |
| worst 2–10 h reveal gap, per seed | 86–155 min | 34–83 min |
| Hollow King → Blight worst gap | 9–16 min | 4–9 min |
| cards taken per seed | — | 35–41 |
| success T1 / T2 / T3 / T4 | — | 36/96 · 44/84 · 48/121 · 2/3 |

- **I1b fails on `main` already**: the Blight falls at ~4.4 h, under the 7 h
  floor (the plan's "~482 min" is out of date). Contracts move it ~17 min
  earlier; they don't cause the failure, and they don't fix it.
- **I6 (2–10 h ≤ 30 min)** still fails, but the worst gaps halve. The board
  is the reveal source the late Act 1 stretch lacked.
- **Success is under the plan's 85 / 65 / 45 / 30%.** At the hardest moment
  (the board just opened at Forgeheart's fall, 90 cards) the misses were: the
  frontier boss with a rule (13), a hold or wave not reached (11), and `carry`
  (8 of 10 missed: the bot drafts by suggestion and never steers to the named
  weapon). `noUlt` went from 0/29 to 16/30 once the bot holds its ultimate
  for such a card, as a player would (`PlayOptions.holdUlt`).
- One scoring change from these readings: an overtime hold past the region's
  own best wave gets +1 stretch, like heat and floors. Without it, a hold
  just past the first clear scored as easy as one well inside the record.

### Act 2 (4 seeds, 12 h, saved starts)

Not read at the first build: the 0% and 33% readings were still running at
its commit. See the review below.

## 2026-11-15, review: what a card asks, and what it pays

A probe behind these numbers: the active bot's profile at three checkpoints
(Forgeheart's, the Hollow King's and the Blight's first fall, two seeds), 60
boards each, the slots taken in turn, every card played once.

### What was wrong

| Finding | Seen as | Change |
|---|---|---|
| A card asked for what the tower can't yet do there | "Slay 270 Phantoms" in a region reached to wave 9; "Reach wave 10" where 10 is the record, under two handicaps; the frontier's boss (felled once) with a rule, as a Quick card | `slay` only where the region's boss has fallen `freshKills` (3) times; a `wave` stays two under the region's best; the stretch is scored (a boss felled under three times +2, a wave near the best up to +1.5, a hold past it +3, an omen 0.75 a rank); the Quick slot draws only targets well inside the records (`comfortable`) |
| A named weapon was left to the draft's luck | `carry` met 0–11%: "Chain Lightning dealt 0%" (never offered); "Evolve Arcane Bolt … as the Bastion" (not mounted) | a card that names a weapon starts with it mounted (`contractLead`, shown on the card); a carry and an evolve name the same weapon; `carry` scores 2 |
| A speed record under a handicap it wasn't set with | "Fell Forgeheart with no passives, within 75 s": 0 of 6 | `within` never pairs with a slots or weapons rule, or a carry |
| The card's place stuck | after a card in the Mire, Run again and auto-restart farmed the Mire (and a floor card left the Abyss starting at its waypoint) | the next run goes back to the region and waypoint the player was at (`contracts.back`, profile v24) |
| The pay was sized on 15-minute runs | a card's run is ~3 wall minutes at 3×: at 6/10/15/22 farm minutes a card hour earned 2.0–2.5× (Quick), 3.2–3.7× (Steady), 3.7–4.4× (Hard) the frontier's farm, against the plan's ceiling of 1.5× | `minutes` 2.5 / 3.5 / 5 / 8 |
| A stretch past a record of nothing | Act 2 just opened: "at heat 1" and "floor 1" scored +2.5, so the Hard slot held trivial cards | a heat or floor stretch is worth at most half its own height |
| Half-minute cards | "Reach wave 10 …", retreat, repeat: with free rerolls, the best income in the game | a `wave` asks for 15, 18 or 20; `untouched` for 10–16 |
| "Leechs" | the `slay` text | `plural`: "Leeches" |

The bots now steer a card's run as a player would (`steerConfig`: the named
weapon and its recipe's passive first on the Tactician's list; for a `carry`,
other weapons on the Never list), so the readings no longer understate
`carry` and `evolve`.

### The probe, before and after (success by slot)

| Checkpoint | Quick | Steady | Hard |
|---|---|---|---|
| Forgeheart, before | 63% | 40% | 45% |
| Forgeheart, after | 90% | 80% | 53% |
| Hollow King, before | 43% | 33% | 33% |
| Hollow King, after | 85% | 90% | 45% |
| Blight, before | 70% | 54% | 65% |
| Blight, after | 95% | 94% | 64% |

A card hour against the frontier's farm, after (the run's own shards plus
the pay, misses included): Quick 0.9–1.2×, Steady 1.3–1.4×, Hard 1.6–1.8×.

### Act 1 again (8 seeds, 12 h)

| | no board (1b81cbd) | first build | fixed asks, old pay | fixed asks, pay 2.5/3.5/5/8 |
|---|---|---|---|---|
| the Blight first falls, median | 262:01 | 245:23 | 222:34 | **252:45** (232–278) |
| worst 2–10 h reveal gap, per seed | 86–155 min | 34–83 min | 20–63 min | 19–73 min (six of eight at 31–33) |
| Hollow King → Blight worst gap | 9–16 min | 4–9 min | 4–16 min | 5–14 min |
| cards taken per seed | — | 35–41 | 31–41 | 39–44 |
| success T1 / T2 / T3 / T4 | — | 38 / 52 / 40 / 67% | 93 / 86 / 81 / 81% | **89 / 74 / 80 / 59%** |

- With the asks fixed and the old pay, the board pulled the Blight 40 min
  early: the cards were being met, and each paid several runs' worth. At the
  new pay it moves the Blight 9 min, less than the first build did.
- **I1b fails without the board too** (the Blight at ~4.4 h against 7–12 h);
  that is Act 1's retune (docs/balancing.md, Tempering), not the board's.
- Success is at or over the plan's 85 / 65 / 45 / 30%. T3 and T4 read high
  here because this bot never plays Act 2: for the eight hours past the
  Blight its heat and floor records stand at nothing, so its Hard cards stay
  shallow. The checkpoint probe above (Hard 45–64%) is the truer reading of
  a Hard card.
- **I6 (2–10 h ≤ 30 min)** still fails, 1/8, but six seeds' worst gap is now
  31–33 min against 86–155 without the board.

### Act 2: the bar

Starlight per hour with a third of the runs taken off the board, against
none (`--act2 --reuse`):

| Reading | 0% | 33% | Ratio | Card success T1 / T2 / T3 / T4 | Contract-only rewards |
|---|---|---|---|---|---|
| First build, 12 h × 4 seeds | 56.5 | 58.4 | 1.03× | 30 / 52 / 23 / 57% | 0.25 an hour |
| Review, `--fast`, 8 h × 2 seeds | 78.3 | 92.1 | 1.18× (1.18, 1.11) | 6/6 · 15/15 · 10/12 · none dealt | 0.62 an hour: 1.9 per hour of contracts |
| Review, full, 12 h × 4 seeds (2026-11-16) | 56.5 | 69.3 | **1.23×** (1.21, 1.16, 1.23, 1.28) | 23/23 · 24/32 · 16/22 · 5/10 | 1.51 per hour of contracts PASS |

- The first build's board was worth nothing in Act 2 (1.03×): its cards
  were missed two times in three. With the asks fixed it reads 1.1–1.2×
  over the first eight hours, the richest in the game for everything else
  (the ladders, the strata's lumps, Boss Rush and 235 Starlight of feats all
  land there: the 0% line falls from 143 an hour in hour 1 to ~30 by hour
  6). A card is worth about 10 Starlight and the bot takes two an hour, so
  the ratio climbs as the other sources dry: at ~30 an hour it is ~1.6×.
  `starlight` (4 / 8 / 13 / 20) is therefore left as it is: the board sits
  under the bar's floor early and over its ceiling late, and inside it on a
  12–20 h average.
- The full reading (2026-11-16, at 4fecf33) settles it: **1.23×**, inside
  the bar (1.2–1.5×), on every seed 1.16–1.28. Its 0% line is the first
  build's to the decimal (56.5), so the two are like for like. Cards earned
  173–235 Starlight a seed, about a quarter of the session's; 20–24 card
  runs in 63–73. `starlight` stays at 4 / 8 / 13 / 20.
- **Contract-only rewards** are now read per hour of contracts, as the plan
  asks (`pacing.ts#contractHours`); the first build divided by the whole
  session, a third of which was cards.
- Heat 10 at the frontier comes later with the board: a card run is a run
  not spent on the ladder. The `--fast` reading had it 86 → 198 min and the
  gate (3–12 h) passing with the board; the full one reads 1:45 → 2:57, so
  the gate fails short either way. The ladder is quick, not the board's.
- T4 is dealt over a full session (10 of 87 cards; none in the `--fast`
  reading's 33), so Act 2's Hard slot needs nothing added.
- Success reads over the plan's 85 / 65 / 45 / 30% at T2–T4 (75 / 73 /
  50%), on small samples. Hard is easier in Act 2 than its pay assumes, but
  the bar holds with it, so it is left: a T3 or T4 card is still the one a
  player picks for its rider.

## 2026-11-16, review: the texts

A read of ~600 cards (150 rerolls at Forgeheart's, the Hollow King's and
the Blight's checkpoints, and at a saved Act 2 start).

- After the comma, a weapon list or a `carry` dropped its "with" (§2's "at
  heat 5, Frost Ring and Glaives only"). After a name that reads as a list:
  "Fell Forgeheart as the Bastion, Mortar, Glaives and Scattershot only" is
  four things, as is "above 70% HP, Arcane Bolt, Chain Lightning and Glaives
  only". The "with" now stays, and is dropped only where keeping it would
  pass 15 words (R4). The cards drawn are the same: every card that was
  valid still is, so no reading moves.
- The rest read as meant. "Starts with X mounted." sits under every card
  that names a weapon; no card asks a wave past the region's best.

## 2026-11-25, the Wake joins (plans/late-game/12 §8.11)

Regional cards draw the Wake's five regions as they open (`regionsOpen`;
the free plan never draws them). Floor, guardian and Rush cards now wait
for the Thunderhead (`abyssOpen`), not the Blight; `tests/contracts.test.ts`
holds both. `QUARRY` has no Wake entries yet, so a Wake card never asks for a
slay. The contract bot is not yet read with the Wake in the pool.

## Open

- Act 2's Hard success (T3 73%, T4 50% against 45 / 30%): read again over
  more seeds before tightening its asks; the pay is inside the bar as it is.
- I7 (screen time to the Blight with contracts) is not read: the idle tool's
  engaged mode doesn't take cards.
- A human pass on `carry` (40% for the steering bot, which can only refuse
  every other weapon).
