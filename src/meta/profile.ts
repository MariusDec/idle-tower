/**
 * The profile: all meta state (§12.4). Owned by `meta/`; `sim/` never sees it,
 * only the frozen `RunConfig` that `buildRunConfig` derives from it.
 *
 * It starts small: fields arrive with the phase that uses them, and
 * each arrival that changes the shape is a new version on the ladder in
 * `save/migrate.ts`.
 */
export interface Profile {
  version: 2;
  /** Wall-clock ms the profile was created. */
  createdAt: number;
  /** The meta currency (§8.1). Spent in the Forge from P3. */
  shards: number;
  /** Lifetime records, for the results screen's NEW RECORD callouts. */
  records: {
    runs: number;
    bestWave: number;
  };
  /** Draft cards seen at least once, by `cardKey`, for the NEW stamp (§4.5). */
  seenCards: string[];
  /** One-time teaching moments (§7.1), true once done. */
  tutorial: {
    /** The first draft of the game: authored, and the only one that pauses. */
    firstDraft: boolean;
  };
  settings: {
    /** Sim speed multiplier, 1–3 (§12.3). */
    speed: 1 | 2 | 3;
  };
}

export const PROFILE_VERSION = 2;

export function newProfile(now: number): Profile {
  return {
    version: PROFILE_VERSION,
    createdAt: now,
    shards: 0,
    records: { runs: 0, bestWave: 0 },
    seenCards: [],
    tutorial: { firstDraft: false },
    settings: { speed: 1 },
  };
}
