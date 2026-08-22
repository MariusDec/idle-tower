import { describe, it, expect } from 'vitest';
import { EffectsManager, damageTier } from '../src/systems/EffectsManager';

describe('damageTier (UI plan §5.B)', () => {
  it('buckets a hit by the fraction of max HP it took', () => {
    expect(damageTier(60, 100)).toBe(3);
    expect(damageTier(50, 100)).toBe(3);
    expect(damageTier(20, 100)).toBe(2);
    expect(damageTier(6, 100)).toBe(1);
    expect(damageTier(5, 100)).toBe(0);
  });

  it('is tier 0 whenever there is no denominator', () => {
    // A heal, a gold pop, an unknown target: a number with no denominator has
    // no business shouting.
    expect(damageTier(9999, 0)).toBe(0);
    expect(damageTier(9999, -1)).toBe(0);
    expect(damageTier(9999, Number.NaN)).toBe(0);
  });
});

describe('damage numbers, screen-space model (UI plan §5.B)', () => {
  it('rises in CSS pixels rather than moving its world anchor', () => {
    const fx = new EffectsManager();
    fx.emitDamageNumber(400, 300, 10, false, { maxHp: 100 });
    const d = fx.damageList[0];
    const anchorY = d.y;
    fx.tick(0.1);
    expect(d.riseCss).toBeGreaterThan(0);
    expect(d.y).toBe(anchorY);
  });

  it('re-pops a merge without teleporting the label back down', () => {
    const fx = new EffectsManager();
    fx.emitDamageNumber(400, 300, 10, false, { maxHp: 100 });
    fx.tick(0.1);
    const risen = fx.damageList[0].riseCss;
    expect(risen).toBeGreaterThan(0);
    fx.emitDamageNumber(400, 300, 10, false, { maxHp: 100 });
    expect(fx.damageList).toHaveLength(1);
    const d = fx.damageList[0];
    expect(d.amount).toBe(20);
    expect(d.age).toBe(0); // the pop re-runs
    expect(d.riseCss).toBe(risen); // …but the rise does not reset
  });

  it('promotes the tier when a merge crosses a threshold', () => {
    const fx = new EffectsManager();
    fx.emitDamageNumber(400, 300, 10, false, { maxHp: 100 });
    expect(fx.damageList[0].tier).toBe(1);
    fx.emitDamageNumber(400, 300, 60, false, { maxHp: 100 });
    expect(fx.damageList[0].tier).toBe(3);
  });

  it('never folds one kind into another', () => {
    const fx = new EffectsManager();
    fx.emitDamageNumber(400, 300, 7, false, { kind: 'damage' });
    fx.emitDamageNumber(400, 300, 7, false, { kind: 'self' });
    fx.emitDamageNumber(400, 300, 7, false, { kind: 'gold' });
    fx.emitDamageNumber(400, 300, 7, false, { kind: 'mana' });
    fx.emitHealNumber(400, 300, 7);
    expect(fx.damageList).toHaveLength(5);
  });

  it('tags a pickup as gold rather than as a crit', () => {
    // §0.2 gap 4: the gold pickup used to pass "was a full-value pickup" as
    // `isCrit`, so gold rendered in the crit colour.
    const fx = new EffectsManager();
    fx.emitDamageNumber(400, 300, 12, false, { kind: 'gold' });
    const d = fx.damageList[0];
    expect(d.kind).toBe('gold');
    expect(d.isCrit).toBe(false);
    expect(d.tier).toBe(0);
  });
});
