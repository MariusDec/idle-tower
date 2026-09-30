import type { Profile } from '../profile';

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
    && typeof p.settings === 'object' && p.settings !== null;
}
