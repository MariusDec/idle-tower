/**
 * The pacing report (§13): a fresh profile, played by the active bot over
 * the real sim for N simulated hours. Between runs it buys in the Forge,
 * claims feats and pushes to the frontier region, and it checks the
 * invariants (§8.4):
 *
 *   I1a boss 1 first falls within 20–40 min (P4's gate: 25–40)
 *   I1b the Act 1 finale first falls within 3.5–6 h (needs --hours 6)
 *   I3  every results screen shows an affordable node, or ≥ 50% toward one
 *   I6  no gap between reveals longer than 10 min (in the first 2 h), and
 *       none longer than 30 min from 2 h to the Blight's first fall (S6, R2 §5;
 *       needs --hours 6). Both are gates on 8 profiles: at least 6 must pass.
 *   P3  wave 20 is first reached within 15–30 min
 *
 * And R1's reading (plans/review-risks.md §R1): each reveal is content (an
 * enemy, a card, a relic, a rift kind, a wave) or a system (a tab, an
 * explainer, a mechanic notable, an unlock that adds a screen or a rule).
 * Systems are counted per 15 min over the first 3 h, against "at most one
 * new system per 10 min, never two within 2 min", the Gatekeeper's fall
 * allowed two. Explainer opens are logged as systems but never count as
 * I6's reveals, so I6 reads as it did.
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
 *   npm run pacing -- --act2 --wake-frontiers
 *                                        …and write the Wake's frontier profiles
 *                                        (tools/fixtures/wake-frontiers.json, arsenal --wake)
 *   npm run pacing -- --act2 --reuse     …from the post-Blight profiles the last
 *                                        --act2 saved (T4): minutes, not half an
 *                                        hour, but only while Act 1 is unchanged
 *   npm run pacing -- --act2 --stop-at thunderhead
 *                                        …each seed stops once that boss is down
 *   npm run pacing -- --arena tablet-l   play on another stage's light (tools/play.ts's
 *                                        ARENA_SHAPES); --fog 2|3|4 forces its squareness
 *                                        (plans/large-screens.md §11.2)
 *   npm run pacing -- --frontiers        rewrite the arsenal's frontier profiles
 *                                        (tools/frontier.ts, R4): each Act 1
 *                                        boss's first fall, on FRONTIER_SEEDS
 *
 * Times are the player's wall clock: sim time divided by the game speed,
 * plus the moments a person spends on drafts and between runs.
 */
import { RIFT_BY_ID } from '../src/content/rifts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRun } from '../src/sim/run';
import { newProfile, type Profile } from '../src/meta/profile';
import { migrate, type RawProfile } from '../src/meta/save/migrate';
import { runSpeed } from '../src/meta/automation';
import { levelOf, nodeStates } from '../src/meta/forge';
import { bankRun, trophyAt } from '../src/meta/results';
import { frontier, hubUnlocks } from '../src/meta/collection';
import { claimAll } from '../src/meta/feats';
import { BRANCH_NAME, FORGE, FORGE_BY_ID } from '../src/content/forge';
import { BOSSES, BOSS_BY_ID } from '../src/content/bosses';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { EVOLUTION_BY_ID } from '../src/content/evolutions';
import { RELIC_BY_ID } from '../src/content/relics';
import { TRIALS, TRIAL_BY_ID } from '../src/content/trials';
import { chooseTrial, trialPrize, trialWon, trialsOpen } from '../src/meta/trials';
import { Rng } from '../src/core/rng';
import { formatDuration } from '../src/core/format';
import type { BossId, BranchId } from '../src/content/types';
import { FAST_STEPS, TOOL_ARENA, arenaLine, playRun, toolConfig } from './play';
import { PHONE_OVAL } from '../src/content/arena';
import { shop } from './shop';
import { CHECKIN_EVERY, SESSION, farmRatio, runIdle, type IdleReport } from './idle';
import { CONTRACT_SHARE, runAct2, takePacts, type Act2Report } from './act2';
import { botTake, emptyContractTally, holdsUlt, steerConfig, successLine, tallyContract, type ContractTally } from './contractBot';
import { boardOpen } from '../src/meta/contracts';
import { STRATA, stratumFoot } from '../src/content/strata';
import { BALANCE } from '../src/content/balance';
import { IN_WORKER, parallel, workerJobs } from './parallel';
import { FRONTIER_FILE, FRONTIER_HOURS, FRONTIER_SEEDS, WAKE_FRONTIER_FILE, saveFrontiers, type FrontierSave } from './frontier';
import { ACT1_REGIONS, WAKE_FINALE, WAKE_REGIONS } from '../src/content/regions';
import { EXPLAINERS, type ExplainerId } from '../src/content/explainers';
import { explainerOpen } from '../src/meta/explainers';

/** Wall seconds between runs: the results screen, plus shopping when there is shopping. */
const BETWEEN_RUNS = { idle: 6, shopping: 15 };
/** The milestone waves that count as reveals (§7.1). */
const MILESTONE_WAVES = [10, 15, 20];
/** I6: the longest a player may go without something new (§7.2). */
const MAX_REVEAL_GAP = 10 * 60;
/** I5's checkpoints by the clock: the first results past these many wall seconds (Region 2's in Region 2). */
const CHECKPOINT_REGION_1 = 20 * 60;
const CHECKPOINT_REGION_2 = 50 * 60;
/** I6 only applies to the first two hours… */
const I6_WINDOW = 2 * 3600;
/**
 * …and past them, to the Blight's first fall, at one reveal per 30 min (S6,
 * R2 §5). A report the Blight never fell in reads to its end, ten hours at most.
 */
export const I6_LATE = { from: 2 * 3600, to: 10 * 3600, gap: 30 * 60 };
/** I6's gates (R2 §5): this share of the profiles must pass each clause. */
export const I6_GATE_SHARE = 6 / 8;
/**
 * The active bot tries an open Trial (N5) every this many runs: one it has
 * not won, in a region behind the frontier, at most `TRIAL_TRIES` times.
 */
const TRIAL_EVERY = 8;
const TRIAL_TRIES = 2;
/**
 * Once the Contract board opens (plans/late-game/10 §9), the active bot
 * takes a card every this many runs, offset from the Trials' turn.
 */
const CONTRACT_EVERY = 4;

export interface Reveal {
  /** Wall seconds since the profile was made. */
  at: number;
  what: string;
  /**
   * The system this reveal teaches (R1 §1), keyed so a tab, its unlock line
   * and its explainer count once; absent for content.
   */
  system?: string;
}

/** R1's target (plans/review-risks.md §R1): systems over the first 3 h, at most one per 10 min, never two within 2. */
export const SYSTEM_PACE = { window: 3 * 3600, quarter: 15 * 60, spacing: 10 * 60, crowd: 2 * 60 };

/** Results-screen unlock lines that add a screen or a rule (R1 §1), by their system; the rest are content. */
const UNLOCK_SYSTEMS: Readonly<Record<string, string>> = {
  'The Map': 'map', Feats: 'feats', Pacts: 'pacts', 'The Constellations': 'stars', 'The Abyss': 'abyss',
  'The Daily Omen': 'omen', 'Boss Rush': 'rush', Contracts: 'contracts', 'The Recipe Book': 'recipes',
};

function unlockSystem(label: string): string | undefined {
  if (label in UNLOCK_SYSTEMS) return UNLOCK_SYSTEMS[label];
  if (label.startsWith('Trials: ')) return 'trials';
  if (label.startsWith('Relic slot')) return 'relics';
  if (label.startsWith('Relic set: ')) return 'relic sets';
  if (label.endsWith(' frame')) return 'frames';
  // A region, a set's rank, a boss's unsealed nodes: more of what the player already knows.
  return undefined;
}

/** An explainer's system, where its id differs from the key the tabs and unlocks use. */
const EXPLAINER_SYSTEMS: Partial<Record<ExplainerId, string>> = { bestiary: 'collection', rifts: 'tear', tactics: 'tactician' };

/** A notable's system (R1 §1): an automation or a slot is one; a weapon or a behaviour is content. Tiers share their first's key. */
function notableSystem(id: string): string | undefined {
  for (const e of FORGE_BY_ID[id].effects) {
    if (e.kind === 'slot') return e.slot === 'relic' ? 'relics' : `slot: ${e.slot}`;
    if (e.kind === 'automation') {
      if (e.id === 'offline-3' || e.id === 'offline-4') return 'stored';
      return e.id.replace(/-\d$/, '');
    }
  }
  return undefined;
}

/** Each system's first appearance (R1 §1), reveals and explainer opens together, in order. */
export function systemsOf(r: Pick<PacingReport, 'reveals' | 'explainers'>): Reveal[] {
  const seen = new Set<string>();
  const out: Reveal[] = [];
  for (const v of [...r.reveals, ...r.explainers].sort((a, b) => a.at - b.at)) {
    if (!v.system || seen.has(v.system)) continue;
    seen.add(v.system);
    out.push(v);
  }
  return out;
}

export interface SystemPace {
  /** New systems in each 15 min of the first 3 h. */
  perQuarter: number[];
  /** Consecutive systems closer than 10 min, and of those, closer than 2 min (the Gatekeeper's one pair aside). */
  close: number;
  crowded: number;
  pass: boolean;
}

/** R1's reading of one report: systems per 15 min, and the pairs that come too close. */
export function systemPace(r: Pick<PacingReport, 'reveals' | 'explainers' | 'gateFall'>): SystemPace {
  const P = SYSTEM_PACE;
  const sys = systemsOf(r).filter((v) => v.at <= P.window);
  const perQuarter = Array.from({ length: Math.ceil(P.window / P.quarter) }, () => 0);
  for (const v of sys) perQuarter[Math.min(perQuarter.length - 1, Math.floor(v.at / P.quarter))]++;
  let close = 0;
  let crowded = 0;
  // The first boss may open two at once: its fall's results screen gets one pair for free.
  let spare = r.gateFall === null ? 0 : 1;
  for (let i = 1; i < sys.length; i++) {
    const gap = sys[i].at - sys[i - 1].at;
    if (gap >= P.spacing) continue;
    if (spare > 0 && sys[i].at === r.gateFall && sys[i - 1].at === r.gateFall) {
      spare--;
      continue;
    }
    close++;
    if (gap < P.crowd) crowded++;
  }
  return { perQuarter, close, crowded, pass: close === 0 };
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
  /** The run ended won: overtime's last wave held, or its time run out (D-26). */
  cleared: boolean;
}

export interface PacingReport {
  seconds: number;
  /** The Contract board's runs (plans/late-game/10 §9): success by tier, what it paid. */
  contracts: { runs: number } & ContractTally;
  runs: RunRow[];
  reveals: Reveal[];
  /** Explainers as each first opens (R1 §1): systems, never I6's reveals. */
  explainers: Reveal[];
  /** Wall seconds of the results screen the Gatekeeper first fell before, or null. */
  gateFall: number | null;
  firstWave20: number | null;
  /** Wall seconds when each boss first fell, by id. */
  bossKills: Record<string, number>;
  /** Wall seconds of the first evolution (§7.1 aims at 1.5–2 h); null if none yet. */
  firstEvolution: number | null;
  /** The longest gap between reveals inside I6's window, and where it starts. */
  worstGap: { seconds: number; from: number };
  /** The same from 2 h to the Blight's first fall (or the report's end, 10 h at most), I6's later clause (S6, R2 §5). */
  worstLateGap: { seconds: number; from: number };
  /** The longest gap between reveals from the Hollow King's first fall to the Blight's (Q3's gate); null if either never fell. */
  stretchGap: { seconds: number; from: number } | null;
  /** Trials won, by the wall second each was won (N5). */
  trials: Record<string, number>;
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
  /** I6's later clause: no gap over 30 min from 2 h to the Blight. True when the report never got past 2 h. */
  i6late: boolean;
  wave20: boolean;
}

/**
 * I6's later window (R2 §5): from 2 h to the Blight's first fall, or to the
 * report's end (ten hours at most) if it never fell; null before 2 h.
 */
export function lateWindow(end: number, blight: number | null): { from: number; to: number } | null {
  const to = Math.min(blight ?? end, end, I6_LATE.to);
  return to > I6_LATE.from ? { from: I6_LATE.from, to } : null;
}

/** The longest gap between reveals in [from, to], and where it starts. */
export function worstGapIn(reveals: readonly Reveal[], from: number, to: number): { seconds: number; from: number } {
  let worst = { seconds: 0, from };
  let prev = from;
  for (const r of [...reveals.filter((x) => x.at > from && x.at <= to), { at: to, what: 'end' }]) {
    if (r.at - prev > worst.seconds) worst = { seconds: r.at - prev, from: prev };
    prev = r.at;
  }
  return worst;
}

/** I1's first half (§8.4): boss 1's first kill, in wall seconds. */
const I1A = { min: 20 * 60, max: 40 * 60 };
/** I1's second half (§8.4): the Act 1 finale's first kill, in wall seconds. */
/** R3 (plans/review-risks.md, 2026-11-19): the owner's call, Act 1 is ~4–5 h of active play; was 7–12 h. */
export const I1B = { min: 3.5 * 3600, max: 6 * 3600 };
const I1B_WANT = `want ${formatDuration(I1B.min)}–${formatDuration(I1B.max)}`;
/** The boss whose fall ends Act 1. */
export const FINALE = BOSSES.find((b) => b.finale)!.id;

export function runPacing(hours: number, seed: number): PacingReport {
  const profile = newProfile(0);
  const seeds = new Rng(seed);
  const end = hours * 3600;
  const reveals: Reveal[] = [];
  const explainers: Reveal[] = [];
  const explained = new Set<ExplainerId>();
  let gateFall: number | null = null;
  const runs: RunRow[] = [];
  const reached = new Set<number>();
  const branches = new Set<BranchId>();
  let clock = 0;
  let firstWave20: number | null = null;
  let firstEvolution: number | null = null;
  const bossKills: Record<string, number> = {};
  const metBosses = new Set<string>();
  const seenAuras = new Set<string>();
  const metRifts = new Set<string>();
  let tabs = hubUnlocks(profile);
  let anomalySeen = false;
  let i3 = true;
  const checkpoints: PacingReport['checkpoints'] = [];
  const trials: Record<string, number> = {};
  const tries: Record<string, number> = {};
  const contracts = { runs: 0, ...emptyContractTally() };
  let taken: ReturnType<typeof botTake> = null;
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
  /** The hub's explainers that have opened (R1 §1); the mid-run ones are logged on their events. */
  const logExplainers = (): void => {
    for (const e of EXPLAINERS) {
      if (e.view === 'run' || explained.has(e.id) || !explainerOpen(profile, e.id)) continue;
      explained.add(e.id);
      explainers.push({ at: clock, what: `explainer: ${e.title}`, system: EXPLAINER_SYSTEMS[e.id] ?? e.id });
    }
  };
  revealBranches(false);

  while (clock < end) {
    const start = clock;
    const speed = runSpeed(profile);
    const run = createRun(steerConfig(toolConfig(profile), taken?.card), seeds.nextU32());
    const played = playRun(profile, run, {
      policy: 'active',
      speed,
      holdUlt: holdsUlt(taken?.card),
      onDraft: (fresh, first, wall) => {
        if (first) reveals.push({ at: start + wall, what: 'the draft', system: 'draft' });
        for (const key of fresh) reveals.push({ at: start + wall, what: `card: ${key}` });
      },
      onEvent: (ev, wall) => {
        const at = start + wall;
        // R2 §1: a Trial's win and an overtime trophy are told in the run, as they happen.
        if (ev.kind === 'bossKill' && run.trial) {
          const prize = trialPrize(profile, run.trial);
          if (prize) reveals.push({ at, what: `trial won: ${TRIAL_BY_ID[prize.id].name} · ${prize.line}` });
        } else if (ev.kind === 'waveStart') {
          const t = trophyAt(profile, run, ev.wave);
          if (t) reveals.push({ at, what: `trophy: Region ${run.regionId} +${t.overtime}` });
        }
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
        } else if (ev.kind === 'eliteSpawn' && ev.champion && !seenAuras.has(`champion@${run.regionId}`)) {
          // A region's first Champion (N4) is its own reveal.
          // The first ever is a system too: its card holds the arena (R1 §4).
          const first = ![...seenAuras].some((k) => k.startsWith('champion@'));
          seenAuras.add(`champion@${run.regionId}`);
          reveals.push({ at, what: `champion: Region ${run.regionId}`, ...(first ? { system: 'champion' } : {}) });
        } else if (ev.kind === 'eliteSpawn' && !seenAuras.has(ev.aura ?? 'plain')) {
          // Each aura is a new enemy to read (§7.2), the plain elite included.
          // The first aura is a system (its card, R1 §4); each after it is content.
          const first = ev.aura !== null && [...seenAuras].every((k) => k === 'plain' || k.startsWith('champion@'));
          seenAuras.add(ev.aura ?? 'plain');
          reveals.push({ at, what: `elite: ${ev.aura ?? 'plain'}`, ...(first ? { system: 'aura' } : {}) });
        } else if (ev.kind === 'evolve' && !profile.recipes.found.includes(ev.evolution)) {
          firstEvolution ??= at;
          reveals.push({ at, what: `evolution: ${EVOLUTION_BY_ID[ev.evolution].name}` });
        } else if ((ev.kind === 'riftAppear' || ev.kind === 'riftTaken') && !(ev.id in profile.rifts) && !metRifts.has(ev.id)) {
          // Each rift's first meeting is a journal entry (plans/late-game/02 §8: the reveal gap after hour 2).
          // The first rift is a system (its card, R1 §4); each kind after it is content.
          const first = metRifts.size === 0 && Object.keys(profile.rifts).length === 0;
          metRifts.add(ev.id);
          reveals.push({ at, what: `rift: ${RIFT_BY_ID[ev.id].name}`, ...(first ? { system: 'tear' } : {}) });
        } else if (ev.kind === 'anomalyOffer' && !anomalySeen) {
          // The first anomaly in a hand teaches its rule in the draft's own line: a system, not I6's reveal.
          anomalySeen = true;
          explainers.push({ at, what: 'anomaly in the draft', system: 'anomalies' });
        } else if (ev.kind === 'relicDrop' && !(profile.relics[ev.relic] > 0)) {
          reveals.push({ at, what: `relic: ${RELIC_BY_ID[ev.relic].name}` });
        }
      },
    });
    const wall = played.wall;
    clock = start + wall;
    const summary = bankRun(profile, run, played.newCards, speed);
    if (runs.length === 0) reveals.push({ at: clock, what: 'results and the Forge', system: 'forge' });
    if (summary.boss?.first && summary.boss.id === 'gatekeeper') gateFall = clock;
    const progress = summary.next?.progress ?? 1;
    if (progress < 0.5) i3 = false;
    for (const u of summary.unlocks) {
      const system = unlockSystem(u);
      reveals.push({ at: clock, what: `unlock: ${u}`, ...(system ? { system } : {}) });
    }
    if (taken) {
      tallyContract(contracts, taken.tier, summary);
      // A card done is a reveal (plans/late-game/10 §9, I6), and so is a milestone.
      if (summary.contract?.met) reveals.push({ at: clock, what: `contract done: ${summary.contract.text}` });
      if (summary.contract?.milestone) reveals.push({ at: clock, what: `contract milestone: ${summary.contract.milestone}` });
      taken = null;
    }
    // Its reveal was the boss's fall, in the run (R2 §1).
    if (summary.trial?.paid) trials[summary.trial.id] = clock;
    const now = hubUnlocks(profile);
    for (const k of ['map', 'collection', 'feats'] as const) {
      if (now[k] && !tabs[k]) reveals.push({ at: clock, what: `tab: ${k}`, system: k });
    }
    tabs = now;
    // The active player claims what waits in Feats, and pushes the frontier.
    if (tabs.feats) claimAll(profile);
    profile.region = frontier(profile).index;
    // Now and then, a Trial (N5) behind the frontier: an open one not yet won, tried at most twice.
    if (runs.length % TRIAL_EVERY === TRIAL_EVERY - 1) {
      const t = TRIALS.find((x) => x.region < profile.region && trialsOpen(profile, x.region)
        && !trialWon(profile, x.id) && (tries[x.id] ?? 0) < TRIAL_TRIES);
      if (t && chooseTrial(profile, t.id)) tries[t.id] = (tries[t.id] ?? 0) + 1;
    }
    // And once the board is open, a contract every `CONTRACT_EVERY` runs (never over a Trial).
    if (!profile.trial && boardOpen(profile) && runs.length % CONTRACT_EVERY === 1) {
      taken = botTake(profile, contracts.runs, (p, h, region) => takePacts(p, h, region));
      if (taken) contracts.runs++;
    }

    const bought = shop(profile);
    for (const id of bought) {
      const n = FORGE_BY_ID[id];
      if (n.type !== 'minor' && levelOf(profile, id) === 1) {
        const system = notableSystem(id);
        reveals.push({ at: clock, what: `notable: ${n.name}`, ...(system ? { system } : {}) });
      }
    }
    revealBranches(true);
    logExplainers();
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
      cleared: summary.outcome === 'cleared',
    });
    clock += bought.length > 0 ? BETWEEN_RUNS.shopping : BETWEEN_RUNS.idle;
  }

  reveals.sort((a, b) => a.at - b.at);
  const worstGap = worstGapIn(reveals, 0, Math.min(clock, I6_WINDOW));
  const boss1 = bossKills.gatekeeper ?? null;
  const finale = bossKills[FINALE] ?? null;
  const late = lateWindow(clock, finale);
  const worstLateGap = late ? worstGapIn(reveals, late.from, late.to) : { seconds: 0, from: I6_LATE.from };
  const king = bossKills['hollow-king'] ?? null;
  const stretchGap = king !== null && finale !== null ? worstGapIn(reveals, king, finale) : null;
  return {
    seconds: clock,
    contracts,
    runs,
    reveals,
    explainers,
    gateFall,
    firstWave20,
    bossKills,
    firstEvolution,
    worstGap,
    worstLateGap,
    stretchGap,
    trials,
    checkpoints,
    i1a: boss1 !== null && boss1 >= I1A.min && boss1 <= I1A.max,
    i1b: finale !== null && finale >= I1B.min && finale <= I1B.max,
    i3,
    i6: worstGap.seconds <= MAX_REVEAL_GAP,
    i6late: worstLateGap.seconds <= I6_LATE.gap,
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

/** I6's CI reading (R4): the median profile's worst gap between reveals in the first two hours, in seconds. */
export function medianWorstGap(reports: readonly PacingReport[]): number {
  return medianOf(reports, (r) => r.worstGap.seconds)!;
}

/** The P4 gate's reading: the median first kill of a boss. */
export function medianBossKill(reports: readonly PacingReport[], boss: string): number | null {
  return medianOf(reports, (r) => r.bossKills[boss] ?? null);
}

/** I2's band (§8.4): Act 1 for the idle bot, in days. */
export const I2_DAYS = { min: 5, max: 10 };
/** I7 (plans/late-game/01 §9.1): the engaged bot's screen time to the Blight, over the hands-off bot's, at most. */
export const I7_SCREEN = 0.7;
/** I8: every seed's hands-off Act 1 in this band, in days; the median aims at `target`. */
export const I8_DAYS = { min: 5, max: 10, target: { min: 6, max: 8 } };
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
  /** The idle schedule played hands off (I2, I8, I9) and engaged (I7), with Stored Light's books. */
  handsOff: IdleReport;
  engaged: IdleReport;
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
  const engaged = runIdle(IDLE_DAYS_CAP, seed, [FINALE], 'engaged');
  const ratios = active.checkpoints.map((c) => ({ label: c.label, ...farmRatio(c.profile, runsPerPolicy, seed) }));
  return { idle: idle.bossKills[FINALE] ?? null, bossKills: idle.bossKills, ratios, handsOff: idle, engaged };
}

/** Each seed's job, run in its own worker (`tools/parallel.ts`). */
/** Every seed's Final Form tallies (plans/late-game/07 §8) summed, as one report's `forms`. */
function formTotals(verdicts: readonly IdleVerdict[], which: 'handsOff' | 'engaged'): { mode: string; forms: IdleReport['forms'] } {
  const forms: IdleReport['forms'] = {};
  for (const v of verdicts) {
    for (const [region, f] of Object.entries(v[which].forms)) {
      const t = (forms[Number(region)] ??= { runs: 0, could: 0, formed: 0, waves: [], evolved: [0, 0, 0, 0], recipes: 0 });
      t.runs += f.runs;
      f.evolved.forEach((n, i) => (t.evolved[i] += n));
      t.recipes = Math.max(t.recipes, f.recipes);
      t.could += f.could;
      t.formed += f.formed;
      t.waves.push(...f.waves);
    }
  }
  return { mode: verdicts[0]?.[which].mode ?? which, forms };
}

/**
 * One seed's frontier profiles (`tools/frontier.ts`): its checkpoint at each
 * Act 1 boss's first fall, the Forge shopped after it.
 */
export function frontierRun(seed: number, hours = FRONTIER_HOURS): FrontierSave[] {
  const r = runPacing(hours, seed);
  return ACT1_REGIONS.flatMap((region) => {
    const c = r.checkpoints.find((x) => x.label === region.boss);
    return c ? [{ seed, boss: region.boss, at: Math.round(c.at), profile: c.profile as unknown as RawProfile }] : [];
  });
}

async function frontiersMain(): Promise<void> {
  if (FAST_STEPS > 1) throw new Error('--frontiers is a gate fixture: read it without --fast');
  const runs = await runSeeds<FrontierSave[]>('frontiers', FRONTIER_SEEDS.map((k) => [k]));
  for (const [k, seed] of FRONTIER_SEEDS.entries()) {
    console.log(`  seed ${seed}: ${runs[k].map((s) => `${BOSS_BY_ID[s.boss as keyof typeof BOSS_BY_ID].name} ${formatDuration(s.at)}`).join(' · ')}`);
    if (runs[k].length < ACT1_REGIONS.length) throw new Error(`seed ${seed}: not every boss fell in ${FRONTIER_HOURS} h`);
  }
  saveFrontiers(runs.flat());
  console.log(`frontier profiles written to ${FRONTIER_FILE}`);
}

const JOBS = { pacing: runPacing, idle: idleVerdict, act2: act2Verdict, frontiers: frontierRun };
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
  // Stored Light (plans/late-game/01 §9.1): I7, I8 and I9.
  const hm = (t: number | undefined): string => (t === undefined ? 'never' : formatDuration(t));
  for (const [k, v] of verdicts.entries()) {
    const h = v.handsOff;
    const e = v.engaged;
    console.log(`  seed ${k + 1} screen to the Blight: hands-off ${hm(h.screen[FINALE])} · engaged ${hm(e.screen[FINALE])}`
      + ` · engaged Act 1 ${days(e.bossKills[FINALE])}`);
    for (const r of [h, e]) {
      console.log(`           ${r.mode.padEnd(9)} instant ${r.offline} · stored ${r.stored} · burned ${r.burned} · pool at the Blight ${r.poolAtEnd} · rifts ${Math.round(r.riftShards)} · anomalies ${r.anomalies.offered} offered, ${r.anomalies.taken} taken`);
    }
  }
  const screens = verdicts
    .map((v) => {
      const h = v.handsOff.screen[FINALE];
      const e = v.engaged.screen[FINALE];
      return h === undefined || e === undefined ? Infinity : e / h;
    })
    .sort((a, b) => a - b);
  const m7 = screens[screens.length >> 1];
  const ok7 = Number.isFinite(m7) && m7 <= I7_SCREEN;
  console.log(`  ${ok7 ? 'PASS' : 'FAIL'}  I7  median engaged/hands-off screen time to the Blight ${Number.isFinite(m7) ? m7.toFixed(2) : 'never'} (want ≤ ${I7_SCREEN}; ${screens.map((x) => (Number.isFinite(x) ? x.toFixed(2) : 'never')).join(' ')})`);
  const tail = verdicts.map((v) => (v.idle === null ? Infinity : v.idle / 86400));
  const ok8 = tail.every((d) => d >= I8_DAYS.min && d <= I8_DAYS.max);
  const inTarget = m !== null && m >= I8_DAYS.target.min && m <= I8_DAYS.target.max;
  console.log(`  ${ok8 ? 'PASS' : 'FAIL'}  I8  every hands-off Act 1 in ${I8_DAYS.min}–${I8_DAYS.max} d (${tail.map((d) => (Number.isFinite(d) ? d.toFixed(1) : 'never')).join(' ')}) · median ${m?.toFixed(1) ?? 'never'} d ${inTarget ? 'in' : 'outside'} the ${I8_DAYS.target.min}–${I8_DAYS.target.max} d target`);
  // Final Form (plans/late-game/07 §8): the idle reach rate per region, want ≥ 10% of Region 5 runs (hands-off).
  for (const r of [formTotals(verdicts, 'handsOff'), formTotals(verdicts, 'engaged')]) {
    const rows = Object.entries(r.forms).sort((a, b) => Number(a[0]) - Number(b[0])).map(([region, f]) => {
      const sorted = [...f.waves].sort((x, y) => x - y);
      const med = sorted.length > 0 ? ` w${sorted[sorted.length >> 1]}` : '';
      return `R${region} ${f.formed}/${f.runs}${f.could < f.runs ? ` (${f.could} could)` : ''}${med} [evolved ${f.evolved.join('/')}, recipes ≤ ${f.recipes}]`;
    });
    const r5 = r.forms[5];
    const rate5 = r5 && r5.runs > 0 ? r5.formed / r5.runs : 0;
    const mark = r.mode === 'hands-off' ? (rate5 >= 0.1 ? 'PASS' : 'FAIL') : '    ';
    console.log(`  ${mark}  Final Form ${r.mode.padEnd(9)} reached/runs, median wave: ${rows.join(' · ')} (want ≥ 10% in R5; ${(rate5 * 100).toFixed(0)}%)`);
  }
  const leaks = verdicts.filter((v) => v.handsOff.tally.engaged > 0 || Object.keys(v.handsOff.activeOnly).length > 0);
  console.log(`  ${leaks.length === 0 ? 'PASS' : 'FAIL'}  I9  no active-only reward reached the hands-off bot${leaks.length > 0 ? ` (${leaks.length} seeds leaked)` : ''}`);
  const perHour = verdicts.map((v) => {
    const income = (r: IdleReport): number => r.offline + r.played + r.burned;
    const he = v.engaged.screen[FINALE];
    const hh = v.handsOff.screen[FINALE];
    return he && hh ? (income(v.engaged) / he) / (income(v.handsOff) / hh) : NaN;
  });
  console.log(`        shards per screen hour, engaged/hands-off: ${perHour.map((x) => (Number.isFinite(x) ? x.toFixed(2) : '?')).join(' ')} (README: 2–3)`);
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
/** S7's readings: the best Abyss floor at 12 h, and the hours of Act 2 the last star should take (B7). */
const ABYSS_FLOOR_12H = 10;
const LAST_STAR_HOURS = { min: 20, max: 40 };
/** The Wake's readings (plans/late-game/12 §14, O-1 in 12a): its first boss's fall, and its last's (so the Abyss), in wall hours after the Blight. */
const WAKE_FIRST_HOURS = { min: 0, max: 0.5 };
const WAKE_LAST_HOURS = { min: 2, max: 4 };
/** Wall seconds as hours, one decimal ("0.6 h"); "never" for none. */
function hoursOf(t: number | null | undefined): string {
  return t == null ? 'never' : `${(t / 3600).toFixed(1)} h`;
}
/** Wall hours the Act 1 bot is given to fell the Blight before Act 2 starts. */
const ACT1_HOURS = 14;

export interface Act2Verdict {
  /** Wall seconds into Act 1 the Blight fell; null if it never did. */
  act1: number | null;
  report: Act2Report | null;
}

/** Where `--act2` keeps each seed's profile at the Blight's fall, for `--reuse` (T4). */
const ACT2_STARTS = 'node_modules/.tmp/act2-starts';

/** Act 1 to the Blight's fall (or the saved fall, with `reuse`), then `hours` of Act 2 (§9). */
export function act2Verdict(seed: number, hours: number, reuse = false, keep = false, stopAt?: BossId): Act2Verdict {
  // A --fast start is kept apart, so a full reading never reuses one.
  const file = `${ACT2_STARTS}/seed-${seed}${FAST_STEPS > 1 ? `-fast${FAST_STEPS}` : ''}.json`;
  let start: { at: number; profile: Profile } | null = null;
  if (reuse && existsSync(file)) {
    // Saved by an older build, perhaps: walked up the ladder like any save.
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { at: number; profile: RawProfile };
    start = { at: saved.at, profile: migrate(saved.profile) as unknown as Profile };
  } else {
    const at = runPacing(ACT1_HOURS, seed).checkpoints.find((c) => c.label === FINALE);
    if (at) {
      start = { at: at.at, profile: at.profile };
      mkdirSync(ACT2_STARTS, { recursive: true });
      writeFileSync(file, JSON.stringify(start));
    }
  }
  if (!start) return { act1: null, report: null };
  const profile = structuredClone(start.profile);
  return { act1: start.at, report: runAct2(profile, hours, seed, keep, stopAt) };
}

/** P8's reading: the median time to heat `h` at the frontier, in wall seconds after the Blight; null for never. */
export function medianHeat(verdicts: readonly Act2Verdict[], h: number): number | null {
  const times = verdicts.map((v) => v.report?.heatFrontier[h] ?? Infinity).sort((a, b) => a - b);
  const m = times[times.length >> 1];
  return Number.isFinite(m) ? m : null;
}

/**
 * The wall hours a report spent on cards, as their share of its runs: the
 * bar asks for a contract-only reward per hour *of contracts* (plans/late-game/10
 * §4.4), not per hour of a session two thirds of which is something else.
 */
function contractHours(r: Act2Report): number {
  return Math.max(1e-9, (r.seconds / 3600) * (r.contracts.runs / Math.max(1, r.runs)));
}

async function act2Main(seeds: number, hours: number, reuse: boolean, keep = false, stopAt?: BossId): Promise<void> {
  const fmt = (t: number | null | undefined): string => (t == null ? 'never' : formatDuration(t));
  console.log(`act 2 · ${hours} h after the Blight · ${seeds} profiles${reuse ? ' · saved starts' : ''}${stopAt ? ` · stopped at ${stopAt}` : ''}`);
  const verdicts = await runSeeds<Act2Verdict>('act2', seedsOf(seeds).map((k) => [k, hours, reuse, keep, stopAt]));
  if (keep) {
    // The Wake's frontier fixture (plans/late-game/12 §10.3): the Blight's fall and each Wake boss's.
    saveFrontiers(verdicts.flatMap((v) => v.report?.saves ?? []), true);
    console.log(`Wake frontier profiles written to ${WAKE_FRONTIER_FILE}`);
  }
  for (const [k, v] of verdicts.entries()) {
    const r = v.report;
    if (!r) {
      console.log(`  seed ${k + 1}: the Blight never fell in ${ACT1_HOURS} h`);
      continue;
    }
    const ladder = Array.from({ length: 10 }, (_, i) => fmt(r.heatFrontier[i + 1])).join(' ');
    console.log(`  seed ${k + 1}: Blight at ${fmt(v.act1)} · runs ${r.runs} (${r.abyssRuns} Abyss) · stars ${r.stars} · capstones ${r.growth.capstones}/12 · Fortune ${r.growth.fortune} · tempered ${r.growth.tempered} · floor ${r.floor} · Starlight ${r.starlight}`
      + ` · reliquaries ${r.reliquaries.claimed}/${r.reliquaries.seen} claimed · anomalies ${r.anomalies.offered} (${r.anomalies.abyss} Abyss) / ${r.runs} runs`);
    console.log(`           frontier heat 1–10: ${ladder}`);
    // D-26: no run should hit the tools' safety net; the Abyss's longest is O-6's reading.
    const mins = (s: number): string => (s / 60).toFixed(1);
    console.log(`           runs cut off: ${r.cutOff} · longest run: region ${mins(r.longest.region)} min, Abyss ${mins(r.longest.abyss)} min`);
    console.log(`           records: ${Object.entries(r.best).map(([i, h]) => `R${i} ${h}`).join(' · ')} · last star ${fmt(r.lastStar)}`);
    const src = r.sources;
    console.log(`           Starlight from: ${Object.entries(src.heat).map(([i, n]) => `R${i} ${n}`).join(' · ')} · Abyss ${src.abyss} · strata ${src.strata} · Rush ${src.rush} · feats ${src.feats} · contracts ${src.contracts} · Wake ${src.wake}`);
    console.log(`           Wake: ${WAKE_REGIONS.map((w) => `${BOSS_BY_ID[w.boss].name.replace(/^The /, '')} ${hoursOf(r.wake[w.boss])}`).join(' · ')}`);
    if (r.contracts.runs > 0) {
      // The board's bar (plans/late-game/10 §9): success by tier, contract-only rewards per hour.
      const c = r.contracts;
      console.log(`           contracts: ${c.runs} runs · ${successLine(c)} · ${(c.only / contractHours(r)).toFixed(2)} riders+milestones per contract hour · ${c.shards} shards`);
    }
    const fell = STRATA.map((st) => `${BOSS_BY_ID[st.boss].name} ${fmt(r.strata.fell[st.boss])}`).join(' · ');
    const entry = Object.entries(r.strata.entry).map(([f, ls]) => `floor ${f} level ${[...ls].sort((a, b) => a - b)[ls.length >> 1]} (${ls.length})`).join(' · ');
    console.log(`           strata: ${fell}${entry ? ` · entered ${entry}` : ''}`);
    const rush = r.rush.time !== null ? formatDuration(r.rush.time) : `${r.rush.best} bosses`;
    console.log(`           Boss Rush: ${r.rushRuns} runs · record ${rush}`);
    if (k === 0) {
      for (const h of r.hourly) {
        console.log(`           hour ${pad(h.hour, 2)}: stars ${pad(h.stars, 2)} · capstones ${pad(h.capstones, 2)} · Fortune ${pad(h.fortune, 3)} · tempered ${pad(h.tempered, 4)} · floor ${pad(h.floor, 2)} · frontier heat ${pad(h.frontier, 2)} · Starlight ${h.starlight}`);
      }
    }
  }
  for (let h = 1; h <= 10; h++) {
    const m = medianHeat(verdicts, h);
    const gate = h === 10 ? (m !== null && m >= HEAT_10_HOURS.min * 3600 && m <= HEAT_10_HOURS.max * 3600 ? 'PASS' : 'FAIL') : '    ';
    const want = h === 10 ? ` (want ${HEAT_10_HOURS.min}–${HEAT_10_HOURS.max} h)` : '';
    console.log(`  ${gate}  heat ${pad(h, 2)} at the frontier: median ${fmt(m)}${want}`);
  }
  const reports = verdicts.flatMap((v) => (v.report ? [v.report] : []));
  const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
  // The Contract board's bar (plans/late-game/10 §9): read against a run without `--contracts`.
  const starPerHour = (r: Act2Report): number => r.starlight / (r.seconds / 3600);
  console.log(`        Starlight per hour: median ${med(reports.map(starPerHour)).toFixed(1)}${CONTRACT_SHARE > 0 ? ` with ${Math.round(CONTRACT_SHARE * 100)}% contract runs` : ''} (${reports.map((r) => starPerHour(r).toFixed(1)).join(' ')})`);
  if (CONTRACT_SHARE > 0) {
    const only = reports.map((r) => r.contracts.only / contractHours(r));
    console.log(`  ${med(only) >= 1 ? 'PASS' : 'FAIL'}  contract-only rewards per hour of contracts: median ${med(only).toFixed(2)} (want ≥ 1)`);
    const all = reports.reduce((t, r) => {
      for (const k of [1, 2, 3, 4]) {
        t.tries[k] = (t.tries[k] ?? 0) + (r.contracts.tries[k] ?? 0);
        t.met[k] = (t.met[k] ?? 0) + (r.contracts.met[k] ?? 0);
      }
      return t;
    }, emptyContractTally());
    console.log(`        contract success by tier: ${successLine(all)} (want ~85 / 65 / 45 / 30%)`);
  }
  // The Wake (plans/late-game/12 §14): each boss's first fall after the Blight; the Carillon within 0.5 h, the last within 2–4 h (O-1).
  for (const [i, w] of WAKE_REGIONS.entries()) {
    const times = reports.map((r) => r.wake[w.boss] ?? Infinity);
    const m = med(times);
    const last = i === WAKE_REGIONS.length - 1 && w.boss === WAKE_FINALE;
    const want = i === 0 ? WAKE_FIRST_HOURS : last ? WAKE_LAST_HOURS : null;
    const ok = want !== null && Number.isFinite(m) && m >= want.min * 3600 && m <= want.max * 3600;
    const mark = want === null ? '    ' : ok ? '  ✓ ' : '  ✗ ';
    console.log(`${mark}    ${BOSS_BY_ID[w.boss].name} first falls: median ${Number.isFinite(m) ? hoursOf(m) : `not in ${hours} h`}${want ? ` (want ${want.min}–${want.max} h)` : ''} (${times.map((t) => hoursOf(Number.isFinite(t) ? t : undefined)).join(' ')})`);
  }
  const floors = reports.map((r) => r.floor);
  const okFloor = med(floors) >= ABYSS_FLOOR_12H;
  console.log(`  ${okFloor ? 'PASS' : 'FAIL'}  best Abyss floor at ${hours} h: median ${med(floors)} (want ≥ ${ABYSS_FLOOR_12H} at 12 h; ${floors.join(' ')})`);
  // The strata (plans/late-game/08 §9): each guardian's first fall, the waypoints' levels, the strata's share of Starlight.
  for (const st of STRATA) {
    const times = reports.map((r) => r.strata.fell[st.boss] ?? Infinity);
    const m = med(times);
    console.log(`        ${BOSS_BY_ID[st.boss].name} first falls: median ${Number.isFinite(m) ? formatDuration(m) : `not in ${hours} h`} (${times.map((t) => fmt(Number.isFinite(t) ? t : null)).join(' ')})`);
  }
  // R3 (plans/review-risks.md): past the last built stratum the old cycle takes over, and the
  // new content stops. Its guardian's fall opens that floor; read as play from a new save.
  const deep = stratumFoot(STRATA.length);
  const lastGuardian = STRATA[STRATA.length - 1].boss;
  const arrive = verdicts.map((v) => {
    const t = v.report?.strata.fell[lastGuardian];
    return v.act1 !== null && t !== undefined ? v.act1 + t : Infinity;
  });
  const mDeep = med(arrive);
  console.log(`        floor ${deep} (past the built strata) first reached: median ${Number.isFinite(mDeep) ? formatDuration(mDeep) : `not in ${hours} h of Act 2`} of play from a new save (${arrive.map((t) => fmt(Number.isFinite(t) ? t : null)).join(' ')})`);
  const feet = [...new Set(reports.flatMap((r) => Object.keys(r.strata.entry).map(Number)))].sort((a, b) => a - b);
  for (const f of feet) {
    const levels = reports.flatMap((r) => r.strata.entry[f] ?? []);
    console.log(`        level entering floor ${f} from the top: median ${med(levels)} over ${levels.length} descents (waypoint now ${BALANCE.strata.waypoint.level[Math.floor((f - 1) / 6)]})`);
  }
  const share = reports.map((r) => (r.sources.abyss + r.sources.strata) / Math.max(1, r.starlight));
  console.log(`        the Abyss's share of Starlight: median ${(med(share) * 100).toFixed(0)}% (want ≤ 25%)`);
  const last = reports.map((r) => r.lastStar ?? Infinity);
  const mLast = med(last);
  const okLast = mLast >= LAST_STAR_HOURS.min * 3600 && mLast <= LAST_STAR_HOURS.max * 3600;
  console.log(`  ${okLast ? 'PASS' : 'FAIL'}  last star lit: median ${Number.isFinite(mLast) ? formatDuration(mLast) : `not in ${hours} h`} (want ${LAST_STAR_HOURS.min}–${LAST_STAR_HOURS.max} h; ${last.map((t) => fmt(Number.isFinite(t) ? t : null)).join(' ')})`);
  const sunk = (h: Act2Report['hourly'][number]): number => h.capstones + h.fortune + h.tempered;
  const perHour = reports.map((r) => r.hourly.map((h, i) => sunk(h) - (i > 0 ? sunk(r.hourly[i - 1]) : sunk(r.hourly[0]))));
  const cols = Math.max(0, ...perHour.map((p) => p.length));
  const line = Array.from({ length: cols }, (_, i) => med(perHour.flatMap((p) => (i < p.length ? [p[i]] : [])))).join(' ');
  console.log(`        capstone ranks + Fortune + tempered levels per hour (median by hour, from hour 2): ${line}`);
}

async function main(): Promise<void> {
  if (FAST_STEPS > 1) console.log(`--fast: the bots step ${FAST_STEPS} game steps at a time; medians, not seeds, compare with a full reading\n`);
  if (TOOL_ARENA !== PHONE_OVAL) console.log(`--arena: ${arenaLine()}\n`);
  const hours = Number(arg('hours', '1'));
  const seed = Number(arg('seed', '1'));
  const seeds = Number(arg('seeds', '0'));
  if (process.argv.includes('--frontiers')) {
    await frontiersMain();
    return;
  }
  if (process.argv.includes('--act2')) {
    // `--stop-at <boss>` (plans/late-game/12a W2): each seed ends once that boss is down.
    const stopAt = arg('stop-at', '');
    if (stopAt && !(stopAt in BOSS_BY_ID)) throw new Error(`--stop-at ${stopAt}: no such boss`);
    await act2Main(Math.max(1, seeds || 1), hours, process.argv.includes('--reuse'), process.argv.includes('--wake-frontiers'), (stopAt || undefined) as BossId | undefined);
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
    const gate = (f: (r: PacingReport) => boolean): string => (reports.filter(f).length >= Math.ceil(seeds * I6_GATE_SHARE) ? 'PASS' : 'FAIL');
    const want = `want ≥ ${Math.ceil(seeds * I6_GATE_SHARE)}/${seeds}`;
    console.log(`  I3 passes ${count((r) => r.i3)}`);
    console.log(`  ${gate((r) => r.i6)}  I6  no gap over 10:00 in the first 2 h: ${count((r) => r.i6)} (${want}) · worst: ${reports.map((r) => formatDuration(r.worstGap.seconds)).join(' ')} · median ${formatDuration(medianWorstGap(reports))} (CI's reading)`);
    if (hours > 2) {
      // R2 §5: a gate from 2 h to the Blight, with the Contract board on (the bot takes cards once it opens).
      const short = reports.filter((r) => r.bossKills[FINALE] === undefined).length;
      const note = short > 0 ? ` · ${short} never saw the Blight, read to the report's end` : '';
      console.log(`  ${gate((r) => r.i6late)}  I6  no gap over 30:00 from 2 h to the Blight: ${count((r) => r.i6late)} (${want}) · worst: ${reports.map((r) => `${formatDuration(r.worstLateGap.seconds)}@${formatDuration(r.worstLateGap.from)}`).join(' ')}${note}`);
      const st = reports.map((r) => (r.stretchGap ? formatDuration(r.stretchGap.seconds) : '—'));
      console.log(`  Hollow King → Blight worst gap (want ≤ 30:00): ${st.join(' ')}`);
      console.log(`  trials won: ${reports.map((r) => Object.keys(r.trials).length).join(' ')}`);
      const all = reports.reduce((t, r) => {
        for (const k of [1, 2, 3, 4]) {
          t.tries[k] = (t.tries[k] ?? 0) + (r.contracts.tries[k] ?? 0);
          t.met[k] = (t.met[k] ?? 0) + (r.contracts.met[k] ?? 0);
        }
        return t;
      }, emptyContractTally());
      console.log(`  contracts (every ${CONTRACT_EVERY}th run from Forgeheart): ${reports.map((r) => r.contracts.runs).join(' ')} runs · ${successLine(all)}`);
    }
    const paces = reports.map(systemPace);
    const quarters = paces[0].perQuarter.map((_, q) => {
      const xs = paces.map((p) => p.perQuarter[q]).sort((a, b) => a - b);
      return xs[xs.length >> 1];
    });
    console.log(`  ${count((r) => systemPace(r).pass)} R1  ≤ 1 new system per 10 min in the first 3 h · pairs too close: ${paces.map((p) => p.close).join(' ')} · within 2 min: ${paces.map((p) => p.crowded).join(' ')}`);
    console.log(`        new systems per 15 min (median): ${quarters.join(' ')}`);
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
    console.log(`  ${okFin ? 'PASS' : 'FAIL'}  I1b median first ${BOSS_BY_ID[FINALE].name} kill ${fmt(fin)} (${I1B_WANT}) · passes ${count((r) => r.i1b)}`);
    console.log(`  first evolution: ${reports.map((r) => fmt(r.firstEvolution)).join(' ')}`);
    console.log(`        median first evolution ${fmt(medianOf(reports, (r) => r.firstEvolution))} (§7.1 aims at 1:30:00–2:00:00)`);
    // D-26: how long runs last in sim time, and how many ended won (overtime's last wave held, or its time out).
    const sims = reports.flatMap((r) => r.runs.map((x) => x.simSeconds)).sort((a, b) => a - b);
    const simMin = (s: number | undefined): string => ((s ?? 0) / 60).toFixed(1);
    console.log(`  run sim minutes: median ${simMin(sims[sims.length >> 1])} · max ${simMin(sims[sims.length - 1])} · cleared ${reports.map((r) => r.runs.filter((x) => x.cleared).length).join(' ')}`);
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
  console.log('\nsystems (R1):');
  for (const v of systemsOf(r)) console.log(`  ${pad(formatDuration(v.at), 7)}  ${pad(v.system!, 12)}  ${v.what}`);
  const pace = systemPace(r);
  console.log(`  per 15 min, first 3 h: ${pace.perQuarter.join(' ')}`);
  console.log('\nverdicts:');
  const mark = (ok: boolean): string => (ok ? 'PASS' : 'FAIL');
  console.log(`  ${mark(r.i3)}  I3  every results screen shows a node at ≥ 50%`);
  console.log(`  ${mark(r.i6)}  I6  longest gap between reveals ${formatDuration(r.worstGap.seconds)} (from ${formatDuration(r.worstGap.from)}; max 10:00)`);
  if (hours > 2) {
    console.log(`  ${mark(r.i6late)}  I6  from 2 h to the Blight: longest gap ${formatDuration(r.worstLateGap.seconds)} (from ${formatDuration(r.worstLateGap.from)}; max 30:00)`);
    if (r.stretchGap) console.log(`        Hollow King → Blight: longest gap ${formatDuration(r.stretchGap.seconds)} (from ${formatDuration(r.stretchGap.from)})`);
  }
  console.log(`  ${mark(pace.pass)}  R1  ≤ 1 new system per 10 min in the first 3 h (${pace.close} pairs closer, ${pace.crowded} within 2 min; the Gatekeeper's fall may open two)`);
  console.log(`  ${mark(r.wave20)}  P3  wave 20 first reached at ${r.firstWave20 === null ? 'never' : formatDuration(r.firstWave20)} (want 15:00–30:00)`);
  const g = r.bossKills.gatekeeper;
  console.log(`  ${mark(r.i1a)}  I1a the Gatekeeper first falls at ${g === undefined ? 'never' : formatDuration(g)} (want 20:00–40:00)`);
  const f = r.bossKills[FINALE];
  console.log(`  ${mark(r.i1b)}  I1b ${BOSS_BY_ID[FINALE].name} first falls at ${f === undefined ? 'never' : formatDuration(f)} (${I1B_WANT})`);
  if (csv) {
    // `kind` (R1 §1): content or system; explainer opens are listed too, as `explainer` (not I6's reveals).
    const rows = [
      ...r.reveals.map((v) => ({ ...v, kind: v.system ? 'system' : 'content' })),
      ...r.explainers.map((v) => ({ ...v, kind: 'explainer' })),
    ].sort((a, b) => a.at - b.at);
    writeFileSync(csv, ['seconds,kind,system,reveal', ...rows.map((v) => `${v.at.toFixed(1)},${v.kind},${v.system ?? ''},"${v.what}"`)].join('\n') + '\n');
    console.log(`\nreveal timeline written to ${csv}`);
  }
}

// Only when run as the script, so tests can import `runPacing`; in a seed's
// worker, only that seed's job.
if (IN_WORKER) workerJobs(JOBS);
else if (process.argv[1]?.includes('pacing')) void main();
