import { ARENA, PHONE_OVAL, ovalOf, rimAxes, type Oval } from '../content/arena';

/**
 * The camera: backing-store size, the transforms every draw pass runs under,
 * and world ↔ pointer conversions. Ported from the legacy `Camera.ts`.
 *
 * The camera holds one value, its **extent** (plans/camera-and-fog.md §5):
 * how much world shows from the tower to the screen's short edge. Fully
 * out (`fitExtent`), the light's rim runs close to the stage's edges: near
 * the sides on the short axis, level with the HP bar on the long one, as
 * `rimBox` lays out. The camera follows the light as it grows.
 * The player may frame closer, down to `ZOOM.close`; that framing holds while
 * the light changes underneath, clamped only if the light shrinks inside it.
 * Always centred on the tower: no panning.
 */

/** Manual zoom's limits and feel. */
export const ZOOM = {
  /** The closest framing, in world units from the tower to the short edge. */
  close: 270,
  /** A framing within this share of the fit counts as fully out, and follows again. */
  snap: 0.93,
  /** Easing rate toward a new extent, per second (exponential). */
  ease: 7,
} as const;

/**
 * Where the light's rim sits on the stage when fully out, as half-sizes in
 * CSS px: on the short axis just inside the edges (the old arena's 1.08
 * margin), on the long axis level with the HP bar, top and bottom alike.
 */
export const RIM = {
  /** The rim's share of the stage's short half-size. */
  sideShare: 0.926,
  /** CSS px from each end of the long axis: the HP bar's middle. */
  endInset: 70,
} as const;

export function rimBox(cssWidth: number, cssHeight: number): { hw: number; hh: number } {
  const w = Math.max(1, cssWidth) / 2;
  const h = Math.max(1, cssHeight) / 2;
  if (h >= w) return { hw: w * RIM.sideShare, hh: Math.max(w * RIM.sideShare, h - RIM.endInset) };
  return { hw: Math.max(h * RIM.sideShare, w - RIM.endInset), hh: h * RIM.sideShare };
}

/** The light's shape for a stage: the rim box's own (a run takes it once, at its start). */
export function stageOval(cssWidth: number, cssHeight: number): Oval {
  const { hw, hh } = rimBox(cssWidth, cssHeight);
  return ovalOf(Math.max(hw, hh) / Math.min(hw, hh), hh >= hw);
}

/** The extent at which a light `light` of shape `oval` fills the rim box of a stage. */
export function fitExtent(light: number, oval: Oval, cssWidth: number, cssHeight: number): number {
  const { hw, hh } = rimBox(cssWidth, cssHeight);
  const rim = rimAxes(light, oval);
  const k = Math.min(hw / rim.x, hh / rim.y);
  return Math.min(Math.max(1, cssWidth), Math.max(1, cssHeight)) / 2 / k;
}

/** Everything needed to place world coordinates on the backing store. */
export interface ViewTransform {
  /** Capped `devicePixelRatio`. Backing-store pixels per CSS pixel. */
  dpr: number;
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  /** World units from the tower to the short edge of the screen. */
  extent: number;
  /** Backing-store pixels per world unit. */
  scale: number;
  /** Backing-store pixel the world origin (the tower) lands on. */
  offsetX: number;
  offsetY: number;
}

/** Derive the whole transform from a CSS box, a device pixel ratio and an extent. Pure. */
export function makeViewTransform(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  dprCap: number = ARENA.maxDevicePixelRatio,
  extent?: number,
): ViewTransform {
  const cssW = cssWidth > 0 ? cssWidth : 1;
  const cssH = cssHeight > 0 ? cssHeight : 1;
  const cap = dprCap > 0 ? dprCap : ARENA.maxDevicePixelRatio;
  const dpr = Math.max(1, Math.min(cap, devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(cssW * dpr));
  const pixelHeight = Math.max(1, Math.round(cssH * dpr));
  const e = extent !== undefined && extent > 0 ? extent : fitExtent(ARENA.lightBase, PHONE_OVAL, cssW, cssH);
  const scale = Math.min(pixelWidth, pixelHeight) / (2 * e);
  return {
    dpr,
    cssWidth: cssW,
    cssHeight: cssH,
    pixelWidth,
    pixelHeight,
    extent: e,
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
  /** The extent that shows the whole light: where "fully out" is. */
  private fit: number;
  /** The player's framing, in world units; null follows the light. */
  private framing: number | null = null;
  /** False on screens with no run (the hub): the framing waits for the next run. */
  private framingOn = false;

  /** Fired after the backing store has been resized. */
  onResize: ((view: ViewTransform) => void) | null = null;
  /** Fired when the player changes the framing (null: back to following the light). */
  onFraming: ((framing: number | null) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.view = makeViewTransform(
      canvas.clientWidth || canvas.width,
      canvas.clientHeight || canvas.height,
      globalThis.devicePixelRatio ?? 1,
    );
    this.fit = this.view.extent;
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

  /** The player's framing, or null while the camera follows the light. */
  get userFraming(): number | null {
    return this.framing;
  }

  /** True while the view is closer than fully out. */
  get zoomedIn(): boolean {
    return this.view.extent < this.fit * ZOOM.snap;
  }

  /** True while the framing sits at the close limit: nothing nearer to zoom to. */
  get atClose(): boolean {
    return this.framingOn && this.framing !== null && Math.min(this.framing, this.fit) <= ZOOM.close + 0.5;
  }

  /** How far in the view is from fully out: 1 at the fit, 2 at half the extent. */
  get zoom(): number {
    return this.fit / this.view.extent;
  }

  /**
   * The light this frame (the run's `stats.light` and `arena`), and whether
   * the player's framing applies. Called every frame; cheap.
   */
  setLight(light: number, oval: Oval, framingOn: boolean): void {
    this.fit = fitExtent(light, oval, this.view.cssWidth, this.view.cssHeight);
    this.framingOn = framingOn;
  }

  /** Restore a saved framing (settings), without firing `onFraming`. */
  setFraming(framing: number | null): void {
    this.framing = framing !== null && framing > 0 ? Math.max(ZOOM.close, framing) : null;
  }

  /**
   * Zoom by `factor` (>1 in, <1 out) from where the view is now. `gesture`
   * for a pinch or the wheel: it tracks the fingers at once and doesn't
   * snap, since a pinch arrives as many small steps that would each land
   * inside the snap; `settle` snaps when the gesture ends. A button press
   * eases, and snaps at once.
   */
  zoomBy(factor: number, gesture = false): void {
    if (!(factor > 0)) return;
    const from = this.framing !== null ? Math.min(this.framing, this.fit) : this.fit;
    const next = Math.min(this.fit, Math.max(ZOOM.close, from / factor));
    this.framing = next >= this.fit ? null : next;
    if (gesture) this.setExtent(this.target());
    else this.settle();
    this.onFraming?.(this.framing);
  }

  /** A gesture ended: within the snap of fully out, follow the light again. */
  settle(): void {
    if (this.framing === null || this.framing < this.fit * ZOOM.snap) return;
    this.framing = null;
    this.onFraming?.(null);
  }

  /** Back to fully out, following the light. */
  fitView(): void {
    if (this.framing === null) return;
    this.framing = null;
    this.onFraming?.(null);
  }

  /** Where the extent is heading: the framing, never past the fit; the fit on a screen without a run. */
  private target(): number {
    if (!this.framingOn || this.framing === null) return this.fit;
    return Math.min(this.framing, this.fit);
  }

  private setExtent(extent: number): void {
    if (extent === this.view.extent) return;
    const t = this.view;
    this.view = makeViewTransform(t.cssWidth, t.cssHeight, t.dpr, this.dprCap, extent);
  }

  /**
   * World space: the tower at the centre, shake and punch applied. Shake is
   * in world units, so it is divided by the zoom: a close-up doesn't shake harder.
   */
  applyWorld(ctx: CanvasRenderingContext2D): void {
    const t = this.view;
    const s = t.scale * (1 + this.punchScale());
    const k = s / this.zoom;
    ctx.setTransform(s, 0, 0, s, t.offsetX + this.shakeX * k, t.offsetY + this.shakeY * k);
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
    // Ease toward the framing (or the light, fully out); reduced motion jumps.
    const target = this.target();
    const cur = this.view.extent;
    if (cur !== target) {
      const k = this.reducedMotion ? 1 : 1 - Math.exp(-ZOOM.ease * Math.max(0, realDt));
      const next = cur + (target - cur) * k;
      this.setExtent(Math.abs(target - next) < 0.5 ? target : next);
    }
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
      this.view.extent,
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
