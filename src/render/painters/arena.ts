import { ARENA, rimAxes, type Oval } from '../../content/arena';
import { ACCENT, GROUND, INK, mix, withAlpha } from '../palette';

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

/** How far past its opaque edge the dark stays opaque, as a multiple of that edge. */
const DARK_HOLD = 1.08;
/** Where the dark has thinned into the sky, as a multiple of its opaque edge. */
const DARK_FADE = 1.6;

/** A gradient keeps its stops; rebuild it only when what it shows changes. */
interface Memo {
  key: string;
  gradient: CanvasGradient;
}
let groundMemo: Memo | null = null;
let darkMemo: Memo | null = null;
let skyMemo: Memo | null = null;

/**
 * Past the dark, the sky (plans/visual-identity.md §7.3): the page's own
 * ground, Blue hour's three stops and the region's last light at 135°, dimmed
 * by `dim` toward the ink so the light stays the brightest thing on screen.
 * Drawn first, under the identity transform, over the whole backing store:
 * the same one fill the flat clear was, and memoised on what it shows.
 */
export function paintSky(ctx: CanvasRenderingContext2D, width: number, height: number, horizon: string, dim: number): void {
  const key = `${width}|${height}|${horizon}|${dim}`;
  if (!skyMemo || skyMemo.key !== key) {
    // CSS's `135deg`: top-left to bottom-right, the line long enough that the corners sit on the end stops.
    const half = (width + height) / 4;
    const cx = width / 2;
    const cy = height / 2;
    const g = ctx.createLinearGradient(cx - half, cy - half, cx + half, cy + half);
    const sky = (c: string): string => mix(c, INK['950'], dim);
    g.addColorStop(0, sky(GROUND.stop1));
    g.addColorStop(0.34, sky(GROUND.stop2));
    g.addColorStop(0.66, sky(GROUND.stop3));
    g.addColorStop(1, sky(horizon));
    skyMemo = { key, gradient: g };
  }
  ctx.fillStyle = skyMemo.gradient;
  ctx.fillRect(0, 0, width, height);
}

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
 * It holds opaque a little past that, over anything a knockback pushed out,
 * then thins into the sky (`paintSky`), so the dark presses in round the
 * light and the sky shows beyond it without a seam.
 */
export function paintDark(ctx: CanvasRenderingContext2D, light: number, oval: Oval, box: WorldBox, palette: string, alpha = 1): void {
  const blur = light * (ARENA.darkScale - 1);
  const inner = Math.max(1, light - blur * 0.4);
  const outer = light * ARENA.darkScale;
  const key = `${light}|${palette}`;
  if (!darkMemo || darkMemo.key !== key) {
    const far = outer * DARK_FADE;
    const at = (r: number): number => (r - inner) / (far - inner);
    const g = ctx.createRadialGradient(0, 0, inner, 0, 0, far);
    const dark = INK['950'];
    g.addColorStop(0, withAlpha(dark, 0));
    g.addColorStop(at((inner + outer) / 2), withAlpha(dark, 0.55));
    g.addColorStop(at(outer), dark);
    g.addColorStop(at(outer * DARK_HOLD), dark);
    g.addColorStop(1, withAlpha(dark, 0));
    darkMemo = { key, gradient: g };
  }
  const { kx, ky } = stretch(light, oval);
  const { w, h } = stretchedBox(box, kx, ky);
  // A close-up that sees nothing past the rim draws none of it.
  if (w * w + h * h <= inner * inner) return;
  ctx.save();
  // Sunrise (plans/late-game/07 §4) draws the dark back: render only, the light is the sim's.
  if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.scale(kx, ky);
  ctx.fillStyle = darkMemo.gradient;
  ctx.beginPath();
  ctx.rect(-w, -h, w * 2, h * 2);
  ctx.arc(0, 0, inner, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.restore();
}

/**
 * The rim of the light, where the Blight begins: a thin line of the
 * identity's violet (`--accent`) with a soft glow either side, the violet
 * holding back the dark. Its widths are CSS pixels (`px` world units each).
 * A stratum of the Abyss wears its own colour (plans/late-game/08).
 */
export function paintRim(ctx: CanvasRenderingContext2D, light: number, oval: Oval, px: number, color: string = ACCENT): void {
  const rim = rimAxes(light, oval);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rim.x, rim.y, 0, 0, Math.PI * 2);
  for (const [width, alpha] of [[14, 0.035], [7, 0.07], [3, 0.14], [1.25, 0.42]] as const) {
    ctx.lineWidth = width * px;
    ctx.strokeStyle = withAlpha(color, alpha);
    ctx.stroke();
  }
  ctx.restore();
}

/** How wide a gate's arch is on the rim, radians (plans/late-game/08 §3.1). */
export const GATE_WIDTH = 0.4;

/**
 * The Gates (plans/late-game/08): a glowing arch on the rim at each angle,
 * `GATE_WIDTH` wide, in the stratum's rim colour. Angles are on the circle
 * the rim is stretched from, so an arch sits where its bodies walk in.
 */
export function paintGates(ctx: CanvasRenderingContext2D, light: number, oval: Oval, px: number, angles: readonly number[], color: string, time: number): void {
  if (angles.length === 0) return;
  const rim = rimAxes(light, oval);
  ctx.save();
  ctx.lineCap = 'round';
  const glow = 0.75 + 0.25 * Math.sin(time * 2.2);
  for (const a of angles) {
    ctx.beginPath();
    ctx.ellipse(0, 0, rim.x, rim.y, 0, a - GATE_WIDTH / 2, a + GATE_WIDTH / 2);
    for (const [width, alpha] of [[22, 0.08], [12, 0.18], [5, 0.45], [2, 0.95]] as const) {
      ctx.lineWidth = width * px;
      ctx.strokeStyle = withAlpha(color, alpha * glow);
      ctx.stroke();
    }
    // The arch's posts: two short ticks pointing in, so it reads as a doorway.
    for (const side of [-1, 1]) {
      const b = a + (side * GATE_WIDTH) / 2;
      const x = Math.cos(b);
      const y = Math.sin(b);
      ctx.beginPath();
      ctx.moveTo(x * rim.x, y * rim.y);
      ctx.lineTo(x * (rim.x - 18 * px * 4), y * (rim.y - 18 * px * 4));
      ctx.lineWidth = 3 * px;
      ctx.strokeStyle = withAlpha(color, 0.7 * glow);
      ctx.stroke();
    }
  }
  ctx.restore();
}
