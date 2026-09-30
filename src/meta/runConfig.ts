import type { Profile } from './profile';
import { baseTowerStats } from '../sim/stats';
import type { RunConfig } from '../sim/state';

export type { RunConfig };

/**
 * Profile → frozen `RunConfig` (§12.3). Resolves every Forge, relic and frame
 * effect once per run. There is nothing to resolve yet; the Forge is P3.
 */
export function buildRunConfig(_profile: Profile): RunConfig {
  return Object.freeze({
    frameId: 'arcanist',
    regionId: 1,
    stats: Object.freeze(baseTowerStats()),
  });
}
