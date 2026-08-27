import { describe, it, expect } from 'vitest';
import { EffectsManager, damageTier } from '../src/systems/EffectsManager';
import { QUALITY } from '../src/data/quality';
import { INTRO_IN, INTRO_HOLD, INTRO_OUT, introEaseOutCubic } from '../src/game/Game';

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

  it('keeps fractional damage amounts instead of rounding to the nearest integer', () => {
    const fx = new EffectsManager();
    fx.emitDamageNumber(400, 300, 2.2, false, { maxHp: 100 });
    expect(fx.damageList[0].amount).toBe(2.2);
  });

  it('keeps fractional heal amounts instead of rounding up to 1', () => {
    const fx = new EffectsManager();
    fx.emitHealNumber(400, 300, 0.4);
    expect(fx.damageList[0].amount).toBe(0.4);
  });
});

describe('the quality knob (UI plan §5.F)', () => {
  it('defaults to high, where nothing is scaled', () => {
    expect(QUALITY.high.particleScale).toBe(1);
    const fx = new EffectsManager();
    fx.emitFrostNovaRing(0, 0);
    expect(fx.particleList).toHaveLength(48);
  });

  it('scales every emitter by the tier', () => {
    const low = new EffectsManager();
    low.setQuality('low');
    low.emitFrostNovaRing(0, 0);
    expect(low.particleList).toHaveLength(12); // 48 * 0.25

    const medium = new EffectsManager();
    medium.setQuality('medium');
    medium.emitDeathBurst(0, 0, '#ffffff', 20, 24);
    // 24 * 0.5 body sparks + max(3, 24/3) * 0.5 = 4 soft puffs.
    expect(medium.particleList).toHaveLength(16);
  });

  it('never emits fewer than one particle', () => {
    const fx = new EffectsManager();
    fx.setQuality('low');
    fx.emitAttackSlash(0, 0, 10, 0, '#ffffff'); // 5 * 0.25 rounds to 1
    expect(fx.particleList.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps a ring a ring: the angle is derived from the scaled bound', () => {
    const fx = new EffectsManager();
    fx.setQuality('low');
    fx.emitFrostNovaRing(0, 0);
    // A quarter of the particles still covers the whole circle, so the
    // headings must span it rather than bunching into a quadrant.
    const angles = fx.particleList.map(p => Math.atan2(p.vy, p.vx));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI);
  });

  it('never touches a damaging shockwave', () => {
    // The one place in Part 5 where a mistake changes the balance: the ring
    // that carries `damage` is a gameplay object, not a garnish.
    const fx = new EffectsManager();
    fx.setQuality('low');
    fx.emitShockwaveRing(0, 0, 200, undefined, undefined, 0.1, 250, 'magic');
    expect(fx.shockwaveList).toHaveLength(1);
    const s = fx.shockwaveList[0];
    expect(s.damage).toBe(250);
    expect(s.maxRadius).toBe(200);
    expect(s.age).toBeCloseTo(-0.1);

    // …and the boss-entry rings, which are shockwaves too, still all fire.
    const pulse = new EffectsManager();
    pulse.setQuality('low');
    pulse.emitBossEntryPulse(0, 0);
    expect(pulse.shockwaveList).toHaveLength(3);
  });

  it('drops the particle count monotonically as the tier falls', () => {
    const counts = (['high', 'medium', 'low'] as const).map(tier => {
      const fx = new EffectsManager();
      fx.setQuality(tier);
      fx.emitDeathBurst(0, 0, '#ffffff', 20, 24);
      return fx.particleList.length;
    });
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
  });

  it('emits an identical damaging shockwave at every tier', () => {
    // §10.C spells the fields out because each is a gameplay input: the number
    // of rings, how far they reach, how long they live, when they arrive and
    // what they hit for. Presentation may not change simulation (§0.3 rule 3).
    const rings = (['high', 'medium', 'low'] as const).map(tier => {
      const fx = new EffectsManager();
      fx.setQuality(tier);
      fx.emitShockwaveRing(0, 0, 200, undefined, undefined, 0.1, 250, 'magic');
      return fx.shockwaveList;
    });
    for (const list of rings) expect(list).toHaveLength(rings[0].length);
    for (const list of rings) {
      const s = list[0];
      const ref = rings[0][0];
      expect(s.maxRadius).toBe(ref.maxRadius);
      expect(s.life).toBe(ref.life);
      expect(s.age).toBe(ref.age);
      expect(s.damage).toBe(ref.damage);
      expect(s.damageType).toBe(ref.damageType);
    }
  });

  it('holds the pool cap under a flood, keeping the newest survivors', () => {
    // 5 000 four-spark emitters is twenty thousand particles asking for a slot
    // in a pool that holds a few hundred. The cap is the only thing between a
    // busy wave and an unbounded array, so it gets tested at the scale that
    // would actually hurt.
    const fx = new EffectsManager();
    for (let i = 0; i < 5000; i++) fx.emitHitSparks(i, 0, '#ffffff', 4);
    expect(fx.particleList.length).toBeLessThanOrEqual(QUALITY.high.maxParticles);
    // The survivors are the newest: nothing older than the tail window is left.
    const oldest = Math.min(...fx.particleList.map(p => p.x));
    expect(oldest).toBeGreaterThan(5000 - QUALITY.high.maxParticles - 1);
    expect(fx.particleList[fx.particleList.length - 1].x).toBe(4999);
  });

  it('shrinks the live pool to the new ceiling, dropping the oldest', () => {
    const fx = new EffectsManager();
    for (let i = 0; i < 100; i++) fx.emitHitSparks(i, 0, '#ffffff', 4);
    expect(fx.particleList).toHaveLength(400);
    fx.setQuality('low');
    expect(fx.particleList).toHaveLength(QUALITY.low.maxParticles);
    // The survivors are the youngest: the last emitter's x, not the first's.
    expect(fx.particleList[fx.particleList.length - 1].x).toBe(99);
    expect(fx.particleList[0].x).toBeGreaterThan(0);
  });
});

describe('the boss intro timeline (UI plan §5.D, acceptance §5.G)', () => {
  it('runs the whole cinematic in under two seconds', () => {
    // §5.G: "a boss entry produces bars-name-pattern in under two seconds".
    // The phases are on the wall clock, so their sum *is* the wall time.
    expect(INTRO_IN + INTRO_HOLD + INTRO_OUT).toBeLessThan(2);
  });

  it('reaches the hold with the bars fully extended, and returns to nothing', () => {
    // The snapshot feeds the renderer a single 0..1 bar extension: it must
    // start closed, be open for the whole hold, and close again on the out.
    expect(introEaseOutCubic(0)).toBe(0);
    expect(introEaseOutCubic(1)).toBe(1);
    expect(1 - introEaseOutCubic(1)).toBe(0);
  });

  it('clamps outside 0..1 rather than overshooting the letterbox', () => {
    expect(introEaseOutCubic(-5)).toBe(0);
    expect(introEaseOutCubic(5)).toBe(1);
  });

  it('eases out: the bars are more than half open at the phase midpoint', () => {
    expect(introEaseOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});
