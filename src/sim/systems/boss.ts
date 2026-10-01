import { Rng } from '../../core/rng';
import { BALANCE } from '../../content/balance';
import { BOSS_BY_ID } from '../../content/bosses';
import { ENEMY_BY_ID } from '../../content/enemies';
import { spawnPoint } from '../../content/arena';
import type { BossDef, BossPattern, RegionDef } from '../../content/types';
import { regionByIndex } from '../../content/regions';
import type { BossState, Enemy, RunState } from '../state';
import { BOSS_WAVE, spawnEnemy, waveDamage, waveHp } from './waves';
import { hurtTower } from './tower';

/**
 * Bosses (§4.3): wave 20. A boss walks in from a flank to its standoff and
 * works from there, one readable pattern per phase; phases turn at HP
 * thresholds. A boss that outlasts `BALANCE.boss.enrageAfter` enrages and
 * walks to the wall, so a fight the tower can't win ends rather than stalls.
 */

/** The live boss body, or null. */
export function bossBody(run: RunState): Enemy | null {
  const b = run.boss;
  if (!b || b.killedIn !== null) return null;
  for (const e of run.enemies) if (e.id === b.enemy) return e.alive ? e : null;
  return null;
}

/** A timer that never comes round again. */
const ONCE = 1e9;

/** How often a pattern acts: 0 for once, on entering its phase (a mirror is always on). */
function period(p: BossPattern): number {
  return p.kind === 'mirror' ? 0 : p.every;
}

function phaseTimers(patterns: readonly BossPattern[]): number[] {
  // Summons on entry and the court fire at once; everything else waits half
  // its period, so a phase opens with its new pattern rather than a lull.
  return patterns.map((p) => (period(p) === 0 || p.kind === 'court' ? 0 : period(p) * 0.5));
}

export function arriveBoss(run: RunState, region: RegionDef): void {
  const def = BOSS_BY_ID[region.boss];
  const rng = Rng.wrap(run.streams.waves);
  // From a flank: the short walk on a portrait arena (see `waves.openingArc`).
  const angle = rng.pick([0, Math.PI]);
  const p = spawnPoint(angle);
  const hp = waveHp(region, BOSS_WAVE) * def.hp;
  const body: Enemy = {
    id: run.nextEnemyId++,
    type: region.pool[0].enemy,
    boss: def.id,
    elite: false,
    aura: null,
    gen: 0,
    wave: BOSS_WAVE,
    alive: true,
    x: p.x,
    y: p.y,
    px: p.x,
    py: p.y,
    hp,
    maxHp: hp,
    armor: waveHp(region, BOSS_WAVE) * def.armor,
    speed: def.speed,
    radius: def.radius,
    damage: waveDamage(region, BOSS_WAVE) * def.damage,
    attackInterval: BALANCE.boss.attackInterval,
    xp: def.xp,
    shards: region.shardBase * def.shards * (run.firstKill ? BALANCE.boss.firstKill : 1),
    mass: def.mass,
    stunnedUntil: 0,
    slow: 0,
    slowUntil: 0,
    hiddenUntil: 0,
    actTimer: 0,
    moving: true,
    buffSpeed: 1,
    buffShield: 1,
    fury: 1,
    attackTimer: 0,
    inContact: false,
    hitTick: -1,
    burn: 0,
    burnUntil: 0,
    burnTimer: 0,
    frozenUntil: 0,
    under: false,
    group: 0,
    shade: false,
    court: 0,
  };
  run.enemies.push(body);
  if (run.current) run.current.alive++;
  const state: BossState = {
    id: def.id,
    enemy: body.id,
    phase: 0,
    arrivedAt: run.time,
    timers: phaseTimers(def.phases[0].patterns),
    windup: 0,
    windupPattern: -1,
    submerged: false,
    enraged: false,
    staggeredUntil: 0,
    facet: 0,
    crown: 0,
    minHp: Math.max(0, run.tower.hp) / run.stats.maxHp,
    killedIn: null,
  };
  run.boss = state;
  run.events.push({ kind: 'bossArrive', boss: def.id });
}

/** True once the boss has walked in to where it works from. */
function atPost(e: Enemy, def: BossDef): boolean {
  return Math.hypot(e.x, e.y) <= def.standoff + 1;
}

/** The boss's patterns, its phases and its enrage, one step. */
export function tickBoss(run: RunState, region: RegionDef, dt: number): void {
  const b = run.boss;
  const e = bossBody(run);
  if (!b || !e) return;
  const def = BOSS_BY_ID[b.id];

  // Phases turn at HP thresholds; a big hit may skip one.
  const frac = e.hp / e.maxHp;
  while (b.phase + 1 < def.phases.length && frac <= def.phases[b.phase + 1].below) {
    b.phase++;
    const ph = def.phases[b.phase];
    b.timers = phaseTimers(ph.patterns);
    b.windup = 0;
    // Plates break away (Forgeheart): the phase sets what armour is left.
    if (ph.armor !== undefined) e.armor = waveHp(region, BOSS_WAVE) * ph.armor;
    // A phase with no court gathers the shades back in.
    if (!ph.patterns.some((p) => p.kind === 'court')) dismissCourt(run);
    run.events.push({ kind: 'bossPhase', boss: b.id, phase: b.phase });
  }
  // The mirror turns all the time, not on a timer.
  for (const p of def.phases[b.phase].patterns) if (p.kind === 'mirror') b.facet += p.spin * dt;

  const B = BALANCE.boss;
  const since = run.time - b.arrivedAt;
  if (!b.enraged && since >= B.enrageAfter) {
    b.enraged = true;
    run.events.push({ kind: 'enrage' });
  }
  const fury = b.enraged ? Math.pow(B.enrageGrowth, Math.floor((since - B.enrageAfter) / B.enrageEvery) + 1) : 1;
  e.damage = waveDamage(region, BOSS_WAVE) * def.damage * fury;

  // Under the water: it rises somewhere else on the same ring.
  if (b.submerged) {
    if (run.time < e.hiddenUntil) return;
    b.submerged = false;
    const rng = Rng.wrap(run.streams.waves);
    const d = Math.hypot(e.x, e.y);
    const a = Math.atan2(e.y, e.x) + rng.pick([-1, 1]) * rng.range(B.emergeArc[0], B.emergeArc[1]);
    e.x = e.px = Math.cos(a) * d;
    e.y = e.py = Math.sin(a) * d;
    run.events.push({ kind: 'emerge', x: e.x, y: e.y });
  }

  if (b.windup > 0) {
    b.windup -= dt;
    if (b.windup <= 0) {
      b.windup = 0;
      const p = def.phases[b.phase].patterns[b.windupPattern];
      if (p?.kind === 'slam') {
        run.rings.push({ x: e.x, y: e.y, radius: e.radius, speed: p.speed, damage: p.damage * waveDamage(region, BOSS_WAVE) * fury, hit: false });
        run.events.push({ kind: 'slam', x: e.x, y: e.y });
      }
    }
    return;
  }
  if (run.time < b.staggeredUntil) return;

  const patterns = def.phases[b.phase].patterns;
  for (let i = 0; i < patterns.length; i++) {
    b.timers[i] -= dt;
    if (b.timers[i] > 0) continue;
    const p = patterns[i];
    // A once-only pattern parks far in the future (JSON has no Infinity, and the run is snapshotted).
    b.timers[i] = period(p) === 0 ? ONCE : period(p);
    switch (p.kind) {
      case 'slam':
        // Only from its post: a slam on the walk in would be unreadable.
        if (!atPost(e, def)) {
          b.timers[i] = 0.5;
          break;
        }
        b.windup = p.windup;
        b.windupPattern = i;
        run.events.push({ kind: 'windup', x: e.x, y: e.y, seconds: p.windup });
        return;
      case 'summon': {
        const rng = Rng.wrap(run.streams.waves);
        const pack = ENEMY_BY_ID[p.enemy].pack;
        const spread = BALANCE.waves.packSpread;
        for (let k = 0; k < p.packs; k++) {
          const a = rng.range(0, Math.PI * 2);
          const size = rng.int(pack[0], pack[1]);
          for (let j = 0; j < size; j++) {
            const at = spawnPoint(a + rng.range(-spread, spread));
            spawnEnemy(run, region, p.enemy, BOSS_WAVE, at.x, at.y);
          }
        }
        break;
      }
      case 'submerge':
        if (!atPost(e, def)) {
          b.timers[i] = 0.5;
          break;
        }
        b.submerged = true;
        e.hiddenUntil = run.time + p.seconds;
        run.events.push({ kind: 'submerge', x: e.x, y: e.y });
        return;
      case 'mirror':
        // Always on: see the turn above and `reflectShot`.
        b.timers[i] = ONCE;
        break;
      case 'pool': {
        const rng = Rng.wrap(run.streams.waves);
        const a = rng.range(0, Math.PI * 2);
        const d = run.stats.radius + p.radius * 0.5;
        const x = Math.cos(a) * d;
        const y = Math.sin(a) * d;
        run.pools.push({ x, y, radius: p.radius, dps: p.dps * waveDamage(region, BOSS_WAVE) * fury, until: run.time + p.seconds, timer: POOL_TICK });
        run.events.push({ kind: 'pool', x, y, radius: p.radius });
        break;
      }
      case 'court':
        holdCourt(run, region, e, p.shades);
        break;
      default: {
        const exhaustive: never = p;
        return exhaustive;
      }
    }
  }
}

/**
 * A Nova that lands during a slam's wind-up staggers the boss (the
 * Gatekeeper's phase-1 line): the slam is lost and it pauses.
 */
export function staggerBoss(run: RunState): boolean {
  const b = run.boss;
  const e = bossBody(run);
  if (!b || !e || b.windup <= 0) return false;
  b.windup = 0;
  b.staggeredUntil = run.time + BALANCE.boss.staggerSeconds;
  run.events.push({ kind: 'stagger', x: e.x, y: e.y });
  return true;
}

/** Seconds between a molten pool's bites. */
const POOL_TICK = 0.5;

/** Molten pools burn the tower while they last (Forgeheart). */
export function tickPools(run: RunState, dt: number): void {
  if (run.pools.length === 0) return;
  run.pools = run.pools.filter((p) => p.until > run.time);
  for (const p of run.pools) {
    p.timer -= dt;
    if (p.timer > 0) continue;
    p.timer += POOL_TICK;
    hurtTower(run, p.dps * POOL_TICK, p.x, p.y, null);
  }
}

/**
 * The Hollow King's court: the first time, he splits into his shades at his
 * own distance round the ring; after, the crown moves on to another body.
 */
function holdCourt(run: RunState, region: RegionDef, king: Enemy, shades: number): void {
  const b = run.boss!;
  const court = run.enemies.filter((o) => o.alive && o.court === king.id);
  const rng = Rng.wrap(run.streams.waves);
  if (court.length === 0) {
    const d = Math.hypot(king.x, king.y);
    const a0 = Math.atan2(king.y, king.x);
    for (let k = 1; k < shades; k++) {
      const a = a0 + (k / shades) * Math.PI * 2;
      const s = spawnEnemy(run, region, king.type, BOSS_WAVE, Math.cos(a) * d, Math.sin(a) * d, { single: true });
      Object.assign(s, {
        court: king.id, under: false, hp: king.maxHp, maxHp: king.maxHp, armor: king.armor, radius: king.radius * 0.85,
        speed: king.speed, mass: king.mass, xp: 0, shards: 0, hiddenUntil: 0,
      });
      court.push(s);
    }
  }
  const bodies = [king, ...court];
  const others = bodies.filter((o) => o.id !== b.crown);
  const next = rng.pick(others);
  b.crown = next.id;
  run.events.push({ kind: 'crown', x: next.x, y: next.y });
}

/** The shades fade back into the king: no kill, no reward. */
function dismissCourt(run: RunState): void {
  const b = run.boss;
  if (!b) return;
  for (const o of run.enemies) {
    if (!o.alive || o.court !== b.enemy) continue;
    o.alive = false;
    if (run.current && o.wave === run.current.n) run.current.alive--;
  }
  b.crown = 0;
}

/**
 * A shot striking the boss at (x, y) meets one of its mirror's facets (the
 * Prism): it flies back at the tower. True when it was turned away.
 */
export function reflectShot(run: RunState, e: Enemy, x: number, y: number): boolean {
  const b = run.boss;
  if (!b || b.enemy !== e.id) return false;
  const p = BOSS_BY_ID[b.id].phases[b.phase].patterns.find((q) => q.kind === 'mirror');
  if (p?.kind !== 'mirror') return false;
  const at = Math.atan2(y - e.y, x - e.x);
  let hit = false;
  for (let k = 0; k < p.facets; k++) {
    const c = b.facet + (k / p.facets) * Math.PI * 2;
    const off = Math.abs(Math.atan2(Math.sin(at - c), Math.cos(at - c)));
    if (off <= p.arc / 2) hit = true;
  }
  if (!hit) return false;
  const d = Math.hypot(e.x, e.y) || 1;
  const speed = BALANCE.boss.reflectSpeed;
  const region = regionByIndex(run.regionId);
  run.shots.push({
    x: e.x, y: e.y, px: e.x, py: e.y, vx: (-e.x / d) * speed, vy: (-e.y / d) * speed,
    damage: p.damage * waveDamage(region, BOSS_WAVE), life: BALANCE.shots.life,
  });
  run.events.push({ kind: 'deflect', x, y });
  return true;
}

/** Facet centres of the boss's mirror now, for the painter; empty without one. */
export function mirrorFacets(run: RunState): { angle: number; arc: number }[] {
  const b = run.boss;
  if (!b || b.killedIn !== null) return [];
  const p = BOSS_BY_ID[b.id].phases[b.phase].patterns.find((q) => q.kind === 'mirror');
  if (p?.kind !== 'mirror') return [];
  return Array.from({ length: p.facets }, (_, k) => ({ angle: b.facet + (k / p.facets) * Math.PI * 2, arc: p.arc }));
}

/** Shockwaves roll out; each hits the tower once, as it reaches the wall. */
export function tickRings(run: RunState, dt: number): void {
  const R = run.stats.radius;
  let w = 0;
  for (const r of run.rings) {
    r.radius += r.speed * dt;
    const d = Math.hypot(r.x, r.y);
    if (!r.hit && r.radius >= d - R) {
      r.hit = true;
      hurtTower(run, r.damage, r.x, r.y, null);
    }
    // Kept a little past the tower so the ring visibly rolls through it.
    if (r.radius < d + R * 3) run.rings[w++] = r;
  }
  run.rings.length = w;
}

/** The boss fell: its time, and the ceremony's cue. Shards come with the kill. */
export function onBossKilled(run: RunState, e: Enemy): void {
  const b = run.boss;
  if (!b || b.enemy !== e.id || b.killedIn !== null) return;
  b.killedIn = run.time - b.arrivedAt;
  b.windup = 0;
  dismissCourt(run);
  run.pools.length = 0;
  run.events.push({ kind: 'bossKill', boss: b.id, first: run.firstKill, x: e.x, y: e.y });
}
