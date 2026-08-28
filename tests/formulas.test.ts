/**
 * Formula snapshots (plan §7.2).
 *
 * These lock the shape of every curve the balance work in Parts 2 and 3
 * settled on. They are deliberately written as exact expected numbers rather
 * than as re-implementations of the formula: a test that recomputes the
 * formula it is testing passes no matter what the formula becomes. If a
 * deliberate re-tune moves one of these, the diff is the record of it — and
 * `npm run sim` is the tool for deciding whether the new number is right.
 */

import { describe, expect, it } from 'vitest';
import {
  AVARICE_STREAK_GOLD_CAP,
  DRAGON_HOARD_GOLD_CAP,
  ENEMY_HP_GROWTH,
  GOLD_GROWTH,
  waveMasteryChainMultiplier,
  TARGET_BOSS_KILL_SECONDS,
  TARGET_WAVE_KILL_SECONDS,
  avariceStreakGoldBonus,
  bossEncounterWeight,
  bossEscortCountForWave,
  bossHPForWave,
  enemyHPForWave,
  expectedWaveSeconds,
  goldDropForWave,
  isBossWave,
  spawnCountForWave,
  spawnIntervalForWave,
  upgradeCost,
} from '../src/data/formulas';
import { ASCENSION_UNLOCK_WAVE, apForWave, tpForAP } from '../src/data/prestige';
import { ENEMY_DEFS } from '../src/data/enemies';
import { TOWER_XP_TABLE, TOWER_LEVEL_CAP, xpToLevel, xpForNextLevel, talentPointsAtLevel, xpPerKill, xpPerWaveClear, pioneerBonusXp, PIONEER_CLEAR_MULTIPLIER } from '../src/data/xpTables';
import { UPGRADES, UPGRADE_BY_ID } from '../src/data/upgrades';
import { computeUpgradeValue } from '../src/types';

const WAVES = [1, 10, 50, 100];

describe('enemy scaling', () => {
  it('grows HP at the tuned rate', () => {
    expect(ENEMY_HP_GROWTH).toBe(1.11);
    expect(WAVES.map((w) => enemyHPForWave(ENEMY_DEFS.normal.baseHP, w))).toMatchInlineSnapshot(`
      [
        6,
        15.348221546319014,
        997.6477121092526,
        184130.67713321283,
      ]
    `);
  });

  it('grows gold faster than it used to, to hold gold-per-HP roughly flat', () => {
    expect(GOLD_GROWTH).toBe(1.08);
    expect(WAVES.map((w) => goldDropForWave(ENEMY_DEFS.normal.baseGold, w))).toMatchInlineSnapshot(`
      [
        1,
        1.9990046271044333,
        43.42741899373273,
        2036.815978093796,
      ]
    `);
  });

  /**
   * Plan §2.3.1 asked for bosses at 3-5x a same-wave trash mob; at the shipped
   * boss counts that made a boss wave *easier* than its neighbours, so the
   * curve was anchored to the trash curve with a per-tier bump instead. This
   * pins the ratio band that replaced it.
   */
  it('keeps the boss/trash HP ratio bounded across the game', () => {
    for (const w of [10, 30, 60, 100]) {
      const ratio =
        bossHPForWave(ENEMY_DEFS.boss.baseHP, w) / enemyHPForWave(ENEMY_DEFS.normal.baseHP, w);
      expect(ratio).toBeGreaterThan(15);
      expect(ratio).toBeLessThan(60);
    }
  });

  it('places boss waves every tenth wave', () => {
    expect([10, 20, 100].every(isBossWave)).toBe(true);
    expect([1, 9, 11, 99].some(isBossWave)).toBe(false);
  });

  /**
   * Revamp §10: the first boss wave is the tightest gate in the game, so a
   * tier adds to the encounter from the *second* tier onwards rather than the
   * first. The figure used to be a head-count of bosses and is now the weight
   * the wave's one boss carries — same curve, one body.
   */
  it('starts the boss encounter at two and adds one per tier after the first', () => {
    expect([10, 20, 30, 100].map(bossEncounterWeight)).toEqual([2, 3, 4, 11]);
  });

  it('spawns exactly one boss on a boss wave, plus its escort', () => {
    for (const w of [10, 20, 30, 100]) {
      expect(spawnCountForWave(w), `wave ${w}`).toBe(1 + bossEscortCountForWave(w));
      // The escort is trash, and there is more of it the deeper the wave.
      expect(bossEscortCountForWave(w)).toBeGreaterThan(1);
    }
    expect(bossEscortCountForWave(100)).toBeGreaterThan(bossEscortCountForWave(10));
  });
});

/**
 * Revamp §10: a boss wave's kill window is per boss, not the flat trash
 * window. Without this a three-boss wave got ~23 s to kill several times the
 * effective HP of its neighbours, and every wall was a boss wall.
 */
describe('wave time budget', () => {
  it('gives non-boss waves the flat kill window on top of their spawn cadence', () => {
    for (const w of [1, 5, 15, 37]) {
      const spawn = spawnIntervalForWave(w) * (spawnCountForWave(w) - 1);
      expect(expectedWaveSeconds(w)).toBeCloseTo(spawn + TARGET_WAVE_KILL_SECONDS);
    }
  });

  it('sizes the boss window off the encounter weight, not the body count', () => {
    for (const w of [10, 20, 100]) {
      const count = spawnCountForWave(w);
      const spawn = spawnIntervalForWave(w) * (count - 1);
      const kill = TARGET_BOSS_KILL_SECONDS * bossEncounterWeight(w);
      expect(expectedWaveSeconds(w), `wave ${w}`).toBeCloseTo(spawn + kill);
    }
  });

  it('pays a mutated boss roster for the time it takes to spawn', () => {
    // The extra bodies a Swarm mutator adds to a boss wave are escort trash,
    // not bosses, so they buy spawn time rather than a second kill window.
    const one = expectedWaveSeconds(20, 1);
    const two = expectedWaveSeconds(20, 2);
    expect(two - one).toBeCloseTo(spawnIntervalForWave(20));
  });

  it('leaves a boss wave with more budget than its neighbours', () => {
    for (const w of [10, 20, 30]) {
      expect(expectedWaveSeconds(w)).toBeGreaterThan(expectedWaveSeconds(w - 1));
    }
  });
});

describe('upgrade cost', () => {
  it('matches the tuned growth at representative levels', () => {
    expect([0, 10, 50, 100].map((lv) => upgradeCost(10, 1.22, lv))).toMatchInlineSnapshot(`
      [
        10,
        73,
        207965,
        4324969682,
      ]
    `);
  });

  it('is monotonically increasing', () => {
    let prev = 0;
    for (let lv = 0; lv < 200; lv++) {
      const cost = upgradeCost(10, 1.22, lv);
      expect(cost).toBeGreaterThanOrEqual(prev);
      prev = cost;
    }
  });
});

describe('prestige curves', () => {
  it('unlocks the first ascension at the compressed wave', () => {
    expect(ASCENSION_UNLOCK_WAVE).toBe(20);
  });

  it('pays AP that compounds with depth', () => {
    expect([20, 30, 60, 100].map(apForWave)).toMatchInlineSnapshot(`
      [
        20,
        44,
        344,
        4775,
      ]
    `);
  });

  /**
   * Plan §3.2: `floor(log2(ap+1)^2)` made late transcendence nearly worthless
   * (1000x the AP for 6x the TP). The replacement is a power curve.
   */
  it('scales TP as a power of AP, not a logarithm', () => {
    expect([100, 1000, 100000].map(tpForAP)).toMatchInlineSnapshot(`
      [
        25,
        63,
        400,
      ]
    `);
    expect(tpForAP(100000) / tpForAP(100)).toBeGreaterThan(10);
  });
});

describe('tower XP table', () => {
  it('grants exactly one talent point per level, capped', () => {
    expect([1, 2, 10, 100, 200, 250].map(talentPointsAtLevel)).toEqual([1, 2, 10, 100, 200, 200]);
    expect(talentPointsAtLevel(0)).toBe(0);
  });

  it('builds a strictly ascending XP table up to the cap', () => {
    expect(TOWER_XP_TABLE.length).toBe(TOWER_LEVEL_CAP + 1);
    expect(TOWER_XP_TABLE[1]).toBe(0);
    for (let l = 2; l <= TOWER_LEVEL_CAP; l++) {
      expect(TOWER_XP_TABLE[l]).toBeGreaterThan(TOWER_XP_TABLE[l - 1]);
    }
  });

  it('round-trips xpToLevel against the table', () => {
    for (const l of [1, 2, 5, 40, 100, 199, 200]) {
      expect(xpToLevel(TOWER_XP_TABLE[l])).toBe(l);
      if (l > 1) expect(xpToLevel(TOWER_XP_TABLE[l] - 1)).toBe(l - 1);
    }
    expect(xpToLevel(TOWER_XP_TABLE[TOWER_LEVEL_CAP] * 10)).toBe(TOWER_LEVEL_CAP);
  });

  it('pays more XP for deeper kills and deeper clears', () => {
    expect(xpPerKill('normal', 200)).toBeGreaterThan(xpPerKill('normal', 20) * 5);
    expect(xpPerWaveClear(100)).toBeGreaterThan(xpPerWaveClear(50) * 2);
  });

  it('pays a pioneer bonus only past the lifetime best', () => {
    expect(pioneerBonusXp(40, 40)).toBe(0);
    expect(pioneerBonusXp(41, 40)).toBe(Math.round(xpPerWaveClear(41) * PIONEER_CLEAR_MULTIPLIER));
  });
});

/**
 * Golden upgrade values (plan §7.2).
 *
 * The plan's golden test is written against the `StatContext` that Part 6
 * introduces; until that exists there is no single function that resolves a
 * whole stat block, because eight systems still write into `TowerState`
 * directly. What *is* pinnable today is the per-upgrade curve every one of
 * those systems multiplies on top of — so a change to a scaling table shows up
 * here rather than silently in a save file.
 */
describe('upgrade value curves', () => {
  const valueAt = (id: string, level: number): number => {
    const def = UPGRADE_BY_ID[id];
    expect(def, `no upgrade named ${id}`).toBeDefined();
    return computeUpgradeValue(def, level);
  };

  it('resolves the core combat upgrades at fixed levels', () => {
    const rows = ['damage', 'fireRate', 'critChance', 'goldMulti'].map((id) => [
      id,
      [0, 1, 10, 50].map((lv) => valueAt(id, lv)),
    ]);
    expect(Object.fromEntries(rows)).toMatchInlineSnapshot(`
      {
        "critChance": [
          0,
          0.005,
          0.05,
          0.25,
        ],
        "damage": [
          0,
          2.64,
          6.753217480380363,
          438.9649933280707,
        ],
        "fireRate": [
          0,
          0.05,
          0.5,
          2.5,
        ],
        "goldMulti": [
          0,
          0.02,
          0.2,
          1,
        ],
      }
    `);
  });

  it('returns nothing at level 0 for every upgrade', () => {
    for (const u of UPGRADES) expect(computeUpgradeValue(u, 0), u.id).toBe(0);
  });

  /**
   * Each upgrade improves in one direction: most climb, while cooldown- and
   * cost-style ones (recharge time, upgrade discount) fall towards a floor.
   * Which of the two is not asserted here — that a curve never *turns around*
   * partway is, since a sign flip mid-table means a player's purchase made
   * their tower worse.
   */
  it('moves in one direction as levels are added', () => {
    for (const u of UPGRADES) {
      const top = u.maxLevel > 0 ? Math.min(u.maxLevel, 60) : 60;
      let prev = computeUpgradeValue(u, 1);
      let direction = 0;
      for (let lv = 2; lv <= top; lv++) {
        const v = computeUpgradeValue(u, lv);
        const step = Math.sign(v - prev);
        if (step !== 0) {
          if (direction === 0) direction = step;
          else expect(step, `${u.id} reverses direction at level ${lv}`).toBe(direction);
        }
        prev = v;
      }
    }
  });

  it('respects the declared caps', () => {
    for (const u of UPGRADES) {
      if (!u.scaling?.cap) continue;
      const top = u.maxLevel > 0 ? u.maxLevel : 200;
      const v = computeUpgradeValue(u, top);
      if (u.scaling.cap.min !== undefined) expect(v, u.id).toBeGreaterThanOrEqual(u.scaling.cap.min);
      if (u.scaling.cap.max !== undefined) expect(v, u.id).toBeLessThanOrEqual(u.scaling.cap.max);
    }
  });
});

/**
 * Gate 14 (revamp §6.2): the economy ceilings.
 *
 * Every purchased gold multiplier used to compound without one, which is why
 * run income grew 1.185x per wave against a 1.08 cost ruler — one wave of
 * income bought one damage level at every depth, forever. These are the three
 * clamps that need code rather than a data-table field.
 */
describe('economy caps', () => {
  it('caps Avarice at +75% however long the streak runs', () => {
    const perKill = 0.025;   // the shipping evolution value

    expect(avariceStreakGoldBonus(1, perKill)).toBe(0);
    expect(avariceStreakGoldBonus(11, perKill)).toBeCloseTo(0.25, 6);
    // 31 kills = 30 x 2.5% = exactly the cap.
    expect(avariceStreakGoldBonus(31, perKill)).toBeCloseTo(AVARICE_STREAK_GOLD_CAP, 6);
    // A wave near the wall sustains ~50; uncapped that was +122%.
    expect(avariceStreakGoldBonus(50, perKill)).toBeCloseTo(AVARICE_STREAK_GOLD_CAP, 6);
    expect(avariceStreakGoldBonus(500, perKill)).toBeCloseTo(AVARICE_STREAK_GOLD_CAP, 6);
  });

  it('holds the two evolution ceilings at the plan values', () => {
    expect(AVARICE_STREAK_GOLD_CAP).toBe(0.75);
    expect(DRAGON_HOARD_GOLD_CAP).toBe(0.50);
  });

  it('caps the Wave Mastery chain at x3', () => {
    expect(waveMasteryChainMultiplier(0)).toBeCloseTo(1, 6);
    expect(waveMasteryChainMultiplier(5)).toBeCloseTo(1.5, 6);
    expect(waveMasteryChainMultiplier(20)).toBeCloseTo(3, 6);
    // Wave 40 used to read x21 here.
    expect(waveMasteryChainMultiplier(40)).toBeCloseTo(3, 6);
    expect(waveMasteryChainMultiplier(400)).toBeCloseTo(3, 6);
  });

  it('never lets the chain run away with depth', () => {
    for (let wave = 1; wave <= 200; wave++) {
      const m = waveMasteryChainMultiplier(wave);
      expect(m, `wave ${wave}`).toBeGreaterThanOrEqual(1);
      expect(m, `wave ${wave}`).toBeLessThanOrEqual(3);
    }
  });
});
