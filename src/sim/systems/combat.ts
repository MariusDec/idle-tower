import { Rng } from '../../core/rng';
import { ABYSS_INDEX } from '../../content/abyss';
import { BALANCE } from '../../content/balance';
import { AURA_BY_ID, ENEMIES, ENEMY_BY_ID } from '../../content/enemies';
import { eliteRelics } from '../../content/relics';
import { frameById } from '../../content/frames';
import { WEAPONS, WEAPON_BY_ID } from '../../content/weapons';
import type { EnemyVerb, WeaponId, WeaponParams, WeaponPattern } from '../../content/types';
import { BOSS_BY_ID } from '../../content/bosses';
import type { DamageBy, Enemy, Projectile, RunState, WeaponState } from '../state';
import { pactLoad, ruleSurge } from '../pacts';
import { armed } from './arms';
import { bossBody, dropPlate, onBossKilled, phasesOf, plateGuard, reflectShot } from './boss';
import { mitigate } from './damage';
import { gainXp } from './draft';
import { hurtTower } from './tower';
import { regionRule, runRegion, spawnEnemy } from './waves';

/** How close a projectile must pass, beyond the body radius, to hit. */
const HIT_PAD = 6;
/** How far a bolt whose target died looks for a new one. */
const RETARGET_RADIUS = 220;
/** Angle between the bolts of one volley as they leave the tower, radians. */
const VOLLEY_FAN = 0.3;
/** How far a storm (Storm Crown) reaches for its first strike, as a multiple of the chain's leap. */
const STORM_REACH = 1.5;
/** Where an idle drone waits, as a multiple of the tower's wall radius. */
const DRONE_REST = 1.8;

/**
 * What dealt a hit: a weapon's pattern, the ultimate, the wall itself, or
 * what a weapon left behind (a burn, a frozen body's shatter). Bog Lantern
 * reads it; an Overkill carry never carries again; Hive counts the drones'.
 */
export type DamageSource =
  | WeaponPattern | 'nova' | 'tempest' | 'eclipse' | 'thorns' | 'reflect' | 'overkill' | 'burn' | 'shatter'
  /** Stormcaller's quirk: a crit's leap to the next body. It never leaps again. */
  | 'leap';

/** Each weapon has its own pattern, so a pattern names the weapon a hit is credited to (T1). */
const PATTERN_WEAPON = new Map<DamageSource, WeaponId>(WEAPONS.map((w) => [w.pattern, w.id]));

/** Who a hit from `source` is credited to (T1). */
export function damageBy(source: DamageSource): DamageBy {
  const weapon = PATTERN_WEAPON.get(source);
  if (weapon) return weapon;
  switch (source) {
    case 'nova':
    case 'tempest':
    case 'eclipse':
      return 'ult';
    case 'thorns':
    case 'reflect':
      return 'thorns';
    case 'burn':
      return 'burn';
    default:
      return 'rule';
  }
}

/** Sources that count as lightning, frost or Nova for Bog Lantern (§11.5). */
const STORM: ReadonlySet<DamageSource> = new Set<DamageSource>(['chain', 'pulse', 'nova', 'tempest', 'leap']);

/** Sources that count as area for Brittle (§11.1): blasts, pulses, rune bursts, burns, shatters and the ultimate. */
const AREA: ReadonlySet<DamageSource> = new Set<DamageSource>(['lob', 'pulse', 'mine', 'burn', 'shatter', 'nova', 'tempest', 'eclipse']);

/** A body that can be targeted and hit: alive, and not under the water, phased out or underground. */
export function targetable(run: RunState, e: Enemy): boolean {
  return e.alive && e.hiddenUntil <= run.time && !e.under;
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

/** The weapon of this id the tower carries, if evolved; null otherwise. */
function evolvedWeapon(run: RunState, id: WeaponId): WeaponState | null {
  for (const w of run.weapons) if (w.id === id) return w.evolved ? w : null;
  return null;
}

/** One hit's damage, crit rolled. */
function rollHit(run: RunState, p: WeaponParams, crit: Rng): { damage: number; crit: boolean } {
  const isCrit = crit.chance(run.stats.critChance);
  return { damage: p.damage * run.stats.damageMult * (isCrit ? run.stats.critMult : 1), crit: isCrit };
}

/**
 * Weapons act, each in its own pattern (§4.4). Most fire on a cooldown at
 * the nearest enemy in range; blades and drones act every step, and a beam
 * heats every step it holds its target.
 */
export function tickWeapons(run: RunState, dt: number): void {
  const crit = Rng.wrap(run.streams.crit);
  const B = BALANCE.behaviours;
  // Last Stand (§11.4): the tower fights harder near the end.
  const desperate = run.behaviours['last-stand'] && run.tower.hp < run.stats.maxHp * B.lastStandBelow;
  const rateMult = run.stats.fireRateMult * (desperate ? 1 + B.lastStandSpeed : 1) * overclock(run);
  for (const w of run.weapons) {
    // A Harbinger's gaze (§11.1): silenced, it holds its fire. Its drones
    // hang where they are, settled so the painter doesn't jitter them.
    if (w.silencedUntil > run.time) {
      for (const d of w.drones) {
        d.px = d.x;
        d.py = d.y;
      }
      continue;
    }
    const p = armed(run.stats, w);
    const rate = w.dampedUntil > run.time ? rateMult * 0.5 : rateMult;
    const pattern = WEAPON_BY_ID[w.id].pattern;
    switch (pattern) {
      case 'orbit':
        sweepBlades(run, w, p, dt * rate, crit);
        break;
      case 'drone':
        flyDrones(run, w, p, dt, rate, crit);
        break;
      case 'beam':
        holdBeam(run, w, p, dt, rate, crit);
        break;
      case 'tether':
        holdTethers(run, w, p, dt, rate, crit);
        break;
      case 'homing':
      case 'cone':
      case 'chain':
      case 'pulse':
      case 'lob':
      case 'boomerang':
      case 'mine':
      case 'rail':
        fireOnCooldown(run, w, p, pattern, dt, rate, crit);
        break;
      default: {
        const exhaustive: never = pattern;
        return exhaustive;
      }
    }
  }
}

/** Overclock (§11.6): the Artificer's ultimate speeds every weapon while it lasts. */
function overclock(run: RunState): number {
  if (run.ult.until <= run.time) return 1;
  const ult = frameById(run.frameId).ultimate;
  return ult.id === 'overclock' ? ult.speed : 1;
}

type CooldownPattern = 'homing' | 'cone' | 'chain' | 'pulse' | 'lob' | 'boomerang' | 'mine' | 'rail';

function fireOnCooldown(
  run: RunState, w: WeaponState, p: WeaponParams, pattern: CooldownPattern,
  dt: number, rateMult: number, crit: Rng,
): void {
  if (pattern === 'chain' && w.evolved) w.spin += BALANCE.evolutions['storm-crown'].spin * dt;
  if (pattern === 'lob' && w.evolved) rainMeteors(run, w, p, dt * rateMult, crit);
  w.cooldown -= dt;
  if (w.cooldown > 0) return;
  // Every rune the field can hold is down: wait for one to burst.
  if (pattern === 'mine' && run.runes.filter((r) => !r.echo).length >= p.count) {
    w.cooldown = 0;
    return;
  }
  // A pulse needs a body inside its own radius; everything else, inside range.
  const target = pattern === 'lob'
    ? densest(run, p.radius, [])
    : nearestEnemy(run, 0, 0, pattern === 'pulse' ? p.radius : run.stats.range);
  if (!target) {
    // Idle: ready to fire the moment something enters range, with no backlog.
    w.cooldown = 0;
    return;
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
    case 'chain': {
      const start = run.stats.radius * 0.6;
      chainStrike(run, Math.cos(angle) * start, Math.sin(angle) * start, target, p, crit);
      // Storm Crown: each storm casts its own lightning from where it circles.
      if (w.evolved) {
        for (const s of storms(run, w)) {
          const first = nearestEnemy(run, s.x, s.y, p.jumpRange * STORM_REACH);
          if (first) chainStrike(run, s.x, s.y, first, p, crit);
        }
      }
      break;
    }
    case 'pulse':
      frostPulse(run, w, p, crit);
      break;
    case 'lob':
      lobShells(run, w, p, target, crit);
      break;
    case 'boomerang':
      throwCrescents(run, w, p, angle, crit);
      break;
    case 'mine':
      layRune(run, p, target, crit);
      break;
    case 'rail':
      fireSlugs(run, w, p, target, crit);
      break;
    default: {
      const exhaustive: never = pattern;
      return exhaustive;
    }
  }
  run.events.push({ kind: 'fire', weapon: w.id, angle });
}

/** Storm Crown's storms, where they circle now (§11.2). The painter reads this too. */
export function storms(run: RunState, w: WeaponState): { x: number; y: number }[] {
  const S = BALANCE.evolutions['storm-crown'];
  const r = run.stats.range * S.orbit;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < S.storms; i++) {
    const a = w.spin + (i / S.storms) * Math.PI * 2;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}

function launch(run: RunState, w: WeaponState, x: number, y: number, angle: number, speed: number, over: Partial<Projectile>): void {
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
    blast: 0,
    tx: 0,
    ty: 0,
    sx: x,
    sy: y,
    bomblets: 0,
    meteor: false,
    seeker: false,
    boomerang: false,
    returning: false,
    struck: [],
    ...over,
  });
}

/** Launch from the tower's lip, in direction `angle`. */
function launchFromTower(run: RunState, w: WeaponState, angle: number, speed: number, over: Partial<Projectile>): void {
  const start = run.stats.radius * 0.6;
  launch(run, w, Math.cos(angle) * start, Math.sin(angle) * start, angle, speed, over);
}

/** Homing bolts, one per body in reach, fanned as they leave the tower. */
function fireVolley(run: RunState, w: WeaponState, p: WeaponParams, first: Enemy, angle: number, crit: Rng): void {
  const targets = p.count > 1 ? nearestToTower(run, run.stats.range, p.count) : [first];
  for (let i = 0; i < p.count; i++) {
    const hit = rollHit(run, p, crit);
    launchFromTower(run, w, angle + (i - (p.count - 1) / 2) * VOLLEY_FAN, p.projectileSpeed, {
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
    launchFromTower(run, w, angle + offset, p.projectileSpeed, { ...rollHit(run, p, crit), pierce: p.pierce, knockback: p.knockback, life });
  }
}

/** Instant lightning from (x, y): the first body, then leaps to the nearest unstruck one in reach. */
function chainStrike(run: RunState, x: number, y: number, first: Enemy, p: WeaponParams, crit: Rng): void {
  const struck: number[] = [];
  const points = [x, y];
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

/**
 * Frost Ring: every body within the pulse is hit and slowed (§11.2).
 * Absolute Zero freezes them solid instead; a boss is only slowed.
 */
function frostPulse(run: RunState, w: WeaponState, p: WeaponParams, crit: Rng): void {
  const r2 = p.radius * p.radius;
  const freeze = w.evolved ? BALANCE.evolutions['absolute-zero'].freeze * run.stats.durationMult : 0;
  // Only what was there when it went off: a Splitter's fragments, born of
  // this pulse's kill, are the next pulse's (§11.1: AoE *after* the split).
  const n = run.enemies.length;
  for (let i = 0; i < n; i++) {
    const e = run.enemies[i];
    if (!targetable(run, e) || e.x * e.x + e.y * e.y > r2) continue;
    // Frozen before the hit lands, so a pulse that kills can shatter.
    if (freeze > 0 && !e.boss) {
      e.frozenUntil = run.time + freeze;
      e.stunnedUntil = Math.max(e.stunnedUntil, e.frozenUntil);
    }
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

/**
 * The body in range with the most others within `radius` of it: where a
 * shell does the most (§11.2). Bodies near a point in `taken` are skipped,
 * so a salvo's shells spread over clusters. Ties go to the nearer body.
 */
function densest(run: RunState, radius: number, taken: readonly { x: number; y: number }[]): Enemy | null {
  const range2 = run.stats.range * run.stats.range;
  const r2 = radius * radius;
  let best: Enemy | null = null;
  let bestN = -1;
  let bestD = Infinity;
  for (const e of run.enemies) {
    if (!targetable(run, e)) continue;
    const d = e.x * e.x + e.y * e.y;
    if (d > range2) continue;
    if (taken.some((t) => (t.x - e.x) ** 2 + (t.y - e.y) ** 2 <= r2)) continue;
    let n = 0;
    for (const o of run.enemies) {
      if (o !== e && targetable(run, o) && (o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= r2) n++;
    }
    if (n > bestN || (n === bestN && d < bestD)) {
      bestN = n;
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Mortar: a salvo of shells, each lobbed at a cluster, bursting where it lands. */
function lobShells(run: RunState, w: WeaponState, p: WeaponParams, first: Enemy, crit: Rng): void {
  const taken: { x: number; y: number }[] = [];
  let target: Enemy | null = first;
  for (let i = 0; i < p.count; i++) {
    // More shells than clusters: the spare ones land on the first.
    const t: Enemy = target ?? first;
    taken.push({ x: t.x, y: t.y });
    lob(run, w, p, t.x, t.y, crit, false);
    target = densest(run, p.radius, taken);
  }
}

function lob(run: RunState, w: WeaponState, p: WeaponParams, tx: number, ty: number, crit: Rng, meteor: boolean): void {
  const hit = rollHit(run, p, crit);
  if (meteor) {
    const M = BALANCE.evolutions.meteorfall;
    const from = BALANCE.weapons.meteorFrom;
    const sx = tx + from.x;
    const sy = ty + from.y;
    const speed = BALANCE.weapons.meteorSpeed;
    launch(run, w, sx, sy, Math.atan2(ty - sy, tx - sx), speed, {
      damage: hit.damage * M.meteor, crit: hit.crit, blast: M.radius * run.stats.areaMult,
      tx, ty, life: Math.hypot(tx - sx, ty - sy) / speed, meteor: true,
    });
    return;
  }
  const start = run.stats.radius * 0.6;
  const angle = Math.atan2(ty, tx);
  const sx = Math.cos(angle) * start;
  const sy = Math.sin(angle) * start;
  launch(run, w, sx, sy, angle, p.projectileSpeed, {
    ...hit, blast: p.radius, tx, ty, bomblets: p.bomblets,
    life: Math.hypot(tx - sx, ty - sy) / p.projectileSpeed,
  });
}

/**
 * Moonblade (§9): crescents thrown in a fan, out to the edge of range and
 * home again, cutting every body they cross once each way. Crescent Storm
 * also looses a ring of them in every direction.
 */
function throwCrescents(run: RunState, w: WeaponState, p: WeaponParams, angle: number, crit: Rng): void {
  const life = (run.stats.range * BALANCE.weapons.crescentReach) / p.projectileSpeed;
  const throwOne = (a: number): void => {
    launchFromTower(run, w, a, p.projectileSpeed, { ...rollHit(run, p, crit), boomerang: true, life });
  };
  for (let i = 0; i < p.count; i++) throwOne(angle + (p.count === 1 ? 0 : p.spread * (i / (p.count - 1) - 0.5)));
  if (w.evolved) {
    const ring = BALANCE.evolutions['crescent-storm'].ring;
    for (let k = 0; k < ring; k++) throwOne(angle + Math.PI / ring + (k / ring) * Math.PI * 2);
  }
}

/** A crescent, one step: out, then home, cutting what it crosses (§9). */
function flyCrescent(run: RunState, p: Projectile, dt: number): void {
  if (!p.returning && p.life <= 0) turnHome(run, p);
  if (p.returning) {
    // Home to the tower's heart; it is caught at the wall.
    const d = Math.hypot(p.x, p.y) || 1;
    if (d <= run.stats.radius * 0.6 + p.speed * dt) {
      p.alive = false;
      return;
    }
    p.vx = (-p.x / d) * p.speed;
    p.vy = (-p.y / d) * p.speed;
  }
  const sx = p.vx * dt;
  const sy = p.vy * dt;
  const len2 = sx * sx + sy * sy || 1;
  const reach = BALANCE.weapons.crescentWidth;
  const n = run.enemies.length;
  for (let i = 0; i < n; i++) {
    const e = run.enemies[i];
    if (!targetable(run, e) || p.struck.includes(e.id)) continue;
    const t = Math.max(0, Math.min(1, ((e.x - p.x) * sx + (e.y - p.y) * sy) / len2));
    const cx = p.x + sx * t - e.x;
    const cy = p.y + sy * t - e.y;
    const r = e.radius + reach;
    if (cx * cx + cy * cy > r * r) continue;
    p.struck.push(e.id);
    // A shield (or a mirror) turns its edge on the way out; coming home, it cuts the shield from behind.
    if (turnedAway(run, p, e)) continue;
    damageEnemy(run, e, p.damage, p.crit, 'boomerang');
  }
  p.x += sx;
  p.y += sy;
}

/** A crescent turns for home: a fresh pass, and faster (Moonstone faster still). */
function turnHome(run: RunState, p: Projectile): void {
  const stone = run.behaviours['swift-return'] ?? 0;
  p.returning = true;
  p.struck = [];
  p.speed *= BALANCE.weapons.crescentReturn * (stone > 0 ? rankValue(BALANCE.relics.swiftReturn, stone) : 1);
}

/** Rune Traps (§9): a rune laid in the path of `target`, between it and the wall. */
function layRune(run: RunState, p: WeaponParams, target: Enemy, crit: Rng): void {
  const hit = rollHit(run, p, crit);
  const k = BALANCE.weapons.runeLay;
  const x = target.x * k;
  const y = target.y * k;
  run.runes.push({
    x, y, armAt: run.time + BALANCE.weapons.runeArm, until: run.time + p.fuse * run.stats.durationMult,
    damage: hit.damage, crit: hit.crit, radius: p.radius, stun: p.stun, echo: false,
  });
  run.events.push({ kind: 'rune', x, y, burst: false, radius: p.radius });
}

/** A rune bursts: everything in reach is hit and, from level 5, stunned. Rune Chalk leaves an echo. */
function burstRune(run: RunState, r: (typeof run.runes)[number]): void {
  run.events.push({ kind: 'rune', x: r.x, y: r.y, burst: true, radius: r.radius });
  const n = run.enemies.length;
  for (let i = 0; i < n; i++) {
    const e = run.enemies[i];
    if (!targetable(run, e)) continue;
    const reach = r.radius + e.radius;
    if ((e.x - r.x) ** 2 + (e.y - r.y) ** 2 > reach * reach) continue;
    damageEnemy(run, e, r.damage, r.crit, 'mine');
    if (r.stun > 0 && e.alive && !e.boss) e.stunnedUntil = Math.max(e.stunnedUntil, run.time + r.stun * run.stats.durationMult);
  }
  const chalk = run.behaviours['echo-rune'] ?? 0;
  if (chalk > 0 && !r.echo) {
    run.runes.push({
      ...r, damage: r.damage * rankValue(BALANCE.relics.echoRune, chalk), crit: false, echo: true,
      armAt: run.time + BALANCE.weapons.runeArm, until: run.time + (r.until - r.armAt),
    });
  }
}

/** Runes on the ground: an armed one bursts under the first body to reach it; old ones fade. */
export function tickRunes(run: RunState): void {
  if (run.runes.length === 0) return;
  const trigger = BALANCE.weapons.runeTrigger;
  const keep: typeof run.runes = [];
  // Indexed: an echo laid by a burst waits for the next step.
  const runes = run.runes;
  run.runes = [];
  for (const r of runes) {
    if (r.until <= run.time) continue;
    if (r.armAt > run.time) {
      keep.push(r);
      continue;
    }
    let tripped = false;
    for (const e of run.enemies) {
      if (!targetable(run, e)) continue;
      const reach = trigger + e.radius;
      if ((e.x - r.x) ** 2 + (e.y - r.y) ** 2 <= reach * reach) {
        tripped = true;
        break;
      }
    }
    if (tripped) burstRune(run, r);
    else keep.push(r);
  }
  run.runes = [...keep, ...run.runes];
}

/**
 * Bulwark Runes (§9): a body that strikes the wall sets off a rune where it
 * stands, at most once every so often. Called from `hurtTower`.
 */
export function wallRune(run: RunState, source: Enemy): void {
  const w = evolvedWeapon(run, 'rune-traps');
  if (!w || run.time - run.wallRuneAt < BALANCE.evolutions['bulwark-runes'].every) return;
  run.wallRuneAt = run.time;
  const p = armed(run.stats, w);
  burstRune(run, {
    x: source.x, y: source.y, armAt: run.time, until: run.time, damage: p.damage * run.stats.damageMult,
    crit: false, radius: p.radius, stun: p.stun, echo: true,
  });
}

/**
 * Soul Tether (§9): threads held on the nearest bodies in range, draining
 * them on a fast tick: many small hits, which a Husk's shell soon runs out
 * of. Lifebloom mends the tower through them, and passes a thread on the
 * moment its body falls.
 */
function holdTethers(run: RunState, w: WeaponState, p: WeaponParams, dt: number, rateMult: number, crit: Rng): void {
  const range2 = run.stats.range * run.stats.range;
  const knot = run.behaviours['extra-tether'] ?? 0;
  const count = Math.min(BALANCE.caps.tethers, p.count + knot);
  const holding = (e: Enemy): boolean => targetable(run, e) && e.x * e.x + e.y * e.y <= range2;
  const thread = (): void => {
    w.tethers = w.tethers.filter((id) => {
      const e = enemyById(run, id);
      return !!e && holding(e);
    });
    if (w.tethers.length >= count) return;
    const free = run.enemies
      .filter((e) => holding(e) && !w.tethers.includes(e.id))
      .map((e) => ({ e, d: e.x * e.x + e.y * e.y }))
      .sort((a, b) => a.d - b.d || a.e.id - b.e.id);
    for (const f of free) {
      if (w.tethers.length >= count) break;
      w.tethers.push(f.e.id);
    }
  };
  thread();
  w.cooldown -= dt;
  if (w.tethers.length === 0) {
    w.cooldown = Math.max(0, w.cooldown);
    return;
  }
  if (w.evolved) {
    const L = BALANCE.evolutions.lifebloom;
    run.tower.hp = Math.min(run.stats.maxHp, run.tower.hp + run.stats.maxHp * L.heal * w.tethers.length * dt);
  }
  const first = enemyById(run, w.tethers[0]);
  if (first) w.aim = Math.atan2(first.y, first.x);
  if (w.cooldown > 0) return;
  w.cooldown = Math.max(0, w.cooldown + 1 / (p.fireRate * rateMult));
  for (const id of [...w.tethers]) {
    const e = enemyById(run, id);
    if (!e) continue;
    const hit = rollHit(run, p, crit);
    damageEnemy(run, e, hit.damage, hit.crit, 'tether');
  }
  if (w.evolved) thread();
  run.events.push({ kind: 'fire', weapon: w.id, angle: w.aim });
}

/**
 * Gilded Rail (§9): a slug through everything in its line, from the tower
 * to the edge of range: one heavy hit on each body. Not a shot in flight, so
 * shields and mirrors don't turn it. Midas Lance gilds what it pierces.
 */
function fireSlugs(run: RunState, w: WeaponState, p: WeaponParams, first: Enemy, crit: Rng): void {
  const targets = p.count > 1 ? nearestToTower(run, run.stats.range, p.count) : [first];
  const M = BALANCE.evolutions['midas-lance'];
  const burstRank = run.behaviours['rail-burst'] ?? 0;
  for (let k = 0; k < p.count; k++) {
    const t = targets[k % targets.length];
    const a = Math.atan2(t.y, t.x);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const hit = rollHit(run, p, crit);
    const struck: Enemy[] = [];
    const n = run.enemies.length;
    for (let i = 0; i < n; i++) {
      const e = run.enemies[i];
      if (!targetable(run, e)) continue;
      const along = e.x * ux + e.y * uy;
      if (along < 0 || along > run.stats.range + e.radius) continue;
      if (Math.abs(e.x * uy - e.y * ux) <= p.radius + e.radius) struck.push(e);
    }
    for (const e of struck) {
      if (w.evolved && e.alive) e.gildedUntil = run.time + M.seconds * run.stats.durationMult;
      damageEnemy(run, e, hit.damage, hit.crit, 'rail');
      // Gilt Edge (§9): a slug's kill bursts.
      if (!e.alive && burstRank > 0) {
        const r = BALANCE.relics.railBurstRadius * run.stats.areaMult;
        burstAt(run, e.x, e.y, r, hit.damage * rankValue(BALANCE.relics.railBurst, burstRank), false, 'shatter', e.id);
        run.events.push({ kind: 'blast', x: e.x, y: e.y, radius: r, weapon: w.id, style: 'shatter' });
      }
    }
    const start = run.stats.radius * 0.6;
    run.events.push({
      kind: 'rail', x1: ux * start, y1: uy * start, x2: ux * run.stats.range, y2: uy * run.stats.range, gilded: w.evolved,
    });
    w.aim = a;
  }
}

/** Meteorfall (§11.2): every few seconds a meteor on the densest crowd. */
function rainMeteors(run: RunState, w: WeaponState, p: WeaponParams, dt: number, crit: Rng): void {
  w.meteor -= dt;
  if (w.meteor > 0) return;
  const t = densest(run, BALANCE.evolutions.meteorfall.radius * run.stats.areaMult, []);
  if (!t) {
    w.meteor = 0;
    return;
  }
  w.meteor += BALANCE.evolutions.meteorfall.every;
  lob(run, w, p, t.x, t.y, crit, true);
}

/** Damage every body within `radius` of (x, y). Only those there when it lands. */
function burstAt(run: RunState, x: number, y: number, radius: number, damage: number, crit: boolean, source: DamageSource, skip = 0): void {
  const n = run.enemies.length;
  for (let i = 0; i < n; i++) {
    const e = run.enemies[i];
    if (!targetable(run, e) || e.id === skip) continue;
    const r = radius + e.radius;
    if ((e.x - x) ** 2 + (e.y - y) ** 2 <= r * r) damageEnemy(run, e, damage, crit, source);
  }
}

/** A shell or meteor lands: its burst, its bomblets, its burning ground. */
function detonate(run: RunState, p: Projectile): void {
  const W = BALANCE.weapons;
  burstAt(run, p.tx, p.ty, p.blast, p.damage, p.crit, 'lob');
  run.events.push({ kind: 'blast', x: p.tx, y: p.ty, radius: p.blast, weapon: p.weapon, style: p.meteor ? 'meteor' : 'shell' });
  if (p.bomblets > 0) {
    const rng = Rng.wrap(run.streams.arms);
    for (let i = 0; i < p.bomblets; i++) {
      const a = (i / p.bomblets) * Math.PI * 2 + rng.range(-0.5, 0.5);
      const d = W.bombletScatter * rng.range(0.6, 1.2);
      const bx = p.tx + Math.cos(a) * d;
      const by = p.ty + Math.sin(a) * d;
      const r = p.blast * W.bombletRadius;
      burstAt(run, bx, by, r, p.damage * W.bombletDamage, false, 'lob');
      run.events.push({ kind: 'blast', x: bx, y: by, radius: r, weapon: p.weapon, style: 'bomblet' });
    }
  }
  if (p.meteor) {
    const M = BALANCE.evolutions.meteorfall;
    run.fires.push({
      x: p.tx, y: p.ty, radius: M.groundRadius * run.stats.areaMult,
      dps: (p.damage / M.meteor) * M.burn, until: run.time + M.groundSeconds * run.stats.durationMult,
    });
  }
}

/**
 * Sunlance (§11.2): a beam that holds one body and burns hotter the longer it
 * holds. It lands on the cooldown; it heats every step. Judgment splits the
 * beam at full heat; at level 4 it burns through everything in its line.
 */
function holdBeam(run: RunState, w: WeaponState, p: WeaponParams, dt: number, rateMult: number, crit: Rng): void {
  let target = w.beamTarget ? enemyById(run, w.beamTarget) : null;
  const range2 = run.stats.range * run.stats.range;
  if (target && target.x * target.x + target.y * target.y > range2) target = null;
  if (!target) {
    target = nearestEnemy(run, 0, 0, run.stats.range);
    w.heat = 1;
    w.beamTarget = target ? target.id : 0;
  }
  w.cooldown -= dt;
  if (!target) {
    w.cooldown = 0;
    return;
  }
  w.heat = Math.min(p.rampCap, w.heat + p.ramp * dt);
  w.aim = Math.atan2(target.y, target.x);
  if (w.cooldown > 0) return;
  w.cooldown = Math.max(0, w.cooldown + 1 / (p.fireRate * rateMult));
  const hit = rollHit(run, p, crit);
  const damage = hit.damage * w.heat;
  if (p.pierce > 0) {
    // Through everything in its line, out to the edge of range.
    const ux = Math.cos(w.aim);
    const uy = Math.sin(w.aim);
    const n = run.enemies.length;
    for (let i = 0; i < n; i++) {
      const e = run.enemies[i];
      if (!targetable(run, e)) continue;
      const along = e.x * ux + e.y * uy;
      if (along < 0 || along > run.stats.range + e.radius) continue;
      const off = Math.abs(e.x * uy - e.y * ux);
      if (off <= BALANCE.weapons.beamWidth + e.radius) damageEnemy(run, e, damage, hit.crit, 'beam');
    }
  } else {
    damageEnemy(run, target, damage, hit.crit, 'beam');
  }
  if (w.evolved && w.heat >= p.rampCap) {
    // Judgment: at full heat the beam forks to the nearest others.
    const J = BALANCE.evolutions.judgment;
    const struck = [target.id];
    const points: number[] = [];
    for (let i = 0; i < J.splits; i++) {
      const o = nearestUnstruck(run, target.x, target.y, J.splitRange, struck);
      if (!o) break;
      struck.push(o.id);
      points.push(target.x, target.y, o.x, o.y);
      damageEnemy(run, o, damage, hit.crit, 'beam');
    }
    if (points.length > 0) run.events.push({ kind: 'lance', points });
  }
  run.events.push({ kind: 'fire', weapon: w.id, angle: w.aim });
}

/** Where Glaives' blades circle now: Halo sweeps them from the wall to the edge of range and back. */
export function bladeOrbit(run: RunState, w: WeaponState, p: WeaponParams): number {
  if (!w.evolved) return p.radius;
  const lo = run.stats.radius + p.blade;
  const hi = run.stats.range;
  const t = (run.time / BALANCE.evolutions.halo.period) * Math.PI * 2;
  return lo + (hi - lo) * (0.5 - 0.5 * Math.cos(t));
}

/**
 * Glaives (§11.2): blades circle the tower and cut whatever they pass. A body
 * is hit when a blade's sweep this step crosses it, so the hit rate is the
 * blades' turn rate, and attack speed turns them faster.
 */
function sweepBlades(run: RunState, w: WeaponState, p: WeaponParams, dt: number, crit: Rng): void {
  const from = w.spin;
  const sweep = p.spin * dt;
  w.spin = (w.spin + sweep) % (Math.PI * 2);
  w.aim = w.spin;
  const r = bladeOrbit(run, w, p);
  const TAU = Math.PI * 2;
  const n = run.enemies.length;
  let cut = false;
  for (let i = 0; i < n; i++) {
    const e = run.enemies[i];
    if (!targetable(run, e)) continue;
    const d = Math.hypot(e.x, e.y);
    const reach = p.blade + e.radius;
    if (Math.abs(d - r) > reach) continue;
    // A blade cuts once per pass: when its centre crosses the body's near edge.
    const edge = Math.atan2(e.y, e.x) - reach / Math.max(r, 1);
    for (let k = 0; k < p.count; k++) {
      const start = from + (k / p.count) * TAU;
      const delta = (((edge - start) % TAU) + TAU) % TAU;
      if (delta < sweep) {
        const hit = rollHit(run, p, crit);
        damageEnemy(run, e, hit.damage, hit.crit, 'orbit');
        cut = true;
        break;
      }
    }
  }
  // Blades have no volley: a step that cuts is their shot (§10.4's sound).
  if (cut) run.events.push({ kind: 'fire', weapon: w.id, angle: w.spin });
}

/**
 * Sentinel Drones (§11.2): each flies to its own quarry, hovers off it and
 * fires homing shots. Hive's drones, called by kills, fade on a timer.
 */
function flyDrones(run: RunState, w: WeaponState, p: WeaponParams, dt: number, rateMult: number, crit: Rng): void {
  const W = BALANCE.weapons;
  const R = run.stats.radius;
  // The weapon's own drones: as many as its level gives, the first at the tower.
  const owned = w.drones.filter((d) => d.until === null).length;
  for (let i = owned; i < p.count; i++) {
    const a = (i / p.count) * Math.PI * 2;
    w.drones.unshift({ x: Math.cos(a) * R, y: Math.sin(a) * R, px: Math.cos(a) * R, py: Math.sin(a) * R, cooldown: 0, until: null });
  }
  w.drones = w.drones.filter((d) => d.until === null || d.until > run.time);
  const leash = run.stats.range * W.droneLeash;
  const leash2 = leash * leash;
  w.drones.forEach((d, i) => {
    d.px = d.x;
    d.py = d.y;
    let quarry: Enemy | null = null;
    let best = Infinity;
    for (const e of run.enemies) {
      if (!targetable(run, e) || e.x * e.x + e.y * e.y > leash2) continue;
      const dd = (e.x - d.x) ** 2 + (e.y - d.y) ** 2;
      if (dd < best) {
        best = dd;
        quarry = e;
      }
    }
    let gx: number;
    let gy: number;
    if (quarry) {
      const dist = Math.sqrt(best) || 1;
      gx = quarry.x - ((quarry.x - d.x) / dist) * W.droneHover;
      gy = quarry.y - ((quarry.y - d.y) / dist) * W.droneHover;
    } else {
      const a = (i / Math.max(1, w.drones.length)) * Math.PI * 2 + run.time * 0.4;
      gx = Math.cos(a) * R * DRONE_REST;
      gy = Math.sin(a) * R * DRONE_REST;
    }
    const mx = gx - d.x;
    const my = gy - d.y;
    const md = Math.hypot(mx, my);
    const stepLen = Math.min(md, W.droneSpeed * dt);
    if (md > 1e-6) {
      d.x += (mx / md) * stepLen;
      d.y += (my / md) * stepLen;
    }
    d.cooldown -= dt;
    // Idle or still closing in: ready to fire on arrival, with no backlog
    // (a drone that flew for two seconds must not arrive with a burst).
    if (!quarry || Math.sqrt(best) > W.droneHover * 1.6) {
      d.cooldown = Math.max(0, d.cooldown);
      return;
    }
    if (d.cooldown > 0) return;
    d.cooldown += 1 / (p.fireRate * rateMult);
    const angle = Math.atan2(quarry.y - d.y, quarry.x - d.x);
    launch(run, w, d.x, d.y, angle, p.projectileSpeed, {
      ...rollHit(run, p, crit), homing: true, target: quarry.id, pierce: p.pierce, life: BALANCE.projectiles.homingLife,
    });
    run.events.push({ kind: 'fire', weapon: w.id, angle });
  });
}

/** Hive (§11.2): a drone's kill calls another drone for a while, up to the cap. */
function callHiveDrone(run: RunState, x: number, y: number): void {
  const w = evolvedWeapon(run, 'sentinel-drones');
  if (!w) return;
  const until = run.time + BALANCE.evolutions.hive.seconds * run.stats.durationMult;
  if (w.drones.length < BALANCE.caps.drones) {
    w.drones.push({ x, y, px: x, py: y, cooldown: 0, until });
    return;
  }
  // At the cap: the oldest called drone stays longer instead.
  const called = w.drones.find((d) => d.until !== null);
  if (called) called.until = until;
}

/** Projectiles: homing shots steer and retarget, straight shots hit what they cross, shells fly to their mark. */
export function tickProjectiles(run: RunState, dt: number): void {
  // Indexed: a seeker launched mid-loop waits for the next step.
  const n = run.projectiles.length;
  for (let i = 0; i < n; i++) {
    const p = run.projectiles[i];
    p.px = p.x;
    p.py = p.y;
    if (!p.alive) continue;
    p.life -= dt;
    if (p.boomerang) {
      flyCrescent(run, p, dt);
      continue;
    }
    if (p.blast > 0) {
      // Lobbed: over everything, to burst where it was aimed.
      if (p.life <= 0) {
        p.x = p.tx;
        p.y = p.ty;
        p.alive = false;
        detonate(run, p);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      continue;
    }
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

/**
 * True when a shot is turned away before it lands: a Shieldbearer's shield
 * meets shots flying at its face (§11.1), and a boss's mirror throws back
 * what strikes its glass (the Prism).
 */
function turnedAway(run: RunState, p: Projectile, e: Enemy): boolean {
  if (e.boss) return reflectShot(run, e, p.x, p.y);
  const verb = ENEMY_BY_ID[e.type].verb;
  if (verb.kind !== 'shield' || e.court) return false;
  // The shield faces the tower: a shot flying outward, near head-on, meets it.
  const d = Math.hypot(e.x, e.y) || 1;
  const along = (p.vx * e.x + p.vy * e.y) / ((p.speed || 1) * d);
  if (along < Math.cos(verb.arc)) return false;
  run.events.push({ kind: 'deflect', x: e.x, y: e.y });
  return true;
}

function strike(run: RunState, p: Projectile, e: Enemy): void {
  const ex = e.x;
  const ey = e.y;
  if (turnedAway(run, p, e)) {
    p.alive = false;
    return;
  }
  // Point-blank (S5): Scattershot's pellets bite harder inside a third of range.
  const close = WEAPON_BY_ID[p.weapon].pointBlank;
  const near = close !== undefined && ex * ex + ey * ey <= (run.stats.range * BALANCE.weapons.pointBlankReach) ** 2;
  damageEnemy(run, e, p.damage * (near ? close : 1), p.crit, WEAPON_BY_ID[p.weapon].pattern);
  // Prism Heart (§11.5): a share of shots refract into a second target.
  const refract = run.behaviours.refract ?? 0;
  if (refract > 0 && !p.seeker && Rng.wrap(run.streams.arms).chance(rankValue(BALANCE.relics.refract, refract))) {
    const t = nearestEnemy(run, ex, ey, RETARGET_RADIUS * 1.5, e.id);
    if (t) {
      const w = run.weapons.find((x) => x.id === p.weapon);
      if (w) {
        launch(run, w, ex, ey, Math.atan2(t.y - ey, t.x - ex), p.speed, {
          damage: p.damage, crit: p.crit, homing: true, target: t.id, ignore: e.id, life: BALANCE.projectiles.homingLife, seeker: true,
        });
      }
    }
  }
  // An enraged boss's fury carries it through any shove: it reaches the wall (§4.3).
  if (p.knockback > 0 && e.alive && !(e.boss && run.boss?.enraged)) knockBack(e, p.knockback);
  // Dragonbreath (§11.2): the pellets set what they hit alight.
  if (p.weapon === 'scattershot' && e.alive && evolvedWeapon(run, 'scattershot')) {
    const D = BALANCE.evolutions.dragonbreath;
    ignite(run, e, p.damage * D.burn, D.burnSeconds * run.stats.durationMult);
  }
  // Seeker Swarm (§11.2): a critical bolt bursts into seekers that hunt fresh targets.
  if (p.weapon === 'arcane-bolt' && p.crit && !p.seeker) {
    const w = evolvedWeapon(run, 'arcane-bolt');
    if (w) {
      const S = BALANCE.evolutions['seeker-swarm'];
      const struck = [e.id];
      for (let i = 0; i < S.seekers; i++) {
        const t = nearestUnstruck(run, ex, ey, RETARGET_RADIUS * 1.5, struck) ?? nearestEnemy(run, ex, ey, RETARGET_RADIUS * 1.5, e.id);
        if (t) struck.push(t.id);
        const angle = t ? Math.atan2(t.y - ey, t.x - ex) : (i / S.seekers) * Math.PI * 2;
        launch(run, w, ex, ey, angle, p.speed * 0.8, {
          damage: p.damage * S.seekerDamage, homing: true, target: t ? t.id : 0, ignore: e.id,
          life: BALANCE.projectiles.homingLife, seeker: true,
        });
      }
    }
  }
  if (p.pierce > 0) {
    p.pierce--;
    p.ignore = e.id;
    p.target = 0;
  } else {
    p.alive = false;
  }
}

/** Set a body burning: the hotter of its burn and this one, for at least `seconds`. */
function ignite(run: RunState, e: Enemy, dps: number, seconds: number): void {
  if (e.burnUntil <= run.time) {
    e.burn = 0;
    e.burnTimer = BALANCE.weapons.burnTick;
    run.events.push({ kind: 'ignite', x: e.x, y: e.y });
  }
  e.burn = Math.max(e.burn, dps);
  e.burnUntil = Math.max(e.burnUntil, run.time + seconds);
}

/**
 * Burns bite on their own clock, and burning ground sets alight what stands
 * in it (§11.2). After the weapons, so a burn lit this step bites later.
 */
export function tickBurns(run: RunState, dt: number): void {
  if (run.fires.length > 0) {
    run.fires = run.fires.filter((f) => f.until > run.time);
    for (const f of run.fires) {
      for (const e of run.enemies) {
        if (!targetable(run, e)) continue;
        const r = f.radius + e.radius;
        if ((e.x - f.x) ** 2 + (e.y - f.y) ** 2 <= r * r) ignite(run, e, f.dps, BALANCE.weapons.burnTick * 2);
      }
    }
  }
  const tick = BALANCE.weapons.burnTick;
  const n = run.enemies.length;
  for (let i = 0; i < n; i++) {
    const e = run.enemies[i];
    if (!e.alive || e.burnUntil <= run.time) continue;
    e.burnTimer -= dt;
    if (e.burnTimer > 0) continue;
    e.burnTimer += tick;
    damageEnemy(run, e, e.burn * tick, false, 'burn');
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

/**
 * What a body leaves when it falls to a weapon's evolution: Dragonbreath's
 * fire leaps to its neighbours, a frozen body shatters (§11.2), and a
 * drone's kill calls a Hive drone.
 */
function evolvedDeath(run: RunState, e: Enemy, source: DamageSource): void {
  if (e.burnUntil > run.time && evolvedWeapon(run, 'scattershot')) {
    const D = BALANCE.evolutions.dragonbreath;
    const r2 = D.spread * D.spread;
    const left = e.burnUntil - run.time;
    for (const o of run.enemies) {
      if (o !== e && targetable(run, o) && (o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= r2) ignite(run, o, e.burn, left);
    }
  }
  if (e.frozenUntil > run.time) {
    const w = evolvedWeapon(run, 'frost-ring');
    if (w) {
      e.frozenUntil = 0;
      const A = BALANCE.evolutions['absolute-zero'];
      const r = A.shatterRadius * run.stats.areaMult;
      const hit = armed(run.stats, w).damage * run.stats.damageMult * A.shatter;
      run.events.push({ kind: 'blast', x: e.x, y: e.y, radius: r, weapon: 'frost-ring', style: 'shatter' });
      burstAt(run, e.x, e.y, r, hit, false, 'shatter', e.id);
    }
  }
  if (source === 'drone') callHiveDrone(run, e.x, e.y);
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
function damageTaken(run: RunState, e: Enemy, raw: number, source: DamageSource): number {
  const R = BALANCE.relics;
  const b = run.behaviours;
  // Ward Breaker (§9): a ward or Shield aura protects only part as well.
  const wb = b.wardbreak ? rankValue(R.wardbreak, b.wardbreak) : 0;
  let out = raw * (1 - (1 - e.buffShield) * (1 - wb));
  // Midas Lance (§9): gilded, it takes more.
  if (e.gildedUntil > run.time) out *= 1 + BALANCE.evolutions['midas-lance'].vulnerable;
  // Daybreak (§9): everything in range takes more while it lasts.
  if (run.ult.until > run.time && e.x * e.x + e.y * e.y <= run.stats.range ** 2) {
    const ult = frameById(run.frameId).ultimate;
    if (ult.id === 'daybreak') out *= ult.vulnerable;
  }
  const tally = b.tally ?? 0;
  if (tally > 0) out *= 1 + rankValue(R.tally, tally) * Math.floor(run.kills / 100);
  const still = b['still-target'] ?? 0;
  if (still > 0 && !e.moving) out *= 1 + rankValue(R.stillTarget, still);
  // Brittle (§11.1): the Wastes crack under area.
  const rule = regionRule(run);
  if (rule?.kind === 'areaDamage' && AREA.has(source)) out *= rule.mult;
  // The P7 relics (§11.5): each a condition on the body, or on the clock.
  if (b['frost-brand'] && e.slowUntil > run.time && e.slow > 0) out *= 1 + rankValue(R.frostBrand, b['frost-brand']);
  if (b['close-quarters'] && e.x * e.x + e.y * e.y <= (run.stats.range / 3) ** 2) out *= 1 + rankValue(R.closeQuarters, b['close-quarters']);
  if (b.surge && run.time % R.surgeEvery < R.surgeSeconds) out *= rankValue(R.surge, b.surge);
  if (b.kindling && e.burnUntil > run.time) out *= 1 + rankValue(R.kindling, b.kindling);
  if (b['elite-bane'] && e.elite) out *= 1 + rankValue(R.eliteBane, b['elite-bane']);
  if (b['boss-bane'] && (e.boss || e.court || e.plate)) out *= 1 + rankValue(R.bossBane, b['boss-bane']);
  // Forgeheart's plates (S2): while one stands, the heart takes its guard's share.
  if (e.boss) out *= plateGuard(run);
  return out;
}

/**
 * Armour-mitigated damage to one body. Returns what landed. A submerged
 * body takes nothing.
 */
export function damageEnemy(run: RunState, e: Enemy, raw: number, crit: boolean, source: DamageSource = 'homing'): number {
  if (!targetable(run, e)) return 0;
  const B = BALANCE.behaviours;
  // The Hollow King's court: a hit on any of his bodies is a hit on him, full
  // on the crowned one and a share on the rest.
  const court = courtShare(run, e);
  if (e.court) {
    const king = bossBody(run);
    e.hitTick = run.tick;
    return king ? hitBody(run, king, raw * court, crit, source) : 0;
  }
  // Mirror Shard (§11.5): the first hit on a body is a crit.
  if (run.behaviours['first-crit'] && !crit && e.hitTick < 0 && !e.boss) {
    raw *= run.stats.critMult;
    crit = true;
  }
  const amount = hitBody(run, e, raw * court, crit, source);
  // Stormcaller (§11.6): a crit leaps to one more body.
  if (crit && run.behaviours.stormcaller && source !== 'leap' && source !== 'overkill') {
    const o = nearestEnemy(run, e.x, e.y, B.stormLeap, e.id);
    if (o) {
      run.events.push({ kind: 'chain', points: [e.x, e.y, o.x, o.y] });
      damageEnemy(run, o, raw * B.stormShare, false, 'leap');
    }
  }
  return amount;
}

/** The crowned body takes full damage, the others their share; 1 for anything outside the court. */
function courtShare(run: RunState, e: Enemy): number {
  const b = run.boss;
  if (!b || b.crown === 0 || (!e.court && !e.boss)) return 1;
  if (e.id === b.crown) return 1;
  const pattern = phasesOf(run, BOSS_BY_ID[b.id])[b.phase].patterns.find((p) => p.kind === 'court');
  return pattern?.kind === 'court' ? pattern.share : 1;
}

/** Armour, the kill, and what a kill carries over. A Chorus's bodies share the hit (§11.1). */
function hitBody(run: RunState, e: Enemy, raw: number, crit: boolean, source: DamageSource): number {
  const B = BALANCE.behaviours;
  // A Husk's shell (§9) swallows a hit whole, whatever its size.
  if (e.shell > 0) {
    e.shell--;
    e.hitTick = run.tick;
    run.events.push({ kind: 'shell', x: e.x, y: e.y });
    return 0;
  }
  const before = e.hp;
  let amount = mitigate(damageTaken(run, e, raw, source), e.armor);
  // Executioner (§11.4): a hit on a body already this low finishes it. Not a
  // boss. Annihilator, a second level of it, doubles the line.
  // Two sources at most: the Coin stands in for Executioner, never a third line.
  const execute = Math.min(B.executeMax, run.behaviours.executioner ?? 0);
  if (execute > 0 && !e.boss && e.hp - amount > 0 && e.hp <= e.maxHp * B.executeBelow * execute) amount = e.hp;
  e.hp -= amount;
  e.hitTick = run.tick;
  // T1: what the hit took off, not what it would have: overkill isn't landed.
  const by = damageBy(source);
  run.damageBy[by] = (run.damageBy[by] ?? 0) + Math.min(amount, Math.max(0, before));
  run.events.push({ kind: 'hit', x: e.x, y: e.y, amount, crit, by });
  if (e.group) {
    for (const o of run.enemies) {
      if (o === e || !o.alive || o.group !== e.group) continue;
      o.hp = e.hp;
      o.hitTick = run.tick;
      if (o.hp <= 0) kill(run, o, source);
    }
  }
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
  // Midas Lance (§9): slain gilded, it pays more.
  const gilt = e.gildedUntil > run.time ? BALANCE.evolutions['midas-lance'].shards : 1;
  const shards = e.shards * run.stats.shardMult * gilt;
  run.shards += shards;
  if (e.boss) run.shardsFrom.boss += shards;
  else if (e.elite) run.shardsFrom.elites += shards;
  else run.shardsFrom.kills += shards;
  const u = run.ult;
  if (u.charge < 1) {
    // Last Light (§11.5): below half HP, the ultimate fills faster.
    const light = run.behaviours['last-light'] ?? 0;
    const low = light > 0 && run.tower.hp < run.stats.maxHp / 2 ? rankValue(BALANCE.relics.lastLight, light) : 1;
    u.charge = Math.min(1, u.charge + (e.xp * run.stats.ultChargeMult * low) / u.need);
    if (u.charge >= 1) run.events.push({ kind: 'ultReady' });
  }
  // Soul Jar (§11.5): every so many kills, the tower mends.
  const jar = run.behaviours['soul-jar'] ?? 0;
  if (jar > 0 && run.kills % BALANCE.relics.soulKills === 0) {
    run.tower.hp = Math.min(run.stats.maxHp, run.tower.hp + run.stats.maxHp * rankValue(BALANCE.relics.soulJar, jar));
  }
  // The Gravekeeper (§9): every kill mends the tower a little.
  if (run.behaviours.siphon) {
    run.tower.hp = Math.min(run.stats.maxHp, run.tower.hp + run.stats.maxHp * BALANCE.behaviours.siphon);
  }
  evolvedDeath(run, e, source);
  feedMaws(run, e);
  if (e.boss) {
    onBossKilled(run, e);
    return;
  }
  if (e.plate) {
    // Already down: `dropPlate` only counts it off and marks where it fell.
    dropPlate(run, e);
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
  lastWord(run, e, verb);
  ruleOnKill(run, e);
}

/** The types that feed on the fallen: every kill looks for them, so the look is one set lookup a body. */
const DEVOURERS: ReadonlySet<string> = new Set(ENEMIES.filter((d) => d.verb.kind === 'devour').map((d) => d.id));

/** Maws near a fallen body feed on it (§9): healed, and grown, a few times over. Maw Tooth starves them. */
function feedMaws(run: RunState, dead: Enemy): void {
  if (run.behaviours.starve) return;
  for (const m of run.enemies) {
    if (!DEVOURERS.has(m.type) || m === dead || !m.alive || m.boss || m.court) continue;
    const verb = ENEMY_BY_ID[m.type].verb;
    if (verb.kind !== 'devour' || m.feeds >= verb.feeds) continue;
    if ((m.x - dead.x) ** 2 + (m.y - dead.y) ** 2 > verb.radius * verb.radius) continue;
    m.feeds++;
    m.maxHp *= 1 + verb.grow;
    m.hp = Math.min(m.maxHp, m.hp + m.maxHp * verb.heal);
    m.radius *= 1 + verb.grow / 3;
    run.events.push({ kind: 'feed', x: m.x, y: m.y });
  }
}

/** What a body's verb does as it dies: a Bomber's blast, a Shardling's shards (§11.1). */
function lastWord(run: RunState, e: Enemy, verb: EnemyVerb): void {
  const shield = run.behaviours['blast-shield'] ?? 0;
  const soften = shield > 0 ? rankValue(BALANCE.relics.blastShield, shield) : 1;
  switch (verb.kind) {
    case 'explode': {
      run.events.push({ kind: 'explode', x: e.x, y: e.y, radius: verb.radius });
      if (Math.hypot(e.x, e.y) - run.stats.radius <= verb.radius) hurtTower(run, e.damage * verb.damage * soften, e.x, e.y, null);
      return;
    }
    case 'shards': {
      run.events.push({ kind: 'explode', x: e.x, y: e.y, radius: e.radius * 2 });
      // They fly only so far: slain far from the wall, they fall short (§11.1).
      const speed = BALANCE.foes.shardSpeed;
      const at = Math.atan2(-e.y, -e.x);
      for (let i = 0; i < verb.count; i++) {
        const a = at + (i - (verb.count - 1) / 2) * 0.25;
        run.shots.push({
          x: e.x, y: e.y, px: e.x, py: e.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          damage: e.damage * verb.damage * soften, life: verb.reach / speed,
        });
      }
      return;
    }
    case 'walker':
    case 'split':
    case 'ranged':
    case 'heal':
    case 'shield':
    case 'burrow':
    case 'blink':
    case 'phase':
    case 'leech':
    case 'summon':
    case 'silence':
    case 'chorus':
    case 'carapace':
    case 'charge':
    case 'ward':
    case 'devour':
      return;
    default: {
      const exhaustive: never = verb;
      return exhaustive;
    }
  }
}

/** The region's rule at a kill (§11.1): Cinders leaves fire; Echoes raises a shade. */
function ruleOnKill(run: RunState, e: Enemy): void {
  const rule = regionRule(run);
  if (!rule || e.boss || e.court) return;
  switch (rule.kind) {
    case 'cinders':
      run.fires.push({ x: e.x, y: e.y, radius: rule.radius, dps: e.maxHp * rule.burn, until: run.time + rule.seconds });
      return;
    case 'echoes': {
      if (e.shade || e.gen > 0 || e.group) return;
      // Blight Surge (§9): more of the slain rise.
      const region = runRegion(run);
      const chance = rule.chance * (1 + ruleSurge(pactLoad(run.pacts), region));
      if (!Rng.wrap(run.streams.foes).chance(chance)) return;
      const shade = spawnEnemy(run, region, e.type, e.wave, e.x, e.y, { shade: true, single: true });
      shade.hp = shade.maxHp = e.maxHp * rule.hp;
      shade.xp = e.xp * rule.reward;
      shade.shards = e.shards * rule.reward;
      shade.elite = false;
      run.events.push({ kind: 'rise', x: e.x, y: e.y });
      return;
    }
    case 'stat':
    case 'areaDamage':
    case 'blight':
      return;
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

/** Bodies of `e`'s type bursting out of where it fell. */
function burst(run: RunState, e: Enemy, n: number, opts: Parameters<typeof spawnEnemy>[6]): void {
  const region = runRegion(run);
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
  // The Abyss's elites drop its lit sets instead (§9).
  const pool = run.regionId === ABYSS_INDEX ? run.abyssRelics : run.relicDrops ? eliteRelics(run.regionId) : [];
  const loot = Rng.wrap(run.streams.loot);
  // Treasure Hunter (§11.4): relics drop more often.
  const luck = run.behaviours['relic-luck'] ? BALANCE.behaviours.relicLuck : 1;
  if (pool.length > 0 && loot.chance(BALANCE.relics.eliteDrop * luck)) {
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
