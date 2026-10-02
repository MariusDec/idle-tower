import type { Profile } from '../profile';
import { migrate, type RawProfile } from './migrate';
import { isProfile } from './schema';
import { getSaveStore, type SaveStore } from './stores';

/**
 * Carrying a profile across installs, and keeping a few behind it (U12).
 * Moving from the debug APK to a signed release wipes the app's data, so
 * the player takes the profile with them as text; and a bad write that
 * looks like a profile is undone from a rolling backup.
 */

/** The profile as text, to copy or save to a file. */
export function exportProfile(profile: Profile): string {
  return JSON.stringify(profile);
}

/**
 * Text back into a profile: parsed, walked up the migration ladder and
 * checked. Throws on anything that is not a profile.
 */
export function importProfile(text: string): Profile {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    throw new Error('That is not a saved profile.');
  }
  if (typeof raw !== 'object' || raw === null || typeof (raw as RawProfile).version !== 'number') {
    throw new Error('That is not a saved profile.');
  }
  const migrated = migrate(raw as RawProfile);
  if (!isProfile(migrated)) throw new Error('That is not a saved profile.');
  return migrated;
}

/** How many rolling backups are kept: one per run's end, oldest overwritten. */
export const BACKUPS = 3;

const backupKey = (slot: number): string => `tower-backup-${slot}`;

/** One kept backup, as the settings list it. */
export interface BackupInfo {
  slot: number;
  /** When it was taken (the profile's `lastSeen`), wall-clock ms. */
  savedAt: number;
  runs: number;
  shards: number;
}

/** Keep `profile` as a backup (at a run's end): the slot follows the run count, so the last `BACKUPS` are kept. */
export async function pushBackup(profile: Profile, store: SaveStore = getSaveStore()): Promise<void> {
  await store.set(backupKey(profile.records.runs % BACKUPS), exportProfile(profile));
}

/** The backup in `slot`, read as an import is; null if there is none or it does not read. */
export async function readBackup(slot: number, store: SaveStore = getSaveStore()): Promise<Profile | null> {
  const raw = await store.get(backupKey(slot));
  if (raw === null) return null;
  try {
    return importProfile(raw);
  } catch {
    return null;
  }
}

/** Every backup kept, newest first. One that will not read is left out. */
export async function listBackups(store: SaveStore = getSaveStore()): Promise<BackupInfo[]> {
  const out: BackupInfo[] = [];
  for (let slot = 0; slot < BACKUPS; slot++) {
    const p = await readBackup(slot, store);
    if (p) out.push({ slot, savedAt: p.lastSeen, runs: p.records.runs, shards: p.shards });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
