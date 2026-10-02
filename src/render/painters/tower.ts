import { weaponParams } from '../../content/weapons';
import type { TrimId, WeaponId } from '../../content/types';
import { FX, INK, lighten, mix, withAlpha } from '../palette';
import { LIGHT_ANGLE } from './enemies';

/** What the tower painter needs of a mounted weapon. */
export interface Mount {
  readonly id: WeaponId;
  readonly level: number;
  readonly aim: number;
  /** An evolved weapon wears a gold halo on its mount (§4.4). */
  readonly evolved?: boolean;
}

/**
 * What the tower wears beyond its weapons (N2): its tier (one stage per Forge
 * ring completed), a light per overtime trophy (N4), and the trims Trials
 * paid (N5). The app sets it from the profile; the sim never sees it.
 */
export interface TowerLook {
  readonly tier: number;
  readonly trophies: number;
  readonly trims: readonly TrimId[];
}

export const PLAIN_LOOK: TowerLook = { tier: 1, trophies: 0, trims: [] };

/** The plinth's eight corners, at `k` × the wall radius. */
function corners(R: number, k: number): { x: number; y: number }[] {
  return Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return { x: Math.cos(a) * R * k, y: Math.sin(a) * R * k };
  });
}

/** Beneath the plinth: the stone course (tier 2) and the buttresses (tier 5). */
function paintFooting(ctx: CanvasRenderingContext2D, R: number, look: TowerLook): void {
  if (look.tier >= 5) {
    ctx.fillStyle = INK['600'];
    for (const c of corners(R, 1.2)) {
      const a = Math.atan2(c.y, c.x);
      ctx.beginPath();
      ctx.moveTo(c.x + Math.cos(a + 1.3) * R * 0.12, c.y + Math.sin(a + 1.3) * R * 0.12);
      ctx.lineTo(c.x + Math.cos(a) * R * 0.32, c.y + Math.sin(a) * R * 0.32);
      ctx.lineTo(c.x + Math.cos(a - 1.3) * R * 0.12, c.y + Math.sin(a - 1.3) * R * 0.12);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (look.tier >= 2) {
    ctx.strokeStyle = INK['500'];
    ctx.lineWidth = R * 0.12;
    ctx.beginPath();
    corners(R, 1.34).forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
    // Its joints: a block every corner and between.
    ctx.strokeStyle = INK['700'];
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 1.27, Math.sin(a) * R * 1.27);
      ctx.lineTo(Math.cos(a) * R * 1.41, Math.sin(a) * R * 1.41);
      ctx.stroke();
    }
  }
}

/** On the plinth: the gilt edge (tier 4), banners (tier 3), lamps (tier 6) and the trims. */
function paintDress(ctx: CanvasRenderingContext2D, R: number, look: TowerLook, time: number): void {
  const at = corners(R, 1.2);
  if (look.tier >= 4) {
    ctx.strokeStyle = withAlpha(FX.gold, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    corners(R, 1.12).forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
  }
  if (look.tier >= 3) {
    // Four banners on the diagonal corners, stirring.
    for (let i = 1; i < 8; i += 2) {
      const c = at[i];
      const sway = Math.sin(time * 2 + i) * R * 0.05;
      ctx.fillStyle = look.trims.includes('pennants') ? FX.frost : FX.blood;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - R * 0.3);
      ctx.lineTo(c.x + R * 0.26 + sway, c.y - R * 0.2);
      ctx.lineTo(c.x, c.y - R * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = INK['200'];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x, c.y - R * 0.32);
      ctx.stroke();
    }
  }
  if (look.tier >= 6) {
    for (let i = 0; i < 8; i += 2) {
      const c = at[i];
      const glow = 0.6 + 0.4 * Math.sin(time * 3 + i);
      ctx.fillStyle = withAlpha(FX.gold, 0.25 * glow);
      ctx.beginPath();
      ctx.arc(c.x, c.y, R * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = lighten(FX.gold, 0.3);
      ctx.beginPath();
      ctx.arc(c.x, c.y, R * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const trim of look.trims) paintTrim(ctx, R, trim, time);
}

/** One trim (N5). */
function paintTrim(ctx: CanvasRenderingContext2D, R: number, trim: TrimId, time: number): void {
  switch (trim) {
    case 'ivy':
      ctx.fillStyle = withAlpha(FX.nature, 0.9);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + 0.2;
        const r = R * (1.12 + 0.05 * Math.sin(i * 2.3));
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * r, Math.sin(a) * r, R * 0.07, R * 0.04, a, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    case 'pennants':
      // The banners fly frost-blue (`paintDress`); and a ring of small flags at the course.
      ctx.fillStyle = withAlpha(FX.frost, 0.7);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * R * 1.45, Math.sin(a) * R * 1.45, R * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    case 'runes':
      ctx.strokeStyle = withAlpha(FX.arcane, 0.5 + 0.3 * Math.sin(time * 1.5));
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = Math.cos(a) * R * 0.98;
        const y = Math.sin(a) * R * 0.98;
        ctx.beginPath();
        ctx.moveTo(x - R * 0.05, y - R * 0.06);
        ctx.lineTo(x + R * 0.05, y);
        ctx.lineTo(x - R * 0.05, y + R * 0.06);
        ctx.stroke();
      }
      return;
    case 'gilt':
      ctx.strokeStyle = lighten(FX.gold, 0.2);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      return;
    case 'embers':
      for (let i = 0; i < 6; i++) {
        const a = time * 0.7 + (i / 6) * Math.PI * 2;
        const lift = ((time * 0.5 + i / 6) % 1);
        ctx.fillStyle = withAlpha(FX.ember, 0.8 * (1 - lift));
        ctx.beginPath();
        ctx.arc(Math.cos(a) * R * (1.1 + lift * 0.4), Math.sin(a) * R * (1.1 + lift * 0.4), R * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    case 'starlit':
      // Drawn over the crystal, in `paintCrown`.
      return;
    default: {
      const exhaustive: never = trim;
      return exhaustive;
    }
  }
}

/** Over the crystal: the crown of light (tier 7), the trophies' lights (N4), and a starlit crystal. */
function paintCrown(ctx: CanvasRenderingContext2D, R: number, look: TowerLook, time: number): void {
  if (look.trims.includes('starlit')) {
    ctx.fillStyle = withAlpha(INK['050'], 0.9);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + time * 0.4;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * R * 0.32, Math.sin(a) * R * 0.32, R * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (look.tier >= 7) {
    const pulse = 0.7 + 0.3 * Math.sin(time * 1.6);
    ctx.strokeStyle = withAlpha(lighten(FX.gold, 0.3), 0.55 * pulse);
    ctx.lineWidth = R * 0.08;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.62, 0, Math.PI * 2);
    ctx.stroke();
  }
  // A light per trophy, turning slowly round the tower.
  const n = Math.min(look.trophies, 18);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + time * 0.25;
    const x = Math.cos(a) * R * 1.8;
    const y = Math.sin(a) * R * 1.8;
    ctx.fillStyle = withAlpha(FX.gold, 0.3);
    ctx.beginPath();
    ctx.arc(x, y, R * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lighten(FX.gold, 0.35);
    ctx.beginPath();
    ctx.arc(x, y, R * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Where weapon slot `slot` sits, as a multiple of the wall radius (§4.4:
 * each equipped weapon is drawn on the tower). Slot 0 is the turret on the
 * drum; the rest are pods on the plinth's lower corners and its crown, so a
 * new weapon lands somewhere the eye already rests; Act 2's fifth and sixth
 * (§9) sit at its flanks.
 */
const POD_ANGLES = [Math.PI * 0.75, Math.PI * 0.25, -Math.PI * 0.5, Math.PI, 0];
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
  look: TowerLook = PLAIN_LOOK,
): void {
  const lx = Math.cos(LIGHT_ANGLE);
  const ly = Math.sin(LIGHT_ANGLE);

  // Shadow.
  ctx.fillStyle = withAlpha(INK['950'], 0.45);
  ctx.beginPath();
  ctx.ellipse(-lx * 6, -ly * 6, R * 1.3, R * 1.3, 0, 0, Math.PI * 2);
  ctx.fill();
  paintFooting(ctx, R, look);

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
  paintDress(ctx, R, look, time);

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

  if (fallen < 1) paintCrown(ctx, R, look, time);
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
  if (m.evolved) {
    // The evolved weapon's halo: gold, slowly breathing.
    ctx.strokeStyle = withAlpha(FX.gold, (0.55 + 0.25 * Math.sin(time * 3)) * (1 - fallen));
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.02, 0, Math.PI * 2);
    ctx.stroke();
  }
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
    case 'frost-ring': {
      // A ring of ice shards round a frost core; the ring widens with reach.
      const shards = 6;
      const reach = r * (0.5 + (p.radius - 160) / 400);
      for (let i = 0; i < shards; i++) {
        const a = (i / shards) * Math.PI * 2 + time * 0.6;
        ctx.save();
        ctx.rotate(a);
        ctx.fillStyle = dim(i % 2 === 0 ? FX.frost : lighten(FX.frost, 0.35));
        ctx.beginPath();
        ctx.moveTo(reach + r * 0.28, 0);
        ctx.lineTo(reach, -r * 0.1);
        ctx.lineTo(reach - r * 0.12, 0);
        ctx.lineTo(reach, r * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = withAlpha(FX.frost, (0.35 + 0.15 * Math.sin(time * 3)) * (1 - fallen));
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.3 + p.slow * 0.3), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'mortar': {
      // Squat tubes, one per shell; wider as the blast grows, banded once it scatters bomblets.
      const n = p.count;
      const w = r * (0.3 + (p.radius - 55) / 160);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * w * 1.1;
        ctx.fillStyle = dim(INK['800']);
        ctx.fillRect(-r * 0.1, off - w / 2, r * 0.75, w);
        ctx.fillStyle = dim(mix(FX.ember, INK['800'], 0.5));
        ctx.fillRect(r * 0.55, off - w * 0.6, r * 0.2, w * 1.2);
        if (p.bomblets > 0) {
          ctx.fillStyle = dim(FX.gold);
          ctx.fillRect(r * 0.2, off - w / 2, r * 0.08, w);
        }
      }
      break;
    }
    case 'sunlance': {
      // A long lens on a mast: the crystal at its tip warms as the beam levels.
      ctx.fillStyle = dim(INK['700']);
      ctx.fillRect(0, -r * 0.09, r * (p.pierce > 0 ? 1.05 : 0.9), r * 0.18);
      ctx.fillStyle = dim(mix(FX.gold, INK['700'], 0.3));
      ctx.beginPath();
      ctx.moveTo(r * 0.55, -r * 0.24);
      ctx.lineTo(r * 0.95, 0);
      ctx.lineTo(r * 0.55, r * 0.24);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = withAlpha(lighten(FX.gold, 0.4), (0.5 + 0.2 * p.rampCap / 5 + 0.2 * Math.sin(time * 5)) * (1 - fallen));
      ctx.beginPath();
      ctx.arc(r * 0.95, 0, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'glaives': {
      // A hub with one spoke per blade, spinning with them.
      const n = p.count;
      ctx.strokeStyle = dim(INK['200']);
      ctx.lineWidth = Math.max(2, r * 0.12);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
        ctx.stroke();
      }
      ctx.fillStyle = dim(INK['600']);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'sentinel-drones': {
      // A docking pad: one light per drone, blinking as they report in.
      const n = p.count;
      ctx.fillStyle = dim(INK['700']);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const on = 0.5 + 0.5 * Math.sin(time * 4 + i * 1.7);
        ctx.fillStyle = withAlpha(FX.mana, (0.4 + 0.6 * on) * (1 - fallen));
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, r * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'moonblade': {
      // A cradle of crescents, one per throw, nested like moons.
      const n = p.count;
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const c = r * (0.35 + i * 0.16);
        ctx.strokeStyle = dim(i % 2 === 0 ? lighten(FX.frost, 0.5) : INK['100']);
        ctx.lineWidth = Math.max(2, r * 0.12);
        ctx.beginPath();
        ctx.arc(-r * 0.15, 0, c, -0.9, 0.9);
        ctx.stroke();
      }
      ctx.fillStyle = dim(INK['700']);
      ctx.beginPath();
      ctx.arc(-r * 0.15, 0, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'rune-traps': {
      // A rune-stone: one glyph-notch per rune it can keep down, glowing as it charges.
      const n = p.count;
      ctx.fillStyle = dim(INK['600']);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        if (i === 0) ctx.moveTo(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66);
        else ctx.lineTo(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66);
      }
      ctx.closePath();
      ctx.fill();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + time * 0.4;
        ctx.fillStyle = withAlpha(FX.arcane, (0.45 + 0.35 * Math.sin(time * 3 + i)) * (1 - fallen));
        ctx.fillRect(Math.cos(a) * r * 0.42 - r * 0.06, Math.sin(a) * r * 0.42 - r * 0.06, r * 0.12, r * 0.12);
      }
      if (p.stun > 0) {
        ctx.strokeStyle = dim(FX.gold);
        ctx.lineWidth = Math.max(1.5, r * 0.07);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'soul-tether': {
      // A spindle with one thread per tether, wound and glowing.
      const n = p.count;
      ctx.fillStyle = dim(INK['700']);
      ctx.fillRect(-r * 0.1, -r * 0.16, r * 0.8, r * 0.32);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * r * 0.16;
        ctx.strokeStyle = withAlpha(lighten(FX.nature, 0.3), (0.5 + 0.4 * Math.sin(time * 5 + i)) * (1 - fallen));
        ctx.lineWidth = Math.max(1.5, r * 0.06);
        ctx.beginPath();
        ctx.moveTo(r * 0.1, off);
        ctx.quadraticCurveTo(r * 0.6, off + Math.sin(time * 4 + i) * r * 0.12, r * 1.0, off * 0.4);
        ctx.stroke();
      }
      ctx.fillStyle = dim(lighten(FX.nature, 0.5));
      ctx.beginPath();
      ctx.arc(r * 1.0, 0, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'gilded-rail': {
      // Twin gilded rails, a slug between them; a second barrel once it fires two.
      const n = p.count;
      const gap = r * (0.14 + (p.radius - 14) / 120);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * gap * 3;
        ctx.fillStyle = dim(FX.gold);
        ctx.fillRect(0, off - gap - r * 0.06, r * 1.1, r * 0.08);
        ctx.fillRect(0, off + gap - r * 0.02, r * 1.1, r * 0.08);
        ctx.fillStyle = dim(INK['800']);
        ctx.fillRect(-r * 0.15, off - gap * 0.7, r * 0.4, gap * 1.4);
        ctx.fillStyle = withAlpha(lighten(FX.gold, 0.6), (0.4 + 0.4 * Math.sin(time * 2)) * (1 - fallen));
        ctx.beginPath();
        ctx.arc(r * 0.5, off, gap * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
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
export function paintRangeRing(ctx: CanvasRenderingContext2D, range: number, px: number): void {
  ctx.save();
  ctx.strokeStyle = withAlpha(FX.arcane, 0.3);
  // Sized in CSS pixels (`px` world units each), so it stays thin and evenly dashed at any zoom.
  ctx.lineWidth = px;
  ctx.setLineDash([5 * px, 4 * px]);
  ctx.beginPath();
  ctx.arc(0, 0, range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
