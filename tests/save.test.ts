import { describe, expect, it } from 'vitest';
import { MemorySaveStore } from '../src/meta/save/stores/SaveStore';
import {
  CORRUPT_KEY, LEGACY_BACKUP_KEY, LEGACY_KEY, PROFILE_KEY, RUN_KEY, SNAPSHOT_VERSION,
  clearRunSnapshot, loadProfile, loadRunSnapshot, saveProfile, saveRunSnapshot, snapshotRun,
} from '../src/meta/save';
import { buildRunConfig } from '../src/meta/runConfig';
import { createRun, step } from '../src/sim/run';
import type { RunState } from '../src/sim/state';
import { SIM_DT } from '../src/app/loop';
import { hashString } from '../src/core/rng';
import { botInput } from '../tools/bot';
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

  it('walks a v2 profile to v3, keeping its records and lessons', () => {
    const out = migrate({
      version: 2, createdAt: 0, shards: 9, records: { runs: 3, bestWave: 8 },
      seenCards: ['weapon:arcane-bolt'], tutorial: { firstDraft: true }, settings: { speed: 1 },
    });
    expect(out.records).toEqual({ runs: 3, bestWave: 8, bestShards: 0, kills: 0 });
    expect(out.tutorial).toEqual({ firstDraft: true, forgeIntro: false });
    expect(out.forge).toEqual({});
    expect(out.seenEnemies).toEqual([]);
    expect(out.seenCards).toEqual(['weapon:arcane-bolt']);
  });

  it('the shipped ladder takes a v1 profile to the current version', () => {
    const out = migrate({ version: 1, createdAt: 0, shards: 4, records: { runs: 2, bestWave: 5 }, settings: { speed: 1 } });
    expect(out.version).toBe(PROFILE_VERSION);
    expect(out.seenCards).toEqual([]);
    expect(out.tutorial).toEqual({ firstDraft: false, forgeIntro: false });
    expect(out.forge).toEqual({});
    expect(out.records).toEqual({ runs: 2, bestWave: 5, bestShards: 0, kills: 0 });
    expect(out.shards).toBe(4);
  });

  it('refuses a missing rung, a future version and a rung that skips', () => {
    expect(() => migrate(v1, {}, 2)).toThrow(MigrationError);
    expect(() => migrate({ version: 3 }, ladder, 2)).toThrow(MigrationError);
    expect(() => migrate(v1, { 1: (r) => ({ ...r, version: 3 }) }, 3)).toThrow(MigrationError);
    expect(() => migrate({ version: 0 }, ladder, 2)).toThrow(MigrationError);
  });
});

describe('run snapshot (§12.4)', () => {
  const play = (run: RunState, until: (r: RunState) => boolean): void => {
    while (!run.outcome && !until(run)) {
      step(run, SIM_DT, botInput(run, 'active'));
      run.events.length = 0;
    }
  };
  const hash = (run: RunState): number => {
    const { events: _events, ...rest } = run;
    return hashString(JSON.stringify(rest));
  };

  it('a run resumed from a wave-start snapshot plays out exactly as the original', async () => {
    const store = new MemorySaveStore();
    const profile = newProfile(7);
    profile.tutorial.firstDraft = true;
    const run = createRun(buildRunConfig(profile), 99);
    play(run, (r) => r.wave >= 4);
    await saveRunSnapshot(snapshotRun(run, profile), store);
    const resumed = await loadRunSnapshot(profile, store);
    expect(resumed).not.toBeNull();
    play(run, (r) => r.time > 120);
    play(resumed!, (r) => r.time > 120);
    expect(hash(resumed!)).toBe(hash(run));
  });

  it('drops a snapshot from another profile, a stale version or a broken file', async () => {
    const store = new MemorySaveStore();
    const profile = newProfile(7);
    const run = createRun(buildRunConfig(profile), 1);
    await saveRunSnapshot(snapshotRun(run, newProfile(8)), store);
    expect(await loadRunSnapshot(profile, store)).toBeNull();
    expect(await store.get(RUN_KEY)).toBeNull();
    await store.set(RUN_KEY, JSON.stringify({ version: SNAPSHOT_VERSION + 1, profile: 7, run }));
    expect(await loadRunSnapshot(profile, store)).toBeNull();
    await store.set(RUN_KEY, '{nope');
    expect(await loadRunSnapshot(profile, store)).toBeNull();
    await saveRunSnapshot(snapshotRun(run, profile), store);
    await clearRunSnapshot(store);
    expect(await loadRunSnapshot(profile, store)).toBeNull();
  });
});
