import { Rng } from '../../core/rng';
import { SpatialGrid } from '../../core/spatialGrid';
import { BALANCE } from '../../content/balance';
import { AURA_BY_ID, ENEMIES, ENEMY_BY_ID } from '../../content/enemies';
import { BOSS_BY_ID } from '../../content/bosses';
import type { EnemyVerb } from '../../content/types';
import type { Enemy, RunState } from '../state';
import { hurtTower } from './tower';
import { runRegion, spawnEnemy } from './waves';

/**
 * Rebuilt from scratch every step, so it carries nothing between steps and
 * is not part of the run's state.
 */
const grid = new SpatialGrid<Enemy>(64);
const near: Enemy[] = [];
/** The largest body radius, so a small body's query still finds a big neighbour. */
const MAX_RADIUS = Math.max(...ENEMIES.map((d) => d.radius)) * BALANCE.elites.scale;

/** True while a body is out of reach: under the water, phased out, or under the ground. */
export function isHidden(run: RunState, e: Enemy): boolean {
  return e.hiddenUntil > run.time || e.under;
}

/** Where a body stops walking: the wall, a ranged body's standoff, or a boss's (and its court's) post. */
function stopDistance(run: RunState, e: Enemy): number {
  const wall = run.stats.radius + e.radius;
  const boss = e.boss ?? (e.court && run.boss ? run.boss.id : null);
  if (boss) return run.boss?.enraged ? wall : Math.max(wall, BOSS_BY_ID[boss].standoff);
  const verb = ENEMY_BY_ID[e.type].verb;
  switch (verb.kind) {
    case 'ranged':
    case 'summon':
    case 'silence':
    case 'ward':
      return Math.max(wall, verb.standoff);
    default:
      return wall;
  }
}

/** True while a slowed body is held by Anchor Stone (§9): it can neither charge nor blink. */
function anchored(run: RunState, e: Enemy): boolean {
  return (run.behaviours.anchor ?? 0) > 0 && e.slowUntil > run.time && e.slow > 0;
}

/**
 * Elite auras (§4.3), recomputed each step: Haste speeds it and its
 * neighbours, Regen heals them, Shield halves the damage its neighbours take.
 * A Wardstone's ward (§9) shields its neighbours the same way.
 */
function applyAuras(run: RunState, dt: number): void {
  for (const e of run.enemies) {
    e.buffSpeed = 1;
    e.buffShield = 1;
  }
  const E = BALANCE.elites;
  for (const src of run.enemies) {
    if (!src.alive || src.boss || src.court) continue;
    const verb = ENEMY_BY_ID[src.type].verb;
    if (verb.kind !== 'ward' || src.hiddenUntil > run.time) continue;
    const r2 = verb.radius * verb.radius;
    for (const e of run.enemies) {
      if (e === src || !e.alive || (e.x - src.x) ** 2 + (e.y - src.y) ** 2 > r2) continue;
      e.buffShield = Math.min(e.buffShield, verb.shield);
    }
  }
  for (const src of run.enemies) {
    if (!src.alive || !src.aura) continue;
    const aura = src.aura;
    const r2 = AURA_BY_ID[aura].radius ** 2;
    if (r2 === 0) continue;
    for (const e of run.enemies) {
      if (!e.alive || (e.x - src.x) ** 2 + (e.y - src.y) ** 2 > r2) continue;
      switch (aura) {
        case 'haste':
          e.buffSpeed = Math.max(e.buffSpeed, E.haste);
          break;
        case 'regen':
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * E.regen * dt);
          break;
        case 'shield':
          if (e !== src) e.buffShield = Math.min(e.buffShield, E.shield);
          break;
        case 'split':
        case 'vengeful':
          break;
        default: {
          const exhaustive: never = aura;
          return exhaustive;
        }
      }
    }
  }
}

/**
 * Enemies walk straight at the tower, stop at its wall (or their standoff),
 * and act: walkers hit the wall on their attack interval, Spitters lob shots,
 * Menders heal (§4.3). A stunned or submerged body does nothing.
 */
export function tickEnemies(run: RunState, dt: number): void {
  applyAuras(run, dt);
  // Indexed: what a Summoner calls this step walks from the next.
  const n = run.enemies.length;
  for (let i = 0; i < n; i++) {
    const e = run.enemies[i];
    e.px = e.x;
    e.py = e.y;
    e.moving = false;
    if (!e.alive || e.stunnedUntil > run.time) continue;
    // A submerged boss holds still; a phased or buried body walks on.
    if (e.boss && isHidden(run, e)) continue;
    const verb = e.boss || e.court ? null : ENEMY_BY_ID[e.type].verb;
    if (verb) before(run, e, verb, dt);

    const d = Math.hypot(e.x, e.y);
    const stop = stopDistance(run, e);
    // An enraged boss walks through frost too: a fight it can't lose must still end (§4.3).
    const furious = e.boss !== null && run.boss?.enraged === true;
    const slow = e.slowUntil > run.time && !furious ? 1 - e.slow : 1;
    // A Ram mid-charge (§9) runs at its charge's pace.
    const dash = verb?.kind === 'charge' && e.dashUntil > run.time ? verb.speed : 1;
    if (d > stop + 1e-6) {
      const stepLen = Math.min(e.speed * e.buffSpeed * e.fury * slow * dash * dt, d - stop);
      e.x -= (e.x / d) * stepLen;
      e.y -= (e.y / d) * stepLen;
      e.moving = stepLen > 0;
      const wall = run.stats.radius + e.radius;
      e.inContact = stop <= wall && d - stepLen <= stop + 1e-6;
      // The first hit lands a beat after arrival, not on the arrival frame.
      if (e.inContact) e.attackTimer = e.attackInterval * 0.5;
      continue;
    }
    if (verb?.kind === 'ranged') {
      e.actTimer -= dt;
      if (e.actTimer <= 0) {
        e.actTimer += verb.interval;
        const k = verb.shotSpeed / (d || 1);
        run.shots.push({ x: e.x, y: e.y, px: e.x, py: e.y, vx: -e.x * k, vy: -e.y * k, damage: e.damage * e.fury, life: BALANCE.shots.life });
        run.events.push({ kind: 'shot', x: e.x, y: e.y });
      }
      continue;
    }
    if (verb?.kind === 'summon') {
      summon(run, e, verb, dt);
      continue;
    }
    if (verb?.kind === 'silence') {
      silence(run, e, verb, dt);
      continue;
    }
    // A Wardstone stands off and wards; it never touches the wall.
    if (verb?.kind === 'ward') continue;
    if (e.court) continue;
    if (e.boss && !run.boss?.enraged) continue;
    // Phased out, it can't touch the wall either.
    if (e.hiddenUntil > run.time) continue;
    if (!e.inContact) {
      // Reached the wall without walking there (shoved by the crowd): the
      // first hit still waits a beat, as it does for a body that walked in.
      e.inContact = true;
      e.attackTimer = e.attackInterval * 0.5;
    }
    e.attackTimer -= dt;
    if (e.attackTimer <= 0) {
      e.attackTimer += e.attackInterval;
      hurtTower(run, e.damage * e.fury, e.x, e.y, e);
      if (verb?.kind === 'leech' && run.ult.charge > 0) {
        run.ult.charge = Math.max(0, run.ult.charge - verb.drain);
        run.events.push({ kind: 'drain', x: e.x, y: e.y });
      }
    }
  }
}

/** What a verb does before its body walks: heal, phase, surface, blink. */
function before(run: RunState, e: Enemy, verb: EnemyVerb, dt: number): void {
  switch (verb.kind) {
    case 'heal':
      mend(run, e, verb, dt);
      return;
    case 'phase':
      e.actTimer -= dt;
      if (e.actTimer <= 0) {
        e.actTimer += verb.cycle;
        e.hiddenUntil = run.time + verb.hidden;
      }
      return;
    case 'burrow':
      if (e.under && Math.hypot(e.x, e.y) <= verb.surface) {
        e.under = false;
        run.events.push({ kind: 'surface', x: e.x, y: e.y });
      }
      return;
    case 'blink': {
      // Slowed, its next jump comes later: frost is an answer (§11.1).
      const slow = e.slowUntil > run.time ? 1 - e.slow : 1;
      e.actTimer -= dt * slow;
      if (e.actTimer > 0 || anchored(run, e)) return;
      e.actTimer += verb.interval;
      const d = Math.hypot(e.x, e.y);
      const room = d - stopDistance(run, e) - BALANCE.foes.blinkMargin;
      if (room <= 0) return;
      const jump = Math.min(verb.distance, room);
      const fx = e.x;
      const fy = e.y;
      e.x -= (e.x / d) * jump;
      e.y -= (e.y / d) * jump;
      e.px = e.x;
      e.py = e.y;
      run.events.push({ kind: 'blink', x: fx, y: fy, tx: e.x, ty: e.y });
      return;
    }
    case 'charge': {
      // Slowed, it winds up more slowly and charges less far: frost and knockback answer it (§9).
      const slow = e.slowUntil > run.time ? 1 - e.slow : 1;
      if (e.dashUntil > run.time) return;
      e.actTimer -= dt * slow;
      if (e.actTimer > 0 || anchored(run, e)) return;
      e.actTimer += verb.interval;
      e.dashUntil = run.time + verb.seconds * slow;
      run.events.push({ kind: 'charge', x: e.x, y: e.y });
      return;
    }
    case 'walker':
    case 'split':
    case 'ranged':
    case 'shield':
    case 'shards':
    case 'explode':
    case 'leech':
    case 'summon':
    case 'silence':
    case 'chorus':
    case 'carapace':
    case 'ward':
    case 'devour':
      return;
    default: {
      const exhaustive: never = verb;
      return exhaustive;
    }
  }
}

/** A Summoner at its post calls its servants beside it, while the field has room. */
function summon(run: RunState, e: Enemy, verb: Extract<EnemyVerb, { kind: 'summon' }>, dt: number): void {
  e.actTimer -= dt;
  if (e.actTimer > 0) return;
  e.actTimer += verb.interval;
  const region = runRegion(run);
  for (let k = 0; k < verb.count && run.enemies.length < BALANCE.maxEnemies; k++) {
    const a = Math.atan2(e.y, e.x) + (k - (verb.count - 1) / 2) * 0.35;
    const r = e.radius * 1.5;
    spawnEnemy(run, region, verb.enemy, e.wave, e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
  }
  run.events.push({ kind: 'rise', x: e.x, y: e.y });
}

/** A Harbinger at its post silences one of the tower's weapons that still fires. */
function silence(run: RunState, e: Enemy, verb: Extract<EnemyVerb, { kind: 'silence' }>, dt: number): void {
  e.actTimer -= dt;
  if (e.actTimer > 0) return;
  e.actTimer += verb.interval;
  const live = run.weapons.filter((w) => w.silencedUntil <= run.time);
  if (live.length === 0) return;
  const w = Rng.wrap(run.streams.foes).pick(live);
  w.silencedUntil = run.time + verb.seconds;
  run.events.push({ kind: 'silence', x: e.x, y: e.y, weapon: w.id });
}

/** A Mender's pulse: every other body near it is healed a share of its Max HP. */
function mend(run: RunState, e: Enemy, verb: { radius: number; interval: number; fraction: number }, dt: number): void {
  e.actTimer -= dt;
  if (e.actTimer > 0) return;
  e.actTimer += verb.interval;
  const r2 = verb.radius * verb.radius;
  let healed = false;
  for (const o of run.enemies) {
    if (o === e || !o.alive || o.hp >= o.maxHp) continue;
    if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 > r2) continue;
    o.hp = Math.min(o.maxHp, o.hp + o.maxHp * verb.fraction);
    healed = true;
  }
  if (healed) run.events.push({ kind: 'mend', x: e.x, y: e.y, radius: verb.radius });
}

/**
 * Bodies push apart so a crowd reads as a crowd, not one blob. At the wall
 * the push is tangential only: bodies spread around the ring but never leave
 * it, so separation changes how a wave looks, not how hard it hits. A boss
 * holds its ground: it shoves, but is never shoved.
 */
export function separateEnemies(run: RunState): void {
  const strength = BALANCE.separation;
  grid.rebuild(run.enemies);
  const reach = run.stats.radius;
  for (const e of run.enemies) {
    if (!e.alive || e.boss || e.court || isHidden(run, e)) continue;
    near.length = 0;
    // Two bodies overlap within the sum of their radii, so query that far:
    // a Runner must feel a Brute it touches, not only the reverse.
    grid.query(e.x, e.y, e.radius + Math.max(MAX_RADIUS, run.boss ? BOSS_BY_ID[run.boss.id].radius : 0), near);
    let fx = 0;
    let fy = 0;
    for (const o of near) {
      if (o === e || isHidden(run, o)) continue;
      let dx = e.x - o.x;
      let dy = e.y - o.y;
      let d = Math.hypot(dx, dy);
      const min = e.radius + o.radius;
      if (d >= min) continue;
      if (d < 1e-6) {
        // Exactly stacked: split them by id so the result is deterministic.
        dx = e.id < o.id ? 1 : -1;
        dy = 0;
        d = 1;
      }
      const overlap = (min - d) / min;
      fx += (dx / d) * overlap;
      fy += (dy / d) * overlap;
    }
    if (fx === 0 && fy === 0) continue;
    const dist = Math.hypot(e.x, e.y) || 1;
    const rx = e.x / dist;
    const ry = e.y / dist;
    if (e.inContact) {
      // Keep only the tangential part, then snap back onto the wall.
      const radial = fx * rx + fy * ry;
      fx -= radial * rx;
      fy -= radial * ry;
    }
    e.x += fx * e.radius * strength;
    e.y += fy * e.radius * strength;
    const stop = reach + e.radius;
    const nd = Math.hypot(e.x, e.y) || 1;
    if (e.inContact || nd < stop) {
      e.x = (e.x / nd) * stop;
      e.y = (e.y / nd) * stop;
    }
  }
}

/** Drop dead enemies from the list, keeping order (the sim's iteration order is part of determinism). */
export function sweepEnemies(run: RunState): void {
  let w = 0;
  const list = run.enemies;
  for (let i = 0; i < list.length; i++) {
    if (list[i].alive) list[w++] = list[i];
  }
  list.length = w;
}
