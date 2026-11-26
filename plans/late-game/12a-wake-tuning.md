# 12a. The Wake: the four open tuning questions (decision memo and work plan)

**Outcome (2026-11-26):** W1–W12 are done on branch `wake-tuning`. The
readings, the owner's changes made along the way (D-28 corrected, the
Colossus slam, rage past Rampart, per-boss `enrageAfter`, the final
`hpBase`, `shardBase`, `might` and `QUARRY` numbers) and the misses the
owner accepted are in `docs/balancing.md`, "The Wake: second tuning". Several
numbers this memo proposes were changed there; that section is the source
of truth, not this memo. D-26…D-31 are in plan 12 §0.2.

**Status:** 2026-11-25. Decided, not built: nothing in `src/` or `tools/`
has changed yet. It answers the four questions left open by plan 12's first
tuning pass (`docs/balancing.md`, "The Wake: first tuning") and ends with an
ordered work plan (§7) that a less capable agent can carry out step by step.
**The owner settled O-1…O-5 on 2026-11-25 (§6)**: the Wake's target is 2–4
h (C); overtime is capped at 20 waves in every region, for normal play too;
the Omen gets a tower `mult`; Orbit keeps its pace; Floes are terrain.
O-6 (the Abyss's run length) is still open and is not part of this work.
Calls marked **(proposed)** are details I chose while writing the plan; the
owner can overturn them.

Read with: `plans/late-game/12-the-wake.md` (§0 decisions, §4 rules, §13
risks, §14 targets), `docs/balancing.md`, `docs/act2.md`, `AGENTS.md`.

---

## 0. Summary

| # | Question | Finding | Recommendation | Owner? |
|---|---|---|---|---|
| Q4 | Why is the Act 2 bot slow? | **Runs in the Wake never end.** With a post-Blight tower, overtime in Giants' Rest and Stormcrown runs to the tool's 3600 s cap (wave 107–200). One Stormcrown run took **740 s of CPU**. Cause: the overtime stall (the "horde enrages" rule) never fires under Giants (the field never fills), and where it does fire, Rampart's 8%-of-Max-HP cap is applied *after* the fury, so the fury can't land. Against 15%/s regen the tower can't fall. These runs also pay overtime shards at 1.12^wave (an economy hole: seed 1 had 2095 tempered levels after 1 h). | **Cap overtime at 20 waves in every region (wave 40), and at 10 sim minutes, after which the run ends won** (W1). Then `--stop-at <boss>` (W2), a frontier mode for `inspect` (W3), and the Wake fixture (W4). | Settled (O-2) |
| Q3 | Why does difficulty follow the bosses, not the chain? | **Boss attack patterns decide every Wake fight; the rules barely do.** Every Blight-fall tower reaches wave 20 in all five regions, so all the deaths happen at the boss. The Carillon's peal fires on every toll (as often as every 0.72 s) and causes 72–81% of the damage the tower takes. The Astrolabe and the Colossus have no attack at all (100% of damage taken is contact). The Leviathan's Floes soak shots from the `nearest` weapons. | Give each boss a threat budget first (W5). Then make three rule changes so each rule has teeth: Orbit keeps its pace, Storm hits the wall harder, Giants are tougher (W6). | Settled (O-4, O-5: yes) |
| Q1 | Pace: the target is 6–10 h; seeds take minutes | 4 seeds: Carillon ~6 min, Astrolabe ~10, Leviathan ~15, Colossus ~17, Thunderhead ~20–40 min. Every boss falls on the first or second try. The tower lights 0 → 18 stars in 15 min (the 125 Starlight of lumps plus Act 2 feats buy the cheap stars). D-6's flat HP can't hold that tower. | **Revise the target to the Thunderhead in 2–4 h (Carillon ≤ 30 min)** and stair-step `hpBase` (first guess ×1.8 a region, tuned with the fixed bot). A 6–10 h Wake would push every Abyss target past its own window and is hard to square with D-23's 4 idle days. | Settled (O-1: C) |
| Q2 | Omen Wake days end at wave ~20 | Banes barely matter: at 0–2 points the median wave is still 23. Wave-20 bosses kill the ring-7 tower. A ×0.6 HP scale (or ×1.7 tower damage) reaches median 26. At ×2 damage the median is 29, but band III days reach 40% because the regions spread (Orrery and Giants days run to wave 45; Bell, Sea and Storm days die at 20). | **Do Q3 first, then give Wake days a per-region tower multiplier in `omenConfig`** (`BALANCE.omen.might[region]`; no sim change). It also cancels Q1's staircase on Omen days. | Settled (O-3: `mult`) |

New plan decisions (the owner accepted them on 2026-11-25; W12 adds them to
plan 12 §0): **D-26** overtime ends at +20 waves or 10 minutes, **D-27** boss threat budget, **D-28**
Floes are terrain, **D-29** Orbit keeps its inward pace, **D-30** the Wake
staircase (replaces D-6's "flat"), **D-31** the Omen's Wake might. Changed:
**D-6** (flat → staircase), **§14** Thunderhead target (6–10 h → 2–4 h),
**D-23** unchanged but now measurable (W9).

---

## 1. What I measured (2026-11-25, commit 1e4e343)

Every reading below came from scratch tools in this session's scratchpad.
They play the real sim headless, one heavy job at a time. The scratch files
may be gone by the time you read this. W3 turns the useful one into a real
tool, and the loop each one ran is described where its result is used.

### 1.1 The Act 2 bot, run by run (seed 1, saved start `node_modules/.tmp/act2-starts/seed-1.json`)

A copy of `tools/act2.ts#runAct2` that logs each run's region, sim seconds,
wave, CPU time and Wake fall:

| Run | Region | Sim s | Wave | Outcome | CPU | Wake fall | Stars after |
|---|---|---|---|---|---|---|---|
| 1 | 9 | 370 | 20 | fell | 0.45 s | — | 0 |
| 2 | 9 | 518 | 31 | fell | 0.8 s | Carillon (boss 80 s) | 2 |
| 3 | 10 | 566 | 40 | fell | 3.0 s | Astrolabe (38 s) | 7 |
| 4 | 11 | 675 | 53 | fell | 2.5 s | Leviathan (12 s) | 11 |
| 5 | 12 | **3600 (cap)** | **200** | **none** | 29 s | Colossus (9 s) | 18 |
| 6 | 13 | **3600 (cap)** | **107** | **none** | **740 s** | Thunderhead (58 s) | 20 |

Seeds 2–4, stopped at the Colossus's fall, fell each boss in the same runs
as seed 1. Each boss's run started at (wall clock after the Blight):
Carillon (2nd run) 2:38–2:46, Astrolabe 6:13–6:47, Leviathan 9:34–11:33,
Colossus 13:43–16:31. Seed 1's falls, for scale: 6.4, 10.5, 15.5 and 36.6
min (that last one is inflated by the run that hit the cap). Seed 3's
Colossus run also hit the cap (wave 200), and seed 4's reached wave 125.

**Reading:** the Wake costs the active bot about 20–40 minutes, against the
6–10 h target. The CPU goes on runs that hit `tools/play.ts:98`
`MAX_RUN_SECONDS = 3600` and never end, not on the Abyss.

### 1.2 Why those runs never end (trace of seed 1's post-Leviathan tower in Giants' Rest)

Every 15 overtime waves: Max HP 55,517, regen 8,327/s (15% a second),
Rampart owned, 36–81 bodies alive (never near 300), 2–6 in contact, the
tower takes ~1,000/s, and `stalled` is never true. By wave 90 the bodies
have 1.25^70 times their wave-20 HP, so the tower can't kill them either.
Neither side can win, so the run goes on until the cap.

- `src/sim/systems/waves.ts:602`: the stall only starts while spawns are
  *held* by a full field (`run.enemies.length >= BALANCE.maxEnemies`).
  Giants halves the count and Titans swallow bodies, so the field never
  fills.
- `src/sim/systems/tower.ts:31,36`: the fury (`hordeFury`) multiplies the
  raw hit, and Rampart then caps the result at `maxHp × 0.08`. Even a
  stalled horde can't break a Rampart tower with high regen. That is what
  happened in Stormcrown (full field, wave 107).

### 1.3 The Wake from the Blight-fall towers (`tools/fixtures/frontiers.json`, boss `blight`, 3 profiles × 2–3 runs)

The scratch probe: for each profile, open the Wake chain up to the region
(set each earlier Wake boss's `kills` to 1; without it `selectedRegion`
silently falls back to Region 1), clear pacts, play the `active` bot at
`SIM_DT`, and stop when the boss falls, the tower falls or wave 21 begins.
It records the fall, the boss's seconds, boss HP ÷ `buildDps` at arrival,
`damageBy` and `takenBy` shares, Conductor lifetimes from entering range,
and `killsBy`.

| Region | Fells | Real boss fight | HP ÷ DPS | What hurt the tower | Notes |
|---|---|---|---|---|---|
| 9 Carillon | **0/6** | — | 25 s | slams (peal) 72–81% | Toll window 0.6 s, the peal on every toll, quicken to 0.72 s |
| 10 Astrolabe | 6/6 | 120–305 s | 33 s | contact 100% | No attack pattern |
| 11 Leviathan | **1/6** (2/9 over 9) | 160 s | 23 s | slams 48–63%, contact | Boss at 99–100% HP for ~75 s while Floes pile up (trace) |
| 12 Colossus | 6/6 | 96–144 s | 20 s | contact 100% | No attack pattern |
| 13 Thunderhead | 5/6 | 113–231 s | 32 s | storm 66–88% | Conductors die 1.9–6.3 s after entering range (target < 8 s ✓) |

Arcane Bolt deals 53–84% of the damage in every region. Impacts (`rule`)
deal 7–20% in the Frozen Sea and ≤ 5% elsewhere.

Patch tests (runtime patches in the probe, nothing committed):

| Patch | Result |
|---|---|
| Carillon peal `damage` 2.5 → 1 (both phases) and `BALANCE.wake.toll.minInterval` 1.2 → 2.5 | Carillon 0/6 → **5/6** |
| Astrolabe: slam in phases 2–3 (`every` 6/5, `damage` 3) | Astrolabe 6/6 → **1/6** (too strong: use a milder slam) |
| Colossus: slams in all phases (`damage` 3.5) | 6/6 → 6/6 (it falls before they matter: raise its HP instead) |
| Leviathan: no Floes (`count` 0 in both `floes` patterns) | 2/9 → **4/9** |
| Leviathan: Floe `hp` 3 → 0.3 | 2/9 → 3/9 |
| Leviathan: slams 3.5 → 2.5, dives 4 → 2.5 s | 2/9 → 2/9 |
| Leviathan: no Floes + slams 2.5, or + 1 Skater pack | 4/9 (no further gain) |
| Glide `carry` 3 → 1.5 | 2/9 → 2/9 (the slide isn't the wall) |

### 1.4 The Omen's Wake days (days 20790–20844, five blocks of eleven, 25 Wake days; the active bot only)

| Lever | Median wave | Boss felled | Earliest | Notes |
|---|---|---|---|---|
| Today (ring 7 + `WAKE_OMEN_STARS`) | 24 (20 on the first 15 days) | 13/25 | 15 | |
| `points` [3, 5] (15 days) | 23 | 8/15 | 16 | |
| `points` [0, 2] (15 days) | 23 | 9/15 | 18 | Banes aren't the problem |
| Wake `hpBase` × 0.6 (15 days) | 26 | 12/15 | 18 | |
| Wake boss `hp` × 0.6 (15 days) | 22 | 8/15 | 15 | Not only the boss |
| Tower `damage` mult 1.7 (15 days) | 26 | 12/15 | 18 | Same as HP × 0.6, as expected |
| Tower `damage` mult 2 | 29 | 20/25 | 19 | Band III (wave ≥ 30) on ~40% of days: too many |
| Tower `damage` mult 2.4 | 29 | 21/25 | 20 | Same spread |

By region at ×2: Orrery and Giants days run to 40–46, while Bell, Sea and
Storm days still die at 19–20. A uniform lever can't fix a spread that the
bosses cause, so Q3 comes first.

### 1.5 Kills by wave 20 (the same probe runs, for `QUARRY`)

| Region | Type | Median kills | × 0.8 |
|---|---|---|---|
| 9 | ringer / straggler | 295 / 183 | 236 / 146 |
| 10 | satellite / comet | 364 / 217 | 291 / 174 |
| 11 | skater / elite | 499 / **4** | 399 / 3 |
| 12 | titan / tick | 152 / 87 | 122 / 70 |
| 13 | groundling / conductor | 391 / 34 | 312 / 27 |

---

## 2. Q4: measurement and tooling (do this first)

**Options.**
- *Profile the bot and speed up the sim.* That isn't the problem: a normal
  Wake run is 0.4–3 s of CPU. Runs that never end are.
- *Lower `MAX_RUN_SECONDS` for `--act2`.* Cheap, but it hides a real game
  bug: a player can farm Giants' Rest overtime forever at 1.12^wave shards
  (and offline earnings read the farm rate).
- *A lighter Wake-only harness.* Good for boss fights and rule numbers
  (§1.3 was one), but it can't read pace, which needs the Forge and the
  stars bought between runs.
- **Decided: cap the run, then the tools.** End every region run after 20
  overtime waves or 10 minutes of overtime (W1), stop `--act2` at a chosen
  boss (W2), make the harness a mode of `inspect` (W3), then write the Wake
  fixture with the fixed bot (W4).

**D-26: overtime has an end (owner, O-2, 2026-11-25).** The owner wants a
full run on a map to last about 5–20 minutes and never 20+, in normal play
as well as for the bots. Overtime gets two limits, in every region (Act 1
and the Wake; not the Abyss, which has no overtime, and not Boss Rush):

| Key (`BALANCE.overtime`) | Value | Meaning |
|---|---|---|
| `maxWaves` | **20** | The last overtime wave is `BOSS_WAVE + 20` = wave 40. |
| `maxSeconds` | **600** | Sim seconds from the boss's fall. Past it, the run ends at the wave it's on. |

Either limit ends the run **won**: `run.outcome = { kind: 'cleared', wave,
time }` (the kind Boss Rush already uses), with a `cleared` event. Holding
the last wave means the same thing as holding any wave: when wave 40 would
advance under the overlap rule (`shouldAdvance`), the run ends instead of
starting wave 41, and it pays wave 40's `waveBonus` as reaching wave 41
would have (`startWave`'s "reaching wave n pays for n − 1", `waves.ts:314–318`).

**Why 20 and not 15** (measured: one Act 1 pacing seed, 6 h, `--fast`, 114
runs): before the Blight falls, no run gets past wave 39, the longest takes
8.7 sim minutes (3.7 wall minutes at 3×), and only 2 of 102 runs pass wave
35. So a cap at 40 leaves Act 1's pacing as it is, and 15 would cut real
Act 1 runs. **Correction (W1):** that held for seed 1 only, the one seed
that didn't move. On 7 of 8 seeds pre-Blight runs reach wave 40, and W1
moved I1b's median Blight 264:23 → 254:56 (still PASS 8/8). The owner
accepted it and the post-W1 readings became the baseline
(`docs/balancing.md`, "The Wake: second tuning"). 20 also keeps every existing threshold reachable: the trophies
at +5/+10/+15, the contracts' overtime `k` ≤ 15, the Omen's bands (+10 at
most), and the feats *Into the Dark* (wave 30) and *The Long Night* (wave
40: reaching it is now clearing the region). The long runs are all Act 2
towers after the Blight: 4 runs hit the 60-minute cap (21 wall minutes at
3×) at waves 67–78. A run that reaches wave 40 takes about 7–9 sim minutes,
so a full run is about 8–12 minutes at 1× and 3–4 at 3×. `maxSeconds` is
the backstop: an immortal tower whose waves stall on a full field (spawns
held, so the overlap rule never advances) still ends within 10 minutes of
the boss. The fury-past-Rampart change from the first draft isn't needed
for regions any more. It belongs to O-6 (the Abyss), which is open.

**Results and copy** (proposed): the hero reads `Wave 40 · overtime +20`
as today. The headline for a region clear is *The region holds.*, and Boss
Rush keeps *Every boss fell.* The in-run banner on a region's `cleared`
event: *The region holds* / *Twenty waves past the crown.* Audio reuses the
`cleared` cue.

**Other effects to check:** the Omen's score is the wave and then kills,
so capped days tie at 40 and kills decide. Bump `OMEN_SIM` (1 → 2,
`content/omens.ts:128`), because a day may now play differently. The Champions
(every fifth overtime wave) are at most 4 a run. The offline farm rate is
shards per wall minute of recent runs (`meta/offline.ts:11`): Act 1 is
unchanged, and Act 2's endless-farm rates come down. The Act 2 bot's runs
are bounded, so `--act2` speeds up on its own.

**Order:** W1 fix → W2 `--stop-at` → W3 `inspect --frontier` → W4 fixture →
then Q3, Q1 (which needs W1–W2), W9 the idle tool, and Q2 last.

**Verify:** after W1, `npm run pacing -- --act2 --reuse --hours 1 --seeds 1`
finishes in under 5 minutes, no run hits the tools' 3600 s safety net (W1
adds a "runs cut off" count to the report: expect 0), and no run lasts over
20 sim minutes (W1's new "longest run" line).

---

## 3. Q3: difficulty from the rules, not HP

**Finding.** At equal power (the Blight-fall tower), the order today is
Astrolabe = Colossus (easy, no attack) < Thunderhead < Leviathan < Carillon.
Each wall comes from a boss pattern (§1.3): the rules don't kill anyone
before wave 20.

**Options.**
- (a) Tune only the rule numbers. The probe shows this can't reorder
  anything (Glide `carry` ×0.5 changed nothing), because no run dies to a
  rule.
- (b) Tune boss HP. It moves fall rates, but it's the "HP, not rules"
  approach the brief wants to avoid, and it can't fix the Carillon (a
  pattern wall).
- **(c) Recommended: a boss threat budget, then rules with teeth.** Every
  Wake boss gets one attack pattern of about an Act 1 slam's weight
  (Act 1 bosses: `damage` 3–4 every 3.2–7 s). Then the regions' own rules
  are strengthened so they decide the late waves, in chain order.

**Target (proposed):** at the Blight-fall tower, over 12 runs (3 profiles ×
4), fells **Carillon ≥ 9, Astrolabe 7–9, Leviathan 5–8, Colossus 4–7,
Thunderhead 2–5**: falling along the chain. Read it at today's HP, before
Q1's staircase, so that the order is the rules' and patterns' and not the
staircase's.

**Changes (D-27 threat budget, proposed; numbers are starting points that
W5 tunes):**

| Boss | File:line | Change | Measured / expected |
|---|---|---|---|
| Carillon | `bosses.ts:337`, `:345` peal `damage` | 2.5 → **1.0** | with the row below: 0/6 → 5/6 |
| (toll floor) | `balance.ts` `BALANCE.wake.toll.minInterval` | 1.2 → **2.5** (quickened toll ≥ 1.5 s) | as above |
| Astrolabe | `bosses.ts` phases 2–3 (after `:382`, `:390`) | add `{ kind: 'slam', every: 7, windup: 1.3, speed: 420, damage: 2.5 }` (phase 3: `every: 6`) | at `every` 6/5, `damage` 3 it fell to 1/6, so start milder; expect 7–9/12 |
| Leviathan | Floes, see D-28 | Floes become terrain | 2/9 → ~4/9 |
| Leviathan | `bosses.ts:404` `hp` | 75 → **65** only if W5 still reads < 5/12 | — |
| Colossus | `bosses.ts:449` `hp` | 62 → **78** (HP ÷ DPS 20 s → ~25 s, the band's floor) | 6/6 → expect 4–7/12 |
| Thunderhead | via Storm (W6) | no boss change | — |

**D-28 (owner, O-5: yes): Floes are terrain.** They are "not a creature"
(their lore line). Today they're targetable bodies with ×3 HP that stand
between the wall and the boss, so `nearest` weapons (Arcane Bolt, most of
the damage) shoot them instead of the boss. Make `targetable()`
(`combat.ts:178`) return false for a body whose verb is `slab`. Impacts
still shatter them (`glideImpacts` calls `damageEnemy` directly), so the
rule's identity holds. Floes then never die to fire, so they must melt:
add `BALANCE.wake.floes.melt: 20` (seconds), and kill every slab when the
Leviathan falls. `slab` exists only in the Wake, so Act 1 is untouched.

**Rules with teeth (W6, proposed):**

| Rule | Key | Change | Why |
|---|---|---|---|
| Toll (9) | `regions.ts:239` | unchanged (`every` 3, `window` 0.6) | the first lesson stays the easiest |
| Orbit (10) | `wake.ts:306` `orbitStep` + new `BALANCE.wake.orbit.pace: 1` | **D-29 (owner, O-4: yes):** the inward part keeps the walker's pace (`inward = min(len × pace, d − stop)`, the sideways part on top), instead of `len / hypot(1, k)` | Today a spiral is a 17% *slower* arrival, so Orbit makes waves easier. With its pace kept, Orbit strains leading shots without the free time. |
| Glide (11) | `regions.ts:306` | unchanged | impacts help the player; the boss was the wall (D-28) |
| Giants (12) | `regions.ts:339` `hp` | 3 → **3.5** (a wave's total HP ×1.5 → ×1.75) | half the bodies at ×3 is too soft against a single-target build |
| Storm (13) | `regions.ts:375` | `wall` 3 → **4**; `damage` 0.1 → **0.08** | the strikes help the tower less, and a Conductor hurts more: the last lesson is the hardest |
| Conductor | `enemies.ts:762` `hp` | 2.4 → **3** | lifetimes are 2–6 s against an 8 s cap, so there's room |

The weapon table (I4, ≥ 10-point shift per rule, ≤ 40% cap): read with
`npm run arsenal -- --wake` once W4's fixture exists. Arcane Bolt is the
mounted weapon, so it isn't counted as a pick. If a rule fails its 10-point
shift, its *Favours* column is wrong. Note it rather than forcing it.

---

## 4. Q1: pace

**Finding.** §1.1: the Wake takes 20–40 min. A post-Blight tower lights
~18 stars in its first 15 minutes (the Wake lumps and Act 2 feats buy the
cheap stars), and its boss-killing speed rises about ×6 (Carillon 4.6 M HP
in 80 s; Colossus 2.9 M in 9 s). Flat HP can't hold that.

**Options.**

| | Option | For | Against |
|---|---|---|---|
| A | Stair-step HP to reach 6–10 h | keeps §14 | HP ×20–100 by Stormcrown (a guess until growth is measured). The Abyss opens 6–10 h after the Blight, so plan 08's "stratum I's guardian by ~6 h" and "floor ≥ 10 at 12 h" need rebasing. The staircase would be sized for a star-buying active tower, but the idle bot buys no stars, so D-23's 4 days becomes very hard. |
| B | Gate each region on heat in the one before | uses Act 2's own loop | changes D-3, and the idle bot never climbs heat, which breaks D-23 outright |
| C | **Revise the target to 2–4 h, with a moderate staircase** | fits D-23 (4 idle days ≈ 2.5–3 active hours by Act 1's ratio); keeps plan 08's targets as written (measured from the Blight); keeps "the rule is the difficulty" | the Wake is a stretch of Act 2, not a second Act 1 |

**Decided: C (owner, O-1, 2026-11-25).** The Carillon within 30 min of the
Blight, the Thunderhead within **2–4 h** (active bot, median of 4 seeds).
Each later region should hold the bot 25–50 min, enough to light stars or
climb a heat record between bosses.

**Numbers (D-30, proposed; tuned in W7).** A first guess at ×1.8 a region,
from the Bell Marches' 2600:

| Region | `hpBase` today | First guess | × |
|---|---|---|---|
| 9 Bell Marches | 2600 | 2600 | 1 |
| 10 Orrery | 2600 | 4700 | 1.8 |
| 11 Frozen Sea | 2400 | 8400 | 3.2 |
| 12 Giants' Rest | 2400 | 15000 | 5.8 |
| 13 Stormcrown | 2400 | 27000 | 10.5 |

Stormcrown's wave 1 then sits near Abyss floor 3 (`4000 × 1.08^25 ≈ 27k`),
so the descent starts from a tower that has passed the Abyss's top floors.
That's acceptable: the strata's guardians and waypoints still pace the
descent. Keep `hpGrowth` 1.17 and boss `hp` as Q3 left them: boss HP scales
with `waveHp`, so the staircase carries it.

**Pay** (after HP, as §14 says): `shardBase` 66 for every region today.
Step it up with the square root of the HP step (9: 66, 10: 89, 11: 118,
12: 159, 13: 214), so that farming a later Wake region pays more per hour
than the Blight Heart. Read the farm rate in `--act2`, and keep it under
×1.3 per region step (D-6's pay band, read per step).

**How the Abyss interacts.** With C, the Abyss opens about 2–4 h after the
Blight. Re-read plan 08 §9 with the same command: best floor ≥ 10 at 12 h,
stratum I's guardian by ~6 h, the Abyss ≤ 25% of Starlight. Its targets
are measured from the Blight, so a later Abyss start makes them harder,
and they're more likely to need a look under A than under C.

**D-23.** The idle bot buys no stars, so it doesn't get the burst that
carried the active bot. Its binding fights are the pattern walls (Carillon
0/6, Leviathan 2/9 for the Blight-fall Forge tower). Q3's fixes come before
the idle reading for that reason. D-23 says to retune the Wake rather than
move the target, so if the idle bot misses 4 days, shrink the staircase.

**Verify:** `npm run pacing -- --act2 --reuse --stop-at thunderhead --hours 6 --seeds 4`
→ `Carillon first falls: median ≤ 0.5 h ✓` and `Thunderhead first falls:
median 2–4 h ✓` (after W2 changes `WAKE_FIRST_HOURS` and `WAKE_LAST_HOURS`).

---

## 5. Q2: the Omen's Wake days

**Options.**
- *Fewer points on Wake days.* Measured: [0, 2] points still gives median
  23. Too weak on its own. Reject.
- *A higher ring.* Ring 7 is the top ring. There is none higher.
- *More stars.* `BALANCE.omen.stars` already lights the Sky's stat stars and
  Undimmed. The remaining stars are cards and capstones, not stats.
- *An Omen-only foe-HP scale.* Exact, and it can cancel Q1's staircase, but
  the sim would need a new `RunConfig` field read in `waveHp` or `foeHp` (a
  sim change on a hot path).
- **Decided: an Omen-only tower multiplier, per region (D-31, owner, O-3).**
  `BALANCE.omen.might: Partial<Record<number, number>>`, a damage `mult`
  added to `mods` in `omenConfig` (`omen.ts:338`) for that day's region.
  There is no sim change: `StatMod.mult` already exists, and
  `omenConfig`'s config stays profile-free. Days in Act 1 regions don't get
  it, so their configs and every earlier day stay deep-equal. It also reads
  honestly: "the day's tower is a Wake player's".

**Numbers.** Set them after Q3 and Q1 land. The starting rule:
`might[r] = 1.4 × hpBase[r] / 2600` (the 1.4 is a guess after Q3's
equalising; today's spread needed ×1.7–2). With the staircase above, that's
9: 1.4, 10: 2.5, 11: 4.5, 12: 8.1, 13: 14.5. Tune each region's value
against its own days.

**Targets** (`tools/omen.ts`'s, over ≥ 25 Wake days): median fall wave
26–34, band III ≤ 25%, earliest ≥ 15, active − hands-off ≥ 2.

**Cutover safety.** `omenRegion` and its golden test
(`tests/omen.test.ts:394`) don't read `might`. Add a test that
`omenConfig(n)` for an Act 1-region day is deep-equal with and without
`might` set. `rulesTag()` hashes `BALANCE`, so a build with new `might`
values gets a new tag. That is the existing behaviour for any balance
change, and old codes report "another build".

---

## 6. Owner decisions (settled 2026-11-25)

| # | Decision | Owner's answer |
|---|---|---|
| **O-1** | The Wake's length | **C:** the Thunderhead 2–4 h after the Blight, with an HP staircase. Changes D-6 and §14. |
| **O-2** | Endless overtime | **Cap overtime in every region, normal play included:** at most 20 waves (wave 40), and a full run on a map should take at most 15–20 minutes. D-26 adds a 10-minute overtime limit as the backstop. |
| **O-3** | Omen lever | **Tower damage `mult`** (`BALANCE.omen.might`) |
| **O-4** | Orbit keeps the walker's inward pace | **Yes** |
| **O-5** | Floes become untargetable terrain that melts after 20 s | **Yes** |
| **O-6** | *Open, not part of this work:* the Abyss has no overtime and descends until the tower falls, so a strong tower's descent can outlast 20 minutes. Rampart also caps the stall's fury there (`tower.ts:31–36`: fury before the cap). Should Abyss runs get a length limit, or the fury apply after Rampart? | Ask before touching the Abyss. W1 reports the longest Abyss run so the owner can decide. |

---

## 7. Work plan

Rules for every step: run `impact({target, direction: "upstream"})` before
editing a function (CLAUDE.md) and report HIGH or CRITICAL to the owner;
`npm run typecheck` and `npm test` after each step; `detect_changes()`
before each commit; one heavy tool at a time; no command over ~15 min (use
`timeout 900`). **Act 1 must not change:** after W1, W5, W6 and W7,
`npm run pacing -- --hours 6 --seeds 8 --fast` must give the same Act 1
readings (first wave 20, I1a, I1b, I3, I6, the first evolution) as W0's
baseline. Runs after the Blight's fall may change from W1 on; that is the
point of D-26.

**For the implementing session:** keep the context small. Hand each step
(or two small ones) to a sub-agent with this file's step text, and have it
report back the verify reading, not the logs. Run the heavy tools yourself,
one at a time, in the background, with `timeout 900`. Commit after each
step that passes, with `detect_changes()` first. Stop and ask the owner on
a HIGH/CRITICAL `impact` result, on any Act 1 reading that moves, or when a
tuning target can't be met within the step's stated knobs.

### W0. Baselines (no code)

1. `npm run pacing -- --hours 6 --seeds 8 --fast > /tmp/act1-before.txt`
   (keep it for every later Act 1 check).
2. `npm run omen -- --days 55 --from 20790 > /tmp/omen-before.txt`.
3. `npm run pacing -- --idle --hours 12 --seeds 4 --fast > /tmp/idle-before.txt`.

**Done when** all three files exist.

### W1. Overtime has an end (D-26) — `src/content/balance.ts`, `src/sim/`, `src/ui/`, `src/render/`, `tools/`

1. `impact` on `tickWaves`, `startWave`, `bankRun`, `ResultsView.show` (`ui/results.ts`).
2. `src/content/balance.ts`, in `overtime` (line ~561):
   ```ts
   /** D-26 (plans/late-game/12a): the last overtime wave is BOSS_WAVE + this; holding it ends the run, won. */
   maxWaves: 20,
   /** …and sim seconds from the boss's fall after which the run ends, won, at the wave it's on (a stalled field can't hold a run forever). */
   maxSeconds: 600,
   ```
3. `src/sim/systems/waves.ts#tickWaves` (`:578–631`). Add a small helper in
   the same file:
   ```ts
   /** The region holds (D-26): overtime's last wave held, or its time run out. Won, as Boss Rush's last boss. */
   function holdRegion(run: RunState, region: RegionDef, n: number): void {
     const bonus = waveBonus(region, n) * run.stats.shardMult;   // as reaching wave n + 1 would pay (startWave, :314–318)
     run.shards += bonus;
     run.shardsFrom.waves += bonus;
     run.outcome = { kind: 'cleared', wave: n, time: run.time };
     run.draft = null;
     run.events.push({ kind: 'cleared' });
   }
   ```
   (a) Time: right after the `if (!cur) {…}` block, if
   `!region.abyss && !region.rush && cur.n > BOSS_WAVE && run.boss?.killedIn != null
   && run.time - (run.boss.arrivedAt + run.boss.killedIn) >= BALANCE.overtime.maxSeconds`,
   call `holdRegion(run, region, cur.n)` and `return`.
   (b) Waves: in the last branch (`if (cur.doneAt !== null && shouldAdvance(…))`),
   before `startWave(run, next, cur.n + 1)`: if `!region.abyss && !region.rush
   && cur.n >= BOSS_WAVE + BALANCE.overtime.maxWaves`, call
   `holdRegion(run, region, cur.n)` and `return`. Use `region.rush`, the field
   the existing Rush check reads at `:619`. Check whether `run.boss` stays set
   after the kill in regions (it does in `isBossWave`'s branch at `:617`).
   Don't touch the Rush branch.
4. `src/sim/run.ts#step`: after `tickWaves`, if the outcome just became
   `cleared` in a region (not Rush), call `shutRift(run)` and
   `fadeReliquaries(run)`, as `retreat` does (`run.ts:231–232`).
5. Presentation (copy from §2, proposed):
   - `ui/results.ts:325–336`: the `cleared` hero branch is for Rush only
     (`s.outcome === 'cleared' && s.rush`). A region clear falls through to
     the normal hero (`Wave reached · overtime +20`). Headline:
     `s.outcome === 'cleared' ? (s.rush ? 'Every boss fell.' : 'The region holds.') : …`.
   - `render/renderer.ts:512`: on `cleared`, Rush keeps its banner; a region
     shows `showBanner('The region holds', 'Twenty waves past the crown.', 'gold')`.
   - `audio/cues.ts:227`: unchanged.
   - `content/explainers.ts:85` (the overtime explainer): add one sentence,
     "Twenty waves past the boss, the region holds and the run is won."
     R4's 15-word limit doesn't apply to explainers; check
     `tests/explainers.test.ts`.
6. `src/content/omens.ts:128`: `OMEN_SIM = 2` (a day's run may now end
   differently). `tests/omen.test.ts`'s golden days don't depend on it.
7. `tools/play.ts`: add `cutOff: boolean` to `PlayResult` (true when the loop
   ended on `run.tick >= maxTicks`). `tools/act2.ts`: count it into
   `Act2Report.cutOff`, and keep the longest run's sim seconds by kind
   (region, Abyss, Rush). `tools/pacing.ts#act2Main`: print per seed
   `runs cut off: N · longest run: region X min, Abyss Y min` (the Abyss
   figure is O-6's reading). In the Act 1 report (`main()`, `seeds > 0`),
   print the median and max run sim minutes and the count of `cleared` runs.
8. Tests (`tests/overtime.test.ts`, new):
   (a) a region run with a very strong tower (a test helper that sets
   `maxHp`, regen and damage high) ends `cleared` at wave 40, and its
   `run.shards` includes wave 40's `waveBonus`;
   (b) a run whose field is held full in overtime (bodies that can't die:
   give them huge HP and an unkillable tower) ends `cleared` within
   `maxSeconds` of the boss's fall;
   (c) the Abyss and Boss Rush never end through `holdRegion` (an Abyss run
   past global wave 40 goes on);
   (d) `bankRun` on a cleared region run records `bestWave` 40, pays the +15
   trophy once, and the *Long Night* feat (`long-night`, wave 40) is earned;
   (e) the determinism tests still pass. If a hashed test run went past wave
   40 before, its hash changes: update it only after checking that the run
   now ends at 40, and say so in the commit.
9. **Verify:**
   - `timeout 900 npm run pacing -- --act2 --reuse --hours 1 --seeds 1`
     finishes in under ~5 minutes. Expect `runs cut off: 0`, and the
     longest region run ≤ 20 sim minutes.
   - The Act 1 check against W0. Expect no change before the Blight (no
     pre-Blight run passed wave 39 on seed 1).
   - `npm run pacing -- --idle --hours 12 --seeds 4 --fast`: I2, I5, I7, I8
     as before (record them before the change too, in W0).
   - `npm run omen -- --days 28 --from 20760`: Act 1 days read as before
     except days that reached wave 40+ (now 40).

**Done when:** tests pass, no region run outlasts `maxSeconds` past its
boss, and Act 1's pre-Blight readings match W0.

### W2. `--stop-at <boss>` for `--act2`, and §14's new targets — `tools/`

1. `tools/act2.ts#runAct2(profile, hours, seed, keep, stopAt?: BossId)`:
   after `bankRun`, `if (stopAt && bossDown(profile, stopAt)) break;`
   (after `keepAt`, so the fixture still gets that boss's save).
2. `tools/pacing.ts`: `act2Verdict` and the `JOBS.act2` args take `stopAt`.
   `main()` reads `arg('stop-at', '')`. Print `stopped at <boss>` in the
   header.
3. `tools/pacing.ts:720–721`: `WAKE_FIRST_HOURS = { min: 0, max: 0.5 }`,
   `WAKE_LAST_HOURS = { min: 2, max: 4 }` (O-1).
4. **Verify:** `timeout 900 npm run pacing -- --act2 --reuse --stop-at thunderhead --hours 6 --seeds 4`.
   Expect (today's HP) every boss at ≤ 0.7 h, with ✗ on the Thunderhead
   line. That's the baseline for W7.

### W3. `inspect --frontier`: the Wake harness as a real tool — `tools/inspect.ts`

1. New flags: `--frontier` (play `frontierProfile(region, k)` from
   `tools/frontier.ts`, k = run index, instead of a Forge preset),
   `--arrival` (even k only), `--fixture act1` (use the Blight saves of
   `frontiers.json` for every Wake region: set each earlier Wake boss's
   `profile.bosses[id] = { kills: 1, fastest: null }` and assert
   `selectedRegion(profile).index === region`. Without it, the run
   silently plays Region 1), `--stop-boss` (end the run when the boss
   falls).
2. Per run, collect: the boss felled and its `killedIn`; boss max HP ÷
   `buildDps(run.weapons, run.stats)` at arrival; `damageBy` and `takenBy`
   shares; for `conduct` bodies, seconds from first entering
   `run.stats.range` to death (median); `killsBy` and `elitesKilled`.
3. Summary line per region: `fells a/b · HP÷DPS med · boss s med · hurt by
   (median shares) · Conductor med life`.
4. **Verify (reproduces §1.3):**
   `npm run inspect -- --seeds 6 --frontier --fixture act1 --region 9 --stop-boss`
   → Carillon 0/6, hurt by slams ~75%. Region 13 → 5/6, Conductor life
   ~2–6 s.

### W4. The Wake fixture — `tools/fixtures/wake-frontiers.json`

1. `timeout 900 npm run pacing -- --act2 --reuse --wake-frontiers --stop-at thunderhead --hours 6 --seeds 3`.
   (`--reuse` reads `node_modules/.tmp/act2-starts/seed-{1,2,3}.json`. They
   exist, made 2026-11-21, and `migrate` walks them up.) If a seed's start
   is missing, it plays Act 1 first, which takes hours: run that seed
   alone, in the background.
2. Check that the file has a save for `blight` and each of the five Wake
   bosses, for seeds 1–3 (`tools/frontier.ts#stored` throws otherwise).
3. `npm run arsenal -- --wake` runs. Record the table.
4. Commit the fixture. **Regenerate it after W5–W7** (the fixture is only
   as current as the Wake's balance).

### W5. The boss threat budget and Floes (D-27, D-28) — `src/content/`, `src/sim/`

1. Data (`src/content/bosses.ts`, `balance.ts`): the §3 table's rows
   (Carillon peal 1.0 ×2, `toll.minInterval` 2.5, Astrolabe slams,
   Colossus `hp` 78).
2. D-28: `impact` on `targetable`. In `combat.ts:180`, add
   `|| ENEMY_BY_ID[e.type].verb.kind === 'slab'` to the false branch.
   Check every caller of `targetable` (aim, the storm, the Clapper, Nova):
   none should touch a Floe. `BALANCE.wake.floes.melt: 20`. In `crackFloes`
   (`boss.ts:441`), set each Floe's lifetime. Add the melt where bodies
   expire (or in `tickWake`: a slab older than `melt` dies with no pay and
   no kill). On the Leviathan's fall, kill every slab (no pay).
3. Tests: a Floe is never a target (nearest, toughest, Drones); a slider
   still shatters on it; Floes melt after 20 s and on the boss's fall; the
   Carillon's quickened toll never goes under 1.5 s.
4. **Verify:** `npm run inspect -- --seeds 12 --frontier --fixture act1 --region N --stop-boss`
   for N = 9…13, at today's HP. Target (§3): Carillon ≥ 9/12, Astrolabe
   7–9, Leviathan 5–8, Colossus 4–7, Thunderhead 2–5. Tune one number at a
   time, in this order: the Astrolabe slam's `damage` (±0.5), the Colossus
   `hp` (±8), the Leviathan `hp` (75 → 65). Then the Act 1 check.

### W6. Rules with teeth (D-29 and §3's rule table) — `src/content/`, `src/sim/systems/wake.ts`

1. D-29: `impact` on `orbitStep`. `BALANCE.wake.orbit.pace: 1`. In
   `wake.ts:306`, `const inward = Math.min(len * BALANCE.wake.orbit.pace, d - stop);`
   (the sideways part stays `inward × k`). Update plan 12 §4.2's test
   ("reaches the wall in 1.12–1.22×" becomes "within 2% of a straight
   walker's time").
2. Data: Giants `hp` 3.5, Storm `wall` 4 and `damage` 0.08, Conductor `hp` 3.
3. **Verify:** W5's inspect sweep holds its targets (re-tune if the order
   breaks; Storm's `wall` is the Thunderhead's knob). The Conductor's median
   life stays < 8 s. `npm run arsenal -- --wake` (regenerate W4's fixture
   first): each rule shifts some weapon by ≥ 10 points against the Blight
   Heart column, and no weapon is above 40%. Then the Act 1 check.

### W7. The staircase and pay (D-30) — `src/content/regions.ts`

1. Set `hpBase` (`regions.ts:224, 256, 288, 324, 357`) to the §4 table's
   first guess.
2. `timeout 900 npm run pacing -- --act2 --reuse --stop-at thunderhead --hours 6 --seeds 4`.
3. Tune **one region at a time, in chain order**: if region k's boss falls
   earlier than the target window allows, raise `hpBase[k]` and every later
   region's by the same factor. Targets: Carillon ≤ 30 min; each later boss
   25–50 min after the one before; Thunderhead 2–4 h. A bisection on the
   factor needs 3–4 readings per region.
4. Then `shardBase` (§4's pay row), and re-read: the farm rate per region in
   the `--act2` report rises step by step, by no more than ×1.3 a step.
5. Plan 08's readings (no `--stop-at`):
   `timeout 900 npm run pacing -- --act2 --reuse --hours 12 --seeds 4 --fast`
   (a look). Best floor ≥ 10, stratum I's guardian ≤ 6 h, the Abyss ≤ 25% of
   Starlight. Report misses to the owner rather than retuning the Abyss.
6. Regenerate W4's fixture, then re-run W5's sweep on **arrival** towers:
   `npm run inspect -- --seeds 12 --frontier --arrival --region N --stop-boss`.
   Each boss should take 25–35 s of expected DPS at its own arrival tower
   (§14's row).
7. The Act 1 check.

### W9. `--idle --wake` (D-23's gate) — `tools/idle.ts`, `tools/pacing.ts`

1. `runIdle(days, seed, bosses, mode, start?: Profile)`: start from `start`
   (a clone) instead of `newProfile(0)` when given.
2. Idle starts at the Blight: like `ACT2_STARTS`, keep
   `node_modules/.tmp/idle-starts/seed-N.json`. To make one, run
   `runIdle(IDLE_DAYS_CAP, seed, [FINALE])` once and save the profile at
   the `bossKill` event of the Blight (`report.bossKills`): add an
   `onFinale` callback. This is the slow part (5–10 sim days per seed), so
   run it one seed at a time in the background.
3. `pacing.ts`: `--idle --wake` plays `runIdle(6, seed, ['thunderhead'], 'hands-off', start)`
   for each seed and prints the days from the Blight to the Thunderhead,
   with a PASS at ≤ 4 days (D-23). Also print the Wake bosses' days and
   "stars lit: 0" (the idle bot never lights stars: report it, per plan 12
   §10.2).
4. **Verify:** `npm run pacing -- --idle --wake --seeds 4`. If it FAILs,
   D-23 says to retune the Wake: shrink W7's staircase factor first, then
   look at the boss that stalls the idle bot with W3's tool.

### W10. The Omen's Wake might (D-31) — `src/content/balance.ts`, `src/meta/omen.ts`

1. `impact` on `omenConfig`. In `BALANCE.omen`, add
   `/** The Wake's days: the Omen tower's damage multiplier by region (a Wake player's tower; plans/late-game/12a §5). */ might: { 9: 1.4, 10: 2.5, 11: 4.5, 12: 8.1, 13: 14.5 } as Partial<Record<number, number>>`
   (recompute from W7's final `hpBase`: `1.4 × hpBase / 2600`).
2. `omenConfig` (`omen.ts:338`):
   `mods: Object.freeze([...base.mods, ...mods, ...(BALANCE.omen.might[roll.region] ? [{ key: 'damage', mult: BALANCE.omen.might[roll.region]! }] : [])])`.
3. Tests (`tests/omen.test.ts`): the golden days still pass; an Act 1-region
   day's `omenConfig` is unchanged by `might`; a Wake day's config carries
   the mod.
4. **Verify:** `npm run omen -- --days 55 --from 20790`. Read the summary
   *and* the Wake days by region. Targets: median 26–34, band III ≤ 25%,
   earliest ≥ 15, active − hands-off ≥ 2. Tune each region's `might` on its
   own days (±15%).
5. Update `docs/act2.md`'s Omen paragraph ("`BALANCE.omen.stars` … is
   empty for now" is already stale: it holds `WAKE_OMEN_STARS`).

### W11. `QUARRY` for 9–13 — `src/content/contracts.ts:25`

1. Measure on the Wake fixture's cleared towers:
   `npm run inspect -- --seeds 20 --frontier --region N --stop-boss`
   (W3's kills line). Use the median × 0.8, tidied.
2. Starting values from §1.5, to confirm:
   `9: ringer 240, straggler 150 · 10: satellite 290, comet 170 · 11: skater 400, <see below> · 12: titan 120, tick 70 · 13: groundling 300, conductor 25`.
3. Region 11's `elite` reads only 4 a run, so "slay 3 elites" is trivial.
   **(proposed)** Replace it with `sledge` (measure it), or keep `elite`
   at 4 only if the contract tests want a quick card. Note it for the owner.
4. Tests: `tests/contracts.test.ts`; then the contract bot
   `timeout 900 npm run pacing -- --act2 --reuse --hours 4 --seeds 2 --contracts 0.33`
   still clears its targets.

### W12. Docs and the closing checks

1. `docs/balancing.md`: a "The Wake: second tuning" reading with §14's table
   filled in (pace, idle, arsenal, bosses, Conductor, Omen, frame budget,
   Act 1).
2. `docs/enemies-and-waves.md` (overtime) and `docs/balancing.md`'s
   invariants: overtime ends at +20 waves or 10 minutes past the boss, won
   (D-26), and add the reading "no region run over 20 sim minutes".
   Plan 12: add D-26…D-31 to §0.2 (accepted by the owner on 2026-11-25), and
   update §14's targets and the status line. `docs/act2.md`: the staircase
   and the gate. `AGENTS.md`'s command list: `--stop-at`,
   `inspect --frontier`, `--idle --wake`.
3. `npm run typecheck`, `npm test`, `npm test -- perf` (the Glide, Bell and
   Titan frame-budget cases), the full Act 1 check without `--fast`
   (`npm run pacing -- --hours 6 --seeds 8`), then `detect_changes()`.

**Order and dependencies:** W0 → W1 → W2 → W3 → W4 → W5 → W6 → W7 → W9 →
W10 → W11 → W12. W3 can go before W2. W11 can go any time after W4. W10
must come after W7, since `might` follows the staircase.
