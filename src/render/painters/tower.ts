import { FX, INK, lighten, withAlpha } from '../palette';

/** Drawn radius of the tower body, in world units. */
export const TOWER_DRAW_RADIUS = 34;

/**
 * The tower, tier 1: a stone plinth, an amber drum and a violet crystal.
 * Drawn in world space at the origin.
 */
export function paintTower(ctx: CanvasRenderingContext2D, time: number, hurt: number): void {
  const R = TOWER_DRAW_RADIUS;

  // Plinth.
  ctx.fillStyle = INK['500'];
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * R * 1.25;
    const y = Math.sin(a) * R * 1.25;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK['300'];
  ctx.lineWidth = 2;
  ctx.stroke();

  // Drum.
  const drum = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
  drum.addColorStop(0, lighten(FX.gold, 0.35));
  drum.addColorStop(1, FX.gold);
  ctx.fillStyle = drum;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.82, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK['700'];
  ctx.lineWidth = 3;
  ctx.stroke();

  // Crystal, pulsing slowly; flares scarlet when hit.
  const pulse = 0.85 + 0.15 * Math.sin(time * 2.4);
  const core = hurt > 0 ? FX.critical : FX.arcane;
  ctx.fillStyle = withAlpha(core, 0.25 * pulse);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = lighten(core, 0.2);
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.42);
  ctx.lineTo(R * 0.26, 0);
  ctx.lineTo(0, R * 0.42);
  ctx.lineTo(-R * 0.26, 0);
  ctx.closePath();
  ctx.fill();
}
