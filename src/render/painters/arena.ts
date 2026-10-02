import { ARENA, rimAxes, type Oval } from '../../content/arena';
import { FX, INK, mix, withAlpha } from '../palette';

/**
 * The ground, the dark and the rim (plans/camera-and-fog.md §4), drawn live
 * in world units under the world transform: an oval of light of short
 * half-axis `L`, stretched by the run's `arena`. Each layer is one gradient
 * or one stroke, so nothing is baked and nothing rebuilds on a resize or a
 * zoom.
 *
 * The draw order does the fog's work: ground → bodies, shots, effects →
 * the dark → the rim. Bodies spawn just past the rim, under the dark, and
 * fade in through its soft edge as they walk in; the sim never knows what
 * is drawn.
 */

/** Visible half-extents in world units, with room for shake and the punch. */
export interface WorldBox {
  halfWidth: number;
  halfHeight: number;
}

/** World units a body walks in from where it spawned before it is fully drawn. */
const EMERGE = 60;

/**
 * How much of a body at (x, y) shows: 0 where bodies spawn, just past the
 * rim, rising to 1 once it has walked `EMERGE` in. With the dark's soft
 * edge over it, a body never pops in.
 */
export function emergence(x: number, y: number, light: number, oval: Oval): number {
  const rim = rimAxes(light, oval);
  const ax = rim.x * ARENA.spawnScale;
  const ay = rim.y * ARENA.spawnScale;
  const q = Math.hypot(x / ax, y / ay);
  return Math.min(1, Math.max(0, ((1 - q) * Math.min(ax, ay)) / EMERGE));
}

/** A gradient keeps its stops; rebuild it only when what it shows changes. */
interface Memo {
  key: string;
  gradient: CanvasGradient;
}
let groundMemo: Memo | null = null;
let darkMemo: Memo | null = null;

/** How the rim stretches a circle of radius `L` on each axis: the gradients are drawn as circles under it. */
function stretch(light: number, oval: Oval): { kx: number; ky: number } {
  const rim = rimAxes(light, oval);
  return { kx: rim.x / light, ky: rim.y / light };
}

/** The box, a little larger, in the stretched units (where the rim is a circle of radius `L`). */
function stretchedBox(box: WorldBox, kx: number, ky: number): { w: number; h: number } {
  return { w: (box.halfWidth * 1.15 + 40) / kx, h: (box.halfHeight * 1.15 + 40) / ky };
}

/**
 * The lit ground: a warm core fading to ink at the rim, washed by the
 * region's tint (§10.5), strongest at the core. `px` is world units per CSS
 * pixel, so the distance guides stay one pixel thin at any zoom.
 */
export function paintGround(
  ctx: CanvasRenderingContext2D, light: number, oval: Oval, tint: string | null, px: number, palette: string,
): void {
  const key = `${light}|${tint}|${palette}`;
  if (!groundMemo || groundMemo.key !== key) {
    const ground = (c: string, k: number): string => (tint ? mix(c, tint, k) : c);
    const g = ctx.createRadialGradient(0, 0, light * 0.05, 0, 0, light);
    g.addColorStop(0, ground(INK['600'], 0.45));
    g.addColorStop(0.55, ground(INK['700'], 0.35));
    g.addColorStop(1, ground(INK['800'], 0.25));
    groundMemo = { key, gradient: g };
  }
  const { kx, ky } = stretch(light, oval);
  ctx.save();
  ctx.scale(kx, ky);
  ctx.fillStyle = groundMemo.gradient;
  ctx.beginPath();
  ctx.arc(0, 0, light * ARENA.darkScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Faint concentric guides, the oval's shape, so distance reads at a glance.
  ctx.lineWidth = px;
  ctx.strokeStyle = withAlpha(INK['300'], 0.12);
  for (const f of [1 / 3, 2 / 3]) {
    ctx.beginPath();
    ctx.ellipse(0, 0, light * f * kx, light * f * ky, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * The dark past the rim, over the bodies out there: clear just inside the
 * rim, opaque at `darkScale` times it, so a body walking in comes out of it.
 */
export function paintDark(ctx: CanvasRenderingContext2D, light: number, oval: Oval, box: WorldBox, palette: string): void {
  const blur = light * (ARENA.darkScale - 1);
  const inner = Math.max(1, light - blur * 0.4);
  const outer = light * ARENA.darkScale;
  const key = `${light}|${palette}`;
  if (!darkMemo || darkMemo.key !== key) {
    const g = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
    const dark = INK['950'];
    g.addColorStop(0, withAlpha(dark, 0));
    g.addColorStop(0.5, withAlpha(dark, 0.55));
    g.addColorStop(1, dark);
    darkMemo = { key, gradient: g };
  }
  const { kx, ky } = stretch(light, oval);
  const { w, h } = stretchedBox(box, kx, ky);
  // A close-up that sees nothing past the rim draws none of it.
  if (w * w + h * h <= inner * inner) return;
  ctx.save();
  ctx.scale(kx, ky);
  ctx.fillStyle = darkMemo.gradient;
  ctx.beginPath();
  ctx.rect(-w, -h, w * 2, h * 2);
  ctx.arc(0, 0, inner, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.restore();
}

/**
 * The rim of the light, where the Blight begins: a thin violet line with a
 * soft glow either side, its widths in CSS pixels (`px` world units each).
 */
export function paintRim(ctx: CanvasRenderingContext2D, light: number, oval: Oval, px: number): void {
  const rim = rimAxes(light, oval);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rim.x, rim.y, 0, 0, Math.PI * 2);
  for (const [width, alpha] of [[14, 0.035], [7, 0.07], [3, 0.14], [1.25, 0.42]] as const) {
    ctx.lineWidth = width * px;
    ctx.strokeStyle = withAlpha(FX.arcane, alpha);
    ctx.stroke();
  }
  ctx.restore();
}
