import { newProfile, type Profile } from '../profile';
import { migrate, type RawProfile } from './migrate';
import { isProfile } from './schema';
import { getSaveStore, type SaveStore } from './stores';

/** The rebuild's key (§12.4). */
export const PROFILE_KEY = 'tower-profile';
/** Where a broken or unreadable profile is parked before a fresh one replaces it. */
export const CORRUPT_KEY = 'tower-profile-corrupt';
/** The legacy game's save key, and where it is copied to once (D3). */
export const LEGACY_KEY = 'the-tower-save';
export const LEGACY_BACKUP_KEY = 'the-tower-save-legacy-backup';

export interface LoadResult {
  profile: Profile;
  /** Why the profile is fresh, if it is. For the dev log, never the player. */
  fresh: 'new' | 'corrupt' | null;
  /** True when a legacy save was found and backed up this load. */
  backedUpLegacy: boolean;
}

/**
 * Load the profile, or start a fresh one.
 *
 * A save that fails to parse or migrate is never silently dropped: it is
 * copied to `CORRUPT_KEY` first, so a bug in a migration costs a restore, not
 * a profile.
 */
export async function loadProfile(now: number, store: SaveStore = getSaveStore()): Promise<LoadResult> {
  const backedUpLegacy = await backUpLegacySave(store);
  const raw = await store.get(PROFILE_KEY);
  if (raw === null) return { profile: newProfile(now), fresh: 'new', backedUpLegacy };
  try {
    const migrated = migrate(JSON.parse(raw) as RawProfile);
    if (!isProfile(migrated)) throw new Error('not a profile');
    return { profile: migrated, fresh: null, backedUpLegacy };
  } catch (err) {
    console.error('[save] profile unreadable; starting fresh', err);
    await store.set(CORRUPT_KEY, raw);
    return { profile: newProfile(now), fresh: 'corrupt', backedUpLegacy };
  }
}

export async function saveProfile(profile: Profile, store: SaveStore = getSaveStore()): Promise<void> {
  await store.set(PROFILE_KEY, JSON.stringify(profile));
}

/**
 * Copy the legacy save to a backup key, once (§12.4, D3). The original is left
 * where it is: the tag `legacy-final` can still read it.
 */
async function backUpLegacySave(store: SaveStore): Promise<boolean> {
  const legacy = await store.get(LEGACY_KEY);
  if (legacy === null) return false;
  if ((await store.get(LEGACY_BACKUP_KEY)) !== null) return false;
  await store.set(LEGACY_BACKUP_KEY, legacy);
  return true;
}
