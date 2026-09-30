import { describe, expect, it } from 'vitest';
import { ARENA, VIEW_HALF_HEIGHT, VIEW_HALF_WIDTH, spawnPoint } from '../src/content/arena';
import { makeViewTransform, screenToWorld, worldToScreen } from '../src/render/camera';
import { QUALITY } from '../src/render/quality';

/**
 * The camera fits a fixed world into any box (§4.1, D4). All of it is pure
 * arithmetic, so no canvas is needed.
 */
describe('camera', () => {
  const VIEWPORTS: [number, number][] = [[375, 812], [375, 640], [1280, 800], [480, 900], [900, 400]];

  it('never crops the arena', () => {
    for (const [w, h] of VIEWPORTS) {
      const t = makeViewTransform(w, h, 2);
      expect(VIEW_HALF_WIDTH * 2 * t.scale).toBeLessThanOrEqual(t.pixelWidth + 1e-6);
      expect(VIEW_HALF_HEIGHT * 2 * t.scale).toBeLessThanOrEqual(t.pixelHeight + 1e-6);
    }
  });

  it('fills the binding axis exactly', () => {
    for (const [w, h] of VIEWPORTS) {
      const t = makeViewTransform(w, h, 1);
      const fitW = t.pixelWidth / (VIEW_HALF_WIDTH * 2);
      const fitH = t.pixelHeight / (VIEW_HALF_HEIGHT * 2);
      expect(t.scale).toBeCloseTo(Math.min(fitW, fitH), 9);
    }
  });

  it('puts the tower at the centre of the screen', () => {
    const t = makeViewTransform(375, 812, 3);
    const p = worldToScreen(t, 0, 0);
    expect(p.x).toBeCloseTo(375 / 2, 6);
    expect(p.y).toBeCloseTo(812 / 2, 6);
  });

  it('round-trips world ↔ screen', () => {
    const t = makeViewTransform(375, 812, 2);
    for (const [x, y] of [[0, 0], [100, -250], [-520, 800]]) {
      const s = worldToScreen(t, x, y);
      const w = screenToWorld(t, s.x, s.y);
      expect(w.x).toBeCloseTo(x, 6);
      expect(w.y).toBeCloseTo(y, 6);
    }
  });

  it('caps devicePixelRatio and never drops below 1', () => {
    expect(makeViewTransform(375, 812, 3).dpr).toBe(ARENA.maxDevicePixelRatio);
    expect(makeViewTransform(375, 812, 3, 1.5).dpr).toBe(1.5);
    expect(makeViewTransform(375, 812, 0.5).dpr).toBe(1);
  });

  it('a DPR change does not change what is visible', () => {
    const a = makeViewTransform(375, 812, 1);
    const b = makeViewTransform(375, 812, 2);
    expect(a.scale / a.dpr).toBeCloseTo(b.scale / b.dpr, 9);
  });

  it('the high tier keeps the arena DPR cap', () => {
    expect(QUALITY.high.dprCap).toBe(ARENA.maxDevicePixelRatio);
  });

  it('spawns on the rim, just outside the playable ellipse and inside the view', () => {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const p = spawnPoint(a);
      const e = (p.x / ARENA.halfWidth) ** 2 + (p.y / ARENA.halfHeight) ** 2;
      expect(e).toBeGreaterThan(1);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(VIEW_HALF_WIDTH);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(VIEW_HALF_HEIGHT);
    }
  });
});
