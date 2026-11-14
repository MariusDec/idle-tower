import type { ReliquaryState } from '../../sim/state';
import { INK, RARITY, lighten, withAlpha } from '../palette';

/**
 * A reliquary (plans/late-game/03 §2): a dark chest where the body fell,
 * with a slow pulse and a ring that drains with its window. Drawn above the
 * dark, so no fog or Lightless floor can hide it, and never smaller on
 * screen than the touch floor. The colour is the curse's (`--curse`, the
 * epic violet) and the shape (a chest with a ring) carries it too, so it
 * never reads by colour alone. Under reduced motion the pulse stops; the
 * draining ring stays: it carries information. Reads the run; writes nothing.
 */

/** The chest's half width, in world units at the default zoom. */
const SIZE = 9;
/** …but never smaller on screen than the 44 px touch floor, in CSS pixels (the whole ring). */
const MIN_SCREEN = 44;
/** The ring's radius, × SIZE. */
const RING = 2.1;

export const CURSE_COLOR = RARITY.epic;

export interface ReliquaryLook {
  reducedMotion: boolean;
  /** World units per CSS pixel at the current zoom. */
  px: number;
}

export function paintReliquaries(
  ctx: CanvasRenderingContext2D, list: readonly ReliquaryState[], time: number, clock: number, look: ReliquaryLook,
): void {
  for (const r of list) paintOne(ctx, r, time, clock, look);
}

function paintOne(ctx: CanvasRenderingContext2D, r: ReliquaryState, time: number, clock: number, look: ReliquaryLook): void {
  const k = Math.max(1, (MIN_SCREEN * look.px) / (SIZE * RING * 2));
  const left = Math.max(0, Math.min(1, (r.until - time) / Math.max(0.001, r.until - r.at)));
  const pulse = look.reducedMotion ? 1 : 1 + 0.08 * Math.sin(clock * 2.4);
  const fading = left < 0.15 && !look.reducedMotion ? 0.55 + 0.45 * Math.abs(Math.sin(clock * 9)) : 1;
  const color = CURSE_COLOR;
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.scale(k * pulse, k * pulse);
  ctx.globalAlpha = fading;

  // The glow, then the draining ring: full at the drop, gone as it fades.
  ctx.fillStyle = withAlpha(color, 0.18);
  ctx.beginPath();
  ctx.arc(0, 0, SIZE * RING, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(INK['400'], 0.7);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, SIZE * RING, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = lighten(color, 0.2);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(0, 0, SIZE * RING, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
  ctx.stroke();

  // The chest: a dark body, a lid, a clasp.
  const w = SIZE;
  const h = SIZE * 0.75;
  ctx.fillStyle = INK['900'];
  ctx.strokeStyle = lighten(color, 0.1);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.rect(-w, -h * 0.2, w * 2, h);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-w, -h * 0.2);
  ctx.quadraticCurveTo(0, -h * 1.25, w, -h * 0.2);
  ctx.closePath();
  ctx.fillStyle = INK['700'];
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = lighten(color, 0.35);
  ctx.beginPath();
  ctx.arc(0, h * 0.15, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
