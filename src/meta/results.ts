import { BOSSES } from '../content/bosses';
import { FORGE } from '../content/forge';
import { FRAMES } from '../content/frames';
import { REGIONS } from '../content/regions';
import { bossRelic } from '../content/relics';
import type { BossId, EnemyId, FeatDef, RelicId } from '../content/types';
import type { RunState } from '../sim/state';
import { bossDown, frameUnlocked, gainRelic, hubUnlocks, regionUnlocked, relicSlots } from './collection';
import { checkFeats } from './feats';
import { nextGoal, type ForgeGoal } from './forge';
import { recordFarm } from './offline';
import type { Profile } from './profile';

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

/** Everything the results screen shows (§4.6), resolved once at the run's end. */
export interface RunSummary {
  outcome: 'fell' | 'retreat';
  regionId: number;
  wave: number;
  time: number;
  kills: number;
  level: number;
  /** Whole shards banked. */
  shards: number;
  /** The breakdown behind `shards`, unrounded. */
  shardsFrom: { kills: number; waves: number; cards: number; elites: number; boss: number };
  records: { wave: RecordBroken | null; shards: RecordBroken | null };
  /** Enemy types this profile had never seen before this run. */
  newEnemies: EnemyId[];
  /** Draft cards (`cardKey`) first seen this run. */
  newCards: string[];
  boss: BossResult | null;
  /** Relics found this run, with the rank each now has (0: it was already maxed). */
  relics: { id: RelicId; rank: number }[];
  /** Feats earned this run, waiting in the Feats tab. */
  feats: FeatDef[];
  /** What this run opened up, in words: "Map", "Drowned Mire", "Relic slot 1"… (§7.3). */
  unlocks: string[];
  /** The "Next:" line, after the shards are banked. */
  next: ForgeGoal | null;
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
  for (const r of REGIONS) if (r.index > 1 && regionUnlocked(profile, r.index)) add(r.name);
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
  const records = {
    wave: wave > r.bestWave && r.runs > 0 ? { old: r.bestWave, now: wave } : null,
    shards: shards > r.bestShards && r.runs > 0 ? { old: r.bestShards, now: shards } : null,
  };
  r.runs++;
  r.kills += run.kills;
  r.elites += run.elitesKilled;
  r.bestWave = Math.max(r.bestWave, wave);
  r.bestShards = Math.max(r.bestShards, shards);
  profile.shards += shards;
  const region = (profile.regions[run.regionId] ??= { bestWave: 0 });
  region.bestWave = Math.max(region.bestWave, wave);
  for (const [type, n] of Object.entries(run.killsBy)) profile.killsBy[type] = (profile.killsBy[type] ?? 0) + (n ?? 0);
  recordFarm(profile, shards, time / Math.max(1, speed));

  const known = new Set(profile.seenEnemies);
  const newEnemies = run.seen.filter((id) => !known.has(id));
  profile.seenEnemies.push(...newEnemies);

  // The boss: met, maybe felled; a first fall pays its relic and owes the map its ceremony.
  let boss: BossResult | null = null;
  const relics: { id: RelicId; rank: number }[] = [];
  if (run.boss) {
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

  const feats = checkFeats(profile, run);
  const after = unlockList(profile);
  const unlocks = [...after].filter(([key]) => !before.has(key)).map(([, label]) => label);

  return {
    outcome: run.outcome?.kind ?? 'retreat',
    regionId: run.regionId,
    wave,
    time,
    kills: run.kills,
    level: run.level,
    shards,
    shardsFrom: { ...run.shardsFrom },
    records,
    newEnemies,
    newCards: [...newCards],
    boss,
    relics,
    feats,
    unlocks,
    next: nextGoal(profile),
  };
}
