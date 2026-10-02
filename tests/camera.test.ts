import { describe, expect, it } from 'vitest';
import { ARENA, PHONE_OVAL, inLight, lightRadius, rimAxes, spawnPoint, type Oval } from '../src/content/arena';
import { Camera, RIM, ZOOM, fitExtent, makeViewTransform, rimBox, screenToWorld, stageOval, worldToScreen } from '../src/render/camera';
import { QUALITY } from '../src/render/quality';

/**
 * The camera frames the light (plans/camera-and-fog.md §5): fully out, the
 * light's oval rim runs near the stage's sides and level with the HP bar at
 * either end, whatever the window's shape. All of it is arithmetic, so a
 * stub canvas stands in for the DOM.
 */
const VIEWPORTS: [number, number][] = [[375, 812], [375, 640], [1280, 800], [480, 900], [900, 400]];

function stubCanvas(w: number, h: number): HTMLCanvasElement {
  return {
    clientWidth: w,
    clientHeight: h,
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width: w, height: h }),
  } as unknown as HTMLCanvasElement;
}

/** The fit for a 375 × 812 phone stage. */
const fit = (light: number, oval: Oval = PHONE_OVAL): number => fitExtent(light, oval, 375, 812);

describe('view transform', () => {
  it("fits the stage's own oval to its rim box: near the sides, level with the HP bar", () => {
    const light = 900;
    for (const [w, h] of VIEWPORTS) {
      const oval = stageOval(w, h);
      const t = makeViewTransform(w, h, 1, 2, fitExtent(light, oval, w, h));
      const rim = rimBox(w, h);
      const axes = rimAxes(ARENA.lightBase, oval);
      const base = makeViewTransform(w, h, 1, 2, fitExtent(ARENA.lightBase, oval, w, h));
      expect(axes.x * base.scale).toBeCloseTo(rim.hw, 3);
      expect(axes.y * base.scale).toBeCloseTo(rim.hh, 3);
      // A grown light rounds out: it fits the binding axis, never past the rim box.
      const grown = rimAxes(light, oval);
      expect(grown.x * t.scale).toBeLessThanOrEqual(rim.hw + 1e-6);
      expect(grown.y * t.scale).toBeLessThanOrEqual(rim.hh + 1e-6);
      // The long axis ends `endInset` from the stage's edges, top and bottom alike.
      const long = Math.max(w, h) / 2 - Math.max(rim.hw, rim.hh);
      expect(long).toBeCloseTo(RIM.endInset, 6);
    }
  });

  it('a phone stage takes the shape the game was tuned on', () => {
    const o = stageOval(375, 812);
    expect(o.sx).toBe(1);
    expect(o.sy).toBeCloseTo(PHONE_OVAL.sy, 1);
    const wide = stageOval(1280, 600);
    expect(wide.sy).toBe(1);
    expect(wide.sx).toBeGreaterThan(1);
  });

  it('puts the tower at the centre of the screen', () => {
    const t = makeViewTransform(375, 812, 3);
    const p = worldToScreen(t, 0, 0);
    expect(p.x).toBeCloseTo(375 / 2, 6);
    expect(p.y).toBeCloseTo(812 / 2, 6);
  });

  it('round-trips world ↔ screen', () => {
    const t = makeViewTransform(375, 812, 2, 2, 400);
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
});

describe('the camera follows the light, or the player', () => {
  const settle = (cam: Camera): void => {
    for (let i = 0; i < 200; i++) cam.update(0.05);
  };

  it('follows a growing light when fully out', () => {
    const cam = new Camera(stubCanvas(375, 812));
    cam.setLight(700, PHONE_OVAL, true);
    settle(cam);
    expect(cam.transform.extent).toBeCloseTo(fit(700), 3);
    cam.setLight(1100, PHONE_OVAL, true);
    settle(cam);
    expect(cam.transform.extent).toBeCloseTo(fit(1100), 3);
    expect(cam.zoomedIn).toBe(false);
  });

  it('zooms between the close limit and the fit, and snaps back to following', () => {
    const cam = new Camera(stubCanvas(375, 812));
    cam.setLight(700, PHONE_OVAL, true);
    settle(cam);
    cam.zoomBy(100, true);
    expect(cam.transform.extent).toBe(ZOOM.close);
    expect(cam.userFraming).toBe(ZOOM.close);
    expect(cam.zoomedIn).toBe(true);
    cam.zoomBy(0.01, true);
    expect(cam.userFraming).toBeNull();
    expect(cam.transform.extent).toBeCloseTo(fit(700), 6);
    // Nearly fully out counts as fully out, once the gesture ends.
    cam.zoomBy(1.02, true);
    expect(cam.userFraming).not.toBeNull();
    cam.settle();
    expect(cam.userFraming).toBeNull();
    // A button press snaps at once.
    cam.zoomBy(1.02);
    expect(cam.userFraming).toBeNull();
  });

  it('a pinch arriving as many small steps zooms in (it never snaps mid-gesture)', () => {
    const cam = new Camera(stubCanvas(375, 812));
    cam.setLight(700, PHONE_OVAL, true);
    settle(cam);
    for (let i = 0; i < 40; i++) cam.zoomBy(1.02, true);
    cam.settle();
    expect(cam.userFraming).not.toBeNull();
    expect(cam.transform.extent).toBeCloseTo(fit(700) / 1.02 ** 40, 3);
  });

  it('holds a framing while the light grows, and clamps it when the light shrinks inside it', () => {
    const cam = new Camera(stubCanvas(375, 812));
    cam.setLight(900, PHONE_OVAL, true);
    settle(cam);
    cam.zoomBy(2, true);
    const framing = cam.userFraming!;
    expect(framing).toBeCloseTo(fit(900) / 2, 6);
    cam.setLight(1400, PHONE_OVAL, true);
    settle(cam);
    expect(cam.transform.extent).toBeCloseTo(framing, 6);
    // A Fog-caller pulls the light in past the framing.
    const small = 200;
    cam.setLight(small, PHONE_OVAL, true);
    settle(cam);
    expect(fit(small)).toBeLessThan(framing);
    expect(cam.transform.extent).toBeCloseTo(fit(small), 3);
    expect(cam.userFraming).toBe(framing);
  });

  it('shows the whole light on a screen without a run, whatever the saved framing', () => {
    const cam = new Camera(stubCanvas(375, 812));
    cam.setFraming(300);
    cam.setLight(ARENA.lightBase, PHONE_OVAL, false);
    settle(cam);
    expect(cam.transform.extent).toBeCloseTo(fit(ARENA.lightBase), 3);
  });
});

describe('the light (camera-and-fog §3)', () => {
  it('is never less than its base, and always past range by the margin', () => {
    for (const range of [200, 380, 600, 1000, 2400]) {
      const L = lightRadius(range);
      expect(L).toBeGreaterThanOrEqual(ARENA.lightBase);
      expect(L).toBeGreaterThanOrEqual(range + ARENA.lightMargin);
    }
  });

  it('a Fog-caller dims it, but never inside range plus the margin', () => {
    expect(lightRadius(380, 0.9)).toBeLessThan(lightRadius(380));
    expect(lightRadius(1000 * 0.9, 0.9)).toBeGreaterThanOrEqual(900 + ARENA.lightMargin);
  });

  it('spawns just past the rim, in the soft edge of the dark, where it can already be hit', () => {
    for (const [L, oval] of [[lightRadius(380), PHONE_OVAL], [lightRadius(1400), stageOval(1280, 700)]] as const) {
      for (let i = 0; i < 16; i++) {
        const p = spawnPoint((i / 16) * Math.PI * 2, L, oval);
        const q = Math.hypot(p.x / rimAxes(L, oval).x, p.y / rimAxes(L, oval).y);
        expect(q).toBeGreaterThan(1);
        expect(inLight(p.x, p.y, 0, L, oval)).toBe(true);
      }
    }
  });

  it('a body shows, and can be hit, until it is wholly in the full dark past the soft edge', () => {
    const L = 500;
    const rim = rimAxes(L, PHONE_OVAL);
    const k = ARENA.darkScale;
    expect(inLight(rim.x * k + 10, 0, 12, L, PHONE_OVAL)).toBe(true);
    expect(inLight(0, rim.y * k + 10, 8, L, PHONE_OVAL)).toBe(false);
  });

  it('grows the long axis by a constant, so the long walk stays the same as range grows', () => {
    const small = rimAxes(500, PHONE_OVAL);
    const big = rimAxes(900, PHONE_OVAL);
    expect(small.y).toBeCloseTo(960, 6);
    expect(big.y - big.x).toBeCloseTo(small.y - small.x, 6);
  });
});
