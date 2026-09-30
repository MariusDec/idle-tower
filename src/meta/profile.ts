/**
 * The profile: all meta state (§12.4). Owned by `meta/`; `sim/` never sees it,
 * only the frozen `RunConfig` that `buildRunConfig` derives from it.
 *
 * v1 is deliberately small. Fields arrive with the phase that uses them, and
 * each arrival that changes the shape is a new version on the ladder in
 * `save/migrate.ts`.
 */
export interface Profile {
  version: 1;
  /** Wall-clock ms the profile was created. */
  createdAt: number;
  /** The meta currency (§8.1). Spent in the Forge from P3. */
  shards: number;
  /** Lifetime records, for the results screen's NEW RECORD callouts. */
  records: {
    runs: number;
    bestWave: number;
  };
  settings: {
    /** Sim speed multiplier, 1–3 (§12.3). */
    speed: 1 | 2 | 3;
  };
}

export const PROFILE_VERSION = 1;

export function newProfile(now: number): Profile {
  return {
    version: PROFILE_VERSION,
    createdAt: now,
    shards: 0,
    records: { runs: 0, bestWave: 0 },
    settings: { speed: 1 },
  };
}
