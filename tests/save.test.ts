import { describe, expect, it } from 'vitest';
import { MemorySaveStore } from '../src/meta/save/stores/SaveStore';
import {
  CORRUPT_KEY, LEGACY_BACKUP_KEY, LEGACY_KEY, PROFILE_KEY, RUN_KEY, SEALED_KEY, SNAPSHOT_VERSION,
  clearRunSnapshot, loadProfile, loadRunSnapshot, saveProfile, saveRunSnapshot, snapshotRun,
} from '../src/meta/save';
import { buildRunConfig } from '../src/meta/runConfig';
import { createRun, step } from '../src/sim/run';
import type { RunState } from '../src/sim/state';
import { SIM_DT } from '../src/app/loop';
import { hashString } from '../src/core/rng';
import { botInput } from '../tools/bot';
import { MIGRATIONS, MigrationError, migrate, type Migration, type RawProfile } from '../src/meta/save/migrate';
import { isProfile } from '../src/meta/save/schema';
import { PROFILE_VERSION, newProfile } from '../src/meta/profile';
import { exportProfile, importProfile, listBackups, pushBackup, readBackup } from '../src/meta/save/transfer';
import { seal, unseal } from '../src/meta/save/seal';

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

  it('writes the profile sealed, and reads an edited one as corrupt', async () => {
    const store = new MemorySaveStore();
    const p = newProfile(5);
    p.shards = 123;
    await saveProfile(p, store);
    const raw = (await store.get(PROFILE_KEY))!;
    expect(raw).not.toContain('shards');
    const flipped = raw.slice(0, 40) + (raw[40] === 'A' ? 'B' : 'A') + raw.slice(41);
    await store.set(PROFILE_KEY, flipped);
    expect((await loadProfile(0, store)).fresh).toBe('corrupt');
  });

  it('reseals a plain profile from before the seal once, and refuses plain JSON after', async () => {
    const store = new MemorySaveStore();
    const p = newProfile(5);
    p.shards = 50;
    await store.set(PROFILE_KEY, JSON.stringify(p));
    const first = await loadProfile(0, store);
    expect(first.fresh).toBeNull();
    expect(first.profile.shards).toBe(50);
    expect(await store.get(SEALED_KEY)).not.toBeNull();
    expect(JSON.parse(unseal((await store.get(PROFILE_KEY))!))).toEqual(p);
    await store.set(PROFILE_KEY, JSON.stringify({ ...p, shards: 1e9 }));
    expect((await loadProfile(0, store)).fresh).toBe('corrupt');
  });

  it('refuses plain JSON on a profile that started sealed', async () => {
    const store = new MemorySaveStore();
    await loadProfile(0, store);
    expect(await store.get(SEALED_KEY)).not.toBeNull();
    await store.set(PROFILE_KEY, JSON.stringify({ ...newProfile(0), shards: 1e9 }));
    expect((await loadProfile(0, store)).fresh).toBe('corrupt');
  });

  it('restores the newest backup that reads in place of a corrupt profile', async () => {
    const store = new MemorySaveStore();
    for (const runs of [4, 5, 6]) {
      const p = newProfile(5);
      p.records.runs = runs;
      p.shards = runs * 100;
      p.lastSeen = runs;
      await pushBackup(p, store);
    }
    await store.set(PROFILE_KEY, '{not json');
    const res = await loadProfile(0, store);
    expect(res.fresh).toBe('corrupt');
    expect(res.restoredFrom).toBe(6);
    expect(res.profile.shards).toBe(600);
    expect(await store.get(CORRUPT_KEY)).toBe('{not json');
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
    }, MIGRATIONS, 3);
    expect(out.records).toEqual({ runs: 3, bestWave: 8, bestShards: 0, kills: 0 });
    expect(out.tutorial).toEqual({ firstDraft: true, forgeIntro: false });
    expect(out.forge).toEqual({});
    expect(out.seenEnemies).toEqual([]);
    expect(out.seenCards).toEqual(['weapon:arcane-bolt']);
  });

  it('walks a v3 profile to v4, keeping its Forge and totals', () => {
    const out = migrate({
      version: 3, createdAt: 5, shards: 50, records: { runs: 9, bestWave: 19, bestShards: 80, kills: 900 },
      forge: { 'might-damage': 2 }, seenCards: [], seenEnemies: ['grunt'], tutorial: { firstDraft: true, forgeIntro: true },
      settings: { speed: 2 },
    }, MIGRATIONS, 4);
    expect(out.version).toBe(4);
    expect(out.records).toEqual({ runs: 9, bestWave: 19, bestShards: 80, kills: 900, elites: 0 });
    expect(out.forge).toEqual({ 'might-damage': 2 });
    expect(out.bosses).toEqual({});
    expect(out.relics).toEqual({});
    expect(out.equipped).toEqual([]);
    expect(out.region).toBe(1);
    expect(out.frame).toBe('arcanist');
    expect(out.lastSeen).toBe(5);
    expect(isProfile(out)).toBe(true);
  });

  it('walks a v4 profile to v5: an empty Recipe Book, the sound on, the speed kept', () => {
    const out = migrate({ version: 4, createdAt: 5, shards: 50, settings: { speed: 3 } }, MIGRATIONS, 5);
    expect(out.version).toBe(5);
    expect(out.recipes).toEqual({ found: [], carried: {}, readied: {} });
    expect(out.settings).toEqual({ speed: 3, sound: true });
  });

  it('walks a v6 profile to v7: no Starlight, no stars, no pacts, the Abyss untouched (§9)', () => {
    const out = migrate({ version: 6, createdAt: 5, shards: 50, region: 6, settings: { speed: 3 } }, MIGRATIONS, 7);
    expect(out.version).toBe(7);
    expect(out.starlight).toBe(0);
    expect(out.stars).toEqual({});
    expect(out.pacts).toEqual({ ranks: {}, best: {} });
    expect(out.abyss).toEqual({ best: 0 });
    expect(out.region).toBe(6);
  });

  it('walks a v7 profile to v8: the settings gain their defaults, and keep what was set (P9)', () => {
    const out = migrate({ version: 7, createdAt: 5, shards: 50, settings: { speed: 2, sound: false, autoUlt: true } }, MIGRATIONS, 8);
    expect(out.version).toBe(8);
    expect(out.settings).toEqual({
      speed: 2,
      sound: false,
      autoUlt: true,
      volume: { master: 1, sfx: 1, music: 0.6 },
      shake: true,
      motion: 'system',
      palette: 'standard',
      textScale: 1,
    });
  });

  it('walks a v8 profile to v9: no Never lists, the Tactician\'s lists kept (U7)', () => {
    const out = migrate({ version: 8, createdAt: 5, shards: 50, tactics: { all: ['power'] } }, MIGRATIONS, 9);
    expect(out.version).toBe(9);
    expect(out.tacticsNever).toEqual({});
    expect(out.tactics).toEqual({ all: ['power'] });
  });

  it('walks a v9 profile to v10: an empty wishlist, no trials, no set progress (Q3)', () => {
    const out = migrate({ version: 9, createdAt: 5, shards: 50, tacticsNever: {} }, MIGRATIONS, 10);
    expect(out.version).toBe(10);
    expect(out.wishlist).toEqual([]);
    expect(out.trials).toEqual({});
    expect(out.trial).toBeNull();
    expect(out.sets).toEqual({});
    expect(out.shards).toBe(50);
  });

  it('walks a v10 profile to v11: no Boss Rush records or fusions yet (Q4)', () => {
    const out = migrate({ version: 10, createdAt: 5, shards: 50, sets: {} }, MIGRATIONS, 11);
    expect(out.version).toBe(11);
    expect(out.rush).toEqual({ best: 0, time: null });
    expect(out.fusions).toEqual([]);
    expect(out.shards).toBe(50);
  });

  it('walks a v11 profile to v12: the camera follows the light (camera-and-fog)', () => {
    const out = migrate({ version: 11, createdAt: 5, shards: 50, settings: { speed: 2 } }, MIGRATIONS, 12);
    expect(out.version).toBe(12);
    expect(out.settings).toEqual({ speed: 2, framing: null });
    expect(out.shards).toBe(50);
  });

  it('walks a v12 profile to v13: no explainers read, the lessons kept (§7.1)', () => {
    const out = migrate({ version: 12, createdAt: 5, shards: 50, tutorial: { firstDraft: true, forgeIntro: true } }, MIGRATIONS, 13);
    expect(out.version).toBe(13);
    expect(out.tutorial).toEqual({ firstDraft: true, forgeIntro: true, explained: [] });
  });

  it('the shipped ladder takes a v1 profile to the current version, shaped like a new one', () => {
    const out = migrate({ version: 1, createdAt: 0, shards: 4, records: { runs: 2, bestWave: 5 }, settings: { speed: 1 } });
    expect(out.version).toBe(PROFILE_VERSION);
    expect(out.seenCards).toEqual([]);
    expect(out.tutorial).toEqual({ firstDraft: false, forgeIntro: false, explained: [] });
    expect(out.forge).toEqual({});
    expect(out.records).toEqual({ runs: 2, bestWave: 5, bestShards: 0, kills: 0, elites: 0 });
    expect(out.shards).toBe(4);
    // Every field a fresh profile has, the migrated one has too.
    expect(Object.keys(out).sort()).toEqual(Object.keys(newProfile(0)).sort());
    expect(Object.keys(out.settings as object).sort()).toEqual(Object.keys(newProfile(0).settings).sort());
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

describe('carrying a profile (U12)', () => {
  it('exports and imports a profile unchanged', () => {
    const p = newProfile(7);
    p.shards = 1234;
    p.forge = { 'might-damage': 3 };
    expect(importProfile(exportProfile(p))).toEqual(p);
  });

  it('walks an old export up the ladder', () => {
    const out = importProfile(seal(JSON.stringify({ version: 1, createdAt: 0, shards: 4, records: { runs: 2, bestWave: 5 }, settings: { speed: 1 } })));
    expect(out.version).toBe(PROFILE_VERSION);
    expect(out.shards).toBe(4);
  });

  it('refuses what is not a profile', () => {
    expect(() => importProfile('not json')).toThrow();
    expect(() => importProfile('{"hello": 1}')).toThrow();
    expect(() => importProfile(seal(JSON.stringify({ ...newProfile(0), version: PROFILE_VERSION + 1 })))).toThrow();
  });

  it('refuses plain JSON and edited text', () => {
    const p = newProfile(7);
    expect(() => importProfile(JSON.stringify(p))).toThrow();
    const text = exportProfile(p);
    const json = unseal(text);
    expect(JSON.parse(json)).toEqual(p);
    const edited = text.slice(0, 30) + (text[30] === 'x' ? 'y' : 'x') + text.slice(31);
    expect(() => importProfile(edited)).toThrow();
    expect(() => importProfile(seal(json).replace('TWR1.', 'TWR1.AA'))).toThrow();
  });

  it('keeps the last three runs\' profiles, newest first', async () => {
    const store = new MemorySaveStore();
    for (let runs = 1; runs <= 5; runs++) {
      const p = newProfile(0);
      p.records.runs = runs;
      p.lastSeen = runs * 1000;
      await pushBackup(p, store);
    }
    const list = await listBackups(store);
    expect(list.map((b) => b.runs)).toEqual([5, 4, 3]);
    expect((await readBackup(list[0].slot, store))?.records.runs).toBe(5);
  });
});
