# Balancing and validation

The balance tools run the real sim headless at full speed, so a tool's
verdict is the game's, not a model's (§13). Every tunable number lives in
`content/balance.ts` or per-item data; nothing tunable lives in `sim/`.

## Invariants (§8.4)

| | Rule | Measured by |
|---|---|---|
| I1a | boss 1 first falls within 20–40 min | `npm run pacing -- --seeds 8` |
| I1b | the Act 1 finale first falls within 3.5–6 h (R3; was 7–12 h) | `npm run pacing -- --hours 6 --seeds 8` |
| I2 | the idle bot finishes Act 1 in 5–10 days | `npm run pacing -- --idle --hours 12 --seeds 4` |
| I3 | every Act 1 results screen shows an affordable node or ≥ 50% toward one | the pacing report |
| I4 | no weapon takes over 40% of the bot's new-weapon picks; every weapon is taken somewhere | `npm run arsenal` |
| I5 | active shards per hour ÷ idle shards per hour within 1.15–1.5 | the idle report, from Region 2 on |
| I6 | no gap between reveals longer than 10 min in the first 2 h; none longer than 30 min from 2 h to the Blight's first fall (R2 §5). Each a gate on ≥ 6 of 8 profiles | `npm run pacing -- --hours 6 --seeds 8` (CI gates every profile's first hour: R2 below) |
| W1 | Forge weapons bought ≥ 5 min apart, never two in one shop visit (plans/forge-weapon-pacing.md). A gate on ≥ 6 of 8 profiles, for the bot and for `--weapons-first` | `npm run pacing -- --hours 2 --seeds 8 [--weapons-first]` |
| I7 | the engaged idle-schedule bot reaches the Blight with ≤ 0.70× the hands-off bot's screen time (median, 4 seeds) | `npm run pacing -- --idle --hours 12 --seeds 4` |
| I8 | the hands-off bot finishes Act 1 in 5–10 days for every seed; median aims at 6–8 | the same |
| I9 | no active-only reward (`RunSummary.activeOnly`, `tools/play.ts#ACTIVE_INPUTS`) reaches the hands-off bot | the same, and `tests/storedLight.test.ts` |

I7–I9 come from `plans/late-game/01-stored-light.md` §9.1 and are shared by
every late-game plan. I5 is read with the Stored Light pool zeroed.

Phase gates add their own readings: P3's first wave 20 within 15–30 min,
P8's heat 1–10 at the frontier within the target time
(`npm run pacing -- --act2 --hours 12 --seeds 4`).

**Runs have an end (D-26, plans/late-game/12a).** In every region, Act 1
and the Wake, normal play included, overtime ends after 20 waves (wave 40,
`BALANCE.overtime.maxWaves`) or 600 sim seconds past the boss's fall
(`maxSeconds`), whichever comes first. The run ends **won** (`cleared`).
The Abyss and Boss Rush have no overtime and are not capped (O-6). The
reading that goes with it: **no region run over 20 sim minutes**, and no
run cut off by the tools' 3600 s safety net (the pacing report's "runs cut
off" and "longest run" lines). One exception is accepted: pre-boss waves
at high HP plus a full overtime take ~26 sim minutes (25.9 in the Wake,
27.4 in the Act 1 sweep; "The Wake: second tuning" below). That is a long
run, not a stall.

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
| `arsenal.ts` | I4: the bot's weapon picks in each region over many seeds, with Act 1's cards (none a Constellation lights), on the frontier profiles; `--keystones` (T4): each keystone against none in Regions 3–6 on the same profiles, with a verdict: a keystone that only gains is free, one that only loses a trap |
| `frontier.ts` | the frontier profiles (R4): the pacing bot's own profile at each Act 1 boss's first fall, seeds 1–3, stored in `tools/fixtures/frontiers.json`; a region is played on its arrival and its clearing profile in turn. Regenerate with `npm run pacing -- --frontiers` after any Act 1 balance change |
| `calibrate.ts` | T2: the scorer's `damageDps` against what the sim lands, every weapon at L1/L3/L5 and evolved; fails past 25% (`npm run calibrate`, `tests/calibration.test.ts`) |
| `parallel.ts` | seeds in worker threads, one per core, with the tool's own flags: the pacing gates read 8 seeds in about the time the slowest one took |

Times in the reports are the player's wall clock: sim time over the game
speed, plus the moments a person spends on drafts and between runs.

## The draft scorer

`sim/suggest.ts` estimates DPS gain (through the wave's armour and each
weapon's weaknesses; its damage constants fitted by `npm run calibrate`),
survival gain, counters, recipe progress and slot fill. The same scorer is the in-game suggestion and the
bots' policy, so improving the bot improves idle play.

## Tuning practice

- `--fast` (pacing, `--idle`, `--act2`) steps the bots three game steps
  at a time; `--fast=N`, N of them. The weapons still act once per game
  step (`step`'s `weaponSteps`): a weapon attacks at most once each time it
  acts, and a late build fires 30–80 times a second, so a coarse step
  alone capped it at 20 and lost late runs ~10 waves. Each seed then plays
  a slightly different game, but on 2.5 h × 8 the medians held within seed
  noise (wave 20 27:51 → 27:59 / 27:50 at `--fast=6`, Gatekeeper 32:09 →
  31:00 / 30:54, Bog Mother 68:16 → 69:58 / 69:11, Blight 115:30 → 118:49 /
  115:35; I3 unchanged), except the first evolution, ~8 min early in both
  (93:34 → 85:55 / 85:39). Since the weapons are most of a late step, it
  saves less there: a 300-body overtime run is ~1.5× faster at 3, ~2× at 6.
  Use it to look; read a gate without it. `--act2 --fast` keeps its saved
  starts apart from the full ones, per N.

- A long reading's time goes on the late runs. Before D-26, past the
  Blight the bot farmed overtime against a full field (300 bodies) for
  30–60 sim minutes a run. One 4 h profile took 36:40 before the October
  2026 sim speedups and 14:47 after (the same report to the byte); 5:34
  with `--fast`. Since D-26 caps overtime, the Act 1 check (6 h × 8)
  takes 41 s instead of 36.5 min, and the idle report 3 min
  instead of over 45. The Abyss's runs are still uncapped (O-6), so
  `--act2` readings that reach it are still slow.

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

### Q1 balancing (continued), 2026-10-03

On top of the Twin Mount commit. Problem 1 again (the Prism's sooner fall
pulled Forgeheart to 135 and two Blights under 7 h), problem 3's last
seed, then problem 4 (I6), where the pass stops: I6 can't be met with
numbers alone (below). Problems 5–10 are not started.

Two changes:

| | Before | After | Why |
|---|---|---|---|
| Twin Mount cost | 380 | **300** | the bot owns it before Region 3 (I3's last seed: a wave-5 death at 32%) |
| Region 4 hpBase | 460 | **580** | Forgeheart back mid-gate, every Blight past 7 h |

`npm run pacing -- --hours 12 --seeds 8`:

| | Twin Mount commit | After |
|---|---|---|
| first wave 20 (P3) · Gatekeeper · I1a | 27:51 · 32:09 · 8/8 | unchanged |
| Bog Mother | 71:27 | 67:57 |
| Prism | 79:50 | 79:39 |
| Forgeheart (gate 132–198) | 134:59 | **148:44** PASS |
| Hollow King | 303:21 | 303:00 |
| Blight · I1b | 445:46 · 6/8 | **482:09 · 8/8** PASS (431–571) |
| I3 · I6 (first 2 h) | 7/8 · 5/8 | **8/8** · 4/8 |
| first evolution | — | 86:32 (§7.1 aims at 90–120) |
| Hollow King → Blight, gaps ≤ 30 min | 0/8 | 0/8 (44–115 min) |
| Trials won by 12 h | 10–14 | 10–14 |

Idle (4 seeds): I2 **6.0 d PASS** (6.5 5.0 4.5 6.0); I5 PASS at every
gated checkpoint (medians 1.21–1.31). `npm run arsenal`: I4 PASS (Mortar
31%, Region 2). `--keystones`: PASS (Specialist gains in four regions,
×3.05 shards in Region 6; Fortress gains only Region 3's boss times).
`npm run calibrate`: T2 PASS, 0 of 48. `npm run pacing -- --act2 --hours
12 --seeds 4` (item 9 not started): heat 10 at the frontier 91:29 (FAIL,
want 3–12 h; 93:21 at the first Q1 commit), 155–169 mastery levels, best
Abyss floor median 9, no last star in 12 h. `npm test`: one failure, the
CI P3 median (below); `tests/perf.test.ts` passes when run on an idle
machine (it failed once beside 12 pacing workers).

What else was tried (8 seeds, one change each, from the Twin Mount commit):

| Change | Forgeheart | Blight · I1b | I3 | I6 |
|---|---|---|---|---|
| Region 4 hpBase 520 | 135:09 | 475 · 7/8 | 7/8 | 5/8 |
| Region 4 hpBase 580 | 149:43 | 481 · 8/8 | 7/8 | 3/8 |
| Prism HP 50 → 65 / 80 | 137 / 138 | 461 / 469 · 7/8 | 7/8 | 5/8 |
| Ring-4 notables ≥ 6000 ×2 / ×3 | 137 / 137 | 471 / 479 | 7/8 | 3/8 / 1/8 |
| Region 3 hpBase 100 / 112 | 136 / 157 | 456 / 498 | 7/8 / 8/8 | 5/8 / 2/8 |
| Evolution Insight 3000 → 2200 (2.2 h) | — | — | 7/8 | 5/8 |
| Twin Mount 300 + Region 2 shards ±15% (2.2 h) | — | — | 8/8 | 2/8 (+) · 6/8 (−) |
| Twin Mount 300 + R4 580 + Autocaster 420 → 340 (2.2 h) | — | — | 8/8 | 4/8 |

The Prism's HP doesn't move its fall (79:36 → 79:50 at ×1.6): the time is
in reaching wave 20, not in the boss. Raising ring 4's notables takes the
reveals that fill 96–110 min out of the window. Region 2's pay −15% reads
6/8 but puts the Bog Mother at 81 min (§7.1: 60–75).

**I6 can't be met with numbers alone.** The four failures are two kinds:
- Seeds 2 and 7 (13:17, 18:07): one Trial run, Still Water (Region 2,
  Bastion only), tried behind the frontier at 91–99 min with ring 4
  bought, lasts 20:47–20:51 of wall time to overtime wave 49–50 and pays
  ~100–115k shards. Inside it only the first Champion reveals; its three
  trophies, the Trial's win and the notables it buys all land at the
  results screen. This gap is in every variant above. The number that
  ends it, overtime HP growth (×1.25), S6 asks to soften for 8–20 min
  farming runs, the other way. A fix needs a mechanic (a trophy or a
  later Champion revealed in the run, as it is reached) or a different
  Trial policy in the bot.
- Seeds 4 and 5 (10:02, 10:13): Region 2's Forge stretch between Choice
  and the Autocaster at ~46–56 min. Every cost or pay that closes one
  opens another a few seconds over 10 min on a neighbour (the table): the
  first two hours run at about one reveal per 8–10 min, so 8/8 on 8 seeds
  is a coin toss on each, not a tuning target.

The CI P3 reading is unchanged at 31:24 (seeds 1–3: 34:31 24:56 31:24),
still failing; none of this work touches the first 35 minutes.

### Tempering, 2026-10-15

Read against `a943776` (tempering, offline cut to 15–25%) with the
uncommitted sim speedups, `--fast`. Tempering as committed (share 0.5,
every percentage minor) turned Regions 4–6 from a wall into a bypass.

Without tempering (one seed, 5 h), Region 4 was a wall: ~110 min of runs
dying at wave 15 (the swarm), one cheap node every other run, Region 5
then 50+ runs at waves 9–12; Forgeheart at 211 min, no Hollow King by
5 h. A probe shows why: each region against a tower with the ring it
opens bought out (`inspect --forge ringN --region N`, 16 seeds) reaches
wave 19–20 in Regions 1–3, but only 15–16 in Regions 4–6. Region 4's HP
is ×6.6 Region 3's (Q1 raised it 290 → 580) on ×3.5 the pay, and ring 4
costs ×16 ring 3 (66k → 1.05M), mostly in additive minors.

With tempering as committed, seed 2's Blight fell at 1:52 and its pay ran
to 2·10¹¹ shards a run by 4.5 h: some twenty minors, each on its own
cheap curve (ring 1's damage tempers from 227 shards), grow DPS about as
fast as the pay. Leaving shard and XP gain out (`temperable`) isn't
enough on its own.

`npm run pacing -- --hours 9 --seeds 8 --fast`, medians, combat stats only:

| | share 0.5 | 0.5, ×4 price | 0.5, ×3 a level | 0.25, ×4 price | **0.2** |
|---|---|---|---|---|---|
| Bog Mother | 69:58 | 72:56 | 71:23 | 75:33 | 75:38 |
| Prism | 79:58 | 80:38 | 80:30 | 94:54 | 109:15 |
| Forgeheart | 110:55 | 117:39 | 117:07 | 158:38 | 167:12 |
| Hollow King | 125:19 | 136:11 | 149:31 | 216:44 | 234:20 |
| Blight · I1b | 137:47 · 0/8 | 159:58 · 0/8 | 195:47 · 0/8 | 273:16 · 0/8 | **303:14 · 0/8** |
| I3 · I6 (first 2 h) | 8/8 · 6/8 | 8/8 · 5/8 | 8/8 · 6/8 | 8/8 · 5/8 | 8/8 · 1/8 |

(The first two columns read 6 h; "×3 a level" grew each tempered level's price
×3 rather than the curve's ×1.7, in `Web#cost`: not kept.)

Chosen: share 0.2, combat stats only. From the Prism each region takes
about an hour (medians: Region 3 34 min, 4 58, 5 67, 6 69), and inside a region the
runs creep on: seed 2's Region 4 reads waves 11 → 13 → 15 → 19 → the
boss over 35 runs, 1–3 buys a run. `tests/pacing.test.ts`'s I2 profile
passes again (it failed at `a943776`). The cost: I6 in the first 2 h
falls to 1/8 (gaps 6:05–14:44), since Region 3 now takes ~34 min rather
than ~10 and reveals too little to fill it (§7.1 wants it 2–3 h long, so
that is Region 3's content to fix, not tempering's). Still failing, as
before: the CI P3 median and I6, and `tests/arsenal.test.ts`'s
"evolutions happen at the frontier".

Open: I1b. The Blight at ~5 h is short of 7–12 h, but the late game it
lost was the wall. Lengthen it with the regions' pay or a lower share,
or move the gate. I6 past 2 h fails 0/8 (66–117 min gaps in Regions
4–6): the late regions reveal too little between their bosses. Neither
the idle report (I2, I5 over 4 seeds) nor Act 2 has been read with the
offline cut and tempering.

### Stored Light (`plans/late-game/01-stored-light.md`), 2026-11-14

From Night Watch III the night's second part is stored, not paid, and
only runs burn it (×5 / ×8 played, ×2 / ×2.5 left alone). The sim is
untouched: the active bot's run table (`--hours 3 --seed 2`) is
byte-identical to before.

`npm run pacing -- --idle --hours 12 --seeds 4`:

| | Reading | Want |
|---|---|---|
| I2 | median 6.0 d (6.5 5.5 6.0 5.5) PASS | 5–10 d |
| I7 | engaged/hands-off screen time to the Blight, median **0.58** (0.50 0.56 0.58 0.58) PASS; engaged 125–142 min, hands-off 223–269 min | ≤ 0.70 |
| I8 | every seed 5.5–6.5 d PASS; median 6.0 d, at the target's floor | 5–10 d, median 6–8 |
| I9 | the hands-off bot's tally `engaged` 0 and `activeOnly` empty, every seed PASS | empty |
| I5 | 1.23–1.32 at every gated checkpoint, PASS (pool zeroed) | 1.15–1.5 |

The engaged bot burns its whole pool before the Blight (3.0–3.5 days in);
the hands-off bot reaches it holding 23–53 M unspent, as §3.6 intends. The
per-screen-hour diagnostic reads 0.85–3.65: it compares *total* income to
the Blight, and the hands-off bot's extra late days dominate it, so it is
not yet the README's 2–3× reading. Untuned: the three dials stay at the
plan's defaults.

### Late-game review, 2026-11-15

Every late-game plan on (01 Stored Light, 02 Rifts, 03 Glass Crown, 04
anomalies, 05 secrets, 07 Final Form, 08 strata I–II, 10 contracts), read
before and after the review's changes to the Contract board
([contracts.md](contracts.md)); nothing else in the sim moved.

`npm run pacing -- --idle --hours 12 --seeds 4` (the board never reaches
the hands-off bot, and the engaged idle bot takes no cards, so this reading
is the same on both sides of the review):

| | Reading | Want |
|---|---|---|
| I2 | median 6.0 d (6.5 5.5 6.0 5.5) PASS | 5–10 d |
| I7 | engaged ÷ hands-off screen time to the Blight, median **0.55** (0.49 0.53 0.55 0.57) PASS; engaged 123–131 min over 3.0 days, hands-off 223–269 min | ≤ 0.70 |
| I8 | every seed 5.5–6.5 d PASS; median 6.0 d, the target's floor | 5–10 d, median 6–8 |
| I9 | no active-only reward reached the hands-off bot (rifts 0, anomalies offered 0–1 and taken 0, no card) PASS | empty |
| I5 | Region 2 1.35 · Bog Mother 1.27 · Prism 1.26 · Forgeheart 1.24 · Hollow King 1.41 · Blight 1.34 (one seed 0.70), PASS at every gated checkpoint | 1.15–1.5 |
| Final Form, hands-off | 0 of 69 Region 5 runs FAIL (recipes known ≤ 1) | ≥ 10% |

`npm run pacing -- --hours 12 --seeds 8`: the Blight's first fall, median
262:01 without the board, 252:45 with it (I1b FAIL either way: 7–12 h
wanted; Tempering's open item). P3 27:51 PASS, I1a 8/8, I3 8/8, I6 (first
2 h) 5/8, first evolution 90:17: all as before the late-game plans' last
commit, to the second.

What the review settled, and what it leaves:

- **The Contract board** asked for things it had not checked the tower
  could do and paid for fifteen-minute runs that last three; both fixed,
  with readings, in [contracts.md](contracts.md).
- **Final Form's chase** (07 §3.4) was measured and does nothing
  ([final-form.md](final-form.md)); hands-off reach is bounded by recipe
  discovery, which is Act 1 pacing's to change, not this plan's.
- **Open, the owner's:** I1b (the Blight at ~4.2 h); the three tests that
  fail on every commit since Tempering (`arsenal`'s frontier evolutions, the
  CI I6 and P3 medians). The full Act 2 reading with the board was taken on
  2026-11-16: Starlight per hour 1.23× with a third of runs on cards, inside
  the bar ([contracts.md](contracts.md)).
- **Thin content, by plan:** the cursed chase holds one relic (03's phase 3
  can follow the Inversion now), anomalies four of twelve, secrets Act 1's
  eight, strata two of five.

### R4: the suite green, 2026-11-18

Test and tool changes only: no number in `content/` moved. Three tests
had failed on every commit since Tempering (`plans/review-risks.md`, R4).
Read on `d0cc774`.

**The arsenal fixture.** I4 and the keystone sweep played a synthetic
tower: every node up to the next ring at half its levels, with no
tempering and no Twin Mount. Since Q1 raised Regions 4–6's HP, and
tempering became what carries a player through them, that tower died at
waves 5–12 after 1–3 min there. Its passives stopped at levels 1–4, so no
evolution's partner was ever ready: 0 evolutions in 72 runs.

The fixture is now the pacing bot's own profile (`tools/frontier.ts`),
stored at each Act 1 boss's first fall, the Forge shopped, for pacing
seeds 1–3 (18 profiles, 95 KB, ~30 s to regenerate with `npm run pacing
-- --frontiers`). A region's runs take its two ends in turn:

| | Regions 1–3 | Regions 4–6 |
|---|---|---|
| arrival: the profile the bot first enters with | waves 5–20 | waves 7–13, 90–190 s |
| cleared: the profile its boss first fell to | waves 9–22 (Regions 2–3) | waves 14–22, 150–430 s |

Arrival alone isn't enough. Its towers die as fast as the synthetic
one's: a player spends about an hour creeping through each late region.
Two more changes to what I4 counts:
- **Twin Mount's pick is tallied apart.** Its first draft is sure to
  offer the region's answer to its opening (`twinSpares`), and the bot
  takes it: Scattershot in all 16 of Region 4's runs, Sentinel Drones in
  all 16 of Region 5's. That is authored, not the bot's choice among
  equals. Counted as a pick, it read 50% (I4 FAIL).
- **One more weapon slot with Twin Mount** (four, not three), so each
  run still makes two picks of the bot's own, as the old fixture meant.
  Without it Regions 4–5 gave 12 picks on 12 seeds, and one seed's
  choice moved a share by 8 points (42% at 12 seeds, 33% at 40).

`npm run arsenal` (16 seeds), before and after:

| | Synthetic tower | Frontier profiles |
|---|---|---|
| I4 | PASS (Mortar 31%, Region 2) | **PASS** (Frost Ring 34%, Region 4; 28% at 40 seeds) |
| evolutions, Regions 3 / 4 / 5 / 6 | 0 / 0 / 0 / 0 | 0 / 3 / 6 / 8 |
| Twin Mount's picks, not counted | — | R2 Mortar 3, Chain 2 · R3 Mortar 10, Drones 4 · R4 Scattershot 16 · R5 Drones 16 · R6 Chain 3, Mortar 3 |

Region 3 evolves nothing: none of its six profiles knows a recipe, and
most don't own Alchemy yet. From Region 4's clearing on, the profiles own
Alchemy and know Arcane Bolt's recipe, and the bot steers for it.

`npm run arsenal -- --keystones` (8 seeds), on the same profiles:
**FAIL**, Fortress a trap. It gains nowhere and costs in Regions 4–6
(×0.79–0.88 shards, one to two waves fewer). Before, it scraped a PASS
on Region 3's boss times against a bought-out ring. Specialist gains in
Regions 4–6 (×1.69–3.19 shards, the only boss kills in Region 4) and
costs in Region 3, Glass Cannon gains in 5–6, Hoarder trades everywhere. Fortress is the owner's to
retune: this change moves no number.

**The CI pacing gates** (`tests/pacing.test.ts`):
- The file now plays the eight profiles the gates read, not three. A
  one-hour profile takes ~4 s. P3's CI median is now the gate's own
  reading: **27:51 PASS** (was 31:25 on seeds 1–3, failing; seeds 1–8:
  34:31 24:56 31:24 26:45 27:19 27:32 28:00 27:51). Region 1 is untouched.
  The lever noted in the review (`hpGrowth` 1.18 → 1.175) moves I6, so
  it stays.
- **I6 in CI gates the median profile's worst gap, not every profile's.**
  Worst gaps on seeds 1–8 are 8:00 10:48 6:24 10:09 5:55 5:43 6:41 6:24,
  median **6:41 PASS**, and 6/8 seeds pass the every-seed rule. At about
  one reveal per 8–10 min (Q1, Tempering), a seed passes or fails by
  seconds, and only new content fixes that (R2). The full report still
  prints the every-seed count. Restore the every-seed test once 8/8
  pass.
- I3 and I1a now hold on all eight profiles (8/8 each). The check that
  the first run lasts 90–180 s stays on seeds 1–3: **seed 6's first run
  ends at wave 8 after 79.5 s**, open for the tutorial's pacing.

`npm test`: 844 passed, 0 failed (67 s on an idle machine).
`npm run typecheck`: clean.

## R2: reveals in the plateaus (2026-11-19)

`plans/review-risks.md` R2. Read on 8 seeds × 6 h, no `--fast`, with R1
in. The first two hours' gaps were Region 2's and Region 4's plateaus,
not Region 3 (now 8–18 min long). Each region from the Mire on holds one
rift back for its middle run (`docs/rifts.md`, held beats). A Trial's win
and an overtime trophy are told in the run. I6's later clause reads from
2 h to the Blight's first fall.

| | before | after |
|---|---|---|
| I6, first 2 h | 6/8 (worst 12:37, 10:12) | **8/8** (6:07–8:20) |
| I6, 2 h → Blight | 8/8 (to 6 h: 7:32–24:02) | **8/8** (7:02–13:24) |
| I5, 4 seeds | — | 1.15–1.47, every gated checkpoint |

CI's I6 gates every profile again. The idle report was not re-read.


## R8: Night Watch 0 (2026-11-19)

`plans/review-risks.md` R8 §1: offline pays 10% for 1 h before any Night
Watch (`BALANCE.offline.base`). `npm run pacing -- --idle --hours 12
--seeds 4`, before → after (this reading is also R2's missing idle
re-read):

| | before | after |
|---|---|---|
| I2 | 6.5 d (6.5 5.5 7.0 6.0) PASS | 6.0 d (5.0 5.5 6.0 6.0) PASS |
| I7 | 0.52 PASS | 0.55 PASS |
| I8 | 5.5–7.0 d, median 6.5 | 5.0–6.0 d, median 6.0 (the target's floor) |
| I5 | 1.19–1.47 at every gated checkpoint | unchanged |

The Gatekeeper falls one check-in sooner on seeds 1 and 3, and seed 1's
Act 1 lands on I8's 5.0 d floor. Final Form's hands-off reach is 0% in R5
in both readings.

## Mastery capstones (2026-11-21)

`plans/mastery-capstones.md`. Might, Bulwark, Arsenal and Engineering
Mastery are three-rank capstones (1.5M / 15M / 150M). Fortune is endless
and additive (shards +3% a level).

`npm run pacing -- --act2 --hours 12 --seeds 4`, before → after:

| | before | after |
|---|---|---|
| heat 10 at the frontier | 112:40 FAIL | **84:09** FAIL (want 3–12 h) |
| best Abyss floor at 12 h | 17 (17 17 14 16) PASS | **13** (13 13 13 12) PASS |
| The Undertow first falls | 189:27 | 297:39 |
| Starlight per hour | 56.6 | 55.5 |
| the Abyss's share of Starlight | 14% | 13% |
| growth at 12 h | 230–285 mastery levels | capstones 12/12 by hour 6, Fortune 37–40, tempered 398–422 |

Heat 10 was already failing (74–93 h in the readings above). The capstones
bring it nearer: Overlevels, the bank and the echo help at the frontier's
bosses. **The Abyss is the regression.** Before, the bot kept stacking
×1.03 damage, HP and attack speed, which compounds without end and carried
floors 14 → 17 between hours 6 and 10. After, the capstones are full by
hour 6, and Fortune plus tempering don't carry the Abyss past floor 13.
Floor 13 is past the built strata, and the gate still passes (≥ 10), but it
is short of the plan's "no worse than today". This is open for the owner:
the levers are the tempering price (`BALANCE.forge.temper`), or a
cheaper Fortune curve so more shards reach tempering.

`npm run arsenal` (16 seeds), without → with all 12 capstone ranks:
I4 PASS both (worst Frost Ring 34%, Region 4). Evolutions in Regions 4 /
5 / 6 go from 3 / 6 / 8 to 4 / 8 / 13 (Arsenal rank 3's passive at level 3).
No Overlevel was taken in 600 s runs, because the hand never runs dry that early.
Without capstones the readings match R4's exactly, so the rank-0 path is
unchanged.

`npm run arsenal -- --keystones` (8 seeds): FAIL both, as in R4 (Fortress
a trap). With capstones, Glass Cannon gains in four regions (two before),
Fortress costs in two regions (three before), and Region 5's bare tower is
much stronger (wave 16 → 22, shards 41k → 96k).

`npm test`, `npm run typecheck`: green. `tests/capstones.test.ts` covers
each rank, rank 0, the feats, and a snapshot round-trip with a bank, a
shield and a charge bank held.

## The Wake: first tuning (2026-11-25)

The Wake (plans/late-game/12 §14), first pass. The Act 2 bot is too slow to
read here: `--act2 --reuse --seeds 4 --hours 1.5` did not finish in 15 min,
and neither did a single `--fast` seed over 1 h. So the boss fights were read
with the Act 1 fixture's towers at the Blight's fall (the Carillon's arrival
tower; for the later bosses, a lower bound), three profiles × two runs per
region, with a scratch probe: wave-20 boss HP ÷ `buildDps` at arrival. The
`inspect --forge all` tower is no reference: it dies at wave 13–17 in the
Blight Heart itself.

Before: the Blight-fall tower felled the Carillon 5/6, the Astrolabe 6/6,
the Colossus 6/6, the Thunderhead 6/6 and the Leviathan 1/6. Boss HP ÷ DPS
medians were 18 / 15 / 20 / 28 / 19, and the Bell Marches and Orrery dealt
0 damage before wave 20. That matches the single `--act2` seed that cleared
the Wake 23–53 min after the Blight.

Changes: the Bell Marches and Orrery `hpBase` 2400 → 2600 (D-6's top). Boss
`hp`: Carillon 60 → 90, Astrolabe 55 → 100, Leviathan 58 → 75, Thunderhead
65 → 100; the Colossus stays at 62. `BALANCE.omen.stars` for regions 9–13:
the Sky's stat stars plus Undimmed. `shardBase` and the rule numbers are
unchanged.

| Reading | Command | Target | Result |
|---|---|---|---|
| Boss HP ÷ expected DPS | probe, Blight-fall towers | 25–35 s | Carillon 29, Astrolabe 29, Leviathan 26, Colossus 28, Thunderhead 30 (medians) |
| Blight-fall tower fells | same | Carillon reachable within 1 h | Carillon 1/6, Astrolabe 6/6, Leviathan 0/6, Thunderhead 5/6 |
| Carillon / Thunderhead after the Blight | `npm run pacing -- --act2 --hours 16 --seeds 4` | ≤ 1 h / 6–10 h | not read (cost). Before tuning, one seed: 0:23 / 0:53. Off: D-6's flat HP can't stretch the Wake to 6 h |
| Hands-off idle | `--idle --wake` | Thunderhead ≤ 4 days | no such tool yet |
| The Omen, Wake days | `npm run omen -- --days 28 --from 20788` | median fall wave 26–34 | Wake days median ~20 (15–29), before 11–20; OFF. Ring 7 + stars is too weak for wave-20 Wake bosses on 6–8 point days |
| Arsenal `--wake` | needs `tools/fixtures/wake-frontiers.json` | ≥ 10 pt shift | not read |
| Act 1 | `npm test`, `npm run typecheck` | unchanged | green (1198); Wake-only data |

Next: generate the Wake fixture (`--act2 --wake-frontiers`, hours of CPU)
and re-read the bosses at their own arrival towers. The 6–10 h pace needs a
decision: lift D-6's flat HP (a Wake staircase), or move the target.

## The Wake: second tuning (2026-11-26)

`plans/late-game/12a-wake-tuning.md`, steps W1–W11 (branch `wake-tuning`).
The owner settled O-1…O-5 on 2026-11-25; plan 12 §0.2 now holds D-26…D-31.
O-6 (the Abyss's run length) is still open.

**What changed.**

- **D-26, overtime has an end:** +20 waves (wave 40) or 600 sim s past the
  boss, then the run ends won, in every region, normal play included. It
  moved Act 1 (below). `OMEN_SIM` 1 → 2.
- **Rage past Rampart** (a D-26 follow-up). High-HP runs stalled at the
  boss for 25–60 sim minutes: Rampart capped each hit at Max HP ×
  `rampartCap` (689) *after* the enrage had grown it (×1e8 by +930 s), and
  regen (1034/s) out-healed the cap. Now `hurtTower` caps first, then
  multiplies by `hordeFury` and `bossRage` (the boss's current damage over
  its base hit). The owner's pick: global, with no time limit.
- **Per-boss enrage.** The rage fix took the fixture towers' overtime wins
  away: their fights ran 110–170 s against a 90 s enrage. So
  `BossDef.enrageAfter` (optional; `BALANCE.boss.enrageAfter`, 90 s, when
  absent) is set on the Wake bosses only: Carillon 150 s, Astrolabe 165,
  Leviathan 105, Colossus 90, Thunderhead 105.
- **D-27, the boss threat budget.** Carillon peal damage 1.0 → 0.5 (both
  phases). Astrolabe slam in phases 2–3: damage 1.0, every 7 / 6 s.
  Leviathan `hp` 75 → 65. Colossus `hp` 78. **The Colossus slams:** it had no
  attack, and the fixture towers felled it 11/12 at Giants `hp` 3.5, which
  HP alone can't fix. It now slams every 6 / 5 / 4 s by phase (wind-up 1.3 /
  1.2 / 1.1 s, speed 420 / 440 / 480), damage 5. Slam damage against fells
  of 12: 2 → 11, 3 → 10, 4 → 9, 5 → 7.
- **D-28 (corrected), Floes.** Only Floes the Leviathan cracks
  (`crackFloes`) are untargetable, and they melt after 20 s
  (`wake.floes.melt`) or when the boss falls (`Enemy.meltAt`;
  `SNAPSHOT_VERSION` 23 → 24). An impact (`glideImpacts`, source `impact`)
  still damages and shatters a cracked Floe. The Frozen Sea's wave Floes
  are unchanged: targetable, no melt. The memo had assumed impacts bypass
  `targetable` and that only the Leviathan makes Floes.
- **D-29 and the rules.** Orbit keeps its pace (`wake.orbit.pace` 1).
  `wake.toll.minInterval` 2.5. Giants `hp` 3.5. Storm `damage` 0.08,
  `wall` 4 → 5. Conductor `hp` 2.4 → 3.
- **D-30, the staircase.** `hpBase` for regions 9–13: 2600 / 32900 /
  50000 / 107000 / 200000. `shardBase`: 66 / 150 / 200 / 300 / 400, a
  smooth ladder (the owner's pick over a fit to the fixture towers). The
  memo's first guess (×1.8 a region) put the Thunderhead at 0.3 h. Near
  region 13 the response is a cliff: `hpBase` 200000 gives 2.1 h, 240000
  gives 3.2 h.
- **D-31, the Omen's might.** `BALANCE.omen.might`: 9: 1.85, 10: 20.4,
  11: 30.9, 12: 87.5, 13: 163.9. Read over the Wake's 25 Omen days (the
  owner's pick).
- **`QUARRY`** for 9–13: ringer 235 / straggler 145; satellite 285 / comet
  145; skater 415 / sledge 12; titan 120 / tick 70; groundling 310 /
  conductor 30.

**The readings** (plan 12 §14 as revised; ✓ met, ✗ missed):

| Reading | Command | Target | Result | |
|---|---|---|---|---|
| Pace | `npm run pacing -- --act2 --reuse --stop-at thunderhead --hours 6 --seeds 4` | Carillon ≤ 0.5 h, Thunderhead 2–4 h after the Blight; each step 25–50 min | medians: Carillon 0.1 h, Astrolabe 0.6, Leviathan 1.1, Colossus 1.6, Thunderhead 2.1 h; each step +30 min; 0 runs cut off | ✓ |
| Run length | the same, and the Act 1 sweep | no run cut off; no region run over ~20 sim min | none cut off; longest Wake run 25.9 min; longest Act 1 sweep run 27.4 min | ✗ (accepted) |
| Idle, the Wake (D-23, a gate) | `npm run pacing -- --idle --wake --seeds 4` | Thunderhead ≤ 4 days after the Blight | PASS, 3.0 d (2.5 2.5 3.0 3.0). Carillon 0.0, Astrolabe 0.5, Leviathan 1.0, Colossus 1.5 d; stars lit 0 | ✓ |
| Idle, Act 1 | `npm run pacing -- --idle --hours 12 --seeds 4 --fast` | I2, I7, I8, I5 | I2 5.5 d, I7 0.57, I8 5.5 d (all PASS); I5 Prism 1.15 (at the edge) | ✓ |
| Arsenal | `npm run arsenal -- --wake` | I4's 40% cap per region; each region moves a weapon ≥ 10 points against the Blight Heart | I4 PASS, worst Sentinel Drones 32% (R11). R9 +17 Chain Lightning, R10 +21 Frost Ring, R11 +14 Frost Ring, R12 +19 Frost Ring, R13 −24 Mortar | ✓ |
| Bosses (fells of 12, pre-staircase HP) | `npm run inspect -- --seeds 12 --frontier --fixture act1 --stop-boss` (each `--region`) | Carillon ≥ 9, Astrolabe 7–9, Leviathan 5–8, Colossus 4–7, Thunderhead 2–5 | 10 / 7 / 5 / 4 / 4 | ✓ |
| Conductor | the same, Stormcrown | median life < 8 s | 4.2 s (act1 fixture); 14.1 s on Stormcrown's arrival towers | ✓ |
| Arrival | `npm run inspect -- --seeds 12 --frontier --arrival --stop-boss` (each `--region`) | boss HP ÷ DPS 25–35 s (now a reading) | 40 / 139 / 25 / 30 / 43 s; fells 8 / 0 / 4 / 0 / 0 of 12 | ✗ (conflicts with pace) |
| Farm rate | scratch probe, each fixture save, heat 0 | ×1.0–1.3 a step | Blight Heart 8.06M/h; R9 30.8M (×3.82), R10 25.4M (×0.83), R11 72.2M (×2.84), R12 28.3M (×0.39), R13 58.5M (×2.07) | ✗ (accepted) |
| The Omen, Wake days | `npm run omen -- --days 55 --from 20790` | median 26–34, band III ≤ 25%, earliest ≥ 15, active − hands-off ≥ 2 | median 27, band III 20%, earliest 16, active − hands-off 0. Bell 27, Orrery 28, Frozen Sea 29, Giants 26, Stormcrown 22 | ✗ (one of four; accepted) |
| Contracts | `npm run pacing -- --act2 --reuse --hours 4 --seeds 2 --contracts 0.33` | the contract bot's targets | PASS 3.87/h; T1 6/8, T2 8/8, T3 7/7, T4 4/4 | ✓ |
| Act 2 (P8, plan 08) | `npm run pacing -- --act2 --reuse --hours 12 --seeds 4 --fast` | plan 08's readings | unread: timed out at 900 s and again at 2700 s | — |
| Frame budget | `npm test -- perf` | Glide at 300 bodies, the Bell's swarm, a Champion Titan | 5/5 pass (the Glide, Bell and Titan cases included). In a full `npm test` under heavy machine load the 300-body case failed earlier; alone it always passes | ✓ |
| Act 1, full (W12) | `npm run pacing -- --hours 6 --seeds 8` (87 s wall) | P3, P4, I1a, I1b, I3, I6 | P3 first wave 20 27:51 PASS, P4 Gatekeeper 32:09 PASS, I1a 8/8, I1b Blight 263:52 (PASS 8/8), I3 8/8, I6 8/8 (first 2 h, median worst gap 6:57) and 8/8 (2 h → Blight); first evolution 84:49 86:22 84:00 89:17 88:34 82:37 94:32 90:39 (median 87:28) | ✓ |
| Act 1, `--fast` (W1–W11) | `npm run pacing -- --hours 6 --seeds 8 --fast` | I1a, I1b, I3, I6 as at W0 | first wave 20 27:59, I1a 8/8, I1b 255:15 (8/8), I3 8/8, I6 7/8 + 8/8, first evolution 87:52. W0: I1b 264:23, the rest the same | ✓ (I1b moved, accepted) |

**Act 1 moved.** The memo (§2) said a cap at wave 40 leaves Act 1 as it
is. That was read on seed 1 only, the one seed that didn't move: on 7 of
8 seeds pre-Blight runs reach wave 40. W1 moved I1b's median Blight from
264:23 to 254:56 (still PASS 8/8). The owner accepted it, and the post-W1
readings became the baseline. The rage fix moved it again, to 255:15.
Nothing else in Act 1 moved.

**Idle was not read for W1–W4.** W0's idle baseline never finished (over
45 min before W1, 3 min after). From W5 on, the idle check ran at every
step. I2, I7 and I8 never moved, except I7 0.56 → 0.57 at the rage fix.

**The misses the owner accepted:**

- *Arrival vs pace.* For 25–50 min of farming between bosses, each boss
  must be out of reach when its region opens. So the arrival towers read
  40–139 s of boss HP ÷ DPS, not 25–35. The owner chose pace; §14's
  arrival row is now a reading, not a target.
- *Farm-rate steps* (×0.39 to ×3.82). The rate follows how each fixture
  tower farms its own region, not `shardBase` alone.
- *The Omen's active − hands-off is 0* on every Wake day: `might` scales
  both bots alike. *Stormcrown* barely responds to damage (+52% moved its
  median 16 → 22). Over all 55 days, band III is 35% and the earliest
  fall wave 8: those are the frozen Act 1 days, as at W0 (33%, 8).
- *The 25.9-min run:* pre-boss waves at high HP plus a full overtime. It
  is within "~20" (no stall).

**The arsenal's shifts come from the enemies, not the rules.** Every
new-weapon pick is a banked draft at wave 0, before anything spawns. With
the rules removed, the picks were identical. So each region's shift comes
from its enemy list.

**Still open.** Plan 08's 12 h reading is unread: it timed out at 900 s
and again at 2700 s. The likely cause is O-6: the longest Abyss run was
32.7 min (act2 1 h, at W1) and 32.1 min after the rage fix (so it isn't a
Rampart stall), and one run per seed hit the tool's 60-min cap in the 4 h
contract-bot reading. Abyss runs are uncapped; that is the owner's to
decide. The Act 1 idle reading above used `--fast`; Act 1 itself was also read
without it at W12 (the "full" row). W12's closing checks: `npm run
typecheck` clean; `npm test` 59 files, 1222 tests, all pass.

## One weapon at a time (2026-11-26)

plans/forge-weapon-pacing.md steps 1–5: a weapon fresh from the Forge seals
the other weapon nodes until it is carried in 3 runs (or 5 runs pass), is a
card on top of every hand while a slot is free, the scorer leans toward it
(`DEBUT_VALUE` 0.25, beside `COUNTER_VALUE` and `SLOT_VALUE`), and the
Forge card says what each weapon does. No price moved. 8 profiles, 2 h:

| | Before | After |
|---|---|---|
| W1, bot | 0/8 (least gaps 0:00–3:41; Sunlance and Glaives in one visit) | **8/8** (6:55–9:16) |
| W1, `--weapons-first` | 0/8 (every profile 0:00) | **8/8** (5:37–7:17) |
| I6, first 2 h, bot | 8/8 (6:07–8:20) | 7/8 (5:12–7:58; seed 4 10:05 past the first hour) |
| I6, first 2 h, `--weapons-first` | 5/8 | 7/8 |
| CI (`tests/pacing.test.ts`, every profile's first hour) | pass | **pass** |
| P3 median | 27:51 | 28:22 |
| Gatekeeper / Bog Mother / Prism, bot | 25:41–35:05 / 65:40–75:06 / 74:51–86:14 | 27:23–34:06 / 63:34–81:04 / 76:28–98:37 (seed 4's slow Bog Mother) |
| first evolution, median | 88:34 | 100:09 (§7.1 aims at 90–120) |
| I5, 4 seeds, Region 2 / Bog Mother / Prism / Forgeheart | — | 1.35 / 1.26 / 1.23 / 1.24 (all PASS); I2, I7, I8 PASS |

Rejected on the way, measured:
- The suggestion forced onto the fresh weapon: the Prism at ~100 min,
  because auto-pick took Sunlance over Twin Mount's Mortar in Region 3.
- The fresh card taking a hand slot instead of adding one: I5 1.13 at the
  Bog Mother (CI profile).
- 2 runs instead of 3: W1 0/8 for `--weapons-first`.
- A 4-run or 8-run escape: no better, and at 8 Frost Ring held Mortar back
  20 min.
- Twin Mount drawing the fresh weapon: no change.
- `DEBUT_VALUE` 0.15: CI's seed 1 at 10:11 (the bot took Scattershot over
  the fresh Mortar in Mortar's first run). 0.35 and up: I5 1.12 at the Bog
  Mother. 0.25 and 0.3 read the same on 8 profiles; 0.25 sits mid-window.

## Weapons past the Prism (2026-11-26)

plans/forge-weapon-pacing.md step 6 ("D-rev"): Sentinel Drones became the
Prism's prize (ring 4, 6000, off Lingering) and Glaives Forgeheart's (ring 5,
36000, off Drones). Sunlance stays in Region 2. Before, the last Act 1 weapon
came at ~90 min and nothing new for the 2.7–3.2 h to the Blight. 8 profiles,
6 h, `npm run pacing -- --hours 6 --seeds 8` (and `--weapons-first`):

| | Before (steps 1–5) | After |
|---|---|---|
| W1, bot / weapons-first | 8/8 / 8/8 | **8/8 / 8/8** (least gap 6:55 / 6:42) |
| I6 first 2 h, bot / weapons-first | 7/8 / 7/8 | **8/8 / 8/8** (worst 7:33 / 8:30) |
| I6 2 h → Blight | — | 8/8 / 8/8 |
| Drones, bot / weapons-first | 87–92 / 71–92 min | 101–117 / at the Prism's fall (76–100) |
| Glaives, bot / weapons-first | 78–84 / 47–64 min | 158–174 / at Forgeheart's fall (139–166) |
| Prism median, weapons-first | 96:05 | **89:35** (worst 99:12; seeds 9–16, read on a copy: 82–95 min) |
| Blight median, bot / weapons-first | 256:38 / 278:27 | 268:52 / 274:09 (I1b 8/8 both) |
| First evolution median, bot / weapons-first | 100:09 / 105:09 | 96:07 / 104:40 |
| I4 (`npm run arsenal`, fresh frontiers) | PASS, Sunlance 37% R3 | PASS, Sunlance 37% R3 |

Unchanged: I1a 6/8 for weapons-first (seeds 2 and 7 reach the Gatekeeper
at 46:32 and 45:41: that bot spends on weapons first), P3 FAIL for
weapons-first (wave 20 at 32:42, the same times as before), and R1 FAIL.
I4 can't see this change: `tools/arsenal.ts` puts every Act 1 weapon in
the pool, whatever the Forge owns.

Rejected on the way, measured on copies:
- The plan's first D (Sunlance to the Bog Mother at 2500, Drones 12000,
  Glaives 100000): Region 2 had nothing to forge after Mortar (bot seed 1,
  I6 11:23 from 49:37); the bot bought Sunlance after the Prism, Drones near
  Forgeheart and Glaives after the Hollow King; first evolution 87:07.
- Glaives alone to Forgeheart (100000 or 36000): weapons-first Prism tail,
  5 of 16 seeds past 110 min (worst 152:07).
