import { ENEMY_BY_ID } from '../../content/enemies';
import type { EnemyDef, EnemyId } from '../../content/types';
import type { Enemy } from '../../sim/state';
import { FX, INK, withAlpha } from '../palette';

/**
 * Enemy bodies, salvaged from the legacy renderer's `paintEnemyBody`: a base
 * coat, a two-tone shade toward one key light, a contact shadow, a per-type
 * detail pass that says *what this is*, a rim light and an outline.
 *
 * Each type is baked once per view scale into an offscreen canvas at device
 * resolution; a frame pays one `drawImage` per enemy.
 */

/** The one key light, up and slightly left (legacy `TOWER_VISUAL.lightAngle`). */
export const LIGHT_ANGLE = -Math.PI * 0.62;

/** Least a detail stroke may measure, in device pixels, before it dissolves. */
const MIN_STROKE_PX = 1.25;

/** Per-type gait: bob frequency (Hz) and amplitude (world units). */
const GAIT: Record<EnemyId, { freq: number; bob: number }> = {
  grunt: { freq: 7, bob: 1.2 },
  runner: { freq: 15, bob: 2 },
  brute: { freq: 3.4, bob: 0.8 },
};

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Half the sprite's size in world units; it is drawn centred. */
  half: number;
}

export class EnemyPainter {
  private cache = new Map<EnemyId, Sprite>();
  private scale = 0;

  /** Drop the cache when the view scale changes; sprites rebake lazily. */
  setScale(scale: number): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.cache.clear();
  }

  private sprite(type: EnemyId): Sprite {
    let s = this.cache.get(type);
    if (!s) {
      s = bake(ENEMY_BY_ID[type], this.scale);
      this.cache.set(type, s);
    }
    return s;
  }

  /**
   * Draw every living enemy, interpolated `alpha` of the way from its last
   * position. `tick` is the sim tick, for the hit flash; `time` the wall
   * clock, for the gait.
   */
  draw(ctx: CanvasRenderingContext2D, enemies: readonly Enemy[], alpha: number, tick: number, time: number): void {
    for (const e of enemies) {
      if (!e.alive) continue;
      const x = e.px + (e.x - e.px) * alpha;
      const g = GAIT[e.type];
      const moving = !e.inContact;
      const y = e.py + (e.y - e.py) * alpha + (moving ? Math.sin(time * g.freq + e.id) * g.bob : 0);
      const s = this.sprite(e.type);
      ctx.drawImage(s.canvas, x - s.half, y - s.half, s.half * 2, s.half * 2);

      const sinceHit = tick - e.hitTick;
      if (e.hitTick >= 0 && sinceHit < 5) {
        ctx.globalAlpha = 0.65 * (1 - sinceHit / 5);
        ctx.fillStyle = INK['050'];
        ctx.beginPath();
        ctx.arc(x, y, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (e.hp < e.maxHp) drawHpBar(ctx, x, y - e.radius - 8, e.radius, e.hp / e.maxHp);
    }
  }
}

function drawHpBar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, frac: number): void {
  const w = Math.max(20, r * 1.8);
  const h = 4;
  ctx.fillStyle = withAlpha(INK['950'], 0.7);
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = FX.blood;
  ctx.fillRect(x - w / 2, y, w * Math.max(0, frac), h);
}

function bake(def: EnemyDef, scale: number): Sprite {
  const r = def.radius;
  const half = r * 1.35;
  const px = Math.max(8, Math.ceil(half * 2 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const g = canvas.getContext('2d')!;
  // Paint in world units about the centre.
  const k = px / (half * 2);
  g.setTransform(k, 0, 0, k, px / 2, px / 2);
  paintBody(g, def, r, (w) => Math.max(w, MIN_STROKE_PX / k));
  return { canvas, half };
}

function traceShape(g: CanvasRenderingContext2D, def: EnemyDef, r: number): void {
  g.beginPath();
  switch (def.shape) {
    case 'circle':
    case 'plated':
      g.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 'diamond':
      g.moveTo(0, -r);
      g.lineTo(r, 0);
      g.lineTo(0, r);
      g.lineTo(-r, 0);
      g.closePath();
      break;
    default: {
      const exhaustive: never = def.shape;
      return exhaustive;
    }
  }
}

function paintBody(g: CanvasRenderingContext2D, def: EnemyDef, r: number, pen: (w: number) => number): void {
  const lx = Math.cos(LIGHT_ANGLE);
  const ly = Math.sin(LIGHT_ANGLE);
  const span = r * 2.4;

  g.save();
  traceShape(g, def, r);
  g.clip();

  g.fillStyle = def.color;
  g.fillRect(-span, -span, span * 2, span * 2);

  // Two-tone: lit toward the key light, deep on the far side.
  const tone = g.createLinearGradient(lx * r, ly * r, -lx * r, -ly * r);
  tone.addColorStop(0, withAlpha(INK['050'], 0.3));
  tone.addColorStop(0.42, withAlpha(INK['050'], 0.04));
  tone.addColorStop(0.58, withAlpha(INK['950'], 0.1));
  tone.addColorStop(1, withAlpha(INK['950'], 0.5));
  g.fillStyle = tone;
  g.fillRect(-span, -span, span * 2, span * 2);

  // Contact shadow, hugging the unlit edge from the inside.
  const cx = -lx * r * 0.8;
  const cy = -ly * r * 0.8;
  const contact = g.createRadialGradient(cx, cy, r * 0.15, cx, cy, r * 1.15);
  contact.addColorStop(0, withAlpha(INK['950'], 0.4));
  contact.addColorStop(1, withAlpha(INK['950'], 0));
  g.fillStyle = contact;
  g.fillRect(-span, -span, span * 2, span * 2);

  paintDetail(g, def, r, pen);

  // Rim light: a fat stroke of the silhouette, clipped, so only the inner half survives.
  const rim = g.createLinearGradient(lx * r, ly * r, -lx * r * 0.5, -ly * r * 0.5);
  rim.addColorStop(0, withAlpha(INK['050'], 0.8));
  rim.addColorStop(0.55, withAlpha(INK['050'], 0.12));
  rim.addColorStop(1, withAlpha(INK['050'], 0));
  g.strokeStyle = rim;
  g.lineWidth = pen(r * 0.35);
  traceShape(g, def, r);
  g.stroke();
  g.restore();

  // Outline last, unclipped, so the silhouette holds against a lit floor.
  traceShape(g, def, r);
  g.strokeStyle = def.borderColor;
  g.lineWidth = pen(def.shape === 'plated' ? 3 : 2);
  g.lineJoin = 'round';
  g.stroke();
}

/** What this thing *is*, painted inside the clipped silhouette. */
function paintDetail(g: CanvasRenderingContext2D, def: EnemyDef, r: number, pen: (w: number) => number): void {
  const dark = (a: number): string => withAlpha(INK['950'], a);
  const pale = (a: number): string => withAlpha(INK['050'], a);
  switch (def.id) {
    // Grunt: a visor slit and two eye glints. The plainest, on purpose.
    case 'grunt': {
      g.fillStyle = dark(0.5);
      g.beginPath();
      g.ellipse(0, -r * 0.16, r * 0.66, r * 0.22, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = withAlpha(def.borderColor, 0.85);
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.arc(dir * r * 0.3, -r * 0.16, r * 0.1, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    // Runner: swept chevrons, so a pack reads as moving even at the wall.
    case 'runner': {
      g.strokeStyle = dark(0.45);
      g.lineWidth = pen(r * 0.16);
      g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const x = -r * 0.5 + i * r * 0.38;
        g.beginPath();
        g.moveTo(x, -r * 0.34);
        g.lineTo(x + r * 0.26, 0);
        g.lineTo(x, r * 0.34);
        g.stroke();
      }
      break;
    }
    // Brute: overlapping armour plates toward the light, rivets on each seam.
    case 'brute': {
      const light = LIGHT_ANGLE;
      for (const [outer, inner, w] of [[1, 0.76, 0.52], [0.76, 0.54, 0.46], [0.54, 0.3, 0.38]] as const) {
        const a0 = light - Math.PI * w;
        const a1 = light + Math.PI * w;
        g.beginPath();
        g.arc(0, 0, r * outer, a0, a1);
        g.arc(0, 0, r * inner, a1, a0, true);
        g.closePath();
        g.fillStyle = pale(0.1);
        g.fill();
        g.strokeStyle = dark(0.6);
        g.lineWidth = pen(r * 0.07);
        g.stroke();
        g.fillStyle = pale(0.34);
        for (const at of [-0.55, 0, 0.55]) {
          const a = light + at * Math.PI * w;
          const rad = (r * (outer + inner)) / 2;
          g.beginPath();
          g.arc(Math.cos(a) * rad, Math.sin(a) * rad, r * 0.06, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    default: {
      const exhaustive: never = def.id;
      return exhaustive;
    }
  }
}
