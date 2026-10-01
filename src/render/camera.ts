import { ARENA, VIEW_HALF_HEIGHT, VIEW_HALF_WIDTH } from '../content/arena';

/**
 * The camera: backing-store size, the transforms every draw pass runs under,
 * and world ↔ pointer conversions. Ported from the legacy `Camera.ts`.
 *
 * The one change from the legacy camera: the world no longer depends on the
 * viewport. The arena is a constant (`content/arena.ts`), and the camera fits
 * its view rectangle into whatever CSS box it gets — `min`, never `max`, so
 * nothing in the arena is ever cropped. Surplus shows as extra floor.
 */

/** Everything needed to place world coordinates on the backing store. */
export interface ViewTransform {
  /** Capped `devicePixelRatio`. Backing-store pixels per CSS pixel. */
  dpr: number;
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  /** Backing-store pixels per world unit. */
  scale: number;
  /** Backing-store pixel the world origin (the tower) lands on. */
  offsetX: number;
  offsetY: number;
}

/** Derive the whole transform from a CSS box and a device pixel ratio. Pure. */
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
  const scale = Math.min(pixelWidth / (VIEW_HALF_WIDTH * 2), pixelHeight / (VIEW_HALF_HEIGHT * 2));
  return {
    dpr,
    cssWidth: cssW,
    cssHeight: cssH,
    pixelWidth,
    pixelHeight,
    scale,
    offsetX: pixelWidth / 2,
    offsetY: pixelHeight / 2,
  };
}

/** World point → CSS pixel, relative to the canvas element's top-left corner. */
export function worldToScreen(t: ViewTransform, x: number, y: number): { x: number; y: number } {
  return {
    x: (x * t.scale + t.offsetX) / t.dpr,
    y: (y * t.scale + t.offsetY) / t.dpr,
  };
}

/** CSS pixel relative to the canvas element's top-left corner → world point. */
export function screenToWorld(t: ViewTransform, x: number, y: number): { x: number; y: number } {
  return {
    x: (x * t.dpr - t.offsetX) / t.scale,
    y: (y * t.dpr - t.offsetY) / t.scale,
  };
}

/** Seconds a shake decays over, and the ceiling on its amplitude in world units. */
const SHAKE_DECAY = 0.42;
const SHAKE_MAX_WORLD = 30;
/** Ceiling on the zoom punch: 3% for at most 180 ms. */
const PUNCH_MAX = 0.03;
const PUNCH_DURATION = 0.18;

export class Camera {
  private readonly canvas: HTMLCanvasElement;
  private host: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private dprCap: number = ARENA.maxDevicePixelRatio;
  private view: ViewTransform;
  private shakeAmount = 0;
  private shakeTime = 0;
  private shakeX = 0;
  private shakeY = 0;
  private punchTime = 0;
  /** Reduced motion (the OS setting, or the player's): no shake, no punch. */
  private reducedMotion: boolean;
  /** The settings' screen-shake switch (§10.3); the punch is not a shake. */
  private shakeOn = true;

  /** Fired after the backing store has been resized. Anything baked at buffer size rebakes. */
  onResize: ((view: ViewTransform) => void) | null = null;

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

  /** The element whose CSS box defines the viewport. Defaults to the canvas. */
  setHost(el: HTMLElement | null): void {
    this.host = el;
    this.bindResize();
    this.measure();
  }

  get transform(): ViewTransform {
    return this.view;
  }

  /** Half-extents of what is actually visible, in world units. */
  get viewHalfWidth(): number {
    return this.view.pixelWidth / (2 * this.view.scale);
  }

  get viewHalfHeight(): number {
    return this.view.pixelHeight / (2 * this.view.scale);
  }

  /** World space: the tower at the centre, shake and punch applied. */
  applyWorld(ctx: CanvasRenderingContext2D): void {
    const t = this.view;
    const s = t.scale * (1 + this.punchScale());
    ctx.setTransform(s, 0, 0, s, t.offsetX + this.shakeX * s, t.offsetY + this.shakeY * s);
  }

  /** Screen space: one unit is one CSS pixel, origin at the canvas's top-left. */
  applyScreen(ctx: CanvasRenderingContext2D): void {
    const dpr = this.view.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Identity: one unit is one backing-store pixel. */
  applyDevice(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return worldToScreen(this.view, x, y);
  }

  screenToWorld(x: number, y: number): { x: number; y: number } {
    return screenToWorld(this.view, x, y);
  }

  /** Shake in world units. A stronger shake mid-decay wins rather than stacking. */
  shake(strength = 10): void {
    if (this.reducedMotion || !this.shakeOn) return;
    const amount = Math.min(SHAKE_MAX_WORLD, Math.max(0, strength));
    if (amount <= this.shakeAmount * (this.shakeTime / SHAKE_DECAY)) return;
    this.shakeAmount = amount;
    this.shakeTime = SHAKE_DECAY;
  }

  /** The player's motion settings, applied from the next shake on. */
  setMotion(reduced: boolean, shake: boolean): void {
    this.reducedMotion = reduced;
    this.shakeOn = shake;
    if (reduced || !shake) {
      this.shakeTime = 0;
      this.shakeAmount = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
    if (reduced) this.punchTime = 0;
  }

  zoomPunch(): void {
    if (this.reducedMotion) return;
    this.punchTime = PUNCH_DURATION;
  }

  /**
   * Advance shake and punch on the **wall clock**: a shake that ran 3× faster
   * at 3× speed would be a flicker. Presentation only, so `Math.random` is fine.
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

  /** Re-read the CSS box and rebuild the transform. No-op when nothing moved. */
  measure(): void {
    const box = this.host ?? this.canvas;
    const rect = box.getBoundingClientRect();
    const next = makeViewTransform(
      rect.width || box.clientWidth || this.view.cssWidth,
      rect.height || box.clientHeight || this.view.cssHeight,
      globalThis.devicePixelRatio ?? 1,
      this.dprCap,
    );
    const prev = this.view;
    if (
      next.pixelWidth === prev.pixelWidth
      && next.pixelHeight === prev.pixelHeight
      && next.scale === prev.scale
    ) return;
    this.view = next;
    this.applyBackingSize();
    this.onResize?.(next);
  }

  /** The `devicePixelRatio` ceiling, fed by the quality tier. */
  setDprCap(cap: number): void {
    if (!(cap > 0) || cap === this.dprCap) return;
    this.dprCap = cap;
    this.measure();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    globalThis.removeEventListener?.('resize', this.onWindowResize);
    globalThis.removeEventListener?.('orientationchange', this.onWindowResize);
  }

  private punchScale(): number {
    if (this.punchTime <= 0) return 0;
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
    // `orientationchange` can fire before layout settles, and a DPR-only
    // change may not reach the observer. `measure` is idempotent.
    globalThis.addEventListener?.('resize', this.onWindowResize);
    globalThis.addEventListener?.('orientationchange', this.onWindowResize);
  }
}
