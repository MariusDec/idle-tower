import { BOSS_BY_ID } from '../../content/bosses';
import type { BossDef, BossId } from '../../content/types';
import type { BossState, Enemy, HostileShot, MoltenPool, RunState, SlamRing } from '../../sim/state';
import { FX, INK, lighten, mix, withAlpha } from '../palette';
import { LIGHT_ANGLE } from './enemies';

/**
 * Bosses (§4.3, §10.3), the hostile shots and the shockwaves. A boss is
 * never "a big circle": each has its own silhouette, sampled off a radius
 * profile, so it reads as a boss at a glance and as *this* boss on a second.
 */

/** A boss's outline: radius multiplier at angle `a` (0 = right), and a breathing amount. */
const PROFILE: Record<BossId, (a: number, t: number) => number> = {
  // The Gatekeeper: a crenellated keep, eight square merlons round a heavy drum.
  gatekeeper: (a) => {
    const k = (((a / (Math.PI * 2)) * 8) % 1 + 1) % 1;
    return k < 0.55 ? 1 : 0.84;
  },
  // The Bog Mother: a slow, lumpy swell that never holds one shape.
  'bog-mother': (a, t) => 1 + 0.08 * Math.sin(a * 5 + t * 1.3) + 0.05 * Math.sin(a * 3 - t * 0.9),
  // The Prism: a hard hexagon, cut glass.
  prism: (a) => {
    const k = Math.PI / 3;
    return Math.cos(k / 2) / Math.cos(((((a % k) + k) % k) - k / 2));
  },
  // Forgeheart: a heavy drum with bolted plates standing proud.
  forgeheart: (a) => 1 + 0.07 * Math.sign(Math.sin(a * 6)),
  // The Hollow King: a round head under five crown points, all at the top.
  'hollow-king': (a) => {
    const up = -Math.sin(a);
    return up > 0.45 ? 1 + 0.25 * Math.abs(Math.sin(a * 10)) : 1;
  },
  // The Blight: a heart that beats, and thorns that never hold still.
  blight: (a, t) => 1 + 0.06 * Math.sin(t * 5) + 0.12 * Math.max(0, Math.sin(a * 9 + t * 0.7)),
};

function traceBoss(ctx: CanvasRenderingContext2D, id: BossId, r: number, t: number): void {
  const f = PROFILE[id];
  const n = 64;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = r * f(a, t);
    if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
}

/** The detail that says which boss this is, inside its silhouette. */
function paintDetail(ctx: CanvasRenderingContext2D, def: BossDef, r: number, t: number): void {
  switch (def.id) {
    case 'gatekeeper': {
      // A barred gate across the drum, and one burning eye above it.
      ctx.fillStyle = withAlpha(INK['950'], 0.6);
      ctx.fillRect(-r * 0.42, -r * 0.1, r * 0.84, r * 0.62);
      ctx.strokeStyle = withAlpha(def.borderColor, 0.55);
      ctx.lineWidth = r * 0.06;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.22, -r * 0.1);
        ctx.lineTo(i * r * 0.22, r * 0.52);
        ctx.stroke();
      }
      ctx.fillStyle = lighten(FX.blood, 0.4);
      ctx.beginPath();
      ctx.arc(0, -r * 0.42, r * (0.11 + 0.02 * Math.sin(t * 4)), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bog-mother': {
      // Clutches of eggs under the skin, and a wide, wet maw.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 0.2;
        ctx.fillStyle = withAlpha(lighten(def.borderColor, 0.2), 0.35 + 0.15 * Math.sin(t * 2 + i));
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.13, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = withAlpha(INK['950'], 0.8);
      ctx.beginPath();
      ctx.ellipse(0, r * 0.05, r * 0.34, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'prism': {
      // Light caught inside the glass: rays from the core.
      ctx.strokeStyle = withAlpha(INK['050'], 0.45);
      ctx.lineWidth = r * 0.04;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 0.3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.fillStyle = withAlpha(INK['050'], 0.75);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'forgeheart': {
      // A molten heart behind a grille.
      const heat = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.55);
      heat.addColorStop(0, lighten(FX.gold, 0.3));
      heat.addColorStop(1, withAlpha(FX.ember, 0));
      ctx.fillStyle = heat;
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.5 + 0.04 * Math.sin(t * 6)), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(INK['950'], 0.7);
      ctx.lineWidth = r * 0.07;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.18, -r * 0.45);
        ctx.lineTo(i * r * 0.18, r * 0.45);
        ctx.stroke();
      }
      break;
    }
    case 'hollow-king': {
      // A skull's two hollows and the band of the crown.
      ctx.fillStyle = withAlpha(INK['950'], 0.85);
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(dir * r * 0.3, 0, r * 0.15, r * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = lighten(FX.gold, 0.1);
      ctx.fillRect(-r * 0.7, -r * 0.62, r * 1.4, r * 0.14);
      break;
    }
    case 'blight': {
      // Veins running out of a beating core.
      ctx.strokeStyle = withAlpha(lighten(FX.blood, 0.3), 0.55);
      ctx.lineWidth = r * 0.05;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(Math.cos(a + 0.4) * r * 0.5, Math.sin(a + 0.4) * r * 0.5, Math.cos(a) * r, Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.fillStyle = lighten(FX.blood, 0.15 + 0.15 * Math.sin(t * 5));
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      const exhaustive: never = def.id;
      return exhaustive;
    }
  }
}

/** The Prism's mirror: bright arcs of glass turning round it. */
export function paintFacets(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, facets: readonly { angle: number; arc: number }[]): void {
  if (facets.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (const f of facets) {
    ctx.strokeStyle = withAlpha(INK['050'], 0.85);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.25, f.angle - f.arc / 2, f.angle + f.arc / 2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(FX.frost, 0.8);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The Hollow King's shades: his silhouette, see-through, at his size. The
 * crowned body, his own or a shade, wears a gold ring above it.
 */
export function paintCourt(
  ctx: CanvasRenderingContext2D, run: RunState, alpha: number, time: number,
): void {
  const b = run.boss;
  if (!b || b.killedIn !== null) return;
  const def = BOSS_BY_ID[b.id];
  for (const e of run.enemies) {
    if (!e.alive || (e.court === 0 && e.id !== b.enemy)) continue;
    const x = e.px + (e.x - e.px) * alpha;
    const y = e.py + (e.y - e.py) * alpha;
    if (e.court) {
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = 0.45;
      traceBoss(ctx, def.id, e.radius, time);
      ctx.fillStyle = mix(def.color, INK['950'], 0.3);
      ctx.fill();
      ctx.strokeStyle = def.borderColor;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
    if (e.id === b.crown) {
      ctx.strokeStyle = lighten(FX.gold, 0.2);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(x, y - e.radius * 1.3, e.radius * 0.45, e.radius * 0.14, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** Molten pools at the wall (Forgeheart): a glowing spill, crusting as it cools. */
export function paintPools(ctx: CanvasRenderingContext2D, pools: readonly MoltenPool[], simTime: number, time: number): void {
  for (const p of pools) {
    const left = Math.min(1, (p.until - simTime) / 1.5);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
    g.addColorStop(0, withAlpha(lighten(FX.gold, 0.2), 0.75 * left));
    g.addColorStop(0.6, withAlpha(FX.ember, 0.55 * left));
    g.addColorStop(1, withAlpha(FX.ember, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * (1 + 0.04 * Math.sin(time * 4 + p.x)), 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The boss: its body, its wind-up tell, its enrage, or — under the water —
 * only the ripples where it went down.
 */
export function paintBoss(
  ctx: CanvasRenderingContext2D, e: Enemy, b: BossState, alpha: number, tick: number, simTime: number, time: number,
): void {
  const def = BOSS_BY_ID[b.id];
  const x = e.px + (e.x - e.px) * alpha;
  const y = e.py + (e.y - e.py) * alpha;
  const r = e.radius;
  if (e.hiddenUntil > simTime) {
    // Submerged: rings on the water.
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const k = ((time * 0.8 + i / 3) % 1);
      ctx.strokeStyle = withAlpha(def.borderColor, 0.5 * (1 - k));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y, r * (0.4 + k), r * (0.25 + k * 0.6), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(x, y);
  // Shadow.
  ctx.fillStyle = withAlpha(INK['950'], 0.45);
  ctx.beginPath();
  ctx.ellipse(-Math.cos(LIGHT_ANGLE) * 8, -Math.sin(LIGHT_ANGLE) * 8, r * 1.15, r * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();

  if (b.enraged) {
    ctx.fillStyle = withAlpha(FX.blood, 0.18 + 0.1 * Math.sin(time * 8));
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const breathe = 1 + 0.02 * Math.sin(time * 2.2);
  traceBoss(ctx, def.id, r * breathe, time);
  const lx = Math.cos(LIGHT_ANGLE);
  const ly = Math.sin(LIGHT_ANGLE);
  const body = ctx.createLinearGradient(lx * r, ly * r, -lx * r, -ly * r);
  body.addColorStop(0, lighten(def.color, 0.25));
  body.addColorStop(0.55, def.color);
  body.addColorStop(1, mix(def.color, INK['950'], 0.55));
  ctx.fillStyle = body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  paintDetail(ctx, def, r, time);
  ctx.restore();
  traceBoss(ctx, def.id, r * breathe, time);
  ctx.strokeStyle = def.borderColor;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Hit flash.
  const sinceHit = tick - e.hitTick;
  if (e.hitTick >= 0 && sinceHit < 4) {
    ctx.globalAlpha = 0.35 * (1 - sinceHit / 4);
    traceBoss(ctx, def.id, r * breathe, time);
    ctx.fillStyle = INK['050'];
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // The wind-up: a tightening ring and a glowing body — the tell a Nova answers.
  if (b.windup > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 18);
    ctx.strokeStyle = withAlpha(FX.blood, 0.6 + 0.4 * pulse);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, r * (1.25 + b.windup * 0.5), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.25 + 0.2 * pulse;
    traceBoss(ctx, def.id, r * breathe, time);
    ctx.fillStyle = lighten(FX.blood, 0.3);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (b.staggeredUntil > simTime) {
    // Staggered: stars of light circling its crown.
    ctx.fillStyle = lighten(FX.gold, 0.4);
    for (let i = 0; i < 3; i++) {
      const a = time * 5 + (i / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.6, -r * 1.05 + Math.sin(a) * r * 0.15, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** A Spitter's shot: a wet glob trailing back toward where it came from. */
export function paintShots(ctx: CanvasRenderingContext2D, shots: readonly HostileShot[], alpha: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  for (const s of shots) {
    const x = s.px + (s.x - s.px) * alpha;
    const y = s.py + (s.y - s.py) * alpha;
    ctx.strokeStyle = withAlpha(FX.blood, 0.45);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x - s.vx * 0.06, y - s.vy * 0.06);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = lighten(FX.blood, 0.25);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A shockwave rolling out from a slam. */
export function paintRings(ctx: CanvasRenderingContext2D, rings: readonly SlamRing[]): void {
  ctx.save();
  for (const r of rings) {
    const fade = r.hit ? 0.35 : 0.85;
    ctx.strokeStyle = withAlpha(FX.blood, fade);
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(lighten(FX.blood, 0.5), fade * 0.8);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}

/** Aegis: a gold dome over the tower while it holds. */
export function paintAegis(ctx: CanvasRenderingContext2D, R: number, left: number, time: number): void {
  const fade = Math.min(1, left * 2);
  ctx.save();
  const g = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 1.9);
  g.addColorStop(0, withAlpha(FX.gold, 0));
  g.addColorStop(0.75, withAlpha(FX.gold, 0.22 * fade));
  g.addColorStop(1, withAlpha(FX.gold, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(lighten(FX.gold, 0.3), (0.6 + 0.3 * Math.sin(time * 6)) * fade);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
