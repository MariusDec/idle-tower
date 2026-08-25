import { ARENA, arenaExtents } from '../data/arena';

/**
 * The camera: a small class, not a framework.
 *
 * It owns three things and nothing else — how big the backing store is, the
 * two transforms every draw pass runs under, and the conversions between world
 * and pointer coordinates. It knows nothing about the simulation and the
 * simulation knows nothing about it; `Game` is the only thing holding both.
 *
 * See `docs/camera-system.md`.
 */

/**
 * Everything needed to place world coordinates on the backing store.
 *
 * A plain value, computed by a pure function, so the whole of the camera's
 * arithmetic is testable in a node environment with no canvas anywhere near
 * it (`tests/camera.test.ts`).
 */
export interface ViewTransform {
  /** Capped `devicePixelRatio`. Backing-store pixels per CSS pixel. */
  dpr: number;
  /** CSS pixels the canvas element occupies. */
  cssWidth: number;
  cssHeight: number;
  /** Backing-store size, i.e. `cssWidth x dpr`. */
  pixelWidth: number;
  pixelHeight: number;
  /** The world rectangle, in world units. The tower sits at its centre. */
  worldWidth: number;
  worldHeight: number;
  /** Backing-store pixels per world unit. */
  scale: number;
  /** Backing-store pixel the world origin (0, 0) lands on. */
  offsetX: number;
  offsetY: number;
}

/**
 * Derive the whole transform from a CSS box and a device pixel ratio.
 *
 * The world rectangle comes from `arenaExtents`, which guarantees
 * `ARENA.minHalfExtent` along the short axis. The zoom is then the *fit* of
 * that rectangle into the backing store — `min`, never `max`, so nothing the
 * simulation considers in-bounds is ever cropped off the screen. Inside the
 * aspect clamp the two terms are equal and the world rectangle is exactly the
 * visible one; outside it the surplus shows as extra floor on the long axis,
 * which the background paints over.
 *
 * `dprCap` is the ceiling on the resolved DPR. Defaults to
 * `ARENA.maxDevicePixelRatio` so the pre-§9.D call sites keep their meaning;
 * the quality tier (low/medium/high) supplies the actual value at runtime.
 */
export function makeViewTransform(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  dprCap: number = ARENA.maxDevicePixelRatio,
): ViewTransform {
  const cssW = cssWidth > 0 ? cssWidth : 1;
  const cssH = cssHeight > 0 ? cssHeight : 1;
  const cap = dprCap > 0 ? dprCap : ARENA.maxDevicePixelRatio;
  const dpr = Math.max(1, Math.min(cap, devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(cssW * dpr));
  const pixelHeight = Math.max(1, Math.round(cssH * dpr));

  const { halfWidth, halfHeight } = arenaExtents(cssW, cssH);
  const worldWidth = halfWidth * 2;
  const worldHeight = halfHeight * 2;
  const scale = Math.min(pixelWidth / worldWidth, pixelHeight / worldHeight);

  return {
    dpr,
    cssWidth: cssW,
    cssHeight: cssH,
    pixelWidth,
    pixelHeight,
    worldWidth,
    worldHeight,
    scale,
    offsetX: pixelWidth / 2 - (worldWidth / 2) * scale,
    offsetY: pixelHeight / 2 - (worldHeight / 2) * scale,
  };
}

/** World point → CSS pixel, relative to the canvas element's top-left corner. */
export function worldToScreen(
  t: ViewTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (x * t.scale + t.offsetX) / t.dpr,
    y: (y * t.scale + t.offsetY) / t.dpr,
  };
}

/** CSS pixel relative to the canvas element's top-left corner → world point. */
export function screenToWorld(
  t: ViewTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (x * t.dpr - t.offsetX) / t.scale,
    y: (y * t.dpr - t.offsetY) / t.scale,
  };
}

/** What `Game` is told when the viewport changed shape. */
export interface CameraResize {
  worldWidth: number;
  worldHeight: number;
  /** The world rectangle before this resize, so live entities can be rescaled. */
  previousWorldWidth: number;
  previousWorldHeight: number;
}

/** Seconds a shake decays over, and the ceiling on its amplitude in world units. */
const SHAKE_DECAY = 0.42;
const SHAKE_MAX_WORLD = 46;
/** Ceiling on the zoom punch: 3% for at most 180 ms (UI plan §1.3). */
const PUNCH_MAX = 0.03;
const PUNCH_DURATION = 0.18;

export class Camera {
  private readonly canvas: HTMLCanvasElement;
  private host: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  /**
   * The current `devicePixelRatio` cap, fed by the quality tier (UI plan §9.D).
   * `high` keeps the historic `ARENA.maxDevicePixelRatio` ceiling; `low` drops
   * to 1.0 because on a 3x phone buffer a low-quality fill is still a 2.25x
   * fill-rate tax over 1x. The value is recomputed into a transform only when
   * it actually changes, so a no-op setter is a no-op.
   */
  private dprCap: number = ARENA.maxDevicePixelRatio;
  private view: ViewTransform;
  private shakeAmount = 0;
  private shakeTime = 0;
  private shakeX = 0;
  private shakeY = 0;
  private punchTime = 0;
  private reducedMotion = false;

  /** Fired after the backing store has been resized and the transform rebuilt. */
  onResize: ((info: CameraResize) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.view = makeViewTransform(
      canvas.clientWidth || canvas.width,
      canvas.clientHeight || canvas.height,
      globalThis.devicePixelRatio ?? 1,
    );
    this.applyBackingSize();
    this.reducedMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.bindResize();
  }

  /**
   * The element whose CSS box defines the viewport.
   *
   * Defaults to the canvas itself, which is stretched to fill `.canvas-wrap`;
   * `Game.setCanvasWrap` hands over the wrap once `main.ts` has found it, so a
   * future layout that pads or insets the canvas still measures the right box.
   */
  setHost(el: HTMLElement | null): void {
    this.host = el;
    this.bindResize();
    this.measure();
  }

  get transform(): ViewTransform {
    return this.view;
  }

  get worldWidth(): number {
    return this.view.worldWidth;
  }

  get worldHeight(): number {
    return this.view.worldHeight;
  }

  /** Backing-store size, for screen-space passes that need to fill it. */
  get cssWidth(): number {
    return this.view.cssWidth;
  }

  get cssHeight(): number {
    return this.view.cssHeight;
  }

  /**
   * Half-extents of what is actually *visible*, in world units.
   *
   * Equal to the world rectangle's half-extents inside the aspect clamp, and
   * larger than them outside it. Anything that must stay on screen — the
   * spawn-lane arrows, the background bake — measures against these.
   */
  get viewHalfWidth(): number {
    return this.view.pixelWidth / (2 * this.view.scale);
  }

  get viewHalfHeight(): number {
    return this.view.pixelHeight / (2 * this.view.scale);
  }

  /**
   * World space: one unit is one world unit, the tower is at the centre of the
   * world rectangle, and the camera shake lives here rather than on the DOM.
   */
  applyWorld(ctx: CanvasRenderingContext2D): void {
    const t = this.view;
    const zoom = 1 + this.punchScale();
    const s = t.scale * zoom;
    // The punch scales about the centre of the backing store, so a zoom punch
    // during a boss death does not slide the arena sideways.
    const cx = t.pixelWidth / 2;
    const cy = t.pixelHeight / 2;
    const ox = cx + (t.offsetX - cx) * zoom + this.shakeX * s;
    const oy = cy + (t.offsetY - cy) * zoom + this.shakeY * s;
    ctx.setTransform(s, 0, 0, s, ox, oy);
  }

  /**
   * Screen space: one unit is one CSS pixel, origin at the canvas's top-left.
   *
   * The wave banner, the boss-death flash and the low-HP vignette draw here.
   * They used to draw in what was then both spaces at once, and the vignette
   * was a CSS `box-shadow` on `.canvas-wrap` — which also meant the shake
   * animation jiggled every DOM overlay pinned to the same element.
   */
  applyScreen(ctx: CanvasRenderingContext2D): void {
    const dpr = this.view.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Identity: one unit is one backing-store pixel. Used to blit the background. */
  applyDevice(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return worldToScreen(this.view, x, y);
  }

  screenToWorld(x: number, y: number): { x: number; y: number } {
    return screenToWorld(this.view, x, y);
  }

  /**
   * Shake the camera. Replaces the `.canvas-wrap.is-shaking` CSS animation.
   *
   * `strength` is in world units at full amplitude; it decays to nothing over
   * `SHAKE_DECAY` seconds. A stronger shake arriving mid-decay wins rather
   * than stacking, so a boss pack cannot rattle the screen off its hinges.
   */
  shake(strength = 14): void {
    if (this.reducedMotion) return;
    const amount = Math.min(SHAKE_MAX_WORLD, Math.max(0, strength));
    if (amount <= this.shakeAmount * (this.shakeTime / SHAKE_DECAY)) return;
    this.shakeAmount = amount;
    this.shakeTime = SHAKE_DECAY;
  }

  /** A short punch-in for boss death and enrage. */
  zoomPunch(): void {
    if (this.reducedMotion) return;
    this.punchTime = PUNCH_DURATION;
  }

  /**
   * Advance the shake and the punch.
   *
   * On the **wall clock**, not the simulation clock: a screen shake that ran
   * six times faster at 6.5x game speed would be a flicker, and one that ran
   * during a slow-mo boss death would outlast the death itself.
   */
  update(realDt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - realDt);
      const falloff = this.shakeTime / SHAKE_DECAY;
      const amp = this.shakeAmount * falloff * falloff;
      this.shakeX = (Math.random() * 2 - 1) * amp;
      this.shakeY = (Math.random() * 2 - 1) * amp;
      if (this.shakeTime === 0) {
        this.shakeAmount = 0;
        this.shakeX = 0;
        this.shakeY = 0;
      }
    }
    if (this.punchTime > 0) this.punchTime = Math.max(0, this.punchTime - realDt);
  }

  /**
   * Re-read the CSS box and rebuild the transform.
   *
   * Emits `onResize` only when the world rectangle actually changed shape —
   * a device-pixel-only change (dragging a window between two monitors at the
   * same size) still resizes the backing store, but nothing in the simulation
   * needs to hear about it.
   */
  measure(): void {
    const box = this.host ?? this.canvas;
    const rect = box.getBoundingClientRect();
    const cssWidth = rect.width || box.clientWidth || this.view.cssWidth;
    const cssHeight = rect.height || box.clientHeight || this.view.cssHeight;
    const previous = this.view;
    const next = makeViewTransform(
      cssWidth,
      cssHeight,
      globalThis.devicePixelRatio ?? 1,
      this.dprCap,
    );
    if (
      next.pixelWidth === previous.pixelWidth
      && next.pixelHeight === previous.pixelHeight
      && next.worldWidth === previous.worldWidth
      && next.worldHeight === previous.worldHeight
    ) return;

    this.view = next;
    this.applyBackingSize();
    if (
      next.worldWidth !== previous.worldWidth
      || next.worldHeight !== previous.worldHeight
    ) {
      this.onResize?.({
        worldWidth: next.worldWidth,
        worldHeight: next.worldHeight,
        previousWorldWidth: previous.worldWidth,
        previousWorldHeight: previous.worldHeight,
      });
    } else {
      // Same world, new buffer: the caller still has to rebake anything keyed
      // on backing-store size (the renderer's background).
      this.onResize?.({
        worldWidth: next.worldWidth,
        worldHeight: next.worldHeight,
        previousWorldWidth: next.worldWidth,
        previousWorldHeight: previous.worldHeight,
      });
    }
  }

  /**
   * The cap on `devicePixelRatio` (UI plan §9.D).
   *
   * `low` caps at 1.0 because a 3x phone buffer is a 2.25x fill-rate tax over
   * 1x for no visible gain; `medium` keeps 1.5; `high` keeps the historic 2.0.
   *
   * **The crucial property: a DPR change leaves the world rectangle
   * untouched.** The Camera's resize handler rescales live enemy positions
   * when the world extents move, so a mid-wave resize does not teleport
   * anything out of bounds. A DPR change must not run that path — it would
   * shift every enemy by a factor of 1, which is harmless, but it would also
   * be the kind of code that breaks the moment someone tightens the
   * `sx !== 1` guard into a no-op for symmetry. The current
   * `onCameraResize` already short-circuits on `sx === sy === 1`, but the
   * test pinned by §10.C covers it so the next refactor cannot quietly
   * regress.
   */
  setDprCap(cap: number): void {
    if (!(cap > 0)) return;
    if (cap === this.dprCap) return;
    this.dprCap = cap;
    this.measure();
  }

  /** The current DPR cap, for diagnostics. */
  get currentDprCap(): number {
    return this.dprCap;
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    globalThis.removeEventListener?.('resize', this.onWindowResize);
    globalThis.removeEventListener?.('orientationchange', this.onWindowResize);
  }

  private punchScale(): number {
    if (this.punchTime <= 0) return 0;
    // Ease out: hardest at the moment it fires, gone by the end.
    const t = this.punchTime / PUNCH_DURATION;
    return PUNCH_MAX * t * t;
  }

  private applyBackingSize(): void {
    if (this.canvas.width !== this.view.pixelWidth) this.canvas.width = this.view.pixelWidth;
    if (this.canvas.height !== this.view.pixelHeight) this.canvas.height = this.view.pixelHeight;
  }

  private readonly onWindowResize = (): void => {
    this.measure();
  };

  private bindResize(): void {
    this.observer?.disconnect();
    const target = this.host ?? this.canvas;
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(target);
    }
    // `orientationchange` fires before the layout settles on some mobile
    // browsers, and `ResizeObserver` is not guaranteed to see a rotation that
    // keeps the element's box the same size but changes `devicePixelRatio`.
    // Both listeners are idempotent — `measure` is a no-op when nothing moved.
    globalThis.addEventListener?.('resize', this.onWindowResize);
    globalThis.addEventListener?.('orientationchange', this.onWindowResize);
  }
}
