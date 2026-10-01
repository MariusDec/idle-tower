import { Rng } from '../../core/rng';
import { BALANCE } from '../../content/balance';
import { BOSS_BY_ID } from '../../content/bosses';
import { ENEMY_BY_ID } from '../../content/enemies';
import { spawnPoint } from '../../content/arena';
import type { BossDef, BossPattern, RegionDef } from '../../content/types';
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

function phaseTimers(patterns: readonly BossPattern[]): number[] {
  // Summons on entry fire at once; everything else waits half its period,
  // so a phase opens with its new pattern rather than a lull.
  return patterns.map((p) => (p.every === 0 ? 0 : p.every * 0.5));
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
  b.minHp = Math.min(b.minHp, Math.max(0, run.tower.hp) / run.stats.maxHp);

  // Phases turn at HP thresholds; a big hit may skip one.
  const frac = e.hp / e.maxHp;
  while (b.phase + 1 < def.phases.length && frac <= def.phases[b.phase + 1].below) {
    b.phase++;
    b.timers = phaseTimers(def.phases[b.phase].patterns);
    b.windup = 0;
    run.events.push({ kind: 'bossPhase', boss: b.id, phase: b.phase });
  }

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
    b.timers[i] = p.every === 0 ? ONCE : p.every;
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
  run.events.push({ kind: 'bossKill', boss: b.id, first: run.firstKill, x: e.x, y: e.y });
}
