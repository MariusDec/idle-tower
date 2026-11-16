/**
 * The Act 2 bot (§9, P8's gate): the active pacing bot carried past the
 * Blight's fall. It picks up each profile where the finale falls in the
 * Act 1 report, then plays on for N wall hours:
 *
 *   between runs  claims feats, shops the Forge (masteries included) and the
 *                 Constellations, cheapest first
 *   heat          climbs each region's record one heat level at a time, the
 *                 frontier first (it pays the most Starlight a level); a
 *                 region whose next level failed twice is set aside until
 *                 the tower grows (a star lit, a mastery level bought)
 *   the Abyss     every few runs, and whenever every ladder is set aside:
 *                 its floors pay Starlight, and its shards buy masteries
 *   Boss Rush     once the Deepwarden falls, now and then (N8): its records
 *                 pay Starlight too
 *   contracts     with `--contracts <share>`, that share of runs is a card
 *                 off the Contract board (plans/late-game/10 §9's bar):
 *                 0 by default, so the gate's readings are unchanged
 *
 * Pacts are taken in a fixed order, the mildest first for a strong tower
 * (`PACT_LADDER`), so heat h always means the same pacts.
 */
import { ABYSS_INDEX } from '../src/content/abyss';
import { RUSH_INDEX } from '../src/content/rush';
import { cursedSlots, ownedCursed, relicRank, rushOpen, toggleCursed } from '../src/meta/collection';
import { PACTS } from '../src/content/pacts';
import { REGIONS, regionByIndex } from '../src/content/regions';
import { STARS } from '../src/content/stars';
import type { PactId } from '../src/content/types';
import { Rng } from '../src/core/rng';
import { runSpeed } from '../src/meta/automation';
import { FORGE_WEB } from '../src/meta/forge';
import { claimAll } from '../src/meta/feats';
import { bestHeat, setPactRank } from '../src/meta/pacts';
import type { Profile } from '../src/meta/profile';
import { bankRun } from '../src/meta/results';
import { STAR_WEB, starsLit } from '../src/meta/stars';
import { createRun } from '../src/sim/run';
import { boardOpen } from '../src/meta/contracts';
import { playRun, toolConfig } from './play';
import { shop } from './shop';
import { botTake, emptyContractTally, holdsUlt, steerConfig, tallyContract, type ContractTally } from './contractBot';

/** The share of runs the bot plays off the Contract board (`--contracts 0.33`); 0 without the flag. */
export const CONTRACT_SHARE = ((): number => {
  const i = process.argv.indexOf('--contracts');
  const v = i >= 0 ? Number(process.argv[i + 1]) : 0;
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
})();

/** The bot's order of pacts, the mildest first for a strong tower: Scarcity first (it has cards to spare), Vigour last. */
const ORDER: readonly PactId[] = ['scarcity', 'elites', 'haste', 'tyranny', 'hordes', 'frailty', 'surge', 'vigour'];
/**
 * Under the Blight's rule every wave is an elite wave, so Elites and the
 * Surge (one more elite a wave) cost far more there: a player takes them last.
 */
const BLIGHT_ORDER: readonly PactId[] = ['scarcity', 'haste', 'tyranny', 'hordes', 'frailty', 'vigour', 'elites', 'surge'];

/** Heat h takes the first h of a ladder: the order, round-robin, a rank at a time. */
function ladder(order: readonly PactId[]): PactId[] {
  const left = new Map(PACTS.map((p) => [p.id, p.ranks]));
  const out: PactId[] = [];
  while (out.length < PACTS.reduce((s, p) => s + p.ranks, 0)) {
    for (const id of order) {
      const n = left.get(id) ?? 0;
      if (n > 0) {
        out.push(id);
        left.set(id, n - 1);
      }
    }
  }
  return out;
}

export const PACT_LADDER: readonly PactId[] = ladder(ORDER);
const BLIGHT_LADDER: readonly PactId[] = ladder(BLIGHT_ORDER);

/** The ladder the bot climbs in a region. */
export function ladderFor(region: number): readonly PactId[] {
  return regionByIndex(region).rule?.effect.kind === 'blight' ? BLIGHT_LADDER : PACT_LADDER;
}

/** Set the profile's pacts to heat `h` on the region's ladder. */
export function takePacts(profile: Profile, h: number, region = profile.region): void {
  for (const p of PACTS) setPactRank(profile, p.id, 0);
  const ranks = new Map<PactId, number>();
  for (const id of ladderFor(region).slice(0, h)) ranks.set(id, (ranks.get(id) ?? 0) + 1);
  for (const [id, r] of ranks) setPactRank(profile, id, r);
}

/** Light every star the Starlight allows, cheapest first. Returns their ids. */
export function shopStars(profile: Profile): string[] {
  const bought: string[] = [];
  for (;;) {
    const goal = STAR_WEB.nextGoal(profile);
    if (!goal || goal.progress < 1 || !STAR_WEB.buy(profile, goal.node.id)) break;
    bought.push(goal.node.id);
  }
  return bought;
}

/** Mastery levels owned in all. */
export function masteryLevels(profile: Profile): number {
  return FORGE_WEB.ownedNodes(profile).filter((o) => o.node.type === 'mastery').reduce((s, o) => s + o.level, 0);
}

/** Wall seconds between runs, as the Act 1 report reads them. */
const BETWEEN_RUNS = { idle: 6, shopping: 15 };
/** A region's next heat level is set aside after this many failures in a row. */
const FAIL_LIMIT = 2;
/** One run in this many goes down into the Abyss, ladders or not… */
const ABYSS_EVERY = 4;
/** …and one in this many, once it is open, is Boss Rush (N8). */
const RUSH_EVERY = 10;

export interface Act2Report {
  /** Wall seconds of Act 2 played. */
  seconds: number;
  runs: number;
  abyssRuns: number;
  /** Wall seconds since the Blight fell when heat h was first cleared anywhere, by h. */
  heatAny: Record<number, number>;
  /** …and in the Blight Heart, the frontier. */
  heatFrontier: Record<number, number>;
  /** Starlight earned in all, and stars lit, at the end. */
  starlight: number;
  /** Where the Starlight came from (S7): heat records by region index, the Abyss's floors, its guardians' lumps, feats. */
  sources: { heat: Record<number, number>; abyss: number; strata: number; rush: number; feats: number; contracts: number };
  /**
   * The strata (plans/late-game/08 §9): wall seconds since the Blight fell
   * when each guardian first fell, by boss id; and the tower's level on
   * entering each stratum's first floor from a descent begun at the top, by
   * floor (the waypoints' levels are read off these).
   */
  strata: { fell: Record<string, number>; entry: Record<number, number[]> };
  /** Wall seconds since the Blight fell when the last star was lit; null if it wasn't (B7). */
  lastStar: number | null;
  stars: number;
  masteries: number;
  /** The deepest floor of the Abyss, at the end. */
  floor: number;
  /** Boss Rush runs, and its record at the end: stages cleared, and a full clear's time (N8). */
  rushRuns: number;
  rush: { best: number; time: number | null };
  /** Each region's heat record at the end, by index. */
  best: Record<number, number>;
  /** Reliquaries met in the Abyss (plans/late-game/03 §9): dropped, claimed by the bot, faded. */
  reliquaries: { seen: number; claimed: number; faded: number };
  /** Anomalies dealt (plans/late-game/04 §9), all runs and the Abyss's; the bot never takes one. */
  anomalies: { offered: number; abyss: number };
  /** Cursed relics owned at the end, by id: rank and binding points. */
  cursed: Record<string, { rank: number; bound: number }>;
  /** The Contract board (plans/late-game/10 §9): runs taken off it, success by tier, what it paid. */
  contracts: { runs: number } & ContractTally;
  /** A line every hour: wall hour, stars lit, mastery levels, deepest floor, frontier heat. */
  hourly: { hour: number; stars: number; masteries: number; floor: number; frontier: number; starlight: number }[];
}

/**
 * Play Act 2 for `hours` wall hours from `profile`, which must have the
 * Blight down. The profile is played on in place.
 */
export function runAct2(profile: Profile, hours: number, seed: number): Act2Report {
  const seeds = new Rng(seed * 7919 + 1);
  const end = hours * 3600;
  const frontier = REGIONS[REGIONS.length - 1].index;
  const fails = new Map<string, number>();
  let power = starsLit(profile) + masteryLevels(profile);
  let clock = 0;
  let runs = 0;
  let abyssRuns = 0;
  const heatAny: Record<number, number> = {};
  const heatFrontier: Record<number, number> = {};
  const hourly: Act2Report['hourly'] = [];
  let earned = 0;
  const sources: Act2Report['sources'] = { heat: {}, abyss: 0, strata: 0, rush: 0, feats: 0, contracts: 0 };
  const contracts = { runs: 0, ...emptyContractTally() };
  const strata: Act2Report['strata'] = { fell: {}, entry: {} };
  let rushRuns = 0;
  let lastStar: number | null = null;
  const reliquaries = { seen: 0, claimed: 0, faded: 0 };
  const anomalies = { offered: 0, abyss: 0 };

  while (clock < end) {
    if (hourly.length < Math.floor(clock / 3600)) {
      hourly.push({
        hour: hourly.length + 1, stars: starsLit(profile), masteries: masteryLevels(profile),
        floor: profile.abyss.best, frontier: bestHeat(profile, frontier), starlight: earned,
      });
    }
    // Where next: the best-paying ladder not set aside, or the Abyss.
    let target: { region: number; heat: number } | null = null;
    for (const r of [...REGIONS].sort((a, b) => b.index - a.index)) {
      const h = bestHeat(profile, r.index) + 1;
      if (h > PACT_LADDER.length) continue;
      if ((fails.get(`${r.index}:${h}`) ?? 0) >= FAIL_LIMIT) continue;
      target = { region: r.index, heat: h };
      break;
    }
    // A contract run (plans/late-game/10 §9): its share of runs, spread evenly.
    const due = CONTRACT_SHARE > 0 && boardOpen(profile) && Math.floor((runs + 1) * CONTRACT_SHARE) > Math.floor(runs * CONTRACT_SHARE);
    const contract = due ? botTake(profile, contracts.runs, (p, h, region) => takePacts(p, h, region)) : null;
    const rush = !contract && rushOpen(profile) && runs % RUSH_EVERY === RUSH_EVERY - 1;
    const abyss = !contract && !rush && (target === null || runs % ABYSS_EVERY === ABYSS_EVERY - 1);
    if (contract) {
      contracts.runs++;
    } else if (rush) {
      profile.region = RUSH_INDEX;
      rushRuns++;
    } else if (abyss) {
      profile.region = ABYSS_INDEX;
      abyssRuns++;
    } else {
      profile.region = target!.region;
      takePacts(profile, target!.heat, target!.region);
    }
    const start = clock;
    const speed = runSpeed(profile);
    const run = createRun(steerConfig(toolConfig(profile), contract?.card), seeds.nextU32());
    const played = playRun(profile, run, {
      policy: 'active', speed, holdUlt: holdsUlt(contract?.card),
      // A stratum's first floor, reached from the top: the level a waypoint there should start at.
      onEvent: (ev) => {
        if (ev.kind === 'stratumEnter' && ev.floor > 1 && run.startWave === 1) (strata.entry[ev.floor] ??= []).push(run.level);
      },
    });
    clock += played.wall;
    const summary = bankRun(profile, run, played.newCards, speed);
    runs++;
    if (contract) {
      tallyContract(contracts, contract.tier, summary);
      sources.contracts += summary.contract?.pay?.starlight ?? 0;
      earned += summary.contract?.pay?.starlight ?? 0;
    }
    reliquaries.claimed += summary.reliquaries.claimed;
    reliquaries.faded += summary.reliquaries.faded;
    reliquaries.seen += summary.reliquaries.claimed + summary.reliquaries.faded;
    if (summary.anomaly) {
      anomalies.offered++;
      if (summary.abyss) anomalies.abyss++;
    }
    wearPolicy(profile);
    const fromHeat = summary.heatRecord?.starlight ?? 0;
    const fromFloor = summary.floorRecord?.starlight ?? 0;
    if (fromHeat > 0) sources.heat[profile.region] = (sources.heat[profile.region] ?? 0) + fromHeat;
    const fromRush = summary.rushRecord?.starlight ?? 0;
    const fromStrata = summary.stratumRecord?.starlight ?? 0;
    for (const id of summary.stratumRecord?.felled ?? []) strata.fell[id] ??= start + played.wall;
    sources.abyss += fromFloor;
    sources.strata += fromStrata;
    sources.rush += fromRush;
    earned += fromHeat + fromFloor + fromRush + fromStrata;
    if (!contract && !abyss && !rush && target) {
      const key = `${target.region}:${target.heat}`;
      if (summary.heatRecord) {
        fails.delete(key);
        const at = start + played.wall;
        for (let h = 1; h <= summary.heatRecord.now; h++) {
          heatAny[h] ??= at;
          if (target.region === frontier) heatFrontier[h] ??= at;
        }
      } else {
        fails.set(key, (fails.get(key) ?? 0) + 1);
      }
    }
    // Between runs: feats, the Forge, the stars.
    const before = profile.starlight;
    claimAll(profile);
    sources.feats += profile.starlight - before;
    earned += profile.starlight - before;
    const bought = [...shop(profile), ...shopStars(profile)];
    const now = starsLit(profile) + masteryLevels(profile);
    if (now > power) {
      power = now;
      fails.clear();
    }
    clock += bought.length > 0 ? BETWEEN_RUNS.shopping : BETWEEN_RUNS.idle;
    if (lastStar === null && starsLit(profile) === STARS.length) lastStar = clock;
  }
  const best: Record<number, number> = {};
  for (const r of REGIONS) best[r.index] = bestHeat(profile, r.index);
  return {
    seconds: clock, runs, abyssRuns, heatAny, heatFrontier, starlight: earned, sources, lastStar, stars: starsLit(profile),
    masteries: masteryLevels(profile), floor: profile.abyss.best, rushRuns, rush: { ...profile.rush }, best, hourly,
    reliquaries,
    anomalies,
    strata,
    contracts,
    cursed: Object.fromEntries(ownedCursed(profile).map((r) => [r.id, { rank: relicRank(profile, r.id), bound: profile.bound[r.id] ?? 0 }])),
  };
}

/**
 * The bot's wear policy for cursed relics (plans/late-game/03 §6): fill a
 * free cursed slot with the highest-ranked one owned. T5's readings will
 * pick per build once the strata's relics ship; with Glass Crown alone this
 * is the whole choice.
 */
export function wearPolicy(profile: Profile): void {
  if (profile.cursedWorn.length >= cursedSlots(profile)) return;
  const best = ownedCursed(profile)
    .filter((r) => !profile.cursedWorn.includes(r.id))
    .sort((a, b) => relicRank(profile, b.id) - relicRank(profile, a.id))[0];
  if (best) toggleCursed(profile, best.id);
}
