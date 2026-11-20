import { describe, expect, it } from 'vitest';
import { ARENA, PHONE_OVAL, inLight, lightRadius, rimAxes, spawnPoint, type Oval } from '../src/content/arena';
import { Camera, PIXEL_BUDGET, RIM, ZOOM, fitExtent, makeViewTransform, rimBox, screenToWorld, shapeDrifted, stageOval, worldToScreen } from '../src/render/camera';
import { formOf } from '../src/app/formFactor';
import { QUALITY } from '../src/render/quality';

/**
 * The camera frames the light (plans/camera-and-fog.md §5): fully out, the
 * light's oval rim runs near the stage's sides and level with the HP bar at
 * either end, whatever the window's shape. All of it is arithmetic, so a
 * stub canvas stands in for the DOM.
 */
const VIEWPORTS: [number, number][] = [
  [375, 812], [375, 640], [1280, 800], [480, 900], [900, 400],
  [768, 1024], [1440, 900], [2560, 1440],
];

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
      // The long axis ends `endInset` from the stage's edges, top and bottom alike (uncapped stages).
      if (formOf(w, h) === 'compact') {
        const long = Math.max(w, h) / 2 - Math.max(rim.hw, rim.hh);
        expect(long).toBeCloseTo(RIM.endInset, 6);
      }
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

  it('caps how big a large stage draws the base light, keeping its shape (large-screens §6.2)', () => {
    for (const [w, h] of [[768, 1024], [1440, 900], [2560, 1440]] as const) {
      const form = formOf(w, h);
      const oval = stageOval(w, h);
      const t = makeViewTransform(w, h, 1, 2, fitExtent(ARENA.lightBase, oval, w, h));
      const axes = rimAxes(ARENA.lightBase, oval);
      // CSS px per world unit on the short axis: at the cap, never past it.
      expect(Math.min(axes.x, axes.y) * t.scale / ARENA.lightBase).toBeCloseTo(RIM.maxScale[form], 6);
      // Shrunk uniformly: the box keeps the uncapped box's aspect.
      const rim = rimBox(w, h);
      const half = { w: w / 2, h: h / 2 };
      const raw = half.h >= half.w
        ? { hw: half.w * RIM.sideShare, hh: half.h - RIM.endInset }
        : { hw: half.w * RIM.sideShare, hh: half.h * RIM.sideShare };
      expect(rim.hw / rim.hh).toBeCloseTo(raw.hw / raw.hh, 9);
    }
  });

  it('frees the long axis\'s ends on an expanded stage, whose HUD is in the corners (large-screens §8.2)', () => {
    // Landscape and expanded: the same side margin on both axes, so the box has the stage's aspect.
    for (const [w, h] of [[1280, 800], [1440, 900], [1024, 700]] as const) {
      const rim = rimBox(w, h);
      expect(rim.hw / rim.hh).toBeCloseTo(w / h, 9);
    }
    // A short landscape window is compact: the HP bar runs full width, so the inset stays.
    const short = rimBox(900, 400);
    expect(450 - short.hw).toBeCloseTo(RIM.endInset, 6);
  });

  it('never caps a phone: compact stages draw as they always have', () => {
    for (const [w, h] of [[360, 640], [375, 812], [412, 915], [430, 932], [480, 900]] as const) {
      const half = { w: w / 2, h: h / 2 };
      expect(rimBox(w, h)).toEqual({ hw: half.w * RIM.sideShare, hh: Math.max(half.w * RIM.sideShare, half.h - RIM.endInset) });
      expect(RIM.maxScale[formOf(w, h)]).toBe(Infinity);
    }
  });

  it('centres the tower in the region a docked panel leaves (large-screens §6.3)', () => {
    const [w, h, right] = [1440, 900, 420];
    const region = w - right;
    const oval = stageOval(region, h);
    const t = makeViewTransform(w, h, 2, 2, fitExtent(ARENA.lightBase, oval, region, h), { insetRight: right });
    const p = worldToScreen(t, 0, 0);
    expect(p.x).toBeCloseTo(region / 2, 6);
    expect(p.y).toBeCloseTo(h / 2, 6);
    // The base light fits the region's rim box, not the stage's.
    const rim = rimBox(region, h);
    const axes = rimAxes(ARENA.lightBase, oval);
    expect(axes.x * t.scale / t.dpr).toBeCloseTo(rim.hw, 3);
    expect(p.x + rim.hw).toBeLessThanOrEqual(region);
    // Round-trips with the origin moved.
    const back = screenToWorld(t, 100, 200);
    const again = worldToScreen(t, back.x, back.y);
    expect(again.x).toBeCloseTo(100, 6);
    expect(again.y).toBeCloseTo(200, 6);
  });

  it('keeps a large backing store inside the pixel budget, never below DPR 1', () => {
    const big = makeViewTransform(1280, 800, 2, 2, undefined, { pixelBudget: PIXEL_BUDGET.high });
    expect(big.pixelWidth * big.pixelHeight).toBeLessThanOrEqual(PIXEL_BUDGET.high * 1.001);
    expect(big.dpr).toBeLessThan(2);
    const huge = makeViewTransform(2560, 1440, 1, 1, undefined, { pixelBudget: PIXEL_BUDGET.low });
    expect(huge.dpr).toBe(1);
    // No phone reaches any tier's budget.
    for (const tier of ['high', 'medium', 'low'] as const) {
      const cap = QUALITY[tier].dprCap;
      expect(makeViewTransform(430, 932, 3, cap, undefined, { pixelBudget: PIXEL_BUDGET[tier] }).dpr).toBe(makeViewTransform(430, 932, 3, cap).dpr);
    }
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

describe('the docked panel inset', () => {
  const settle = (cam: Camera): void => {
    for (let i = 0; i < 200; i++) cam.update(0.05);
  };

  it('slides the tower over on the zoom ease, then is still', () => {
    const cam = new Camera(stubCanvas(1440, 900));
    cam.setLight(ARENA.lightBase, stageOval(1440, 900), false);
    settle(cam);
    expect(cam.worldToScreen(0, 0).x).toBeCloseTo(720, 6);
    cam.setInsets({ right: 420 });
    cam.setLight(ARENA.lightBase, stageOval(1020, 900), false);
    expect(cam.still).toBe(false);
    cam.update(0.05);
    const mid = cam.worldToScreen(0, 0).x;
    expect(mid).toBeLessThan(720);
    expect(mid).toBeGreaterThan(510);
    settle(cam);
    expect(cam.still).toBe(true);
    expect(cam.worldToScreen(0, 0).x).toBeCloseTo(510, 6);
    expect(cam.transform.extent).toBeCloseTo(fitExtent(ARENA.lightBase, stageOval(1020, 900), 1020, 900), 3);
    // Culling keeps the wider side, right of the tower.
    expect(cam.viewHalfWidth * cam.transform.scale / cam.transform.dpr).toBeCloseTo(1440 - 510, 3);
  });

  it('never covers more than half the stage', () => {
    const cam = new Camera(stubCanvas(800, 600));
    cam.setInsets({ right: 2000 });
    settle(cam);
    expect(cam.still).toBe(true);
    expect(cam.transform.insetRight).toBe(400);
  });
});

describe('a still camera (plans/android-gpu-crash.md §1a)', () => {
  const settle = (cam: Camera): void => {
    for (let i = 0; i < 200; i++) cam.update(0.05);
  };
  const fresh = (): Camera => {
    const cam = new Camera(stubCanvas(375, 812));
    cam.setLight(700, PHONE_OVAL, true);
    settle(cam);
    return cam;
  };

  it('is still once settled, and not while a shake plays', () => {
    const cam = fresh();
    expect(cam.still).toBe(true);
    cam.shake(10);
    expect(cam.still).toBe(false);
    settle(cam);
    expect(cam.still).toBe(true);
  });

  it('is not still while a zoom punch plays', () => {
    const cam = fresh();
    cam.zoomPunch();
    expect(cam.still).toBe(false);
    settle(cam);
    expect(cam.still).toBe(true);
  });

  it('is not still while easing toward a new framing or light', () => {
    const cam = fresh();
    cam.setLight(1100, PHONE_OVAL, true);
    expect(cam.still).toBe(false);
    settle(cam);
    expect(cam.still).toBe(true);
    cam.zoomBy(2);
    expect(cam.still).toBe(false);
    settle(cam);
    expect(cam.still).toBe(true);
  });

  it('bumps its version on a pinch, which lands at once', () => {
    const cam = fresh();
    const v = cam.version;
    cam.zoomBy(1.5, true);
    expect(cam.still).toBe(true);
    expect(cam.version).toBeGreaterThan(v);
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

describe('a run\'s light after the stage turns (plans/large-screens.md §10.3)', () => {
  const at = (w: number, h: number): Oval => stageOval(w, h);

  it('is unchanged on a phone and on a desktop window nudged a little', () => {
    expect(shapeDrifted(at(375, 812), at(375, 812))).toBe(false);
    expect(shapeDrifted(at(1440, 900), at(1400, 880))).toBe(false);
    expect(shapeDrifted(PHONE_OVAL, at(412, 915))).toBe(false);
  });

  it('has drifted when a tablet turns, or a foldable folds', () => {
    expect(shapeDrifted(at(1024, 768), at(768, 1024))).toBe(true);
    expect(shapeDrifted(at(768, 1024), at(1280, 800))).toBe(true);
    // Unfolded (about square) to folded (a phone).
    expect(shapeDrifted(at(840, 900), at(375, 812))).toBe(true);
  });

  it('has drifted when only the squareness differs', () => {
    expect(shapeDrifted({ ...PHONE_OVAL, n: 2 }, { ...PHONE_OVAL, n: 3 })).toBe(true);
  });
});
