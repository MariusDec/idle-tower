import type { Profile } from './profile';

/**
 * The frozen input to a run (§12.3). `buildRunConfig` resolves every Forge,
 * relic and frame effect once, so `sim/` never reads the profile.
 *
 * At P0 there is nothing to resolve yet; the shape grows with the Forge (P3).
 */
export interface RunConfig {
  readonly frameId: string;
  readonly regionId: number;
}

export function buildRunConfig(_profile: Profile): RunConfig {
  return Object.freeze({ frameId: 'arcanist', regionId: 1 });
}
