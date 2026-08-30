/**
 * Where the save bytes live. See `plans/capacitor.md` §8.
 *
 * Three implementations, one interface: IndexedDB in a browser, a file in the
 * app's private data dir under Capacitor, memory in node and tests. The
 * interface is deliberately a string key/value store and not a "save" API —
 * `SaveManager` owns the format, this layer owns the bytes, and neither knows
 * anything about the other.
 */
export interface SaveStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** The fallback: node (`sim/checks.ts`), tests, and any browser that denies both backends. */
export class MemorySaveStore implements SaveStore {
  private readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}
