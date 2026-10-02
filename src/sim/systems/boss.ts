import { Rng } from '../../core/rng';
import { BALANCE } from '../../content/balance';
import { BOSS_BY_ID } from '../../content/bosses';
import { ENEMY_BY_ID } from '../../content/enemies';
import { spawnPoint } from '../../content/arena';
import type { BossDef, BossPattern, BossPhase, RegionDef } from '../../content/types';
import type { BossState, Enemy, RunState } from '../state';
import { bossPhases, pactLoad } from '../pacts';
import { foeHp, runRegion, spawnEnemy, waveDamage, waveHp, waveShardMult } from './waves';
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

/** The boss's phases as this run fights them: Tyranny adds more (§9). */
export function phasesOf(run: RunState, def: BossDef): readonly BossPhase[] {
  return bossPhases(def, pactLoad(run.pacts).tyranny);
}

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
  // The wave it holds: 20, or the floor's tenth in the Abyss, where a
  // guardian is a lighter fight (§9). Vigour and Tyranny swell it.
  const wave = run.wave;
  const load = pactLoad(run.pacts);
  const hp = waveHp(region, wave) * def.hp * (region.abyss ? BALANCE.abyss.bossHp : 1) * foeHp(run) * load.bossHp;
  const body: Enemy = {
    id: run.nextEnemyId++,
    type: region.pool[0].enemy,
    boss: def.id,
    elite: false,
    aura: null,
    gen: 0,
    wave,
    alive: true,
    x: p.x,
    y: p.y,
    px: p.x,
    py: p.y,
    hp,
    maxHp: hp,
    armor: waveHp(region, wave) * def.armor,
    speed: def.speed * load.speed,
    radius: def.radius,
    damage: waveDamage(region, wave) * def.damage,
    attackInterval: BALANCE.boss.attackInterval,
    xp: def.xp,
    shards: region.shardBase * def.shards * waveShardMult(wave, region) * (run.firstKill ? BALANCE.boss.firstKill : 1),
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
    plate: 0,
    slot: 0,
    shell: 0,
    dashUntil: 0,
    gildedUntil: 0,
    feeds: 0,
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
    plates: 0,
    minHp: Math.max(0, run.tower.hp) / run.stats.maxHp,
    killedIn: null,
    wave,
  };
  run.boss = state;
  wearPlates(run, region, body, def, def.phases[0].plates, true);
  run.events.push({ kind: 'bossArrive', boss: def.id });
}

/** How far out a plate hangs off its boss's rim, and how wide its plates fan, radians either side of the line to the tower. */
const PLATE_REACH = 0.6;
const PLATE_FAN = 0.6;

/**
 * Forgeheart's plates (S2): a phase says how many it wears. Extra plates
 * crack away; `hang` (its arrival, or a phase Tyranny replays) hangs new
 * ones up to the count. Each is a body with its own HP and heavy armour.
 */
function wearPlates(run: RunState, region: RegionDef, boss: Enemy, def: BossDef, n: number | undefined, hang: boolean): void {
  const spec = def.plates;
  const b = run.boss;
  if (!spec || n === undefined || !b) return;
  const worn = run.enemies.filter((o) => o.alive && o.plate === boss.id);
  for (const o of worn.slice(n)) dropPlate(run, o);
  if (!hang) return;
  for (let k = worn.length; k < n; k++) {
    const s = spawnEnemy(run, region, boss.type, b.wave, boss.x, boss.y, { single: true });
    Object.assign(s, {
      plate: boss.id, slot: n === 1 ? 0 : PLATE_FAN * (2 * (k / (n - 1)) - 1),
      hp: boss.maxHp * spec.hp, maxHp: boss.maxHp * spec.hp, armor: waveHp(region, b.wave) * spec.armor,
      radius: spec.radius, speed: 0, mass: def.mass, xp: 0, shards: 0, under: false, shell: 0, hiddenUntil: 0,
    });
    b.plates++;
  }
  placePlates(run, boss);
}

/** Plates ride on their boss, facing the tower. */
function placePlates(run: RunState, boss: Enemy): void {
  if (!run.boss || run.boss.plates === 0) return;
  const toward = Math.atan2(-boss.y, -boss.x);
  for (const o of run.enemies) {
    if (!o.alive || o.plate !== boss.id) continue;
    const a = toward + o.slot;
    const d = boss.radius + o.radius * PLATE_REACH;
    o.px = o.x;
    o.py = o.y;
    o.x = boss.x + Math.cos(a) * d;
    o.y = boss.y + Math.sin(a) * d;
  }
}

/** A plate falls: struck off (`kill`, which also calls this) or cracked away. */
export function dropPlate(run: RunState, o: Enemy): void {
  if (o.alive) {
    o.alive = false;
    if (run.current && o.wave === run.current.n) run.current.alive--;
  }
  if (run.boss) run.boss.plates = Math.max(0, run.boss.plates - 1);
  run.events.push({ kind: 'plateBreak', x: o.x, y: o.y, radius: o.radius });
}

/** The share of a hit the boss takes now: its guard while a plate stands, else all of it. */
export function plateGuard(run: RunState): number {
  const b = run.boss;
  if (!b || b.plates === 0) return 1;
  return BOSS_BY_ID[b.id].plates?.guard ?? 1;
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
  const phases = phasesOf(run, def);

  // Phases turn at HP thresholds; a big hit may skip one.
  const frac = e.hp / e.maxHp;
  while (b.phase + 1 < phases.length && frac <= phases[b.phase + 1].below) {
    b.phase++;
    const ph = phases[b.phase];
    b.timers = phaseTimers(ph.patterns);
    b.windup = 0;
    if (ph.armor !== undefined) e.armor = waveHp(region, b.wave) * ph.armor;
    // Plates crack away (Forgeheart); a phase Tyranny replays hangs them anew.
    wearPlates(run, region, e, def, ph.plates, b.phase >= def.phases.length);
    // A phase with no court gathers the shades back in.
    if (!ph.patterns.some((p) => p.kind === 'court')) dismissCourt(run);
    run.events.push({ kind: 'bossPhase', boss: b.id, phase: b.phase });
  }
  placePlates(run, e);
  // The mirror turns all the time, not on a timer.
  for (const p of phases[b.phase].patterns) if (p.kind === 'mirror') b.facet += p.spin * dt;

  const B = BALANCE.boss;
  const since = run.time - b.arrivedAt;
  if (!b.enraged && since >= B.enrageAfter) {
    b.enraged = true;
    run.events.push({ kind: 'enrage' });
  }
  const fury = b.enraged ? Math.pow(B.enrageGrowth, Math.floor((since - B.enrageAfter) / B.enrageEvery) + 1) : 1;
  e.damage = waveDamage(region, b.wave) * def.damage * fury;

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
      const p = phases[b.phase].patterns[b.windupPattern];
      if (p?.kind === 'slam') {
        run.rings.push({ x: e.x, y: e.y, radius: e.radius, speed: p.speed, damage: p.damage * waveDamage(region, b.wave) * fury, hit: false });
        run.events.push({ kind: 'slam', x: e.x, y: e.y });
      }
    }
    return;
  }
  if (run.time < b.staggeredUntil) return;

  const patterns = phases[b.phase].patterns;
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
            spawnEnemy(run, region, p.enemy, b.wave, at.x, at.y);
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
        run.pools.push({ x, y, radius: p.radius, dps: p.dps * waveDamage(region, b.wave) * fury, until: run.time + p.seconds, timer: POOL_TICK });
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
    hurtTower(run, p.dps * POOL_TICK, p.x, p.y, null, 'pools');
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
      const s = spawnEnemy(run, region, king.type, b.wave, Math.cos(a) * d, Math.sin(a) * d, { single: true });
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
  const p = phasesOf(run, BOSS_BY_ID[b.id])[b.phase].patterns.find((q) => q.kind === 'mirror');
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
  run.shots.push({
    x: e.x, y: e.y, px: e.x, py: e.y, vx: (-e.x / d) * speed, vy: (-e.y / d) * speed,
    damage: p.damage * waveDamage(runRegion(run), b.wave), life: BALANCE.shots.life,
  });
  run.events.push({ kind: 'deflect', x, y });
  return true;
}

/** Facet centres of the boss's mirror now, for the painter; empty without one. */
export function mirrorFacets(run: RunState): { angle: number; arc: number }[] {
  const b = run.boss;
  if (!b || b.killedIn !== null) return [];
  const p = phasesOf(run, BOSS_BY_ID[b.id])[b.phase].patterns.find((q) => q.kind === 'mirror');
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
      hurtTower(run, r.damage, r.x, r.y, null, 'slams');
    }
    // Kept a little past the tower so the ring visibly rolls through it.
    if (r.radius < d + R * 3) run.rings[w++] = r;
  }
  run.rings.length = w;
}

/**
 * The boss fell: its time, and the ceremony's cue. Shards come with the
 * kill. In the Abyss its fall clears the floor (§9).
 */
export function onBossKilled(run: RunState, e: Enemy): void {
  const b = run.boss;
  if (!b || b.enemy !== e.id || b.killedIn !== null) return;
  b.killedIn = run.time - b.arrivedAt;
  b.windup = 0;
  dismissCourt(run);
  for (const o of run.enemies) if (o.alive && o.plate === e.id) dropPlate(run, o);
  run.pools.length = 0;
  run.felled.push(b.id);
  run.events.push({ kind: 'bossKill', boss: b.id, first: run.firstKill, x: e.x, y: e.y });
  if (runRegion(run).abyss) {
    run.floors++;
    run.events.push({ kind: 'floor', floor: run.floors });
    // Abyssal Pearl (§9): each floor cleared mends the tower.
    const pearl = run.behaviours['floor-heal'] ?? 0;
    if (pearl > 0) {
      const R = BALANCE.relics.floorHeal;
      run.tower.hp = Math.min(run.stats.maxHp, run.tower.hp + run.stats.maxHp * R[Math.min(pearl, R.length) - 1]);
    }
  }
}
