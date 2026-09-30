import { weaponParams } from '../../content/weapons';
import type { WeaponId } from '../../content/types';
import { FX, INK, lighten, mix, withAlpha } from '../palette';
import { LIGHT_ANGLE } from './enemies';

/** What the tower painter needs of a mounted weapon. */
export interface Mount {
  readonly id: WeaponId;
  readonly level: number;
  readonly aim: number;
}

/**
 * Where weapon slot `slot` sits, as a multiple of the wall radius (§4.4:
 * each equipped weapon is drawn on the tower). Slot 0 is the turret on the
 * drum; the rest are pods on the plinth's lower corners and its crown, so a
 * new weapon lands somewhere the eye already rests.
 */
const POD_ANGLES = [Math.PI * 0.75, Math.PI * 0.25, -Math.PI * 0.5];
const POD_DISTANCE = 1.04;
/** Pod radius, as a multiple of the wall radius: big enough to read on a phone. */
const POD_RADIUS = 0.52;

export function mountOffset(slot: number, R: number): { x: number; y: number } {
  if (slot === 0) return { x: 0, y: 0 };
  const a = POD_ANGLES[(slot - 1) % POD_ANGLES.length];
  return { x: Math.cos(a) * R * POD_DISTANCE, y: Math.sin(a) * R * POD_DISTANCE };
}

/**
 * The tower (§10.5): an octagonal stone plinth, an amber drum with the
 * violet crystal at its heart, and one mount per equipped weapon, each
 * turning to its own last shot. Drawn in world space at the origin; `R` is
 * the tower's wall radius.
 *
 * `hurt` ∈ [0, 1] flares the crystal scarlet after a contact hit. `fallen`
 * ∈ [0, 1] cracks and darkens it as the run ends.
 */
export function paintTower(
  ctx: CanvasRenderingContext2D,
  R: number,
  mounts: readonly Mount[],
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

  // Pods under the turret, so the turret's barrel reads on top.
  for (let i = 1; i < mounts.length; i++) {
    const o = mountOffset(i, R);
    ctx.save();
    ctx.translate(o.x, o.y);
    paintPod(ctx, R * POD_RADIUS, lx, ly);
    paintMount(ctx, mounts[i], R * POD_RADIUS, time, fallen);
    ctx.restore();
  }
  if (mounts.length > 0) paintMount(ctx, mounts[0], R * 0.82, time, fallen);

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

/** A small stone socket a pod-mounted weapon sits in. */
function paintPod(ctx: CanvasRenderingContext2D, r: number, lx: number, ly: number): void {
  const g = ctx.createLinearGradient(lx * r, ly * r, -lx * r, -ly * r);
  g.addColorStop(0, INK['200']);
  g.addColorStop(1, INK['500']);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = mix(FX.gold, INK['800'], 0.5);
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

/**
 * One weapon's mount, centred on the origin and turned to its aim. `r` is
 * the radius it may fill. Each weapon has its own silhouette, and its level
 * shows in the silhouette itself: more barrels, a wider bell, more coils.
 */
function paintMount(ctx: CanvasRenderingContext2D, m: Mount, r: number, time: number, fallen: number): void {
  const p = weaponParams(m.id, m.level);
  const dim = (c: string): string => (fallen > 0 ? mix(c, INK['700'], fallen) : c);
  ctx.save();
  ctx.rotate(m.aim);
  switch (m.id) {
    case 'arcane-bolt': {
      // One barrel per bolt in a volley, side by side, violet-tipped.
      const n = p.count;
      const w = r * 0.26;
      const len = r * (p.pierce > 0 ? 1.08 : 0.96);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * w * 1.15;
        ctx.fillStyle = dim(INK['700']);
        ctx.fillRect(r * 0.2, off - w / 2, len - r * 0.2, w);
        ctx.fillStyle = dim(mix(FX.gold, INK['700'], 0.4));
        ctx.fillRect(len - r * 0.18, off - w * 0.65, r * 0.18, w * 1.3);
        ctx.fillStyle = withAlpha(FX.arcane, (0.6 + 0.3 * Math.sin(time * 6 + i)) * (1 - fallen));
        ctx.beginPath();
        ctx.arc(len, off, w * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'scattershot': {
      // A flared bell; it widens as pellets are added.
      const bell = r * (0.34 + p.count * 0.035);
      ctx.fillStyle = dim(mix(FX.ember, INK['800'], 0.55));
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, -r * 0.2);
      ctx.lineTo(r * 0.55, -r * 0.2);
      ctx.lineTo(r * 1.05, -bell);
      ctx.lineTo(r * 1.05, bell);
      ctx.lineTo(r * 0.55, r * 0.2);
      ctx.lineTo(-r * 0.1, r * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = dim(FX.ember);
      ctx.lineWidth = Math.max(1.5, r * 0.08);
      ctx.stroke();
      ctx.strokeStyle = dim(lighten(FX.ember, 0.4));
      ctx.lineWidth = Math.max(2, r * 0.14);
      ctx.beginPath();
      ctx.moveTo(r * 1.05, -bell);
      ctx.lineTo(r * 1.05, bell);
      ctx.stroke();
      if (p.knockback > 20) {
        // The heavier charge: a brass collar.
        ctx.fillStyle = dim(FX.gold);
        ctx.fillRect(r * 0.42, -r * 0.26, r * 0.14, r * 0.52);
      }
      break;
    }
    case 'chain-lightning': {
      // A coil: one ring per body the arc can reach, and a spark ball on top.
      const rings = p.jumps;
      for (let i = 0; i < rings; i++) {
        const t = i / Math.max(1, rings - 1);
        ctx.strokeStyle = dim(i % 2 === 0 ? FX.frost : lighten(FX.frost, 0.3));
        ctx.lineWidth = Math.max(1.5, r * 0.09);
        ctx.beginPath();
        ctx.ellipse(r * (0.05 + t * 0.6), 0, r * 0.12, r * (0.42 - t * 0.12), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const flicker = 0.55 + 0.45 * Math.abs(Math.sin(time * 17));
      ctx.fillStyle = withAlpha(FX.frost, 0.35 * flicker * (1 - fallen));
      ctx.beginPath();
      ctx.arc(r * 0.85, 0, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = dim(lighten(FX.frost, 0.6));
      ctx.beginPath();
      ctx.arc(r * 0.85, 0, r * (p.stun > 0 ? 0.2 : 0.15), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      const exhaustive: never = m.id;
      ctx.restore();
      return exhaustive;
    }
  }
  ctx.restore();
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
