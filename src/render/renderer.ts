import type { RunState } from '../sim/state';
import { Camera } from './camera';
import { bakeArena } from './painters/arena';
import { paintTower } from './painters/tower';
import { QUALITY, type QualityTier } from './quality';

/**
 * The renderer (§12.3). Reads a `RunState`, never writes it. Everything it
 * owns is presentation: baked backgrounds, per-painter caches, effects.
 */
export class Renderer {
  readonly camera: Camera;
  private readonly ctx: CanvasRenderingContext2D;
  private background: HTMLCanvasElement | null = null;
  private tier: QualityTier = 'high';
  private clock = 0;

  constructor(canvas: HTMLCanvasElement, host: HTMLElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.camera = new Camera(canvas);
    this.camera.onResize = () => { this.background = null; };
    this.camera.setHost(host);
  }

  setQuality(tier: QualityTier): void {
    this.tier = tier;
    this.camera.setDprCap(QUALITY[tier].dprCap);
  }

  get quality(): QualityTier {
    return this.tier;
  }

  /**
   * Draw one frame. `run` is null on screens with no live run (the hub), where
   * the arena still shows as a backdrop.
   */
  render(run: RunState | null, _alpha: number, realDt: number): void {
    const ctx = this.ctx;
    this.clock += realDt;
    this.camera.update(realDt);
    const view = this.camera.transform;

    if (!this.background) this.background = bakeArena(view.pixelWidth, view.pixelHeight, view.scale);
    this.camera.applyDevice(ctx);
    ctx.drawImage(this.background, 0, 0);

    this.camera.applyWorld(ctx);
    paintTower(ctx, this.clock, 0);
    void run;
  }
}
