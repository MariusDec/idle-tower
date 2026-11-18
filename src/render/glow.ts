import { context2dOptions } from './canvasMode';
import { withAlpha } from './palette';

/**
 * Glows baked once and stamped many times (plans/android-gpu-crash.md).
 *
 * A `createRadialGradient` per glow per frame hands the GPU a new gradient
 * each time; a late-game arena with a dozen fires, pools and meteors makes
 * hundreds a second, and that churn is a known way into driver edge cases.
 * Like the enemy sprites (`enemies.ts`, `bake`), a glow is painted once into
 * a small canvas and then drawn as a textured quad: `drawImage` with a
 * `globalAlpha`, the cheapest thing a 2D canvas can ask of a GPU.
 *
 * Every stop is baked at its full alpha; a painter that fades a glow
 * uniformly (a fire burning out, a pool cooling) passes the fade as `alpha`.
 */

/** One colour stop: `at` in [0, 1] of the radius, `color` any CSS colour. */
export interface GlowStop {
  at: number;
  color: string;
}

/**
 * Pixels across a baked glow. A smooth radial ramp scales up cleanly under
 * bilinear filtering, so this stays small even for a fire drawn 300 px wide.
 */
const GLOW_PX = 128;

const glows = new Map<string, HTMLCanvasElement>();
const strips = new Map<string, HTMLCanvasElement>();

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d', context2dOptions())! };
}

/** A radial glow's sprite; `inner` is where the ramp starts, as a share of the radius. */
function glowSprite(stops: readonly GlowStop[], inner: number): HTMLCanvasElement {
  let key = `${inner}`;
  for (const s of stops) key += `|${s.at}:${s.color}`;
  let sprite = glows.get(key);
  if (!sprite) {
    const { c, g } = canvas(GLOW_PX, GLOW_PX);
    const h = GLOW_PX / 2;
    const grad = g.createRadialGradient(h, h, h * inner, h, h, h);
    for (const s of stops) grad.addColorStop(s.at, s.color);
    g.fillStyle = grad;
    // Clipped to the disc, as the arc fills it replaces were.
    g.beginPath();
    g.arc(h, h, h, 0, Math.PI * 2);
    g.fill();
    sprite = c;
    glows.set(key, sprite);
  }
  return sprite;
}

/** Stamp a radial glow of radius `r` at (x, y), faded by `alpha`. */
export function drawGlow(
  ctx: CanvasRenderingContext2D, stops: readonly GlowStop[], x: number, y: number, r: number, alpha = 1, inner = 0,
): void {
  if (!(r > 0) || alpha <= 0) return;
  const sprite = glowSprite(stops, inner);
  const was = ctx.globalAlpha;
  ctx.globalAlpha = was * Math.min(1, alpha);
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = was;
}

/**
 * A straight streak fading from clear at its tail to `color` at `head`
 * alpha, `width` thick: a meteor's burning tail. Drawn along (x0, y0) → (x1, y1).
 */
export function drawStreak(
  ctx: CanvasRenderingContext2D, color: string, head: number, x0: number, y0: number, x1: number, y1: number, width: number,
): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 0.5) return;
  const key = `${color}|${head}`;
  let sprite = strips.get(key);
  if (!sprite) {
    const { c, g } = canvas(64, 4);
    const grad = g.createLinearGradient(0, 0, 64, 0);
    grad.addColorStop(0, withAlpha(color, 0));
    grad.addColorStop(1, withAlpha(color, head));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 4);
    sprite = c;
    strips.set(key, sprite);
  }
  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
  ctx.drawImage(sprite, -len, -width / 2, len, width);
  ctx.restore();
}

/**
 * Gradients whose geometry never changes in their painter's local space (the
 * tower's stone, a boss's body), made once per key and reused every frame.
 * The key must name everything the gradient depends on: its size and colours.
 */
const gradients = new Map<string, CanvasGradient>();

export function cachedGradient(key: string, make: () => CanvasGradient): CanvasGradient {
  let g = gradients.get(key);
  if (!g) {
    // A palette switch or a resize makes new keys; the old ones are not drawn again.
    if (gradients.size > 256) gradients.clear();
    g = make();
    gradients.set(key, g);
  }
  return g;
}

/**
 * Forget every baked glow and gradient: after the palette changes, or after
 * the GPU context was lost and restored, when a baked canvas may come back
 * blank. They rebake on their next draw.
 */
export function clearGlows(): void {
  glows.clear();
  strips.clear();
  gradients.clear();
}
