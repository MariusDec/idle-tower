/**
 * Behavioural tests for the Part 5 performance work.
 *
 * Every optimisation here replaced a correct-but-slow implementation with a
 * faster one, so the risk is not that it is slow — it is that it now returns
 * something subtly different. Each test therefore checks the fast path against
 * either a brute-force reference or the invariant the old code guaranteed.
 */

import { describe, expect, it } from 'vitest';
import { GAME_SPEEDS, MAX_SPEED_INDEX, SPEED_STEP } from '../src/types';
import { SpatialGrid } from '../src/utils/SpatialGrid';
import { EffectsManager } from '../src/systems/EffectsManager';
import { UpgradeManager } from '../src/systems/UpgradeManager';
import { EventBus } from '../src/game/EventBus';
import { UPGRADES, UPGRADE_BY_ID } from '../src/data/upgrades';

interface Point {
  id: number;
  x: number;
  y: number;
  alive: boolean;
}

/** Deterministic PRNG, so a failure is reproducible. */
function rng(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

describe('SpatialGrid (plan §5.4)', () => {
  const brute = (items: Point[], x: number, y: number, r: number): number[] =>
    items
      .filter((p) => p.alive && (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r)
      .map((p) => p.id)
      .sort((a, b) => a - b);

  const ids = (out: Point[]): number[] => out.map((p) => p.id).sort((a, b) => a - b);

  it('returns exactly what an all-pairs scan returns', () => {
    const rand = rng(7);
    const items: Point[] = [];
    for (let i = 0; i < 400; i++) {
      items.push({ id: i, x: rand() * 1280, y: rand() * 720, alive: true });
    }
    const grid = new SpatialGrid<Point>(128);
    grid.rebuild(items);
    // Radii spanning the small (splash, mine) and large (aura) query sizes.
    for (const r of [1, 25, 50, 70, 150, 180, 400]) {
      for (let t = 0; t < 40; t++) {
        const x = rand() * 1280;
        const y = rand() * 720;
        expect(ids(grid.query(x, y, r, [])), `r=${r}`).toEqual(brute(items, x, y, r));
      }
    }
  });

  it('handles negative coordinates, where enemies spawn', () => {
    const items: Point[] = [
      { id: 1, x: -300, y: -220, alive: true },
      { id: 2, x: -280, y: -200, alive: true },
      { id: 3, x: 900, y: 600, alive: true },
    ];
    const grid = new SpatialGrid<Point>(128);
    grid.rebuild(items);
    expect(ids(grid.query(-290, -210, 60, []))).toEqual([1, 2]);
    expect(ids(grid.query(-290, -210, 10, []))).toEqual([]);
  });

  it('never reports the dead', () => {
    const items: Point[] = [
      { id: 1, x: 100, y: 100, alive: true },
      { id: 2, x: 105, y: 100, alive: false },
    ];
    const grid = new SpatialGrid<Point>(128);
    grid.rebuild(items);
    expect(ids(grid.query(100, 100, 50, []))).toEqual([1]);

    // Dying after the rebuild must also be respected, since the index is
    // reused across a whole tick while damage is being applied.
    items[0].alive = false;
    expect(grid.query(100, 100, 50, [])).toEqual([]);
  });

  it('drops the previous contents on rebuild', () => {
    const grid = new SpatialGrid<Point>(128);
    grid.rebuild([{ id: 1, x: 100, y: 100, alive: true }]);
    grid.rebuild([{ id: 2, x: 600, y: 400, alive: true }]);
    expect(ids(grid.query(100, 100, 50, []))).toEqual([]);
    expect(ids(grid.query(600, 400, 50, []))).toEqual([2]);
  });

  it('appends to the caller buffer rather than replacing it', () => {
    const grid = new SpatialGrid<Point>(128);
    grid.rebuild([{ id: 1, x: 100, y: 100, alive: true }]);
    const out: Point[] = [];
    expect(grid.query(100, 100, 50, out)).toBe(out);
    expect(out).toHaveLength(1);
  });

  /**
   * Regression test for a re-entrancy bug found during Part 5.
   *
   * `EnemyManager.queryRadius` originally defaulted to one shared scratch
   * buffer. Most callers damage what they find, and `damage` emits
   * `enemy_killed` / `enemy_damaged`, whose handlers query again — so the
   * inner query cleared and refilled the array the outer loop was still
   * walking, silently skipping enemies from mine blasts, splash and chain
   * kills. Queries must not hand out aliased storage.
   */
  it('does not alias results between calls', () => {
    const grid = new SpatialGrid<Point>(128);
    grid.rebuild([
      { id: 1, x: 100, y: 100, alive: true },
      { id: 2, x: 110, y: 100, alive: true },
      { id: 3, x: 900, y: 600, alive: true },
    ]);
    const outer = grid.query(105, 100, 50, []);
    const snapshot = outer.map((p) => p.id);
    const inner = grid.query(900, 600, 50, []);
    expect(outer).not.toBe(inner);
    expect(outer.map((p) => p.id)).toEqual(snapshot);
  });

  it('is empty after clear()', () => {
    const grid = new SpatialGrid<Point>(128);
    grid.rebuild([{ id: 1, x: 100, y: 100, alive: true }]);
    grid.clear();
    expect(grid.query(100, 100, 999, [])).toEqual([]);
  });
});

describe('EffectsManager pools (plan §5.3)', () => {
  it('caps particles and keeps the newest', () => {
    const fx = new EffectsManager();
    for (let i = 0; i < 4000; i++) fx.emitHitSparks(100, 200, '#fff', 6);
    expect(fx.particleList.length).toBe(600);
  });

  it('caps damage numbers', () => {
    const fx = new EffectsManager();
    // Spread them out so the merge path does not absorb them.
    for (let i = 0; i < 2000; i++) fx.emitDamageNumber((i * 137) % 1200, (i * 71) % 700, 5, false);
    expect(fx.damageList.length).toBe(80);
  });

  it('merges rapid hits on one spot into a single growing number', () => {
    const fx = new EffectsManager();
    for (let i = 0; i < 25; i++) fx.emitDamageNumber(400, 300, 7, false);
    expect(fx.damageList).toHaveLength(1);
    expect(fx.damageList[0].amount).toBe(25 * 7);
  });

  it('keeps crits, heals and hits as separate labels', () => {
    const fx = new EffectsManager();
    fx.emitDamageNumber(400, 300, 7, false);
    fx.emitDamageNumber(400, 300, 7, true);
    fx.emitHealNumber(400, 300, 7);
    expect(fx.damageList).toHaveLength(3);
  });

  it('does not merge across distant hits', () => {
    const fx = new EffectsManager();
    fx.emitDamageNumber(100, 300, 7, false);
    fx.emitDamageNumber(400, 300, 7, false);
    expect(fx.damageList).toHaveLength(2);
  });

  it('does not merge into a number that has already floated away', () => {
    const fx = new EffectsManager();
    fx.emitDamageNumber(400, 300, 7, false);
    fx.tick(0.5); // older than the merge window
    fx.emitDamageNumber(400, 300, 7, false);
    expect(fx.damageList).toHaveLength(2);
  });

  it('clears every pool on reset', () => {
    const fx = new EffectsManager();
    fx.emitHitSparks(1, 1, '#fff', 6);
    fx.emitDamageNumber(1, 1, 5, false);
    fx.reset();
    expect(fx.particleList).toHaveLength(0);
    expect(fx.damageList).toHaveLength(0);
  });
});

describe('UpgradeManager evolution cache (plan §5.8)', () => {
  const makeManager = () => {
    let gold = 1e15;
    const bus = new EventBus();
    const resources = {
      get gold() {
        return gold;
      },
      canAfford: (n: number) => gold >= n,
      spendGold: (n: number) => (gold >= n ? ((gold -= n), true) : false),
    };
    return new UpgradeManager(bus, resources as never);
  };

  /** The linear scan the cache replaced, kept here as the reference. */
  const scanHas = (mgr: UpgradeManager, effectId: string): boolean => {
    for (const u of UPGRADES) {
      if (!u.evolutions) continue;
      const level = mgr.getLevel(u.id);
      for (const evo of u.evolutions) {
        if (level >= evo.level && evo.effectId === effectId) return true;
      }
    }
    return false;
  };
  const scanValue = (mgr: UpgradeManager, effectId: string): number => {
    for (const u of UPGRADES) {
      if (!u.evolutions) continue;
      const level = mgr.getLevel(u.id);
      let value = 0;
      for (const evo of u.evolutions) {
        if (level >= evo.level && evo.effectId === effectId) value = evo.effectValue;
      }
      if (value > 0) return value;
    }
    return 0;
  };

  const allEffectIds = [
    ...new Set(UPGRADES.flatMap((u) => (u.evolutions ?? []).map((e) => e.effectId))),
  ];

  it('covers at least one effect id, or this suite proves nothing', () => {
    expect(allEffectIds.length).toBeGreaterThan(0);
  });

  it('agrees with a fresh scan at every level the evolutions care about', () => {
    const mgr = makeManager();
    const levels = [...new Set(UPGRADES.flatMap((u) => (u.evolutions ?? []).map((e) => e.level)))]
      .sort((a, b) => a - b);
    for (const level of [0, ...levels]) {
      mgr.replaceLevels(Object.fromEntries(UPGRADES.map((u) => [u.id, level])));
      for (const id of allEffectIds) {
        expect(mgr.hasEvolutionEffect(id), `${id} @ level ${level}`).toBe(scanHas(mgr, id));
        expect(mgr.getEvolutionEffectValue(id), `${id} @ level ${level}`).toBe(scanValue(mgr, id));
      }
    }
  });

  it('refreshes when a single purchase crosses an evolution threshold', () => {
    const withEvo = UPGRADES.find((u) => (u.evolutions?.length ?? 0) > 0)!;
    const firstEvo = withEvo.evolutions![0];
    const mgr = makeManager();
    mgr.replaceLevels({ [withEvo.id]: firstEvo.level - 1 });
    expect(mgr.hasEvolutionEffect(firstEvo.effectId)).toBe(false);
    expect(mgr.buy(withEvo.id)).toBe(true);
    expect(mgr.hasEvolutionEffect(firstEvo.effectId)).toBe(true);
  });

  it('refreshes when a bulk buy jumps over an evolution threshold', () => {
    const withEvo = UPGRADES.find((u) => (u.evolutions?.length ?? 0) > 0)!;
    const firstEvo = withEvo.evolutions![0];
    const mgr = makeManager();
    expect(mgr.hasEvolutionEffect(firstEvo.effectId)).toBe(false);
    expect(mgr.buyBulk(withEvo.id, firstEvo.level)).toBe(firstEvo.level);
    expect(mgr.hasEvolutionEffect(firstEvo.effectId)).toBe(true);
  });

  it('clears back to base on reset', () => {
    const withEvo = UPGRADES.find((u) => (u.evolutions?.length ?? 0) > 0)!;
    const firstEvo = withEvo.evolutions![0];
    const mgr = makeManager();
    mgr.buyBulk(withEvo.id, firstEvo.level);
    mgr.reset();
    expect(mgr.hasEvolutionEffect(firstEvo.effectId)).toBe(scanHas(mgr, firstEvo.effectId));
  });
});

describe('UPGRADE_BY_ID (plan §5.8)', () => {
  it('resolves every upgrade the table declares', () => {
    expect(Object.keys(UPGRADE_BY_ID)).toHaveLength(UPGRADES.length);
    for (const u of UPGRADES) expect(UPGRADE_BY_ID[u.id]).toBe(u);
  });

  it('has no duplicate ids to lose entries to', () => {
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
  });
});

describe('Accelerator speed ladder', () => {
  /**
   * progress-steps §1: the perk sells +0.5x per level over a 1.5x base, so the
   * ladder is 1.5 / 2.0 / 2.5 / 3.0 / 3.5 / 4.0 / 4.5 and *every* level adds
   * exactly one selectable speed. It used to add half a step, which meant odd
   * levels added nothing at all and a maxed perk topped out at 3.0x.
   */
  it('adds one whole selectable speed per level', () => {
    const expected = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5];
    for (let level = 0; level <= 6; level++) {
      const maxIndex = MAX_SPEED_INDEX + Math.round((0.5 * level) / SPEED_STEP);
      expect(maxIndex, `level ${level}`).toBe(2 + level);
      const top = maxIndex < GAME_SPEEDS.length
        ? GAME_SPEEDS[maxIndex]
        : GAME_SPEEDS[GAME_SPEEDS.length - 1]
          + (maxIndex - (GAME_SPEEDS.length - 1)) * SPEED_STEP;
      expect(top, `level ${level}`).toBeCloseTo(expected[level], 6);
      expect(Number.isInteger(maxIndex), `level ${level} index is whole`).toBe(true);
    }
  });
});
