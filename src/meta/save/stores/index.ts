import { Capacitor } from '@capacitor/core';
import { MemorySaveStore, type SaveStore } from './SaveStore';
import { IdbSaveStore } from './IdbStore';
import { FilesystemSaveStore } from './FilesystemStore';

export type { SaveStore };
export { MemorySaveStore };

let active: SaveStore | null = null;

/**
 * Pick a backend once: the private data dir under Capacitor, IndexedDB in a
 * browser, memory anywhere else (node, and a browser that denies IndexedDB —
 * private-browsing modes do). A memory store means the session is not persisted,
 * which is the same thing the old `isStorageAvailable()` false branch meant.
 */
export function getSaveStore(): SaveStore {
  if (active) return active;
  try {
    if (Capacitor.isNativePlatform()) active = new FilesystemSaveStore();
    else if (typeof indexedDB !== 'undefined') active = new IdbSaveStore();
    else active = new MemorySaveStore();
  } catch {
    active = new MemorySaveStore();
  }
  return active;
}

/** Test seam. Pass `null` to fall back to auto-selection. */
export function setSaveStore(store: SaveStore | null): void {
  active = store;
}
