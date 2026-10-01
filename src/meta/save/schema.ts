import type { Profile } from '../profile';
import type { RunState } from '../../sim/state';

/**
 * Shape checks for a migrated profile. Deliberately shallow: the ladder is
 * what guarantees shape, and this only catches a save that is not a profile
 * at all (a hand-edited file, a different app's key).
 */
export function isProfile(raw: unknown): raw is Profile {
  if (typeof raw !== 'object' || raw === null) return false;
  const p = raw as Partial<Profile>;
  return typeof p.version === 'number'
    && typeof p.createdAt === 'number'
    && typeof p.shards === 'number'
    && typeof p.records === 'object' && p.records !== null
    && typeof p.forge === 'object' && p.forge !== null
    && typeof p.settings === 'object' && p.settings !== null;
}

/** Shape checks for a run snapshot: as shallow, for the same reason. */
export function isRunState(raw: unknown): raw is RunState {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Partial<RunState>;
  return typeof r.seed === 'number'
    && typeof r.tick === 'number'
    && typeof r.wave === 'number'
    && r.outcome === null
    && Array.isArray(r.weapons)
    && Array.isArray(r.enemies)
    && Array.isArray(r.projectiles)
    && typeof r.tower === 'object' && r.tower !== null
    && typeof r.streams === 'object' && r.streams !== null;
}
