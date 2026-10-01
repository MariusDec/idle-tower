/**
 * The pacing report (§13): a fresh profile, played by the active bot over
 * the real sim for N simulated hours. It buys in the Forge between runs and
 * checks the invariants this phase can see (§8.4):
 *
 *   I3  every results screen shows an affordable node, or ≥ 50% toward one
 *   I6  no gap between reveals longer than 10 min (in the first 2 h)
 *   P3  wave 20 is first reached within 15–30 min
 *
 *   npm run pacing                       one hour, seed 1
 *   npm run pacing -- --hours 2 --seed 3
 *   npm run pacing -- --csv reveals.csv  also write the reveal timeline
 *   npm run pacing -- --seeds 8          eight profiles: pass counts and the
 *                                        median first wave 20 (the gate's reading)
 *
 * Times are the player's wall clock: sim time divided by the game speed,
 * plus the moments a person spends on drafts and between runs.
 */
import { writeFileSync } from 'node:fs';
import { createRun, step } from '../src/sim/run';
import { cardKey } from '../src/sim/systems/draft';
import { SIM_DT } from '../src/app/loop';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile, type Profile } from '../src/meta/profile';
import { maxSpeed, runSpeed } from '../src/meta/automation';
import { buyNode, canAfford, levelOf, nodeCost, nodeStates } from '../src/meta/forge';
import { bankRun } from '../src/meta/results';
import { BRANCH_NAME, FORGE, FORGE_BY_ID } from '../src/content/forge';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { Rng } from '../src/core/rng';
import { formatDuration } from '../src/core/format';
import type { BranchId } from '../src/content/types';
import { botInput } from './bot';

/** Wall seconds an active player spends on a draft, and on the first (paused) one. */
const DRAFT_SECONDS = 2;
const FIRST_DRAFT_SECONDS = 5;
/** Wall seconds between runs: the results screen, plus shopping when there is shopping. */
const BETWEEN_RUNS = { idle: 6, shopping: 15 };
/** A run that outlives this is cut off (P3 has no boss to end it). */
const MAX_RUN_SECONDS = 3600;
/** The milestone waves that count as reveals (§7.1). */
const MILESTONE_WAVES = [10, 15, 20];
/** I6: the longest a player may go without something new (§7.2). */
const MAX_REVEAL_GAP = 10 * 60;
/** I6 only applies to the first two hours. */
const I6_WINDOW = 2 * 3600;

export interface Reveal {
  /** Wall seconds since the profile was made. */
  at: number;
  what: string;
}

export interface RunRow {
  n: number;
  /** Wall seconds when the run started. */
  start: number;
  wave: number;
  /** Sim seconds the run lasted. */
  simSeconds: number;
  /** Wall seconds it took, drafts included. */
  wallSeconds: number;
  speed: number;
  shards: number;
  /** I3's measure at this results screen: 1 when a node is affordable. */
  nextProgress: number;
  bought: string[];
}

export interface PacingReport {
  seconds: number;
  runs: RunRow[];
  reveals: Reveal[];
  firstWave20: number | null;
  /** The longest gap between reveals inside I6's window, and where it starts. */
  worstGap: { seconds: number; from: number };
  i3: boolean;
  i6: boolean;
  wave20: boolean;
}

/**
 * The active bot's shopping: the cheapest buyable level first, again and
 * again, until nothing is affordable — what the results screen's "Next:"
 * line points at. Speed goes to the fastest unlocked.
 */
export function shop(profile: Profile): string[] {
  const bought: string[] = [];
  for (;;) {
    let best: string | null = null;
    let bestCost = Infinity;
    for (const n of FORGE) {
      if (!canAfford(profile, n.id)) continue;
      const cost = nodeCost(n, levelOf(profile, n.id));
      if (cost < bestCost) {
        bestCost = cost;
        best = n.id;
      }
    }
    if (!best || !buyNode(profile, best)) break;
    bought.push(best);
  }
  profile.settings.speed = maxSpeed(profile);
  return bought;
}

export function runPacing(hours: number, seed: number): PacingReport {
  const profile = newProfile(0);
  const seeds = new Rng(seed);
  const end = hours * 3600;
  const reveals: Reveal[] = [];
  const runs: RunRow[] = [];
  const reached = new Set<number>();
  const branches = new Set<BranchId>();
  let clock = 0;
  let firstWave20: number | null = null;
  let i3 = true;

  /** A branch's first node on the web, fog included, is a reveal; the starting three are not. */
  const revealBranches = (log: boolean): void => {
    const states = nodeStates(profile);
    for (const n of FORGE) {
      if (states.get(n.id) !== 'hidden' && !branches.has(n.branch)) {
        branches.add(n.branch);
        if (log) reveals.push({ at: clock, what: `branch: ${BRANCH_NAME[n.branch]}` });
      }
    }
  };
  revealBranches(false);

  while (clock < end) {
    const start = clock;
    const speed = runSpeed(profile);
    const run = createRun(buildRunConfig(profile), seeds.nextU32());
    const seenCards = new Set(profile.seenCards);
    const newCards: string[] = [];
    let wall = 0;
    let lastDraft = null as unknown;
    const maxTicks = Math.round(MAX_RUN_SECONDS / SIM_DT);
    while (!run.outcome && run.tick < maxTicks) {
      const at = start + run.time / speed + wall;
      if (run.draft && run.draft !== lastDraft) {
        lastDraft = run.draft;
        const first = !profile.tutorial.firstDraft;
        wall += first ? FIRST_DRAFT_SECONDS : DRAFT_SECONDS;
        if (first) reveals.push({ at, what: 'the draft' });
        for (const c of run.draft.cards) {
          const key = cardKey(c);
          if (seenCards.has(key)) continue;
          seenCards.add(key);
          if (c.kind !== 'fallback') {
            newCards.push(key);
            reveals.push({ at, what: `card: ${key}` });
          }
        }
        profile.tutorial.firstDraft = true;
      }
      step(run, SIM_DT, botInput(run, 'active'));
      for (const ev of run.events) {
        if (ev.kind === 'firstSight' && !profile.seenEnemies.includes(ev.enemy)) {
          reveals.push({ at, what: `enemy: ${ENEMY_BY_ID[ev.enemy].name}` });
        } else if (ev.kind === 'waveStart' && MILESTONE_WAVES.includes(ev.wave) && !reached.has(ev.wave)) {
          reached.add(ev.wave);
          reveals.push({ at, what: `wave ${ev.wave}` });
          if (ev.wave === 20) firstWave20 = at;
        }
      }
      run.events.length = 0;
    }
    profile.seenCards = [...seenCards];
    wall += run.time / speed;
    clock = start + wall;
    const summary = bankRun(profile, run, newCards);
    if (runs.length === 0) reveals.push({ at: clock, what: 'results and the Forge' });
    const progress = summary.next?.progress ?? 1;
    if (progress < 0.5) i3 = false;

    const bought = shop(profile);
    for (const id of bought) {
      const n = FORGE_BY_ID[id];
      if (n.type !== 'minor' && levelOf(profile, id) === 1) reveals.push({ at: clock, what: `notable: ${n.name}` });
    }
    revealBranches(true);
    runs.push({
      n: runs.length + 1,
      start,
      wave: summary.wave,
      simSeconds: run.time,
      wallSeconds: wall,
      speed,
      shards: summary.shards,
      nextProgress: progress,
      bought,
    });
    clock += bought.length > 0 ? BETWEEN_RUNS.shopping : BETWEEN_RUNS.idle;
  }

  reveals.sort((a, b) => a.at - b.at);
  const window = Math.min(clock, I6_WINDOW);
  let worstGap = { seconds: 0, from: 0 };
  let prev = 0;
  for (const r of [...reveals.filter((x) => x.at <= window), { at: window, what: 'end' }]) {
    if (r.at - prev > worstGap.seconds) worstGap = { seconds: r.at - prev, from: prev };
    prev = r.at;
  }
  return {
    seconds: clock,
    runs,
    reveals,
    firstWave20,
    worstGap,
    i3,
    i6: worstGap.seconds <= MAX_REVEAL_GAP,
    wave20: firstWave20 !== null && firstWave20 >= 15 * 60 && firstWave20 <= 30 * 60,
  };
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function pad(v: string | number, n: number): string {
  return String(v).padStart(n);
}

/** The P3 gate's reading over several profiles: one lucky run shouldn't decide it. */
export function medianWave20(reports: readonly PacingReport[]): number | null {
  const times = reports.map((r) => r.firstWave20 ?? Infinity).sort((a, b) => a - b);
  const m = times[times.length >> 1];
  return Number.isFinite(m) ? m : null;
}

function main(): void {
  const hours = Number(arg('hours', '1'));
  const seed = Number(arg('seed', '1'));
  const seeds = Number(arg('seeds', '0'));
  if (seeds > 0) {
    const reports = Array.from({ length: seeds }, (_, i) => runPacing(hours, i + 1));
    const count = (f: (r: PacingReport) => boolean): string => `${reports.filter(f).length}/${seeds}`;
    const w20 = reports.map((r) => (r.firstWave20 === null ? 'never' : formatDuration(r.firstWave20)));
    const median = medianWave20(reports);
    console.log(`pacing · ${hours} h · ${seeds} profiles`);
    console.log(`  I3 passes ${count((r) => r.i3)} · I6 passes ${count((r) => r.i6)}`);
    console.log(`  worst reveal gaps: ${reports.map((r) => formatDuration(r.worstGap.seconds)).join(' ')}`);
    console.log(`  first wave 20: ${w20.join(' ')}`);
    console.log(`  ${median !== null && median >= 900 && median <= 1800 ? 'PASS' : 'FAIL'}  P3  median first wave 20 ${median === null ? 'never' : formatDuration(median)} (want 15:00–30:00)`);
    return;
  }
  const csv = arg('csv', '');
  const r = runPacing(hours, seed);
  console.log(`pacing · ${hours} h · seed ${seed} · ${r.runs.length} runs\n`);
  console.log('  run   start  wave    sim   wall  spd  shards  next  bought');
  for (const x of r.runs) {
    const bought = x.bought.map((id) => FORGE_BY_ID[id].name);
    const grouped = [...new Set(bought)].map((b) => {
      const k = bought.filter((y) => y === b).length;
      return k > 1 ? `${b} ×${k}` : b;
    });
    console.log(
      `${pad(x.n, 5)} ${pad(formatDuration(x.start), 7)} ${pad(x.wave, 5)} ${pad(formatDuration(x.simSeconds), 6)}`
      + ` ${pad(formatDuration(x.wallSeconds), 6)} ${pad(`${x.speed}×`, 4)} ${pad(x.shards, 7)}`
      + ` ${pad(`${Math.floor(x.nextProgress * 100)}%`, 5)}  ${grouped.join(', ')}`,
    );
  }
  console.log('\nreveals:');
  for (const v of r.reveals) console.log(`  ${pad(formatDuration(v.at), 7)}  ${v.what}`);
  console.log('\nverdicts:');
  const mark = (ok: boolean): string => (ok ? 'PASS' : 'FAIL');
  console.log(`  ${mark(r.i3)}  I3  every results screen shows a node at ≥ 50%`);
  console.log(`  ${mark(r.i6)}  I6  longest gap between reveals ${formatDuration(r.worstGap.seconds)} (from ${formatDuration(r.worstGap.from)}; max 10:00)`);
  console.log(`  ${mark(r.wave20)}  P3  wave 20 first reached at ${r.firstWave20 === null ? 'never' : formatDuration(r.firstWave20)} (want 15:00–30:00)`);
  if (csv) {
    writeFileSync(csv, ['seconds,reveal', ...r.reveals.map((v) => `${v.at.toFixed(1)},"${v.what}"`)].join('\n') + '\n');
    console.log(`\nreveal timeline written to ${csv}`);
  }
}

// Only when run as the script, so tests can import `runPacing`.
if (process.argv[1]?.includes('pacing')) main();
