import { Rng } from '../../core/rng';
import { TAU } from '../../core/math';
import { BALANCE } from '../../content/balance';
import { ENEMY_BY_ID } from '../../content/enemies';
import { spawnPoint } from '../../content/arena';
import type { EnemyId, RegionDef } from '../../content/types';
import type { Enemy, RunState, SpawnEntry, WaveState } from '../state';

/**
 * Waves (§4.2): pre-rolled from the region template at wave start, placed on
 * schedule, and chained by the overlap rule.
 */

/** HP of a weight-1 enemy in wave `n` (§8.2). */
export function waveHp(region: RegionDef, n: number): number {
  return region.hpBase * Math.pow(region.hpGrowth, n - 1);
}

export function waveDamage(region: RegionDef, n: number): number {
  return region.damageBase * Math.pow(region.damageGrowth, n - 1);
}

export function spawnSeconds(n: number): number {
  const s = BALANCE.waves.spawnSeconds;
  return Math.min(s.max, s.base + s.perWave * (n - 1));
}

/**
 * Roll wave `n`'s spawn list. Pure given the rng: the same stream state gives
 * the same wave, which is what lets `inspect` and the determinism test agree
 * with the game.
 */
export function rollWave(region: RegionDef, n: number, rng: Rng): SpawnEntry[] {
  const W = BALANCE.waves;
  const beat = region.beats[n];
  let count = Math.round(region.count.base + region.count.perWave * (n - 1));
  if (beat?.kind === 'swarm') count = Math.round(count * beat.countMult);

  const pool = region.pool.filter((p) => p.from <= n);
  const weights = pool.map((p) => p.weight);
  const duration = spawnSeconds(n);
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
  out.sort((a, b) => a.at - b.at);
  // The first body of every wave arrives at once: a wave that opens with
  // several seconds of nothing reads as a stall. The run's very first body
  // comes dead level with the tower, the shortest walk on a portrait arena.
  if (out.length > 0) {
    out[0] = { ...out[0], at: 0, angle: n === 1 ? rng.pick([0, Math.PI]) : out[0].angle };
  }
  return out;
}

export function startWave(run: RunState, region: RegionDef, n: number): void {
  const rng = Rng.wrap(run.streams.waves);
  run.current = {
    n,
    startedAt: run.time,
    spawns: rollWave(region, n, rng),
    next: 0,
    doneAt: null,
    alive: 0,
  };
  run.wave = n;
  run.events.push({ kind: 'waveStart', wave: n });
}

function place(run: RunState, region: RegionDef, wave: WaveState, entry: SpawnEntry): void {
  const def = ENEMY_BY_ID[entry.enemy];
  const hp = waveHp(region, wave.n) * def.hp;
  const p = spawnPoint(entry.angle);
  const enemy: Enemy = {
    id: run.nextEnemyId++,
    type: def.id,
    wave: wave.n,
    alive: true,
    x: p.x,
    y: p.y,
    px: p.x,
    py: p.y,
    hp,
    maxHp: hp,
    armor: waveHp(region, wave.n) * def.armor,
    speed: def.speed,
    radius: def.radius,
    damage: waveDamage(region, wave.n) * def.damage,
    attackInterval: def.attackInterval,
    xp: def.xp,
    mass: def.mass,
    stunnedUntil: 0,
    attackTimer: 0,
    inContact: false,
    hitTick: -1,
  };
  run.enemies.push(enemy);
  wave.alive++;
  if (!run.seen.includes(def.id)) {
    run.seen.push(def.id);
    run.events.push({ kind: 'firstSight', enemy: def.id });
  }
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
  if (cur.doneAt !== null && shouldAdvance(cur, run.time)) startWave(run, region, cur.n + 1);
}

/** The overlap rule (§4.2), pure so it is testable on its own. */
export function shouldAdvance(wave: WaveState, time: number): boolean {
  if (wave.doneAt === null) return false;
  const W = BALANCE.waves;
  if (wave.alive <= wave.spawns.length * W.clearFraction) return true;
  return time - wave.doneAt >= W.overlapSeconds;
}
