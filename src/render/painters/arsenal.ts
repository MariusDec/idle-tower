import type { Enemy, FirePatch, RunState, WeaponState } from '../../sim/state';
import { armed } from '../../sim/systems/arms';
import { bladeOrbit, storms } from '../../sim/systems/combat';
import { BALANCE } from '../../content/balance';
import { FX, INK, lighten, mix, withAlpha } from '../palette';

/**
 * What the arsenal puts in the field besides projectiles (§4.4, §10.5): the
 * Sunlance's beam, Glaives' blades, Sentinel Drones, Storm Crown's storms,
 * Meteorfall's burning ground, and the marks a weapon leaves on a body
 * (burning, frozen). Reads the run; writes nothing.
 */

/** Burning ground, under the bodies. */
export function paintFires(ctx: CanvasRenderingContext2D, fires: readonly FirePatch[], time: number, clock: number): void {
  if (fires.length === 0) return;
  ctx.save();
  for (const f of fires) {
    const left = Math.min(1, (f.until - time) / 0.6);
    const flicker = 0.85 + 0.15 * Math.sin(clock * 11 + f.x);
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius);
    g.addColorStop(0, withAlpha(FX.gold, 0.45 * left * flicker));
    g.addColorStop(0.55, withAlpha(FX.ember, 0.35 * left * flicker));
    g.addColorStop(1, withAlpha(FX.ember, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A body on fire flickers ember; a frozen one is cased in frost. Over the bodies. */
export function paintStatus(ctx: CanvasRenderingContext2D, enemies: readonly Enemy[], alpha: number, time: number, clock: number): void {
  ctx.save();
  ctx.lineWidth = 3;
  for (const e of enemies) {
    if (!e.alive) continue;
    const burning = e.burnUntil > time;
    const frozen = e.frozenUntil > time;
    if (!burning && !frozen) continue;
    const x = e.px + (e.x - e.px) * alpha;
    const y = e.py + (e.y - e.py) * alpha;
    if (frozen) {
      ctx.fillStyle = withAlpha(FX.frost, 0.35);
      ctx.strokeStyle = withAlpha(lighten(FX.frost, 0.5), 0.9);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const r = e.radius * 1.15;
        if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    if (burning) {
      const f = 0.6 + 0.4 * Math.abs(Math.sin(clock * 13 + e.id));
      ctx.strokeStyle = withAlpha(FX.ember, 0.75 * f);
      ctx.beginPath();
      ctx.arc(x, y - e.radius * 0.2, e.radius * (0.95 + 0.1 * f), Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Every carried weapon's field presence, over the bodies. */
export function paintArsenal(ctx: CanvasRenderingContext2D, run: RunState, alpha: number, clock: number, additive: boolean): void {
  ctx.save();
  ctx.lineCap = 'round';
  for (const w of run.weapons) {
    switch (w.id) {
      case 'sunlance':
        paintBeam(ctx, run, w, alpha, clock, additive);
        break;
      case 'glaives':
        paintBlades(ctx, run, w, clock);
        break;
      case 'sentinel-drones':
        paintDrones(ctx, w, alpha, clock);
        break;
      case 'chain-lightning':
        if (w.evolved) paintStorms(ctx, run, w, clock, additive);
        break;
      case 'arcane-bolt':
      case 'scattershot':
      case 'frost-ring':
      case 'mortar':
        break;
      default: {
        const exhaustive: never = w.id;
        ctx.restore();
        return exhaustive;
      }
    }
  }
  ctx.restore();
}

function paintBeam(ctx: CanvasRenderingContext2D, run: RunState, w: WeaponState, alpha: number, clock: number, additive: boolean): void {
  if (!w.beamTarget) return;
  const t = run.enemies.find((e) => e.id === w.beamTarget && e.alive);
  if (!t) return;
  const p = armed(run.stats, w);
  const tx = t.px + (t.x - t.px) * alpha;
  const ty = t.py + (t.y - t.py) * alpha;
  const a = Math.atan2(ty, tx);
  const start = run.stats.radius * 0.7;
  const sx = Math.cos(a) * start;
  const sy = Math.sin(a) * start;
  // A piercing lance runs on to the edge of range.
  const reach = p.pierce > 0 ? run.stats.range : Math.hypot(tx, ty);
  const ex = Math.cos(a) * reach;
  const ey = Math.sin(a) * reach;
  const heat = (w.heat - 1) / Math.max(1e-6, p.rampCap - 1);
  const full = w.evolved && w.heat >= p.rampCap;
  const shimmer = 0.85 + 0.15 * Math.sin(clock * 40);
  ctx.save();
  if (additive) ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = withAlpha(mix(FX.gold, FX.ember, heat * 0.6), 0.35 * shimmer);
  ctx.lineWidth = 10 + heat * 12 + (full ? 6 : 0);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.strokeStyle = lighten(FX.gold, 0.5 + heat * 0.3);
  ctx.lineWidth = 3 + heat * 3;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.fillStyle = withAlpha(lighten(FX.gold, 0.6), 0.8 * shimmer);
  ctx.beginPath();
  ctx.arc(tx, ty, 6 + heat * 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintBlades(ctx: CanvasRenderingContext2D, run: RunState, w: WeaponState, clock: number): void {
  const p = armed(run.stats, w);
  const r = bladeOrbit(run, w, p);
  // The track: faint, so the eye reads the reach.
  ctx.strokeStyle = withAlpha(INK['200'], w.evolved ? 0.18 : 0.1);
  ctx.lineWidth = p.blade * 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  const edge = w.evolved ? lighten(FX.gold, 0.3) : INK['100'];
  for (let k = 0; k < p.count; k++) {
    const a = w.spin + (k / p.count) * Math.PI * 2;
    ctx.save();
    ctx.translate(Math.cos(a) * r, Math.sin(a) * r);
    ctx.rotate(a + clock * 14);
    const s = p.blade;
    ctx.fillStyle = INK['300'];
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const b = (i / 3) * Math.PI * 2;
      ctx.moveTo(Math.cos(b) * s * 0.25, Math.sin(b) * s * 0.25);
      ctx.quadraticCurveTo(Math.cos(b + 0.6) * s * 1.1, Math.sin(b + 0.6) * s * 1.1, Math.cos(b + 1.2) * s, Math.sin(b + 1.2) * s);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function paintDrones(ctx: CanvasRenderingContext2D, w: WeaponState, alpha: number, clock: number): void {
  for (const d of w.drones) {
    const x = d.px + (d.x - d.px) * alpha;
    const y = d.py + (d.y - d.py) * alpha;
    const called = d.until !== null;
    const tint = called ? FX.gold : FX.mana;
    ctx.fillStyle = withAlpha(INK['950'], 0.3);
    ctx.beginPath();
    ctx.ellipse(x + 4, y + 10, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(lighten(tint, 0.4), 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 12, clock * 20, clock * 20 + Math.PI * 1.4);
    ctx.stroke();
    ctx.fillStyle = mix(tint, INK['800'], 0.35);
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 7, y);
    ctx.lineTo(x, y + 8);
    ctx.lineTo(x - 7, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = lighten(tint, 0.6);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintStorms(ctx: CanvasRenderingContext2D, run: RunState, w: WeaponState, clock: number, additive: boolean): void {
  const R = BALANCE.tower.radius;
  ctx.save();
  if (additive) ctx.globalCompositeOperation = 'lighter';
  for (const s of storms(run, w)) {
    for (let i = 0; i < 3; i++) {
      const a = clock * (2 + i) + i * 2.1;
      ctx.fillStyle = withAlpha(FX.frost, 0.16);
      ctx.beginPath();
      ctx.arc(s.x + Math.cos(a) * R * 0.25, s.y + Math.sin(a) * R * 0.25, R * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = withAlpha(lighten(FX.frost, 0.6), 0.5 + 0.5 * Math.abs(Math.sin(clock * 17)));
    ctx.beginPath();
    ctx.arc(s.x, s.y, R * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
