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
  enemyCountForWave,
  enemyHPForWave,
  expectedWaveSeconds,
  goldDropForWave,
  isBossWave,
  spawnCountForWave,
  spawnIntervalForWave,
  upgradeCost,
  MAX_WAVE_BODIES,
  MIN_SPAWN_INTERVAL,
  SPAWN_WINDOW_SECONDS,
  crowdCompression,
  naturalEnemyCountForWave,
  naturalSpawnCountForWave,
  nominalSpawnIntervalForWave,
} from '../src/data/formulas';
import { ASCENSION_UNLOCK_WAVE, apForWave, tpForAP } from '../src/data/prestige';
import { ENEMY_DEFS } from '../src/data/enemies';
import { TOWER_XP_TABLE, TOWER_LEVEL_CAP, xpToLevel, xpForNextLevel, talentPointsAtLevel, xpPerKill, xpPerWaveClear, pioneerBonusXp, PIONEER_CLEAR_MULTIPLIER } from '../src/data/xpTables';
import {
  defaultWaveTiming,
  recordWaveTime,
  offlineWaveTarget,
  MIN_WAVE_SECONDS,
  MAX_WAVE_SECONDS,
} from '../src/data/waveTiming';
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
      const spawn = nominalSpawnIntervalForWave(w) * (naturalSpawnCountForWave(w) - 1);
      expect(expectedWaveSeconds(w)).toBeCloseTo(spawn + TARGET_WAVE_KILL_SECONDS);
    }
  });

  it('sizes the boss window off the encounter weight, not the body count', () => {
    for (const w of [10, 20, 100]) {
      const count = naturalSpawnCountForWave(w);
      const spawn = nominalSpawnIntervalForWave(w) * (count - 1);
      const kill = TARGET_BOSS_KILL_SECONDS * bossEncounterWeight(w);
      expect(expectedWaveSeconds(w), `wave ${w}`).toBeCloseTo(spawn + kill);
    }
  });

  it('pays a mutated boss roster for the time it takes to spawn', () => {
    // The extra bodies a Swarm mutator adds to a boss wave are escort trash,
    // not bosses, so they buy spawn time rather than a second kill window.
    // Priced at the *nominal* cadence: the budget is deliberately independent
    // of the spawn window (progress-steps §5.1c).
    const one = expectedWaveSeconds(20, 1);
    const two = expectedWaveSeconds(20, 2);
    expect(two - one).toBeCloseTo(nominalSpawnIntervalForWave(20));
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

  /**
   * progress.md §4: the exponent moved 1.06 -> 1.03 because at 1.06 a run at
   * the wall banked ~250x the player's entire lifetime AP, which spent the
   * whole designed content in four ascensions and then stalled.
   */
  it('pays AP that compounds with depth', () => {
    expect([20, 30, 60, 100].map(apForWave)).toMatchInlineSnapshot(`
      [
        20,
        37,
        119,
        493,
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
    // Deeper still pays more — depth has to reward the player — but it pays
    // *less than proportionally* (plans/economy.md §4): the kill XP scale is
    // `sqrt(wave - 1)`, so a wave-200 kill is well under 5x a wave-20 kill, and
    // wave-clear XP is exactly linear in depth.
    expect(xpPerKill('normal', 200)).toBeGreaterThan(xpPerKill('normal', 20));
    expect(xpPerKill('normal', 200)).toBeLessThan(xpPerKill('normal', 20) * 5);
    expect(xpPerWaveClear(100)).toBeGreaterThan(xpPerWaveClear(50));
    expect(xpPerWaveClear(200)).toBe(xpPerWaveClear(100) * 2);
  });

  it('pays a pioneer bonus only past the lifetime best', () => {
    expect(pioneerBonusXp(40, 40)).toBe(0);
    expect(pioneerBonusXp(41, 40)).toBe(Math.round(xpPerWaveClear(41) * PIONEER_CLEAR_MULTIPLIER));
  });

  // economy §4: the level curve grows at 1.028 per level, so per-wave XP must
  // grow *slower* than that. The old linear kill scale (1 + 0.20 * wave) and
  // superlinear clear scale (w^1.5) made deeper waves worth a larger share of
  // a level than shallower ones; the new sub-linear shape inverts that.
  it('decelerates XP gain with depth instead of accelerating it', () => {
    const waveXp = (w: number) =>
      enemyCountForWave(w) * xpPerKill('normal', w) + xpPerWaveClear(w);
    const share = (w: number, l: number) => waveXp(w) / xpForNextLevel(l);
    expect(share(100, 60)).toBeLessThan(share(40, 28));
    expect(share(200, 100)).toBeLessThan(share(100, 60));
  });

  it('keeps a deep kill within a small multiple of a shallow one', () => {
    expect(xpPerKill('normal', 200)).toBeLessThanOrEqual(xpPerKill('normal', 1) * 4);
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

/**
 * Wave timing (plans/economy.md §2 / §6.4).
 *
 * The offline model is paced by `WaveTimingState`, which carries both the last
 * **completed** wave and the running mean of the last `WAVE_TIMING_EMA_WINDOW`
 * clear times, measured in **simulation** seconds. These tests pin the
 * properties the offline math depends on: the mean tracks a tower that just got
 * stronger, a single glitched measurement cannot poison it, and the target is
 * always the last completed wave rather than whatever wave happens to be live.
 */
describe('wave timing', () => {
  it('averages the last five clears and tracks a tower getting stronger', () => {
    const t = defaultWaveTiming();
    for (const s of [100, 100, 100, 100, 100]) recordWaveTime(t, 33, s);
    expect(t.avgWaveSeconds).toBeCloseTo(100, 5);
    for (let i = 0; i < 20; i++) recordWaveTime(t, 33, 20);
    expect(t.avgWaveSeconds).toBeLessThan(25);
  });

  it('clamps a nonsense measurement instead of poisoning the average', () => {
    const t = defaultWaveTiming();
    recordWaveTime(t, 33, 0.001);
    expect(t.avgWaveSeconds).toBe(MIN_WAVE_SECONDS);
    recordWaveTime(t, 33, Number.POSITIVE_INFINITY);
    expect(t.avgWaveSeconds).toBeLessThanOrEqual(MAX_WAVE_SECONDS);
  });

  it('returns the last completed wave and its own clear time, whatever wave is live', () => {
    const t = defaultWaveTiming();
    recordWaveTime(t, 33, 60);
    // The live wave is irrelevant once something has been completed: an absence
    // repeats what the tower proved it can clear, not what it was attempting.
    for (const live of [34, 40, 91, 1]) {
      const target = offlineWaveTarget(t, live);
      expect(target.wave, `live ${live}`).toBe(33);
      expect(target.seconds, `live ${live}`).toBeCloseTo(60, 5);
      expect(target.measured, `live ${live}`).toBe(true);
    }
  });

  it('falls back to the live wave, off a boss, only until the first clear', () => {
    const t = defaultWaveTiming();
    const before = offlineWaveTarget(t, 30);          // boss wave, no samples
    expect(before.wave).toBe(29);
    expect(before.measured).toBe(false);
    expect(before.seconds).toBeCloseTo(expectedWaveSeconds(29), 5);

    recordWaveTime(t, 29, 45);
    const after = offlineWaveTarget(t, 30);
    expect(after.wave).toBe(29);
    expect(after.seconds).toBeCloseTo(45, 5);
    expect(after.measured).toBe(true);
  });

  it('floors the fallback with the in-progress wave, but never a measurement', () => {
    const t = defaultWaveTiming();
    // Nothing cleared yet: a wave already 300 s deep cannot be priced shorter.
    expect(offlineWaveTarget(t, 33, 300).seconds).toBeGreaterThanOrEqual(300);
    // Once a clear exists, the stalled attempt is ignored entirely.
    recordWaveTime(t, 33, 45);
    expect(offlineWaveTarget(t, 33, 300).seconds).toBeCloseTo(45, 5);
  });
});

describe('spawn window and the body cap (progress.md §5)', () => {
  it('fits every roster inside the spawn window once the window binds', () => {
    // The window first binds at wave 11 (17 bodies over 24 s = 1.5 s < 1.56 s).
    for (let w = 11; w <= 1000; w++) {
      if (isBossWave(w)) continue;
      const count = spawnCountForWave(w);
      const span = spawnIntervalForWave(w, count) * (count - 1);
      expect(span, `wave ${w}`).toBeLessThanOrEqual(SPAWN_WINDOW_SECONDS + 1e-9);
    }
  });

  it('never spawns faster than the natural cadence in the early game', () => {
    // Waves 1-10, i.e. everything before the window starts binding at 11.
    for (let w = 1; w <= 10; w++) {
      expect(spawnIntervalForWave(w), `wave ${w}`)
        .toBeCloseTo(nominalSpawnIntervalForWave(w), 9);
    }
  });

  it('never breaches the minimum interval', () => {
    for (let w = 1; w <= 2000; w++) {
      expect(spawnIntervalForWave(w), `wave ${w}`).toBeGreaterThanOrEqual(MIN_SPAWN_INTERVAL);
    }
  });

  it('caps the body count and compensates exactly', () => {
    for (let w = 1; w <= 2000; w++) {
      if (isBossWave(w)) continue;
      expect(enemyCountForWave(w), `wave ${w}`).toBeLessThanOrEqual(MAX_WAVE_BODIES);
      // The invariant the whole phase rests on: capped bodies x what each one
      // carries is the roster that would have spawned.
      expect(enemyCountForWave(w) * crowdCompression(w), `wave ${w}`)
        .toBeCloseTo(naturalEnemyCountForWave(w), 6);
    }
  });

  it('leaves the compression at 1 below the cap and on boss waves', () => {
    for (const w of [1, 20, 50, 97]) expect(crowdCompression(w), `wave ${w}`).toBe(1);
    for (const w of [10, 100, 200, 450]) {
      if (isBossWave(w)) expect(crowdCompression(w), `boss ${w}`).toBe(1);
    }
    expect(crowdCompression(98)).toBeGreaterThan(1);
  });

  it('keeps the enrage budget on the pre-window curve', () => {
    // The fuse must be identical to what it was before the window landed:
    // nominal cadence, natural body count. If this drifts, the wall moves.
    for (const w of [1, 20, 60, 100, 200, 359, 450]) {
      const expected = nominalSpawnIntervalForWave(w)
        * Math.max(0, naturalSpawnCountForWave(w) - 1)
        + (isBossWave(w) ? TARGET_BOSS_KILL_SECONDS * bossEncounterWeight(w) : TARGET_WAVE_KILL_SECONDS);
      expect(expectedWaveSeconds(w), `wave ${w}`).toBeCloseTo(expected, 6);
    }
  });
});
