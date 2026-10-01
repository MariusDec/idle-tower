import type { EnemyId } from '../content/types';
import type { RunState } from '../sim/state';
import { nextGoal, type ForgeGoal } from './forge';
import type { Profile } from './profile';

/** A record broken this run: the old value is shown struck through (§7.3). */
export interface RecordBroken {
  old: number;
  now: number;
}

/** Everything the results screen shows (§4.6), resolved once at the run's end. */
export interface RunSummary {
  outcome: 'fell' | 'retreat';
  wave: number;
  time: number;
  kills: number;
  level: number;
  /** Whole shards banked. */
  shards: number;
  /** The breakdown behind `shards`, unrounded. */
  shardsFrom: { kills: number; waves: number; cards: number };
  records: { wave: RecordBroken | null; shards: RecordBroken | null };
  /** Enemy types this profile had never seen before this run. */
  newEnemies: EnemyId[];
  /** Draft cards (`cardKey`) first seen this run. */
  newCards: string[];
  /** The "Next:" line, after the shards are banked. */
  next: ForgeGoal | null;
}

/**
 * Bank a finished run into the profile and describe it (§4.6). The one place
 * a run's rewards reach the profile, for the app and the pacing bot alike.
 * `newCards` are the cards the app stamped NEW during the run.
 */
export function bankRun(profile: Profile, run: RunState, newCards: readonly string[] = []): RunSummary {
  const wave = run.outcome?.wave ?? run.wave;
  const shards = Math.floor(run.shards);
  const r = profile.records;
  const records = {
    wave: wave > r.bestWave && r.runs > 0 ? { old: r.bestWave, now: wave } : null,
    shards: shards > r.bestShards && r.runs > 0 ? { old: r.bestShards, now: shards } : null,
  };
  r.runs++;
  r.kills += run.kills;
  r.bestWave = Math.max(r.bestWave, wave);
  r.bestShards = Math.max(r.bestShards, shards);
  profile.shards += shards;

  const known = new Set(profile.seenEnemies);
  const newEnemies = run.seen.filter((id) => !known.has(id));
  profile.seenEnemies.push(...newEnemies);

  return {
    outcome: run.outcome?.kind ?? 'retreat',
    wave,
    time: run.outcome?.time ?? run.time,
    kills: run.kills,
    level: run.level,
    shards,
    shardsFrom: { ...run.shardsFrom },
    records,
    newEnemies,
    newCards: [...newCards],
    next: nextGoal(profile),
  };
}
