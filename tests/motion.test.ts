/**
 * The enemy motion curves (plans/enemy-animation.md §3.1, §9). Pure: every
 * curve is a function of its inputs, so these run in Node.
 */
import { describe, expect, it } from 'vitest';
import {
  MOTION, applySquash, crowdDamping, gait, hitSquish, motionLevel, popFromRise, popFromTime,
  type BodyMotion, type GaitStyle, type MotionLevel,
} from '../src/render/motion';

const STYLES: readonly GaitStyle[] = ['hop', 'waddle', 'slither', 'float', 'skitter'];
const LEVELS: readonly MotionLevel[] = ['full', 'lite', 'reduced'];
const body = (): BodyMotion => ({ dx: 0, dy: 0, sx: 1, sy: 1 });
const HEADING = { nx: -0.6, ny: -0.8 };

describe('motionLevel', () => {
  it('reduced motion wins over any tier', () => {
    expect(motionLevel(true, 'full')).toBe('reduced');
    expect(motionLevel(true, 'lite')).toBe('reduced');
    expect(motionLevel(false, 'full')).toBe('full');
    expect(motionLevel(false, 'lite')).toBe('lite');
  });
});

describe('crowdDamping', () => {
  it('is full up to 60 bodies and half at 300', () => {
    expect(crowdDamping(0)).toBe(1);
    expect(crowdDamping(60)).toBe(1);
    expect(crowdDamping(180)).toBeCloseTo(0.75);
    expect(crowdDamping(300)).toBe(0.5);
    expect(crowdDamping(5000)).toBe(0.5);
  });
});

describe('applySquash', () => {
  it('keeps the area near constant and the scales inside the clamp', () => {
    const m = body();
    for (let q = -0.5; q <= 0.5; q += 0.01) {
      applySquash(m, q);
      expect(m.sx * m.sy).toBeGreaterThanOrEqual(0.9);
      expect(m.sx * m.sy).toBeLessThanOrEqual(1.1);
      for (const s of [m.sx, m.sy]) {
        expect(s).toBeGreaterThanOrEqual(MOTION.minScale);
        expect(s).toBeLessThanOrEqual(MOTION.maxScale);
      }
    }
  });
});

describe('gait', () => {
  const bob = 2;

  it('stays bounded for every style and level', () => {
    const m = body();
    for (const style of STYLES) {
      for (const level of LEVELS) {
        for (let p = 0; p < 40; p += 0.037) {
          gait(m, style, bob, p, 1, HEADING, level, 1);
          expect(Math.abs(m.dx)).toBeLessThanOrEqual(3 * bob);
          expect(Math.abs(m.dy)).toBeLessThanOrEqual(3 * bob);
          expect(m.sx * m.sy).toBeGreaterThanOrEqual(0.9);
          expect(m.sx * m.sy).toBeLessThanOrEqual(1.1);
          expect(Math.abs(1 - m.sy)).toBeLessThanOrEqual(1 - MOTION.minScale);
        }
      }
    }
  });

  it('under reduced motion is exactly today\'s bob (D-1)', () => {
    const m = body();
    const freq = 7;
    const id = 42;
    for (const style of STYLES) {
      for (let time = 0; time < 5; time += 0.13) {
        gait(m, style, bob, time * freq + id, 1, HEADING, 'reduced', 1);
        expect(m.dy).toBe(Math.sin(time * freq + id) * bob);
        expect(m.dx).toBe(0);
        expect(m.sx).toBe(1);
        expect(m.sy).toBe(1);
        gait(m, style, bob, time * freq + id, 0, HEADING, 'reduced', 1);
        expect(m.dy).toBe(0);
      }
    }
  });

  it('on lite moves but never squashes', () => {
    const m = body();
    for (const style of STYLES) {
      for (let p = 0; p < 20; p += 0.05) {
        gait(m, style, bob, p, 1, HEADING, 'lite', 1);
        expect(m.sx).toBe(1);
        expect(m.sy).toBe(1);
      }
    }
  });

  it('a still body sits at rest', () => {
    const m = body();
    for (const style of STYLES) {
      gait(m, style, bob, 3.3, 0, HEADING, 'full', 1);
      expect(m).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1 });
    }
  });

  it('a hop squashes continuously, with no jump where landing meets the arc', () => {
    const m = body();
    gait(m, 'hop', bob, 0, 1, HEADING, 'full', 1);
    let last = m.sy; // phase 0 is on the ground: already flattened
    for (let p = 0; p < 2 * Math.PI; p += 0.002) {
      gait(m, 'hop', bob, p, 1, HEADING, 'full', 1);
      expect(Math.abs(m.sy - last)).toBeLessThan(0.01);
      last = m.sy;
    }
  });

  it('a slither sways across its heading, not along it', () => {
    const m = body();
    for (let p = 0; p < 10; p += 0.1) {
      gait(m, 'slither', bob, p, 1, HEADING, 'full', 1);
      expect(m.dx * HEADING.nx + m.dy * HEADING.ny).toBeCloseTo(0, 10);
    }
  });

  it('the crowd damps it', () => {
    const a = body();
    const b = body();
    gait(a, 'hop', bob, 1.1, 1, HEADING, 'full', 1);
    gait(b, 'hop', bob, 1.1, 1, HEADING, 'full', 0.5);
    expect(b.dy).toBeCloseTo(a.dy / 2);
  });

  it('is deterministic: same inputs, same outputs', () => {
    const a = body();
    const b = body();
    for (const style of STYLES) {
      gait(a, style, bob, 7.77, 0.6, HEADING, 'full', 0.8);
      gait(b, style, bob, 7.77, 0.6, HEADING, 'full', 0.8);
      expect(b).toEqual(a);
    }
  });
});

describe('hitSquish', () => {
  it('is nothing under reduced motion', () => {
    for (let t = 0; t < 0.3; t += 0.01) expect(hitSquish(t, 'reduced', 1)).toBe(0);
  });

  it('compresses first, overshoots, and settles', () => {
    expect(hitSquish(0, 'full', 1)).toBeCloseTo(MOTION.squishAmp);
    expect(hitSquish(0, 'lite', 1)).toBeCloseTo(MOTION.squishAmpLite);
    expect(hitSquish(MOTION.squishPeriod / 2, 'full', 1)).toBeLessThan(0);
    expect(hitSquish(1, 'full', 1)).toBe(0);
  });

  it('re-armed by a beam every tick, it pulses and returns near rest between pulses', () => {
    // hitTick changes every sim tick (1/60 s) for 2 s; the painter re-arms at most every `squishRearm`.
    let squishAt = -Infinity;
    let peak = 0;
    let lowBetween = Infinity;
    for (let tick = 0; tick < 120; tick++) {
      const clock = tick / 60;
      if (clock - squishAt >= MOTION.squishRearm) {
        if (squishAt > -Infinity) lowBetween = Math.min(lowBetween, Math.abs(hitSquish(clock - squishAt - 1e-9, 'full', 1)));
        squishAt = clock;
      }
      peak = Math.max(peak, hitSquish(clock - squishAt, 'full', 1));
    }
    expect(peak).toBeCloseTo(MOTION.squishAmp);
    // Right before each re-arm the spring is all but spent: never stuck at its peak.
    expect(lowBetween).toBeLessThan(0.01);
  });
});

describe('pops', () => {
  it('end at full size', () => {
    expect(popFromRise(1)).toBe(1);
    expect(popFromTime(MOTION.popSeconds)).toBe(1);
    expect(popFromTime(5)).toBe(1);
  });

  it('start small and overshoot', () => {
    expect(popFromRise(0)).toBeCloseTo(0.82);
    expect(popFromRise(0.7)).toBeCloseTo(1.08);
    expect(popFromTime(0)).toBeCloseTo(0.5);
    let top = 0;
    for (let t = 0; t <= MOTION.popSeconds; t += 0.001) top = Math.max(top, popFromTime(t));
    expect(top).toBeCloseTo(1.12, 2);
  });

  it('are continuous', () => {
    for (let r = 0; r < 1; r += 0.001) expect(Math.abs(popFromRise(r + 0.001) - popFromRise(r))).toBeLessThan(0.01);
    for (let t = -0.01; t < 0.3; t += 0.0005) expect(Math.abs(popFromTime(t + 0.0005) - popFromTime(t))).toBeLessThan(0.02);
  });
});

describe('GAIT styles (plans/enemy-animation.md §4.1)', () => {
  it('every enemy type has a style, and every style is used', async () => {
    const { GAIT } = await import('../src/render/painters/enemies');
    const { ENEMY_BY_ID } = await import('../src/content/enemies');
    expect(Object.keys(GAIT).sort()).toEqual(Object.keys(ENEMY_BY_ID).sort());
    const used = new Set(Object.values(GAIT).map((g) => g.style));
    for (const s of STYLES) expect(used.has(s)).toBe(true);
  });
});
