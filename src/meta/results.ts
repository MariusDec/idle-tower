import { ABYSS_INDEX, floorOf } from '../content/abyss';
import { BALANCE } from '../content/balance';
import { BOSSES, BOSS_BY_ID } from '../content/bosses';
import { FORGE } from '../content/forge';
import { FRAMES } from '../content/frames';
import { REGIONS } from '../content/regions';
import { RELIC_SETS, bossRelic, setOf } from '../content/relics';
import type { BossId, EnemyId, EvolutionId, FeatDef, PassiveId, RelicId, WeaponId } from '../content/types';
import type { DamageBy, HurtBy, RunState } from '../sim/state';
import {
  act2Open, bossDown, frameUnlocked, gainRelic, hubUnlocks, regionUnlocked, relicSlots, setOwned, setRank, trophiesAt,
} from './collection';
import { checkFeats } from './feats';
import { foremanBuy } from './automation';
import { trialsOpen, winTrial, type TrialPaid } from './trials';
import { nextGoal, type ForgeGoal } from './forge';
import { recordFarm } from './offline';
import { recipesOpen, recordRecipes } from './recipes';
import { recordFloor, recordHeat, type StarRecord } from './pacts';
import type { Profile } from './profile';
import { pactLoad } from '../sim/pacts';
import { BOSS_WAVE, regionAt, waveBonus } from '../sim/systems/waves';

/** A record broken this run: the old value is shown struck through (§7.3). */
export interface RecordBroken {
  old: number;
  now: number;
}

/** What a boss fight came to, for the results screen. */
export interface BossResult {
  id: BossId;
  /** Seconds from its arrival to its fall; null if it stood. */
  killedIn: number | null;
  /** True the first time this boss ever falls: the region's biggest moment (§7.3). */
  first: boolean;
}

/** The tower as the run left it (U3, U5): its weapons and passives, with their levels. */
export interface BuildSummary {
  weapons: { id: WeaponId; level: number; evolved: boolean }[];
  passives: { id: PassiveId; level: number }[];
}

/** The build a run holds now, for the HUD strip, the pause menu and the results. */
export function buildOf(run: RunState): BuildSummary {
  return {
    weapons: run.weapons.map((w) => ({ id: w.id, level: w.level, evolved: w.evolved })),
    passives: run.passives.map((p) => ({ id: p.id, level: p.level })),
  };
}

/** Everything the results screen shows (§4.6), resolved once at the run's end. */
export interface RunSummary {
  outcome: 'fell' | 'retreat';
  regionId: number;
  /** The frame it ran with, for its ultimate's name in the damage tally. */
  frameId: string;
  /** The tower at the end (U5). */
  build: BuildSummary;
  /** Damage landed, by what dealt it (T1, U5). */
  damageBy: Partial<Record<DamageBy, number>>;
  /** Damage taken, by what dealt it (U5): what wore the tower down. */
  takenBy: Partial<Record<HurtBy, number>>;
  wave: number;
  time: number;
  kills: number;
  level: number;
  /** Whole shards banked. */
  shards: number;
  /** The breakdown behind `shards`, unrounded. */
  shardsFrom: { kills: number; waves: number; cards: number; elites: number; boss: number };
  /**
   * The wave record is this region's own (§7.3); past its boss it is told as
   * overtime, waves beyond the boss. None in the Abyss, whose record is the floor.
   */
  records: { wave: RecordBroken | null; overtime: RecordBroken | null; shards: RecordBroken | null };
  /** Enemy types this profile had never seen before this run. */
  newEnemies: EnemyId[];
  /** Draft cards (`cardKey`) first seen this run. */
  newCards: string[];
  /** Evolutions found for the first time this run (§5.3). */
  newRecipes: EvolutionId[];
  boss: BossResult | null;
  /**
   * Relics found this run, with the rank each now has (0: it was already
   * maxed, and paid `shards`, or added to its set's progress, `set`, instead).
   */
  relics: { id: RelicId; rank: number; shards?: number; set?: string }[];
  /** Feats earned this run, waiting in the Feats tab. */
  feats: FeatDef[];
  /** True once the Feats tab is open: before it, feats are earned quietly, for the tab's first burst (§5.4). */
  featsOpen: boolean;
  /** What this run opened up, in words: "Map", "Drowned Mire", "Relic slot 1"… (§7.3). */
  unlocks: string[];
  /** The "Next:" line, after the shards are banked. */
  next: ForgeGoal | null;
  /** The heat the run was under (§9); 0 before Act 2 and in the Abyss. */
  heat: number;
  /** A region cleared at a new heat record, and the Starlight it paid (§9). */
  heatRecord: StarRecord | null;
  /** In the Abyss (§9): the floor the run ended on, and floors cleared. Null in a region. */
  abyss: { floor: number; cleared: number } | null;
  /** A new deepest floor, and the Starlight it paid. */
  floorRecord: StarRecord | null;
  /** The Trial this run was (N5): whether it was won, and what it paid the first time. Null for an ordinary run. */
  trial: { id: string; won: boolean; paid: TrialPaid | null } | null;
  /** What the Foreman bought as the run banked (N7): Forge node ids, one per level. */
  foreman: string[];
  /** Overtime trophies earned this run (N4): the overtime wave each marks, and its one-time shards. */
  trophies: { overtime: number; shards: number }[];
}

/**
 * Everything that may open between runs, keyed, with its words, so a run's
 * unlocks are a diff of two of these.
 */
function unlockList(profile: Profile): Map<string, string> {
  const out = new Map<string, string>();
  const add = (label: string, key = label): void => {
    out.set(key, label);
  };
  const hub = hubUnlocks(profile);
  if (hub.map) add('The Map');
  if (hub.feats) add('Feats');
  if (act2Open(profile)) {
    add('Pacts');
    add('The Constellations');
    add('The Abyss');
  }
  if (recipesOpen(profile)) add('The Recipe Book');
  for (const r of REGIONS) if (r.index > 1 && regionUnlocked(profile, r.index)) add(r.name);
  for (const r of REGIONS) if (trialsOpen(profile, r.index)) add(`Trials: ${r.name}`);
  // A relic set owned whole (N6): it can be worn for its bonus; each rank it reaches, too.
  for (const set of RELIC_SETS) {
    if (!setOwned(profile, set)) continue;
    add(`Relic set: ${set.name}`);
    const rank = setRank(profile, set.region);
    if (rank > 1) add(`${set.name} rank ${'I'.repeat(rank)}`);
  }
  for (const f of FRAMES) if (f.unlock.kind !== 'start' && frameUnlocked(profile, f)) add(`${f.name} frame`);
  const slots = relicSlots(profile);
  for (let i = 1; i <= slots; i++) add(`Relic slot ${i}`);
  // One line per boss, for the nodes its fall unseals.
  for (const b of BOSSES) {
    if (!bossDown(profile, b.id)) continue;
    const n = FORGE.filter((x) => x.sealed === b.id).length;
    if (n > 0) add(`${n} Forge node${n === 1 ? '' : 's'} unsealed`, `seal:${b.id}`);
  }
  return out;
}

/**
 * Bank a finished run into the profile and describe it (§4.6). The one place
 * a run's rewards reach the profile, for the app and the pacing bot alike.
 * `newCards` are the cards the app stamped NEW during the run; `speed` is
 * the game speed it ran at, for the offline farm rate (§6.3).
 */
export function bankRun(profile: Profile, run: RunState, newCards: readonly string[] = [], speed = 1): RunSummary {
  const wave = run.outcome?.wave ?? run.wave;
  const time = run.outcome?.time ?? run.time;
  const shards = Math.floor(run.shards);
  const before = unlockList(profile);
  const r = profile.records;
  // The Abyss counts its waves across floors (§9): they are no region's record.
  const abyss = run.regionId === ABYSS_INDEX;
  const regionBest = abyss ? undefined : profile.regions[run.regionId]?.bestWave;
  const waveRecord = regionBest !== undefined && wave > regionBest;
  const records = {
    wave: waveRecord && wave <= BOSS_WAVE ? { old: regionBest, now: wave } : null,
    overtime: waveRecord && wave > BOSS_WAVE ? { old: Math.max(0, regionBest - BOSS_WAVE), now: wave - BOSS_WAVE } : null,
    shards: shards > r.bestShards && r.runs > 0 ? { old: r.bestShards, now: shards } : null,
  };
  r.runs++;
  r.kills += run.kills;
  r.elites += run.elitesKilled;
  if (!abyss) r.bestWave = Math.max(r.bestWave, wave);
  r.bestShards = Math.max(r.bestShards, shards);
  profile.shards += shards;
  const trophies: { overtime: number; shards: number }[] = [];
  if (!abyss) {
    const region = (profile.regions[run.regionId] ??= { bestWave: 0 });
    const had = trophiesAt(region.bestWave);
    region.bestWave = Math.max(region.bestWave, wave);
    // Overtime trophies (N4): each threshold first passed pays once, by that wave's pay.
    for (const k of trophiesAt(region.bestWave)) {
      if (had.includes(k)) continue;
      const n = BOSS_WAVE + k;
      const pay = Math.floor(BALANCE.trophies.pay * waveBonus(regionAt(run.regionId, n), n) * run.stats.shardMult);
      profile.shards += pay;
      trophies.push({ overtime: k, shards: pay });
    }
  }
  for (const [type, n] of Object.entries(run.killsBy)) profile.killsBy[type] = (profile.killsBy[type] ?? 0) + (n ?? 0);
  recordFarm(profile, shards, time / Math.max(1, speed));

  const known = new Set(profile.seenEnemies);
  const newEnemies = run.seen.filter((id) => !known.has(id));
  profile.seenEnemies.push(...newEnemies);

  // The boss: met, maybe felled; a first fall pays its relic and owes the map its ceremony.
  // In the Abyss only its own bosses keep records (§9): the floors' guardians are their regions'.
  let boss: BossResult | null = null;
  const relics: RunSummary['relics'] = [];
  if (abyss) {
    for (const id of run.felled) {
      if (!BOSS_BY_ID[id].abyss) continue;
      const rec = (profile.bosses[id] ??= { kills: 0, fastest: null });
      rec.kills++;
    }
    const standing = run.boss && run.boss.killedIn === null ? run.boss.id : null;
    if (standing && BOSS_BY_ID[standing].abyss) profile.bosses[standing] ??= { kills: 0, fastest: null };
  } else if (run.boss) {
    const b = run.boss;
    const rec = (profile.bosses[b.id] ??= { kills: 0, fastest: null });
    const first = b.killedIn !== null && rec.kills === 0;
    if (b.killedIn !== null) {
      rec.kills++;
      rec.fastest = rec.fastest === null ? b.killedIn : Math.min(rec.fastest, b.killedIn);
    }
    boss = { id: b.id, killedIn: b.killedIn, first };
    if (first) {
      profile.ceremony = b.id;
      const relic = bossRelic(b.id);
      if (relic) relics.push({ id: relic, rank: gainRelic(profile, relic) });
    }
  }
  for (const id of run.relics) relics.push({ id, rank: gainRelic(profile, id) });
  // A relic already at its peak goes to its set's progress (N6), while the set
  // can still rank up; else it is melted down: a few waves' pay where it fell (§5.3).
  for (const x of relics) {
    if (x.rank !== 0) continue;
    const set = setOf(x.id);
    if (set && setRank(profile, set.region) < BALANCE.sets.maxRank) {
      profile.sets[set.region] = (profile.sets[set.region] ?? 0) + 1;
      x.set = set.name;
      continue;
    }
    const n = Math.max(1, wave);
    x.shards = Math.floor(BALANCE.relics.peakWaves * waveBonus(regionAt(run.regionId, n), n) * run.stats.shardMult);
    profile.shards += x.shards;
  }

  // Starlight (§9): a region's boss felled at a new heat record, or a new deepest floor.
  const heat = pactLoad(run.pacts).heat;
  // A Trial's omens (N5) are no pacts: they pay no heat record.
  const heatRecord = !abyss && !run.trial && run.boss?.killedIn != null ? recordHeat(profile, run.regionId, heat) : null;
  // A Trial (N5) is won by its region's boss falling; either way, the next run is an ordinary one.
  let trial: RunSummary['trial'] = null;
  if (run.trial) {
    const won = run.boss?.killedIn != null;
    trial = { id: run.trial, won, paid: won ? winTrial(profile, run.trial) : null };
    profile.trial = null;
  }
  const floorRecord = abyss ? recordFloor(profile, run.floors) : null;

  const newRecipes = recordRecipes(profile, run);
  const feats = checkFeats(profile, run);
  // The Foreman (N7) spends the run's shards on the wishlist before the Next line is read.
  const foreman = foremanBuy(profile);
  const after = unlockList(profile);
  const unlocks = [...after].filter(([key]) => !before.has(key)).map(([, label]) => label);

  return {
    outcome: run.outcome?.kind ?? 'retreat',
    regionId: run.regionId,
    frameId: run.frameId,
    build: buildOf(run),
    damageBy: { ...run.damageBy },
    takenBy: { ...run.takenBy },
    wave,
    time,
    kills: run.kills,
    level: run.level,
    shards,
    shardsFrom: { ...run.shardsFrom },
    records,
    newEnemies,
    newCards: [...newCards],
    newRecipes,
    boss,
    relics,
    feats,
    featsOpen: hubUnlocks(profile).feats,
    unlocks,
    next: nextGoal(profile),
    heat,
    heatRecord,
    abyss: abyss ? { floor: floorOf(Math.max(1, wave)), cleared: run.floors } : null,
    floorRecord,
    trophies,
    foreman,
    trial,
  };
}
