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
  command without `--contracts`; it also prints riders and milestones per hour
  (want ≥ 1) and success by tier.
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

Pending: `--act2 --reuse --hours 12 --seeds 4` at 0% and 33% contract runs
was still running at this commit. The bar (Starlight per hour 1.2–1.5× the 0%
line, ≥ 1 contract-only reward per hour, the last star not before 20 h) is
not yet read.

## Open

- Tune `BALANCE.contracts.minutes` / `starlight` against the bar (plan §4.4,
  step 4's gate), and the Quick band's asks toward ~85% success, before
  calling the board kept or cut.
- I7 (screen time to the Blight with contracts) is not read: the idle tool's
  engaged mode doesn't take cards.
