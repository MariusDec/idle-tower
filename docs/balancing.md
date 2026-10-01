# Balancing and validation

The balance tools run the real sim headless at full speed, so a tool's
verdict is the game's, not a model's (§13). Every tunable number lives in
`content/balance.ts` or per-item data; nothing tunable lives in `sim/`.

## Invariants (§8.4)

| | Rule | Measured by |
|---|---|---|
| I1a | boss 1 first falls within 20–40 min | `npm run pacing -- --seeds 8` |
| I1b | the Act 1 finale first falls within 7–12 h | `npm run pacing -- --hours 12 --seeds 8` |
| I2 | the idle bot finishes Act 1 in 5–10 days | `npm run pacing -- --idle --hours 12 --seeds 4` |
| I3 | every Act 1 results screen shows an affordable node or ≥ 50% toward one | the pacing report |
| I4 | no weapon takes over 40% of the bot's new-weapon picks; every weapon is taken somewhere | `npm run arsenal` |
| I5 | active shards per hour ÷ idle shards per hour within 1.15–1.5 | the idle report, from Region 2 on |
| I6 | no gap between reveals longer than 10 min in the first 2 h | the pacing report |

Phase gates add their own readings: P3's first wave 20 within 15–30 min,
P8's heat 1–10 at the frontier within the target time
(`npm run pacing -- --act2 --hours 12 --seeds 4`).

## The tools (`tools/`)

| Tool | What it does |
|---|---|
| `bot.ts` | input policies: `active` takes the suggestion at once and casts into a crowd; `bare` never acts |
| `play.ts` | one run under the active or idle policy, with the player's wall clock |
| `shop.ts` | the bots' Forge buying: cheapest first |
| `pacing.ts` | a fresh profile for N hours: buys, claims feats, pushes the frontier; prints the run table, the reveal timeline (`--csv`) and the verdicts |
| `idle.ts` | the idle bot: two 20-minute check-ins a day with the hands off, offline between; and the active/idle farm comparison at the same Forge states |
| `act2.ts` | the active bot carried past the Blight: heat ladders, stars, the Abyss |
| `inspect.ts` | one seeded run (or many) as a per-wave table: level, DPS, HP pool, clear time, carried bodies, damage taken; Forge presets `none`, `arsenal`, `ring1`–`ring6`, `all`; any region |
| `arsenal.ts` | I4: the bot's weapon picks in each region over many seeds, with Act 1's cards (none a Constellation lights) |

Times in the reports are the player's wall clock: sim time over the game
speed, plus the moments a person spends on drafts and between runs.

## The draft scorer

`sim/suggest.ts` estimates DPS gain, survival gain, counters, recipe
progress and slot fill. The same scorer is the in-game suggestion and the
bots' policy, so improving the bot improves idle play.

## Tuning practice

- Change one number, rerun the report that reads it, compare per profile
  (not only the median): the seeds are deterministic, so a profile that
  moves by hours where its neighbours move by minutes is variance being
  amplified, not a trend.
- Late bosses are where variance lives: the Blight's first fall swings by
  hours on a small perturbation, because failed attempts reach wave 20
  already overrun. Region 6's wave-15 swarm was softened to ×1.25 in P9 for
  that reason.
- Playtests (§13) calibrate the bot against people; their five questions
  are in the plan.
