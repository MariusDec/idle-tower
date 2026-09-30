/**
 * The arena helpers that §3.1 of `plans/enemies.md` adds: `viewBodyBoost`
 * (per-viewport body size scale) and `viewPenWidth` (stroke width with a
 * device-pixel floor). Both are pure, both live next to the rest of the
 * arena's arithmetic in `src/data/arena.ts`, and both are tested against the
 * numbers in §1.2 / §1.4 / §4.5 of the plan. Failures here mean the rendered
 * enemy roster no longer matches the measurements the plan was written from.
 *
 * The body-boost test in case 4 is the one that keeps `MAX_BODY_BOOST`
 * honest — the tank is the binding case, with 2.1 world units of slack left
 * under the projectile hit radius, so a future bump past 1.506 blows up the
 * assertion with `tank` in the message.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BOOST, MIN_STROKE_PX, PROJECTILE_HIT_PAD, REFERENCE_CSS_PER_WORLD,
  entity, viewBodyBoost, viewPenWidth,
} from '../src/data/arena';
import { makeViewTransform } from '../src/game/Camera';
import { ENEMY_DEFS } from '../src/data/enemies';
import { ELITE_RADIUS_SCALE } from '../src/game/Renderer';

describe('viewBodyBoost', () => {
  it('is exactly 1 on every desktop transform', () => {
    const desktop = makeViewTransform(900, 620, 1);
    const laptop = makeViewTransform(1000, 640, 2);
    const largeDesktop = makeViewTransform(1140, 760, 2);
    // The 900×620 case is a hair under the reference (1.027), so allow up to 1.05.
    expect(viewBodyBoost(desktop.scale, desktop.dpr)).toBeLessThan(1.05);
    expect(viewBodyBoost(desktop.scale, desktop.dpr)).toBeGreaterThanOrEqual(1);
    // The other two land at or above REFERENCE_CSS_PER_WORLD and round to 1.
    expect(viewBodyBoost(laptop.scale, laptop.dpr)).toBe(1);
    expect(viewBodyBoost(largeDesktop.scale, largeDesktop.dpr)).toBe(1);
  });

  it('clamps to MAX_BODY_BOOST on a phone', () => {
    const phone = makeViewTransform(375, 442, 2);
    expect(viewBodyBoost(phone.scale, phone.dpr)).toBe(MAX_BODY_BOOST);
  });

  it('is dpr-independent across the three quality tiers', () => {
    // Same phone viewport, three dprCap values that map to the low/medium/high
    // quality tiers. cssPerWorld = scale / dpr is the same on all three, so the
    // boost must match too.
    const low = makeViewTransform(375, 442, 2, 1);
    const medium = makeViewTransform(375, 442, 2, 1.5);
    const high = makeViewTransform(375, 442, 2, 2);
    expect(viewBodyBoost(low.scale, low.dpr)).toBe(MAX_BODY_BOOST);
    expect(viewBodyBoost(medium.scale, medium.dpr)).toBe(MAX_BODY_BOOST);
    expect(viewBodyBoost(high.scale, high.dpr)).toBe(MAX_BODY_BOOST);
  });

  it('keeps the drawn body inside the radius a projectile tests against', () => {
    // For every enemy type, the drawn radius must stay inside the projectile
    // hit radius (`radius + PROJECTILE_HIT_PAD`). The tank is the binding case
    // — 2.1 world units of slack left at MAX_BODY_BOOST × ELITE_RADIUS_SCALE —
    // so it gets named in the failure.
    for (const def of Object.values(ENEMY_DEFS)) {
      const eliteFactor = def.type === 'boss' ? 1 : ELITE_RADIUS_SCALE;
      const drawn = def.radius * MAX_BODY_BOOST * eliteFactor;
      const hit = def.radius + PROJECTILE_HIT_PAD;
      expect(drawn, `drawn radius for ${def.type} (tank is the binding case)`).toBeLessThanOrEqual(hit);
    }
  });

  it('keeps a boss inside the hit radius without the elite factor', () => {
    // Bosses are never elite — WaveManager.pickEnemyType guards on
    // `wave >= 21 && type !== 'boss' && …` (WaveManager.ts:284) — so the
    // body-boost-only path is the one that has to fit, not the elite×boost
    // path used by everything else.
    const boss = ENEMY_DEFS.boss;
    const drawn = boss.radius * MAX_BODY_BOOST;
    const hit = boss.radius + PROJECTILE_HIT_PAD;
    expect(drawn).toBeLessThanOrEqual(hit);
  });
});

describe('viewPenWidth', () => {
  // The five viewports in plans/enemies.md §1.4. The first column is the
  // platform; the second is the device pixel ratio (with the tier it lands on);
  // the third is the resolved `scale` from `makeViewTransform`. Anything else
  // would mean the table the plan was measured against has drifted.
  const VIEWPORTS = [
    { label: 'laptop dpr 2', size: [1000, 640] as const, dpr: 2 },
    { label: 'desktop dpr 1', size: [900, 620] as const, dpr: 1 },
    { label: 'phone high', size: [375, 442] as const, dpr: 2 },
    { label: 'phone medium', size: [375, 442] as const, dpr: 1.5 },
    { label: 'phone low', size: [375, 442] as const, dpr: 1 },
  ];

  it('returns at least minPx / scale in device pixels', () => {
    for (const { label, size, dpr } of VIEWPORTS) {
      const t = makeViewTransform(size[0], size[1], dpr);
      for (const worldWidth of [entity(1.7), entity(1.2), entity(0.6)]) {
        const result = viewPenWidth(worldWidth, t.scale);
        // The product `result × scale` is the width in device pixels. It must
        // clear the floor MIN_STROKE_PX for the floor to mean anything.
        expect(result * t.scale, label).toBeGreaterThanOrEqual(MIN_STROKE_PX);
      }
    }
  });

  it('is a no-op where the world width already wins', () => {
    // On a laptop, entity(1.7) is 1.16 device px and the floor at 2 px is
    // already the binding term, but its world-unit value is within 2% of the
    // input — i.e. a desktop transform's stroke widths visibly do not change.
    const laptop = makeViewTransform(1000, 640, 2);
    const w = entity(1.7);
    const result = viewPenWidth(w, laptop.scale, 2);
    expect(Math.abs(result - w) / w).toBeLessThan(0.02);
  });

  it('survives a degenerate transform without producing Infinity or NaN', () => {
    // viewPenWidth: scale = 0 returns the input rather than Infinity/NaN.
    expect(viewPenWidth(entity(1.7), 0)).toBe(entity(1.7));
    expect(viewPenWidth(entity(1.7), 0, 2)).toBe(entity(1.7));
    expect(viewPenWidth(entity(1.7), -1)).toBe(entity(1.7));

    // viewBodyBoost: scale = 0 (or dpr = 0) returns 1 rather than Infinity/NaN.
    expect(viewBodyBoost(0, 2)).toBe(1);
    expect(viewBodyBoost(0.5, 0)).toBe(1);
    expect(viewBodyBoost(0, 0)).toBe(1);
    expect(viewBodyBoost(-1, 2)).toBe(1);
  });
});