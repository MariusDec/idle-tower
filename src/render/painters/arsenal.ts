import type { Enemy, FirePatch, Rune, RunState, WeaponState } from '../../sim/state';
import { armed, mountOf, muzzle } from '../../sim/systems/arms';
import { bladeOrbit, gyreOrbit, storms } from '../../sim/systems/combat';
import { BALANCE } from '../../content/balance';
import { FX, INK, lighten, mix, withAlpha } from '../palette';
import { drawGlow } from '../glow';

/**
 * What the arsenal puts in the field besides projectiles (§4.4, §10.5): the
 * Sunlance's beam, Glaives' blades, Sentinel Drones, Storm Crown's storms,
 * Meteorfall's burning ground, Rune Traps' runes and Soul Tether's threads
 * (§9), and the marks a weapon leaves on a body (burning, frozen, gilded).
 * Reads the run; writes nothing.
 */

/** Runes on the ground, under the bodies: dim while arming, bright once armed. */
export function paintRunes(ctx: CanvasRenderingContext2D, runes: readonly Rune[], time: number, clock: number): void {
  if (runes.length === 0) return;
  ctx.save();
  for (const r of runes) {
    const armed = r.armAt <= time;
    const fade = Math.min(1, (r.until - time) / 0.8);
    const a = (r.echo ? 0.5 : 1) * fade * (armed ? 0.75 + 0.25 * Math.sin(clock * 6 + r.x) : 0.35);
    const s = 13;
    ctx.strokeStyle = withAlpha(FX.arcane, a);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(r.x, r.y, s, 0, Math.PI * 2);
    ctx.stroke();
    // A five-pointed glyph inside the circle.
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const t = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      const px = r.x + Math.cos(t) * s * 0.8;
      const py = r.y + Math.sin(t) * s * 0.8;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Burning ground, under the bodies. */
export function paintFires(ctx: CanvasRenderingContext2D, fires: readonly FirePatch[], time: number, clock: number): void {
  if (fires.length === 0) return;
  ctx.save();
  for (const f of fires) {
    const left = Math.min(1, (f.until - time) / 0.6);
    const flicker = 0.85 + 0.15 * Math.sin(clock * 11 + f.x);
    drawGlow(ctx, [
      { at: 0, color: withAlpha(FX.gold, 0.45) },
      { at: 0.55, color: withAlpha(FX.ember, 0.35) },
      { at: 1, color: withAlpha(FX.ember, 0) },
    ], f.x, f.y, f.radius, left * flicker);
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
    const gilded = e.gildedUntil > time;
    if (!burning && !frozen && !gilded) continue;
    const x = e.px + (e.x - e.px) * alpha;
    const y = e.py + (e.y - e.py) * alpha;
    if (gilded) {
      // Midas Lance (§9): a gold rim, and it pays double.
      ctx.strokeStyle = withAlpha(FX.gold, 0.85);
      ctx.beginPath();
      ctx.arc(x, y, e.radius * 1.12, 0, Math.PI * 2);
      ctx.stroke();
    }
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
        if (w.anomaly === 'lighthouse') paintLighthouse(ctx, run, w, clock, additive);
        else paintBeam(ctx, run, w, alpha, clock, additive);
        break;
      case 'glaives':
        paintBlades(ctx, run, w, alpha, clock, additive);
        break;
      case 'frost-ring':
        if (w.anomaly === 'whiteout') paintWhiteout(ctx, run, w, alpha, clock, additive);
        break;
      case 'sentinel-drones':
        paintDrones(ctx, w, alpha, clock);
        break;
      case 'chain-lightning':
        if (w.evolved) paintStorms(ctx, run, w, clock, additive);
        break;
      case 'soul-tether':
        paintTethers(ctx, run, w, alpha, clock, additive);
        break;
      case 'arcane-bolt':
      case 'scattershot':
      case 'mortar':
      case 'moonblade':
      case 'rune-traps':
      case 'gilded-rail':
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
  // Silenced by a Harbinger, the beam is out.
  if (!w.beamTarget || w.silencedUntil > run.time) return;
  const t = run.enemies.find((e) => e.id === w.beamTarget && e.alive);
  if (!t) return;
  const p = armed(run.stats, w);
  const tx = t.px + (t.x - t.px) * alpha;
  const ty = t.py + (t.y - t.py) * alpha;
  // From the lens on its mount.
  const m = mountOf(run, w);
  const a = Math.atan2(ty - m.y, tx - m.x);
  const { x: sx, y: sy } = muzzle(run, w, a);
  // A piercing lance runs on to the edge of range.
  const reach = p.pierce > 0 ? run.stats.range : Math.hypot(tx - m.x, ty - m.y);
  const ex = m.x + Math.cos(a) * reach;
  const ey = m.y + Math.sin(a) * reach;
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

/** Soul Tether's threads: a wavering green line from its spindle to each body it holds. */
function paintTethers(ctx: CanvasRenderingContext2D, run: RunState, w: WeaponState, alpha: number, clock: number, additive: boolean): void {
  if (w.tethers.length === 0 || w.silencedUntil > run.time) return;
  const m = mountOf(run, w);
  ctx.save();
  if (additive) ctx.globalCompositeOperation = 'lighter';
  const tint = w.evolved ? lighten(FX.nature, 0.35) : FX.nature;
  for (const id of w.tethers) {
    const e = run.enemies.find((x) => x.id === id && x.alive);
    if (!e) continue;
    const tx = e.px + (e.x - e.px) * alpha;
    const ty = e.py + (e.y - e.py) * alpha;
    const a = Math.atan2(ty - m.y, tx - m.x);
    const { x: sx, y: sy } = muzzle(run, w, a);
    const mx = (sx + tx) / 2 - Math.sin(a) * 14 * Math.sin(clock * 7 + id);
    const my = (sy + ty) / 2 + Math.cos(a) * 14 * Math.sin(clock * 7 + id);
    ctx.strokeStyle = withAlpha(tint, 0.3);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, tx, ty);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(lighten(tint, 0.4), 0.85);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The anomaly's signature (plans/late-game/04 §4): its key shape drawn again
 * 1.5 px apart in mana and ember, faint, so it reads as *wrong* at a glance.
 * Not on the lowest quality tier, which has no additive pass.
 */
function split(ctx: CanvasRenderingContext2D, additive: boolean, draw: (dx: number, tint: string) => void): void {
  if (!additive) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  draw(-1.5, withAlpha(FX.mana, 0.35));
  draw(1.5, withAlpha(FX.ember, 0.3));
  ctx.restore();
}

/** Whiteout: a soft frost disc where the storm stands, flakes swirling round it. */
function paintWhiteout(ctx: CanvasRenderingContext2D, run: RunState, w: WeaponState, alpha: number, clock: number, additive: boolean): void {
  // The sim makes the storm on its first step; the painter never writes the run.
  const c = w.cell;
  if (!c) return;
  const x = c.px + (c.x - c.px) * alpha;
  const y = c.py + (c.y - c.py) * alpha;
  const r = armed(run.stats, w).radius * BALANCE.anomalies.whiteout.radius;
  ctx.save();
  drawGlow(ctx, [
    { at: 0, color: withAlpha(lighten(FX.frost, 0.5), 0.28) },
    { at: 1, color: withAlpha(FX.frost, 0) },
  ], x, y, r, 1, 0.1);
  const flakes = additive ? 14 : 6;
  ctx.fillStyle = withAlpha(lighten(FX.frost, 0.7), 0.75);
  for (let i = 0; i < flakes; i++) {
    const a = clock * (1.4 + (i % 3) * 0.3) + i * 2.4;
    const d = r * (0.25 + 0.7 * ((i * 0.37) % 1));
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 2 + (i % 2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  split(ctx, additive, (dx, tint) => {
    ctx.strokeStyle = tint;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + dx, y, r * 0.92, 0, Math.PI * 2);
    ctx.stroke();
  });
}

/** Lighthouse: a full-range wedge from its lens, an afterglow fading behind it. */
function paintLighthouse(ctx: CanvasRenderingContext2D, run: RunState, w: WeaponState, clock: number, additive: boolean): void {
  if (w.silencedUntil > run.time) return;
  const p = armed(run.stats, w);
  const m = mountOf(run, w);
  const range = run.stats.range;
  const a = w.spin;
  const heat = (w.heat - 1) / Math.max(1e-6, p.rampCap - 1);
  const shimmer = 0.85 + 0.15 * Math.sin(clock * 40);
  const half = BALANCE.anomalies.lighthouse.width / range;
  ctx.save();
  if (additive) ctx.globalCompositeOperation = 'lighter';
  // The afterglow: the last ~0.6 rad it swept, fading.
  const tail = 0.6;
  const steps = additive ? 6 : 3;
  for (let i = 0; i < steps; i++) {
    const b = a - (tail * (i + 1)) / steps;
    ctx.fillStyle = withAlpha(mix(FX.gold, FX.ember, heat * 0.6), 0.12 * (1 - i / steps));
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.arc(m.x, m.y, range, b, b + tail / steps);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = withAlpha(mix(FX.gold, FX.ember, heat * 0.6), 0.35 * shimmer);
  ctx.beginPath();
  ctx.moveTo(m.x, m.y);
  ctx.arc(m.x, m.y, range, a - half * 2, a + half * 2);
  ctx.closePath();
  ctx.fill();
  const { x: sx, y: sy } = muzzle(run, w, a);
  ctx.strokeStyle = lighten(FX.gold, 0.5 + heat * 0.3);
  ctx.lineWidth = 3 + heat * 3;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(m.x + Math.cos(a) * range, m.y + Math.sin(a) * range);
  ctx.stroke();
  ctx.restore();
  split(ctx, additive, (dx, tint) => {
    ctx.strokeStyle = tint;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + dx, sy);
    ctx.lineTo(m.x + Math.cos(a) * range + dx, m.y + Math.sin(a) * range);
    ctx.stroke();
  });
}

function paintBlades(ctx: CanvasRenderingContext2D, run: RunState, w: WeaponState, alpha: number, clock: number, additive: boolean): void {
  const p = armed(run.stats, w);
  // Gyre (plans/late-game/04): the blades circle their quarry, wherever it walks.
  const gyre = w.anomaly === 'gyre';
  const cell = gyre ? w.cell ?? null : null;
  const quarry = cell && cell.target ? run.enemies.find((e) => e.id === cell.target && e.alive) ?? null : null;
  const cx = cell ? cell.px + (cell.x - cell.px) * alpha : 0;
  const cy = cell ? cell.py + (cell.y - cell.py) * alpha : 0;
  const r = gyre ? gyreOrbit(w, p, quarry) : bladeOrbit(run, w, p);
  // The track: faint, so the eye reads the reach.
  ctx.strokeStyle = withAlpha(INK['200'], w.evolved || gyre ? 0.18 : 0.1);
  ctx.lineWidth = p.blade * 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (gyre) {
    split(ctx, additive, (dx, tint) => {
      ctx.strokeStyle = tint;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + dx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
  const edge = w.evolved ? lighten(FX.gold, 0.3) : INK['100'];
  for (let k = 0; k < p.count; k++) {
    const a = w.spin + (k / p.count) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
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
