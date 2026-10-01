import type { Projectile } from '../../sim/state';
import { FX, INK, lighten, withAlpha } from '../palette';

/** Trail length, as seconds of travel behind the shot. */
const TRAIL_SECONDS = 0.05;

/** How high a shell climbs, as a share of the distance it is lobbed. */
const SHELL_ARC = 0.28;

/**
 * Projectiles, one look per weapon (§10.5). Arcane bolts are a violet glow
 * with a hot core, Seeker Swarm's seekers smaller ones; Scattershot pellets
 * are short amber streaks; Mortar shells are dark balls lobbed on an arc
 * with a fuse spark; meteors are burning streaks; drone shots are blue-violet
 * darts; Moonblade's crescents are pale moons that spin as they fly. Crits
 * burn gold, so a crit is visible before it lands.
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
    switch (p.weapon) {
      case 'arcane-bolt': {
        const tint = p.crit ? FX.gold : FX.arcane;
        const r = (p.crit ? 7 : 5.5) * (p.seeker ? 0.6 : 1);
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
        break;
      }
      case 'scattershot': {
        const tint = p.crit ? FX.gold : FX.ember;
        ctx.strokeStyle = withAlpha(tint, 0.8);
        ctx.lineWidth = p.crit ? 5 : 3.5;
        ctx.beginPath();
        ctx.moveTo(x - p.vx * TRAIL_SECONDS * 0.7, y - p.vy * TRAIL_SECONDS * 0.7);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = lighten(tint, 0.5);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'mortar': {
        if (p.meteor) {
          paintMeteor(ctx, x, y, p.vx, p.vy);
          break;
        }
        // The arc: the shell climbs and drops over the ground it crosses.
        const total = Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1;
        const t = Math.min(1, Math.hypot(x - p.sx, y - p.sy) / total);
        const lift = Math.sin(t * Math.PI) * total * SHELL_ARC;
        ctx.fillStyle = withAlpha(INK['950'], 0.35);
        ctx.beginPath();
        ctx.ellipse(x, y, 7, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = INK['700'];
        ctx.strokeStyle = p.crit ? FX.gold : FX.ember;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y - lift, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = lighten(FX.ember, 0.5);
        ctx.beginPath();
        ctx.arc(x + 4, y - lift - 6, 2.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'sentinel-drones': {
        const tint = p.crit ? FX.gold : FX.mana;
        ctx.strokeStyle = withAlpha(tint, 0.75);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - p.vx * TRAIL_SECONDS * 0.8, y - p.vy * TRAIL_SECONDS * 0.8);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = lighten(tint, 0.5);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'moonblade': {
        const tint = p.crit ? FX.gold : lighten(FX.frost, 0.55);
        const spin = Math.atan2(p.vy, p.vx) + (p.returning ? Math.PI : 0) + x * 0.05;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(spin);
        ctx.strokeStyle = withAlpha(tint, 0.35);
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(0, 0, 11, -1.2, 1.2);
        ctx.stroke();
        ctx.strokeStyle = tint;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, 11, -1.2, 1.2);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'chain-lightning':
      case 'frost-ring':
      case 'sunlance':
      case 'glaives':
      case 'rune-traps':
      case 'soul-tether':
      case 'gilded-rail':
        // Instant, held or laid: drawn as an effect or by the arsenal painter, never a projectile.
        break;
      default: {
        const exhaustive: never = p.weapon;
        ctx.restore();
        return exhaustive;
      }
    }
  }
  ctx.restore();
}

/** A meteor: a white-hot head and a long ember tail along its fall. */
function paintMeteor(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number): void {
  const tail = 0.12;
  const g = ctx.createLinearGradient(x - vx * tail, y - vy * tail, x, y);
  g.addColorStop(0, withAlpha(FX.ember, 0));
  g.addColorStop(1, withAlpha(FX.ember, 0.9));
  ctx.strokeStyle = g;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(x - vx * tail, y - vy * tail);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.fillStyle = lighten(FX.gold, 0.6);
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill();
}
