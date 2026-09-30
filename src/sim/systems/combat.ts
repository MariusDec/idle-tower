import { Rng } from '../../core/rng';
import { WEAPON_BY_ID } from '../../content/weapons';
import type { Enemy, Projectile, RunState } from '../state';
import { mitigate } from './damage';

/** How close a projectile must pass, beyond the body radius, to hit. */
const HIT_PAD = 6;
/** How far a bolt whose target died looks for a new one. */
const RETARGET_RADIUS = 220;

/** The nearest living enemy to (x, y) within `radius`, or null. */
export function nearestEnemy(run: RunState, x: number, y: number, radius: number): Enemy | null {
  let best: Enemy | null = null;
  let bestD = radius * radius;
  for (const e of run.enemies) {
    if (!e.alive) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function enemyById(run: RunState, id: number): Enemy | null {
  // Linear, but only on the rare retarget path; enemies stay sorted by id.
  for (const e of run.enemies) if (e.id === id) return e.alive ? e : null;
  return null;
}

/** Weapons fire at the nearest enemy in range (§4.4). */
export function tickWeapons(run: RunState, dt: number): void {
  const crit = Rng.wrap(run.streams.crit);
  for (const w of run.weapons) {
    w.cooldown = Math.max(0, w.cooldown - dt);
    if (w.cooldown > 0) continue;
    const target = nearestEnemy(run, 0, 0, run.stats.range);
    if (!target) continue;
    const def = WEAPON_BY_ID[w.id];
    w.cooldown = 1 / (def.fireRate * run.stats.fireRateMult);
    const angle = Math.atan2(target.y, target.x);
    const isCrit = crit.chance(run.stats.critChance);
    const start = run.stats.radius * 0.6;
    const x = Math.cos(angle) * start;
    const y = Math.sin(angle) * start;
    run.projectiles.push({
      alive: true,
      weapon: w.id,
      x, y, px: x, py: y,
      vx: Math.cos(angle) * def.projectileSpeed,
      vy: Math.sin(angle) * def.projectileSpeed,
      speed: def.projectileSpeed,
      damage: def.damage * run.stats.damageMult * (isCrit ? run.stats.critMult : 1),
      crit: isCrit,
      target: target.id,
      life: def.projectileLife,
    });
    run.tower.aim = angle;
    run.events.push({ kind: 'fire', weapon: w.id, angle });
  }
}

/** Homing bolts: steer at the target, retarget when it dies, fizzle when nothing is near. */
export function tickProjectiles(run: RunState, dt: number): void {
  for (const p of run.projectiles) {
    p.px = p.x;
    p.py = p.y;
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.alive = false;
      continue;
    }
    let target = p.target ? enemyById(run, p.target) : null;
    if (!target) {
      target = nearestEnemy(run, p.x, p.y, RETARGET_RADIUS);
      p.target = target ? target.id : 0;
    }
    if (target) {
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.vx = (dx / d) * p.speed;
      p.vy = (dy / d) * p.speed;
      const reach = target.radius + HIT_PAD;
      // Swept: a bolt that would pass through its target this step hits it.
      if (d <= reach + p.speed * dt) {
        hit(run, p, target);
        continue;
      }
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function hit(run: RunState, p: Projectile, e: Enemy): void {
  p.alive = false;
  const amount = mitigate(p.damage, e.armor);
  e.hp -= amount;
  e.hitTick = run.tick;
  run.events.push({ kind: 'hit', x: e.x, y: e.y, amount, crit: p.crit });
  if (e.hp <= 0) kill(run, e);
}

export function kill(run: RunState, e: Enemy): void {
  if (!e.alive) return;
  e.alive = false;
  run.kills++;
  if (run.current && e.wave === run.current.n) run.current.alive--;
  run.events.push({ kind: 'kill', x: e.x, y: e.y, enemy: e.type, radius: e.radius });
}

export function sweepProjectiles(run: RunState): void {
  let w = 0;
  const list = run.projectiles;
  for (let i = 0; i < list.length; i++) {
    if (list[i].alive) list[w++] = list[i];
  }
  list.length = w;
}
