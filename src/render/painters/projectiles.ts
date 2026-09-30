import type { Projectile } from '../../sim/state';
import { FX, lighten, withAlpha } from '../palette';

/** Trail length, as seconds of travel behind the bolt. */
const TRAIL_SECONDS = 0.05;

/**
 * Arcane bolts: a violet glow, a hot core and a short trail along the
 * velocity. Crits burn gold, so a crit is visible before it lands.
 */
export function paintProjectiles(
  ctx: CanvasRenderingContext2D,
  projectiles: readonly Projectile[],
  alpha: number,
  additive: boolean,
): void {
  ctx.save();
  if (additive) ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const p of projectiles) {
    if (!p.alive) continue;
    const x = p.px + (p.x - p.px) * alpha;
    const y = p.py + (p.y - p.py) * alpha;
    const tint = p.crit ? FX.gold : FX.arcane;
    const r = p.crit ? 7 : 5.5;

    ctx.strokeStyle = withAlpha(tint, 0.55);
    ctx.lineWidth = r * 1.2;
    ctx.beginPath();
    ctx.moveTo(x - p.vx * TRAIL_SECONDS, y - p.vy * TRAIL_SECONDS);
    ctx.lineTo(x, y);
    ctx.stroke();

    ctx.fillStyle = withAlpha(tint, 0.3);
    ctx.beginPath();
    ctx.arc(x, y, r * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lighten(tint, 0.55);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
