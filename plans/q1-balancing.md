# Q1 balancing pass — handoff

**Status:** 2026-10-02. Q1's mechanics are built (see
`plans/post-rebuild-improvements.md` §3, §6 and §7's Q1). This is the
retune that is still owed, written for a fresh session to pick up.
Q3 and Q4 will need their own balance pass later. This one only has to
leave Q1's gate green.

**Pass 1 (later, 2026-10-02):** problems 1–2 done (Regions 5–6: HP up,
pay down; I1b 8/8 at 8:23, I2 5.0 d). Stopped at 3: I3 needs a mechanic
(Twin Mount draws Scattershot into the last slot, and Region 3's shields
take both weapons). Readings and the probe in `docs/balancing.md`, "Q1
balancing". The CI P3 median also fails (31:24) since the camera and fog
merge.

**Pass 2 (2026-10-03):** Twin Mount's draw now skips the region's
blockers (the owner's I3 fix); Twin Mount 300, Region 4 hpBase 580. I3
8/8, I1b 8/8, Forgeheart 149, I2 6.0 d. Stopped at 4: I6 4/8 can't be met
with numbers (a 21-min Trial run with no in-run reveals on two seeds;
Region 2's Forge stretch at a coin toss on the rest). Problems 5–10 not
started. `docs/balancing.md`, "Q1 balancing (continued)".

## What changed under the numbers

Read these before tuning. Each moves the balance on its own:

| Change | Where | Effect on pacing |
|---|---|---|
| S1 stat buckets: `(1 + Σpct_meta) × (1 + Σpct_run)` | `sim/stats.ts`, `StatMod.bucket` | in-run power multiplies with the Forge: early game ~18 min faster to the Bog Mother, late game much faster |
| S1 rings 4–6: damage, speed, HP, shards, XP and ult-charge minors are 2 levels of `mult` (×1.07–×1.12), level 1 at 3× the old first level's price, `growth: 3` | `content/forge.ts` | fewer, bigger late buys; total late cost about ⅔ of before |
| S1 masteries: `mult: 1.03` a level, compounding, cost ×1.2 a level | `content/forge.ts` | Act 2 sink can now be felt |
| S2 armour curve `hit²/(hit+armour)`, `minFraction` 0.05 | `sim/systems/damage.ts`, `balance.ts` | Brutes no longer floor hits: the Gatekeeper falls ~5 min sooner; armoured late regions much softer. Also applies to the **tower's** armour (Bulwark) |
| S2 Forgeheart's plates (2 → 1 → 0, 12% HP each, guard 0.5) | `content/bosses.ts`, `sim/systems/boss.ts` | |
| S2/T2 scorer: armour-aware, fitted to the sim, `weakAgainst` counts ¼ | `sim/suggest.ts` | the bots draft differently in every region |
| S3 Nova 40% / Tempest 15% Max HP floor on non-bosses | `content/frames.ts` | late waves easier for Arcanist/Stormcaller |
| B2 Hoarder: shards ×2, enemies ×1.5 HP | `forge.ts`, `waves.ts#foeHp` | |
| S4 Specialist swaps in its first weapon; Glass Cannon regen ×0.5 | `draft.ts`, `forge.ts` | Specialist is now strong (see the sweep) |
| S5 Velocity pierce at L3 and L5; Greed +1% shards a wave held; Scattershot ×1.5 point-blank | `content/passives.ts`, `content/weapons.ts` | not yet measured on the pacing |

The region HP already retuned in this session (`content/regions.ts`):

| Region | hpBase | hpGrowth |
|---|---|---|
| 1 | 10 → **12** | 1.17 → **1.18** |
| 2 | 30 → **42** | 1.17 |
| 3 | 95 → **88** | 1.17 |
| 4 | 290 → **460** | 1.17 |
| 5 | 1450 → **1600** | 1.17 |
| 6 | 1300 → **2000** | 1.17 |

Region 1's `hpBase` can't pass 12: a wave-1 Grunt must die to one
12-damage bolt, or the P1 test (first kill inside 3 s) fails. Slow
Region 1 through `hpGrowth` or shards instead.

## Where it stands (last reading, this session)

`npm run pacing -- --hours 12 --seeds 8`:

| Reading | Baseline (`d3cea42`+Q0) | Now | Target |
|---|---|---|---|
| first wave 20 (P3) | 26:46 | 27:22 PASS | 15–30 min |
| Gatekeeper (P4, I1a) | 33:24 · 8/8 | 32:10 · 8/8 PASS | 25–40 min |
| Bog Mother | 70:40 | 73:56 | 60–75 min |
| Prism | 116 | ~106 | — |
| Forgeheart | ~165 | ~145 | 132–198 (±20% of baseline, Q1 gate) |
| Hollow King | ~315 | ~232 | — |
| Blight (I1b) | 537 · 8/8 | **400 · 1/8 FAIL** | 7–12 h, aim ~9 h |
| I3 | 8/8 | **5/8** | 8/8 |
| I6 | 5/8 | **3/8** (gaps 9:36–14:56) | 8/8 |
| first evolution | 94 | 100 | 90–120 min |

`npm run pacing -- --idle --hours 12 --seeds 4`: **I2 4.5 d FAIL**
(want 5–10); I5 passes at every gated checkpoint (1.32–1.49).

`npm run arsenal`: I4 PASS (worst Mortar 31%, Region 2).
`npm run arsenal -- --keystones`: PASS on the free-or-trap rule. But:
- Specialist gains in 4 regions (×2.97 shards and 6 of 8 Blight kills in
  Region 6, where no other build kills it);
- Fortress loses in 4 of 4 (only ×1.01 shards in Region 3);
- Glass Cannon loses its Region 3 boss kills.

`npm run calibrate`: T2 PASS, 0 of 48 rows past 25%.
`npm test`: everything passes except `tests/pacing.test.ts` I6 (one CI
seed has a 10:43 gap at 48–59 min in Region 2: the bot buys only minors
between revealing Mortar/Choice and Twin Mount).

`npm run pacing -- --act2 --hours 12 --seeds 4`: **heat 10 at the
frontier at 74:31**, far too fast (want 3–12 h; before Q1 it was never).
The bot buys ~84 mastery levels in 12 h (43 before), and at ×1.03
compounding that is roughly ×1.6 on each mastery's stat. The best Abyss
floor is 6 (4 before), with ~240 Starlight and 25–27 stars.

## Known problems to fix

1. **The late game is ~2 h short** (Blight 400 against ~537). Raise
   Regions 5–6 (try `hpBase` 1800 / 2300), and keep Forgeheart inside
   132–198. Late variance lives here: compare per profile, not only the
   median (`docs/balancing.md`, "Tuning practice").
2. **I2: idle Act 1 is 4.5 d** (want 5–10). It mostly follows (1); re-read
   it after.
3. **I3: Region 3 opening wipes.** Region 3's waves 1–4 are all
   Shieldbearers. A tower with only frontal projectiles (Arcane Bolt,
   Scattershot) lands nothing, gets no XP, so no drafts, and falls by wave
   4 with ~30 shards. It happens when the bot reaches Region 3 before
   owning ring 3's weapons. The baseline had it too (7/30 wipes at the
   ring-2 preset, `npm run inspect -- --seeds 30 --forge ring2 --region 3`)
   but reached Region 3 later. Options, best first:
   - make Region 3 reachable a little later, or ring 3's weapons cheaper;
   - bring Burrowers in from wave 3 instead of 5 (content: `regions.ts`;
     the wave-5 `introduce` beat moves with it);
   - give the opening drafts a guarantee: a new-weapon card when the tower
     has landed nothing (`draft.ts#rollOffer`).
4. **I6 gaps** at 95–115 min (the Prism grind) and 48–59 min (Region 2's
   Forge stretch). Levers: Prism HP (`bosses.ts`, 50×), ring-3 notable
   costs, or Region 2's shards. The CI test (`tests/pacing.test.ts`, 3
   seeds × 1 h) must pass too.
5. **Keystones:** soften Specialist (×3 damage → ×2.5?) and give Fortress
   a real gain (Max HP ×2.5, or Thorns ×4). Re-run `--keystones`.
6. **Weak evolutions** (from `npm run calibrate`, measured over the same
   crowd): Judgment +9% over Sunlance L5 (its forks need full heat, which
   a beam rarely holds); Dragonbreath +13%; Midas Lance +11%; Absolute
   Zero +10%. Each should be a felt step (≥ +25%). Lower Judgment's fork
   heat, raise burns and the gilded mark. **Re-fit `sim/suggest.ts`'s
   constants after any weapon change** (`npm run calibrate` names the row).
7. **S5 not yet measured:** Greed (D-11), Velocity and Scattershot's
   point-blank. Check their pick rates with `npm run arsenal` and their
   worth with `npm run inspect -- --by-weapon`. Add I4b if it fits: no
   weapon's measured share at L5 under half the median.
8. **Tower armour under the curve:** Bulwark's flat armour (+2 a level,
   ring minors +3/+5/+8) is weaker against big hits than before. Check
   damage taken late (`inspect` "taken" column) and raise the steps if
   Bulwark builds lost their worth.
9. **Act 2 is now too easy** (heat 10 in ~75 min). The masteries are S1's
   change, so their numbers belong here: try cost growth ×1.25–1.3 back
   up, or ×1.02 a level, until heat 10 lands in 3–12 h. The rest of Act
   2's economy (Starlight, pacts, the Abyss boss) is Q4's, so don't
   rebuild it here, but P8's reading must not get worse than "never".
10. **Overtime** (S6, can wait for Q3): runs still die at overtime +3 to +7.

## How to work

- One change at a time; `npm run pacing -- --hours 12 --seeds 8` takes
  about 100 s now (seeds run in workers). Bundle into a scratch file whose
  name contains `pacing` (the entry check reads `argv[1]`).
- Early regions: `--hours 3` is enough and takes ~20 s.
- Region difficulty at a fixed Forge: `npm run inspect -- --seeds 16
  --forge ringN --region N` (median death wave). The baseline's numbers are
  in the table below, for comparison.
- Before finishing: `npm test`, `npm run typecheck`, `npm run arsenal`,
  `npm run arsenal -- --keystones`, `npm run calibrate`, the idle report,
  `npm run pacing -- --act2 --hours 12 --seeds 4`. Record every reading
  in `docs/balancing.md` under a "Q1 balancing" heading, as Q0 did.

Baseline death waves at the region's own ring (16 seeds, before Q1):
R3 ring3 16 · R4 ring4 19 · R4 ring5 24 · R5 ring5 19 · R5 ring6 23 ·
R6 ring6 18.

## Q1's gate (from the plan)

- I1–I6 all pass on 8 seeds.
- A Power level is worth at least +10% damage with the full Forge
  (`tests/draft.test.ts`: passes).
- No keystone's sweep shows a gain without a cost, or a loss without a
  gain (`--keystones`: passes; see item 5).
- T2's calibration test passes (passes).
- Forgeheart's first kill median within ±20% of today's (132–198 min).

## Prompt for the next session

> Read `plans/q1-balancing.md` and `docs/balancing.md`. Do the Q1
> balancing pass: fix the known problems in the order listed, using the
> tools as described, one change at a time, until Q1's gate passes on 8
> seeds and `npm test` is green. Don't change mechanics beyond what the
> plan names. If a gate can't be met with numbers alone, stop and say
> which and why. Record the readings in `docs/balancing.md` and commit as
> "Post-rebuild Q1: balancing".
