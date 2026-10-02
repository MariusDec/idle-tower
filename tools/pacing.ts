/**
 * The pacing report (§13): a fresh profile, played by the active bot over
 * the real sim for N simulated hours. Between runs it buys in the Forge,
 * claims feats and pushes to the frontier region, and it checks the
 * invariants (§8.4):
 *
 *   I1a boss 1 first falls within 20–40 min (P4's gate: 25–40)
 *   I1b the Act 1 finale first falls within 7–12 h (needs --hours 12)
 *   I3  every results screen shows an affordable node, or ≥ 50% toward one
 *   I6  no gap between reveals longer than 10 min (in the first 2 h)
 *   P3  wave 20 is first reached within 15–30 min
 *
 *   npm run pacing                       one hour, seed 1
 *   npm run pacing -- --hours 2 --seed 3
 *   npm run pacing -- --csv reveals.csv  also write the reveal timeline
 *   npm run pacing -- --seeds 8          eight profiles: pass counts and the
 *                                        medians (the gates' reading)
 *   npm run pacing -- --hours 12 --seeds 8
 *                                        the full report, Act 1 to its end (P7's gate)
 *   npm run pacing -- --idle --seeds 4   the idle bot (tools/idle.ts): I2 and I5
 *   npm run pacing -- --act2 --hours 12 --seeds 4
 *                                        Act 2 (tools/act2.ts, P8's gate): from the
 *                                        Blight's fall, N hours of heat, stars and the
 *                                        Abyss; heat 1–10 at the frontier, timed
 *
 * Times are the player's wall clock: sim time divided by the game speed,
 * plus the moments a person spends on drafts and between runs.
 */
import { writeFileSync } from 'node:fs';
import { createRun } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile, type Profile } from '../src/meta/profile';
import { runSpeed } from '../src/meta/automation';
import { levelOf, nodeStates } from '../src/meta/forge';
import { bankRun } from '../src/meta/results';
import { frontier, hubUnlocks } from '../src/meta/collection';
import { claimAll } from '../src/meta/feats';
import { BRANCH_NAME, FORGE, FORGE_BY_ID } from '../src/content/forge';
import { BOSSES, BOSS_BY_ID } from '../src/content/bosses';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { EVOLUTION_BY_ID } from '../src/content/evolutions';
import { RELIC_BY_ID } from '../src/content/relics';
import { Rng } from '../src/core/rng';
import { formatDuration } from '../src/core/format';
import type { BranchId } from '../src/content/types';
import { playRun } from './play';
import { shop } from './shop';
import { CHECKIN_EVERY, SESSION, farmRatio, runIdle } from './idle';
import { runAct2, type Act2Report } from './act2';
import { IN_WORKER, parallel, workerJobs } from './parallel';

/** Wall seconds between runs: the results screen, plus shopping when there is shopping. */
const BETWEEN_RUNS = { idle: 6, shopping: 15 };
/** The milestone waves that count as reveals (§7.1). */
const MILESTONE_WAVES = [10, 15, 20];
/** I6: the longest a player may go without something new (§7.2). */
const MAX_REVEAL_GAP = 10 * 60;
/** I5's checkpoints by the clock: the first results past these many wall seconds (Region 2's in Region 2). */
const CHECKPOINT_REGION_1 = 20 * 60;
const CHECKPOINT_REGION_2 = 50 * 60;
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
  region: number;
  /** Seconds the boss took to fall, or null if it stood or never came. */
  bossKilledIn: number | null;
}

export interface PacingReport {
  seconds: number;
  runs: RunRow[];
  reveals: Reveal[];
  firstWave20: number | null;
  /** Wall seconds when each boss first fell, by id. */
  bossKills: Record<string, number>;
  /** Wall seconds of the first evolution (§7.1 aims at 1.5–2 h); null if none yet. */
  firstEvolution: number | null;
  /** The longest gap between reveals inside I6's window, and where it starts. */
  worstGap: { seconds: number; from: number };
  /**
   * Copies of the profile at moments I5 compares the players at (§8.4):
   * `region-1` and `region-2` at the first results past 20 and 50 min
   * (the second in Region 2), and each boss's id
   * after the run it first fell in, once the Forge is shopped.
   */
  checkpoints: { label: string; at: number; profile: Profile }[];
  i1a: boolean;
  /** I1's second half: the finale first fell within 7–12 h. */
  i1b: boolean;
  i3: boolean;
  i6: boolean;
  wave20: boolean;
}

/** I1's first half (§8.4): boss 1's first kill, in wall seconds. */
const I1A = { min: 20 * 60, max: 40 * 60 };
/** I1's second half (§8.4): the Act 1 finale's first kill, in wall seconds. */
export const I1B = { min: 7 * 3600, max: 12 * 3600 };
/** The boss whose fall ends Act 1. */
export const FINALE = BOSSES.find((b) => b.finale)!.id;

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
  let firstEvolution: number | null = null;
  const bossKills: Record<string, number> = {};
  const metBosses = new Set<string>();
  const seenAuras = new Set<string>();
  let tabs = hubUnlocks(profile);
  let i3 = true;
  const checkpoints: PacingReport['checkpoints'] = [];
  const checkpoint = (label: string): void => {
    if (!checkpoints.some((c) => c.label === label)) checkpoints.push({ label, at: clock, profile: structuredClone(profile) });
  };

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
    const played = playRun(profile, run, {
      policy: 'active',
      speed,
      onDraft: (fresh, first, wall) => {
        if (first) reveals.push({ at: start + wall, what: 'the draft' });
        for (const key of fresh) reveals.push({ at: start + wall, what: `card: ${key}` });
      },
      onEvent: (ev, wall) => {
        const at = start + wall;
        if (ev.kind === 'firstSight' && !profile.seenEnemies.includes(ev.enemy)) {
          reveals.push({ at, what: `enemy: ${ENEMY_BY_ID[ev.enemy].name}` });
        } else if (ev.kind === 'waveStart' && MILESTONE_WAVES.includes(ev.wave) && !reached.has(ev.wave)) {
          reached.add(ev.wave);
          reveals.push({ at, what: `wave ${ev.wave}` });
          if (ev.wave === 20) firstWave20 = at;
        } else if (ev.kind === 'bossArrive' && !metBosses.has(ev.boss)) {
          metBosses.add(ev.boss);
          reveals.push({ at, what: `boss: ${BOSS_BY_ID[ev.boss].name} arrives` });
        } else if (ev.kind === 'bossKill' && ev.first && !(ev.boss in bossKills)) {
          bossKills[ev.boss] = at;
          reveals.push({ at, what: `boss: ${BOSS_BY_ID[ev.boss].name} falls` });
        } else if (ev.kind === 'eliteSpawn' && !seenAuras.has(ev.aura ?? 'plain')) {
          // Each aura is a new enemy to read (§7.2), the plain elite included.
          seenAuras.add(ev.aura ?? 'plain');
          reveals.push({ at, what: `elite: ${ev.aura ?? 'plain'}` });
        } else if (ev.kind === 'evolve' && !profile.recipes.found.includes(ev.evolution)) {
          firstEvolution ??= at;
          reveals.push({ at, what: `evolution: ${EVOLUTION_BY_ID[ev.evolution].name}` });
        } else if (ev.kind === 'relicDrop' && !(profile.relics[ev.relic] > 0)) {
          reveals.push({ at, what: `relic: ${RELIC_BY_ID[ev.relic].name}` });
        }
      },
    });
    const wall = played.wall;
    clock = start + wall;
    const summary = bankRun(profile, run, played.newCards, speed);
    if (runs.length === 0) reveals.push({ at: clock, what: 'results and the Forge' });
    const progress = summary.next?.progress ?? 1;
    if (progress < 0.5) i3 = false;
    for (const u of summary.unlocks) reveals.push({ at: clock, what: `unlock: ${u}` });
    const now = hubUnlocks(profile);
    for (const k of ['map', 'collection', 'feats'] as const) {
      if (now[k] && !tabs[k]) reveals.push({ at: clock, what: `tab: ${k}` });
    }
    tabs = now;
    // The active player claims what waits in Feats, and pushes the frontier.
    if (tabs.feats) claimAll(profile);
    profile.region = frontier(profile).index;

    const bought = shop(profile);
    for (const id of bought) {
      const n = FORGE_BY_ID[id];
      if (n.type !== 'minor' && levelOf(profile, id) === 1) reveals.push({ at: clock, what: `notable: ${n.name}` });
    }
    revealBranches(true);
    if (clock >= CHECKPOINT_REGION_1) checkpoint('region-1');
    if (clock >= CHECKPOINT_REGION_2 && profile.region === 2) checkpoint('region-2');
    if (summary.boss?.first) checkpoint(summary.boss.id);
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
      region: summary.regionId,
      bossKilledIn: summary.boss?.killedIn ?? null,
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
  const boss1 = bossKills.gatekeeper ?? null;
  const finale = bossKills[FINALE] ?? null;
  return {
    seconds: clock,
    runs,
    reveals,
    firstWave20,
    bossKills,
    firstEvolution,
    worstGap,
    checkpoints,
    i1a: boss1 !== null && boss1 >= I1A.min && boss1 <= I1A.max,
    i1b: finale !== null && finale >= I1B.min && finale <= I1B.max,
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

/** The median of a per-profile time over several profiles: one lucky run shouldn't decide a gate. */
function medianOf(reports: readonly PacingReport[], at: (r: PacingReport) => number | null): number | null {
  const times = reports.map((r) => at(r) ?? Infinity).sort((a, b) => a - b);
  const m = times[times.length >> 1];
  return Number.isFinite(m) ? m : null;
}

/** The P3 gate's reading: the median first wave 20. */
export function medianWave20(reports: readonly PacingReport[]): number | null {
  return medianOf(reports, (r) => r.firstWave20);
}

/** The P4 gate's reading: the median first kill of a boss. */
export function medianBossKill(reports: readonly PacingReport[], boss: string): number | null {
  return medianOf(reports, (r) => r.bossKills[boss] ?? null);
}

/** I2's band (§8.4): Act 1 for the idle bot, in days. */
export const I2_DAYS = { min: 5, max: 10 };
/** I5's band (§8.4): active shards per hour over idle, at the same Forge state. */
export const I5_RATIO = { min: 1.15, max: 1.5 };
/**
 * The checkpoints I5 is held to: from Region 2 on, once §6.2's idle kit
 * (Tactician, the Autocaster) can be owned. Before it, drafts wait their
 * full ten seconds and no ultimate casts itself: the report shows that
 * reading, but §6.1 has the player active there anyway.
 */
export const I5_GATED: readonly string[] = ['region-2', ...BOSSES.filter((b) => b.id !== 'gatekeeper').map((b) => b.id)];

/** I5's median at one checkpoint across profiles; null if no profile reached it. */
export function medianRatio(verdicts: readonly IdleVerdict[], label: string): number | null {
  const rs = verdicts.flatMap((v) => v.ratios).filter((r) => r.label === label).map((r) => r.ratio).sort((x, y) => x - y);
  return rs.length > 0 ? rs[rs.length >> 1] : null;
}

/** I2's median across profiles, in days; a profile that never got there counts as never. */
export function medianDays(verdicts: readonly IdleVerdict[]): number | null {
  const days = verdicts.map((v) => (v.idle === null ? Infinity : v.idle / 86400)).sort((x, y) => x - y);
  const m = days[days.length >> 1];
  return Number.isFinite(m) ? m : null;
}

export interface IdleVerdict {
  /** The idle bot's wall seconds to the finale's first fall (I2), or null if it never fell. */
  idle: number | null;
  /** Wall seconds the idle bot took to each boss's first fall. */
  bossKills: Record<string, number>;
  /** I5 at each checkpoint of the active run. */
  /** `opening`: the idle bot's median wall seconds from a run's start to its first draft-free moment (U2). */
  ratios: { label: string; active: number; idle: number; ratio: number; opening: number }[];
}

/** How long the idle bot may take before I2 calls it never, in days: past the band, with room to read. */
const IDLE_DAYS_CAP = 20;

/**
 * I2 and I5 (§8.4). I2 is measured: the idle bot's check-ins from a fresh
 * profile to the finale's first fall. I5 compares the two players at the
 * active bot's checkpoints over `activeHours` of its play: the later
 * bosses' checkpoints need the full twelve.
 */
export function idleVerdict(seed: number, runsPerPolicy = 6, activeHours = 3): IdleVerdict {
  const active = runPacing(activeHours, seed);
  const idle = runIdle(IDLE_DAYS_CAP, seed, [FINALE]);
  const ratios = active.checkpoints.map((c) => ({ label: c.label, ...farmRatio(c.profile, runsPerPolicy, seed) }));
  return { idle: idle.bossKills[FINALE] ?? null, bossKills: idle.bossKills, ratios };
}

/** Each seed's job, run in its own worker (`tools/parallel.ts`). */
const JOBS = { pacing: runPacing, idle: idleVerdict, act2: act2Verdict };
const seedsOf = (n: number): number[] => Array.from({ length: n }, (_, k) => k + 1);
const runSeeds = <T>(name: keyof typeof JOBS, argLists: unknown[][]): Promise<T[]> => parallel<T>(process.argv[1], name, argLists);

async function idleMain(seeds: number, activeHours: number): Promise<void> {
  const days = (t: number | null | undefined): string => (t == null ? 'never' : `${(t / 86400).toFixed(1)} d`);
  console.log(`idle · ${seeds} profiles · check-ins every ${CHECKIN_EVERY / 3600} h, ${SESSION / 60} min each`);
  const verdicts = await runSeeds<IdleVerdict>('idle', seedsOf(seeds).map((k) => [k, 6, activeHours]));
  for (const [k, v] of verdicts.entries()) {
    const bosses = BOSSES.map((b) => `${b.name.replace(/^The /, '')} ${days(v.bossKills[b.id])}`).join(' · ');
    console.log(`  seed ${k + 1}: ${bosses}`);
  }
  const m = medianDays(verdicts);
  const ok2 = m !== null && m >= I2_DAYS.min && m <= I2_DAYS.max;
  console.log(`  ${ok2 ? 'PASS' : 'FAIL'}  I2  median Act 1 ${m?.toFixed(1) ?? 'never'} d (want ${I2_DAYS.min}–${I2_DAYS.max}; ${verdicts.map((v) => days(v.idle)).join(' ')})`);
  const all = verdicts.flatMap((v) => v.ratios);
  for (const label of [...new Set(all.map((r) => r.label))]) {
    const med = medianRatio(verdicts, label);
    const rs = all.filter((r) => r.label === label).map((r) => r.ratio.toFixed(2)).join(' ');
    const gated = I5_GATED.includes(label);
    const ok5 = med !== null && med >= I5_RATIO.min && med <= I5_RATIO.max;
    const mark = gated ? (ok5 ? 'PASS' : 'FAIL') : '    ';
    const note = gated ? '' : ' · before the idle kit, the player is active here anyway (§6.1)';
    const open = all.filter((r) => r.label === label).map((r) => r.opening).sort((x, y) => x - y);
    const opening = open.length > 0 ? ` · idle opening ${open[open.length >> 1].toFixed(0)} s` : '';
    console.log(`  ${mark}  I5  ${label}: median active/idle ${med?.toFixed(2) ?? '?'} (want ${I5_RATIO.min}–${I5_RATIO.max}; ${rs})${opening}${note}`);
  }
}

/** P8's gate (§14): the bot clears heat 1–10 at the frontier within this many wall hours of the Blight's fall. */
export const HEAT_10_HOURS = { min: 3, max: 12 };
/** Wall hours the Act 1 bot is given to fell the Blight before Act 2 starts. */
const ACT1_HOURS = 14;

export interface Act2Verdict {
  /** Wall seconds into Act 1 the Blight fell; null if it never did. */
  act1: number | null;
  report: Act2Report | null;
}

/** Act 1 to the Blight's fall, then `hours` of Act 2 (§9). */
export function act2Verdict(seed: number, hours: number): Act2Verdict {
  const act1 = runPacing(ACT1_HOURS, seed);
  const at = act1.checkpoints.find((c) => c.label === FINALE);
  if (!at) return { act1: null, report: null };
  const profile = structuredClone(at.profile);
  return { act1: at.at, report: runAct2(profile, hours, seed) };
}

/** P8's reading: the median time to heat `h` at the frontier, in wall seconds after the Blight; null for never. */
export function medianHeat(verdicts: readonly Act2Verdict[], h: number): number | null {
  const times = verdicts.map((v) => v.report?.heatFrontier[h] ?? Infinity).sort((a, b) => a - b);
  const m = times[times.length >> 1];
  return Number.isFinite(m) ? m : null;
}

async function act2Main(seeds: number, hours: number): Promise<void> {
  const fmt = (t: number | null | undefined): string => (t == null ? 'never' : formatDuration(t));
  console.log(`act 2 · ${hours} h after the Blight · ${seeds} profiles`);
  const verdicts = await runSeeds<Act2Verdict>('act2', seedsOf(seeds).map((k) => [k, hours]));
  for (const [k, v] of verdicts.entries()) {
    const r = v.report;
    if (!r) {
      console.log(`  seed ${k + 1}: the Blight never fell in ${ACT1_HOURS} h`);
      continue;
    }
    const ladder = Array.from({ length: 10 }, (_, i) => fmt(r.heatFrontier[i + 1])).join(' ');
    console.log(`  seed ${k + 1}: Blight at ${fmt(v.act1)} · runs ${r.runs} (${r.abyssRuns} Abyss) · stars ${r.stars} · masteries ${r.masteries} · floor ${r.floor} · Starlight ${r.starlight}`);
    console.log(`           frontier heat 1–10: ${ladder}`);
    console.log(`           records: ${Object.entries(r.best).map(([i, h]) => `R${i} ${h}`).join(' · ')}`);
    if (k === 0) {
      for (const h of r.hourly) {
        console.log(`           hour ${pad(h.hour, 2)}: stars ${pad(h.stars, 2)} · masteries ${pad(h.masteries, 3)} · floor ${pad(h.floor, 2)} · frontier heat ${pad(h.frontier, 2)} · Starlight ${h.starlight}`);
      }
    }
  }
  for (let h = 1; h <= 10; h++) {
    const m = medianHeat(verdicts, h);
    const gate = h === 10 ? (m !== null && m >= HEAT_10_HOURS.min * 3600 && m <= HEAT_10_HOURS.max * 3600 ? 'PASS' : 'FAIL') : '    ';
    const want = h === 10 ? ` (want ${HEAT_10_HOURS.min}–${HEAT_10_HOURS.max} h)` : '';
    console.log(`  ${gate}  heat ${pad(h, 2)} at the frontier: median ${fmt(m)}${want}`);
  }
}

async function main(): Promise<void> {
  const hours = Number(arg('hours', '1'));
  const seed = Number(arg('seed', '1'));
  const seeds = Number(arg('seeds', '0'));
  if (process.argv.includes('--act2')) {
    await act2Main(Math.max(1, seeds || 1), hours);
    return;
  }
  if (process.argv.includes('--idle')) {
    // I5's later checkpoints need the active bot to get there: --hours 12.
    await idleMain(Math.max(1, seeds || 1), Math.max(3, hours));
    return;
  }
  if (seeds > 0) {
    const reports = await runSeeds<PacingReport>('pacing', seedsOf(seeds).map((k) => [hours, k]));
    const count = (f: (r: PacingReport) => boolean): string => `${reports.filter(f).length}/${seeds}`;
    const w20 = reports.map((r) => (r.firstWave20 === null ? 'never' : formatDuration(r.firstWave20)));
    const median = medianWave20(reports);
    console.log(`pacing · ${hours} h · ${seeds} profiles`);
    console.log(`  I3 passes ${count((r) => r.i3)} · I6 passes ${count((r) => r.i6)}`);
    console.log(`  worst reveal gaps: ${reports.map((r) => formatDuration(r.worstGap.seconds)).join(' ')}`);
    console.log(`  first wave 20: ${w20.join(' ')}`);
    console.log(`  ${median !== null && median >= 900 && median <= 1800 ? 'PASS' : 'FAIL'}  P3  median first wave 20 ${median === null ? 'never' : formatDuration(median)} (want 15:00–30:00)`);
    const fmt = (t: number | null): string => (t === null ? 'never' : formatDuration(t));
    for (const id of Object.keys(BOSS_BY_ID)) {
      console.log(`  first ${BOSS_BY_ID[id as keyof typeof BOSS_BY_ID].name}: ${reports.map((r) => fmt(r.bossKills[id] ?? null)).join(' ')}`);
    }
    const b1 = medianBossKill(reports, 'gatekeeper');
    console.log(`  ${b1 !== null && b1 >= 25 * 60 && b1 <= 40 * 60 ? 'PASS' : 'FAIL'}  P4  median first Gatekeeper kill ${fmt(b1)} (want 25:00–40:00)`);
    console.log(`  I1a passes ${count((r) => r.i1a)} (boss 1 within 20:00–40:00)`);
    const b2 = medianBossKill(reports, 'bog-mother');
    console.log(`        median first Bog Mother kill ${fmt(b2)} (§7.1 aims at 60:00–75:00)`);
    const fin = medianBossKill(reports, FINALE);
    const okFin = fin !== null && fin >= I1B.min && fin <= I1B.max;
    console.log(`  ${okFin ? 'PASS' : 'FAIL'}  I1b median first ${BOSS_BY_ID[FINALE].name} kill ${fmt(fin)} (want 7:00:00–12:00:00) · passes ${count((r) => r.i1b)}`);
    console.log(`  first evolution: ${reports.map((r) => fmt(r.firstEvolution)).join(' ')}`);
    console.log(`        median first evolution ${fmt(medianOf(reports, (r) => r.firstEvolution))} (§7.1 aims at 1:30:00–2:00:00)`);
    return;
  }
  const csv = arg('csv', '');
  const r = runPacing(hours, seed);
  console.log(`pacing · ${hours} h · seed ${seed} · ${r.runs.length} runs\n`);
  console.log('  run   start  reg  wave    sim   wall  spd  shards  next  boss   bought');
  for (const x of r.runs) {
    const bought = x.bought.map((id) => FORGE_BY_ID[id].name);
    const grouped = [...new Set(bought)].map((b) => {
      const k = bought.filter((y) => y === b).length;
      return k > 1 ? `${b} ×${k}` : b;
    });
    console.log(
      `${pad(x.n, 5)} ${pad(formatDuration(x.start), 7)} ${pad(x.region, 4)} ${pad(x.wave, 5)} ${pad(formatDuration(x.simSeconds), 6)}`
      + ` ${pad(formatDuration(x.wallSeconds), 6)} ${pad(`${x.speed}×`, 4)} ${pad(x.shards, 7)}`
      + ` ${pad(`${Math.floor(x.nextProgress * 100)}%`, 5)} ${pad(x.bossKilledIn === null ? '' : formatDuration(x.bossKilledIn), 5)}  ${grouped.join(', ')}`,
    );
  }
  console.log('\nreveals:');
  for (const v of r.reveals) console.log(`  ${pad(formatDuration(v.at), 7)}  ${v.what}`);
  console.log('\nverdicts:');
  const mark = (ok: boolean): string => (ok ? 'PASS' : 'FAIL');
  console.log(`  ${mark(r.i3)}  I3  every results screen shows a node at ≥ 50%`);
  console.log(`  ${mark(r.i6)}  I6  longest gap between reveals ${formatDuration(r.worstGap.seconds)} (from ${formatDuration(r.worstGap.from)}; max 10:00)`);
  console.log(`  ${mark(r.wave20)}  P3  wave 20 first reached at ${r.firstWave20 === null ? 'never' : formatDuration(r.firstWave20)} (want 15:00–30:00)`);
  const g = r.bossKills.gatekeeper;
  console.log(`  ${mark(r.i1a)}  I1a the Gatekeeper first falls at ${g === undefined ? 'never' : formatDuration(g)} (want 20:00–40:00)`);
  const f = r.bossKills[FINALE];
  console.log(`  ${mark(r.i1b)}  I1b ${BOSS_BY_ID[FINALE].name} first falls at ${f === undefined ? 'never' : formatDuration(f)} (want 7:00:00–12:00:00)`);
  if (csv) {
    writeFileSync(csv, ['seconds,reveal', ...r.reveals.map((v) => `${v.at.toFixed(1)},"${v.what}"`)].join('\n') + '\n');
    console.log(`\nreveal timeline written to ${csv}`);
  }
}

// Only when run as the script, so tests can import `runPacing`; in a seed's
// worker, only that seed's job.
if (IN_WORKER) workerJobs(JOBS);
else if (process.argv[1]?.includes('pacing')) void main();
