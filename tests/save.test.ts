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
import { SaveManager } from '../src/systems/SaveManager';
import { ContractManager } from '../src/systems/ContractManager';
import { PacingManager } from '../src/systems/PacingManager';
import type { GameState } from '../src/types';

const STORAGE_KEY = 'the-tower-save';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, String(v));
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
  clear(): void {
    this.data.clear();
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});

/** A minimal bus stub: `SaveManager` only subscribes, never emits. */
const stubBus = { on: () => {} };

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
    towerXp: { level: 3, xp: 900, totalXpEarned: 900, unspentTalentPoints: 1 },
    talents: { allocated: { power_core: 2 } },
    passiveAbilities: { marksmanship: { level: 2, xp: 30, unlocked: true } },
    equipment: [],
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
      completedCount: 2,
      apBonusPct: 0.06,
      uidSeq: 6,
    },
  } as unknown as GameState;
}

describe('save round-trip', () => {
  it('restores the fields it persisted', () => {
    const mgr = new SaveManager(stubBus, { getRP: () => 42 });
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
  });

  it('discards a corrupt save rather than loading garbage', () => {
    storage.setItem(STORAGE_KEY, '{not json');
    const mgr = new SaveManager(stubBus);
    expect(mgr.load()).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('rejects a save from an unknown future version', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 999, savedAt: Date.now() }));
    expect(new SaveManager(stubBus).load()).toBeNull();
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

  it('walks a v2 save all the way to the current version', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify(v2Save));
    const loaded = new SaveManager(stubBus).load();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBeGreaterThanOrEqual(13);
  });

  it('preserves the v2 payload through every step of the ladder', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify(v2Save));
    const loaded = new SaveManager(stubBus).load()!;
    expect(loaded.resources.gold).toBe(500);
    expect(loaded.upgrades.damage).toBe(5);
    expect(loaded.wave.number).toBe(12);
    expect(loaded.stats.enemiesKilled).toBe(90);
  });

  it('accepts every version the ladder claims to handle', () => {
    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      storage.clear();
      storage.setItem(STORAGE_KEY, JSON.stringify({ ...v2Save, version }));
      const loaded = new SaveManager(stubBus).load();
      expect(loaded, `version ${version} should load`).not.toBeNull();
      expect(loaded!.version).toBeGreaterThanOrEqual(13);
    }
  });

  /**
   * v9 -> v10 is purely additive (gameplay plan §1.5), so the test that matters
   * is the pair: a v9 save with no blessings gets an empty run seeded, and a
   * v10 save with blessings held keeps every stack through the ladder.
   */
  it('seeds an empty blessing run for a v9 save', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...v2Save, version: 9 }));
    const loaded = new SaveManager(stubBus).load()!;
    expect(loaded.version).toBe(14);
    expect(loaded.blessings).toEqual({
      held: {},
      picksTaken: 0,
      rerolls: 0,
      pendingOfferForWave: null,
      wavesClearedThisRun: 0,
    });
  });

  it('carries blessings held in a v9 save through to v10', () => {
    const held = { bl_frost: 1, bl_shatter: 1, bl_cruelty: 3 };
    storage.setItem(STORAGE_KEY, JSON.stringify({
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
    const loaded = new SaveManager(stubBus).load()!;
    expect(loaded.version).toBe(14);
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
  it('seeds a risk-0 pacing block for a v13 save', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...v2Save, version: 13 }));
    const loaded = new SaveManager(stubBus).load()!;
    expect(loaded.version).toBe(14);
    expect(loaded.pacing).toEqual({
      risk: 0, committedRisk: 0, momentum: 0, momentumWaves: 0, comboBest: 0,
    });
  });

  it('carries the risk dial and momentum through a v14 round trip', () => {
    const pacing = {
      risk: 4, committedRisk: 3, momentum: 0.045, momentumWaves: 2, comboBest: 61,
    };
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...v2Save, version: 13, pacing }));
    const loaded = new SaveManager(stubBus).load()!;
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
  it('seeds an empty contract run for a v11 save', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...v2Save, version: 11 }));
    const loaded = new SaveManager(stubBus).load()!;
    expect(loaded.version).toBe(14);
    expect(loaded.contracts).toEqual({
      active: [], completed: [], completedCount: 0, apBonusPct: 0, uidSeq: 0,
    });
  });

  it('carries contracts in progress from a v11 save through to v12', () => {
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
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...v2Save, version: 11, contracts }));
    const loaded = new SaveManager(stubBus).load()!;
    expect(loaded.version).toBe(14);
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

  it('fills in the enrage clock older saves predate', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify(v2Save));
    const loaded = new SaveManager(stubBus).load()!;
    expect(loaded.wave.elapsed).toBe(0);
    expect(loaded.wave.enrageStacks).toBe(0);
  });

  it('survives a full save -> load -> save -> load cycle', () => {
    const mgr = new SaveManager(stubBus, { getRP: () => 3 });
    mgr.save(makeState());
    const once = mgr.load()!;
    storage.setItem(STORAGE_KEY, JSON.stringify(once));
    const twice = new SaveManager(stubBus).load()!;
    expect(twice.resources).toEqual(once.resources);
    expect(twice.upgrades).toEqual(once.upgrades);
    expect(twice.stats).toEqual(once.stats);
  });
});

describe('write cadence (plan §5.7)', () => {
  it('coalesces a burst of requests into a single deferred write', () => {
    const mgr = new SaveManager(stubBus);
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

  it('still auto-saves on the slow timer when nothing requested a write', () => {
    const mgr = new SaveManager(stubBus);
    const state = makeState();
    let writes = 0;
    const onSave = () => (writes++, true);

    for (let i = 0; i < 60 * 29; i++) mgr.tick(1 / 60, state, onSave);
    expect(writes).toBe(0);
    for (let i = 0; i < 60 * 2; i++) mgr.tick(1 / 60, state, onSave);
    expect(writes).toBe(1);
  });

  it('clears the pending flag on a direct save, so no duplicate write follows', () => {
    const mgr = new SaveManager(stubBus);
    const state = makeState();
    mgr.requestSave();
    expect(mgr.save(state)).toBe(true);
    expect(mgr.hasPendingSave).toBe(false);

    let writes = 0;
    for (let i = 0; i < 60 * 6; i++) mgr.tick(1 / 60, state, () => (writes++, true));
    expect(writes).toBe(0);
  });
});
