import { Rng } from '../../core/rng';
import { BALANCE } from '../../content/balance';
import { AURA_BY_ID, ENEMY_BY_ID } from '../../content/enemies';
import { eliteRelics } from '../../content/relics';
import { regionByIndex } from '../../content/regions';
import { WEAPON_BY_ID, weaponParams } from '../../content/weapons';
import type { WeaponParams, WeaponPattern } from '../../content/types';
import type { Enemy, Projectile, RunState, WeaponState } from '../state';
import { onBossKilled } from './boss';
import { mitigate } from './damage';
import { gainXp } from './draft';
import { spawnEnemy } from './waves';

/** How close a projectile must pass, beyond the body radius, to hit. */
const HIT_PAD = 6;
/** How far a bolt whose target died looks for a new one. */
const RETARGET_RADIUS = 220;
/** Angle between the bolts of one volley as they leave the tower, radians. */
const VOLLEY_FAN = 0.3;

/**
 * What dealt a hit: a weapon's pattern, the ultimate, or the wall itself.
 * Bog Lantern reads it; an Overkill carry never carries again.
 */
export type DamageSource = WeaponPattern | 'nova' | 'thorns' | 'reflect' | 'overkill';

/** Sources that count as lightning, frost or Nova for Bog Lantern (§11.5). */
const STORM: ReadonlySet<DamageSource> = new Set<DamageSource>(['chain', 'pulse', 'nova']);

/** A body that can be targeted and hit: alive and not under the water. */
function targetable(run: RunState, e: Enemy): boolean {
  return e.alive && e.hiddenUntil <= run.time;
}

/** The nearest targetable enemy to (x, y) within `radius`, or null. `exclude` is skipped. */
export function nearestEnemy(run: RunState, x: number, y: number, radius: number, exclude = 0): Enemy | null {
  let best: Enemy | null = null;
  let bestD = radius * radius;
  for (const e of run.enemies) {
    if (!targetable(run, e) || e.id === exclude) continue;
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

/** Up to `n` targetable enemies within `radius` of the tower, nearest first. */
function nearestToTower(run: RunState, radius: number, n: number): Enemy[] {
  const r2 = radius * radius;
  const inRange: { e: Enemy; d: number }[] = [];
  for (const e of run.enemies) {
    if (!targetable(run, e)) continue;
    const d = e.x * e.x + e.y * e.y;
    if (d <= r2) inRange.push({ e, d });
  }
  // Ties broken by id so the order never depends on sort stability.
  inRange.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
  return inRange.slice(0, n).map((x) => x.e);
}

function enemyById(run: RunState, id: number): Enemy | null {
  // Linear, but only on the rare retarget path; enemies stay sorted by id.
  for (const e of run.enemies) if (e.id === id) return targetable(run, e) ? e : null;
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
  const B = BALANCE.behaviours;
  // Last Stand (§11.4): the tower fights harder near the end.
  const desperate = run.behaviours['last-stand'] && run.tower.hp < run.stats.maxHp * B.lastStandBelow;
  const rateMult = run.stats.fireRateMult * (desperate ? 1 + B.lastStandSpeed : 1);
  for (const w of run.weapons) {
    w.cooldown -= dt;
    if (w.cooldown > 0) continue;
    const p = weaponParams(w.id, w.level);
    const pattern = WEAPON_BY_ID[w.id].pattern;
    // A pulse needs a body inside its own radius; everything else, inside range.
    const target = nearestEnemy(run, 0, 0, pattern === 'pulse' ? p.radius : run.stats.range);
    if (!target) {
      // Idle: ready to fire the moment something enters range, with no backlog.
      w.cooldown = 0;
      continue;
    }
    // Carry the overshoot into the next interval, so the fire rate is exact
    // rather than rounded up to whole steps (a +12% Haste stays +12%). At
    // most one attack per step, so the carry never builds up past one step.
    w.cooldown = Math.max(0, w.cooldown + 1 / (p.fireRate * rateMult));
    const angle = Math.atan2(target.y, target.x);
    w.aim = angle;
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
      case 'pulse':
        frostPulse(run, p, crit);
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
    damageEnemy(run, cur, hit.damage, hit.crit, 'chain');
    if (p.stun > 0 && cur.alive) cur.stunnedUntil = Math.max(cur.stunnedUntil, run.time + p.stun);
    cur = nearestUnstruck(run, cur.x, cur.y, p.jumpRange, struck);
  }
  run.events.push({ kind: 'chain', points });
}

/** Frost Ring: every body within the pulse is hit and slowed (§11.2). */
function frostPulse(run: RunState, p: WeaponParams, crit: Rng): void {
  const r2 = p.radius * p.radius;
  // Only what was there when it went off: a Splitter's fragments, born of
  // this pulse's kill, are the next pulse's (§11.1: AoE *after* the split).
  const n = run.enemies.length;
  for (let i = 0; i < n; i++) {
    const e = run.enemies[i];
    if (!targetable(run, e) || e.x * e.x + e.y * e.y > r2) continue;
    const hit = rollHit(run, p, crit);
    damageEnemy(run, e, hit.damage, hit.crit, 'pulse');
    if (e.alive) {
      e.slow = Math.max(e.slowUntil > run.time ? e.slow : 0, p.slow);
      e.slowUntil = run.time + p.slowSeconds;
    }
  }
  run.events.push({ kind: 'pulse', radius: p.radius });
}

function nearestUnstruck(run: RunState, x: number, y: number, radius: number, struck: readonly number[]): Enemy | null {
  let best: Enemy | null = null;
  let bestD = radius * radius;
  for (const e of run.enemies) {
    if (!targetable(run, e) || struck.includes(e.id)) continue;
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
    if (!targetable(run, e) || e.id === p.ignore) continue;
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
  damageEnemy(run, e, p.damage, p.crit, WEAPON_BY_ID[p.weapon].pattern);
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

/** Relic rank numbers: rank n reads index n − 1. */
function rankValue(table: readonly number[], rank: number): number {
  return table[Math.min(rank, table.length) - 1];
}

/**
 * Everything the tower deals is scaled here, after the weapon's own numbers:
 * Hunter's Tally (kills this run), Stillwater Charm (a body standing still)
 * and a Shield elite's aura (§4.3, §11.5).
 */
function damageTaken(run: RunState, e: Enemy, raw: number): number {
  const R = BALANCE.relics;
  let out = raw * e.buffShield;
  const tally = run.behaviours.tally ?? 0;
  if (tally > 0) out *= 1 + rankValue(R.tally, tally) * Math.floor(run.kills / 100);
  const still = run.behaviours['still-target'] ?? 0;
  if (still > 0 && !e.moving) out *= 1 + rankValue(R.stillTarget, still);
  return out;
}

/**
 * Armour-mitigated damage to one body. Returns what landed. A submerged
 * body takes nothing.
 */
export function damageEnemy(run: RunState, e: Enemy, raw: number, crit: boolean, source: DamageSource = 'homing'): number {
  if (!targetable(run, e)) return 0;
  const B = BALANCE.behaviours;
  const before = e.hp;
  let amount = mitigate(damageTaken(run, e, raw), e.armor);
  // Executioner (§11.4): a hit on a body already this low finishes it. Not a boss.
  if (run.behaviours.executioner && !e.boss && e.hp - amount > 0 && e.hp <= e.maxHp * B.executeBelow) amount = e.hp;
  e.hp -= amount;
  e.hitTick = run.tick;
  run.events.push({ kind: 'hit', x: e.x, y: e.y, amount, crit });
  if (e.hp <= 0) {
    kill(run, e, source);
    // Overkill (§11.4): what the kill didn't need lands on the nearest body.
    const excess = amount - before;
    if (run.behaviours.overkill && source !== 'overkill' && excess > 0) {
      const next = nearestEnemy(run, e.x, e.y, B.overkillRange, e.id);
      if (next) damageEnemy(run, next, excess, false, 'overkill');
    }
  }
  return amount;
}

export function kill(run: RunState, e: Enemy, source: DamageSource = 'homing'): void {
  if (!e.alive) return;
  e.alive = false;
  run.kills++;
  if (run.current && e.wave === run.current.n) run.current.alive--;
  run.events.push({ kind: 'kill', x: e.x, y: e.y, enemy: e.type, radius: e.radius });
  const lantern = run.behaviours['storm-xp'] ?? 0;
  const xpMult = lantern > 0 && STORM.has(source) ? rankValue(BALANCE.relics.stormXp, lantern) : 1;
  gainXp(run, e.xp * xpMult);
  const shards = e.shards * run.stats.shardMult;
  run.shards += shards;
  if (e.boss) run.shardsFrom.boss += shards;
  else if (e.elite) run.shardsFrom.elites += shards;
  else run.shardsFrom.kills += shards;
  const u = run.ult;
  if (u.charge < 1) {
    u.charge = Math.min(1, u.charge + (e.xp * run.stats.ultChargeMult) / u.need);
    if (u.charge >= 1) run.events.push({ kind: 'ultReady' });
  }
  if (e.boss) {
    onBossKilled(run, e);
    return;
  }
  run.killsBy[e.type] = (run.killsBy[e.type] ?? 0) + 1;
  const verb = ENEMY_BY_ID[e.type].verb;
  if (verb.kind === 'split' && e.gen === 0 && !e.elite) {
    const frail = run.behaviours['frail-splits'] ?? 0;
    const hp = e.maxHp * verb.hp * (frail > 0 ? rankValue(BALANCE.relics.frailSplits, frail) : 1);
    burst(run, e, verb.count, { fragment: { hp, scale: verb.scale, share: verb.reward } });
  }
  if (e.elite) eliteDeath(run, e);
}

/** Bodies of `e`'s type bursting out of where it fell. */
function burst(run: RunState, e: Enemy, n: number, opts: Parameters<typeof spawnEnemy>[6]): void {
  const region = regionByIndex(run.regionId);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + e.id;
    const r = e.radius * 0.6;
    const c = spawnEnemy(run, region, e.type, e.wave, e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, opts);
    c.inContact = false;
  }
  run.events.push({ kind: 'split', x: e.x, y: e.y, n });
}

/** An elite fell (§4.3): its aura's last act, then a chance at a relic. */
function eliteDeath(run: RunState, e: Enemy): void {
  run.elitesKilled++;
  run.events.push({ kind: 'eliteKill', x: e.x, y: e.y });
  const E = BALANCE.elites;
  if (e.aura === 'split') burst(run, e, E.split, {});
  if (e.aura === 'vengeful') {
    const radius = AURA_BY_ID.vengeful.radius;
    for (const o of run.enemies) {
      if (o.alive && (o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= radius * radius) o.fury = Math.max(o.fury, E.vengeful);
    }
    run.events.push({ kind: 'fury', x: e.x, y: e.y, radius });
  }
  // Relics drop only once there is somewhere to wear them (a relic slot, §5.3).
  const pool = run.relicDrops ? eliteRelics(run.regionId) : [];
  const loot = Rng.wrap(run.streams.loot);
  if (pool.length > 0 && loot.chance(BALANCE.relics.eliteDrop)) {
    const relic = loot.pick(pool);
    run.relics.push(relic);
    run.events.push({ kind: 'relicDrop', relic, x: e.x, y: e.y });
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
