import { describe, expect, it } from 'vitest';
import { Renderer } from '../src/render/renderer';
import { PLAIN_LOOK } from '../src/render/painters/tower';

/**
 * The renderer reports a still picture (plans/android-gpu-crash.md §1a), so
 * the app can stop drawing a stopped arena. A context whose every method is
 * a no-op stands in for the canvas: only the flag logic is under test.
 */
function stubContext(): CanvasRenderingContext2D {
  const noop: unknown = new Proxy(function () {}, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : noop),
    apply: () => noop,
    set: () => true,
  });
  return noop as CanvasRenderingContext2D;
}

function stubCanvas(w: number, h: number): HTMLCanvasElement {
  const ctx = stubContext();
  return {
    clientWidth: w,
    clientHeight: h,
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width: w, height: h }),
    getContext: () => ctx,
    addEventListener: () => {},
  } as unknown as HTMLCanvasElement;
}

/** The hub backdrop drawn until the camera has eased in and nothing is left moving. */
function settledRenderer(): Renderer {
  const canvas = stubCanvas(375, 812);
  const r = new Renderer(canvas, canvas as unknown as HTMLElement);
  for (let i = 0; i < 200; i++) r.render(null, 1, 0.05);
  return r;
}

describe('renderer settled', () => {
  it('settles once a frame is drawn with nothing moving', () => {
    expect(settledRenderer().settled).toBe(true);
  });

  const setters: [string, (r: Renderer) => void][] = [
    ['setQuality', (r) => r.setQuality('low')],
    ['setPalette', (r) => r.setPalette('safe')],
    ['setTower', (r) => r.setTower(PLAIN_LOOK, 'arcane-bolt')],
    ['setTextScale', (r) => r.setTextScale(1.2)],
    ['setMotion', (r) => r.setMotion(true, false)],
  ];
  for (const [name, set] of setters) {
    it(`${name} makes the picture stale until the next frame`, () => {
      const r = settledRenderer();
      set(r);
      expect(r.settled).toBe(false);
      r.render(null, 1, 0.05);
      expect(r.settled).toBe(true);
    });
  }

  it('a shake keeps it drawing until the shake is done', () => {
    const r = settledRenderer();
    r.camera.shake(10);
    expect(r.settled).toBe(false);
    for (let i = 0; i < 20; i++) r.render(null, 1, 0.05);
    expect(r.settled).toBe(true);
  });
});

/** The painter's motion level (plans/enemy-animation.md §2, §3.4), read through the private field. */
const motionOf = (r: Renderer): { level: string; tier: string } =>
  (r as unknown as { enemies: { motion: { level: string; tier: string } } }).enemies.motion;

describe('renderer enemy motion', () => {
  it('follows the tier and the reduced-motion setting, which wins', () => {
    const r = settledRenderer();
    r.setMotion(false, true);
    r.setQuality('high');
    expect(motionOf(r)).toEqual({ level: 'full', tier: 'high' });
    r.setQuality('low');
    expect(motionOf(r)).toEqual({ level: 'lite', tier: 'low' });
    r.setMotion(true, true);
    expect(motionOf(r).level).toBe('reduced');
    r.setQuality('high');
    expect(motionOf(r).level).toBe('reduced');
  });

  it('the bench override wins, and hands back to the setting', () => {
    const r = settledRenderer();
    r.setMotion(true, true);
    r.setQuality('medium');
    r.setBenchMotion('base');
    expect(motionOf(r).level).toBe('full');
    r.setMotion(false, true);
    r.setBenchMotion('off');
    expect(motionOf(r).level).toBe('reduced');
    r.setBenchMotion(null);
    expect(motionOf(r).level).toBe('full');
  });

  it('the boss animator follows the same level as the enemies', () => {
    const r = settledRenderer();
    const boss = (r as unknown as { bossMotion: { motion: { level: string; tier: string } } }).bossMotion;
    r.setMotion(false, true);
    r.setQuality('high');
    expect(boss.motion).toEqual({ level: 'full', tier: 'high' });
    r.setQuality('low');
    expect(boss.motion).toEqual({ level: 'lite', tier: 'low' });
    r.setMotion(true, true);
    expect(boss.motion.level).toBe('reduced');
  });

  it('still settles: the motion state never keeps it drawing', () => {
    const r = settledRenderer();
    r.setBenchMotion('base');
    r.render(null, 1, 0.05);
    expect(r.settled).toBe(true);
  });
});
