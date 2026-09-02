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
import { setUpgradeCapExtension } from '../src/data/upgradeCaps.ts';

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
    // The ladder's player buys the ceiling as soon as they can afford it; the
    // greedy buyer only prices *gold* purchases, so the perk has to be modelled
    // here. 4 500 AP is `ap_deep_stores` maxed, 702 TP is `tp_foundry` maxed.
    setUpgradeCapExtension(
      (lifetimeAP >= 4500 ? 1.0 : 0) + (tpForAP(lifetimeAP) >= 702 ? 4.0 : 0),
    );
    const sampleWaves = Array.from({ length: 3000 }, (_, i) => i + 1);
    // Forward Camp 3 deploys at 85% of the deepest 50-wave checkpoint, so the
    // run the player actually plays starts there rather than at wave 1. The
    // model has no checkpoint store, so the deploy wave is derived from the
    // previous run's wall, which is the same number by construction.
    const deployFrom = previousWall > 0
      ? Math.floor((previousWall * 0.85) / 50) * 50
      : 0;
    const r = simulateRun({
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
      sampleWaves,
      blessings,
      maxWave: 3000,
      seed: LADDER_SEED,
    });
    // `simulateRun` always walks from wave 1; the deploy skips everything below
    // `deployFrom`, so the run's real length is the tail. The sample at the
    // deploy wave carries the elapsed time up to it.
    const skipped = deployFrom > 0 ? (r.samples.get(deployFrom)?.elapsedSec ?? 0) : 0;
    const playedSeconds = Math.max(0, r.durationSec - skipped);
    const banked = apForWave(r.wallWave);
    lifetimeAP += banked;

    // T4: a wave is "at risk" when the tower's kill time exceeds the time the
    // portal needs to emit the roster. Below that line the wave's length is a
    // spawn queue and the tower is never in danger, however deep it is.
    let atRisk = 0;
    // Seeded with the skipped time, so the first counted wave's `dt` is its
    // own length rather than everything the deploy jumped over.
    let previousElapsed = skipped;
    for (let w = deployFrom + 1; w <= r.wallWave; w++) {
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
      runSeconds: playedSeconds,
      apBanked: banked,
      tpIfTranscend: tpForAP(lifetimeAP),
      atRiskTimeShare: playedSeconds > 0 ? atRisk / playedSeconds : 0,
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
