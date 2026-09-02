# Progress — implementation steps

Companion to [progress.md](progress.md). That document is the **diagnosis and
the design**; this one is the **work order**. Every step below is written to be
executed literally: the code to find is quoted exactly as it exists in the tree
today, the code to write is given in full, and each step ends with the command
that proves it landed.

---

## How to work through this document

1. **Do the phases in order.** Phase N assumes N−1 has landed. Inside a phase,
   do the steps in order.
2. **Never batch two steps into one edit.** After every step, run the
   verification command printed under it. If it fails, fix that step before
   moving on.
3. **After every phase**, run the full gate:
   ```bash
   npm run typecheck && npm test && npm run checks
   ```
   All three must pass before starting the next phase. `npm run sim` never
   fails — it prints tables you compare by eye against the numbers this document
   predicts.
4. **When a quoted "find" string does not appear**, stop and report it. Do not
   guess at a nearby line. The tree may have moved on since this was written.
5. **Do not invent constants.** Every number you need is in this document. If
   something seems to need a number that is not here, stop and report it.
6. **Comments are part of the deliverable.** This codebase documents *why* a
   constant is what it is. The comment blocks in the code below are not
   optional; copy them verbatim.
7. **Do not run `git commit` or `git push`** unless explicitly asked.

### The one thing that is easy to get wrong

Several formulas in `src/data/formulas.ts` are read by **three** independent
consumers: the game (`src/systems/*`), the balance model (`sim/model.ts`) and
the tests. When you change one, all three move together — that is the point of
the shared module. Never copy a formula into a second place.

---

## Phase 0 — Baseline capture

You are about to change balance. Capture what it is *now*, so every later phase
can be diffed against it.

### Step 0.1 — Record the current sim output

```bash
mkdir -p .balance-baseline && npm run sim > .balance-baseline/sim-before.txt 2>&1 && npm run checks > .balance-baseline/checks-before.txt 2>&1
```

**Verify:** `.balance-baseline/sim-before.txt` exists and its last line reads
`Ascension unlocks at wave 20.`

**Note:** `.balance-baseline/` is scratch. Add it to `.gitignore` if it is not
already covered, and never commit it.

### Step 0.2 — Confirm the tree is green before you start

```bash
npm run typecheck && npm test && npm run checks
```

**Verify:** all three exit 0. `npm run checks` ends with `All checks passed.`

If anything fails here, stop and report — the failure is pre-existing and not
something this plan introduced.

### Step 0.3 — Note the four numbers you will be steering

From `.balance-baseline/sim-before.txt`, find the table headed
`=== §2.2 Wall wave and run length per prestige tier (no blessings) ===` and
write its five `Wall wave` values into a scratch note. On the tree this was
written against they are:

| Lifetime AP | Wall wave | Run length |
|---|---:|---:|
| 0 | 33 | 45 min |
| 100 | 109 | 156 min |
| 1.0 K | 144 | 142 min |
| 10.0 K | 189 | 192 min |
| 100.0 K | 239 | 283 min |

These five numbers are the **regression fence** for Phases 1, 2, 5 and 8 — those
phases must not move them by more than one boss decade (10 waves). Phases 3, 4,
9 and 10 change them deliberately, and each says by how much.

---

## Phase 1 — The Accelerator fix and the stale docs

Independent of everything else. Small, and it is a prerequisite for measuring
run length in wall-clock terms.

**What is wrong** (progress.md §1.4): `getGameSpeedBonus()` returns
`0.5 × level` — a *speed delta* — and `syncUiApis` adds it to `maxSpeedIndex`,
which is an *index*. One index step is worth 0.5×, so the perk delivers half
what it promises, and odd levels leave the index on a half-step that
`getAvailableSpeeds()` (which iterates whole numbers) cannot enumerate.

### Step 1.1 — Convert the bonus to index steps

**File:** `src/game/Game.ts`

**Find** (one occurrence, inside `syncUiApis`):

```ts
    this.maxSpeedIndex = MAX_SPEED_INDEX + this.prestigeMgr.getGameSpeedBonus();
```

**Replace with:**

```ts
    // `getGameSpeedBonus()` returns a *speed delta* (0.5 x level, per the
    // Accelerator's own copy) and `maxSpeedIndex` is an *index*, where one step
    // is worth `SPEED_STEP`. Adding the delta straight into the index halved
    // the perk — a maxed Accelerator reached 3.0x against the +3.0x it sells —
    // and left the index on a half-step at odd levels, which
    // `getAvailableSpeeds()` (whole numbers) could not enumerate, so levels 1,
    // 3 and 5 added no selectable speed at all.
    this.maxSpeedIndex = MAX_SPEED_INDEX
      + Math.round(this.prestigeMgr.getGameSpeedBonus() / SPEED_STEP);
```

### Step 1.2 — Name the step size once

**File:** `src/types.ts`

**Find:**

```ts
export const GAME_SPEEDS: readonly number[] = [0.5, 1.0, 1.5];

export const DEFAULT_SPEED_INDEX = GAME_SPEEDS.indexOf(1.0);
export const MAX_SPEED_INDEX = GAME_SPEEDS.length - 1;
```

**Replace with:**

```ts
export const GAME_SPEEDS: readonly number[] = [0.5, 1.0, 1.5];

export const DEFAULT_SPEED_INDEX = GAME_SPEEDS.indexOf(1.0);
export const MAX_SPEED_INDEX = GAME_SPEEDS.length - 1;

/**
 * Speed added by one index step past the end of `GAME_SPEEDS`.
 *
 * `Game.computeSpeedForIndex` extrapolates past the array at this rate, and
 * `Game.syncUiApis` divides the Accelerator's speed delta by it to convert the
 * perk's effect into index steps. Two call sites, one constant — they used to
 * disagree, and the perk shipped at half strength because of it.
 */
export const SPEED_STEP = 0.5;
```

### Step 1.3 — Use the constant in the extrapolation too

**File:** `src/game/Game.ts`

**Find:**

```ts
  private computeSpeedForIndex(index: number): number {
    if (index < GAME_SPEEDS.length) return GAME_SPEEDS[index];
    const last = GAME_SPEEDS.length - 1;
    return GAME_SPEEDS[last] + (index - last) * 0.5;
  }
```

**Replace with:**

```ts
  private computeSpeedForIndex(index: number): number {
    if (index < GAME_SPEEDS.length) return GAME_SPEEDS[index];
    const last = GAME_SPEEDS.length - 1;
    return GAME_SPEEDS[last] + (index - last) * SPEED_STEP;
  }
```

Then update the import at the top of `src/game/Game.ts`.

**Find:**

```ts
import { GAME_SPEEDS, DEFAULT_SPEED_INDEX, MAX_SPEED_INDEX, MAX_RUN_HISTORY } from '../types';
```

**Replace with:**

```ts
import { GAME_SPEEDS, DEFAULT_SPEED_INDEX, MAX_SPEED_INDEX, SPEED_STEP, MAX_RUN_HISTORY } from '../types';
```

**Verify:**

```bash
npm run typecheck
```

### Step 1.4 — Pin the perk's ladder with a test

**File:** `tests/systems.test.ts`

Append this block at the end of the file (outside any existing `describe`):

```ts
describe('Accelerator speed ladder', () => {
  /**
   * progress-steps §1: the perk sells +0.5x per level over a 1.5x base, so the
   * ladder is 1.5 / 2.0 / 2.5 / 3.0 / 3.5 / 4.0 / 4.5 and *every* level adds
   * exactly one selectable speed. It used to add half a step, which meant odd
   * levels added nothing at all and a maxed perk topped out at 3.0x.
   */
  it('adds one whole selectable speed per level', () => {
    const expected = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5];
    for (let level = 0; level <= 6; level++) {
      const maxIndex = MAX_SPEED_INDEX + Math.round((0.5 * level) / SPEED_STEP);
      expect(maxIndex, `level ${level}`).toBe(2 + level);
      const top = maxIndex < GAME_SPEEDS.length
        ? GAME_SPEEDS[maxIndex]
        : GAME_SPEEDS[GAME_SPEEDS.length - 1]
          + (maxIndex - (GAME_SPEEDS.length - 1)) * SPEED_STEP;
      expect(top, `level ${level}`).toBeCloseTo(expected[level], 6);
      expect(Number.isInteger(maxIndex), `level ${level} index is whole`).toBe(true);
    }
  });
});
```

Add the import it needs at the top of `tests/systems.test.ts` (merge into the
existing `../src/types` import if there is one, otherwise add a new line):

```ts
import { GAME_SPEEDS, MAX_SPEED_INDEX, SPEED_STEP } from '../src/types';
```

**Verify:**

```bash
npm test -- systems
```

### Step 1.5 — Correct the four stale doc claims

These are text-only. Each is a find-and-replace in a Markdown file.

**1.5a — `docs/game-loop.md`**

**Find:**

```
  ├── gameDt = dt * speed * slowMo                   ← up to 6.5x from the Accelerator perk
```

**Replace with:**

```
  ├── gameDt = dt * speed * slowMo                   ← up to 4.5x from the Accelerator perk
```

Then, in the same file, **find:**

```
`ceil(gameDt / FIXED_STEP)` substeps, clamped to `MAX_SUBSTEPS` (6). At 1x
speed that is one step and the loop is unchanged; at 6.5x it is six. When the
```

**Replace with:**

```
`ceil(gameDt / FIXED_STEP)` substeps, clamped to `MAX_SUBSTEPS` (6). At 1x
speed that is one step and the loop is unchanged; at 4.5x it is five. When the
```

Then **find** (further down the same file):

```
  simulation-time quantity; a 2 s window on the wall clock would be 0.3 s at 6.5x
```

**Replace with:**

```
  simulation-time quantity; a 2 s window on the wall clock would be 0.44 s at 4.5x
```

Then **find:**

```
- the **charged-shot hold and cooldown** (§4.2) — 1.2 s of holding still, and a
  4 s cooldown that must not become 0.6 s the moment the Accelerator unlocks;
```

**Replace with:**

```
- the **charged-shot hold and cooldown** (§4.2) — 1.2 s of holding still, and a
  4 s cooldown that must not become 0.9 s the moment the Accelerator unlocks;
```

**1.5b — `docs/prestige-system.md`**

**Find:**

```
Thirteen perks in four tiers (revamp §8). The old tree let one first
```

**Replace with:**

```
Twenty-three perks in four tiers (revamp §8, widened by prestige-abs §3.1 —
the table below lists the original thirteen; `AP_PERKS` in
`src/data/prestige.ts` is the source of truth for the full set). The old tree
let one first
```

**1.5c — `AGENTS.md`**

**Find:**

```
| AP perks / TP perks | 13 / 18 | `src/data/prestige.ts` |
```

**Replace with:**

```
| AP perks / TP perks | 23 / 18 | `src/data/prestige.ts` |
```

**1.5d — `docs/blessing-system.md`**

**Find:**

```
| Lifetime AP | Wall (no blessings) | Wall (blessings) | Picks | Run power |
|---:|---:|---:|---:|---:|
| 0 | 39 | 53.3 | 13.3 | 1.73× |
| 100 | 59 | 71.9 | 17.9 | 2.11× |
| 1 K | 89 | 104.7 | 26.1 | 2.87× |
| 10 K | 129 | 147.6 | 30.0 | 3.63× |
| 100 K | 169 | 184.7 | 30.0 | 3.43× |
```

**Replace with:**

```
| Lifetime AP | Wall (no blessings) | Wall (blessings) | Picks | Run power |
|---:|---:|---:|---:|---:|
| 0 | 28 | 79.1 | 18.3 | 1.51× |
| 100 | 109 | 146.3 | 30.0 | 4.35× |
| 1 K | 145 | 175.0 | 30.0 | 4.22× |
| 10 K | 189 | 219.4 | 30.0 | 4.34× |
| 100 K | 239 | 266.7 | 30.0 | 4.22× |

> Re-measured on the current tree with `npm run sim`. The previous table
> (39/59/89/129/169) predated the pacing, contract and prestige-shelf work and
> was three rebalances stale. The **picks** column saturating at 30.0 from the
> 100-AP tier up is the `BLESSING_MAX_PICKS` ceiling binding — see
> progress.md §1.5.
```

**1.5e — `docs/core-system.md`**

**Find:**

```
Worst deviation −5.7%, comfortably inside the band.
```

**Replace with:**

```
> **Stale.** Re-run on the current tree, `npm run sim` prints `OUT OF BAND`
> twice: `bloodforge` at −27.5% idle / −26.0% drafting, and `frostwork` at
> +15.9% drafting. Both tables above predate the pacing, contract and
> prestige-shelf work. The band is still the design rule; the measurement no
> longer meets it, and re-tuning those two cores is tracked as its own task
> (progress.md §8.2) rather than silently re-stating the band.
```

**Verify Phase 1:**

```bash
npm run typecheck && npm test && npm run checks
```

Then:

```bash
npm run sim > .balance-baseline/sim-phase1.txt 2>&1 && diff .balance-baseline/sim-before.txt .balance-baseline/sim-phase1.txt
```

**Expected:** the diff is **empty**. Phase 1 touches no balance input.

---

## Phase 2 — The measurement that is missing

Every table in `sim/balance.ts` measures **one run at a fixed AP tier**.
Nothing measures the *ladder* — run 1 feeding run 2 feeding run 3 — which is
why a game that stops progressing at run 9 ships with every check green
(progress.md §1.1). Build the measurement before changing anything it measures.

### Step 2.1 — Create `sim/ladder.ts`

**File:** `sim/ladder.ts` (new file, complete contents)

```ts
/**
 * The prestige ladder (plans/progress.md §1.1, §9).
 *
 * Every other table in `sim/` measures **one run at a fixed lifetime-AP tier**.
 * That is the right shape for "is this core balanced against that one", and the
 * wrong shape for the only question the long game asks: *does the next run get
 * further than this one?* This file answers that by feeding each run's banked
 * AP into the next run's multipliers, exactly the way the game does.
 *
 * Read the `dWall` column. A healthy ladder advances a roughly constant number
 * of waves per run. A ladder that decays to `+0` has a fixed point, and the
 * game ends there whatever the tables say.
 */
import { simulateRun, waveProfile } from './model.ts';
import { lifetimeAPDamageBonus, lifetimeAPGoldBonus } from '../src/data/formulas.ts';
import { ASCENSION_UNLOCK_WAVE, apForWave, tpForAP } from '../src/data/prestige.ts';

/** How many ascensions the report walks. */
const LADDER_RUNS = 16;

/** Seed for the blessing draft, so the report is reproducible run to run. */
const LADDER_SEED = 0x5eed;

/**
 * Speed ceiling a player can reach, used for the wall-clock column.
 * 1.5x base + 6 Accelerator levels at +0.5x each (see `SPEED_STEP`).
 */
const MAX_PLAYER_SPEED = 4.5;

/** Design target T1: waves the wall must advance per run, at every depth. */
const TARGET_DELTA_MIN = 8;

/** Design target T3: wall-clock minutes a run may cost at the speed ceiling. */
const TARGET_RUN_MINUTES = 45;

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + ' T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + ' B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + ' K';
  return n.toFixed(0);
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)),
  );
  const line = (cells: string[]) =>
    '| ' + cells.map((c, i) => (c ?? '').padStart(widths[i])).join(' | ') + ' |';
  const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

export interface LadderRow {
  run: number;
  lifetimeAPBefore: number;
  wall: number;
  deltaWall: number;
  runSeconds: number;
  apBanked: number;
  tpIfTranscend: number;
  /** T4: share of the run's seconds spent on waves the tower can actually lose. */
  atRiskTimeShare: number;
}

/**
 * Walk the ladder. `blessings` mirrors `simulateRun`'s option — the drafting
 * ladder is the one a player actually plays, the un-drafted one is the
 * regression fence, so the report prints both.
 */
export function runLadder(blessings: boolean, runs = LADDER_RUNS): LadderRow[] {
  const out: LadderRow[] = [];
  let lifetimeAP = 0;
  let previousWall = 0;
  for (let run = 1; run <= runs; run++) {
    const before = lifetimeAP;
    // Every wave sampled, so the at-risk share below has per-wave resolution.
    const sampleWaves = Array.from({ length: 3000 }, (_, i) => i + 1);
    const r = simulateRun({
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
      sampleWaves,
      blessings,
      maxWave: 3000,
      seed: LADDER_SEED,
    });
    const banked = apForWave(r.wallWave);
    lifetimeAP += banked;

    // T4: a wave is "at risk" when the tower's kill time exceeds the time the
    // portal needs to emit the roster. Below that line the wave's length is a
    // spawn queue and the tower is never in danger, however deep it is.
    let atRisk = 0;
    let previousElapsed = 0;
    for (let w = 1; w <= r.wallWave; w++) {
      const s = r.samples.get(w);
      if (!s) continue;
      const dt = s.elapsedSec - previousElapsed;
      previousElapsed = s.elapsedSec;
      if (s.clearSec > waveProfile(w).spawnDuration + 3) atRisk += dt;
    }

    out.push({
      run,
      lifetimeAPBefore: before,
      wall: r.wallWave,
      deltaWall: r.wallWave - previousWall,
      runSeconds: r.durationSec,
      apBanked: banked,
      tpIfTranscend: tpForAP(lifetimeAP),
      atRiskTimeShare: r.durationSec > 0 ? atRisk / r.durationSec : 0,
    });
    previousWall = r.wallWave;
  }
  return out;
}

export function ladderTable(blessings: boolean): string {
  const rows = runLadder(blessings).map(r => [
    String(r.run),
    fmt(r.lifetimeAPBefore),
    String(r.wall),
    (r.deltaWall >= 0 ? '+' : '') + r.deltaWall,
    (r.runSeconds / 3600).toFixed(1) + ' h',
    (r.runSeconds / 60 / MAX_PLAYER_SPEED).toFixed(0) + ' min',
    fmt(r.apBanked),
    fmt(r.tpIfTranscend),
    (r.atRiskTimeShare * 100).toFixed(0) + '%',
  ]);
  return table(
    ['run', 'lifetime AP', 'wall', 'dWall', 'run len', `at ${MAX_PLAYER_SPEED}x`, 'AP banked', 'TP', 'at-risk time'],
    rows,
  );
}

/** The T1–T4 verdicts, so the report says whether it passed rather than only what it measured. */
export function ladderVerdict(blessings: boolean): string {
  const rows = runLadder(blessings);
  const late = rows.slice(4); // runs 5+ — the first four are the opening, not the horizon
  const worstDelta = Math.min(...late.map(r => r.deltaWall));
  const worstMinutes = Math.max(...rows.map(r => r.runSeconds / 60 / MAX_PLAYER_SPEED));
  const worstAtRisk = Math.min(...late.map(r => r.atRiskTimeShare));
  const lines = [
    `T1  wall advances >= ${TARGET_DELTA_MIN}/run from run 5: worst +${worstDelta} — ${worstDelta >= TARGET_DELTA_MIN ? 'ok' : 'FAIL'}`,
    `T2  wave 450 reached by run 30: ${rows.some(r => r.wall >= 450) ? 'run ' + rows.find(r => r.wall >= 450)!.run : 'never'} — ${rows.some(r => r.wall >= 450) ? 'ok' : 'FAIL'}`,
    `T3  run <= ${TARGET_RUN_MINUTES} min at ${MAX_PLAYER_SPEED}x: worst ${worstMinutes.toFixed(0)} min — ${worstMinutes <= TARGET_RUN_MINUTES ? 'ok' : 'FAIL'}`,
    `T4  >= 50% of run minutes at risk: worst ${(worstAtRisk * 100).toFixed(0)}% — ${worstAtRisk >= 0.5 ? 'ok' : 'FAIL'}`,
  ];
  return lines.join('\n');
}
```

**Verify:**

```bash
npx esbuild sim/ladder.ts --bundle --platform=node --format=esm --outfile=node_modules/.tmp/ladder-check.mjs --log-level=warning
```

**Expected:** no output (a clean bundle). This only proves it compiles; step 2.2
runs it.

### Step 2.2 — Print the ladder from `npm run sim`

**File:** `sim/balance.ts`

At the top of the file, after the existing imports, **add**:

```ts
import { ladderTable, ladderVerdict } from './ladder.ts';
```

At the **very end** of the file, after the existing last line
(``console.log(`\nAscension unlocks at wave ${ASCENSION_UNLOCK_WAVE}.\n`);``),
**append**:

```ts
console.log('\n=== progress.md §1.1 The prestige ladder (idle, no blessings) ===\n');
console.log(ladderTable(false));
console.log('\n=== progress.md §1.1 The prestige ladder (drafting) ===\n');
console.log(ladderTable(true));
console.log(
  '\nEach row is one ascension: the AP it banks is the next row\'s multiplier, which is '
  + 'the\nonly thing every other table in this file cannot see. `dWall` decaying to +0 means '
  + 'the\nladder has a fixed point — the game stops there however healthy the per-tier tables '
  + 'look.\n',
);
console.log(ladderVerdict(true));
console.log('');
```

**Verify:**

```bash
npm run sim 2>&1 | tail -45
```

**Expected on the current (unchanged) tree** — the drafting ladder decays to
zero and three of the four targets fail. This is the baseline the later phases
fix:

```
| run | lifetime AP | wall | dWall | run len | at 4.5x | AP banked | ... 
|   1 |           0 |   40 |   +40 |   0.9 h |  12 min |        88 | ...
|   2 |          88 |  138 |   +98 |   2.6 h |  35 min |   52.8 K  | ...
|   3 |     52.9 K  |  249 |  +111 |   5.2 h |  69 min |   47.3 M  | ...
|   4 |     47.4 M  |  308 |   +59 |   6.9 h |  92 min |   1.65 B  | ...
|   5 |      1.70 B |  329 |   +21 |   7.5 h | 100 min |   5.81 B  | ...
...
|   9 |     54.4 B  |  349 |    +0 |   8.2 h | 109 min |   19.2 B  | ...
```

and a verdict block reading roughly:

```
T1  wall advances >= 8/run from run 5: worst +0 — FAIL
T2  wave 450 reached by run 30: never — FAIL
T3  run <= 45 min at 4.5x: worst 122 min — FAIL
T4  >= 50% of run minutes at risk: worst 12% — FAIL
```

Exact numbers will differ by a wave or two if the tree has moved; the **shape**
(dWall decaying to 0, T1–T4 failing) is what matters. Record the output:

```bash
npm run sim > .balance-baseline/sim-phase2.txt 2>&1
```

### Step 2.3 — Document the new report

**File:** `docs/testing.md`

Find the section that lists what `npm run sim` prints and append this paragraph
at the end of it (if there is no such section, append the block at the end of
the file):

```markdown
## The ladder report

`sim/ladder.ts`, printed at the end of `npm run sim`, is the only table in the
repo that measures **run N feeding run N+1**. Every other table fixes a
lifetime-AP tier and measures one run inside it, which cannot see whether the
next run gets any further than this one. Read the `dWall` column: a healthy
ladder advances a roughly constant number of waves per ascension. `dWall`
decaying to `+0` means the ladder has a fixed point and the game ends there.

The verdict block under the tables states the four design targets from
`plans/progress.md` §2 (T1 ladder advance, T2 depth reached, T3 run length at
the speed ceiling, T4 share of run minutes the tower is actually at risk) and
whether the current tables meet them.
```

**Verify Phase 2:**

```bash
npm run typecheck && npm test && npm run checks && npm run sim > /dev/null
```

---

## Phase 3 — Uncap the in-run economy

**What is wrong** (progress.md §1.2): with unlimited gold the run still walls at
wave 219, because every purchasable line has a fixed `maxLevel` and the binding
one is `damage.maxLevel = 200` — each level is worth +11% against an enemy HP
curve that grows +11% per wave, so 200 levels *is* 200 waves of headroom and
there is no 201st. Past that point every gold system in the game is inert.

**What this phase does:** the cap stops being a constant and becomes something
the prestige layers buy. One new stat, one shared accessor, two new perks, one
Watch unlock re-pointed.

### Step 3.1 — The shared cap accessor

Three consumers need the effective cap and only one of them has a manager to
inject into: `UpgradeManager` (has one), `UpgradePanel` (reads `def.maxLevel`
straight off the table) and `sim/model.ts` (a pure module). A single shared
module is the smallest change that keeps all three agreeing.

**File:** `src/data/upgradeCaps.ts` (new file, complete contents)

```ts
import type { UpgradeDef } from '../types';

/**
 * The upgrade level ceiling, and the prestige purchases that raise it.
 *
 * ## Why this exists
 *
 * `damage.maxLevel = 200` is worth exactly 200 waves of enemy HP growth
 * (`0.2904 * 1.11^(L-2)` per level against `ENEMY_HP_GROWTH = 1.11`), so it is
 * also the ceiling on what *gold* can ever buy. Measured with `npm run sim`, a
 * run handed an unlimited gold multiplier still walls at wave 219 — and every
 * gold system in the game (Fortune, Tycoon, Golden Age, the combo meter, the
 * risk dial's payout, contract gold, loot orbs, gear sales) is inert past that
 * depth. See `plans/progress.md` §1.2.
 *
 * The fix is not a bigger literal. A literal moves the wall once; a *bought*
 * extension keeps gold live at every depth, because the ceiling now rises with
 * the player rather than with the table.
 *
 * ## Why a fraction, not a flat number
 *
 * Every line's cap is sized against its own curve — `damage` 200 against
 * `1.11`, `critDamage` 50 against a much flatter payout, `pierce` 6 against
 * `3.2^L` costs. A flat "+50 levels" is nothing to `damage` and breaks
 * `pierce`. A fraction preserves the relative shape the tables were tuned with.
 *
 * ## Why only some lines
 *
 * `fireRate` is capped *on purpose* (`src/data/upgrades.ts`: "two compounding
 * DPS axes multiply into a runaway"), and `pierce` / `splash` /
 * `doubleShotChance` / `quickShotChance` are coverage axes whose ceilings are
 * set by the arena's geometry rather than by the economy. Extending those is
 * the runaway the original caps were written to prevent. Only the *scalar*
 * lines below are extended; everything else keeps its table ceiling forever.
 *
 * ## Why module-level state
 *
 * The value is written once per stat recompute by `Game.applyResolvedStats`
 * and read by `UpgradeManager`, `UpgradePanel` and `sim/model.ts`. Threading a
 * new dependency through the panel to deliver one number would be three
 * indirections for a value that is global by nature. `setUpgradeCapExtension`
 * is the only writer; everything else reads through `effectiveMaxLevel`.
 */

/**
 * The upgrade ids the cap extension applies to.
 *
 * A `Set` of ids rather than a flag on `UpgradeDef`, so the exclusion list is
 * legible in one place and a new upgrade is excluded by default — which is the
 * safe direction for a mechanism whose failure mode is a runaway.
 */
export const CAP_EXTENDABLE_UPGRADES: ReadonlySet<string> = new Set([
  'damage',
  'critDamage',
  'health',
  'defense',
  'armor',
  'thorns',
  'lifesteal',
  'goldMulti',
  'waveGold',
  'goldOnKill',
  'manaRegen',
  'xpGain',
]);

/**
 * Hard ceiling on the extension fraction, whatever the perk levels say.
 *
 * 6.0 takes `damage` from 200 to 1400 levels — comfortably past what the gold
 * curve can reach at any depth the ladder reports — and it exists so a future
 * perk re-tune cannot silently produce a level count that overflows the cost
 * formula (`8 * 1.18^L` is ~1e102 at L1400, still finite, and `bigNumber.ts`
 * formats it).
 */
export const MAX_CAP_EXTENSION = 6.0;

let capExtension = 0;

/**
 * Set the live extension fraction. Called once per stat recompute from
 * `Game.applyResolvedStats`; `sim/model.ts` calls it directly when it wants to
 * measure a hypothetical.
 */
export function setUpgradeCapExtension(fraction: number): void {
  if (!Number.isFinite(fraction) || fraction <= 0) {
    capExtension = 0;
    return;
  }
  capExtension = Math.min(MAX_CAP_EXTENSION, fraction);
}

/** The live extension fraction. Read by the panel's copy, never by a formula. */
export function getUpgradeCapExtension(): number {
  return capExtension;
}

/**
 * The level ceiling `def` actually has right now.
 *
 * `maxLevel <= 0` means "no ceiling" in the existing tables and keeps that
 * meaning here — the extension never turns an unbounded line into a bounded
 * one.
 */
export function effectiveMaxLevel(def: Pick<UpgradeDef, 'id' | 'maxLevel'>): number {
  if (def.maxLevel <= 0) return def.maxLevel;
  if (capExtension <= 0) return def.maxLevel;
  if (!CAP_EXTENDABLE_UPGRADES.has(def.id)) return def.maxLevel;
  return def.maxLevel + Math.round(def.maxLevel * capExtension);
}

/** Reset to the un-extended state. Used by tests and by the sim between runs. */
export function resetUpgradeCapExtension(): void {
  capExtension = 0;
}
```

**Verify:**

```bash
npm run typecheck
```

### Step 3.2 — `UpgradeManager` reads the effective cap

**File:** `src/systems/UpgradeManager.ts`

**3.2a — the import.** **Find:**

```ts
import { upgradeCost } from '../data/formulas';
```

**Replace with:**

```ts
import { upgradeCost } from '../data/formulas';
import { effectiveMaxLevel } from '../data/upgradeCaps';
```

**3.2b — `getBulkPlan`.** **Find:**

```ts
    const start = this.levels[id] ?? 0;
    const room = def.maxLevel > 0 ? def.maxLevel - start : MAX_BULK_LEVELS;
    const levels = Math.min(count, room, MAX_BULK_LEVELS);
```

**Replace with:**

```ts
    const start = this.levels[id] ?? 0;
    const cap = effectiveMaxLevel(def);
    const room = cap > 0 ? cap - start : MAX_BULK_LEVELS;
    const levels = Math.min(count, room, MAX_BULK_LEVELS);
```

**3.2c — `getMaxAffordablePlan`.** **Find:**

```ts
    const start = this.levels[id] ?? 0;
    const room = def.maxLevel > 0 ? def.maxLevel - start : MAX_BULK_LEVELS;
    let levels = 0;
```

**Replace with:**

```ts
    const start = this.levels[id] ?? 0;
    const cap = effectiveMaxLevel(def);
    const room = cap > 0 ? cap - start : MAX_BULK_LEVELS;
    let levels = 0;
```

**3.2d — `isMaxed`.** **Find:**

```ts
  isMaxed(id: string): boolean {
    const def = UPGRADE_BY_ID[id];
    if (!def) return true;
    const level = this.levels[id] ?? 0;
    return def.maxLevel > 0 && level >= def.maxLevel;
  }
```

**Replace with:**

```ts
  isMaxed(id: string): boolean {
    const def = UPGRADE_BY_ID[id];
    if (!def) return true;
    const level = this.levels[id] ?? 0;
    const cap = effectiveMaxLevel(def);
    return cap > 0 && level >= cap;
  }
```

**Verify:**

```bash
npm run typecheck && npm test -- systems
```

### Step 3.3 — The panel shows the effective cap

**File:** `src/ui/UpgradePanel.ts`

**3.3a — the import.** Add to the existing import block at the top of the file:

```ts
import { effectiveMaxLevel } from '../data/upgradeCaps';
```

**3.3b —** **Find:**

```ts
      const level = state.upgrades[u.id] ?? 0;
      const atMax = u.maxLevel > 0 && level >= u.maxLevel;
```

**Replace with:**

```ts
      const level = state.upgrades[u.id] ?? 0;
      const cap = effectiveMaxLevel(u);
      const atMax = cap > 0 && level >= cap;
```

**3.3c —** **Find:**

```ts
    if (u.maxLevel > 0 && level >= u.maxLevel) return null;
```

**Replace with:**

```ts
    const cap = effectiveMaxLevel(u);
    if (cap > 0 && level >= cap) return null;
```

**3.3d — the level readout.** Search the file for where the level string is
built for a row (it will contain a template literal with `maxLevel` or with
`level`). If a `/ ${u.maxLevel}` fragment exists anywhere in the file, replace
`u.maxLevel` with `effectiveMaxLevel(u)` in it. If no such fragment exists,
skip this sub-step — the readout does not print the ceiling.

**Verify:**

```bash
npm run typecheck
```

### Step 3.4 — The sim reads the effective cap

**File:** `sim/model.ts`

**Find:**

```ts
  if (def.maxLevel > 0 && level >= def.maxLevel) return Infinity;
```

**Replace with:**

```ts
  const cap = effectiveMaxLevel(def);
  if (cap > 0 && level >= cap) return Infinity;
```

Add the import near the other `src/data` imports at the top of `sim/model.ts`:

```ts
import { effectiveMaxLevel } from '../src/data/upgradeCaps.ts';
```

**Verify:**

```bash
npm run sim > /dev/null && echo ok
```

**Expected:** prints `ok`. The sim's output is unchanged so far, because nothing
sets the extension above 0 yet.

### Step 3.5 — The stat key

**File:** `src/stats/keys.ts`

**3.5a — the union.** **Find:**

```ts
  | 'waveSkipChance'
  | 'intermissionMultiplier'
```

**Replace with:**

```ts
  | 'waveSkipChance'
  /**
   * Fraction added to the level ceiling of every *scalar* tower upgrade
   * (`src/data/upgradeCaps.ts`). 1.0 doubles `damage`'s 200 levels to 400.
   *
   * A stat rather than a manager field because three sources feed it — a TP
   * perk, an AP perk and a Watch unlock — and the accumulator is where sources
   * are supposed to meet. See plans/progress.md §3.
   */
  | 'upgradeCapExtension'
  | 'intermissionMultiplier'
```

**3.5b — the base.** **Find:**

```ts
  waveSkipChance: 0,
  intermissionMultiplier: 1,
```

**Replace with:**

```ts
  waveSkipChance: 0,
  upgradeCapExtension: 0,
  intermissionMultiplier: 1,
```

**3.5c — the clamp.** **Find:**

```ts
  waveSkipChance: { min: 0, max: 1 },
```

**Replace with:**

```ts
  waveSkipChance: { min: 0, max: 1 },
  // Ceiling mirrors `MAX_CAP_EXTENSION`; the clamp is here as well so a
  // contributor cannot write a value the accessor would silently truncate.
  upgradeCapExtension: { min: 0, max: 6 },
```

**Verify:**

```bash
npm run typecheck
```

**Expected:** compiles. If it does not, the missing base or clamp is the cause —
`StatKey` is a closed union and `resolveStats` builds a full `Record`.

### Step 3.6 — The prestige inputs carry it

**File:** `src/stats/context.ts`

**3.6a —** **Find:**

```ts
  /** Second Wind's extra revive charges, as a whole number. */
  apReviveCharges: number;
```

**Replace with:**

```ts
  /** Second Wind's extra revive charges, as a whole number. */
  apReviveCharges: number;
  /** Deep Stores' upgrade-cap extension, as a fraction (0.25 = +25% levels). */
  apUpgradeCapExtension: number;
  /** Foundry's upgrade-cap extension, as a fraction. Sums with the AP one. */
  tpUpgradeCapExtension: number;
```

**3.6b — the empty context.** **Find:**

```ts
      apReviveCharges: 0,
      tpDamage: 1,
```

**Replace with:**

```ts
      apReviveCharges: 0,
      apUpgradeCapExtension: 0,
      tpUpgradeCapExtension: 0,
      tpDamage: 1,
```

**Verify:**

```bash
npm run typecheck
```

**Expected:** errors in `src/game/Game.ts` (the context builder is missing the
two new fields). Step 3.8 fixes them.

### Step 3.7 — The contributor writes it

**File:** `src/stats/contributors/prestige.ts`

**Find:**

```ts
  ap.add('reviveCharges', p.apReviveCharges);
```

**Replace with:**

```ts
  ap.add('reviveCharges', p.apReviveCharges);
  // The two prestige layers and the Watch unlock all add into one fraction
  // (progress.md §3.1) rather than each holding its own ceiling — a ceiling per
  // source is how two of them end up multiplying by accident.
  ap.add('upgradeCapExtension', p.apUpgradeCapExtension);
  tp.add('upgradeCapExtension', p.tpUpgradeCapExtension);
```

### Step 3.8 — `Game` fills and applies it

**File:** `src/game/Game.ts`

**3.8a — the context.** **Find:**

```ts
        apReviveCharges: this.prestigeMgr.getAPReviveCharges(),
```

**Replace with:**

```ts
        apReviveCharges: this.prestigeMgr.getAPReviveCharges(),
        apUpgradeCapExtension: this.prestigeMgr.getAPUpgradeCapExtension(),
        tpUpgradeCapExtension: this.prestigeMgr.getTPUpgradeCapExtension(),
```

**3.8b — applying it.** **Find:**

```ts
    this.upgradeMgr.setCostDiscount(stats.upgradeCostDiscount);
```

**Replace with:**

```ts
    this.upgradeMgr.setCostDiscount(stats.upgradeCostDiscount);
    // The cap extension is module state rather than a manager field because
    // `UpgradePanel` and `sim/model.ts` read it too — see the header of
    // `src/data/upgradeCaps.ts`. The Watch's `deep_stores` unlock is added here
    // rather than in the stat contributor for the same reason `deep_reserves`
    // is applied here: `WatchManager` is not part of the `StatContext`.
    setUpgradeCapExtension(
      stats.upgradeCapExtension + (this.watchMgr.has('deep_stores') ? WATCH_CAP_EXTENSION : 0),
    );
```

**3.8c — the imports.** Add to the top of `src/game/Game.ts`:

```ts
import { setUpgradeCapExtension } from '../data/upgradeCaps';
```

and add `WATCH_CAP_EXTENSION` to the existing `../data/watch` import (it is
defined in step 3.11).

**Verify:** deferred to step 3.11 — the manager methods and the constant do not
exist yet.

### Step 3.9 — The two `PrestigeManager` getters

**File:** `src/systems/PrestigeManager.ts`

**Find:**

```ts
  getAPRpDropBonus(): number {
    let total = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'rp_drop') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) total += computePerkEffect(p, lvl);
    }
    return total;
  }
```

**Replace with:**

```ts
  getAPRpDropBonus(): number {
    let total = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'rp_drop') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) total += computePerkEffect(p, lvl);
    }
    return total;
  }

  /**
   * Deep Stores: fraction added to every scalar upgrade's level ceiling.
   *
   * Split from the TP getter below rather than summed here, because the two
   * layers reach the accumulator through different sources (`ap` and `tp`) and
   * the stats breakdown has to be able to say which one paid for the ceiling.
   */
  getAPUpgradeCapExtension(): number {
    let total = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'upgrade_cap') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) total += computePerkEffect(p, lvl);
    }
    return total;
  }

  /** Foundry: the transcendence half of the same fraction. */
  getTPUpgradeCapExtension(): number {
    let total = 0;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'upgrade_cap') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) total += computePerkEffect(p, lvl);
    }
    return total;
  }
```

### Step 3.10 — The two perks

**File:** `src/data/prestige.ts`

**3.10a — the effect union.** **Find:**

```ts
  | 'upgrade_cost'
```

**Replace with:**

```ts
  | 'upgrade_cost'
  /**
   * Fraction added to every scalar upgrade's level ceiling (progress.md §3).
   * Sold by one AP perk and one TP perk; both sum into `upgradeCapExtension`.
   */
  | 'upgrade_cap'
```

**3.10b — the AP perk.** **Find** (the closing of the AP table — the Tycoon perk
followed by the array's `];`):

```ts
    tier: 4,
    prerequisites: [{ perkId: 'ap_fortune', minLevel: 10 }],
    exclusive: ['ap_warlord'],
  },
];
```

**Replace with:**

```ts
    tier: 4,
    prerequisites: [{ perkId: 'ap_fortune', minLevel: 10 }],
    exclusive: ['ap_warlord'],
  },
  {
    id: 'ap_deep_stores',
    layer: 'ascension',
    name: 'Deep Stores',
    description: '+25% to every scalar upgrade\'s level cap, per level',
    /*
     * progress.md §3. The first AP node that is not decoration at depth.
     *
     * Every other AP damage node adds into the same bracket as
     * `lifetimeAPDamageBonus`, which is `0.02 * AP^0.7` — at 1e5 lifetime AP
     * that bracket reads `1 + 63.2 + 0.88`, so the whole chosen tree is 1.4% of
     * it. This node does not add to a bracket at all: it raises the ceiling on
     * what *gold* can buy, which is the one channel the automatic term cannot
     * reach. Measured with `npm run sim`, an unlimited gold multiplier walls at
     * wave 219 against the stock caps and 419 with `damage` alone at 2 000
     * levels.
     *
     * 300 x 2.0^L is 300 / 600 / 1 200 / 2 400 = 4 500 AP for the ladder —
     * roughly a third of the whole pre-existing bounded tree (24 144 AP), and
     * affordable from the second ascension on, which is the depth the ceiling
     * first starts to bind at.
     */
    costPerLevel: 300,
    costScaling: 2.0,
    maxLevel: 4,
    effectType: 'upgrade_cap',
    effectPerLevel: 0.25,
    icon: 'knapsack',
    color: '#e8a93b',
    tier: 4,
    prerequisites: [{ perkId: 'ap_might', minLevel: 5 }],
  },
];
```

**3.10c — the TP perk.** **Find:**

```ts
  {
    id: 'tp_salvage',
```

**Replace with:**

```ts
  {
    id: 'tp_foundry',
    layer: 'transcendence',
    name: 'Foundry',
    description: '+50% to every scalar upgrade\'s level cap, per level',
    /*
     * progress.md §3. The transcendence half of the ceiling, and the larger
     * half: TP is the one currency in the game whose supply is not outrun by
     * its tree (`4 * AP^0.4` against a 33 568 TP tree), so it is the right
     * place to sell the thing that has to keep being bought.
     *
     * 12 x 1.55^L is 12 / 18 / 28 / 44 / 69 / 107 / 166 / 258 = 702 TP for all
     * eight levels — about two mid-ladder transcendences.
     */
    costPerLevel: 12,
    costScaling: 1.55,
    maxLevel: 8,
    effectType: 'upgrade_cap',
    effectPerLevel: 0.5,
    icon: 'anvil-impact',
    color: '#e8a93b',
    branch: 'fortune',
    tier: 3,
    prerequisites: [{ perkId: 'tp_head_start', minLevel: 3 }],
  },
  {
    id: 'tp_salvage',
```

> **If `anvil-impact` is not a valid `IconId`**, `npm run typecheck` will say
> so. Use `'hammer-nails'` instead — it is in the committed sprite and unused.

**3.10d — the AP panel copy.** **File:** `src/data/prestige.ts`, inside
`describeAPPerkBonus`. **Find:**

```ts
    case 'orb_magnet':
      return 'Loot orbs home to the tower at full value';
```

**Replace with:**

```ts
    case 'orb_magnet':
      return 'Loot orbs home to the tower at full value';
    case 'upgrade_cap':
      return level > 0
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% upgrade level caps`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% upgrade level caps per level`;
```

**3.10e — the TP panel copy.** **File:** `src/ui/TranscendencePanel.ts`.
**Find:**

```ts
    } else if (p.effectType === 'auto_buy_speed') {
      setText(bonusEl, level > 0
        ? `-${level}s interval`
        : '-1s per level');
    } else {
```

**Replace with:**

```ts
    } else if (p.effectType === 'auto_buy_speed') {
      setText(bonusEl, level > 0
        ? `-${level}s interval`
        : '-1s per level');
    } else if (p.effectType === 'upgrade_cap') {
      setText(bonusEl, level > 0
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% level caps`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% per level`);
    } else {
```

### Step 3.11 — Re-point one Watch unlock

`deep_reserves` (chapter 19's unlock, "-20% ability mana cost") is a small
number on a system that is already served by three other sources. Chapter 13
currently grants `archivist`. Add a **new** unlock rather than replacing one, so
no existing save loses a reward.

**File:** `src/data/watch.ts`

**3.11a — the id union.** Find the `WatchUnlockId` union (it lists every unlock
id) and add `deep_stores` to it, following the existing formatting.

**3.11b — the catalogue.** **Find:**

```ts
  undying_watch: {
    id: 'undying_watch', name: 'The Undying Watch', icon: 'hourglass',
    description: 'Offline progress banks twelve more hours.',
  },
};
```

**Replace with:**

```ts
  undying_watch: {
    id: 'undying_watch', name: 'The Undying Watch', icon: 'hourglass',
    description: 'Offline progress banks twelve more hours.',
  },
  deep_stores: {
    id: 'deep_stores', name: 'Deep Stores', icon: 'knapsack',
    description: 'Every scalar upgrade may be levelled 50% further.',
  },
};

/**
 * The `deep_stores` unlock's contribution to `upgradeCapExtension`
 * (progress.md §3.1).
 *
 * A constant rather than a literal at the call site, because the number is
 * quoted in the unlock's own copy above and in `Game.applyResolvedStats`, and
 * those two must not be able to drift.
 */
export const WATCH_CAP_EXTENSION = 0.5;
```

**3.11c — the consumers map.** **Find:**

```ts
  undying_watch: 'Game getIdleCapSeconds closure — adds 12h to PrestigeManager.getIdleTimeCapSeconds()',
};
```

**Replace with:**

```ts
  undying_watch: 'Game getIdleCapSeconds closure — adds 12h to PrestigeManager.getIdleTimeCapSeconds()',
  deep_stores: 'Game.applyResolvedStats — adds WATCH_CAP_EXTENSION to the fraction passed to setUpgradeCapExtension',
};
```

**3.11d — a twenty-first chapter to grant it.** All twenty existing chapters
already grant a unique unlock (`board_expansion` through `undying_watch`), so
`deep_stores` needs a new one rather than displacing an existing reward. This
also extends the campaign past the tail Phase 7 stretches to, which is where the
Phase 4 ladder is still moving.

**File:** `src/data/watch.ts`. **Find** the end of the `WATCH_CHAPTERS` array:

```ts
  {
    id: 'wc_last_watch', number: 20, name: 'The Last Watch',
    flavour: 'There is no last watch. That is the whole of what you have learned.',
    icon: 'star-swirl', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 450 },
      { kind: 'transcendences', count: 50 },
      { kind: 'risk_waves', risk: 6, count: 500 },
    ],
    reward: 'undying_watch',
  },
];
```

**Replace with:**

```ts
  {
    id: 'wc_last_watch', number: 20, name: 'The Last Watch',
    flavour: 'There is no last watch. That is the whole of what you have learned.',
    icon: 'star-swirl', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 450 },
      { kind: 'transcendences', count: 50 },
      { kind: 'risk_waves', risk: 6, count: 500 },
    ],
    reward: 'undying_watch',
  },
  {
    // plans/progress.md §3.1. A twenty-first chapter, because all twenty
    // existing ones already grant a unique unlock and displacing one of those
    // would take a reward off a save that had earned it. Its depth gate sits
    // past chapter 20's, which is also where the re-priced AP ladder is still
    // advancing (§4.1) — the campaign should end at the frontier, not behind it.
    id: 'wc_deep_stores', number: 21, name: 'Deep Stores',
    flavour: 'You stopped counting what the vault could hold and started counting what it could not.',
    icon: 'knapsack', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 620 },
      { kind: 'ascensions', count: 60 },
      { kind: 'upgrades_bought', count: 100_000 },
    ],
    reward: 'deep_stores',
  },
];
```

> The `goals` array (not `objectives`) and the `number` field are both part of
> the shape — copy the literal exactly. Chapter 20's `wave: 450` becomes 560 in
> Phase 7; do that phase's edit afterwards and this chapter's 620 still sits
> past it.

**3.11e — the chapter count.** Anything that asserts "twenty chapters" now has
to say twenty-one:

```bash
grep -rn "twenty chapters\|20 chapters\|WATCH_CHAPTERS.length" src/ tests/ docs/ AGENTS.md
```

Update every hit. In `AGENTS.md`'s content table that is the `Watch chapters`
and `Watch unlocks` rows, both 20 → 21.

**Verify Phase 3:**

```bash
npm run typecheck && npm test && npm run checks
```

Then measure:

```bash
npm run sim > .balance-baseline/sim-phase3.txt 2>&1 && tail -45 .balance-baseline/sim-phase3.txt
```

**Expected:** the ladder and the §2.2 wall table are **unchanged** from Phase 2.
The sim's greedy buyer never buys the perks, so the extension is still 0. This
phase's effect is measured in Phase 4, where the ladder finally has the AP to
spend. If any wall wave moved, a `maxLevel` read was missed — re-check steps
3.2–3.4.

### Step 3.12 — Prove the mechanism with a test

**File:** `tests/prestige-ap.test.ts`

Append at the end of the file:

```ts
describe('upgrade cap extension (progress.md §3)', () => {
  beforeEach(() => resetUpgradeCapExtension());
  afterEach(() => resetUpgradeCapExtension());

  it('leaves every cap alone at extension 0', () => {
    for (const u of UPGRADES) {
      expect(effectiveMaxLevel(u), u.id).toBe(u.maxLevel);
    }
  });

  it('extends only the scalar lines', () => {
    setUpgradeCapExtension(1.0);
    expect(effectiveMaxLevel(UPGRADE_BY_ID.damage)).toBe(400);
    expect(effectiveMaxLevel(UPGRADE_BY_ID.health)).toBe(400);
    // Coverage and cadence axes keep their table ceiling forever — extending
    // them is the runaway the original caps were written to prevent.
    expect(effectiveMaxLevel(UPGRADE_BY_ID.fireRate)).toBe(45);
    expect(effectiveMaxLevel(UPGRADE_BY_ID.pierce)).toBe(6);
    expect(effectiveMaxLevel(UPGRADE_BY_ID.splash)).toBe(25);
  });

  it('clamps at MAX_CAP_EXTENSION', () => {
    setUpgradeCapExtension(999);
    expect(effectiveMaxLevel(UPGRADE_BY_ID.damage)).toBe(200 + 200 * MAX_CAP_EXTENSION);
  });

  it('sums the three sources into one fraction', () => {
    // Deep Stores 4 (+1.0) + Foundry 8 (+4.0) + the Watch unlock (+0.5) = 5.5
    const ap = computePerkEffect(AP_PERK_BY_ID.ap_deep_stores, 4);
    const tp = computePerkEffect(TP_PERK_BY_ID.tp_foundry, 8);
    expect(ap).toBeCloseTo(1.0, 6);
    expect(tp).toBeCloseTo(4.0, 6);
    expect(ap + tp + WATCH_CAP_EXTENSION).toBeCloseTo(5.5, 6);
  });
});
```

Add the imports it needs at the top of `tests/prestige-ap.test.ts`:

```ts
import { UPGRADES, UPGRADE_BY_ID } from '../src/data/upgrades';
import {
  effectiveMaxLevel,
  setUpgradeCapExtension,
  resetUpgradeCapExtension,
  MAX_CAP_EXTENSION,
} from '../src/data/upgradeCaps';
import { WATCH_CAP_EXTENSION } from '../src/data/watch';
```

and add `TP_PERK_BY_ID` and `computePerkEffect` to the existing
`../src/data/prestige` import if they are not already there.

**Verify:**

```bash
npm test -- prestige-ap
```

---

## Phase 4 — Make the ladder linear

**What is wrong** (progress.md §1.1): `apForWave` grows at `1.06^depth`, so the
second and third ascensions are worth a thousandfold and the whole designed
content is spent in four runs — after which the ladder sits at a fixed point and
advances 0–10 waves per run forever.

**What this phase does:** one exponent, 1.06 → 1.03. Phase 3's raised ceiling is
what carries the depth the lost exponent used to.

### Step 4.1 — The exponent

**File:** `src/data/prestige.ts`

**Find:**

```ts
/**
 * AP banked for ascending at a given wave.
 *
 * The old shape (`20 + 1.13^(w-30) * sqrt(w-30)`) was tuned for a wall around
 * wave 37. With the flatter HP curve of §2.3.1 the wall sits far deeper, and
 * `1.13^depth` turned a first run into thousands of AP — enough to skip the
 * entire ascension layer. The gentler `1.06^depth` keeps a 20-wave-deeper run
 * worth ~3x as much AP, which is roughly what it costs to get there.
 */
export function apForWave(waveNumber: number): number {
  if (waveNumber < ASCENSION_UNLOCK_WAVE) return 0;
  const depth = waveNumber - ASCENSION_UNLOCK_WAVE;
  return Math.max(0, 15 + Math.floor(5 * Math.pow(1.06, depth) * Math.sqrt(depth + 1)));
}
```

**Replace with:**

```ts
/**
 * Growth of banked AP per wave of depth.
 *
 * ## Why 1.03 and not 1.06
 *
 * The exponent is the single dial for "how long is the game", and 1.06 set it
 * to *four runs*. Measured with `npm run sim`'s ladder report
 * (plans/progress.md §1.1): a run at the wall banked between 85x and 250x the
 * player's entire lifetime AP, so runs 2, 3 and 4 advanced the wall +98, +111
 * and +59 waves — and then the ladder hit its fixed point and advanced +0.
 *
 * The fixed point is arithmetic, not bad luck. A run at wall `W` banks
 * `1.06^W`; lifetime AP converts to damage at `A^0.7`, so damage grows at
 * `1.06^(0.7W) = 1.0415^W` against enemy HP at `1.11^W`. Each run therefore
 * returns 0.39 of the depth it launched from, plus whatever the in-run economy
 * carries on its own — and `W* = c / 0.61` is where that converges.
 *
 * At 1.03 the ladder advances +120, +90, +79, +50, +40, +30, +20, +20, +10 …
 * and is still moving at run 16. It reaches wave 450 — the Long Watch's last
 * depth gate — around run 7-8 instead of never.
 *
 * Two things this deliberately does **not** do. It does not touch
 * `lifetimeAPDamageBonus`'s 0.7 exponent: raising that to 0.9 fixes the ladder
 * by making runs 55 hours long, and re-creates the "one automatic number is the
 * whole game" problem §1.6 describes. And it does not re-price a single perk —
 * runs 1-3 barely move (run 3 still banks 72 K AP against a 24 K tree), and
 * what keeps AP live *after* that is `ap_deep_stores` and the endless nodes,
 * not a cheaper tree.
 */
export const AP_DEPTH_GROWTH = 1.03;

/**
 * AP banked for ascending at a given wave.
 *
 * The old shape (`20 + 1.13^(w-30) * sqrt(w-30)`) was tuned for a wall around
 * wave 37. With the flatter HP curve of §2.3.1 the wall sits far deeper, and
 * `1.13^depth` turned a first run into thousands of AP — enough to skip the
 * entire ascension layer. See `AP_DEPTH_GROWTH` for why the exponent is what
 * it is now.
 */
export function apForWave(waveNumber: number): number {
  if (waveNumber < ASCENSION_UNLOCK_WAVE) return 0;
  const depth = waveNumber - ASCENSION_UNLOCK_WAVE;
  return Math.max(0, 15 + Math.floor(5 * Math.pow(AP_DEPTH_GROWTH, depth) * Math.sqrt(depth + 1)));
}
```

### Step 4.2 — Update the pinned snapshot

**File:** `tests/formulas.test.ts`

**Find:**

```ts
  it('pays AP that compounds with depth', () => {
    expect([20, 30, 60, 100].map(apForWave)).toMatchInlineSnapshot(`
      [
        20,
        44,
        344,
        4775,
      ]
    `);
  });
```

**Replace with:**

```ts
  /**
   * progress.md §4: the exponent moved 1.06 -> 1.03 because at 1.06 a run at
   * the wall banked ~250x the player's entire lifetime AP, which spent the
   * whole designed content in four ascensions and then stalled.
   */
  it('pays AP that compounds with depth', () => {
    expect([20, 30, 60, 100].map(apForWave)).toMatchInlineSnapshot(`
      [
        20,
        37,
        119,
        493,
      ]
    `);
  });
```

**Verify:**

```bash
npm test -- formulas
```

**Expected:** passes. If the snapshot mismatches, the numbers printed by vitest
are authoritative — write those in, and report the difference.

### Step 4.3 — Check the other AP assertions

```bash
npm test 2>&1 | tail -40
```

Any failure that quotes an AP number is expected here. Fix each by replacing the
old literal with the value vitest reports, and add a one-line comment above it
reading `// progress.md §4: AP_DEPTH_GROWTH 1.06 -> 1.03.` Do **not** change any
assertion that is about *shape* (monotonic, zero below the unlock wave, first
ascension floor) — those must still pass unchanged, and if one of them fails,
stop and report.

### Step 4.4 — Measure

```bash
npm run sim > .balance-baseline/sim-phase4.txt 2>&1 && tail -45 .balance-baseline/sim-phase4.txt
```

**Expected — the drafting ladder now looks like this** (±2 waves per row; the
run-length column is still bad, which Phase 5 and Phase 6 fix):

| run | wall | dWall |
|---:|---:|---:|
| 1 | 40 | +40 |
| 2 | ~160 | +120 |
| 3 | ~250 | +90 |
| 4 | ~329 | +79 |
| 5 | ~379 | +50 |
| 6 | ~419 | +40 |
| 7 | ~449 | +30 |
| 8 | ~469 | +20 |
| 10 | ~499 | +10 |
| 16 | ~549 | +10 |

and the verdict block should now read `T1 ... ok` and `T2 ... ok`, with T3 and
T4 still failing.

**If the ladder still decays to +0 by run 8**, the Phase 3 cap extension is not
reaching the sim. The sim's greedy buyer does not buy perks, so add this line at
the top of `sim/ladder.ts`'s `runLadder` (inside the `for` loop, before
`simulateRun`) and re-run:

```ts
    // The ladder's player buys the ceiling as soon as they can afford it; the
    // greedy buyer only prices *gold* purchases, so the perk has to be modelled
    // here. 4 500 AP is `ap_deep_stores` maxed, 702 TP is `tp_foundry` maxed.
    setUpgradeCapExtension(
      (lifetimeAP >= 4500 ? 1.0 : 0) + (tpForAP(lifetimeAP) >= 702 ? 4.0 : 0),
    );
```

with the import `import { setUpgradeCapExtension } from '../src/data/upgradeCaps.ts';`
at the top of the file. This is a modelling addition, not a gameplay change.

**Verify Phase 4:**

```bash
npm run typecheck && npm test && npm run checks
```

---

## Phase 5 — Bound the wave, unbound the depth

**What is wrong** (progress.md §1.3): a wave cannot finish before its roster has
spawned, and the roster is `5 + 1.2(w − 1)` bodies at a floor of 0.4 s each —
linear in depth. From wave 51 to the wall the measured clear time *is* that
spawn floor, so the tower's DPS is irrelevant for hundreds of consecutive waves
and total run time grows quadratically: 9.1 h of simulation at wall 359.

**What this phase does:** the roster spawns inside a fixed window instead of at
a fixed interval, and the body count is capped with the removed bodies' HP,
gold and XP handed to the survivors so no wave total moves.

### The invariant this phase must not break

The enrage fuse — `expectedWaveSeconds` — is the wall condition. It is computed
from the **nominal** cadence and the **natural** (uncapped) body count, so it
comes out bit-identical to today at every wave. Only the *real* spawn cadence
and the *real* body count change. A wave that used to spawn over 173 s now
spawns over 24 s and still has the same 193 s budget to be cleared in, which is
why this phase can only move the wall *deeper*, never shallower.

If you find yourself changing `TARGET_WAVE_KILL_SECONDS` or
`TARGET_BOSS_KILL_SECONDS`, stop — you are about to re-tune the wall, which is
not this phase's job.

### Step 5.1 — The formulas

**File:** `src/data/formulas.ts`

**5.1a — the body count.** **Find:**

```ts
export function enemyCountForWave(wave: number): number {
  return 5 + Math.floor((wave - 1) * 1.2);
}
```

**Replace with:**

```ts
/**
 * Bodies a wave would field if nothing capped it.
 *
 * Kept separate from `enemyCountForWave` because two different questions are
 * being asked of the same curve. The *enrage budget* asks "how much wave is
 * this?", and the answer has to keep growing with depth or the fuse shortens
 * as the roster caps. The *spawner* asks "how many things do I put on the
 * field?", and past a point that answer has to stop growing or the renderer,
 * the spatial grid and the projectile pool all pay for a crowd nobody can read.
 */
export function naturalEnemyCountForWave(wave: number): number {
  return 5 + Math.floor((wave - 1) * 1.2);
}

/**
 * The most bodies a non-boss wave will ever put on the field at once.
 *
 * Binds from wave 98. Above it, depth stops arriving as *more things* and
 * starts arriving as *tougher things* — `crowdCompression` hands the cut
 * bodies' HP, gold and XP to the survivors, so no wave total moves and every
 * balance table stays valid (plans/progress.md §5.3).
 *
 * 120 is the renderer's comfortable ceiling at the `high` quality tier. It is a
 * pure performance/feel dial: raising or lowering it changes nothing any
 * balance table measures, because the compression below cancels it exactly.
 */
export const MAX_WAVE_BODIES = 120;

export function enemyCountForWave(wave: number): number {
  return Math.min(MAX_WAVE_BODIES, naturalEnemyCountForWave(wave));
}

/**
 * What each surviving body is worth when the roster is capped.
 *
 * `natural / capped` — 1.00 up to wave 97, 2.03 at wave 200, 4.53 at wave 450.
 * Multiplied into an enemy's **HP, gold and XP** at exactly the sites listed
 * below, so `count x per-body` is unchanged at every depth:
 *
 *   - `EnemyManager.spawn` — hp and gold
 *   - `xpPerKill` / `passiveXpPerKill` — tower and passive XP
 *   - `SaveManager.averageKillGoldForWave` — the offline estimate
 *   - `Game.estimateWaveGold` — the mutator projection
 *   - `sim/model.ts waveProfile` — `totalHp` and `baseGold`
 *
 * Deliberately **not** multiplied into `enemyDamageForWave`. Total incoming
 * chip damage falls with the body count, which is a safety margin the player
 * did not ask for but cannot exploit; compressing it instead would mean a
 * single wave-450 body hitting for 4.5x, which is a new way to die rather than
 * the same wave in fewer pieces.
 *
 * Boss waves return 1: their roster is one boss and an escort sized by
 * `bossEscortCountForWave`, which is small at every depth and never capped.
 */
export function crowdCompression(wave: number): number {
  if (isBossWave(wave)) return 1;
  const natural = naturalEnemyCountForWave(wave);
  const capped = Math.min(MAX_WAVE_BODIES, natural);
  return capped > 0 ? natural / capped : 1;
}
```

**5.1b — the spawn cadence.** **Find:**

```ts
export function spawnCountForWave(wave: number): number {
  if (isBossWave(wave)) return 1 + bossEscortCountForWave(wave);
  return enemyCountForWave(wave);
}

export function spawnIntervalForWave(wave: number): number {
  return Math.max(0.4, 2.0 - wave * 0.04);
}
```

**Replace with:**

```ts
export function spawnCountForWave(wave: number): number {
  if (isBossWave(wave)) return 1 + bossEscortCountForWave(wave);
  return enemyCountForWave(wave);
}

/** `spawnCountForWave` before the body cap — the enrage budget's body count. */
export function naturalSpawnCountForWave(wave: number): number {
  if (isBossWave(wave)) return 1 + bossEscortCountForWave(wave);
  return naturalEnemyCountForWave(wave);
}

/**
 * How long a wave's roster is allowed to take to arrive, in seconds.
 *
 * The spawner used to run at a fixed *interval* with a 0.4 s floor, so the
 * spawn phase grew linearly with the body count — 26 s at wave 51, 97 s at
 * wave 200, 173 s at wave 359 — and `npm run sim` measured the clear time as
 * being *equal to* that floor for three hundred consecutive waves. The tower's
 * damage was irrelevant for the entire middle of every run; the wave took
 * exactly as long as the portal needed to empty (plans/progress.md §1.3).
 *
 * A fixed window instead of a fixed interval makes the spawn phase the same
 * length at every depth, which turns run time from quadratic in depth into
 * linear. Deep waves arrive in tighter clusters, which is a real difficulty
 * increase and a deliberate one — it is also what makes AoE worth casting at
 * depth.
 */
export const SPAWN_WINDOW_SECONDS = 24;

/**
 * Floor on the gap between two spawns. A guard, not a shape: with
 * `MAX_WAVE_BODIES` at 120 the window divides to 0.202 s at its tightest, so
 * this never binds. It exists so lifting the body cap cannot produce a
 * same-frame stampede.
 */
export const MIN_SPAWN_INTERVAL = 0.08;

/**
 * The cadence a wave *actually* spawns at.
 *
 * `count` defaults to the wave's own roster but must be passed when a mutator
 * has changed it — a Swarm wave fields 3x the bodies and still has to fit them
 * in the window.
 *
 * Note this is **not** what `expectedWaveSeconds` uses; see
 * `nominalSpawnIntervalForWave`.
 */
export function spawnIntervalForWave(
  wave: number,
  count: number = spawnCountForWave(wave),
): number {
  const natural = nominalSpawnIntervalForWave(wave);
  if (count <= 1) return natural;
  return Math.max(MIN_SPAWN_INTERVAL, Math.min(natural, SPAWN_WINDOW_SECONDS / (count - 1)));
}

/**
 * The cadence the **enrage budget** is priced from — the pre-window formula,
 * unchanged.
 *
 * The fuse and the spawner deliberately read different numbers. If the fuse
 * shortened with the spawn window, a wave that now empties the portal in 24 s
 * would also lose two thirds of the time it has to be cleared in, and the wall
 * would move several waves shallower for a change that was only supposed to
 * remove dead time. Keeping the budget nominal means this change can only ever
 * move the wall *deeper* — the wave still has every second it used to have,
 * and now it also stops waiting for the queue.
 */
export function nominalSpawnIntervalForWave(wave: number): number {
  return Math.max(0.4, 2.0 - wave * 0.04);
}
```

**5.1c — the budget uses the nominal numbers.** **Find:**

```ts
export function expectedWaveSeconds(wave: number, enemyCount = spawnCountForWave(wave)): number {
  const kill = isBossWave(wave)
    ? TARGET_BOSS_KILL_SECONDS * bossEncounterWeight(wave)
    : TARGET_WAVE_KILL_SECONDS;
  return spawnIntervalForWave(wave) * Math.max(0, enemyCount - 1) + kill;
}
```

**Replace with:**

```ts
export function expectedWaveSeconds(
  wave: number,
  enemyCount = naturalSpawnCountForWave(wave),
): number {
  const kill = isBossWave(wave)
    ? TARGET_BOSS_KILL_SECONDS * bossEncounterWeight(wave)
    : TARGET_WAVE_KILL_SECONDS;
  // Nominal cadence and natural body count, both deliberately — see
  // `nominalSpawnIntervalForWave`. This function is the wall condition, and it
  // must read the same numbers before and after the spawn window landed.
  return nominalSpawnIntervalForWave(wave) * Math.max(0, enemyCount - 1) + kill;
}
```

**Verify:**

```bash
npm run typecheck
```

**Expected:** compiles. `spawnIntervalForWave(w)` callers still work — the count
parameter has a default.

### Step 5.2 — The spawner uses the real cadence

**File:** `src/systems/WaveManager.ts`

**5.2a — the import.** **Find:**

```ts
  enemyCountForWave,
  spawnCountForWave,
```

**Replace with:**

```ts
  enemyCountForWave,
  naturalSpawnCountForWave,
  spawnCountForWave,
```

**5.2b — `startWave`.** **Find:**

```ts
    this.state.spawnInterval = spawnIntervalForWave(wave);
```

**Replace with:**

```ts
    // The cadence follows the roster the wave actually rolled, mutator
    // included: a Swarm wave has three times the bodies and still has to fit
    // them inside `SPAWN_WINDOW_SECONDS`.
    this.state.spawnInterval = spawnIntervalForWave(wave, this.state.enemiesToSpawn);
```

**5.2c — `startAtWave`.** **Find:**

```ts
      enemiesToSpawn: spawnCountForWave(target),
      spawnInterval: spawnIntervalForWave(target),
```

**Replace with:**

```ts
      enemiesToSpawn: spawnCountForWave(target),
      spawnInterval: spawnIntervalForWave(target, spawnCountForWave(target)),
```

**5.2d — `makeInitialState`.** **Find:**

```ts
      enemiesToSpawn: enemyCountForWave(1),
      spawnInterval: spawnIntervalForWave(1),
```

**Replace with:**

```ts
      enemiesToSpawn: enemyCountForWave(1),
      spawnInterval: spawnIntervalForWave(1, enemyCountForWave(1)),
```

**5.2e — the enrage clock keeps its natural count.** **Find:**

```ts
    const stacks = enrageStacksFor(
      this.state.number,
      this.state.elapsed,
      this.state.enemiesToSpawn,
    );
```

**Replace with:**

```ts
    // The *natural* roster, not the capped one. `enemiesToSpawn` is what walks
    // through the portal; the budget is priced on what the wave is worth, and
    // capping the body count must not also cap the time the wave is given to
    // be cleared in (see `nominalSpawnIntervalForWave`).
    const stacks = enrageStacksFor(
      this.state.number,
      this.state.elapsed,
      this.naturalCountFor(this.state.number),
    );
```

**5.2f — the helper.** **Find:**

```ts
  /** How many enemies the given wave will spawn under the current mutator. */
  private plannedCountFor(wave: number): number {
    return Math.max(1, Math.floor(spawnCountForWave(wave) * this.enemyCountMult));
  }
```

**Replace with:**

```ts
  /** How many enemies the given wave will spawn under the current mutator. */
  private plannedCountFor(wave: number): number {
    return Math.max(1, Math.floor(spawnCountForWave(wave) * this.enemyCountMult));
  }

  /**
   * The wave's body count *before* `MAX_WAVE_BODIES`, mutator included.
   *
   * Only the enrage budget reads this. The two counts are the same below wave
   * 98 and diverge above it; see `crowdCompression`.
   */
  private naturalCountFor(wave: number): number {
    return Math.max(1, Math.floor(naturalSpawnCountForWave(wave) * this.enemyCountMult));
  }
```

**Verify:**

```bash
npm run typecheck && npm test -- pacing
```

### Step 5.3 — Compression at the spawn site

**File:** `src/systems/EnemyManager.ts`

**5.3a — the import.** Add `crowdCompression` to the existing
`from '../data/formulas'` import block (it already imports `enemyHPForWave`,
`goldDropForWave` and others).

**5.3b — `spawn`.** **Find:**

```ts
    if (type === 'boss') hp = bossMaxHpForWave(wave);
    else hp = enemyHPForWave(def.baseHP, wave);
```

**Replace with:**

```ts
    // `crowdCompression` is 1 below wave 98 and on every boss wave, so this is
    // a no-op for most of the game. Above the body cap it hands the cut
    // bodies' HP to the ones that remain, which is what keeps a wave's total
    // HP — the number every balance table is written against — unchanged.
    const compression = crowdCompression(wave);
    if (type === 'boss') hp = bossMaxHpForWave(wave);
    else hp = enemyHPForWave(def.baseHP, wave) * compression;
```

**5.3c — the gold.** **Find:**

```ts
    const gold = type === 'boss' ? bossGoldForWave(wave) : goldDropForWave(def.baseGold, wave);
```

**Replace with:**

```ts
    // Same compression as the HP above, for the same reason: fewer bodies
    // paying the same total. Without this the economy would fall by the
    // compression factor — 4.5x at wave 450 — for a change that was only ever
    // supposed to be about how many things are on screen.
    const gold = type === 'boss'
      ? bossGoldForWave(wave)
      : goldDropForWave(def.baseGold, wave) * compression;
```

**Verify:**

```bash
npm run typecheck && npm test -- enemies
```

### Step 5.4 — Compression in the XP faucets

**File:** `src/data/xpTables.ts`

**5.4a — the import.** **Find:**

```ts
import { bossEncounterWeight, enemyCountForWave, isBossWave } from './formulas';
```

**Replace with:**

```ts
import { bossEncounterWeight, crowdCompression, enemyCountForWave, isBossWave } from './formulas';
```

**5.4b — tower XP.** **Find:**

```ts
export function xpPerKill(type: EnemyType, wave: number): number {
  return Math.max(
    1,
    Math.round(KILL_XP_WEIGHT[type] * killXpWaveScale(wave) * killWeight(type, wave)),
  );
}
```

**Replace with:**

```ts
export function xpPerKill(type: EnemyType, wave: number): number {
  return Math.max(
    1,
    Math.round(
      KILL_XP_WEIGHT[type] * killXpWaveScale(wave) * killWeight(type, wave)
      * crowdCompression(wave),
    ),
  );
}
```

**5.4c — passive XP.** **Find:**

```ts
export function passiveXpPerKill(type: EnemyType, wave: number): number {
  return KILL_XP_WEIGHT[type] * killXpWaveScale(wave) * PASSIVE_KILL_XP_FACTOR
    * killWeight(type, wave);
}
```

**Replace with:**

```ts
export function passiveXpPerKill(type: EnemyType, wave: number): number {
  return KILL_XP_WEIGHT[type] * killXpWaveScale(wave) * PASSIVE_KILL_XP_FACTOR
    * killWeight(type, wave) * crowdCompression(wave);
}
```

> `passiveWaveXpRef` deliberately keeps `enemyCountForWave` un-compressed: it
> is a *reference* quantity used to price the passive XP table at each
> passive's unlock wave (5 to 88), all of which are below the cap, so the
> compression is 1 there and folding it in would only add a term that is always
> one.

**Verify:**

```bash
npm run typecheck && npm test -- formulas
```

### Step 5.5 — Compression in the two gold estimates

**5.5a — `src/systems/SaveManager.ts`.** **Find:**

```ts
export function averageKillGoldForWave(wave: number): number {
  if (isBossWave(wave)) {
    return bossWaveAverage(
      wave,
      bossGoldForWave(wave),
      t => goldDropForWave(ENEMY_DEFS[t].baseGold, wave),
    );
  }
  return poolAverage(wave, t => goldDropForWave(ENEMY_DEFS[t].baseGold, wave));
}
```

**Replace with:**

```ts
export function averageKillGoldForWave(wave: number): number {
  if (isBossWave(wave)) {
    return bossWaveAverage(
      wave,
      bossGoldForWave(wave),
      t => goldDropForWave(ENEMY_DEFS[t].baseGold, wave),
    );
  }
  // The caller multiplies by `spawnCountForWave`, which is capped, so the
  // per-body figure has to carry the compression or an offline wave at depth
  // pays a fraction of what the same wave pays live.
  return poolAverage(wave, t => goldDropForWave(ENEMY_DEFS[t].baseGold, wave))
    * crowdCompression(wave);
}
```

Add `crowdCompression` to the existing `from '../data/formulas'` import at the
top of `src/systems/SaveManager.ts`.

> `averageKillXPForWave` needs no change — it calls `xpPerKill`, which step 5.4
> already compressed.

**5.5b — `src/game/Game.ts`.** **Find:**

```ts
  private estimateWaveGold(wave: number): number {
    const perEnemy = goldDropForWave(ENEMY_DEFS.normal.baseGold, wave);
    const count = spawnCountForWave(wave);
    return Math.max(0, perEnemy * count * this.computeGoldMultiplier());
  }
```

**Replace with:**

```ts
  private estimateWaveGold(wave: number): number {
    const perEnemy = goldDropForWave(ENEMY_DEFS.normal.baseGold, wave)
      * crowdCompression(wave);
    const count = spawnCountForWave(wave);
    return Math.max(0, perEnemy * count * this.computeGoldMultiplier());
  }
```

Add `crowdCompression` to the existing `from '../data/formulas'` import in
`src/game/Game.ts`.

**Verify:**

```bash
npm run typecheck && npm test -- save
```

### Step 5.6 — The sim measures the same wave

**File:** `sim/model.ts`

**5.6a — the import.** Add `crowdCompression` to the existing
`from '../src/data/formulas.ts'` import block.

**5.6b — `waveProfile`'s return.** **Find:**

```ts
  return {
    count,
    totalHp: hpPer * count * riskHpMult(risk),
    avgArmor: armorPer,
    avgMagicResist: magicResistPer,
    baseGold: goldPer * count * (1 - theftDrag) * riskGoldMult(risk),
    spawnDuration: spawnIntervalForWave(wave) * (count - 1),
  };
```

**Replace with:**

```ts
  // `count` is the capped roster and `compression` is what each surviving body
  // carries, so `count * compression` is the natural body count and both
  // totals below are unchanged by the cap — which is the invariant
  // `tests/enemies.test.ts` holds.
  const compression = crowdCompression(wave);
  return {
    count,
    totalHp: hpPer * count * compression * riskHpMult(risk),
    avgArmor: armorPer,
    avgMagicResist: magicResistPer,
    baseGold: goldPer * count * compression * (1 - theftDrag) * riskGoldMult(risk),
    spawnDuration: spawnIntervalForWave(wave, count) * (count - 1),
  };
```

**Verify:**

```bash
npm run sim > .balance-baseline/sim-phase5.txt 2>&1 && tail -45 .balance-baseline/sim-phase5.txt
```

**Expected:**

- The `§2.2 Wall wave` column is **unchanged or 1–2 boss decades deeper** than
  Phase 4's. It must never be shallower — if it is, the nominal/natural split
  in step 5.1 was not applied somewhere.
- The ladder's `run len` column drops sharply: run 16 should fall from ~20 h to
  roughly **4 h**, and the `at 4.5x` column from ~270 min to roughly **55 min**.
- `T3` in the verdict block moves from a large failure to a near miss (~55 min
  against the 45 min target). Phase 6 closes the rest.
- `T4` stays a failure. Phase 6 fixes it.

### Step 5.7 — The tests that pin the old cadence

Run the suite and fix exactly these three, which assert the pre-window shape:

```bash
npm test -- formulas
```

**5.7a —** **Find:**

```ts
  it('pays a mutated boss roster for the time it takes to spawn', () => {
    // The extra bodies a Swarm mutator adds to a boss wave are escort trash,
    // not bosses, so they buy spawn time rather than a second kill window.
    const one = expectedWaveSeconds(20, 1);
    const two = expectedWaveSeconds(20, 2);
    expect(two - one).toBeCloseTo(spawnIntervalForWave(20));
  });
```

**Replace with:**

```ts
  it('pays a mutated boss roster for the time it takes to spawn', () => {
    // The extra bodies a Swarm mutator adds to a boss wave are escort trash,
    // not bosses, so they buy spawn time rather than a second kill window.
    // Priced at the *nominal* cadence: the budget is deliberately independent
    // of the spawn window (progress-steps §5.1c).
    const one = expectedWaveSeconds(20, 1);
    const two = expectedWaveSeconds(20, 2);
    expect(two - one).toBeCloseTo(nominalSpawnIntervalForWave(20));
  });
```

**5.7b and 5.7c —** the two tests above it
(`gives non-boss waves the flat kill window…` and
`sizes the boss window off the encounter weight…`) each build a `spawn` local
from `spawnIntervalForWave(w) * (… - 1)`. In **both**, replace
`spawnIntervalForWave` with `nominalSpawnIntervalForWave` and
`spawnCountForWave` with `naturalSpawnCountForWave`.

Add the two new names to the `../src/data/formulas` import at the top of
`tests/formulas.test.ts`.

### Step 5.8 — New tests for the new shape

**File:** `tests/formulas.test.ts`

Append at the end of the file:

```ts
describe('spawn window and the body cap (progress.md §5)', () => {
  it('fits every roster inside the spawn window once the window binds', () => {
    for (let w = 12; w <= 1000; w++) {
      if (isBossWave(w)) continue;
      const count = spawnCountForWave(w);
      const span = spawnIntervalForWave(w, count) * (count - 1);
      expect(span, `wave ${w}`).toBeLessThanOrEqual(SPAWN_WINDOW_SECONDS + 1e-9);
    }
  });

  it('never spawns faster than the natural cadence in the early game', () => {
    for (let w = 1; w <= 11; w++) {
      expect(spawnIntervalForWave(w), `wave ${w}`)
        .toBeCloseTo(nominalSpawnIntervalForWave(w), 9);
    }
  });

  it('never breaches the minimum interval', () => {
    for (let w = 1; w <= 2000; w++) {
      expect(spawnIntervalForWave(w), `wave ${w}`).toBeGreaterThanOrEqual(MIN_SPAWN_INTERVAL);
    }
  });

  it('caps the body count and compensates exactly', () => {
    for (let w = 1; w <= 2000; w++) {
      if (isBossWave(w)) continue;
      expect(enemyCountForWave(w), `wave ${w}`).toBeLessThanOrEqual(MAX_WAVE_BODIES);
      // The invariant the whole phase rests on: capped bodies x what each one
      // carries is the roster that would have spawned.
      expect(enemyCountForWave(w) * crowdCompression(w), `wave ${w}`)
        .toBeCloseTo(naturalEnemyCountForWave(w), 6);
    }
  });

  it('leaves the compression at 1 below the cap and on boss waves', () => {
    for (const w of [1, 20, 50, 97]) expect(crowdCompression(w), `wave ${w}`).toBe(1);
    for (const w of [10, 100, 200, 450]) {
      if (isBossWave(w)) expect(crowdCompression(w), `boss ${w}`).toBe(1);
    }
    expect(crowdCompression(98)).toBeGreaterThan(1);
  });

  it('keeps the enrage budget on the pre-window curve', () => {
    // The fuse must be identical to what it was before the window landed:
    // nominal cadence, natural body count. If this drifts, the wall moves.
    for (const w of [1, 20, 60, 100, 200, 359, 450]) {
      const expected = nominalSpawnIntervalForWave(w)
        * Math.max(0, naturalSpawnCountForWave(w) - 1)
        + (isBossWave(w) ? TARGET_BOSS_KILL_SECONDS * bossEncounterWeight(w) : TARGET_WAVE_KILL_SECONDS);
      expect(expectedWaveSeconds(w), `wave ${w}`).toBeCloseTo(expected, 6);
    }
  });
});
```

Add every new name used above to the `../src/data/formulas` import at the top of
`tests/formulas.test.ts`: `MAX_WAVE_BODIES`, `MIN_SPAWN_INTERVAL`,
`SPAWN_WINDOW_SECONDS`, `crowdCompression`, `naturalEnemyCountForWave`,
`naturalSpawnCountForWave`, `nominalSpawnIntervalForWave`.

**File:** `tests/enemies.test.ts`

Append at the end of the file:

```ts
describe('the body cap preserves wave totals (progress.md §5.3)', () => {
  it('leaves a wave\'s total HP unchanged at every depth', () => {
    for (const w of [50, 98, 120, 200, 359, 450, 1000]) {
      if (isBossWave(w)) continue;
      const perBody = enemyHPForWave(ENEMY_DEFS.normal.baseHP, w) * crowdCompression(w);
      const total = perBody * enemyCountForWave(w);
      const uncapped = enemyHPForWave(ENEMY_DEFS.normal.baseHP, w) * naturalEnemyCountForWave(w);
      expect(total, `wave ${w}`).toBeCloseTo(uncapped, 3);
    }
  });

  it('leaves a wave\'s total gold unchanged at every depth', () => {
    for (const w of [50, 98, 120, 200, 359, 450, 1000]) {
      if (isBossWave(w)) continue;
      const perBody = goldDropForWave(ENEMY_DEFS.normal.baseGold, w) * crowdCompression(w);
      expect(perBody * enemyCountForWave(w), `wave ${w}`)
        .toBeCloseTo(goldDropForWave(ENEMY_DEFS.normal.baseGold, w) * naturalEnemyCountForWave(w), 3);
    }
  });

  it('does not compress the damage each body deals', () => {
    // Deliberate asymmetry (see `crowdCompression`): fewer bodies means less
    // total chip damage, which is a margin. Compressing it would mean one
    // wave-450 body hitting for 4.5x, which is a new way to die.
    for (const w of [200, 450]) {
      expect(enemyDamageForWave(ENEMY_DEFS.normal.baseDamage, w))
        .toBe(enemyDamageForWave(ENEMY_DEFS.normal.baseDamage, w));
    }
  });
});
```

Import whatever of `enemyHPForWave`, `goldDropForWave`, `enemyDamageForWave`,
`crowdCompression`, `enemyCountForWave`, `naturalEnemyCountForWave`,
`isBossWave` is not already imported in that file.

**Verify Phase 5:**

```bash
npm run typecheck && npm test && npm run checks
```

If `npm run checks` reports a failure in the `§2.3.1 HP / gold curves` or
`§2.3.3 wave enrage` sections, the nominal/natural split is wrong somewhere —
re-read step 5.1c. Do **not** "fix" it by changing the check.

---

## Phase 6 — Deployment: stop replaying the game

**What is wrong** (progress.md §1.3, T4): even with Phase 5, a run to wave 549
spends its first 470 waves re-clearing content the tower cannot lose. That is
where the minutes go and it is the least interesting part of the game.

**What this phase does:** a run may start from a checkpoint of a previous run,
restored exactly — never better.

> **Deliberate deviation from progress.md §6.4.** That section also proposed
> letting offline progress walk forward to the checkpoint wave. This
> implementation does **not** do that, and the reason is that Deployment already
> delivers the outcome — an absence hands back a run that starts at the
> frontier the moment the player presses Deploy — at zero risk of re-opening the
> offline faucet `plans/economy.md` deliberately closed.
> `computeOfflineProgress` is not touched by this phase.

### Step 6.1 — The state

**File:** `src/types.ts`

Add, immediately before `export interface GameState {`:

```ts
/**
 * One restorable run state, snapshotted at a 50-wave boundary.
 *
 * A **snapshot, not a grant**: every field is a value the player actually
 * held at that wave, so deploying can never hand back more than the run that
 * wrote it earned. That is what makes the whole mechanism exploit-free without
 * any new economy arithmetic (plans/progress.md §6.1).
 */
export interface DeploymentCheckpoint {
  /** The wave this was taken at. Always a multiple of `DEPLOY_CHECKPOINT_STEP`. */
  wave: number;
  /** Gold in hand at the moment the wave was cleared. */
  gold: number;
  /** Every upgrade's level. Ids the table no longer defines are dropped on load. */
  upgradeLevels: Record<string, number>;
  /** Blessing stacks held, keyed by blessing id. */
  blessingHeld: Record<string, number>;
  /** Picks spent, so the draft cap still binds after a deploy. */
  blessingPicks: number;
  /** Every ability's level. */
  abilityLevels: Record<string, number>;
  /** Wall-clock time the snapshot was written. Presentation only. */
  recordedAt: number;
}

/**
 * The checkpoint store (permanent across ascension, cleared by transcendence).
 *
 * Keyed by wave rather than a bare list, because a deploy has to be able to
 * land at *a* checkpoint at or below the perk's depth, not only at the deepest
 * one. Only the best snapshot ever written at each wave is kept.
 */
export interface DeploymentState {
  checkpoints: Record<number, DeploymentCheckpoint>;
}

/** Waves between checkpoints. A deploy lands at most this far short of its target. */
export const DEPLOY_CHECKPOINT_STEP = 50;

/**
 * How many checkpoints the save keeps, deepest first.
 *
 * A 550-wave run writes eleven; twelve is one more than that, so the store is
 * bounded without ever discarding a checkpoint a live run could still deploy
 * to.
 */
export const DEPLOY_CHECKPOINT_LIMIT = 12;
```

Then, inside `GameState`, **find:**

```ts
  /** v19+: the Long Watch campaign (permanent — survives both resets). */
  watch: WatchState;
}
```

**Replace with:**

```ts
  /** v19+: the Long Watch campaign (permanent — survives both resets). */
  watch: WatchState;
  /** v25+: restorable run snapshots (survives ascension, cleared by transcendence). */
  deployment: DeploymentState;
}
```

**Verify:**

```bash
npm run typecheck
```

**Expected:** one error, in `Game.makeInitialState` — step 6.2 fixes it.

### Step 6.2 — Seed it in the initial state

**File:** `src/game/Game.ts`

Find `makeInitialState()` and the line inside it that builds the `watch:` field.
Immediately after that field, add:

```ts
    deployment: { checkpoints: {} },
```

**Verify:**

```bash
npm run typecheck
```

### Step 6.3 — Write a checkpoint every 50 waves

**File:** `src/game/Game.ts`

**Find:**

```ts
    this.bus.on('wave_cleared', (wave: unknown) => {
      const cleared = wave as number;
      const wms = this.state.wave.waveModifier;
```

**Replace with:**

```ts
    this.bus.on('wave_cleared', (wave: unknown) => {
      const cleared = wave as number;
      this.recordDeploymentCheckpoint(cleared);
      const wms = this.state.wave.waveModifier;
```

Then add these two methods to the `Game` class, immediately **before**
`private applySavedStateReset(): void {`:

```ts
  /**
   * Snapshot the run at a checkpoint boundary (plans/progress.md §6.1).
   *
   * Only the *best* snapshot at each wave is kept — a later run that reaches
   * wave 300 with a stronger tower overwrites the earlier one, and a weaker
   * run never degrades what is stored. "Better" is measured by gold in hand,
   * which is the one field that summarises how far ahead of the wave the run
   * actually is; every other field moves with it.
   */
  private recordDeploymentCheckpoint(clearedWave: number): void {
    if (clearedWave <= 0 || clearedWave % DEPLOY_CHECKPOINT_STEP !== 0) return;
    const store = this.state.deployment.checkpoints;
    const existing = store[clearedWave];
    const gold = this.state.resources.gold;
    if (existing && existing.gold >= gold) return;

    const abilityLevels: Record<string, number> = {};
    for (const [id, a] of Object.entries(this.state.abilities)) {
      abilityLevels[id] = a.level;
    }
    store[clearedWave] = {
      wave: clearedWave,
      gold,
      upgradeLevels: this.upgradeMgr.snapshot(),
      blessingHeld: { ...this.blessingMgr.snapshot().held },
      blessingPicks: this.blessingMgr.snapshot().picksTaken,
      abilityLevels,
      recordedAt: Date.now(),
    };

    // Bounded store: keep the deepest `DEPLOY_CHECKPOINT_LIMIT`. A shallow
    // checkpoint that falls off the end is one no perk level can ever target
    // again, because the deploy depth is a fraction of the deepest one.
    const waves = Object.keys(store).map(Number).sort((a, b) => b - a);
    for (const w of waves.slice(DEPLOY_CHECKPOINT_LIMIT)) delete store[w];
  }

  /**
   * The checkpoint a deploy would land on, or null when there is none.
   *
   * `ap_forward_camp` sells a *fraction* of the deepest checkpoint, and the
   * store is 50 waves apart, so the answer is the deepest checkpoint at or
   * below that fraction. Both the panel (to label the button) and `deploy`
   * (to do the work) go through here, so the button can never promise a wave
   * the deploy does not deliver.
   */
  deploymentTarget(): DeploymentCheckpoint | null {
    const fraction = this.prestigeMgr.getDeployFraction();
    if (fraction <= 0) return null;
    const store = this.state.deployment.checkpoints;
    const waves = Object.keys(store).map(Number).sort((a, b) => b - a);
    if (waves.length === 0) return null;
    const ceiling = Math.floor(waves[0] * fraction);
    for (const w of waves) {
      if (w <= ceiling) return store[w];
    }
    return null;
  }
```

Add the two constants and the type to the `../types` import at the top of
`src/game/Game.ts`:

```ts
import type { DeploymentCheckpoint } from '../types';
```

and add `DEPLOY_CHECKPOINT_STEP, DEPLOY_CHECKPOINT_LIMIT` to the existing value
import from `'../types'`.

**Verify:**

```bash
npm run typecheck
```

**Expected:** one error — `getDeployFraction` does not exist yet. Step 6.5 adds
it.

### Step 6.4 — The perk

**File:** `src/data/prestige.ts`

**6.4a — the effect union.** **Find:**

```ts
  | 'upgrade_cap'
```

**Replace with:**

```ts
  | 'upgrade_cap'
  /**
   * Fraction of the deepest deployment checkpoint a run may start from
   * (progress.md §6.2). 0.85 = "start 85% of the way to your record".
   */
  | 'deploy_depth'
```

**6.4b — the perk.** **Find:**

```ts
  {
    id: 'ap_deep_stores',
```

**Replace with:**

```ts
  {
    id: 'ap_forward_camp',
    layer: 'ascension',
    name: 'Forward Camp',
    description: 'Ascend straight to a checkpoint of your best run',
    /*
     * progress.md §6. The node that removes the re-climb.
     *
     * Measured with `npm run sim`'s ladder report: at the depths the ladder
     * reaches, 88% of a run's minutes are spent on waves whose length is the
     * spawn queue rather than a fight, and the tower cannot lose any of them.
     * A deploy skips exactly that stretch and starts the run inside the band
     * where the wall actually is.
     *
     * The ladder is 0.50 / 0.70 / 0.85 of the deepest checkpoint, resolved
     * down to a stored 50-wave boundary. It is *not* linear because the value
     * of a level is not linear: run time is now linear in depth (§5), so going
     * from 70% to 85% halves what is left of the run again.
     *
     * 150 x 2.4^L is 150 / 360 / 864 = 1 374 AP for all three levels. Priced
     * against `ap_deep_stores` (4 500) because this node saves *time* rather
     * than adding power — it must be affordable early enough to be felt.
     */
    costPerLevel: 150,
    costScaling: 2.4,
    maxLevel: 3,
    effectType: 'deploy_depth',
    // Level 1 is `baseEffect`; levels 2 and 3 add 0.20 and 0.15 through the
    // formula string, giving 0.50 / 0.70 / 0.85.
    effectPerLevel: '({level} === 2 ? 0.20 : 0.15)',
    baseEffect: 0.50,
    icon: 'walking-scout',
    color: '#3ec46d',
    tier: 3,
    prerequisites: [{ perkId: 'ap_veterancy', minLevel: 2 }],
  },
  {
    id: 'ap_deep_stores',
```

**6.4c — the copy.** In `describeAPPerkBonus`, **find:**

```ts
    case 'upgrade_cap':
```

**Replace with:**

```ts
    case 'deploy_depth':
      return level > 0
        ? `Deploy at ${(computePerkEffect(p, level) * 100).toFixed(0)}% of your best run`
        : `Deploy at ${(computePerkEffect(p, 1) * 100).toFixed(0)}% of your best run`;
    case 'upgrade_cap':
```

### Step 6.5 — The manager getter

**File:** `src/systems/PrestigeManager.ts`

Immediately after `getAPUpgradeCapExtension()` (added in step 3.9), add:

```ts
  /**
   * Forward Camp: the fraction of the deepest checkpoint a deploy may start
   * from. 0 when the perk is unspent, which is what disables the button.
   *
   * `Math.max` rather than a sum: the perk is a single ladder and its levels
   * are cumulative already (`computePerkEffect` walks the formula), so summing
   * across a hypothetical second source would double-count.
   */
  getDeployFraction(): number {
    let best = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'deploy_depth') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) best = Math.max(best, computePerkEffect(p, lvl));
    }
    return Math.min(0.95, best);
  }
```

**Verify:**

```bash
npm run typecheck && npm test -- prestige-ap
```

### Step 6.6 — The deploy path

**File:** `src/game/Game.ts`

Find the public `ascend()` method (it calls `this.prestigeMgr.performAscension`
and then `this.applySavedStateReset()`). Immediately **after** it, add:

```ts
  /**
   * Ascend, then start the new run at a stored checkpoint (progress.md §6.2).
   *
   * The ordering matters and is not negotiable: the ascension has to happen
   * first, in full, so the AP the finished run earned is banked and every
   * run-scoped block is cleared by `applySavedStateReset`. The restore below
   * then overwrites the *opening* of the new run, and nothing else.
   *
   * Everything the deploy skips is genuinely skipped: contract progress, Watch
   * kill counters and tower/passive XP for those waves are not paid. That is
   * the trade, it is stated on the button, and it is what stops a deploy from
   * being strictly better than a full run for a player farming a counter.
   */
  deploy(): boolean {
    const target = this.deploymentTarget();
    if (!target) return false;
    if (!this.prestigeMgr.canAscend(this.state.wave.highestWave)) return false;

    this.ascend();

    // Upgrades first: the stat pipeline reads them, and the gold below is
    // sized against the tower they build.
    this.upgradeMgr.replaceLevels({ ...target.upgradeLevels });
    this.state.upgrades = this.upgradeMgr.snapshot();

    // Gold is *set*, not added. `applySavedStateReset` has already granted the
    // start-gold sources, and a deploy must return the run to the state it was
    // in — not that state plus a second opening bonus.
    this.state.resources.gold = target.gold;

    for (const [id, level] of Object.entries(target.abilityLevels)) {
      const a = this.state.abilities[id];
      if (a) a.level = Math.max(1, Math.floor(level));
    }

    this.blessingMgr.restore({
      held: { ...target.blessingHeld },
      picksTaken: target.blessingPicks,
      rerolls: 0,
      pendingOfferForWave: null,
      wavesClearedThisRun: 0,
    });
    this.state.blessings = this.blessingMgr.snapshot();

    this.waveMgr.startAtWave(target.wave);
    this.state.wave = this.waveMgr.snapshot;
    this.state.wave.highestWave = Math.max(this.state.wave.highestWave, target.wave);

    // Contracts are banded on the current wave, so they have to be re-drawn
    // *after* the jump — the same reason `applySavedStateReset` draws them last.
    this.contractMgr.reset();
    this.state.contracts = this.contractMgr.snapshot();

    // `applyUpgradeEffects` is this codebase's stat-recompute entry point (the
    // same one `applySavedStateReset` ends with); `syncUiApis` republishes the
    // panels' data, which the wave jump above has just invalidated.
    this.applyUpgradeEffects();
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Deployed to wave ${target.wave}.`,
      life: 4,
    });
    this.saveMgr.save(this.state);
    return true;
  }
```

> **Verified against the tree:** `ascend(): number` lives at
> `src/game/Game.ts:2715` and ends with `applySavedStateReset()`,
> `resetRunBaselines()`, `saveMgr.save(this.state)`, `syncUiApis()` and a
> `run_ended` emit. `deploy()` deliberately calls `ascend()` rather than
> duplicating any of that — it only overwrites the opening of the run that
> `ascend()` has already started.

### Step 6.7 — Clear the store on transcendence

**File:** `src/game/Game.ts`

Find `applyFullTranscendenceReset` and add, at the end of its body:

```ts
    // Checkpoints are a record of *this cycle's* tower. A transcendence resets
    // research, automation and the whole upgrade economy, so a checkpoint from
    // before it describes a run the new cycle cannot reproduce — deploying to
    // it would hand back a tower the player no longer has.
    this.state.deployment = { checkpoints: {} };
```

### Step 6.8 — The button

**File:** `src/ui/PrestigePanel.ts`

**6.8a — the handler.** **Find:**

```ts
export interface PrestigePanelHandlers {
  onAscend: () => void;
```

**Replace with:**

```ts
export interface PrestigePanelHandlers {
  onAscend: () => void;
  /** progress.md §6.2: ascend and restart at a stored checkpoint. */
  onDeploy: () => void;
  /** The wave a deploy would land on right now, or null when unavailable. */
  deployTargetWave: () => number | null;
```

**6.8b — the DOM.** **Find:**

```ts
    const note = document.createElement('div');
    note.className = 'ascend-warning';
    note.textContent = 'Resets gold, mana, upgrades, current wave, and any unspent research. Keeps spent AP perks, spent research unlocks (until Transcendence), lifetime AP, and stats.';
    actions.appendChild(btn);
    actions.appendChild(note);
```

**Replace with:**

```ts
    const deployBtn = document.createElement('button');
    deployBtn.type = 'button';
    deployBtn.className = 'btn btn-ascend btn-deploy';
    deployBtn.textContent = 'Deploy';
    deployBtn.disabled = true;
    deployBtn.addEventListener('click', () => this.handlers.onDeploy());
    this.deployBtn = deployBtn;

    const note = document.createElement('div');
    note.className = 'ascend-warning';
    note.textContent = 'Resets gold, mana, upgrades, current wave, and any unspent research. Keeps spent AP perks, spent research unlocks (until Transcendence), lifetime AP, and stats.';
    actions.appendChild(btn);
    actions.appendChild(deployBtn);
    actions.appendChild(note);
```

**6.8c — the field.** **Find:**

```ts
  private ascendBtn!: HTMLButtonElement;
```

**Replace with:**

```ts
  private ascendBtn!: HTMLButtonElement;
  private deployBtn!: HTMLButtonElement;
```

**6.8d — the update.** **Find:**

```ts
    this.ascendBtn.disabled = !canAscend;
    toggleClass(this.ascendBtn, 'can-ascend', canAscend);
```

**Replace with:**

```ts
    this.ascendBtn.disabled = !canAscend;
    toggleClass(this.ascendBtn, 'can-ascend', canAscend);

    // Deploy is Ascend plus a jump, so it is never available when Ascend is
    // not, and it hides entirely until Forward Camp has been bought — a
    // disabled button with no explanation is worse than no button.
    const deployWave = this.handlers.deployTargetWave();
    const canDeploy = canAscend && deployWave !== null;
    this.deployBtn.hidden = deployWave === null && !canDeploy;
    this.deployBtn.textContent = deployWave !== null
      ? `Deploy to wave ${deployWave}`
      : 'Deploy';
    this.deployBtn.title = deployWave !== null
      ? `Ascends, then restarts at wave ${deployWave} with the gold, upgrades, abilities and blessings that run reached it with. Skipped waves pay no XP, contract progress or Watch counters.`
      : '';
    this.deployBtn.disabled = !canDeploy;
    toggleClass(this.deployBtn, 'can-ascend', canDeploy);
```

**6.8e — the CSS.** **File:** `src/styles/main.css`. Find the `.btn-ascend`
rule and append this rule immediately after it:

```css
/* progress.md §6.2: Deploy sits next to Ascend and reads as the quieter of the
   two — it is the same action with a shortcut attached, not a bigger one. */
.btn-deploy {
  margin-top: 6px;
  opacity: 0.92;
}
.btn-deploy[hidden] {
  display: none;
}
```

### Step 6.9 — Wire the handler

**File:** `src/main.ts`

Find where `onAscend` is supplied to the prestige panel handlers and add
alongside it:

```ts
      onDeploy: () => { game.deploy(); },
      deployTargetWave: () => game.deploymentTarget()?.wave ?? null,
```

If the handlers are assembled in `src/ui/UIManager.ts` rather than `main.ts`,
add the same two entries there and thread them through the same way `onAscend`
is threaded.

**Verify:**

```bash
npm run typecheck
```

### Step 6.10 — Persist it

**File:** `src/systems/SaveManager.ts`

**6.10a — the version.** **Find:**

```ts
const SAVE_VERSION = 24;
```

**Replace with:**

```ts
const SAVE_VERSION = 25;
```

**6.10b — `PersistentState`.** Find the `PersistentState` interface and add,
after its `watch` field:

```ts
  /** v25+: deployment checkpoints (progress.md §6). */
  deployment: DeploymentState;
```

**6.10c — the snapshot.** **Find:**

```ts
      watch: this.snapshotWatch(state.watch),
    };
  }
```

**Replace with:**

```ts
      watch: this.snapshotWatch(state.watch),
      deployment: this.snapshotDeployment(state.deployment),
    };
  }

  /**
   * Checkpoints are copied field by field and re-validated, for the same
   * reason blessings are: a runtime-only field must not leak into the format,
   * and a hand-edited save must not be able to hand back a tower that never
   * existed. Anything malformed is dropped rather than repaired — a missing
   * checkpoint costs the player one deploy, a repaired one is a grant nobody
   * earned.
   */
  private snapshotDeployment(d: DeploymentState | undefined): DeploymentState {
    const out: DeploymentState = { checkpoints: {} };
    if (!d || !isObject(d.checkpoints)) return out;
    const waves = Object.keys(d.checkpoints)
      .map(Number)
      .filter(w => Number.isFinite(w) && w > 0)
      .sort((a, b) => b - a)
      .slice(0, DEPLOY_CHECKPOINT_LIMIT);
    for (const w of waves) {
      const c = d.checkpoints[w];
      if (!c || !Number.isFinite(c.gold)) continue;
      out.checkpoints[w] = {
        wave: w,
        gold: Math.max(0, c.gold),
        upgradeLevels: { ...c.upgradeLevels },
        blessingHeld: { ...c.blessingHeld },
        blessingPicks: Math.max(0, Math.floor(c.blessingPicks ?? 0)),
        abilityLevels: { ...c.abilityLevels },
        recordedAt: c.recordedAt ?? 0,
      };
    }
    return out;
  }
```

**6.10d — the migration.** **Find:**

```ts
  if (data.version === 23) { migrateV23toV24(data); data.version = 24; }
```

**Replace with:**

```ts
  if (data.version === 23) { migrateV23toV24(data); data.version = 24; }
  if (data.version === 24) { migrateV24toV25(data); data.version = 25; }
```

Then, immediately after the `migrateV23toV24` function, add:

```ts
/**
 * v25 (plans/progress.md §6): deployment checkpoints.
 *
 * Seeds an empty store. Deliberately does **not** synthesise a checkpoint from
 * the save's `highestWave`: a checkpoint is a *snapshot of a tower*, and a
 * pre-v25 save has no record of what its tower looked like at wave 300. Making
 * one up would be the one thing the whole mechanism is designed not to do.
 * A returning player's first run past a 50-wave boundary writes the first real
 * one.
 */
function migrateV24toV25(data: Record<string, unknown>): void {
  data.deployment = { checkpoints: {} };
}
```

**6.10e — the accepted-version guard.** **Find** the long line beginning:

```ts
  if (data.version !== SAVE_VERSION && data.version !== 23 &&
```

Insert `data.version !== 24 && ` immediately after `data.version !== SAVE_VERSION && `
so a v24 save is still accepted.

**6.10f — the import.** Add `DeploymentState` and `DEPLOY_CHECKPOINT_LIMIT` to
the existing `from '../types'` import at the top of `src/systems/SaveManager.ts`.

### Step 6.11 — Restore it on load

**File:** `src/game/Game.ts`, in `applyPersistedState`. **Find:**

```ts
    applyPersistedWatch(this.state.watch, persisted.watch);
    this.applyWatchUnlocksOnLoad();
```

**Replace with:**

```ts
    applyPersistedWatch(this.state.watch, persisted.watch);
    this.applyWatchUnlocksOnLoad();

    // v25+: deployment checkpoints. `SaveManager.snapshotDeployment` already
    // validated and bounded the block on the way out, and the same method is
    // the only writer, so this is a plain adopt.
    this.state.deployment = persisted.deployment ?? { checkpoints: {} };
```

**Verify:**

```bash
npm run typecheck && npm test -- save
```

### Step 6.12 — Tests

**File:** `tests/save.test.ts`

Append at the end of the file:

```ts
describe('deployment checkpoints (progress.md §6)', () => {
  it('round-trips through a save', async () => {
    const state = freshState();
    state.deployment.checkpoints[100] = {
      wave: 100,
      gold: 12345,
      upgradeLevels: { damage: 40, fireRate: 9 },
      blessingHeld: { bl_frost: 2 },
      blessingPicks: 7,
      abilityLevels: { fireball: 3 },
      recordedAt: 1,
    };
    const mgr = makeSaveManager();
    const snap = mgr.snapshot(state);
    expect(snap.deployment.checkpoints[100].gold).toBe(12345);
    expect(snap.deployment.checkpoints[100].upgradeLevels.damage).toBe(40);
    expect(snap.deployment.checkpoints[100].blessingPicks).toBe(7);
  });

  it('bounds the store at the deepest twelve', () => {
    const state = freshState();
    for (let w = 50; w <= 1000; w += 50) {
      state.deployment.checkpoints[w] = {
        wave: w, gold: w, upgradeLevels: {}, blessingHeld: {},
        blessingPicks: 0, abilityLevels: {}, recordedAt: 0,
      };
    }
    const snap = makeSaveManager().snapshot(state);
    const kept = Object.keys(snap.deployment.checkpoints).map(Number).sort((a, b) => a - b);
    expect(kept.length).toBeLessThanOrEqual(12);
    expect(Math.max(...kept)).toBe(1000);
  });

  it('gives a v24 save an empty store rather than inventing one', () => {
    // A checkpoint is a snapshot of a tower. A pre-v25 save has no record of
    // what its tower looked like at depth, so synthesising one would hand back
    // a run that never happened.
    const v24 = { version: 24, savedAt: Date.now(), stats: { lifetimeHighestWave: 300 } } as Record<string, unknown>;
    migrateSave(v24);
    expect(v24.version).toBe(25);
    expect((v24.deployment as { checkpoints: Record<string, unknown> }).checkpoints).toEqual({});
  });
});
```

> Adapt `freshState()`, `makeSaveManager()` and `migrateSave()` to whatever the
> existing helpers in `tests/save.test.ts` are called. Do not add new helpers if
> equivalents already exist.

**File:** `tests/prestige-ap.test.ts`

Append:

```ts
describe('Forward Camp (progress.md §6.2)', () => {
  it('sells 50 / 70 / 85 percent', () => {
    const p = AP_PERK_BY_ID.ap_forward_camp;
    expect(computePerkEffect(p, 1)).toBeCloseTo(0.50, 6);
    expect(computePerkEffect(p, 2)).toBeCloseTo(0.70, 6);
    expect(computePerkEffect(p, 3)).toBeCloseTo(0.85, 6);
  });

  it('is zero until bought', () => {
    expect(mgrWith(0, {}).getDeployFraction()).toBe(0);
    expect(mgrWith(0, { ap_forward_camp: 3 }).getDeployFraction()).toBeCloseTo(0.85, 6);
  });
});
```

**Verify Phase 6:**

```bash
npm run typecheck && npm test && npm run checks
```

### Step 6.13 — Measure the whole thing

The sim's greedy buyer does not deploy, so the ladder cannot see this phase on
its own. Teach it to, in `sim/ladder.ts` — this is a modelling addition, not a
gameplay change.

**File:** `sim/ladder.ts`

Inside `runLadder`'s loop, **find:**

```ts
    const r = simulateRun({
```

**Replace with:**

```ts
    // Forward Camp 3 deploys at 85% of the deepest 50-wave checkpoint, so the
    // run the player actually plays starts there rather than at wave 1. The
    // model has no checkpoint store, so the deploy wave is derived from the
    // previous run's wall, which is the same number by construction.
    const deployFrom = previousWall > 0
      ? Math.floor((previousWall * 0.85) / 50) * 50
      : 0;
    const r = simulateRun({
```

Then, immediately after the `simulateRun` call, **find:**

```ts
    const banked = apForWave(r.wallWave);
```

**Replace with:**

```ts
    // `simulateRun` always walks from wave 1; the deploy skips everything below
    // `deployFrom`, so the run's real length is the tail. The sample at the
    // deploy wave carries the elapsed time up to it.
    const skipped = deployFrom > 0 ? (r.samples.get(deployFrom)?.elapsedSec ?? 0) : 0;
    const playedSeconds = Math.max(0, r.durationSec - skipped);
    const banked = apForWave(r.wallWave);
```

and change the two places that read `r.durationSec` in the row that is pushed
(`runSeconds: r.durationSec` and the `atRiskTimeShare` denominator) to use
`playedSeconds`, and start the at-risk loop at `deployFrom + 1` instead of `1`.

```bash
npm run sim > .balance-baseline/sim-phase6.txt 2>&1 && tail -45 .balance-baseline/sim-phase6.txt
```

**Expected:** all four targets pass.

- `run len` for the deep rows falls to roughly **0.6–0.8 h**, and `at 4.5x` to
  **8–11 min**.
- `at-risk time` rises from ~12% to **60%+**.
- The verdict block reads `ok` on all four lines.

If T4 still fails, the at-risk loop is still counting the skipped waves — check
that its lower bound is `deployFrom + 1`.

---

## Phase 7 — Re-anchor the Long Watch

**What is wrong** (progress.md §1.7): the campaign's depth gates and its counter
gates point in opposite directions. Chapter 11 asks for tower level 100, which
the XP economy delivers around run 30, against a depth gate (wave 175) that
falls in run 3. Chapter 19 asks for tower level 175 — 300.8 M cumulative XP,
fifty times what sixteen runs produce — so it cannot be completed at all.

**What this phase does:** re-price the level and count gates onto what the
Phase 4 ladder actually produces, and stretch the depth gates so the campaign
ends where the ladder is still moving.

### The numbers this is priced against

Tower level after run N on the post-Phase-4 ladder, from probe E:

| after run | wall | tower level |
|---:|---:|---:|
| 1 | 40 | 10 |
| 3 | 249 | 39 |
| 6 | 339 | 61 |
| 10 | 357 | 74 |
| 16 | 359 | 86 |

Cumulative XP for level 40 is 353 K, for level 85 is 5.6 M, for level 100 is
12.3 M and for level 175 is 300.8 M.

### Step 7.1 — The two level gates

**File:** `src/data/watch.ts`

**7.1a — chapter 11.** **Find:**

```ts
      { kind: 'tower_level', level: 100 },
```

**Replace with:**

```ts
      // progress.md §7.6: level 100 is 12.3 M cumulative XP, which the ladder
      // reaches around run 30 — twenty-seven runs after this chapter's own
      // depth gate (wave 175) falls. Level 40 is what the tower is at the
      // depth this chapter asks for.
      { kind: 'tower_level', level: 40 },
```

**7.1b — chapter 19.** **Find:**

```ts
      { kind: 'tower_level', level: 175 },
```

**Replace with:**

```ts
      // progress.md §1.7: level 175 is 300.8 M cumulative XP against a ladder
      // that produces 6.2 M in sixteen runs and then plateaus — this chapter
      // was not completable. Level 85 is what the tower is at wave 400.
      { kind: 'tower_level', level: 85 },
```

### Step 7.2 — The two count gates

**7.2a — chapter 17.** **Find:**

```ts
      { kind: 'ascensions', count: 250 },
      { kind: 'transcendences', count: 25 },
```

**Replace with:**

```ts
      // progress.md §7.6: the depth gates now fall in single-digit run counts,
      // so a 250-ascension counter is not a *deep* requirement, it is the only
      // requirement — and the one that has nothing to do with how strong the
      // tower is.
      { kind: 'ascensions', count: 40 },
      { kind: 'transcendences', count: 12 },
```

**7.2b — chapter 20.** **Find:**

```ts
      { kind: 'transcendences', count: 50 },
```

**Replace with:**

```ts
      { kind: 'transcendences', count: 20 },
```

**7.2c — chapter 12.** **Find:**

```ts
      { kind: 'ascensions', count: 50 },
```

**Replace with:**

```ts
      { kind: 'ascensions', count: 20 },
```

### Step 7.3 — Stretch the tail

The Phase 4 ladder reaches wave 450 around run 7–8 and wave 549 around run 16,
and is still advancing +10 a run there. Move chapters 16–20 out so the campaign
ends where the ladder is still moving rather than well inside it.

**File:** `src/data/watch.ts`

Apply these five replacements, each on the `reach_wave` line of the named
chapter:

| chapter | id | find | replace |
|---|---|---|---|
| 16 | `wc_ash_and_ember` | `{ kind: 'reach_wave', wave: 290 },` | `{ kind: 'reach_wave', wave: 320 },` |
| 17 | `wc_cycles` | `{ kind: 'reach_wave', wave: 320 },` | `{ kind: 'reach_wave', wave: 380 },` |
| 18 | `wc_wider_board` | `{ kind: 'reach_wave', wave: 350 },` | `{ kind: 'reach_wave', wave: 440 },` |
| 19 | `wc_starfall` | `{ kind: 'reach_wave', wave: 400 },` | `{ kind: 'reach_wave', wave: 500 },` |
| 20 | `wc_last_watch` | `{ kind: 'reach_wave', wave: 450 },` | `{ kind: 'reach_wave', wave: 560 },` |

> Apply them **bottom-up** (chapter 20 first). Chapter 17's current value (320)
> is chapter 16's new value, so a top-down pass would match the wrong line.

### Step 7.4 — A gate that fails loudly next time

**File:** `tests/watch.test.ts`

Append at the end of the file:

```ts
describe('gates land where the ladder is (progress.md §7.6)', () => {
  /**
   * The ladder's measured tower level by depth, from `plans/progress.md` §1.7.
   * A chapter whose level gate sits above the level its own depth gate implies
   * is a chapter that cannot be finished when it is offered — which is what
   * chapter 19 was, by a factor of fifty.
   */
  const LEVEL_AT_DEPTH: ReadonlyArray<[wave: number, level: number]> = [
    [40, 10], [249, 39], [339, 61], [357, 74], [500, 86], [560, 90],
  ];

  function levelAtDepth(wave: number): number {
    let best = LEVEL_AT_DEPTH[0][1];
    for (const [w, lv] of LEVEL_AT_DEPTH) if (wave >= w) best = lv;
    return best;
  }

  it('never asks for a tower level the chapter\'s own depth cannot reach', () => {
    for (const ch of WATCH_CHAPTERS) {
      const depth = ch.goals.find(o => o.kind === 'reach_wave');
      const level = ch.goals.find(o => o.kind === 'tower_level');
      if (!depth || !level || depth.kind !== 'reach_wave' || level.kind !== 'tower_level') continue;
      expect(level.level, `${ch.id} (wave ${depth.wave})`)
        .toBeLessThanOrEqual(levelAtDepth(depth.wave));
    }
  });

  it('keeps every depth gate ascending', () => {
    let previous = 0;
    for (const ch of WATCH_CHAPTERS) {
      const depth = ch.goals.find(o => o.kind === 'reach_wave');
      if (!depth || depth.kind !== 'reach_wave') continue;
      expect(depth.wave, ch.id).toBeGreaterThan(previous);
      previous = depth.wave;
    }
  });
});
```

`WATCH_CHAPTERS` is the exported array and `goals` is the field name — both
verified against `src/data/watch.ts:202`.

**Verify Phase 7:**

```bash
npm run typecheck && npm test && npm run checks
```

---

## Phase 8 — The draft keeps drafting

**What is wrong** (progress.md §1.5): `BLESSING_MAX_PICKS = 30` at one draft
every four waves means the run's only run-scoped decision layer switches off at
wave 119. Every deeper wave — two thirds of a post-Phase-4 run — is played on a
frozen build.

### Step 8.1 — A depth-scaled cap

**File:** `src/data/blessings.ts`

**Find:**

```ts
export const BLESSING_MAX_PICKS = 30;
```

**Replace with:**

```ts
/**
 * Picks a run may take before the draft closes, at wave 120 and below.
 *
 * Kept as the base of `blessingPickCapForWave` rather than deleted, because it
 * is the number every existing balance table was measured against and the
 * `npm run sim` §1.6 table has to stay comparable.
 */
export const BLESSING_MAX_PICKS = 30;

/** First wave past which the cap starts growing. */
export const BLESSING_CAP_GROWTH_WAVE = 120;

/** Waves of depth that buy one extra pick past `BLESSING_CAP_GROWTH_WAVE`. */
export const BLESSING_CAP_WAVES_PER_PICK = 20;

/**
 * The pick ceiling at a given depth.
 *
 * 30 picks at one draft per four waves is exhausted on wave 119, which is where
 * a run's only run-scoped decision layer used to stop — with two thirds of the
 * run still to play (plans/progress.md §1.5). Growing the cap by one pick per
 * 20 waves past 120 keeps the draft alive without turning it back into the
 * unbounded stat pile the cap was introduced to prevent: a wave-550 run takes
 * ~51 picks, not 135.
 *
 * The rate is deliberately *slower* than the draft cadence (one per 4 waves),
 * so past wave 120 most drafts are still refused — the draft becomes a rarer
 * event at depth rather than a continuous one.
 */
export function blessingPickCapForWave(wave: number): number {
  if (wave <= BLESSING_CAP_GROWTH_WAVE) return BLESSING_MAX_PICKS;
  return BLESSING_MAX_PICKS
    + Math.floor((wave - BLESSING_CAP_GROWTH_WAVE) / BLESSING_CAP_WAVES_PER_PICK);
}
```

### Step 8.2 — The manager uses it

**File:** `src/systems/BlessingManager.ts`

**8.2a — the import.** Add `blessingPickCapForWave` to the existing
`from '../data/blessings'` import.

**8.2b — remember the depth.** Find the manager's private field block (near
`private picksTaken`) and add:

```ts
  /**
   * The deepest wave this run has offered a draft at.
   *
   * `choose` and `isCapped` need the pick ceiling, and neither is handed a
   * wave. Recording it at the one point that *is* — `isDraftDue`, which every
   * draft goes through — keeps the cap a function of depth without threading a
   * wave through four more signatures.
   */
  private capWave = 0;
```

**8.2c — `isDraftDue`.** **Find:**

```ts
  isDraftDue(clearedWave: number): boolean {
    if (this.picksTaken >= BLESSING_MAX_PICKS) return false;
    const first = this.firstDraftWave;
```

**Replace with:**

```ts
  isDraftDue(clearedWave: number): boolean {
    this.capWave = Math.max(this.capWave, clearedWave);
    if (this.picksTaken >= this.pickCap) return false;
    const first = this.firstDraftWave;
```

**8.2d — `isCapped` and the cap itself.** **Find:**

```ts
  get isCapped(): boolean {
    return this.picksTaken >= BLESSING_MAX_PICKS;
  }
```

**Replace with:**

```ts
  /** The pick ceiling at the depth this run has reached. */
  get pickCap(): number {
    return blessingPickCapForWave(this.capWave);
  }

  get isCapped(): boolean {
    return this.picksTaken >= this.pickCap;
  }
```

**8.2e — `choose`.** **Find:**

```ts
    if (this.picksTaken >= BLESSING_MAX_PICKS) return false;
```

(the occurrence inside `choose`) and **replace with:**

```ts
    if (this.picksTaken >= this.pickCap) return false;
```

**8.2f — the reset.** Find `reset(opts: { carryBest?: boolean } = {})` and add
`this.capWave = 0;` alongside the other field resets in it.

**8.2g — restore.** Find `restore(state: BlessingRunState | null | undefined)`
and add, at the end of its body:

```ts
    // A restored run has already been to whatever depth it reached; seeding the
    // cap wave from the picks it took is the closest honest reconstruction, and
    // `isDraftDue` corrects it upward on the very next wave.
    this.capWave = BLESSING_CAP_GROWTH_WAVE
      + Math.max(0, this.picksTaken - BLESSING_MAX_PICKS) * BLESSING_CAP_WAVES_PER_PICK;
```

with `BLESSING_CAP_GROWTH_WAVE` and `BLESSING_CAP_WAVES_PER_PICK` added to the
import.

**Verify:**

```bash
npm run typecheck && npm test -- blessings
```

Any failing assertion that pins "30 picks" at a shallow wave should still pass
(the cap is 30 up to wave 120). If one fails at a deep wave, update it to
`blessingPickCapForWave(w)`.

### Step 8.3 — Cards worth the extra picks

Eight cards gated on the picks the base cap could never reach. No new rarity
tier: a `minPicks` field is a two-line change against a new `BlessingRarity`
member, which would touch every rarity colour map in the UI.

**File:** `src/data/blessings.ts`

**8.3a — the field.** **Find:**

```ts
  minWave?: number;
```

**Replace with:**

```ts
  minWave?: number;
  /**
   * Picks the run must already have taken before this card can be offered.
   *
   * The "greater" tier (plans/progress.md §7.4): cards sized for a run that is
   * past the base 30-pick cap, which is a depth no run reached before the cap
   * started growing. A `minPicks` gate rather than a new rarity, because rarity
   * is a *weighting* concept here and this is a *gating* one.
   */
  minPicks?: number;
```

**8.3b — the gate.** **File:** `src/systems/BlessingManager.ts`, in `eligible`.
**Find:**

```ts
      if (def.minWave !== undefined && wave < def.minWave) continue;
```

**Replace with:**

```ts
      if (def.minWave !== undefined && wave < def.minWave) continue;
      if (def.minPicks !== undefined && this.picksTaken < def.minPicks) continue;
```

**8.3c — the cards.** Append these eight entries to the end of the `BLESSINGS`
array in `src/data/blessings.ts`, immediately before its closing `];`.

Each one reuses a `BlessingStat` or `BlessingBehavior` that already has a
consumer — check the two unions at the top of the file and, if a name below does
not exist in them, **stop and report** rather than inventing a stat.

```ts
  // ── Greater tier (plans/progress.md §7.4) ───────────────────────────────
  //
  // Eight cards that only exist past the base 30-pick cap, which no run
  // reached before `blessingPickCapForWave` started growing. They are sized
  // at roughly 3x a rare, because a run that is 30 picks deep is already
  // carrying 30 cards' worth of multipliers and a rare's magnitude reads as
  // nothing against them.
  {
    id: 'bl_greater_edge',
    name: 'Sharpened Beyond',
    icon: 'barbed-arrow',
    description: '+45% damage.',
    rarity: 'epic',
    weight: 6,
    maxStacks: 5,
    minPicks: 30,
    effects: [{ stat: 'damage_pct', perStack: 0.45 }],
  },
  {
    id: 'bl_greater_cadence',
    name: 'Unbroken Cadence',
    icon: 'lightning-arc',
    description: '+30% fire rate.',
    rarity: 'epic',
    weight: 5,
    maxStacks: 4,
    minPicks: 30,
    effects: [{ stat: 'fire_rate_pct', perStack: 0.30 }],
  },
  {
    id: 'bl_greater_fortune',
    name: 'Deep Coffers',
    icon: 'gems',
    description: '+60% gold.',
    rarity: 'epic',
    weight: 5,
    maxStacks: 4,
    minPicks: 30,
    effects: [{ stat: 'gold_pct', perStack: 0.60 }],
  },
  {
    id: 'bl_greater_precision',
    name: 'Perfect Aim',
    icon: 'bullseye',
    description: '+60% critical damage.',
    rarity: 'epic',
    weight: 5,
    maxStacks: 4,
    minPicks: 30,
    effects: [{ stat: 'crit_damage_pct', perStack: 0.60 }],
  },
  {
    id: 'bl_greater_bulwark',
    name: 'Deep Foundations',
    icon: 'stone-tower',
    description: '+70% max HP.',
    rarity: 'epic',
    weight: 4,
    maxStacks: 4,
    minPicks: 30,
    effects: [{ stat: 'max_hp_pct', perStack: 0.70 }],
  },
  {
    id: 'bl_greater_reach',
    name: 'The Long Sight',
    icon: 'arrow-scope',
    description: '+35% range and +25% damage.',
    rarity: 'epic',
    weight: 4,
    maxStacks: 3,
    minPicks: 30,
    effects: [
      { stat: 'range_pct', perStack: 0.35 },
      { stat: 'damage_pct', perStack: 0.25 },
    ],
  },
  {
    id: 'bl_greater_ward',
    name: 'Warded Stone',
    icon: 'bordered-shield',
    description: '+50% defense and +50% armor.',
    rarity: 'epic',
    weight: 4,
    maxStacks: 3,
    minPicks: 30,
    effects: [
      { stat: 'defense_pct', perStack: 0.50 },
      { stat: 'armor_pct', perStack: 0.50 },
    ],
  },
  {
    id: 'bl_greater_wellspring',
    name: 'Endless Wellspring',
    icon: 'magic-swirl',
    description: '+80% mana regeneration.',
    rarity: 'epic',
    weight: 3,
    maxStacks: 3,
    minPicks: 30,
    effects: [{ stat: 'mana_regen_pct', perStack: 0.80 }],
  },
```

> **If a `stat` name above is not in the `BlessingStat` union**, replace that
> card's effect with the closest name that *is* in the union and keep the
> magnitude. Do not add a union member — a stat with no consumer is the exact
> failure mode that union exists to prevent.
>
> **If an `icon` above is not in `IconId`**, `npm run typecheck` will say so;
> substitute any icon already used elsewhere in the same file.

### Step 8.4 — Tests

**File:** `tests/blessings.test.ts`

Append:

```ts
describe('the pick cap grows with depth (progress.md §7.4)', () => {
  it('is 30 up to wave 120 and grows one per 20 waves after', () => {
    expect(blessingPickCapForWave(1)).toBe(30);
    expect(blessingPickCapForWave(120)).toBe(30);
    expect(blessingPickCapForWave(140)).toBe(31);
    expect(blessingPickCapForWave(340)).toBe(41);
    expect(blessingPickCapForWave(550)).toBe(51);
  });

  it('never offers a greater card before pick 30', () => {
    const mgr = new BlessingManager();
    // Nothing taken yet: the whole greater tier must be ineligible however
    // deep the wave is.
    const eligible = mgr.eligible(600).map(d => d.id);
    for (const def of BLESSINGS) {
      if (def.minPicks === undefined) continue;
      expect(eligible, def.id).not.toContain(def.id);
    }
  });
});
```

Add `blessingPickCapForWave` and `BLESSINGS` to the imports.

**Verify Phase 8:**

```bash
npm run typecheck && npm test && npm run checks && npm run sim > .balance-baseline/sim-phase8.txt 2>&1
```

**Expected:** the `§1.6 Blessing draft` table's **Picks** column rises above
30.0 at the deep tiers, and the ladder's wall column moves up by a handful of
waves. If any tier's wall moves by more than one boss decade, the magnitudes in
step 8.3c are too large — halve every `perStack` and re-measure.

---

## Phase 9 — Give RP a permanent home

**What is wrong** (progress.md §1.6): the entire research tree costs 66 730 RP
against a faucet that pays `RP = AP gained` — tens of thousands by run 3. RP
cost stops being a decision, research *time* becomes the only gate, and once
the eighteenth node lands RP is a currency with nowhere to go, forever.

**Why this is the whole of Phase 9.** progress.md §7.5 also proposed an endless
AP node priced on the difficulty ruler (`x1.11` damage per level). That is
deliberately **not** implemented, and the arithmetic is why: a node whose level
is worth exactly one wave, priced at a growth rate matching the AP curve, has a
constant AP-to-depth exchange rate and no diminishing return — the ladder's wall
would be set by that one node and nothing else. Phase 3's `ap_deep_stores` is
the AP sink, and it is one because it raises a *ceiling* rather than adding to a
bracket. Record this as considered and rejected; do not add the node.

### Step 9.1 — The repeatable node

**File:** `src/data/research.ts`

Append this entry to the end of the `RESEARCH_NODES` array, before its closing
`];`. The field names below match the shape every other node in that file uses
(`effectType` + `effectPerLevel`, `prerequisites` as a string array), verified
against `piercing_shots` and the laddered `rp_gain`.

```ts
  {
    id: 'field_studies',
    name: 'Field Studies',
    description: '+5% gold per level. Repeatable forever.',
    /*
     * plans/progress.md §7.5. The tree's only unbounded node, and the reason RP
     * is not a dead currency once the eighteenth project lands.
     *
     * ## Why gold and not damage
     *
     * `ResearchDef.effectType` is a closed union and there is no damage arm in
     * it — every combat node in the tree grants pierce, an AoE or a defensive
     * fraction, never a flat multiplier. Adding one would mean a new effect
     * type, a new `ResearchInputs` field and a new contributor line for a node
     * whose whole job is to be a *sink*. Gold does the job on its own now:
     * after `plans/progress.md` §3 raised the upgrade ceilings, gold buys
     * levels at every depth instead of stopping at wave 219, so a gold
     * multiplier is a damage multiplier with one more step in the chain.
     *
     * ## Why it cannot run away
     *
     * *Time*, not cost. Research runs one project at a time on the wall clock
     * and the time ladder grows 1.6x per level: level 10 is 6.9 hours, level 15
     * is 30 days, and past the array's last entry every further level costs the
     * same 30 days. `getResearchCost` / `getResearchTime` walk their arrays by
     * `min(level - 1, lastIndex)`, so the top rung holds forever — which is
     * what makes "repeatable forever" a fifteen-entry table rather than a
     * 999-entry one.
     */
    cost: [
      2000, 3200, 5120, 8192, 13107, 20972, 33554, 53687,
      85899, 137439, 219902, 351844, 562950, 900720, 1441151,
    ],
    researchTime: [
      3600, 5760, 9216, 14746, 23593, 37749, 60398, 96637,
      154619, 247390, 395824, 633318, 1013309, 1621294, 2594071,
    ],
    category: 'research',
    effectType: 'gold_multi',
    effectPerLevel: 0.05,
    maxLevel: 999,
    prerequisites: ['rp_gain'],
    icon: 'book-pile',
    color: '#c77dff',
  },
```

**Nothing else needs wiring.** `gold_multi` already has a consumer —
`ResearchTree.getGoldMultiplicative` sums `getResearchEffectAtLevel` over every
node with that effect type — so the node is live the moment it is in the table.
That is the entire point of picking an existing effect type.

**Verify:**

```bash
npm run typecheck && npm test -- research-economy
```

**Expected:** compiles and passes. If `category: 'research'` is rejected, the
`ResearchCategory` union uses a different key for that column — copy the value
from `rp_gain`, which is in the same category.

### Step 9.2 — Check the prerequisite renders

`prerequisites: ['rp_gain']` points at a 10-level node. Open the Research panel
in `npm run dev` and confirm the new node shows as locked until Increased Focus
has at least one level, and that its cost/time readout climbs each time it is
bought. If the panel renders a blank where the effect line should be, find the
switch over `effectType` in `src/ui/ResearchPanel.ts` and confirm `gold_multi`
has an arm — it will, because `alchemy` and `prosperity` use it.

### Step 9.3 — Test

**File:** `tests/research-economy.test.ts`

Append:

```ts
describe('Field Studies (progress.md §7.5)', () => {
  it('is repeatable and holds its top rung past the ladder', () => {
    const def = RESEARCH_BY_ID.field_studies;
    expect(def.maxLevel).toBeGreaterThan(100);
    // Past the last array entry the cost and time hold rather than
    // extrapolating — that is what `min(level - 1, lastIndex)` buys.
    expect(getResearchCost(def, 15)).toBe(getResearchCost(def, 99));
    expect(getResearchTime(def, 15)).toBe(getResearchTime(def, 99));
  });

  it('is gated behind time, not cost', () => {
    // Level 15 is ~30 days of real time. Whatever the RP economy does, the
    // node cannot be rushed, which is what makes it safe to leave unbounded.
    expect(getResearchTime(RESEARCH_BY_ID.field_studies, 15))
      .toBeGreaterThan(30 * 24 * 3600 * 0.9);
  });

  it('reaches the gold multiplier that already exists', () => {
    // The node is live purely by being in the table: `gold_multi` has a
    // consumer, which is why this needed no new effect type.
    expect(RESEARCH_BY_ID.field_studies.effectType).toBe('gold_multi');
  });
});
```

`RESEARCH_BY_ID`, `getResearchCost` and `getResearchTime` are all exported from
`src/data/research.ts`; add them to that file's import in the test.

**Verify Phase 9:**

```bash
npm run typecheck && npm test && npm run checks
```

---

## Phase 10 — Something new at depth

**What is wrong** (progress.md §1.5): the enemy roster's last new type arrives
at wave 45, the elite rate stops climbing at wave 100, and the gear rarity ramp
saturates there too. From wave 120 to the wall the game presents one composition
of one roster with no new mechanic.

This phase does the two changes that need no new art and no new entity type. The
appendix carries the rest.

### Step 10.1 — The roster's composition shifts with depth

Today `ENEMY_SPAWN_WEIGHTS` is a flat table: a wave-500 roster is drawn from the
same distribution as a wave-50 one, so depth only ever means "the same soup,
with bigger numbers".

**File:** `src/data/enemies.ts`

**Find:**

```ts
/** Types with a non-zero weight that have unlocked by `wave`, in table order. */
export function spawnPoolForWave(wave: number): Array<{ type: EnemyType; weight: number }> {
  const out: Array<{ type: EnemyType; weight: number }> = [];
  for (const type of Object.keys(ENEMY_SPAWN_WEIGHTS) as EnemyType[]) {
    const weight = ENEMY_SPAWN_WEIGHTS[type];
    if (weight <= 0) continue;
    if (wave < ENEMY_DEFS[type].unlockWave) continue;
    out.push({ type, weight });
  }
  return out;
}
```

**Replace with:**

```ts
/**
 * Depth bands that re-weight the pool (plans/progress.md §7.1).
 *
 * The table above is flat in depth, so a wave-500 roster was drawn from exactly
 * the same distribution as a wave-50 one and depth only ever meant "the same
 * soup, with bigger numbers". Each band below shifts weight from the two types
 * that ask nothing of the player (`normal`, `fast`) onto the types that each
 * pose a specific question — which is the cheapest possible way to make a deep
 * wave *read* differently without a single new enemy.
 *
 * Multipliers, not replacements, so the table above stays the one place a
 * type's baseline presence is set. A band's entries are applied in full once
 * its wave is reached; bands do **not** stack (the deepest reached one wins),
 * because two multiplicative bands would quietly square a weight.
 */
export const SPAWN_WEIGHT_BANDS: ReadonlyArray<{
  minWave: number;
  label: string;
  multipliers: Partial<Record<EnemyType, number>>;
}> = [
  {
    minWave: 120,
    label: 'The line thickens',
    // Armour and bodies: the first band a tower that one-shots trash notices.
    multipliers: { normal: 0.6, fast: 0.8, tank: 2.0, shielded: 1.8, warden: 1.5 },
  },
  {
    minWave: 240,
    label: 'The clever ones',
    // Positioning problems: things that will not stand still to be shot.
    multipliers: { normal: 0.4, fast: 0.6, blinker: 2.2, burrower: 2.0, siege: 1.8, warden: 2.0 },
  },
  {
    minWave: 380,
    label: 'The deep muster',
    // Everything that punishes a single-target build, at once.
    multipliers: {
      normal: 0.3, fast: 0.5, tank: 2.0, shielded: 2.0,
      healer: 2.5, warden: 2.5, blinker: 2.0, thief: 1.8,
    },
  },
];

/** The deepest band `wave` has reached, or null below the first one. */
export function spawnBandForWave(wave: number) {
  let band: (typeof SPAWN_WEIGHT_BANDS)[number] | null = null;
  for (const b of SPAWN_WEIGHT_BANDS) {
    if (wave >= b.minWave) band = b;
  }
  return band;
}

/** Types with a non-zero weight that have unlocked by `wave`, in table order. */
export function spawnPoolForWave(wave: number): Array<{ type: EnemyType; weight: number }> {
  const out: Array<{ type: EnemyType; weight: number }> = [];
  const band = spawnBandForWave(wave);
  for (const type of Object.keys(ENEMY_SPAWN_WEIGHTS) as EnemyType[]) {
    const base = ENEMY_SPAWN_WEIGHTS[type];
    if (base <= 0) continue;
    if (wave < ENEMY_DEFS[type].unlockWave) continue;
    const weight = base * (band?.multipliers[type] ?? 1);
    if (weight <= 0) continue;
    out.push({ type, weight });
  }
  return out;
}
```

**Why this is balance-safe:** `SaveManager`'s offline averages and
`sim/model.ts`'s `typeMix` both read `spawnPoolForWave`, so the model measures
the re-weighted wave rather than the flat one. The bands move *composition*, not
totals — `waveProfile` still multiplies a share-weighted per-body figure by the
body count.

**Verify:**

```bash
npm run typecheck && npm test && npm run sim > .balance-baseline/sim-phase10a.txt 2>&1
```

**Expected:** the ladder's wall column moves by **at most one boss decade** at
each tier. The re-weighting shifts the wave's average armour and effective HP,
and the model prices that. If a tier moves more than 10 waves, halve every
multiplier above 1.0 in the band that first exceeds it and re-measure.

### Step 10.2 — Elites keep escalating

**File:** `src/systems/EnemyManager.ts`

**Find:**

```ts
const ELITE_UNLOCK_WAVE = 21;
const ELITE_SPAWN_CHANCE_BASE = 0.02;
const ELITE_SPAWN_CHANCE_MAX_WAVE = 100;
const ELITE_SPAWN_CHANCE_MAX = 0.20;
const ELITE_HP_MULT = 2.5;
/** Gold multiplier every elite carries, on top of any aura bonus. */
const ELITE_GOLD_MULT = 2.5;
```

**Replace with:**

```ts
const ELITE_UNLOCK_WAVE = 21;
const ELITE_SPAWN_CHANCE_BASE = 0.02;
const ELITE_SPAWN_CHANCE_MAX_WAVE = 100;
const ELITE_SPAWN_CHANCE_MAX = 0.20;
const ELITE_HP_MULT = 2.5;
/** Gold multiplier every elite carries, on top of any aura bonus. */
const ELITE_GOLD_MULT = 2.5;

/**
 * Depth at which an elite becomes a *champion* (plans/progress.md §7.2).
 *
 * The elite rate caps at wave 100 and nothing about an elite changes after
 * that, so from wave 100 to the wall the texture of a wave is fixed — which is
 * one of the three reasons the deep game reads as empty (§1.5).
 *
 * A champion is not a new entity: it is the same elite, with the same aura and
 * the same code path, worth twice as much on both sides of the trade. That
 * keeps the escalation to two constants and a comparison, and it keeps the
 * *decision* the same — an elite is still "kill it first or eat the aura",
 * just louder.
 */
const CHAMPION_WAVE = 150;
const CHAMPION_HP_MULT = 5.0;
const CHAMPION_GOLD_MULT = 6.0;

/** True when an elite spawned at `wave` is a champion. */
export function isChampionWave(wave: number): boolean {
  return wave >= CHAMPION_WAVE;
}

/** HP multiplier an elite carries at `wave`. */
export function eliteHpMultForWave(wave: number): number {
  return isChampionWave(wave) ? CHAMPION_HP_MULT : ELITE_HP_MULT;
}

/** Gold multiplier an elite carries at `wave`. */
export function eliteGoldMultForWave(wave: number): number {
  return isChampionWave(wave) ? CHAMPION_GOLD_MULT : ELITE_GOLD_MULT;
}
```

Then, in `spawn`, **find:**

```ts
    if (isElite) hp = Math.max(1, Math.floor(hp * ELITE_HP_MULT));
```

**Replace with:**

```ts
    if (isElite) hp = Math.max(1, Math.floor(hp * eliteHpMultForWave(wave)));
```

Then find the gold award site — **find:**

```ts
    if (enemy.elite) amount *= ELITE_GOLD_MULT;
```

**Replace with:**

```ts
    if (enemy.elite) amount *= eliteGoldMultForWave(enemy.spawnWave ?? this.currentWave);
```

> If `Enemy` has no `spawnWave` field, use `this.currentWave` alone and drop the
> `??` clause. `thief` already reads `thief.spawnWave ?? this.currentWave` a few
> hundred lines below, so the field most likely exists.

**Extend the spawn ramp** so the rate keeps climbing past wave 100 rather than
holding at 20%. **Find:**

```ts
/** Compute elite spawn chance for a given wave. */
export function eliteChanceForWave(wave: number): number {
  if (wave < ELITE_UNLOCK_WAVE) return 0;
  return Math.min(
    ELITE_SPAWN_CHANCE_MAX,
    ELITE_SPAWN_CHANCE_BASE +
      ((wave - ELITE_UNLOCK_WAVE) * (ELITE_SPAWN_CHANCE_MAX - ELITE_SPAWN_CHANCE_BASE)) /
        (ELITE_SPAWN_CHANCE_MAX_WAVE - ELITE_UNLOCK_WAVE),
  );
}
```

**Replace with:**

```ts
/** Rate the champion band climbs to, and the wave it gets there. */
const CHAMPION_SPAWN_CHANCE_MAX = 0.30;
const CHAMPION_SPAWN_CHANCE_MAX_WAVE = 400;

/**
 * Compute elite spawn chance for a given wave.
 *
 * Two ramps: 2% -> 20% over waves 21-100 (unchanged), then 20% -> 30% over
 * waves 150-400 as elites become champions. The second ramp is deliberately
 * shallower than the first — the escalation past wave 150 is meant to be
 * carried by what an elite *is* (`eliteHpMultForWave`), not by how many of
 * them there are, because body count is what `MAX_WAVE_BODIES` is capping.
 */
export function eliteChanceForWave(wave: number): number {
  if (wave < ELITE_UNLOCK_WAVE) return 0;
  const base = Math.min(
    ELITE_SPAWN_CHANCE_MAX,
    ELITE_SPAWN_CHANCE_BASE +
      ((wave - ELITE_UNLOCK_WAVE) * (ELITE_SPAWN_CHANCE_MAX - ELITE_SPAWN_CHANCE_BASE)) /
        (ELITE_SPAWN_CHANCE_MAX_WAVE - ELITE_UNLOCK_WAVE),
  );
  if (wave < CHAMPION_WAVE) return base;
  const t = Math.min(1, (wave - CHAMPION_WAVE) / (CHAMPION_SPAWN_CHANCE_MAX_WAVE - CHAMPION_WAVE));
  return ELITE_SPAWN_CHANCE_MAX + t * (CHAMPION_SPAWN_CHANCE_MAX - ELITE_SPAWN_CHANCE_MAX);
}
```

**Verify:**

```bash
npm run typecheck && npm test && npm run sim > .balance-baseline/sim-phase10b.txt 2>&1
```

**Expected:** the wall moves by at most one boss decade at each tier. Champions
are worth more gold *and* more HP, which roughly cancel; if a tier moves more
than 10 waves shallower, lower `CHAMPION_HP_MULT` to 4.0 and re-measure.

### Step 10.3 — Tell the player

**File:** `src/data/milestones.ts`

Add three entries to `FIXED_MILESTONES` so the upcoming-events strip announces
the bands, the same way it announces an enemy type:

```ts
  {
    id: 'depth:band_120',
    kind: 'enemy',
    wave: 120,
    label: 'The line thickens',
    detail: 'Armoured and shielded enemies become far more common from here.',
    icon: 'shield-bash',
    color: '#2c5b8f',
  },
  {
    id: 'depth:champions',
    kind: 'enemy',
    wave: 150,
    label: 'Champions appear',
    detail: 'Elites past this depth carry twice the HP and six times the gold.',
    icon: 'crown',
    color: '#e8a93b',
  },
  {
    id: 'depth:band_240',
    kind: 'enemy',
    wave: 240,
    label: 'The clever ones',
    detail: 'Blinkers, burrowers and siege engines crowd out the rank and file.',
    icon: 'all-seeing-eye',
    color: '#7f5af0',
  },
  {
    id: 'depth:band_380',
    kind: 'enemy',
    wave: 380,
    label: 'The deep muster',
    detail: 'Every type that punishes a single-target build, at once.',
    icon: 'nested-hexagons',
    color: '#1f7a8c',
  },
```

> If `tests/content-coverage.test.ts` asserts that every `kind: 'enemy'`
> milestone has a matching `EnemyType` `refId`, either give these a `kind` that
> has no such assertion or relax that assertion to skip entries whose id starts
> `depth:`. Report which you did.

**Verify Phase 10:**

```bash
npm run typecheck && npm test && npm run checks && npm run sim > /dev/null
```

---

## Phase 11 — Documentation

Every phase above changed something a doc asserts. This phase makes the docs
true again. None of it is optional: this codebase's docs are load-bearing —
several of them are the only written record of *why* a constant is what it is.

Work through the table. For each row, open the doc, find the paragraph or table
the "what to change" column names, and rewrite it to match the code as it now
stands. Where a number is quoted, take it from `npm run sim`'s latest output
rather than from this document.

| File | What to change |
|---|---|
| `docs/wave-system.md` | The spawn cadence section: `spawnIntervalForWave` is now a *window* (`SPAWN_WINDOW_SECONDS`), and `nominalSpawnIntervalForWave` is what the enrage budget reads. State why the two differ (Phase 5's invariant). Add `MAX_WAVE_BODIES` and the fact that the roster caps at 120 from wave 98. |
| `docs/enemy-system.md` | Add a `crowdCompression` section: what it multiplies (HP, gold, XP), what it deliberately does not (damage), and the wave-total invariant. Add the `SPAWN_WEIGHT_BANDS` table from Phase 10.1 and the champion escalation from 10.2. |
| `docs/prestige-system.md` | Add `ap_deep_stores`, `ap_forward_camp` and `tp_foundry` to the perk tables. Replace the AP-formula paragraph with the `AP_DEPTH_GROWTH` reasoning from Phase 4.1. Add a "Deployment" section describing the checkpoint rule and what a deploy does *not* pay. |
| `docs/upgrade-system.md` | Add the cap-extension section: the three sources, the scalar-only exclusion list and why coverage lines are excluded, and the measured 219 → 419 → 539 bracket. |
| `docs/research-system.md` | Add `field_studies` to the node table (19 nodes now). State that it is time-gated rather than cost-gated, give the level-15 figure (30 days), and say why it grants gold rather than damage. |
| `docs/watch-system.md` | Update the chapter table with Phase 7's new depth, level and count gates. Add `deep_stores` to the unlock catalogue and its consumer. |
| `docs/blessing-system.md` | Replace the flat "Cap: 30 picks per run" row with `blessingPickCapForWave`. Add the greater tier and the `minPicks` gate. |
| `docs/save-system.md` | Save version 24 → 25. Add `deployment` to the format description and `migrateV24toV25` to the migration ladder. |
| `docs/game-loop.md` | Already corrected in Phase 1.5a — verify no other `6.5x` remains: `grep -n "6.5x" docs/`. |
| `docs/testing.md` | Already updated in Phase 2.3 — verify the ladder section is present. |
| `docs/core-system.md` | Already annotated in Phase 1.5e. |
| `AGENTS.md` | Content-at-a-glance table: AP perks / TP perks 23 / 18 → **25 / 19** (`ap_deep_stores`, `ap_forward_camp`, `tp_foundry`), blessings 30 → **38**, research nodes 18 → **19**, Watch unlocks 20 → **21**, save version 24 → **25**. Add `sim/ladder.ts` to the commands section next to `npm run sim`. |
| `plans/progress.md` | Add a line under **Status** recording which phases of this document have landed, so the diagnosis and the work order do not drift apart. |

**Verify:**

```bash
grep -rn "6.5x\|maxLevel = 200\|BLESSING_MAX_PICKS = 30\b" docs/ AGENTS.md
```

**Expected:** no hits that assert a value the code no longer has. A hit inside a
sentence explaining what a value *used to be* is fine and should be left.

---

## Final gate

```bash
npm run typecheck && npm test && npm run checks && npm run build
```

All four must pass. Then:

```bash
npm run sim > .balance-baseline/sim-final.txt 2>&1 && tail -50 .balance-baseline/sim-final.txt
```

**The acceptance criteria for the whole plan** — read them off the verdict block
at the end of the sim output:

```
T1  wall advances >= 8/run from run 5: ok
T2  wave 450 reached by run 30:        ok
T3  run <= 45 min at 4.5x:             ok
T4  >= 50% of run minutes at risk:     ok
```

If any line reads `FAIL`, the phase that owns it is:

| line | owner | first thing to check |
|---|---|---|
| T1 | Phase 4 (and Phase 3) | is `AP_DEPTH_GROWTH` 1.03, and does the ladder model buy the cap extension (step 4.4)? |
| T2 | Phase 4 | same |
| T3 | Phase 5 and 6 | is `SPAWN_WINDOW_SECONDS` reaching `WaveManager` (step 5.2b), and is `deployFrom` subtracted (step 6.13)? |
| T4 | Phase 6 | does the at-risk loop start at `deployFrom + 1`? |

Then run the in-browser check:

```bash
npm run dev
```

and confirm by hand, in this order:

1. The Upgrades tab shows a level ceiling on `Sharper Arrows` and the ×Max
   button still stops at it.
2. The Prestige tab lists **Deep Stores** and **Forward Camp**, and both show a
   bonus line rather than a blank next to their price.
3. The Transcendence tab lists **Foundry** with a `+50% level caps` line.
4. With Forward Camp unbought, the **Deploy** button is hidden. Buying it (via
   the debug handle `window.__theTower`) makes it appear, disabled, until a
   checkpoint exists.
5. A wave past 100 visibly spawns its roster in roughly 24 seconds rather than
   trickling for a minute.

---

## Appendix A — Content specified but not scheduled

Three pieces from progress.md §7 are **not** in the phases above, and each is
listed here with everything needed to build it. None of them is required for
T1–T4; all three are additive and can be done in any order, after Phase 11.

### A.1 — Three new enemy types (progress.md §7.1)

`EnemyType` is a closed union and almost every table over it is a
`Record<EnemyType, …>`, so `tsc` enumerates the work: add the union member
first, then fix every compile error in order. The complete list of sites, in the
order the compiler will surface them:

| File | Symbol | What to add |
|---|---|---|
| `src/types.ts` | `EnemyType` | the three members |
| `src/data/enemies.ts` | `ENEMY_LABELS` | display name |
| `src/data/enemies.ts` | `ENEMY_GAIT` | `freq` / `bob` / `squash` / `float` |
| `src/data/enemies.ts` | `ENEMY_DEFS` | the stat block below |
| `src/data/enemies.ts` | `ENEMY_CODEX` | `tagline` / `description` / `answer` / `effects` |
| `src/data/enemies.ts` | `ENEMY_SPAWN_WEIGHTS` | draw weight |
| `src/data/enemies.ts` | `ENEMY_BEHAVIOR_CONSUMERS` | the sentence naming where the behaviour lives |
| `src/data/pacing.ts` | `ENEMY_THREAT_CLASS` | `'threat'` for all three |
| `src/data/xpTables.ts` | `KILL_XP_WEIGHT` | attention weight |
| `src/data/contracts.ts` | `CONTRACT_ENEMY_LABELS` | plural label |
| `src/data/milestones.ts` | `ENEMY_INTRO_MILESTONES` | name + colour |
| `src/systems/EnemyManager.ts` | `tick` | the behaviour |
| `src/game/Renderer.ts` | the shape switch | reuse an existing `EnemyShape` |

Stat blocks, sized against `warden` (the deepest existing type) and scaled on
the same `baseHP` ≈ 9–14 band, so total wave HP is unaffected — these types
*replace* draw weight rather than adding it, exactly as the §2.4 note in
`ENEMY_SPAWN_WEIGHTS` describes. Take the weight from `normal` (5 → 3) and
`fast` (3 → 2), which is the same trade the last five behavioural types made.

```ts
  harbinger: {
    type: 'harbinger',
    icon: 'skull-crack',
    baseHP: 13, baseSpeed: world(40), armor: 1, magicResist: 0.1,
    baseDamage: 3, fireRate: 0.9, baseGold: 3,
    unlockWave: 120, radius: entity(17),
    color: '#5b3a7a', borderColor: '#c9a6f5', shape: 'hex',
    rpChance: 0.04,
  },
  leech: {
    type: 'leech',
    icon: 'crystal-shine',
    baseHP: 10, baseSpeed: world(50), armor: 0, magicResist: 0.3,
    baseDamage: 2, fireRate: 1.0, baseGold: 3,
    unlockWave: 180, radius: entity(14),
    color: '#1d6b6b', borderColor: '#8ff0e6', shape: 'diamond',
    rpChance: 0.04,
  },
  chorus: {
    type: 'chorus',
    icon: 'beveled-star',
    baseHP: 11, baseSpeed: world(42), armor: 1, magicResist: 0.15,
    baseDamage: 3, fireRate: 0.9, baseGold: 3,
    unlockWave: 240, radius: entity(15),
    color: '#8a6d1f', borderColor: '#ffe9a3', shape: 'circle',
    rpChance: 0.04,
  },
```

Behaviours, each stated as the verb it demands (the rule
`docs/enemy-system.md` states — a type that is only a stat block does not
belong in the table):

- **Harbinger** (wave 120) — every `harbingerInterval` (6 s) it makes every
  ally within `harbingerRange` (`world(200)`) untargetable for
  `harbingerPhase` (2 s). *Answer:* burst windows — a pure sustained-DPS build
  wastes half its uptime. Implement through the existing untargetable
  predicate; do **not** add a second invulnerability flag (see the comment
  above `PRIORITY_TARGET_ORDER`).
- **Leech** (wave 180) — on contact it drains `leechManaSteal` (8) mana and
  converts it into an absorb shield on itself worth `leechShieldPerMana` (3 ×
  its own `baseHP`) per point. *Answer:* the mana economy becomes a defensive
  resource; Meditation and Mana Well stop being purely offensive purchases.
  Reuse the warden's absorb-shield field rather than adding a second one.
- **Chorus** (wave 240) — spawns as three bodies sharing one HP pool; damage to
  any one is applied to the pool and the other two flash. *Answer:* coverage
  over single-target — pierce and splash hit the pool three times per volley.
  Reuse the splitter's linked-spawn plumbing for the group id.

Every constant above goes in `ENEMY_BEHAVIOR` alongside the existing ones, and
every number quoted in a codex `effects` line must be interpolated from it —
never typed as a literal.

**Icons:** the three ids above (`skull-crack`, `crystal-shine`,
`beveled-star`) are already in the committed `public/icons/sprite.svg` and are
currently unused, so no `npm run icons` network fetch is needed.

### A.2 — Ordeal bosses (progress.md §7.3)

Data-only half, which is worth doing on its own:

- Every 100 waves a boss gains one extra phase threshold. `BOSS_ENCOUNTER.phaseThresholds`
  becomes a function of wave: `[0.66, 0.33]` below 200, `[0.75, 0.50, 0.25]`
  from 200, `[0.80, 0.60, 0.40, 0.20]` from 300, and so on to a cap of six
  thresholds. `bossPatternForPhase` already indexes by phase, so each new
  threshold draws another pattern from the existing four.
- Waves 200, 300, 400 … are **Ordeals**: a named boss (`ORDEAL_NAMES` keyed by
  the hundred), its own bar colour, and a guaranteed legendary drop
  (`rollDrop(wave, 'boss', { guaranteed: true, rarityBoost: 4 })`).

The two new patterns progress.md §7.3 describes (`tether`, `eclipse`) need real
combat code in `EnemyManager.tickBoss` and are **not** specified here.

### A.3 — Gear reforging (progress.md §7.5)

`rollRarity`'s depth ramp saturates at wave 100, so gear is a solved axis from
there on. A reforge sink fixes that and gives gold a second late home:

- `EquipmentManager.reforge(ids: string[])` — takes exactly three inventory
  items of the same rarity and slot-agnostic, consumes them and returns one
  item of the next rarity up, rolled at the deepest of the three items'
  `level`. Legendaries combine into `legendary` with `level` set to the deepest
  input's level plus 25, which is what makes the sell value and the stat roll
  keep climbing.
- Gold cost: `equipmentSellValue` of the most valuable input × 3, so the sink
  scales with wave income exactly the way the sell curve does.
- UI: one button in the equipment panel, enabled when three items of the same
  rarity are selected.

---

## Appendix B — Every file this plan touches

Cross-check before you start, and again at the end. A file in this list that
your diff does not contain means a step was skipped.

**New files**

- `sim/ladder.ts` (Phase 2)
- `src/data/upgradeCaps.ts` (Phase 3)

**Data**

- `src/data/formulas.ts` — Phase 5
- `src/data/prestige.ts` — Phases 3, 4, 6
- `src/data/upgrades.ts` — *not modified* (the caps stay as the base)
- `src/data/watch.ts` — Phases 3, 7
- `src/data/blessings.ts` — Phase 8
- `src/data/research.ts` — Phase 9
- `src/data/enemies.ts` — Phase 10
- `src/data/xpTables.ts` — Phase 5
- `src/data/milestones.ts` — Phase 10

**Systems**

- `src/systems/UpgradeManager.ts` — Phase 3
- `src/systems/PrestigeManager.ts` — Phases 3, 6
- `src/systems/WaveManager.ts` — Phase 5
- `src/systems/EnemyManager.ts` — Phases 5, 10
- `src/systems/BlessingManager.ts` — Phase 8
- `src/systems/SaveManager.ts` — Phases 5, 6
- `src/systems/ResearchTree.ts` — Phase 9

**Core**

- `src/types.ts` — Phases 1, 6
- `src/game/Game.ts` — Phases 1, 3, 5, 6
- `src/stats/keys.ts` — Phase 3
- `src/stats/context.ts` — Phases 3, 9
- `src/stats/contributors/prestige.ts` — Phase 3

**UI**

- `src/ui/UpgradePanel.ts` — Phase 3
- `src/ui/TranscendencePanel.ts` — Phase 3
- `src/ui/PrestigePanel.ts` — Phase 6
- `src/main.ts` — Phase 6
- `src/styles/main.css` — Phase 6

**Sim**

- `sim/model.ts` — Phases 3, 5
- `sim/balance.ts` — Phase 2

**Tests**

- `tests/systems.test.ts` — Phase 1
- `tests/formulas.test.ts` — Phases 4, 5
- `tests/enemies.test.ts` — Phase 5
- `tests/prestige-ap.test.ts` — Phases 3, 6
- `tests/save.test.ts` — Phase 6
- `tests/watch.test.ts` — Phase 7
- `tests/blessings.test.ts` — Phase 8
- `tests/research-economy.test.ts` — Phase 9

**Docs** — Phase 11, listed in that phase's table.
