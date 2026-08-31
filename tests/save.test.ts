/**
 * Save round-trip, migration ladder and write cadence (plan §7.2, §5.7).
 *
 * The migration chain runs v2 -> v9 in sequence, so a defect in an early step
 * only shows up as missing data several versions later. These drive the real
 * `SaveManager` against a localStorage stub rather than calling the private
 * migration functions, which is the only way to cover the ladder as the
 * loading path actually walks it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveManager, type PersistentState, type OfflineResult, averageKillGoldForWave, averageKillXPForWave } from '../src/systems/SaveManager';
import { MemorySaveStore, setSaveStore } from '../src/systems/storage';
import { ContractManager } from '../src/systems/ContractManager';
import { PacingManager } from '../src/systems/PacingManager';
import type { GameState, WaveTimingState } from '../src/types';
import { TOWER_LEVEL_CAP, TOWER_XP_TABLE, talentPointsAtLevel, xpPerWaveClear } from '../src/data/xpTables';
import { MAX_RISK_CEILING, intermissionSecondsForWave } from '../src/data/pacing';
import { AP_PERK_BY_ID, TP_PERK_BY_ID } from '../src/data/prestige';
import { UPGRADE_BY_ID } from '../src/data/upgrades';
import { PASSIVE_BY_ID, PASSIVE_MAX_LEVEL } from '../src/data/passiveAbilities';
import { passiveWaveXpRef, passiveXpForLevel } from '../src/data/xpTables';
import { expectedWaveSeconds, isBossWave, spawnCountForWave } from '../src/data/formulas';
import { defaultWaveTiming } from '../src/data/waveTiming';

const STORAGE_KEY = 'the-tower-save';

let store: MemorySaveStore;

beforeEach(() => {
  store = new MemorySaveStore();
  setSaveStore(store);
});

/** A minimal bus stub: `SaveManager` only subscribes, never emits. */
const stubBus = { on: () => {} };

/** Seed the backend with a raw save, the way a previous version would have left it. */
async function seed(raw: string): Promise<void> {
  await store.set(STORAGE_KEY, raw);
}

/** A fresh manager that has read what is in the backend — the boot path, in one line. */
async function loadFresh(): Promise<PersistentState | null> {
  const mgr = new SaveManager(stubBus);
  await mgr.hydrate();
  await mgr.hydrate();
  return mgr.load();
}

function makeState(): GameState {
  return {
    tower: {
      x: 640, y: 360, hp: 90, maxHp: 100, baseDamage: 12, fireRate: 1.4, range: 220,
      critChance: 0.1, critMultiplier: 2, healthRegen: 0.01, damageType: 'physical',
      wallHp: 0, wallMaxHp: 0, knockbackForce: 0, shockwaveSize: 0, shockwaveCooldown: 0,
      shockwaveTimer: 0, landMineDamage: 0, landMineFrequency: 0, landMineTimer: 0,
      shieldMaxCharges: 0, shieldCurrentCharges: 0, shieldRechargeTime: 0,
      shieldRechargeTimer: 0, doubleShotChance: 0, quickShotChance: 0, quickShotTime: 0,
      targetingMode: 'nearest',
    },
    resources: {
      gold: 1234, lifetimeGold: 5678, mana: 40, maxMana: 100, manaRegen: 1,
      ascensionPoints: 7, lifetimeAP: 21, apThisTranscendence: 7, transcendencePoints: 3,
    },
    upgrades: { damage: 9, fireRate: 4 },
    research: {},
    researchInProgress: null,
    abilities: {},
    prestige: { apPerks: {}, tpPerks: {} },
    wave: { number: 17, highestWave: 22 },
    stats: { enemiesKilled: 400, lifetimeHighestWave: 22, runStartedAt: 1000 },
    achievements: ['first_blood'],
    runHistory: [],
    runStartedAt: 1000,
    towerXp: { level: 3, xp: TOWER_XP_TABLE[3], totalXpEarned: TOWER_XP_TABLE[3], unspentTalentPoints: 3 },
    talents: { allocated: { power_core: 2 } },
    passiveAbilities: { passive_marksmanship: { level: 2, xp: 30, unlocked: true } },
    equipment: [],
    waveTiming: defaultWaveTiming(),
    equipped: {},
    blessings: {
      held: { bl_sharpen: 2, bl_ricochet: 1 },
      picksTaken: 3,
      rerolls: 1,
      pendingOfferForWave: null,
      wavesClearedThisRun: 11,
    },
    bossRun: { apBonusPct: 0.1, swiftKills: 2, flawlessKills: 1 },
    contracts: {
      active: [
        { defId: 'ct_culling', uid: 4, target: 220, progress: 87, drawnAtWave: 14 },
        { defId: 'ct_hoard', uid: 5, target: 22, progress: 3, drawnAtWave: 16 },
        { defId: 'ct_arsenal', uid: 6, target: 30, progress: 11, drawnAtWave: 17 },
      ],
      completed: ['ct_first_cull', 'ct_press_on'],
      log: [
        { defId: 'ct_first_cull', wave: 5, gold: 940, rerolls: 0, rp: 0, apBonusPct: 0 },
        { defId: 'ct_press_on', wave: 11, gold: 0, rerolls: 0, rp: 1, apBonusPct: 0.03 },
      ],
      completedCount: 2,
      apBonusPct: 0.06,
      uidSeq: 6,
    },
  } as unknown as GameState;
}

describe('save round-trip', () => {
  it('restores the fields it persisted', async () => {
    const mgr = new SaveManager(stubBus, { getRP: () => 42 });
    await mgr.hydrate();
    expect(mgr.save(makeState())).toBe(true);

    const loaded = mgr.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.resources.gold).toBe(1234);
    expect(loaded!.resources.lifetimeAP).toBe(21);
    expect(loaded!.upgrades.damage).toBe(9);
    expect(loaded!.wave.number).toBe(17);
    expect(loaded!.rp).toBe(42);
    expect(loaded!.achievements).toEqual(['first_blood']);
    expect(loaded!.blessings?.held).toEqual({ bl_sharpen: 2, bl_ricochet: 1 });
    expect(loaded!.blessings?.picksTaken).toBe(3);
    expect(loaded!.blessings?.wavesClearedThisRun).toBe(11);
    expect(loaded!.contracts?.active.length).toBe(3);
    expect(loaded!.contracts?.active[0]).toEqual({
      defId: 'ct_culling', uid: 4, target: 220, progress: 87, drawnAtWave: 14,
    });
    expect(loaded!.contracts?.apBonusPct).toBe(0.06);
    expect(loaded!.contracts?.completed).toEqual(['ct_first_cull', 'ct_press_on']);
    // The completion log. `snapshotContracts` copies field by field on purpose,
    // so a field added to `ContractRunState` and nowhere else is dropped
    // silently — which is exactly what happened to this one first time round.
    expect(loaded!.contracts?.log).toEqual([
      { defId: 'ct_first_cull', wave: 5, gold: 940, rerolls: 0, rp: 0, apBonusPct: 0 },
      { defId: 'ct_press_on', wave: 11, gold: 0, rerolls: 0, rp: 1, apBonusPct: 0.03 },
    ]);
  });

  it('omits the completion log entirely when the run has none', async () => {
    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    const state = makeState();
    delete (state.contracts as { log?: unknown }).log;
    expect(mgr.save(state)).toBe(true);
    const loaded = mgr.load();
    // Absent, not `[]`: `ContractManager.restore` reads a missing `log` as
    // "this save predates the field" and falls back to `completed`.
    expect(loaded!.contracts).not.toHaveProperty('log');
  });

  it('discards a corrupt save rather than loading garbage', async () => {
    await seed('{not json');
    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    expect(mgr.load()).toBeNull();
    await mgr.flushNow();
    expect(await store.get(STORAGE_KEY)).toBeNull();
  });

  it('adopts a pre-move localStorage save exactly once', async () => {
    // Produce a genuine v21 payload rather than hand-rolling one: save through a
    // manager, take the bytes it wrote, then start over with an empty backend.
    const seedMgr = new SaveManager(stubBus);
    await seedMgr.hydrate();
    seedMgr.save(makeState());
    await seedMgr.flushNow();
    const legacy = (await store.get(STORAGE_KEY))!;

    store = new MemorySaveStore();
    setSaveStore(store);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === STORAGE_KEY ? legacy : null),
      setItem: () => {},
      removeItem: () => {},
    });

    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    expect(mgr.load()).not.toBeNull();
    // Adopted *into* the new backend, so the next boot needs no localStorage.
    expect(await store.get(STORAGE_KEY)).toBe(legacy);
    vi.unstubAllGlobals();
  });

  it('rejects a save from an unknown future version', async () => {
    await seed(JSON.stringify({ version: 999, savedAt: Date.now() }));
    expect((await loadFresh())).toBeNull();
  });
});

describe('migration ladder', () => {
  /**
   * A v2 save carries only what v2 knew about. Everything added since has to
   * be filled in by the ladder — this is the case that previously lost fields.
   */
  const v2Save = {
    version: 2,
    savedAt: Date.now(),
    tower: { hp: 50, maxHp: 100 },
    resources: { gold: 500, lifetimeGold: 500, mana: 10, maxMana: 100, manaRegen: 1 },
    upgrades: { damage: 5 },
    research: {},
    abilities: {},
    prestige: {},
    wave: { number: 12 },
    stats: { enemiesKilled: 90 },
  };

  it('walks a v2 save all the way to the current version', async () => {
    await seed(JSON.stringify(v2Save));
    const loaded = (await loadFresh());
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBeGreaterThanOrEqual(14);
  });

  it('preserves the v2 payload through every step of the ladder', async () => {
    await seed(JSON.stringify(v2Save));
    const loaded = (await loadFresh())!;
    expect(loaded.resources.gold).toBe(500);
    expect(loaded.upgrades.damage).toBe(5);
    expect(loaded.wave.number).toBe(12);
    expect(loaded.stats.enemiesKilled).toBe(90);
  });

  it('accepts every version the ladder claims to handle', async () => {
    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
      store = new MemorySaveStore();
      setSaveStore(store);
      await seed(JSON.stringify({ ...v2Save, version }));
      const loaded = (await loadFresh());
      expect(loaded, `version ${version} should load`).not.toBeNull();
      expect(loaded!.version).toBeGreaterThanOrEqual(14);
    }
  });

  /**
   * v9 -> v10 is purely additive (gameplay plan §1.5), so the test that matters
   * is the pair: a v9 save with no blessings gets an empty run seeded, and a
   * v10 save with blessings held keeps every stack through the ladder.
   */
  it('seeds an empty blessing run for a v9 save', async () => {
    await seed(JSON.stringify({ ...v2Save, version: 9 }));
    const loaded = (await loadFresh())!;
    expect(loaded.version).toBe(24);
    expect(loaded.blessings).toEqual({
      held: {},
      picksTaken: 0,
      rerolls: 0,
      pendingOfferForWave: null,
      wavesClearedThisRun: 0,
    });
  });

  it('carries blessings held in a v9 save through to v10', async () => {
    const held = { bl_frost: 1, bl_shatter: 1, bl_cruelty: 3 };
    await seed(JSON.stringify({
      ...v2Save,
      version: 9,
      blessings: {
        held,
        picksTaken: 5,
        rerolls: 2,
        pendingOfferForWave: 19,
        wavesClearedThisRun: 19,
      },
    }));
    const loaded = (await loadFresh())!;
    expect(loaded.version).toBe(24);
    expect(loaded.blessings!.held).toEqual(held);
    expect(loaded.blessings!.picksTaken).toBe(5);
    expect(loaded.blessings!.rerolls).toBe(2);
    expect(loaded.blessings!.wavesClearedThisRun).toBe(19);
  });

  /**
   * v13 -> v14 is additive too (gameplay plan §7.7). A v13 save is a run at
   * risk 0 with no momentum banked, which is exactly what §7.8 requires the
   * migration to mean: risk 0 reproduces the curve the save was playing.
   */
  it('seeds a risk-0 pacing block for a v13 save', async () => {
    await seed(JSON.stringify({ ...v2Save, version: 13 }));
    const loaded = (await loadFresh())!;
    expect(loaded.version).toBe(24);
    expect(loaded.pacing).toEqual({
      risk: 0, committedRisk: 0, momentum: 0, momentumWaves: 0, comboBest: 0,
    });
  });

  it('carries the risk dial and momentum through a v14 round trip', async () => {
    const pacing = {
      risk: 4, committedRisk: 3, momentum: 0.045, momentumWaves: 2, comboBest: 61,
    };
    await seed(JSON.stringify({ ...v2Save, version: 13, pacing }));
    const loaded = (await loadFresh())!;
    expect(loaded.pacing).toEqual(pacing);

    // And the real manager takes it back with both lifetimes intact: the dial
    // survives, the live combo does not.
    const mgr = new PacingManager();
    mgr.restore(loaded.pacing!);
    expect(mgr.riskLevel).toBe(4);
    expect(mgr.activeRisk).toBe(3);
    expect(mgr.momentumBonus).toBeCloseTo(0.045, 6);
    expect(mgr.combo).toBe(0);
    expect(mgr.snapshot()).toEqual(pacing);
  });

  /**
   * v11 -> v12 is additive too (gameplay plan §5.5). A v11 save is a run that
   * has simply not been handed any contracts, and one written mid-contract
   * keeps every slot's progress through the ladder.
   */
  it('seeds an empty contract run for a v11 save', async () => {
    await seed(JSON.stringify({ ...v2Save, version: 11 }));
    const loaded = (await loadFresh())!;
    expect(loaded.version).toBe(24);
    expect(loaded.contracts).toEqual({
      active: [], completed: [], completedCount: 0, apBonusPct: 0, uidSeq: 0,
    });
  });

  it('carries contracts in progress from a v11 save through to v12', async () => {
    const contracts = {
      active: [
        { defId: 'ct_culling', uid: 9, target: 220, progress: 140, drawnAtWave: 21 },
        { defId: 'ct_unbroken', uid: 10, target: 4, progress: 2, drawnAtWave: 22 },
        { defId: 'ct_hoard', uid: 11, target: 22, progress: 20, drawnAtWave: 24 },
      ],
      completed: ['ct_hold_the_line'],
      completedCount: 1,
      apBonusPct: 0.09,
      uidSeq: 11,
    };
    await seed(JSON.stringify({ ...v2Save, version: 11, contracts }));
    const loaded = (await loadFresh())!;
    expect(loaded.version).toBe(24);
    expect(loaded.contracts).toEqual(contracts);

    // And the real manager takes that state back without losing a slot.
    const mgr = new ContractManager({
      currentWave: () => 24,
      waveGold: () => 250,
    });
    mgr.restore(loaded.contracts!);
    expect(mgr.list.length).toBe(3);
    expect(mgr.list.map(c => c.progress)).toEqual([140, 2, 20]);
    expect(mgr.apBonusPct).toBeCloseTo(0.09, 10);
  });

  /**
   * v15 -> v16 is a key rename, not a transform (the `multishot` ability
   * became `rocket_barrage`). The saved state and its auto-cast toggle must
   * reappear under the new key with their values untouched.
   */
  it('renames multishot to rocket_barrage in a v15 save', async () => {
    await seed(JSON.stringify({
      ...v2Save,
      version: 15,
      abilities: {
        multishot: { level: 3, xp: 0, cooldown: 0, active: false, activeTimer: 0 },
      },
      prestige: { autoCastEnabled: { multishot: false } },
    }));
    const loaded = (await loadFresh())!;
    expect(loaded.version).toBe(24);
    expect(loaded.abilities.rocket_barrage).toEqual({
      level: 3, xp: 0, cooldown: 0, active: false, activeTimer: 0,
    });
    expect(loaded.abilities.multishot).toBeUndefined();
    expect(loaded.prestige.autoCastEnabled.rocket_barrage).toBe(false);
  });

  /**
   * v16 -> v17 is the levelling redesign. The old 0-based level is restated
   * onto the new 1-based curve, XP is restated, and all talents are refunded.
   */
  it('restates level 3 (0-based) to level 4 (1-based) with correct XP', async () => {
    await seed(JSON.stringify({
      ...v2Save,
      version: 16,
      towerXp: { level: 3, xp: 900, totalXpEarned: 1000, unspentTalentPoints: 3 },
      talents: { allocated: { power_core: 2 } },
    }));
    const loaded = (await loadFresh())!;
    expect(loaded.version).toBe(24);
    expect(loaded.towerXp.level).toBe(4); // 3 + 1 (0-based -> 1-based)
    expect(loaded.towerXp.xp).toBe(TOWER_XP_TABLE[4]);
    expect(loaded.towerXp.unspentTalentPoints).toBe(talentPointsAtLevel(4));
    expect(loaded.talents.allocated).toEqual({});
  });

  it('clamps level 500 to TOWER_LEVEL_CAP', async () => {
    await seed(JSON.stringify({
      ...v2Save,
      version: 16,
      towerXp: { level: 500, xp: 999999999, totalXpEarned: 1000000000, unspentTalentPoints: 500 },
      talents: { allocated: {} },
    }));
    const loaded = (await loadFresh())!;
    expect(loaded.version).toBe(24);
    expect(loaded.towerXp.level).toBe(TOWER_LEVEL_CAP);
    expect(loaded.towerXp.xp).toBe(TOWER_XP_TABLE[TOWER_LEVEL_CAP]);
    expect(loaded.towerXp.unspentTalentPoints).toBe(talentPointsAtLevel(TOWER_LEVEL_CAP));
  });

  it('treats missing towerXp as level 0 -> level 1', async () => {
    const save: Record<string, unknown> = { ...v2Save, version: 16 };
    delete save.towerXp;
    await seed(JSON.stringify(save));
    const loaded = (await loadFresh())!;
    expect(loaded.towerXp.level).toBe(1);
    expect(loaded.towerXp.xp).toBe(TOWER_XP_TABLE[1]);
    expect(loaded.towerXp.unspentTalentPoints).toBe(talentPointsAtLevel(1));
    expect(loaded.talents.allocated).toEqual({});
  });

  /**
   * v17 -> v18 wipes passiveAbilities (plan §14.3). The old `marksmanship`
   * unlock is not preserved — the v18 passive set is built fresh from the
   * new table, so any carried state must be discarded on load.
   */
  it('wipes passiveAbilities when migrating a v17 save', async () => {
    await seed(JSON.stringify({
      ...v2Save,
      version: 17,
      passiveAbilities: { marksmanship: { level: 5, xp: 200, unlocked: true } },
    }));
    const loaded = (await loadFresh())!;
    expect(loaded.version).toBe(24);
    expect(loaded.passiveAbilities).toEqual({});
  });

  it('fills in the enrage clock older saves predate', async () => {
    await seed(JSON.stringify(v2Save));
    const loaded = (await loadFresh())!;
    expect(loaded.wave.elapsed).toBe(0);
    expect(loaded.wave.enrageStacks).toBe(0);
  });

  it('survives a full save -> load -> save -> load cycle', async () => {
    const mgr = new SaveManager(stubBus, { getRP: () => 3 });
    await mgr.hydrate();
    mgr.save(makeState());
    const once = mgr.load()!;
    await seed(JSON.stringify(once));
    const twice = (await loadFresh())!;
    expect(twice.resources).toEqual(once.resources);
    expect(twice.upgrades).toEqual(once.upgrades);
    expect(twice.stats).toEqual(once.stats);
  });
});

describe('write cadence (plan §5.7)', () => {
  it('coalesces a burst of requests into a single deferred write', async () => {
    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    const state = makeState();
    let writes = 0;
    const onSave = () => (writes++, true);

    for (let i = 0; i < 20; i++) mgr.requestSave();
    expect(mgr.hasPendingSave).toBe(true);

    // One second of frames: still inside the debounce window.
    for (let i = 0; i < 60; i++) mgr.tick(1 / 60, state, onSave);
    expect(writes).toBe(0);

    // Past the window, exactly one write covers the whole burst.
    for (let i = 0; i < 300; i++) mgr.tick(1 / 60, state, onSave);
    expect(writes).toBe(1);
    expect(mgr.hasPendingSave).toBe(false);
  });

  it('still auto-saves on the slow timer when nothing requested a write', async () => {
    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    const state = makeState();
    let writes = 0;
    const onSave = () => (writes++, true);

    for (let i = 0; i < 60 * 29; i++) mgr.tick(1 / 60, state, onSave);
    expect(writes).toBe(0);
    for (let i = 0; i < 60 * 2; i++) mgr.tick(1 / 60, state, onSave);
    expect(writes).toBe(1);
  });

  it('clears the pending flag on a direct save, so no duplicate write follows', async () => {
    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    const state = makeState();
    mgr.requestSave();
    expect(mgr.save(state)).toBe(true);
    expect(mgr.hasPendingSave).toBe(false);

    let writes = 0;
    for (let i = 0; i < 60 * 6; i++) mgr.tick(1 / 60, state, () => (writes++, true));
    expect(writes).toBe(0);
  });
});

/**
 * v19 watch block (plan §8.3).
 *
 * The Long Watch lands in v19. A v18 save has no `watch` key and gets the
 * default seeded by migration; a v19 save with a malformed `watch` is
 * repaired in place by `normalizeWatch` rather than rejected.
 */
describe('v19 watch block', () => {
  /**
   * The same minimal save the `migration ladder` block uses, inlined here
   * because the original is scoped to its describe block.
   */
  const minimalSave = {
    version: 2,
    savedAt: Date.now(),
    tower: { hp: 50, maxHp: 100 },
    resources: { gold: 500, lifetimeGold: 500, mana: 10, maxMana: 100, manaRegen: 1 },
    upgrades: { damage: 5 },
    research: {},
    abilities: {},
    prestige: {},
    wave: { number: 12 },
    stats: { enemiesKilled: 90 },
  };

  // 1. v18 blob loads to v19 with a well-formed watch block.
  it('migrates a v18 save to v19 and seeds a well-formed watch block', async () => {
    await seed(JSON.stringify({ ...minimalSave, version: 18 }));
    const loaded = (await loadFresh());
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(24);
    expect(typeof loaded!.watch).toBe('object');
    expect(loaded!.watch).not.toBeNull();
    expect(Array.isArray(loaded!.watch!.counters.riskWaves)).toBe(true);
    expect(loaded!.watch!.counters.riskWaves).toHaveLength(MAX_RISK_CEILING + 1);
    // The rest of the block is also seeded cleanly.
    expect(loaded!.watch!.completed).toEqual([]);
    expect(loaded!.watch!.counters.flawlessWaves).toBe(0);
  });

  // 2. Malformed watch is repaired, not rejected.
  it('repairs a malformed watch block rather than rejecting the save', async () => {
    // Construct a v19 blob whose watch is broken in three places at once:
    //   - `completed` is missing entirely (normalizeWatch resets to [])
    //   - `counters.killsByType` is missing (resets to {})
    //   - `counters.flawlessWaves` is a string (resets to 0)
    //   - `counters.riskWaves` has only three entries (resized)
    const malformed = {
      ...minimalSave,
      version: 19,
      watch: {
        counters: {
          flawlessWaves: 'not a number',
          swiftBosses: NaN,
          riskWaves: [1, 2, 3],
        },
      },
    };
    await seed(JSON.stringify(malformed));
    const loaded = (await loadFresh());
    expect(loaded, 'save should load — normalizeWatch repairs, does not reject').not.toBeNull();
    expect(loaded!.version).toBe(24);

    const w = loaded!.watch!;
    expect(Array.isArray(w.completed)).toBe(true);
    expect(w.completed).toEqual([]);
    expect(typeof w.counters).toBe('object');
    expect(typeof w.counters.killsByType).toBe('object');
    expect(w.counters.killsByType).toEqual({});
    expect(typeof w.counters.flawlessWaves).toBe('number');
    expect(Number.isFinite(w.counters.flawlessWaves)).toBe(true);
    expect(w.counters.flawlessWaves).toBe(0);
    expect(w.counters.swiftBosses).toBe(0);
    expect(w.counters.riskWaves).toHaveLength(MAX_RISK_CEILING + 1);
    // And the first three slots were preserved.
    expect(w.counters.riskWaves[0]).toBe(1);
    expect(w.counters.riskWaves[1]).toBe(2);
    expect(w.counters.riskWaves[2]).toBe(3);
  });

  // 3. Round trip preserves completed and every counter.
  it('round-trips completed and every counter through save and load', async () => {
    const state = {
      ...makeState(),
      watch: {
        completed: ['wc_first_watch'],
        counters: {
          killsByType: { tank: 42 },
          flawlessWaves: 7,
          swiftBosses: 3,
          contractsDone: 11,
          blessingPicks: 19,
          mutatorWaves: 5,
          riskWaves: [1, 2, 3, 4, 5, 6, 7, 8],
        },
      },
    } as unknown as GameState;
    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    expect(mgr.save(state)).toBe(true);
    const loaded = mgr.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.watch!.completed).toEqual(['wc_first_watch']);
    expect(loaded!.watch!.counters.killsByType).toEqual({ tank: 42 });
    expect(loaded!.watch!.counters.flawlessWaves).toBe(7);
    expect(loaded!.watch!.counters.swiftBosses).toBe(3);
    expect(loaded!.watch!.counters.contractsDone).toBe(11);
    expect(loaded!.watch!.counters.blessingPicks).toBe(19);
    expect(loaded!.watch!.counters.mutatorWaves).toBe(5);
    expect(loaded!.watch!.counters.riskWaves).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0]);
  });

  // 4. The snapshot does not alias: mutating the live state after save does
  //    not change what was written.
  it('snapshots the watch block by value, not by reference', async () => {
    const state = {
      ...makeState(),
      watch: {
        completed: [],
        counters: {
          killsByType: { tank: 42 },
          flawlessWaves: 0,
          swiftBosses: 0,
          contractsDone: 0,
          blessingPicks: 0,
          mutatorWaves: 0,
          riskWaves: [0, 0, 0, 0, 0, 0, 0, 0],
        },
      },
    } as unknown as GameState;
    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    expect(mgr.save(state)).toBe(true);

    // Now mutate the live state — this must not reach the saved blob.
    state.watch!.counters.killsByType.tank = 9999;
    state.watch!.counters.riskWaves[0] = 9999;

    const loaded = mgr.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.watch!.counters.killsByType.tank).toBe(42);
    expect(loaded!.watch!.counters.riskWaves[0]).toBe(0);
  });
});

describe('v19→v20 ability level clamp', () => {
  /**
   * The minimal save template reused across the new block. Same shape as the
   * `v19 watch block` block, inlined for scope isolation.
   */
  const minimalSave = {
    version: 2,
    savedAt: Date.now(),
    tower: { hp: 50, maxHp: 100 },
    resources: { gold: 500, lifetimeGold: 500, mana: 10, maxMana: 100, manaRegen: 1 },
    upgrades: { damage: 5 },
    research: {},
    abilities: {},
    prestige: {},
    wave: { number: 12 },
    stats: { enemiesKilled: 90 },
  };

  it('migrates a v19 save to v20 and clamps ability levels to their def caps', async () => {
    // rain_of_arrows has maxLevel 10. Plant a v19 blob with one ability below
    // the floor and one above the ceiling.
    const v19 = {
      ...minimalSave,
      version: 19,
      abilities: {
        rain_of_arrows: { level: 7 },          // in range — must stay at 7
        frost_nova: { level: 999 },            // over cap (maxLevel 10) → 10
        chain_lightning: { level: -3 },        // under floor → 1
      },
    };
    await seed(JSON.stringify(v19));
    const loaded = (await loadFresh());
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(24);
    // In-range survives unchanged; out-of-range is clamped to [1, maxLevel].
    expect(loaded!.abilities.rain_of_arrows.level).toBe(7);
    expect(loaded!.abilities.frost_nova.level).toBe(10);
    expect(loaded!.abilities.chain_lightning.level).toBe(1);
  });

  it('survives a v20 round trip without further clamping', async () => {
    // After migration, save+load must not re-clamp an in-range level.
    const state = makeState();
    state.abilities.rain_of_arrows = { level: 8 };
    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    expect(mgr.save(state)).toBe(true);
    const loaded = mgr.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(24);
    expect(loaded!.abilities.rain_of_arrows.level).toBe(8);
  });
});

describe('v20→v21 revamp balance migration (§11)', () => {
  const minimalSave = {
    version: 2,
    savedAt: Date.now(),
    tower: { hp: 50, maxHp: 100 },
    resources: { gold: 500, lifetimeGold: 500, mana: 10, maxMana: 100, manaRegen: 1 },
    upgrades: { damage: 5 },
    research: {},
    abilities: {},
    prestige: {},
    wave: { number: 12 },
    stats: { enemiesKilled: 90 },
  };

  it('maps tp_midas to tp_salvage L1 and clamps every TP perk to its cap', async () => {
    const v20 = {
      ...minimalSave,
      version: 20,
      prestige: {
        apSpent: {},
        tpSpent: {
          tp_midas: 3,
          tp_wave_start: 20,
          tp_game_speed: 30,
          tp_head_start: 20,
          tp_fire_rate: 99,
          tp_crit: 40,
          tp_treasure: 15,
          tp_mana: 40,
          tp_damage: 7,
          tp_gone: 4,
        },
      },
    };
    await seed(JSON.stringify(v20));
    const loaded = (await loadFresh());
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(24);
    const tp = loaded!.prestige.tpSpent;
    expect(tp.tp_midas).toBeUndefined();
    expect(tp.tp_salvage).toBe(1);
    expect(tp.tp_wave_start).toBe(TP_PERK_BY_ID.tp_wave_start.maxLevel);
    expect(tp.tp_game_speed).toBe(TP_PERK_BY_ID.tp_game_speed.maxLevel);
    expect(tp.tp_head_start).toBe(TP_PERK_BY_ID.tp_head_start.maxLevel);
    expect(tp.tp_fire_rate).toBe(TP_PERK_BY_ID.tp_fire_rate.maxLevel);
    expect(tp.tp_crit).toBe(TP_PERK_BY_ID.tp_crit.maxLevel);
    expect(tp.tp_treasure).toBe(TP_PERK_BY_ID.tp_treasure.maxLevel);
    expect(tp.tp_mana).toBe(TP_PERK_BY_ID.tp_mana.maxLevel);
    // In-range levels are untouched; ids the table dropped go away.
    expect(tp.tp_damage).toBe(7);
    expect(tp.tp_gone).toBeUndefined();
  });

  it('clamps AP perks and resolves the warlord/tycoon exclusion', async () => {
    const v20 = {
      ...minimalSave,
      version: 20,
      prestige: {
        tpSpent: {},
        apSpent: {
          ap_extra_shots: 10,
          ap_scatter_shots: 5,
          ap_back_shots: 4,
          ap_wave_skipper: 40,
          ap_warlord: 3,
          ap_tycoon: 8,
        },
      },
    };
    await seed(JSON.stringify(v20));
    const loaded = (await loadFresh())!;
    const ap = loaded.prestige.apSpent;
    expect(ap.ap_extra_shots).toBe(1);
    expect(ap.ap_scatter_shots).toBe(1);
    expect(ap.ap_back_shots).toBe(1);
    expect(ap.ap_wave_skipper).toBe(AP_PERK_BY_ID.ap_wave_skipper.maxLevel);
    // Tycoon has the deeper investment, so warlord is the one cleared.
    expect(ap.ap_warlord).toBeUndefined();
    expect(ap.ap_tycoon).toBe(8);
  });

  /**
   * §11's named case, run the whole ladder: a v14 save holding maxed Twin and
   * Scatter, an `upgradeDiscount` level, `tp_midas` and `tp_head_start` L20.
   */
  it('walks the §11 v14 save all the way to the current version', async () => {
    const v14 = {
      ...minimalSave,
      version: 14,
      upgrades: { damage: 5, upgradeDiscount: 9, goldMulti: 999 },
      prestige: {
        apSpent: { ap_extra_shots: 10, ap_scatter_shots: 5 },
        tpSpent: { tp_midas: 1, tp_head_start: 20 },
      },
    };
    await seed(JSON.stringify(v14));
    const loaded = (await loadFresh());
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(24);
    // upgradeDiscount 9 -> prospecting ceil(9/2) = 5, old key gone.
    expect(loaded!.upgrades.upgradeDiscount).toBeUndefined();
    expect(loaded!.upgrades.prospecting).toBe(5);
    expect(loaded!.upgrades.damage).toBe(5);
    expect(loaded!.upgrades.goldMulti).toBe(UPGRADE_BY_ID.goldMulti.maxLevel);
    expect(loaded!.prestige.apSpent.ap_extra_shots).toBe(1);
    expect(loaded!.prestige.apSpent.ap_scatter_shots).toBe(1);
    expect(loaded!.prestige.tpSpent.tp_midas).toBeUndefined();
    expect(loaded!.prestige.tpSpent.tp_salvage).toBe(1);
    expect(loaded!.prestige.tpSpent.tp_head_start).toBe(TP_PERK_BY_ID.tp_head_start.maxLevel);
  });

  it('leaves an already-v21 save alone through a round trip', async () => {
    const state = makeState();
    state.upgrades.damage = 12;
    state.prestige.tpSpent = { tp_head_start: 4 };
    state.prestige.apSpent = { ap_warlord: 2 };
    const mgr = new SaveManager(stubBus);
    await mgr.hydrate();
    expect(mgr.save(state)).toBe(true);
    const loaded = mgr.load()!;
    expect(loaded.version).toBe(24);
    expect(loaded.upgrades.damage).toBe(12);
    expect(loaded.prestige.tpSpent.tp_head_start).toBe(4);
    expect(loaded.prestige.apSpent.ap_warlord).toBe(2);
  });
});

/**
 * v23 -> v24 (plans/improvements.md §8).
 *
 * The save version bumps because two tables moved: the RP faucet was rebalanced
 * (forward-looking — nothing in an old save gets clawed back) and the
 * `MAX_RISK_CEILING` ceiling moved 7 -> 8 to make room for the Crown of
 * Thorns watch unlock. The only repair a v23 save needs on load is the risk
 * histogram: it was 8 slots under the old ceiling and the new ceiling wants
 * `MAX_RISK_CEILING + 1` slots.
 */
describe('v23→v24 watch riskWaves resize', () => {
  const minimalSave = {
    version: 2,
    savedAt: Date.now(),
    tower: { hp: 50, maxHp: 100 },
    resources: { gold: 500, lifetimeGold: 500, mana: 10, maxMana: 100, manaRegen: 1 },
    upgrades: { damage: 5 },
    research: {},
    abilities: {},
    prestige: {},
    wave: { number: 12 },
    stats: { enemiesKilled: 90 },
  };

  it('grows an 8-slot riskWaves array to MAX_RISK_CEILING + 1 and keeps completed', async () => {
    // Plant a v23 save whose watch block reflects the old ceiling (8 slots)
    // and a single completed chapter. After the ladder walks, the array must
    // have gained one slot and `completed` must come back untouched.
    const v23 = {
      ...minimalSave,
      version: 23,
      watch: {
        completed: ['wc_first_watch'],
        counters: {
          killsByType: { tank: 42 },
          flawlessWaves: 7,
          swiftBosses: 3,
          contractsDone: 11,
          blessingPicks: 19,
          mutatorWaves: 5,
          riskWaves: [1, 2, 3, 4, 5, 6, 7, 8],
        },
      },
    };
    await seed(JSON.stringify(v23));
    const loaded = (await loadFresh())!;
    expect(loaded.version).toBe(24);
    expect(loaded.watch!.completed).toEqual(['wc_first_watch']);
    expect(loaded.watch!.counters.riskWaves).toHaveLength(MAX_RISK_CEILING + 1);
    // Every original slot survives; the new slot is the zero pad `normalizeWatch`
    // adds, not the migration itself.
    expect(loaded.watch!.counters.riskWaves.slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(loaded.watch!.counters.riskWaves[8]).toBe(0);
  });
});

/**
 * Offline progress (plans/economy.md §6.3).
 *
 * Offline no longer simulates a climb. It picks one wave — the **last one the
 * run actually completed** — and repeats it for the whole absence, paced by the
 * duration that wave was completed in, which the `WaveTimingState` block
 * carries alongside the wave number. The repeat count is a real number, the
 * payout is closed-form arithmetic, and a single `0.25` dial discounts every
 * offline payout uniformly. The block below is the test bed for that claim.
 */

// W is the **last completed** wave throughout — the wave an absence repeats.
// The payout tests save the state standing on `W + 1`, so a test that passes
// proves the payout came from the completed wave rather than the one in
// progress. 33 is a non-boss wave, which is the only kind `WaveManager` records.
const W = 33;
const CYCLE_INTERMISSION = intermissionSecondsForWave(W);

describe('offline progress', () => {
  function offlineState(wave: number, timing?: Partial<WaveTimingState>): GameState {
    const s = makeState();
    s.wave = { ...s.wave, number: wave, highestWave: wave, elapsed: 0 };
    s.stats = { ...s.stats, lifetimeHighestWave: wave };
    s.passiveAbilities = { passive_marksmanship: { level: 0, xp: 0, unlocked: true } };
    s.waveTiming = { ...defaultWaveTiming(), ...timing };
    return s;
  }

  async function offlineAt(
    wave: number, hours: number, timing?: Partial<WaveTimingState>,
  ): Promise<OfflineResult> {
    const mgr = new SaveManager(stubBus, { getRP: () => 0 });
    await mgr.hydrate();
    mgr.save(offlineState(wave, timing));
    const persisted = mgr.load()!;
    persisted.savedAt -= hours * 3600 * 1000;
    return mgr.computeOfflineProgress(persisted, 1);
  }

  /**
   * A fully warmed-up timing block: `wave` is the last wave completed and
   * `seconds` is what it took. The wave standing in the HUD is passed
   * separately to `offlineAt`, and is irrelevant to every payout test below —
   * which is the property being asserted.
   */
  const timed = (seconds: number, wave: number) => ({
    lastWaveSeconds: seconds, avgWaveSeconds: seconds, sampleWave: wave, samples: 5,
  });

  it('repeats the last completed wave, not the one in progress', async () => {
    // Standing on wave 40 having last cleared 39: the absence farms 39, at the
    // 60 s that wave 39 actually took.
    const r = await offlineAt(40, 12, timed(60, 39));
    expect(r.wave).toBe(39);
    expect(r.waveSeconds).toBeCloseTo(60, 5);
  });

  it('never advances past the wave it repeats', async () => {
    const short = await offlineAt(W + 1, 1, timed(60, W));
    const long = await offlineAt(W + 1, 96, timed(60, W));
    expect(short.wave).toBe(W);
    expect(long.wave).toBe(W);
  });

  it('falls back to the current wave, stepped off a boss, before the first clear', async () => {
    // No sample at all: wave 30 is a boss, so the estimate prices wave 29.
    const r = await offlineAt(30, 4);
    expect(r.wave).toBe(29);
    expect(r.measured).toBe(false);
  });

  it('never repeats a boss wave, because one is never recorded', async () => {
    // `WaveManager` excludes boss clears from the sample, so a boss number can
    // only reach `sampleWave` through a corrupt save. Assert the outcome anyway.
    const r = await offlineAt(41, 8, timed(60, 39));
    expect(isBossWave(r.wave)).toBe(false);
  });

  it('pays the fraction of a wave an absence did not finish', async () => {
    // 90 s away against a 60 s wave + 5 s intermission => 90 / 65 = 1.38 repeats.
    const r = await offlineAt(W + 1, 90 / 3600, timed(60, W));
    expect(r.waveRepeats).toBeCloseTo(90 / (60 + CYCLE_INTERMISSION), 3);
    expect(r.waveRepeats).toBeGreaterThan(1);
    expect(r.waveRepeats).toBeLessThan(2);
  });

  it('scales linearly with the absence', async () => {
    const short = await offlineAt(W + 1, 4, timed(60, W));
    const long = await offlineAt(W + 1, 8, timed(60, W));
    expect(long.goldEarned / short.goldEarned).toBeCloseTo(2, 1);
    expect(long.xpEarned / short.xpEarned).toBeCloseTo(2, 1);
  });

  it('is inversely proportional to the measured wave duration', async () => {
    const fast = await offlineAt(W + 1, 8, timed(30, W));
    const slow = await offlineAt(W + 1, 8, timed(60, W));
    expect(fast.waveRepeats / slow.waveRepeats)
      .toBeCloseTo((60 + CYCLE_INTERMISSION) / (30 + CYCLE_INTERMISSION), 1);
  });

  it('pays exactly a quarter of one wave of income per repeat', async () => {
    const r = await offlineAt(W + 1, 8, timed(60, W));
    const count = Math.max(1, Math.floor(spawnCountForWave(W)));
    const perWaveXp = averageKillXPForWave(W) * count + xpPerWaveClear(W);
    const perWaveGold = averageKillGoldForWave(W) * count;
    expect(r.xpEarned).toBe(Math.floor(perWaveXp * r.waveRepeats * 0.25));
    expect(r.goldEarned).toBe(Math.floor(perWaveGold * r.waveRepeats * 0.25));
  });

  it('halves the payout when no wave has ever been timed', async () => {
    const measured = await offlineAt(W, 8, timed(expectedWaveSeconds(W), W));
    const guessed = await offlineAt(W, 8);
    expect(guessed.measured).toBe(false);
    expect(measured.measured).toBe(true);
    expect(guessed.waveSeconds).toBeCloseTo(measured.waveSeconds, 3);
    expect(guessed.goldEarned / measured.goldEarned).toBeCloseTo(0.5, 2);
  });

  it('floors the fallback estimate with the part of the wave already fought', async () => {
    // Only reachable before the run's first clear, which is the one time the
    // in-progress wave is all the evidence there is.
    const mgr = new SaveManager(stubBus, { getRP: () => 0 });
    await mgr.hydrate();
    const s = offlineState(W);                // no timing samples
    s.wave = { ...s.wave, elapsed: 300 };     // five minutes in, never finished
    mgr.save(s);
    const persisted = mgr.load()!;
    persisted.savedAt -= 8 * 3600 * 1000;
    const r = mgr.computeOfflineProgress(persisted, 1);
    expect(r.measured).toBe(false);
    expect(r.waveSeconds).toBeGreaterThanOrEqual(300);
  });

  it('ignores the in-progress wave once a wave has been completed', async () => {
    const mgr = new SaveManager(stubBus, { getRP: () => 0 });
    await mgr.hydrate();
    const s = offlineState(W + 1, timed(60, W));
    s.wave = { ...s.wave, elapsed: 900 };     // stuck fifteen minutes into W + 1
    mgr.save(s);
    const persisted = mgr.load()!;
    persisted.savedAt -= 8 * 3600 * 1000;
    const r = mgr.computeOfflineProgress(persisted, 1);
    expect(r.wave).toBe(W);
    expect(r.waveSeconds).toBeCloseTo(60, 5);  // the measurement, not the stall
  });

  it('leaves an absence shorter than one wave paying a partial wave, not zero', async () => {
    const r = await offlineAt(W + 1, 20 / 3600, timed(120, W));
    expect(r.waveRepeats).toBeGreaterThan(0);
    expect(r.waveRepeats).toBeLessThan(1);
    expect(r.goldEarned).toBeGreaterThan(0);
  });

  it('prices offline in simulation seconds, so game speed cannot buy income', async () => {
    // A 1.5x player clears a 60 s (simulation) wave in 40 s of wall clock. The
    // recorded sample is the simulation figure, so the same absence pays the
    // same whatever the speed dial says (plans/economy.md §2.8).
    const r = await offlineAt(W + 1, 8, timed(60, W));
    const cycle = 60 + intermissionSecondsForWave(W);
    expect(r.waveRepeats).toBeCloseTo((8 * 3600) / cycle, 1);
  });
});
