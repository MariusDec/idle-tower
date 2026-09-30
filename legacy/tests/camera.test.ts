/**
 * The camera and the arena (UI plan §1).
 *
 * Everything the camera does that could be *wrong* is arithmetic, and all of
 * that arithmetic is pure — `makeViewTransform`, `arenaExtents`,
 * `spawnPointOnEllipse` and the range clamp take numbers and return numbers.
 * So this file needs no canvas, no DOM and no `ResizeObserver`; the class in
 * `Camera.ts` is only the part that reads a CSS box and calls `setTransform`.
 *
 * The two ratios asserted below are the plan's acceptance criteria (§12.1),
 * not incidental numbers: the range ring must be ~32% of the short half-extent
 * at wave 1, and a fully range-stacked build must never exceed 70% of it.
 * Written down here so a future re-tune of `TOWER_BASE.range`, of the `range`
 * upgrade or of `ARENA.minHalfExtent` fails a test rather than quietly undoing
 * the zoom-out.
 */

import { describe, expect, it } from 'vitest';
import {
  ARENA,
  ARENA_RANGE_CAP,
  ENTITY_SCALE,
  WORLD_SCALE,
  arenaExtents,
  spawnPointOnEllipse,
} from '../src/data/arena';
import { Camera, makeViewTransform, screenToWorld, worldToScreen, type CameraResize } from '../src/game/Camera';
import { clampStat } from '../src/stats/accumulator';
import { TOWER_BASE } from '../src/data/tower';
import { UPGRADE_BY_ID } from '../src/data/upgrades';
import { computeUpgradeValue } from '../src/types';

const [MIN_ASPECT, MAX_ASPECT] = ARENA.aspectClamp;

describe('arena extents', () => {
  it('guarantees the same half-extent along the short axis at every aspect', () => {
    for (const [w, h] of [[1600, 900], [1440, 1080], [1280, 800], [900, 1600], [1000, 1000]]) {
      const { halfWidth, halfHeight } = arenaExtents(w, h);
      expect(Math.min(halfWidth, halfHeight)).toBeCloseTo(ARENA.minHalfExtent, 6);
    }
  });

  it('derives the long axis from the viewport aspect', () => {
    const { halfWidth, halfHeight } = arenaExtents(1600, 900);
    expect(halfWidth / halfHeight).toBeCloseTo(1600 / 900, 6);
    // 16:9 is exactly the old 1280x720 canvas, zoomed out by WORLD_SCALE.
    expect(halfWidth * 2).toBeCloseTo(1280 * WORLD_SCALE, 6);
    expect(halfHeight * 2).toBeCloseTo(720 * WORLD_SCALE, 6);
  });

  it('clamps an ultrawide aspect so the arena is not a telescope', () => {
    const wide = arenaExtents(4000, 900); // 4.44:1
    expect(wide.halfWidth / wide.halfHeight).toBeCloseTo(MAX_ASPECT, 6);
    expect(wide.halfHeight).toBeCloseTo(ARENA.minHalfExtent, 6);
  });

  it('clamps an extreme portrait aspect so the field is not crushed', () => {
    const tall = arenaExtents(375, 1200); // 0.31:1
    expect(tall.halfWidth / tall.halfHeight).toBeCloseTo(MIN_ASPECT, 6);
    expect(tall.halfWidth).toBeCloseTo(ARENA.minHalfExtent, 6);
  });

  it('is a no-op on shape, not on size', () => {
    // Only the *ratio* is read, so CSS pixels and device pixels agree.
    expect(arenaExtents(1600, 900)).toEqual(arenaExtents(3200, 1800));
  });

  it('survives a degenerate box rather than dividing by zero', () => {
    const { halfWidth, halfHeight } = arenaExtents(0, 0);
    expect(Number.isFinite(halfWidth)).toBe(true);
    expect(Number.isFinite(halfHeight)).toBe(true);
    expect(halfWidth).toBeGreaterThan(0);
    expect(halfHeight).toBeGreaterThan(0);
  });
});

describe('the view transform', () => {
  it('caps devicePixelRatio, because a 3x buffer buys nothing visible', () => {
    expect(makeViewTransform(800, 600, 3).dpr).toBe(ARENA.maxDevicePixelRatio);
    expect(makeViewTransform(800, 600, 2).dpr).toBe(2);
    expect(makeViewTransform(800, 600, 1).dpr).toBe(1);
    // A browser that reports nonsense still gets a usable buffer.
    expect(makeViewTransform(800, 600, 0).dpr).toBe(1);
  });

  it('honours an explicit dprCap, which the quality tier feeds in (UI plan §9.D)', () => {
    // The cap is a ceiling: a 2x buffer under a 1.5 cap resolves to 1.5.
    expect(makeViewTransform(800, 600, 2, 1.5).dpr).toBe(1.5);
    expect(makeViewTransform(800, 600, 3, 1).dpr).toBe(1);
    // And under the 1.5 cap, the 1x buffer stays 1x.
    expect(makeViewTransform(800, 600, 1, 1.5).dpr).toBe(1);
  });

  it('a dprCap change moves pixelWidth and scale but leaves worldWidth untouched', () => {
    // UI plan §9.D: the enemy-rescale guard. A DPR cap change must rebuild the
    // backing store and recompute `scale`, but the world rectangle is the same
    // for both calls — if the camera fed the resize handler here, every enemy
    // would shift by 1.0 (a no-op) and the next refactor that tightens the
    // `sx !== 1` guard would teleport them.
    const t2 = makeViewTransform(800, 600, 2, 2);
    const t1 = makeViewTransform(800, 600, 2, 1);
    expect(t2.worldWidth).toBe(t1.worldWidth);
    expect(t2.worldHeight).toBe(t1.worldHeight);
    expect(t2.pixelWidth).toBeGreaterThan(t1.pixelWidth);
    expect(t2.pixelHeight).toBeGreaterThan(t1.pixelHeight);
    // Scale (backing-store px per world unit) is exactly halved under the
    // halved cap — that is the whole point of the cap.
    expect(t2.scale).toBeCloseTo(t1.scale * 2, 6);
  });

  it('sizes the backing store as cssPx x dpr', () => {
    const t = makeViewTransform(800, 450, 2);
    expect(t.pixelWidth).toBe(1600);
    expect(t.pixelHeight).toBe(900);
  });

  it('fits the whole world rectangle on screen — never crops it', () => {
    for (const [w, h, dpr] of [[1600, 900, 1], [800, 600, 2], [375, 700, 3], [3000, 800, 1]]) {
      const t = makeViewTransform(w, h, dpr);
      expect(t.worldWidth * t.scale).toBeLessThanOrEqual(t.pixelWidth + 1e-6);
      expect(t.worldHeight * t.scale).toBeLessThanOrEqual(t.pixelHeight + 1e-6);
    }
  });

  it('puts the centre of the world at the centre of the canvas', () => {
    const t = makeViewTransform(1600, 900, 2);
    const centre = worldToScreen(t, t.worldWidth / 2, t.worldHeight / 2);
    expect(centre.x).toBeCloseTo(t.cssWidth / 2, 6);
    expect(centre.y).toBeCloseTo(t.cssHeight / 2, 6);
  });

  it('round-trips world → screen → world at every dpr and aspect', () => {
    for (const [w, h, dpr] of [[1600, 900, 1], [800, 600, 2], [375, 700, 3], [1000, 1000, 1.5]]) {
      const t = makeViewTransform(w, h, dpr);
      for (const [x, y] of [[0, 0], [t.worldWidth, t.worldHeight], [123.5, 987.25]]) {
        const screen = worldToScreen(t, x, y);
        const back = screenToWorld(t, screen.x, screen.y);
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
      }
    }
  });

  it('round-trips screen → world → screen, which is the direction input uses', () => {
    const t = makeViewTransform(1280, 720, 2);
    for (const [x, y] of [[0, 0], [1280, 720], [640, 360], [17.5, 601.25]]) {
      const worldPoint = screenToWorld(t, x, y);
      const back = worldToScreen(t, worldPoint.x, worldPoint.y);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it('maps the corners of the canvas outside the world rect only by the fit surplus', () => {
    // Inside the aspect clamp the world rectangle *is* the visible rectangle,
    // so the canvas corners land exactly on the world corners.
    const t = makeViewTransform(1600, 900, 1);
    const topLeft = screenToWorld(t, 0, 0);
    expect(topLeft.x).toBeCloseTo(0, 6);
    expect(topLeft.y).toBeCloseTo(0, 6);
  });
});

describe('the spawn ellipse', () => {
  const halfW = 1664;
  const halfH = 936;
  const cx = halfW;
  const cy = halfH;

  it('lands every point just outside the world rectangle', () => {
    for (let i = 0; i < 64; i++) {
      const p = spawnPointOnEllipse(cx, cy, halfW, halfH, (i / 64) * Math.PI * 2);
      // Normalised ellipse radius: 1 is the arena edge.
      const r = Math.hypot((p.x - cx) / halfW, (p.y - cy) / halfH);
      expect(r).toBeCloseTo(ARENA.spawnRingScale, 6);
    }
  });

  it('removes the corner/edge walk-in asymmetry the rectangle had', () => {
    // The old rectangle put a corner spawn ~1.4x further from the tower than
    // an edge spawn, so a wave's length depended on how its rolls fell.
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < 360; i++) {
      const p = spawnPointOnEllipse(cx, cy, halfW, halfH, (i / 360) * Math.PI * 2);
      const d = Math.hypot(p.x - cx, p.y - cy);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    // The remaining spread is the viewport's own aspect, not a geometry bug:
    // the long axis is genuinely further away than the short one.
    expect(max / min).toBeCloseTo(halfW / halfH, 6);
    const rectangleWorstCase = Math.SQRT2;
    expect(max / min).toBeLessThan((halfW / halfH) * rectangleWorstCase);
  });

  it('is symmetric about the arena centre', () => {
    const a = spawnPointOnEllipse(cx, cy, halfW, halfH, 0.7);
    const b = spawnPointOnEllipse(cx, cy, halfW, halfH, 0.7 + Math.PI);
    expect(a.x + b.x).toBeCloseTo(cx * 2, 6);
    expect(a.y + b.y).toBeCloseTo(cy * 2, 6);
  });
});

describe('the range cap (plan §1.2)', () => {
  it('caps a stacked build at 70% of the short half-extent', () => {
    expect(clampStat('range', 1_000_000)).toBeCloseTo(ARENA_RANGE_CAP, 6);
    expect(ARENA_RANGE_CAP / ARENA.minHalfExtent).toBeCloseTo(0.70, 6);
  });

  it('leaves an ordinary build alone', () => {
    expect(clampStat('range', TOWER_BASE.range)).toBe(TOWER_BASE.range);
    expect(clampStat('range', 500)).toBe(500);
  });

  it('still floors at 1, so a stacked penalty cannot blind the tower', () => {
    expect(clampStat('range', -50)).toBe(1);
  });

  it('puts the wave-1 ring at ~32% of the short half-extent', () => {
    expect(TOWER_BASE.range / ARENA.minHalfExtent).toBeCloseTo(0.32, 2);
  });

  it('puts the flat upgrade maximum at ~48%, i.e. short of the cap', () => {
    const longbow = UPGRADE_BY_ID['range'];
    expect(longbow).toBeTruthy();
    const flatMax = TOWER_BASE.range + computeUpgradeValue(longbow, longbow.maxLevel);
    expect(flatMax).toBe(450);
    expect(flatMax / ARENA.minHalfExtent).toBeCloseTo(0.48, 2);
    // The cap has to be somewhere a *built* tower gets to, not somewhere the
    // upgrade alone lands — otherwise talents and blessings buy nothing.
    expect(flatMax).toBeLessThan(ARENA_RANGE_CAP);
  });
});

describe('the two scales', () => {
  it('zooms the world out further than it zooms the entities', () => {
    // This gap is the zoom-out. If the two ever converge, the arena grows and
    // nothing on it looks any smaller — which is a resolution change, not a
    // camera.
    expect(ENTITY_SCALE).toBeLessThan(WORLD_SCALE);
    expect(ENTITY_SCALE / WORLD_SCALE).toBeCloseTo(0.65, 2);
  });

  it('leaves range out of the multiplication, which is the whole mechanism', () => {
    // 300 is the pre-camera base. It must stay 300: scaling it would move the
    // ring with the arena and the zoom-out would be invisible.
    expect(TOWER_BASE.range).toBe(300);
  });
});

describe('Camera.setDprCap (UI plan §9.D)', () => {
  // The enemy-rescale guard. `Game.onCameraResize` multiplies every live
  // enemy, projectile, hostile shot and loot orb by
  // `worldWidth / previousWorldWidth`. A DPR-cap change leaves the world
  // rectangle identical, so the resize it emits must report the *same* world
  // extents on both sides — anything else is a mid-wave teleport waiting for
  // the next refactor that tightens the `sx !== 1` short-circuit.
  const makeCanvas = (cssWidth: number, cssHeight: number): HTMLCanvasElement => {
    const canvas = {
      width: 0,
      height: 0,
      clientWidth: cssWidth,
      clientHeight: cssHeight,
      getBoundingClientRect: () => ({ width: cssWidth, height: cssHeight }),
    };
    return canvas as unknown as HTMLCanvasElement;
  };

  const withDevicePixelRatio = <T>(dpr: number, fn: () => T): T => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'devicePixelRatio');
    const previous = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = dpr;
    try {
      return fn();
    } finally {
      if (had) (globalThis as { devicePixelRatio?: number }).devicePixelRatio = previous;
      else delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
    }
  };

  it('resizes the backing store without moving the world rectangle', () => {
    withDevicePixelRatio(3, () => {
      const canvas = makeCanvas(800, 600);
      const camera = new Camera(canvas);
      const resizes: CameraResize[] = [];
      camera.onResize = (info) => { resizes.push(info); };

      const before = camera.transform;
      expect(camera.currentDprCap).toBe(ARENA.maxDevicePixelRatio);

      camera.setDprCap(1);

      const after = camera.transform;
      expect(after.dpr).toBe(1);
      expect(after.pixelWidth).toBe(800);
      expect(canvas.width).toBe(800);
      expect(after.pixelWidth).toBeLessThan(before.pixelWidth);
      // The world is untouched: same extents, so nothing may be rescaled.
      expect(after.worldWidth).toBe(before.worldWidth);
      expect(after.worldHeight).toBe(before.worldHeight);

      expect(resizes).toHaveLength(1);
      const info = resizes[0];
      expect(info.previousWorldWidth).toBe(info.worldWidth);
      expect(info.previousWorldHeight).toBe(info.worldHeight);
      // i.e. the scale factors Game computes are exactly 1 on both axes.
      expect(info.worldWidth / info.previousWorldWidth).toBe(1);
      expect(info.worldHeight / info.previousWorldHeight).toBe(1);

      camera.destroy();
    });
  });

  it('is a no-op when the cap does not change, and rejects nonsense', () => {
    withDevicePixelRatio(2, () => {
      const camera = new Camera(makeCanvas(800, 600));
      const resizes: CameraResize[] = [];
      camera.onResize = (info) => { resizes.push(info); };

      camera.setDprCap(ARENA.maxDevicePixelRatio);   // already the cap
      camera.setDprCap(0);                            // nonsense
      camera.setDprCap(-1);
      expect(resizes).toHaveLength(0);
      expect(camera.currentDprCap).toBe(ARENA.maxDevicePixelRatio);

      camera.destroy();
    });
  });

  it('still reports the real previous extents when the world does change shape', () => {
    withDevicePixelRatio(1, () => {
      const canvas = makeCanvas(1600, 900);
      const camera = new Camera(canvas);
      const resizes: CameraResize[] = [];
      camera.onResize = (info) => { resizes.push(info); };

      const before = camera.transform;
      // A genuine viewport change: portrait phone box.
      canvas.clientWidth = 400;
      canvas.clientHeight = 900;
      (canvas as unknown as { getBoundingClientRect: () => { width: number; height: number } })
        .getBoundingClientRect = () => ({ width: 400, height: 900 });
      camera.measure();

      expect(resizes).toHaveLength(1);
      expect(resizes[0].previousWorldWidth).toBe(before.worldWidth);
      expect(resizes[0].previousWorldHeight).toBe(before.worldHeight);
      expect(resizes[0].worldWidth).not.toBe(before.worldWidth);

      camera.destroy();
    });
  });
});
