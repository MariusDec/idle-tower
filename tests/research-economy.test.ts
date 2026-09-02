/**
 * The research economy after the rebalance (plans/improvements.md §2).
 *
 * Five small claims that pin the post-rebalance numbers in place. Two of them
 * — passive-RP rate and weighted-pool rpChance — would be obvious in their
 * tables, but two are coupling checks that exist precisely so the duplicated
 * formula inside `SaveManager.computeOfflineProgress` and the per-enemy
 * `rpChance` table cannot drift from the tree.
 *
 *  - `getPassiveRPRate` follows `12 * sqrt(wave)` RP/h, not `3 * wave`.
 *  - `getPassiveRPRate(w, 2.0)` is `3 * getPassiveRPRate(w, 0)` — the
 *    `rp_gain` ×3 ceiling the plan pins at level 10.
 *  - `SaveManager.computeOfflineProgress(rpEarned)` matches
 *    `floor(rate * elapsed)` computed from `ResearchTree.getPassiveRPRate`
 *    at the same `lifetimeHighestWave` and `rp_gain: 10`. The two files
 *    carry the same formula and must stay in lockstep.
 *  - Every level of every research node costs exactly **66,730 RP** in
 *    total — the plan's whole-tree price.
 *  - The weighted mean `rpChance` over `spawnPoolForWave(100)` is 0.0185 ±
 *    0.0005 — the plan's new pool baseline.
 */

import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import { ResearchTree } from '../src/systems/ResearchTree';
import {
  SaveManager,
  type PersistentState,
} from '../src/systems/SaveManager';
import {
  RESEARCH_NODES,
  RESEARCH_BY_ID,
  getResearchCost,
  getResearchTime,
} from '../src/data/research';
import {
  ENEMY_DEFS,
  spawnPoolForWave,
} from '../src/data/enemies';
import type {
  GameState,
  TowerState,
  WaveState,
  GameStats,
} from '../src/types';

function emptyStats(): GameStats {
  return {
    enemiesKilled: 0,
    bossesKilled: 0,
    goldEarned: 0,
    damageDealt: 0,
    shotsFired: 0,
    lifetimeHighestWave: 0,
    abilitiesCast: 0,
    ascensions: 0,
    lifetimeAscensions: 0,
    transcendences: 0,
    totalUpgradesPurchased: 0,
    startedAt: 0,
    runStartedAt: 0,
  };
}

function minimalState(): GameState {
  return {
    tower: {
      x: 640, y: 360, hp: 90, maxHp: 100, baseDamage: 12, fireRate: 1.4, range: 220,
      critChance: 0.1, critMultiplier: 2, healthRegen: 0.01, damageType: 'physical',
      wallHp: 0, wallMaxHp: 0, knockbackForce: 0, shockwaveSize: 0, shockwaveCooldown: 0,
      shockwaveTimer: 0, landMineDamage: 0, landMineFrequency: 0, landMineTimer: 0,
      shieldMaxCharges: 0, shieldCurrentCharges: 0, shieldRechargeTime: 0,
      shieldRechargeTimer: 0, doubleShotChance: 0, quickShotChance: 0, quickShotTime: 0,
      targetingMode: 'nearest',
    } as TowerState,
    resources: {
      gold: 0, lifetimeGold: 0, mana: 0, maxMana: 100, manaRegen: 0,
      ascensionPoints: 0, lifetimeAP: 0, apThisTranscendence: 0, transcendencePoints: 0,
    },
    upgrades: {},
    research: {},
    researchInProgress: null,
    abilities: {},
    prestige: { apPerks: {}, tpPerks: {} },
    wave: { number: 100, highestWave: 100, elapsed: 0 } as WaveState,
    stats: emptyStats(),
    achievements: [],
    runHistory: [],
    runStartedAt: 0,
    towerXp: { level: 1, xp: 0, totalXpEarned: 0, unspentTalentPoints: 0 },
    talents: { allocated: {} },
    passiveAbilities: {},
    equipment: [],
    waveTiming: undefined,
    equipped: {},
    blessings: undefined,
    contracts: undefined,
    cores: undefined,
    pacing: undefined,
    bossRun: undefined,
    watch: undefined,
  } as unknown as GameState;
}

describe('research economy rebalance (§2)', () => {
  describe('getPassiveRPRate (sub-linear in depth, §2.2)', () => {
    it('pays 120 RP/h at wave 100', () => {
      const tree = new ResearchTree(new EventBus());
      const perHour = tree.getPassiveRPRate(100, 0) * 3600;
      expect(perHour).toBeGreaterThan(120 * 0.99);
      expect(perHour).toBeLessThan(120 * 1.01);
    });

    it('pays 240 RP/h at wave 400', () => {
      const tree = new ResearchTree(new EventBus());
      const perHour = tree.getPassiveRPRate(400, 0) * 3600;
      expect(perHour).toBeGreaterThan(240 * 0.99);
      expect(perHour).toBeLessThan(240 * 1.01);
    });

    it('applies the gain multiplier linearly (×3 at gainMultiplier=2)', () => {
      const tree = new ResearchTree(new EventBus());
      for (const w of [16, 25, 50, 100, 200, 400]) {
        expect(tree.getPassiveRPRate(w, 2.0)).toBeCloseTo(
          3 * tree.getPassiveRPRate(w, 0), 9,
        );
      }
    });
  });

  describe('SaveManager.computeOfflineProgress agrees with ResearchTree.getPassiveRPRate', () => {
    function buildPersisted(
      lifetimeWave: number, research: Record<string, number>, elapsedSeconds: number,
    ): PersistentState {
      // The rebalance duplicated `getPassiveRPRate` inside `computeOfflineProgress`
      // so the offline path keeps paying when the live tree has not been built
      // yet; this test is the regression guard for that duplication.
      const state = minimalState();
      state.stats.lifetimeHighestWave = lifetimeWave;
      state.wave = { number: 100, highestWave: 100, elapsed: 0 };
      state.research = research;
      return {
        version: 24,
        savedAt: Date.now() - elapsedSeconds * 1000,
        tower: state.tower,
        resources: state.resources,
        upgrades: state.upgrades,
        research: state.research,
        researchInProgress: null,
        rp: 0,
        abilities: state.abilities,
        prestige: { apPerks: {}, tpPerks: {} },
        wave: state.wave,
        stats: state.stats,
        achievements: [],
        runHistory: [],
        runStartedAt: 0,
        towerXp: state.towerXp,
        talents: state.talents,
        passiveAbilities: state.passiveAbilities,
        equipment: state.equipment,
        equipped: {},
      };
    }

    it('matches the tree\'s formula at rp_gain=10, wave 100', () => {
      const mgr = new SaveManager({ on: () => {} });
      const tree = new ResearchTree(new EventBus());

      // Set the tree's research so `getRPGainMultiplier` reports the same value
      // the offline path computes from `persisted.research`.
      tree.replaceLevels({ rp_gain: 10 }, 0, null);

      const elapsed = 8 * 3600;
      const persisted = buildPersisted(100, { rp_gain: 10 }, elapsed);
      const rate = tree.getPassiveRPRate(100, tree.getRPGainMultiplier());
      const expected = Math.max(0, Math.floor(rate * elapsed));

      const result = mgr.computeOfflineProgress(persisted, 1);
      expect(result.rpEarned).toBe(expected);
    });

    it('matches the tree\'s formula at rp_gain=0, wave 400', () => {
      const mgr = new SaveManager({ on: () => {} });
      const tree = new ResearchTree(new EventBus());

      const elapsed = 4 * 3600;
      const persisted = buildPersisted(400, { rp_gain: 0 }, elapsed);
      const rate = tree.getPassiveRPRate(400, tree.getRPGainMultiplier());
      const expected = Math.max(0, Math.floor(rate * elapsed));

      const result = mgr.computeOfflineProgress(persisted, 1);
      expect(result.rpEarned).toBe(expected);
    });
  });

  describe('whole-tree cost (66,730 RP, §2.8)', () => {
    it('sums every level of every bounded node to exactly 66,730', () => {
      let total = 0;
      for (const def of RESEARCH_NODES) {
        // `field_studies` is repeatable forever (progress-steps §9.1) — it is
        // the sink that keeps RP live once the bounded tree is finished, so it
        // has no whole-tree cost to sum. The other eighteen still do.
        if (def.id === 'field_studies') continue;
        for (let lvl = 1; lvl <= def.maxLevel; lvl++) {
          total += getResearchCost(def, lvl);
        }
      }
      expect(total).toBe(66_730);
    });
  });

  describe('weighted pool rpChance at wave 100 (0.0185 ± 0.0005, §2.5)', () => {
    it('averages 0.0185 within the plan\'s tolerance', () => {
      const pool = spawnPoolForWave(100);
      let weightSum = 0;
      let chanceSum = 0;
      for (const { type, weight } of pool) {
        const chance = ENEMY_DEFS[type].rpChance ?? 0;
        weightSum += weight;
        chanceSum += chance * weight;
      }
      const mean = chanceSum / weightSum;
      expect(mean).toBeGreaterThan(0.0185 - 0.0005);
      expect(mean).toBeLessThan(0.0185 + 0.0005);
    });
  });
});

describe('Field Studies (progress.md §7.5)', () => {
  it('is repeatable and holds its top rung past the ladder', () => {
    const def = RESEARCH_BY_ID.field_studies;
    expect(def.maxLevel).toBeGreaterThan(100);
    // Past the last array entry the cost and time hold rather than
    // extrapolating — that is what `min(level - 1, lastIndex)` buys.
    expect(getResearchCost(def, 15)).toBe(getResearchCost(def, 99));
    expect(getResearchTime(def, 15)).toBe(getResearchTime(def, 99));
  });

  it('is gated behind time, not cost', () => {
    // Level 15 is ~30 days of real time. Whatever the RP economy does, the
    // node cannot be rushed, which is what makes it safe to leave unbounded.
    expect(getResearchTime(RESEARCH_BY_ID.field_studies, 15))
      .toBeGreaterThan(30 * 24 * 3600 * 0.9);
  });

  it('reaches the gold multiplier that already exists', () => {
    // The node is live purely by being in the table: `gold_multi` has a
    // consumer, which is why this needed no new effect type.
    expect(RESEARCH_BY_ID.field_studies.effectType).toBe('gold_multi');
  });
});
