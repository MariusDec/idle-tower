/**
 * The profile: all meta state (§12.4). Owned by `meta/`; `sim/` never sees it,
 * only the frozen `RunConfig` that `buildRunConfig` derives from it.
 *
 * It starts small: fields arrive with the phase that uses them, and
 * each arrival that changes the shape is a new version on the ladder in
 * `save/migrate.ts`.
 */
export interface Profile {
  version: 3;
  /** Wall-clock ms the profile was created. */
  createdAt: number;
  /** The meta currency (§8.1), spent in the Forge. Whole shards only. */
  shards: number;
  /** Lifetime records and totals, for the results screen's NEW RECORD callouts. */
  records: {
    runs: number;
    bestWave: number;
    /** Most shards banked by one run. */
    bestShards: number;
    kills: number;
  };
  /** Forge levels owned, by node id (§5.1). A missing id is level 0. */
  forge: Record<string, number>;
  /** Draft cards seen at least once, by `cardKey`, for the NEW stamp (§4.5). */
  seenCards: string[];
  /** Enemy types ever seen, for the results screen's discoveries (§4.6). */
  seenEnemies: string[];
  /** One-time teaching moments (§7.1), true once done. */
  tutorial: {
    /** The first draft of the game: authored, and the only one that pauses. */
    firstDraft: boolean;
    /** The first visit to the Forge, which highlights a node to buy. */
    forgeIntro: boolean;
  };
  settings: {
    /** Sim speed multiplier, 1–3 (§12.3). */
    speed: 1 | 2 | 3;
  };
}

export const PROFILE_VERSION = 3;

export function newProfile(now: number): Profile {
  return {
    version: PROFILE_VERSION,
    createdAt: now,
    shards: 0,
    records: { runs: 0, bestWave: 0, bestShards: 0, kills: 0 },
    forge: {},
    seenCards: [],
    seenEnemies: [],
    tutorial: { firstDraft: false, forgeIntro: false },
    settings: { speed: 1 },
  };
}
