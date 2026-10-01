import { Rng } from '../../core/rng';
import { TAU } from '../../core/math';
import { BALANCE } from '../../content/balance';
import { ENEMY_BY_ID } from '../../content/enemies';
import { spawnPoint } from '../../content/arena';
import type { AuraId, EnemyId, RegionDef } from '../../content/types';
import type { Enemy, RunState, SpawnEntry, WaveState } from '../state';
import { arriveBoss } from './boss';

/**
 * Waves (§4.2): pre-rolled from the region template at wave start, placed on
 * schedule, and chained by the overlap rule. Wave 20 is the boss (`boss.ts`);
 * past it, overtime: the template runs on with steeper HP and richer shards
 * (§8.2), until the tower falls.
 */

/** The boss wave (§4.2). */
export const BOSS_WAVE = 20;

/** HP of a weight-1 enemy in wave `n` (§8.2). Overtime grows faster. */
export function waveHp(region: RegionDef, n: number): number {
  const base = region.hpBase * Math.pow(region.hpGrowth, Math.min(n, BOSS_WAVE) - 1);
  return n > BOSS_WAVE ? base * Math.pow(BALANCE.overtime.hpGrowth, n - BOSS_WAVE) : base;
}

export function waveDamage(region: RegionDef, n: number): number {
  return region.damageBase * Math.pow(region.damageGrowth, n - 1);
}

/** Shard multiplier for wave `n`: 1 in the region, rising in overtime (§8.2). */
export function waveShardMult(n: number): number {
  return n > BOSS_WAVE ? Math.pow(BALANCE.overtime.shardGrowth, n - BOSS_WAVE) : 1;
}

/** True when wave `n` brings an elite (§4.3). The boss wave never does. */
export function isEliteWave(region: RegionDef, n: number): boolean {
  const e = region.elites;
  return n !== BOSS_WAVE && n >= e.from && (n - e.from) % e.every === 0;
}

export function spawnSeconds(n: number): number {
  const s = BALANCE.waves.spawnSeconds;
  return Math.min(s.max, s.base + s.perWave * (n - 1));
}

/**
 * Roll wave `n`'s spawn list. Pure given the rng: the same stream state gives
 * the same wave, which is what lets `inspect` and the determinism test agree
 * with the game. `pace` > 1 squeezes the wave into less time (Tallow Candle).
 */
export function rollWave(region: RegionDef, n: number, rng: Rng, pace = 1): SpawnEntry[] {
  if (n === BOSS_WAVE) return [];
  const W = BALANCE.waves;
  const beat = region.beats[n];
  let count = Math.round(region.count.base + region.count.perWave * (n - 1));
  if (beat?.kind === 'swarm') count = Math.round(count * beat.countMult);

  const pool = region.pool.filter((p) => p.from <= n);
  const weights = pool.map((p) => p.weight);
  const duration = spawnSeconds(n) / pace;
  const out: SpawnEntry[] = [];
  const angle = (): number => (n === 1
    ? rng.pick([0, Math.PI]) + rng.range(-W.openingArc, W.openingArc)
    : rng.range(0, TAU));

  const addPack = (enemy: EnemyId, at: number): number => {
    const def = ENEMY_BY_ID[enemy];
    const size = rng.int(def.pack[0], def.pack[1]);
    const a = angle();
    for (let i = 0; i < size; i++) {
      out.push({
        at: at + i * W.packStagger,
        enemy,
        angle: a + rng.range(-W.packSpread, W.packSpread),
      });
    }
    return size;
  };

  // A beat's introduction packs arrive a third of the way in, together, so the
  // new type is seen on its own before the rest of the wave crowds it.
  if (beat?.kind === 'introduce') {
    for (let i = 0; i < beat.packs; i++) count -= addPack(beat.enemy, duration / 3 + i * 0.6);
  }

  let placed = 0;
  while (placed < Math.max(0, count)) {
    const enemy = pool[rng.weighted(weights)].enemy;
    placed += addPack(enemy, rng.range(0, duration));
  }
  // An elite walks in alone, halfway through, so it reads as the wave's event.
  if (isEliteWave(region, n)) {
    const auras = region.elites.auras;
    const aura: AuraId | null = auras.length > 0 ? rng.pick(auras) : null;
    out.push({ at: duration / 2, enemy: pool[rng.weighted(weights)].enemy, angle: angle(), elite: { aura } });
  }
  out.sort((a, b) => a.at - b.at);
  // The first body of every wave arrives at once: a wave that opens with
  // several seconds of nothing reads as a stall. The run's very first body
  // comes dead level with the tower, the shortest walk on a portrait arena.
  if (out.length > 0) {
    out[0] = { ...out[0], at: 0, angle: n === 1 ? rng.pick([0, Math.PI]) : out[0].angle };
  }
  return out;
}

/** How much faster waves arrive at wave `n` (Tallow Candle, §11.5). */
export function wavePace(run: RunState, n: number): number {
  const rank = run.behaviours['quick-start'] ?? 0;
  if (rank === 0 || n > BALANCE.relics.quickStartWaves) return 1;
  return BALANCE.relics.quickStart[Math.min(rank, BALANCE.relics.maxRank) - 1];
}

export function startWave(run: RunState, region: RegionDef, n: number): void {
  // Reaching wave n pays for holding wave n − 1 (§8.3).
  if (n > 1) {
    const bonus = region.waveShards * (n - 1) * waveShardMult(n - 1) * run.stats.shardMult;
    run.shards += bonus;
    run.shardsFrom.waves += bonus;
  }
  const rng = Rng.wrap(run.streams.waves);
  run.current = {
    n,
    startedAt: run.time,
    spawns: rollWave(region, n, rng, wavePace(run, n)),
    next: 0,
    doneAt: null,
    alive: 0,
  };
  run.wave = n;
  if (run.weapons.length === 1) run.loneWave = n;
  run.events.push({ kind: 'waveStart', wave: n });
  if (n === BOSS_WAVE) arriveBoss(run, region);
}

export interface SpawnOptions {
  elite?: { aura: AuraId | null };
  /**
   * Split fragments: generation 1, `hp` outright, a smaller body, and
   * `share` of a whole body's XP and shards, so a split pays about what
   * one body is worth rather than four.
   */
  fragment?: { hp: number; scale: number; share: number };
}

/**
 * Put one body of `type` on the field at (x, y), sized for wave `wave` of
 * `region`. Every body enters through here: wave spawns, a boss's summons and
 * a Splitter's fragments.
 */
export function spawnEnemy(
  run: RunState, region: RegionDef, type: EnemyId, wave: number, x: number, y: number, opts: SpawnOptions = {},
): Enemy {
  const def = ENEMY_BY_ID[type];
  const E = BALANCE.elites;
  const elite = opts.elite !== undefined;
  let hp = waveHp(region, wave) * def.hp * (elite ? E.hp : 1);
  let radius = def.radius * (elite ? E.scale : 1);
  if (opts.fragment) {
    hp = opts.fragment.hp;
    radius = def.radius * opts.fragment.scale;
  }
  const share = opts.fragment?.share ?? 1;
  const xp = def.xp * (elite ? E.xp : 1) * share;
  const bounty = elite && run.behaviours.bounty ? BALANCE.behaviours.bounty : 1;
  const enemy: Enemy = {
    id: run.nextEnemyId++,
    type: def.id,
    boss: null,
    elite,
    aura: opts.elite?.aura ?? null,
    gen: opts.fragment ? 1 : 0,
    wave,
    alive: true,
    x,
    y,
    px: x,
    py: y,
    hp,
    maxHp: hp,
    armor: waveHp(region, wave) * def.armor,
    speed: def.speed,
    radius,
    damage: waveDamage(region, wave) * def.damage,
    attackInterval: def.attackInterval,
    xp,
    shards: region.shardBase * def.xp * share * waveShardMult(wave) * (elite ? E.shards * bounty : 1),
    mass: def.mass * (elite ? E.scale * E.scale : 1),
    stunnedUntil: 0,
    slow: 0,
    slowUntil: 0,
    hiddenUntil: 0,
    actTimer: def.verb.kind === 'ranged' || def.verb.kind === 'heal' ? def.verb.interval * 0.5 : 0,
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
  };
  run.enemies.push(enemy);
  if (run.current && wave === run.current.n) run.current.alive++;
  if (!run.seen.includes(def.id)) {
    run.seen.push(def.id);
    run.events.push({ kind: 'firstSight', enemy: def.id });
  }
  if (elite) run.events.push({ kind: 'eliteSpawn', x, y, aura: enemy.aura });
  return enemy;
}

function place(run: RunState, region: RegionDef, wave: WaveState, entry: SpawnEntry): void {
  const p = spawnPoint(entry.angle);
  spawnEnemy(run, region, entry.enemy, wave.n, p.x, p.y, entry.elite ? { elite: entry.elite } : {});
}

/** Place due spawns, then start the next wave if the overlap rule allows. */
export function tickWaves(run: RunState, region: RegionDef): void {
  const W = BALANCE.waves;
  const cur = run.current;
  if (!cur) {
    if (run.time >= W.firstWaveDelay) startWave(run, region, 1);
    return;
  }
  const elapsed = run.time - cur.startedAt;
  while (cur.next < cur.spawns.length && cur.spawns[cur.next].at <= elapsed) {
    // The live-enemy ceiling holds spawns back rather than dropping them.
    if (run.enemies.length >= BALANCE.maxEnemies) break;
    place(run, region, cur, cur.spawns[cur.next]);
    cur.next++;
  }
  if (cur.doneAt === null && cur.next >= cur.spawns.length) cur.doneAt = run.time;
  if (cur.n === BOSS_WAVE) {
    // The boss wave holds until the boss falls; overtime follows a beat later.
    const b = run.boss;
    if (b?.killedIn != null && run.time - (b.arrivedAt + b.killedIn) >= W.afterBoss) {
      startWave(run, region, cur.n + 1);
    }
    return;
  }
  if (cur.doneAt !== null && shouldAdvance(cur, run.time, wavePace(run, cur.n))) startWave(run, region, cur.n + 1);
}

/** The overlap rule (§4.2), pure so it is testable on its own. */
export function shouldAdvance(wave: WaveState, time: number, pace = 1): boolean {
  if (wave.doneAt === null) return false;
  const W = BALANCE.waves;
  if (wave.alive <= wave.spawns.length * W.clearFraction) return true;
  return time - wave.doneAt >= W.overlapSeconds / pace;
}
