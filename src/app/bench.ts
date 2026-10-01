import type { RunState } from '../sim/state';
import { runRegion, spawnEnemy } from '../sim/systems/waves';
import type { Renderer } from '../render/renderer';
import type { QualityTier } from '../render/quality';

/**
 * The frame-budget harness (§12.5), ported from the legacy `__theTower.bench`
 * (see docs/performance.md). Dev builds only: `await tower.bench({ ... })`
 * from the console, during a run.
 *
 * It keeps `enemies` bodies on the field (topped up each frame through the
 * sim's own `spawnEnemy`, in a spread of the region's types, so the sprite
 * cache and every painter work as a busy wave works them), keeps the tower
 * standing, and samples whole frames from a rAF riding alongside the loop.
 * The first 30 samples are dropped (JIT warm-up, the first bakes). It puts
 * the quality tier back when it is done; the run itself is spoiled, which
 * is why this is a dev tool.
 */
export interface BenchOptions {
  enemies?: number;
  seconds?: number;
  tier?: QualityTier;
}

export interface BenchResult {
  tier: QualityTier;
  frames: number;
  /** Milliseconds per frame. */
  p50: number;
  p95: number;
  worst: number;
  /** Milliseconds inside `Renderer.render` per frame: the headroom vsync hides. */
  drawP50: number;
  drawP95: number;
  enemies: number;
}

const WARMUP = 30;

export async function bench(run: RunState, renderer: Renderer, opts: BenchOptions = {}): Promise<BenchResult> {
  const target = opts.enemies ?? 250;
  const seconds = opts.seconds ?? 10;
  const before = renderer.quality;
  const tier = opts.tier ?? before;
  renderer.setQuality(tier);
  const region = runRegion(run);
  const types = region.pool.map((p) => p.enemy);
  const samples: number[] = [];
  const draws: number[] = [];
  // Time the renderer's own work: at 60 Hz the frame interval is clamped, so it hides the slack.
  const render = renderer.render;
  renderer.render = function (this: Renderer, ...args: Parameters<Renderer['render']>): void {
    const t0 = performance.now();
    render.apply(this, args);
    draws.push(performance.now() - t0);
  };
  let last = performance.now();
  const end = last + seconds * 1000;
  await new Promise<void>((done) => {
    const frame = (now: number): void => {
      samples.push(now - last);
      last = now;
      let alive = 0;
      for (const e of run.enemies) if (e.alive) alive++;
      for (let i = alive; i < target; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 380 + Math.random() * 520;
        spawnEnemy(run, region, types[i % types.length], Math.max(1, run.wave), Math.cos(a) * d, Math.sin(a) * d);
      }
      run.tower.hp = run.stats.maxHp;
      if (now < end) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  });
  renderer.render = render;
  renderer.setQuality(before);
  const kept = samples.slice(WARMUP).sort((x, y) => x - y);
  const drawn = draws.slice(WARMUP).sort((x, y) => x - y);
  const at = (xs: number[], q: number): number => Math.round(xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] * 10) / 10;
  return {
    tier, frames: kept.length, p50: at(kept, 0.5), p95: at(kept, 0.95), worst: at(kept, 1),
    drawP50: at(drawn, 0.5), drawP95: at(drawn, 0.95), enemies: target,
  };
}
