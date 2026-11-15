import type { FrameId } from '../../content/types';
import { FX, INK, lighten, withAlpha, type FxColorName } from '../palette';

/**
 * Final Form's crowns (plans/late-game/07 §4): one per frame, drawn on the
 * tower once a run has evolved two weapons. Flat fills and alpha strokes
 * only, no gradient, blur or per-frame allocation (§5.3): every angle is
 * precomputed here. The inner parts sit at 0.3–0.45 R, the outer at
 * 2.0–2.3 R, beyond the tier-7 crown (1.62 R) and the trophies (1.8 R).
 */

/** Each frame's accent, an `FX` name (never `blood`: that is the enemies'). */
export const FORM_ACCENT: Readonly<Record<FrameId, FxColorName>> = {
  arcanist: 'arcane',
  bastion: 'frost',
  stormcaller: 'mana',
  artificer: 'gold',
  lamplighter: 'ember',
  gravekeeper: 'nature',
};

/** The accent's colour now: read per frame, so the colourblind palette applies. */
export function formAccent(frame: FrameId): string {
  return FX[FORM_ACCENT[frame]];
}

/** What the tower painter needs to draw a crown. */
export interface FormPaint {
  readonly frame: FrameId;
  /** 0 → 1 as the crown grows in (§5.2); 1 once grown. */
  readonly grow: number;
  /** Reduced motion, or the hub's still pose: one fixed pose, no scaling. */
  readonly still: boolean;
  /** The crown's opacity: 1 in a run, 0.6 on the hub (F4). */
  readonly alpha: number;
}

const TAU = Math.PI * 2;
/** Unit vectors, precomputed: n evenly spaced angles from `offset`. */
function ring(n: number, offset = 0): Float64Array {
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * TAU;
    out[i * 2] = Math.cos(a);
    out[i * 2 + 1] = Math.sin(a);
  }
  return out;
}

const STARS = ring(5, -Math.PI / 2);
const MERLONS = ring(8, Math.PI / 8);
/** Tines point down and to the upper flanks: clear of the first three pods (135°, 45°, the crown at 270°). */
const TINES = ring(3, Math.PI / 2);
const TEETH = ring(24);
const RAYS = ring(12);
const MOTES = ring(6, Math.PI / 6);
/** Storm Tines' arc kinks: fixed offsets, so nothing is rolled per frame. */
const ARC_KINK = [0.12, -0.1, 0.08];

/** Ease-out for the crown's growth. */
function easeOut(t: number): number {
  const u = 1 - Math.max(0, Math.min(1, t));
  return 1 - u * u * u;
}

/**
 * Draw `form`'s crown at the origin, `R` the wall radius. `layer` 'under' is
 * drawn before the crystal (Eclipse's disc sits behind it), 'over' after.
 * `time` is the wall clock in seconds.
 */
export function paintForm(
  ctx: CanvasRenderingContext2D,
  R: number,
  form: FormPaint,
  time: number,
  layer: 'under' | 'over',
): void {
  if (form.grow <= 0 || form.alpha <= 0) return;
  const t = form.still ? 0 : time;
  const accent = formAccent(form.frame);
  ctx.save();
  ctx.globalAlpha *= form.alpha * Math.min(1, form.grow);
  if (!form.still) {
    const s = 0.7 + 0.3 * easeOut(form.grow);
    ctx.scale(s, s);
  }
  switch (form.frame) {
    case 'arcanist':
      if (layer === 'over') paintAstral(ctx, R, accent, t);
      break;
    case 'bastion':
      if (layer === 'over') paintRampart(ctx, R, accent, t);
      break;
    case 'stormcaller':
      if (layer === 'over') paintTines(ctx, R, accent, t);
      break;
    case 'artificer':
      if (layer === 'over') paintEngine(ctx, R, accent, t);
      break;
    case 'lamplighter':
      if (layer === 'over') paintSunrise(ctx, R, accent, t);
      break;
    case 'gravekeeper':
      paintEclipse(ctx, R, accent, t, layer);
      break;
    default: {
      const exhaustive: never = form.frame;
      ctx.restore();
      return exhaustive;
    }
  }
  ctx.restore();
}

/** Astral Spire: the crystal's diamond stretched ×1.6, breathing; five stars on a 2.1 R orbit. */
function paintAstral(ctx: CanvasRenderingContext2D, R: number, accent: string, t: number): void {
  const breathe = 1 + 0.06 * Math.sin(t * 1.5);
  const h = R * 0.64 * breathe;
  const w = R * 0.16;
  ctx.fillStyle = withAlpha(lighten(accent, 0.25), 0.85);
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(w, 0);
  ctx.lineTo(0, h * 0.7);
  ctx.lineTo(-w, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = withAlpha(INK['050'], 0.7);
  ctx.lineWidth = Math.max(1, R * 0.025);
  ctx.stroke();
  const turn = t * 0.3;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const r = R * 2.1;
  const p = R * 0.07;
  ctx.fillStyle = lighten(accent, 0.45);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const ux = STARS[i * 2] * c - STARS[i * 2 + 1] * s;
    const uy = STARS[i * 2] * s + STARS[i * 2 + 1] * c;
    const x = ux * r;
    const y = uy * r;
    // A four-point star.
    ctx.moveTo(x, y - p * 1.6);
    ctx.lineTo(x + p * 0.45, y - p * 0.45);
    ctx.lineTo(x + p * 1.6, y);
    ctx.lineTo(x + p * 0.45, y + p * 0.45);
    ctx.lineTo(x, y + p * 1.6);
    ctx.lineTo(x - p * 0.45, y + p * 0.45);
    ctx.lineTo(x - p * 1.6, y);
    ctx.lineTo(x - p * 0.45, y - p * 0.45);
    ctx.closePath();
  }
  ctx.fill();
}

/** Rampart Crown: an octagon of eight merlons at 2.0 R, a frost rim line pulsing at 0.5 Hz. */
function paintRampart(ctx: CanvasRenderingContext2D, R: number, accent: string, t: number): void {
  const r = R * 2.0;
  ctx.strokeStyle = INK['400'];
  ctx.lineWidth = R * 0.12;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const x = MERLONS[i * 2] * r;
    const y = MERLONS[i * 2 + 1] * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  // The merlons: a block at each corner.
  const m = R * 0.13;
  ctx.fillStyle = INK['400'];
  ctx.beginPath();
  for (let i = 0; i < 8; i++) ctx.rect(MERLONS[i * 2] * r - m, MERLONS[i * 2 + 1] * r - m, m * 2, m * 2);
  ctx.fill();
  const pulse = 0.55 + 0.35 * Math.sin(t * Math.PI);
  ctx.strokeStyle = withAlpha(accent, pulse);
  ctx.lineWidth = Math.max(1, R * 0.03);
  ctx.beginPath();
  const rim = r + R * 0.075;
  for (let i = 0; i < 8; i++) {
    const x = MERLONS[i * 2] * rim;
    const y = MERLONS[i * 2 + 1] * rim;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

/** Storm Tines: three rods at 120° on the drum; an arc jumps between a pair every 0.4 s. */
function paintTines(ctx: CanvasRenderingContext2D, R: number, accent: string, t: number): void {
  const r0 = R * 0.3;
  const r1 = R * 1.0;
  const w = R * 0.09;
  ctx.fillStyle = INK['100'];
  ctx.strokeStyle = INK['900'];
  ctx.lineWidth = Math.max(1, R * 0.025);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const ux = TINES[i * 2];
    const uy = TINES[i * 2 + 1];
    ctx.moveTo(ux * r0 - uy * w, uy * r0 + ux * w);
    ctx.lineTo(ux * r1, uy * r1);
    ctx.lineTo(ux * r0 + uy * w, uy * r0 - ux * w);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = lighten(accent, 0.4);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    ctx.moveTo(TINES[i * 2] * r1 + R * 0.08, TINES[i * 2 + 1] * r1);
    ctx.arc(TINES[i * 2] * r1, TINES[i * 2 + 1] * r1, R * 0.08, 0, TAU);
  }
  ctx.fill();
  // The arc: tip a to tip b, through one kink off the chord.
  const pair = Math.floor(t / 0.4) % 3;
  const a = pair;
  const b = (pair + 1) % 3;
  const ax = TINES[a * 2] * r1;
  const ay = TINES[a * 2 + 1] * r1;
  const bx = TINES[b * 2] * r1;
  const by = TINES[b * 2 + 1] * r1;
  // The kink bows outward from the drum, so the arc reads clear of the turret.
  const k = ARC_KINK[pair];
  const mx = (ax + bx) * (0.75 + k) + (ay - by) * k;
  const my = (ay + by) * (0.75 + k) + (bx - ax) * k;
  ctx.strokeStyle = withAlpha(lighten(accent, 0.45), 0.95);
  ctx.lineWidth = Math.max(1.5, R * 0.05);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(mx, my);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

/** Engine Ring: a 24-tooth ring at 2.1 R in `INK['500']`, gold tooth tips, turning 0.15 rad/s. */
function paintEngine(ctx: CanvasRenderingContext2D, R: number, accent: string, t: number): void {
  const r = R * 2.1;
  ctx.strokeStyle = INK['500'];
  ctx.lineWidth = R * 0.12;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
  const turn = t * 0.15;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const r0 = r + R * 0.04;
  const r1 = r + R * 0.17;
  ctx.strokeStyle = lighten(accent, 0.1);
  ctx.lineWidth = R * 0.11;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const ux = TEETH[i * 2] * c - TEETH[i * 2 + 1] * s;
    const uy = TEETH[i * 2] * s + TEETH[i * 2 + 1] * c;
    ctx.moveTo(ux * r0, uy * r0);
    ctx.lineTo(ux * r1, uy * r1);
  }
  ctx.stroke();
  ctx.strokeStyle = withAlpha(lighten(accent, 0.3), 0.5);
  ctx.lineWidth = Math.max(1, R * 0.02);
  ctx.beginPath();
  ctx.arc(0, 0, r - R * 0.05, 0, TAU);
  ctx.stroke();
}

/** Sunrise: twelve short wedges at 2.0–2.3 R, turning 0.1 rad/s. (The dark's −15% is the renderer's.) */
function paintSunrise(ctx: CanvasRenderingContext2D, R: number, accent: string, t: number): void {
  const turn = t * 0.1;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const r0 = R * 2.0;
  const r1 = R * 2.3;
  const half = 0.09;
  const hc = Math.cos(half);
  const hs = Math.sin(half);
  ctx.fillStyle = withAlpha(lighten(accent, 0.15), 0.8);
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const ux = RAYS[i * 2] * c - RAYS[i * 2 + 1] * s;
    const uy = RAYS[i * 2] * s + RAYS[i * 2 + 1] * c;
    // The wedge's two base corners, ±half off its ray.
    ctx.moveTo((ux * hc - uy * hs) * r0, (ux * hs + uy * hc) * r0);
    ctx.lineTo(ux * r1, uy * r1);
    ctx.lineTo((ux * hc + uy * hs) * r0, (-ux * hs + uy * hc) * r0);
    ctx.closePath();
  }
  ctx.fill();
}

/** Eclipse Crown: a dark ring behind the crystal with a 1 px corona; six motes drifting in from 2.3 R. */
function paintEclipse(ctx: CanvasRenderingContext2D, R: number, accent: string, t: number, layer: 'under' | 'over'): void {
  if (layer === 'under') {
    ctx.strokeStyle = INK['950'];
    ctx.lineWidth = R * 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.45, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(lighten(accent, 0.3), 0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.52, 0, TAU);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = lighten(accent, 0.35);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    // Each mote drifts 2.3 R → 1.95 R, shrinking, then respawns at the outside.
    const f = (t * 0.2 + i / 6) % 1;
    const r = R * (2.3 - 0.35 * f);
    const x = MOTES[i * 2] * r;
    const y = MOTES[i * 2 + 1] * r;
    const size = R * 0.08 * (1 - 0.4 * f);
    ctx.moveTo(x + size, y);
    ctx.arc(x, y, size, 0, TAU);
  }
  ctx.fill();
}
