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
| `inspect.ts` | one seeded run (or many) as a per-wave table: level, DPS, HP pool, clear time, carried bodies, damage taken, damage by weapon (`--by-weapon` over many); Forge presets `none`, `arsenal`, `ring1`–`ring6`, `all`; any region |
| `arsenal.ts` | I4: the bot's weapon picks in each region over many seeds, with Act 1's cards (none a Constellation lights); `--keystones` (T4): each keystone against none in Regions 3–6, the next ring bought out, with a verdict: a keystone that only gains is free, one that only loses a trap |
| `calibrate.ts` | T2: the scorer's `damageDps` against what the sim lands, every weapon at L1/L3/L5 and evolved; fails past 25% (`npm run calibrate`, `tests/calibration.test.ts`) |
| `parallel.ts` | seeds in worker threads, one per core: the pacing gates read 8 seeds in about the time one took (12 h × 8 ≈ 100 s) |

Times in the reports are the player's wall clock: sim time over the game
speed, plus the moments a person spends on drafts and between runs.

## The draft scorer

`sim/suggest.ts` estimates DPS gain (through the wave's armour and each
weapon's weaknesses; its damage constants fitted by `npm run calibrate`),
survival gain, counters, recipe progress and slot fill. The same scorer is the in-game suggestion and the
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

## Readings

### Q0 (post-rebuild bugs and data), 2026-10-02

`npm run pacing -- --hours 12 --seeds 4` and `npm run arsenal`, before
(`d3cea42`) and after Q0:

| | Before | After |
|---|---|---|
| first Blight kill, per profile | 537 · 598 · 605 · 669 min | 477 · 537 · 555 · 555 min |
| I1b median | 10:05 (PASS 4/4) | 9:14 (PASS 4/4) |
| first wave 20 (P3) | 31:44 median, FAIL | unchanged |
| I3 · I6 | 4/4 · 3/4 | 4/4 · 3/4 |
| I4 worst | Mortar 31% (Region 2) | unchanged |
| Drones, Regions 5 / 6 | 13% / 4% | 27% / 21% |

The weapons' new `counters` and `weakAgainst` (B1) take ~45 min off the
Blight on their own. Melting a rank-III duplicate for five waves' pay
took a further ~2.7 h (late elites drop many) and failed I1b at 6:38; it
pays one wave's pay. Scaling the Windfall card measured as nothing.
P3 fails as it did before Q0 on this 4-seed sample (T4: gates read 8).

### Q1 (post-rebuild core balance, mechanics), 2026-10-02

Q1's mechanics (S1 buckets, late mult minors and compounding masteries;
S2 the armour curve and Forgeheart's plates; S3 ultimate floors; B2/S4
keystones; S5 Velocity, Greed, point-blank; T1 attribution; T2 the fitted
scorer) with a first retune of region HP. The rest of the retune is
handed off in `plans/q1-balancing.md`.

`npm run pacing -- --hours 12 --seeds 8`, before Q1 and after:

| | Before | After |
|---|---|---|
| first wave 20 (P3) | 26:46 | 27:22 PASS |
| Gatekeeper (P4) · I1a | 33:24 · 8/8 | 32:10 · 8/8 |
| Bog Mother | 70:40 | 73:56 |
| Forgeheart | ~165 | ~145 (gate: 132–198) |
| Blight · I1b | 537 · 8/8 | 400 · 1/8 FAIL |
| I3 · I6 | 8/8 · 5/8 | 5/8 · 3/8 |

Idle (4 seeds): I2 4.5 d FAIL (want 5–10); I5 1.32–1.49 at every gated
checkpoint, PASS. `npm run arsenal`: I4 PASS (Mortar 31%, Region 2).
`npm run arsenal -- --keystones`: PASS, but Specialist gains in four
regions and Fortress only loses. `npm run calibrate`: T2 PASS (0 of 48).

Act 2 (4 seeds): heat 10 at the frontier at 74:31 (before: never), so
now far too fast. Compounding, cheaper masteries let the bot buy ~84
levels in 12 h (43 before). Best Abyss floor 6 (4 before).

What moved what (ablations, 8 seeds): the armour curve alone takes ~5 min
off the Gatekeeper (Brutes stop flooring hits); the buckets alone take
~18 min off the Bog Mother and hours off the late game. Regions 4–6 were
easier by 3–5 waves at their own ring before their HP was raised.

### Q2 (post-rebuild UX), 2026-10-02

What Q2 moves in the sim: U14's targeting (Sunlance holds the toughest
body, Gilded Rail aims down the most crowded line, Drones hunt standoff
bodies), U13's per-ultimate Autocaster rules, and U2's take-all (the
active bot takes every banked draft in one tap; the idle bot's Opening
takes itself after 2 s once the Tactician is owned). Q1's retune is still
owed (`plans/q1-balancing.md`), so the gates it fails still fail; these are
read against `58cba67` (Q1) on the same seeds.

`npm run pacing -- --hours 12 --seeds 8`:

| | Q1 | Q2 |
|---|---|---|
| first wave 20 (P3) | 27:22 PASS | 27:22 PASS |
| Gatekeeper (P4) · I1a | 32:10 · 8/8 | 32:10 · 8/8 |
| Bog Mother | 73:56 | 72:56 |
| Forgeheart | ~145 | ~141 |
| Blight · I1b | 400:28 · 1/8 FAIL | 389:56 · 0/8 FAIL |
| I3 · I6 | 5/8 · 3/8 | 6/8 · 2/8 |
| first evolution | 99:56 | 97:59 |

`npm run pacing -- --idle --hours 12 --seeds 4` (I5 re-read after U2 and
U13): I2 median 4.5 d both (FAIL, Q1's; seeds 5.0 4.0 4.5 4.5 → 4.5 4.0
4.5 5.0). I5 PASS at every gated checkpoint, idle now relatively closer:
Region 2 1.32 → 1.27, Bog Mother 1.32 → 1.20, Prism 1.43 → 1.32,
Forgeheart 1.42 → 1.36, Hollow King 1.49 → 1.36, Blight 1.46 → 1.37. The
idle Opening (run start to the first draft-free moment) is 30 s at the
Gatekeeper checkpoint, before the Tactician, and 2 s from Region 2 on.

`npm run arsenal`: I4 PASS (worst Mortar 31%, Region 2); Drones rise to
21–31% of new-weapon picks in Regions 3–6. `npm run arsenal --
--keystones`: PASS, the same shape as Q1 (Specialist gains in four
regions, Fortress loses in four). `npm run calibrate`: T2 PASS, 0 of 48,
after re-fitting the rail constants to the line doctrine (`RAIL_BODIES`
1.9 → 1.45, `RAIL_BODIES_PER_UNIT` 1/40 → 1/9, `RAIL_EXTRA_SLUG` 0.6 →
0.37, `MIDAS_VALUE` 0.1 → 0.16).

`npm test`: everything but two of `tests/pacing.test.ts`'s CI seeds: I6
(its 10:27 gap was 10:43 at Q1) and I2, whose one CI profile moved from
5.0 d to 4.5 d, the full report's median. Both are Q1's retune.

### Q3 (post-rebuild new mechanics), 2026-10-02

N1–N7 built (Banish, tower tiers, region auras, Champions and trophies,
Trials, relic sets, the Foreman). The pacing bot now tries an open Trial
behind the frontier every 8th run (at most twice each), and reports I6's
later clause (2–10 h, ≤ 30 min) and the Hollow King → Blight stretch.
Q1's retune is still owed, so its failing gates still fail.

`npm run pacing -- --hours 12 --seeds 8`:

| | Q2 | Q3 |
|---|---|---|
| first wave 20 (P3) | 27:22 PASS | 27:22 PASS |
| Gatekeeper (P4) · I1a | 32:10 · 8/8 | 32:10 · 8/8 |
| Bog Mother | 72:56 | 70:50 |
| Forgeheart | ~141 | ~147 |
| Hollow King | — | ~222 |
| Blight · I1b | 389:56 · 0/8 FAIL | 310:47 · 0/8 FAIL |
| I3 · I6 (first 2 h) | 6/8 · 2/8 | 4/8 · 4/8 |
| first evolution | 97:59 | 94:06 |

Q3's gate readings:
- **Hollow King → Blight**, longest gap between reveals: 14:02–32:11,
  7/8 within 30 min (Champions, the regions' auras, trophies, Trials and
  sets fill it).
- **I6 from 2 h to 10 h: 0/8, gaps 2–5 h.** Every gap starts at the
  Blight's fall (~5 h): the Act 1 bot reveals nothing after Act 1 ends, and
  this report doesn't play Act 2. The clause only means something once I1b
  puts the Blight back at 7–12 h (Q1's retune), or read over Act 1's span.
- **The Blight comes ~80 min sooner** than at Q2: trial notables (Dawn
  Muster, Drill Sergeant, Mire Sight), relic ranks from Trials and set
  bonuses all add power. Q1's retune must now absorb that too.
- Trials won by 12 h: 13–14 of 18.
- Arsenal and keystone sweeps: not yet re-read.

### Q1 balancing (the retune, `plans/q1-balancing.md`), 2026-10-02

Read against `3e9ac3b` (Q2–Q4, camera and fog) on the same seeds. Known
problems 1–2 are done; the pass stopped at 3 (I3), which numbers alone
can't meet (below). Items 4–10 are not started.

One change: Regions 5–6 (`content/regions.ts`), HP up and pay down.

| | Region 5 | Region 6 |
|---|---|---|
| hpBase | 1600 → **2200** | 2000 → **2300** |
| shardBase · waveShards | 29 · 58 → **20 · 40** | 100 · 200 → **60 · 120** |

`npm run pacing -- --hours 12 --seeds 8`:

| | Before | After |
|---|---|---|
| first wave 20 (P3) | 27:51 PASS | 27:51 PASS |
| Gatekeeper (P4) · I1a | 32:09 · 8/8 | 32:09 · 8/8 |
| Bog Mother | 71:46 | 71:46 |
| Prism | 108:43 | 108:43 |
| Forgeheart (gate 132–198) | 148:37 PASS | 148:37 PASS |
| Hollow King | 228:42 | 311:29 |
| Blight · I1b | 328:36 · 0/8 FAIL | 502:57 · 8/8 PASS (424–583) |
| I3 · I6 (first 2 h) | 4/8 · 7/8 | 4/8 · 7/8 |
| first evolution | 95:00 | 95:00 |
| Hollow King → Blight, gaps ≤ 30 min | 7/8 (19:33–32:03) | 0/8 (38:18–102:42) |
| I6 2–10 h | 0/8 | 0/8 |
| Trials won by 12 h | 13–14 | 11–13 |

`npm run pacing -- --idle --hours 12 --seeds 4`: I2 4.5 d FAIL (4.5 4.0
4.5 4.0) → **5.0 d PASS** (5.5 5.0 5.0 4.0). I5 PASS at every gated
checkpoint: Region 2 1.25, Bog Mother 1.20, Prism 1.34, Forgeheart 1.28,
Hollow King 1.24, Blight 1.24.

Other gates, after: `npm run arsenal` I4 PASS (worst Mortar 31%, Region
2; Drones 21–31% in Regions 3–6). `npm run arsenal -- --keystones` PASS,
the same shape as Q2 (Specialist gains in four regions, ×3.04 shards in
Region 6 and the only Blight kills; Fortress gains only Region 3's boss
kills and costs in four). `npm run calibrate` T2 PASS, 0 of 48.
`tests/draft.test.ts` (a Power level ≥ +10% with the full Forge) passes.
`npm test`: one failure, the CI P3 median (below); the CI I2 profile now
passes (5.5 d).

`npm run pacing -- --act2 --hours 12 --seeds 4` (P8, item 9 not started):
heat 10 at the frontier 74:33 → 93:21 (want 3–12 h, FAIL both); 183–193
→ 155–176 mastery levels in 12 h; best Abyss floor median 9 both; no
last star in 12 h. Region 6's lower pay slows Act 2 a little; the
masteries' price is still item 9's.

How it was found (8 seeds, HP alone, the pay unchanged):

| Region 5 · 6 hpBase | Hollow King | Blight · I1b | idle Blight (4 seeds) |
|---|---|---|---|
| 1800 · 2300 | 243 | 371 · 0/8 | 4.0–5.5 d, I2 5.0 |
| 2200 · 3200 | 269 | 530 · 8/8 | never (20 d) |
| 2600 · 2800 | 339 | 503 · 8/8 | never (12 d) |
| 3000 · 2300 | — | — | Hollow King never on 2 of 4 |

HP alone can't do it, because of the idle bot. Offline pay at the frontier
buys a late ring out in one check-in (Region 6 pays 80–130M a check-in,
120–200M before; ring 6 costs 57M), and Act 1 has no sink past the ring (the masteries are
Act 2's), so the idle bot meets each late boss with its ring full: the boss
falls to that or never. The active bot fells the Blight with 21–43M of
ring 6 unbought, on ~57 relic ranks (Trials) to the idle bot's ~40 and
casting by hand. So late HP is capped where the idle bot's full ring still
wins (Region 6 ~2300, Region 5 ~2600), and the active bot's hours come
from the pay. At 2300 the idle Blight is a coin toss once ring 6 is full
(it falls 1–3 check-ins later): I2 passes at 5.0 d but has no margin.

The Hollow King → Blight stretch is ~190 min now (Q3's gate wants it to
hold a reveal every 30 min): the Champions, trophies and Trials that filled
~100 min don't fill this. That is Q3's to fill, as its readings expected.

**I3 can't be met with numbers alone.** A probe from the real pacing state
(each seed's profile at the Bog Mother's fall, shopped, then 12 Region 3
runs each, 8 seeds) wipes at wave 2–3 in 21 of 96 runs, and every wipe is
Arcane Bolt + Scattershot in a two-slot tower: Twin Mount's random second
weapon is Scattershot about one run in six, both slots are then full, and
neither weapon lands on Region 3's shield-only waves 1–4, so no draft can
add one that does. The plan's levers, measured on the same probe:
- Burrowers from wave 3 (pool and beat): 21 → 21 wipes; the tower is dead
  before they surface.
- Ring 3's weapons cheaper (Sunlance 400, Glaives 440, Drones 700): 21 → 22
  wipes; I3 4/8 on the 3 h report. Only dilution, and Twin Mount still
  draws Scattershot.
- A new-weapon card when nothing has landed (`draft.ts#rollOffer`): no free
  slot to take it into.
- Region 3 later: doesn't change Twin Mount's draw, and a later arrival
  only makes the next node dearer against a wipe's pay.
Without Twin Mount the same probe wipes 6 of 96 (the scorer still drafts
Scattershot there, its `weakAgainst` counted at ¼ where the sim lands
none). A fix needs a mechanic: Twin Mount drawing a weapon the region's
opening doesn't blunt, or a third slot before Region 3.

**The CI P3 reading fails** (median of seeds 1–3, 31:24: 34:31 24:56
31:24), as it has since the camera and fog merge; the 8-seed P3 passes at
27:51. Not on the plan's list, so not touched. A lever seen in passing:
Region 1 `hpGrowth` 1.18 → 1.175 puts the CI median at 25:59 (8 seeds
26:05) but moves I6 (read on 2 h only).

### Q1: Twin Mount avoids the region's blockers (I3), 2026-10-03

The mechanic the I3 probe asked for, chosen by the owner. Twin Mount's
second weapon is drawn, on the same `loadout` stream, from the spares not
weak against (`weakAgainst`) any type the region's first 4 waves can bring
(`behaviours.twinMountOpening`; pool and introduced types), preferring
those that counter one; every spare blocked, the old uniform draw
(`run.ts#twinSpares`, `docs/forge.md`). The scorer's ¼ for blocked shots
is unchanged.

The I3 probe (each seed's profile at the Bog Mother's fall, 12 Region 3
runs, 8 seeds): wipes at wave ≤ 6 **21/96 → 0/96**, I3-low results 8/96
→ 0/96.

`npm run pacing -- --hours 12 --seeds 8`, against the Q1 balancing commit:

| | Before | After |
|---|---|---|
| first wave 20 (P3) · Gatekeeper · I1a | 27:51 · 32:09 · 8/8 | unchanged |
| Bog Mother | 71:46 | 71:27 |
| Prism | 108:43 | 79:50 |
| Forgeheart (gate 132–198) | 148:37 | 134:59 PASS |
| Hollow King | 311:29 | 303:21 |
| Blight · I1b | 502:57 · 8/8 | 445:46 · 6/8 PASS (414–569) |
| I3 · I6 (first 2 h) | 4/8 · 7/8 | **7/8** · 5/8 |

The Prism falls ~30 min sooner: Region 3 is no longer a wipe a run in
five, and Twin Mount there now draws a shield-counter (Mortar, Drones)
rather than any spare. Forgeheart follows to 135 (the gate's floor is 132).
I3's last failure (seed 7, a Region 3 wave-5 death at 80 min with 32%
toward the next node) is an ordinary early death, not a blocked opening.
I6 loses two seeds: the Prism stretch that held reveals now ends sooner,
leaving 10:36–15:56 gaps at 95–115 min (Region 3's ring-3 Forge stretch).

Idle (4 seeds): I2 5.0 → **6.0 d PASS** (7.0 5.0 4.5 6.0); I5 PASS at
every gated checkpoint (1.22–1.33).
