import { Rng } from '../../core/rng';
import { BALANCE } from '../../content/balance';
import { WEAPON_BY_ID, weaponParams } from '../../content/weapons';
import type { WeaponParams } from '../../content/types';
import type { Enemy, Projectile, RunState, WeaponState } from '../state';
import { mitigate } from './damage';
import { gainXp } from './draft';

/** How close a projectile must pass, beyond the body radius, to hit. */
const HIT_PAD = 6;
/** How far a bolt whose target died looks for a new one. */
const RETARGET_RADIUS = 220;
/** Angle between the bolts of one volley as they leave the tower, radians. */
const VOLLEY_FAN = 0.3;

/** The nearest living enemy to (x, y) within `radius`, or null. `exclude` is skipped. */
export function nearestEnemy(run: RunState, x: number, y: number, radius: number, exclude = 0): Enemy | null {
  let best: Enemy | null = null;
  let bestD = radius * radius;
  for (const e of run.enemies) {
    if (!e.alive || e.id === exclude) continue;
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

/** Up to `n` living enemies within `radius` of the tower, nearest first. */
function nearestToTower(run: RunState, radius: number, n: number): Enemy[] {
  const r2 = radius * radius;
  const inRange: { e: Enemy; d: number }[] = [];
  for (const e of run.enemies) {
    if (!e.alive) continue;
    const d = e.x * e.x + e.y * e.y;
    if (d <= r2) inRange.push({ e, d });
  }
  // Ties broken by id so the order never depends on sort stability.
  inRange.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
  return inRange.slice(0, n).map((x) => x.e);
}

function enemyById(run: RunState, id: number): Enemy | null {
  // Linear, but only on the rare retarget path; enemies stay sorted by id.
  for (const e of run.enemies) if (e.id === id) return e.alive ? e : null;
  return null;
}

/** One hit's damage, crit rolled. */
function rollHit(run: RunState, p: WeaponParams, crit: Rng): { damage: number; crit: boolean } {
  const isCrit = crit.chance(run.stats.critChance);
  return { damage: p.damage * run.stats.damageMult * (isCrit ? run.stats.critMult : 1), crit: isCrit };
}

/** Weapons fire at the nearest enemy in range, each in its own pattern (§4.4). */
export function tickWeapons(run: RunState, dt: number): void {
  const crit = Rng.wrap(run.streams.crit);
  for (const w of run.weapons) {
    w.cooldown = Math.max(0, w.cooldown - dt);
    if (w.cooldown > 0) continue;
    const target = nearestEnemy(run, 0, 0, run.stats.range);
    if (!target) continue;
    const p = weaponParams(w.id, w.level);
    w.cooldown = 1 / (p.fireRate * run.stats.fireRateMult);
    const angle = Math.atan2(target.y, target.x);
    w.aim = angle;
    const pattern = WEAPON_BY_ID[w.id].pattern;
    switch (pattern) {
      case 'homing':
        fireVolley(run, w, p, target, angle, crit);
        break;
      case 'cone':
        fireCone(run, w, p, angle, crit);
        break;
      case 'chain':
        chainStrike(run, target, p, crit);
        break;
      default: {
        const exhaustive: never = pattern;
        return exhaustive;
      }
    }
    run.events.push({ kind: 'fire', weapon: w.id, angle });
  }
}

function launch(run: RunState, w: WeaponState, angle: number, over: Partial<Projectile>): void {
  const start = run.stats.radius * 0.6;
  const x = Math.cos(angle) * start;
  const y = Math.sin(angle) * start;
  const speed = weaponParams(w.id, w.level).projectileSpeed;
  run.projectiles.push({
    alive: true,
    weapon: w.id,
    x, y, px: x, py: y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    speed,
    damage: 0,
    crit: false,
    homing: false,
    target: 0,
    pierce: 0,
    ignore: 0,
    knockback: 0,
    life: 0,
    ...over,
  });
}

/** Homing bolts, one per body in reach, fanned as they leave the tower. */
function fireVolley(run: RunState, w: WeaponState, p: WeaponParams, first: Enemy, angle: number, crit: Rng): void {
  const targets = p.count > 1 ? nearestToTower(run, run.stats.range, p.count) : [first];
  for (let i = 0; i < p.count; i++) {
    const hit = rollHit(run, p, crit);
    launch(run, w, angle + (i - (p.count - 1) / 2) * VOLLEY_FAN, {
      ...hit,
      homing: true,
      target: targets[i % targets.length].id,
      pierce: p.pierce,
      life: BALANCE.projectiles.homingLife,
    });
  }
}

/** A fan of straight pellets that shove what they hit. */
function fireCone(run: RunState, w: WeaponState, p: WeaponParams, angle: number, crit: Rng): void {
  const life = (run.stats.range * BALANCE.projectiles.reach) / p.projectileSpeed;
  for (let i = 0; i < p.count; i++) {
    const offset = p.count === 1 ? 0 : p.spread * (i / (p.count - 1) - 0.5);
    launch(run, w, angle + offset, { ...rollHit(run, p, crit), pierce: p.pierce, knockback: p.knockback, life });
  }
}

/** Instant lightning: the first body, then leaps to the nearest unstruck one in reach. */
function chainStrike(run: RunState, first: Enemy, p: WeaponParams, crit: Rng): void {
  const struck: number[] = [];
  const start = run.stats.radius * 0.6;
  const a = Math.atan2(first.y, first.x);
  const points = [Math.cos(a) * start, Math.sin(a) * start];
  let cur: Enemy | null = first;
  for (let j = 0; j < p.jumps && cur; j++) {
    const hit = rollHit(run, p, crit);
    points.push(cur.x, cur.y);
    struck.push(cur.id);
    damageEnemy(run, cur, hit.damage, hit.crit);
    if (p.stun > 0 && cur.alive) cur.stunnedUntil = Math.max(cur.stunnedUntil, run.time + p.stun);
    cur = nearestUnstruck(run, cur.x, cur.y, p.jumpRange, struck);
  }
  run.events.push({ kind: 'chain', points });
}

function nearestUnstruck(run: RunState, x: number, y: number, radius: number, struck: readonly number[]): Enemy | null {
  let best: Enemy | null = null;
  let bestD = radius * radius;
  for (const e of run.enemies) {
    if (!e.alive || struck.includes(e.id)) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Projectiles: homing bolts steer and retarget; straight shots hit whatever they cross. */
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
    if (p.homing) {
      let target = p.target ? enemyById(run, p.target) : null;
      if (!target) {
        target = nearestEnemy(run, p.x, p.y, RETARGET_RADIUS, p.ignore);
        p.target = target ? target.id : 0;
      }
      if (target) {
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        p.vx = (dx / d) * p.speed;
        p.vy = (dy / d) * p.speed;
        // Swept: a bolt that would pass through its target this step hits it.
        if (d <= target.radius + HIT_PAD + p.speed * dt) {
          strike(run, p, target);
          if (!p.alive) continue;
        }
      }
    } else {
      const e = firstAlong(run, p, dt);
      if (e) {
        strike(run, p, e);
        if (!p.alive) continue;
      }
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

/** The first body a straight shot's path crosses this step, or null. */
function firstAlong(run: RunState, p: Projectile, dt: number): Enemy | null {
  const sx = p.vx * dt;
  const sy = p.vy * dt;
  const len2 = sx * sx + sy * sy || 1;
  let best: Enemy | null = null;
  let bestT = Infinity;
  for (const e of run.enemies) {
    if (!e.alive || e.id === p.ignore) continue;
    const t = Math.max(0, Math.min(1, ((e.x - p.x) * sx + (e.y - p.y) * sy) / len2));
    const cx = p.x + sx * t - e.x;
    const cy = p.y + sy * t - e.y;
    const r = e.radius + HIT_PAD;
    if (cx * cx + cy * cy <= r * r && t < bestT) {
      bestT = t;
      best = e;
    }
  }
  return best;
}

function strike(run: RunState, p: Projectile, e: Enemy): void {
  damageEnemy(run, e, p.damage, p.crit);
  if (p.knockback > 0 && e.alive) knockBack(e, p.knockback);
  if (p.pierce > 0) {
    p.pierce--;
    p.ignore = e.id;
    p.target = 0;
  } else {
    p.alive = false;
  }
}

/** Shove a body straight away from the tower; heavy bodies move less. */
export function knockBack(e: Enemy, push: number): void {
  const d = Math.hypot(e.x, e.y) || 1;
  const move = push / e.mass;
  e.x += (e.x / d) * move;
  e.y += (e.y / d) * move;
  e.inContact = false;
}

/** Armour-mitigated damage to one body. Returns what landed. */
export function damageEnemy(run: RunState, e: Enemy, raw: number, crit: boolean): number {
  const amount = mitigate(raw, e.armor);
  e.hp -= amount;
  e.hitTick = run.tick;
  run.events.push({ kind: 'hit', x: e.x, y: e.y, amount, crit });
  if (e.hp <= 0) kill(run, e);
  return amount;
}

export function kill(run: RunState, e: Enemy): void {
  if (!e.alive) return;
  e.alive = false;
  run.kills++;
  if (run.current && e.wave === run.current.n) run.current.alive--;
  run.events.push({ kind: 'kill', x: e.x, y: e.y, enemy: e.type, radius: e.radius });
  gainXp(run, e.xp);
  const u = run.ult;
  if (u.charge < 1) {
    u.charge = Math.min(1, u.charge + e.xp / u.need);
    if (u.charge >= 1) run.events.push({ kind: 'ultReady' });
  }
}

export function sweepProjectiles(run: RunState): void {
  let w = 0;
  const list = run.projectiles;
  for (let i = 0; i < list.length; i++) {
    if (list[i].alive) list[w++] = list[i];
  }
  list.length = w;
}
