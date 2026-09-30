import { FX, INK, lighten, mix, withAlpha } from '../palette';
import { LIGHT_ANGLE } from './enemies';

/**
 * The tower, tier 1 (§10.5): an octagonal stone plinth, an amber drum, a
 * turret that turns to the last shot, and the violet crystal at its heart.
 * Drawn in world space at the origin; `R` is the tower's wall radius.
 *
 * `hurt` ∈ [0, 1] flares the crystal scarlet after a contact hit. `fallen`
 * ∈ [0, 1] cracks and darkens it as the run ends.
 */
export function paintTower(
  ctx: CanvasRenderingContext2D,
  R: number,
  aim: number,
  time: number,
  hurt: number,
  fallen: number,
): void {
  const lx = Math.cos(LIGHT_ANGLE);
  const ly = Math.sin(LIGHT_ANGLE);

  // Shadow.
  ctx.fillStyle = withAlpha(INK['950'], 0.45);
  ctx.beginPath();
  ctx.ellipse(-lx * 6, -ly * 6, R * 1.3, R * 1.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Plinth.
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * R * 1.2;
    const y = Math.sin(a) * R * 1.2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const stone = ctx.createLinearGradient(lx * R, ly * R, -lx * R, -ly * R);
  stone.addColorStop(0, INK['400']);
  stone.addColorStop(1, INK['600']);
  ctx.fillStyle = stone;
  ctx.fill();
  ctx.strokeStyle = INK['300'];
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Drum.
  const drum = ctx.createRadialGradient(lx * R * 0.35, ly * R * 0.35, R * 0.1, 0, 0, R * 0.85);
  drum.addColorStop(0, lighten(FX.gold, 0.3));
  drum.addColorStop(0.7, FX.gold);
  drum.addColorStop(1, mix(FX.gold, INK['900'], 0.45));
  ctx.fillStyle = fallen > 0 ? mix(FX.gold, INK['700'], fallen) : drum;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.82, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK['800'];
  ctx.lineWidth = 3;
  ctx.stroke();

  // Turret barrel toward the last shot.
  ctx.save();
  ctx.rotate(aim);
  ctx.fillStyle = INK['700'];
  ctx.fillRect(R * 0.2, -R * 0.14, R * 0.78, R * 0.28);
  ctx.fillStyle = mix(FX.gold, INK['700'], 0.4);
  ctx.fillRect(R * 0.82, -R * 0.18, R * 0.16, R * 0.36);
  ctx.restore();

  // Crystal: pulses slowly; flares scarlet when hit.
  const pulse = 0.85 + 0.15 * Math.sin(time * 2.4);
  const core = hurt > 0 ? mix(FX.arcane, FX.critical, hurt) : FX.arcane;
  const glow = fallen > 0 ? 1 - fallen : 1;
  ctx.fillStyle = withAlpha(core, 0.3 * pulse * glow);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = lighten(core, 0.2 * glow);
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.4);
  ctx.lineTo(R * 0.25, 0);
  ctx.lineTo(0, R * 0.4);
  ctx.lineTo(-R * 0.25, 0);
  ctx.closePath();
  ctx.fill();

  if (fallen > 0) paintCracks(ctx, R, fallen);
}

/** Fixed crack pattern, grown out from the centre as `t` goes 0 → 1. */
function paintCracks(ctx: CanvasRenderingContext2D, R: number, t: number): void {
  ctx.save();
  ctx.strokeStyle = INK['950'];
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  const arms = [0.3, 1.4, 2.5, 3.6, 4.9, 5.7];
  for (const a0 of arms) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    let x = 0;
    let y = 0;
    let a = a0;
    for (let i = 0; i < 3; i++) {
      const len = R * 0.4 * Math.min(1, t * 3 - i);
      if (len <= 0) break;
      a += i % 2 === 0 ? 0.35 : -0.5;
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The faint ring that shows how far the tower reaches (§4.1). */
export function paintRangeRing(ctx: CanvasRenderingContext2D, range: number): void {
  ctx.save();
  ctx.strokeStyle = withAlpha(FX.arcane, 0.3);
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.arc(0, 0, range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
