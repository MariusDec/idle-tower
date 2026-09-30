import { describe, expect, it } from 'vitest';
import { MemorySaveStore } from '../src/meta/save/stores/SaveStore';
import {
  CORRUPT_KEY, LEGACY_BACKUP_KEY, LEGACY_KEY, PROFILE_KEY, loadProfile, saveProfile,
} from '../src/meta/save';
import { MigrationError, migrate, type Migration, type RawProfile } from '../src/meta/save/migrate';
import { PROFILE_VERSION, newProfile } from '../src/meta/profile';

describe('profile save', () => {
  it('starts fresh on an empty store', async () => {
    const res = await loadProfile(1000, new MemorySaveStore());
    expect(res.fresh).toBe('new');
    expect(res.profile).toEqual(newProfile(1000));
  });

  it('round-trips', async () => {
    const store = new MemorySaveStore();
    const p = newProfile(5);
    p.shards = 123;
    p.records.bestWave = 9;
    await saveProfile(p, store);
    const res = await loadProfile(0, store);
    expect(res.fresh).toBeNull();
    expect(res.profile).toEqual(p);
  });

  it('parks an unreadable profile before replacing it', async () => {
    const store = new MemorySaveStore();
    await store.set(PROFILE_KEY, '{not json');
    const res = await loadProfile(0, store);
    expect(res.fresh).toBe('corrupt');
    expect(await store.get(CORRUPT_KEY)).toBe('{not json');
  });

  it('parks a profile from a newer build', async () => {
    const store = new MemorySaveStore();
    await store.set(PROFILE_KEY, JSON.stringify({ ...newProfile(0), version: PROFILE_VERSION + 1 }));
    expect((await loadProfile(0, store)).fresh).toBe('corrupt');
  });

  it('backs up a legacy save once and leaves the original (D3)', async () => {
    const store = new MemorySaveStore();
    await store.set(LEGACY_KEY, '{"version":25}');
    const first = await loadProfile(0, store);
    expect(first.backedUpLegacy).toBe(true);
    expect(first.fresh).toBe('new');
    expect(await store.get(LEGACY_BACKUP_KEY)).toBe('{"version":25}');
    expect(await store.get(LEGACY_KEY)).toBe('{"version":25}');
    await store.set(LEGACY_KEY, '{"version":26}');
    expect((await loadProfile(0, store)).backedUpLegacy).toBe(false);
    expect(await store.get(LEGACY_BACKUP_KEY)).toBe('{"version":25}');
  });
});

describe('migration ladder', () => {
  // The fixture the plan asks for (§12.4): a v1→v2 rung, exercised through the
  // real `migrate`, so the first schema change is an entry and not a rewrite.
  const v1: RawProfile = { version: 1, shards: 10, records: { runs: 1, bestWave: 3 } };
  const ladder: Record<number, Migration> = {
    1: (raw) => ({ ...raw, version: 2, forge: { owned: [] } }),
  };

  it('walks v1 → v2', () => {
    const out = migrate(v1, ladder, 2);
    expect(out.version).toBe(2);
    expect(out.forge).toEqual({ owned: [] });
    expect(out.shards).toBe(10);
  });

  it('is a no-op at the current version', () => {
    expect(migrate(v1, ladder, 1)).toBe(v1);
  });

  it('refuses a missing rung, a future version and a rung that skips', () => {
    expect(() => migrate(v1, {}, 2)).toThrow(MigrationError);
    expect(() => migrate({ version: 3 }, ladder, 2)).toThrow(MigrationError);
    expect(() => migrate(v1, { 1: (r) => ({ ...r, version: 3 }) }, 3)).toThrow(MigrationError);
    expect(() => migrate({ version: 0 }, ladder, 2)).toThrow(MigrationError);
  });
});
