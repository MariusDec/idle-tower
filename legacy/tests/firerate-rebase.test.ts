import { describe, it, expect } from 'vitest';
import { UPGRADE_BY_ID } from '../src/data/upgrades';
import { computeUpgradeValue } from '../src/types';
import { TOWER_BASE } from '../src/data/tower';

/**
 * The shot-cadence rebase (`plans/firerate.md`): the fire-rate curve was cut to
 * ~57% at the cap and the damage curve raised 1.2x to pay part of it back.
 * `baseDamage` and `fireRate` each have exactly one additive source, so these
 * two curves are the tower's whole upgrade-axis output.
 */
describe('shot-cadence rebase', () => {
  const damageAt = (lv: number) => computeUpgradeValue(UPGRADE_BY_ID['damage'], lv);
  const rateAt = (lv: number) =>
    TOWER_BASE.fireRate + computeUpgradeValue(UPGRADE_BY_ID['fireRate'], lv);

  it('caps the cadence at 3.15 shots/s, down from 5.50', () => {
    expect(UPGRADE_BY_ID['fireRate'].maxLevel).toBe(45);
    expect(rateAt(0)).toBeCloseTo(0.9, 10);
    expect(rateAt(45)).toBeCloseTo(3.15, 10);
  });

  it('keeps the damage curve geometric from L1 at +11% per level', () => {
    // baseEffect x 1.11^(n-1); the closed form only holds while the formula's
    // coefficient stays equal to baseEffect x 0.11.
    expect(damageAt(1)).toBeCloseTo(2.64, 10);
    for (const lv of [2, 10, 30, 50]) {
      expect(damageAt(lv)).toBeCloseTo(2.64 * 1.11 ** (lv - 1), 6);
    }
  });

  /*
   * DPS moves on purpose, so this pins where it lands rather than that it
   * held. `before` is the same two curves at their pre-rebase literals
   * (damage 2.2 / 0.242, rate base 1.0 / slope 0.1) and is recorded here so a
   * future re-tune can see the whole trade at a glance.
   */
  const DPS: Array<[number, number, number, number]> = [
    // damageLevel, rateLevel, before, after
    [1, 0, 2.2, 2.3760000000000003],
    [10, 10, 11.255362467300605, 9.454504472532507],
    [20, 20, 47.93806859320034, 36.432932130832256],
    [30, 30, 181.48847732686554, 130.67170367534317],
    [45, 45, 1193.9783086997327, 820.5887285245436],
  ];

  for (const [dmgLevel, rateLevel, before, after] of DPS) {
    it(`d${dmgLevel}/r${rateLevel} resolves to ${(after / before).toFixed(2)}x its pre-rebase DPS`, () => {
      expect(damageAt(dmgLevel) * rateAt(rateLevel)).toBeCloseTo(after, 6);
    });
  }
});
