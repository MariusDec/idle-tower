import { newProfile, type Profile } from '../profile';
import { migrate, type RawProfile } from './migrate';
import type { RunState } from '../../sim/state';
import { isProfile, isRunState } from './schema';
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

/** Where the live run's snapshot is kept (§12.4). */
export const RUN_KEY = 'tower-run';

/**
 * The snapshot's own format version. A snapshot is short-lived — it only has
 * to survive the app being killed mid-run — so it has no ladder: bump this
 * when `RunState` changes shape, and an older snapshot is dropped.
 */
export const SNAPSHOT_VERSION = 11;

interface RunSnapshot {
  version: number;
  /** The profile it belongs to; a snapshot never crosses into another profile. */
  profile: number;
  /**
   * `records.runs` when it was taken: the run's own number. Once the run is
   * banked the count moves on, so a snapshot whose clear never landed (the
   * app killed between the two writes) is dropped, never paid twice.
   */
  runs: number;
  run: RunState;
}

/**
 * The run as it stands, serialised now (§12.4). The app takes this at every
 * wave start, on a step boundary, so a resumed run continues exactly as the
 * original would have from that wave; the write itself may land later.
 */
export function snapshotRun(run: RunState, profile: Profile): string {
  const snap: RunSnapshot = {
    version: SNAPSHOT_VERSION, profile: profile.createdAt, runs: profile.records.runs, run: { ...run, events: [] },
  };
  return JSON.stringify(snap);
}

export async function saveRunSnapshot(snapshot: string, store: SaveStore = getSaveStore()): Promise<void> {
  await store.set(RUN_KEY, snapshot);
}

/** The run to resume, or null. A snapshot that doesn't fit is dropped, never fatal. */
export async function loadRunSnapshot(profile: Profile, store: SaveStore = getSaveStore()): Promise<RunState | null> {
  const raw = await store.get(RUN_KEY);
  if (raw === null) return null;
  try {
    const snap = JSON.parse(raw) as Partial<RunSnapshot>;
    if (snap.version !== SNAPSHOT_VERSION || snap.profile !== profile.createdAt) throw new Error('stale snapshot');
    if (snap.runs !== profile.records.runs) throw new Error('run already banked');
    if (!isRunState(snap.run)) throw new Error('not a run');
    return snap.run;
  } catch (err) {
    console.warn('[save] run snapshot dropped', err);
    await store.remove(RUN_KEY);
    return null;
  }
}

export async function clearRunSnapshot(store: SaveStore = getSaveStore()): Promise<void> {
  await store.remove(RUN_KEY);
}
