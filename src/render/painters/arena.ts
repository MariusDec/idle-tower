import { ARENA, rimAxes, rimPoint, rimRadius, type Oval, type Squareness } from '../../content/arena';
import { ACCENT, GROUND, INK, mix, toRgb, withAlpha } from '../palette';

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
 *
 * A squarer light (`oval.n > 2`, large screens: plans/large-screens.md §6.1)
 * can't be one stretched circle, so it takes another path: the ground is
 * the same gradient clipped to the shape, the rim and guides stroke a cached
 * path, and the dark is a small texture baked once per run in rim units and
 * stretched over the rim. `n === 2` keeps the live path above untouched.
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
  const q = rimRadius(x, y, ax, ay, oval.n);
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
  if (oval.n !== 2) {
    paintSquareGround(ctx, light, oval, kx, ky, px, groundMemo.gradient);
    return;
  }
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

/** Points on a superellipse's outline: enough that its curve never shows a facet at a rim's size. */
const RIM_POINTS = 192;
let rimMemo: { key: string; path: Path2D } | null = null;
let unitMemo: { n: Squareness; path: Path2D } | null = null;

function tracePath(ax: number, ay: number, n: Squareness): Path2D {
  const path = new Path2D();
  const e = 2 / n;
  for (let i = 0; i < RIM_POINTS; i++) {
    const t = (i / RIM_POINTS) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = Math.sign(c) * Math.abs(c) ** e * ax;
    const y = Math.sign(s) * Math.abs(s) ** e * ay;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

/** The rim's outline in world units, for strokes (a stroke can't go under a non-uniform scale). Rebuilt when the rim changes. */
function rimPath(light: number, oval: Oval): Path2D {
  const rim = rimAxes(light, oval);
  const key = `${rim.x}|${rim.y}|${oval.n}`;
  if (!rimMemo || rimMemo.key !== key) rimMemo = { key, path: tracePath(rim.x, rim.y, oval.n) };
  return rimMemo.path;
}

/** The shape at unit half-axes, for clips and fills under a scale. */
function unitPath(n: Squareness): Path2D {
  if (!unitMemo || unitMemo.n !== n) unitMemo = { n, path: tracePath(1, 1, n) };
  return unitMemo.path;
}

/** The ground and its guides on a superellipse: the same round falloff, clipped to the shape's edge. */
function paintSquareGround(
  ctx: CanvasRenderingContext2D, light: number, oval: Oval, kx: number, ky: number, px: number, gradient: CanvasGradient,
): void {
  const rim = rimAxes(light, oval);
  const k = ARENA.darkScale;
  ctx.save();
  // Clip in units of the dark's opaque edge, then step down to the stretched
  // units the gradient lives in (kx = rim.x / L): a restore would drop the clip.
  ctx.scale(rim.x * k, rim.y * k);
  ctx.clip(unitPath(oval.n));
  ctx.scale(kx / (rim.x * k), ky / (rim.y * k));
  ctx.fillStyle = gradient;
  // The dark covers the clip's edge; a box past it is all the fill needs.
  ctx.fillRect(-light * k * 1.5, -light * k * 1.5, light * k * 3, light * k * 3);
  ctx.restore();

  const path = rimPath(light, oval);
  ctx.strokeStyle = withAlpha(INK['300'], 0.12);
  for (const f of [1 / 3, 2 / 3]) {
    ctx.save();
    ctx.scale(f, f);
    ctx.lineWidth = px / f;
    ctx.stroke(path);
    ctx.restore();
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
  if (oval.n !== 2) {
    paintSquareDark(ctx, light, oval, w, h, inner / light, palette, alpha);
    return;
  }
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
 * The dark's profile in rims (q = 1 on the rim), the same stops as
 * `paintDark`'s gradient, whose radii are all multiples of `L`: clear inside
 * `inner`, opaque at `darkScale`, held, then thinned to nothing at `DARK_FADE`.
 */
function darkAlphaAt(q: number, inner: number): number {
  const outer = ARENA.darkScale;
  const mid = (inner + outer) / 2;
  const hold = outer * DARK_HOLD;
  const far = outer * DARK_FADE;
  if (q <= inner) return 0;
  if (q < mid) return (0.55 * (q - inner)) / (mid - inner);
  if (q < outer) return 0.55 + (0.45 * (q - mid)) / (outer - mid);
  if (q <= hold) return 1;
  if (q < far) return 1 - (q - hold) / (far - hold);
  return 0;
}

/** Texels across the baked dark: enough for a soft band stretched over a rim. */
const DARK_TEXELS = 512;
let darkTexture: { key: string; canvas: HTMLCanvasElement } | null = null;

/**
 * The dark around a superellipse, baked once in rim units: texel (u, v)
 * holds the dark's alpha at the shape's radius `(|u|ⁿ + |v|ⁿ)^(1/n)`. In
 * those units the band is the same for any `L` and aspect, so it bakes once
 * per shape and palette, not on a resize or a range upgrade.
 */
function bakeDark(n: Squareness, inner: number, palette: string): HTMLCanvasElement {
  const key = `${n}|${inner.toFixed(4)}|${palette}`;
  if (darkTexture && darkTexture.key === key) return darkTexture.canvas;
  const size = DARK_TEXELS;
  const canvas = darkTexture?.canvas ?? document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d')!;
  const img = c.createImageData(size, size);
  const { r, g, b } = toRgb(INK['950']);
  const far = ARENA.darkScale * DARK_FADE;
  for (let j = 0; j < size; j++) {
    const v = (((j + 0.5) / size) * 2 - 1) * far;
    for (let i = 0; i < size; i++) {
      const u = (((i + 0.5) / size) * 2 - 1) * far;
      const a = darkAlphaAt(rimRadius(u, v, 1, 1, n), inner);
      const o = (j * size + i) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  c.putImageData(img, 0, 0);
  darkTexture = { key, canvas };
  return canvas;
}

/** The dark on a superellipse: the baked texture stretched over the rim, its edge already transparent. */
function paintSquareDark(
  ctx: CanvasRenderingContext2D, light: number, oval: Oval, w: number, h: number, inner: number, palette: string, alpha: number,
): void {
  // A close-up that sees nothing past the rim draws none of it (w, h are in units where the rim is radius `L`).
  if (rimRadius(w, h, light, light, oval.n) <= inner) return;
  const rim = rimAxes(light, oval);
  const far = ARENA.darkScale * DARK_FADE;
  const texture = bakeDark(oval.n, inner, palette);
  ctx.save();
  if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.scale(rim.x, rim.y);
  ctx.drawImage(texture, -far, -far, far * 2, far * 2);
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
  const path = oval.n === 2 ? null : rimPath(light, oval);
  ctx.save();
  ctx.beginPath();
  if (!path) ctx.ellipse(0, 0, rim.x, rim.y, 0, 0, Math.PI * 2);
  for (const [width, alpha] of [[14, 0.035], [7, 0.07], [3, 0.14], [1.25, 0.42]] as const) {
    ctx.lineWidth = width * px;
    ctx.strokeStyle = withAlpha(color, alpha);
    if (path) ctx.stroke(path);
    else ctx.stroke();
  }
  ctx.restore();
}

/** How wide a gate's arch is on the rim, radians (plans/late-game/08 §3.1). */
export const GATE_WIDTH = 0.4;
/** Segments in a gate's arch on a squarer rim. */
const GATE_STEPS = 16;

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
    if (oval.n === 2) ctx.ellipse(0, 0, rim.x, rim.y, 0, a - GATE_WIDTH / 2, a + GATE_WIDTH / 2);
    else {
      // The arch along the squarer rim, through the same angles the bodies spawn at.
      for (let i = 0; i <= GATE_STEPS; i++) {
        const p = rimPoint(a - GATE_WIDTH / 2 + (GATE_WIDTH * i) / GATE_STEPS, light, oval);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
    }
    for (const [width, alpha] of [[22, 0.08], [12, 0.18], [5, 0.45], [2, 0.95]] as const) {
      ctx.lineWidth = width * px;
      ctx.strokeStyle = withAlpha(color, alpha * glow);
      ctx.stroke();
    }
    // The arch's posts: two short ticks pointing in, so it reads as a doorway.
    for (const side of [-1, 1]) {
      const b = a + (side * GATE_WIDTH) / 2;
      // The post's foot on the rim, in units of each half-axis: (cos b, sin b) on the ellipse.
      const p = rimPoint(b, light, oval);
      const x = p.x / rim.x;
      const y = p.y / rim.y;
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
