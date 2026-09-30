import { openDB, type IDBPDatabase } from 'idb';
import type { SaveStore } from './SaveStore';

const DB_NAME = 'the-tower';
const DB_VERSION = 1;
const STORE = 'kv';

/**
 * The web backend. One object store, string values. The database name is the
 * legacy game's, so the legacy save is still found there and can be backed up
 * (§12.4, D3).
 *
 * IndexedDB writes are transactional, so unlike the file backend there is no
 * torn-write to defend against: a `put` either lands whole or not at all.
 */
export class IdbSaveStore implements SaveStore {
  private dbPromise: Promise<IDBPDatabase> | null = null;

  private db(): Promise<IDBPDatabase> {
    // Opened lazily and exactly once, so constructing the store stays free.
    if (!this.dbPromise) {
      this.dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        },
      });
    }
    return this.dbPromise;
  }

  async get(key: string): Promise<string | null> {
    const value = await (await this.db()).get(STORE, key);
    return typeof value === 'string' ? value : null;
  }

  async set(key: string, value: string): Promise<void> {
    await (await this.db()).put(STORE, value, key);
  }

  async remove(key: string): Promise<void> {
    await (await this.db()).delete(STORE, key);
  }
}
