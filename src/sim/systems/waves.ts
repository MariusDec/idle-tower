import { Rng } from '../../core/rng';
import { TAU } from '../../core/math';
import { ABYSS_INDEX, FLOOR_WAVES, abyssFloor, floorOf, floorWave } from '../../content/abyss';
import { BALANCE } from '../../content/balance';
import { ENEMY_BY_ID } from '../../content/enemies';
import { spawnPoint } from '../../content/arena';
import type { AuraId, EnemyId, EnemyVerb, RegionDef, RegionRule, StatMod } from '../../content/types';
import { regionByIndex } from '../../content/regions';
import type { Enemy, RunState, SpawnEntry, WaveState } from '../state';
import { pactLoad, ruleSurge, scaleMod } from '../pacts';
import { allMods, resolveStats } from '../stats';
import { arriveBoss } from './boss';

/**
 * Waves (§4.2): pre-rolled from the region template at wave start, placed on
 * schedule, and chained by the overlap rule. Wave 20 is the boss (`boss.ts`);
 * past it, overtime: the template runs on with steeper HP and richer shards
 * (§8.2), until the tower falls.
 *
 * In the Abyss (§9) every ten waves are a floor: its own region (a
 * template's enemies and rule, sized for the depth), its tenth wave a boss,
 * and no overtime. Wave numbers run on across floors, and HP, damage and
 * shards grow by the global number; counts, beats and elites go by the
 * floor's own.
 */

/** The boss wave (§4.2). */
export const BOSS_WAVE = 20;

/** The region wave `n` of a run in `regionId` is fought in: the region, or that floor of the Abyss. */
export function regionAt(regionId: number, n: number): RegionDef {
  return regionId === ABYSS_INDEX ? abyssFloor(floorOf(n)) : regionByIndex(regionId);
}

/** The region the run is fighting in now. */
export function runRegion(run: RunState): RegionDef {
  return regionAt(run.regionId, Math.max(1, run.wave));
}

/** Wave `n` as its region counts it: the floor's own number in the Abyss. */
function localWave(region: RegionDef, n: number): number {
  return region.abyss ? floorWave(n) : n;
}

/** True when wave `n` is its region's boss wave: the 20th, or a floor's tenth. */
export function isBossWave(region: RegionDef, n: number): boolean {
  return region.abyss ? floorWave(n) === FLOOR_WAVES : n === BOSS_WAVE;
}

/** HP of a weight-1 enemy in wave `n` (§8.2). Overtime grows faster; the Abyss grows without a cap (§9). */
export function waveHp(region: RegionDef, n: number): number {
  if (region.abyss) return region.hpBase * Math.pow(region.hpGrowth, n - 1);
  const base = region.hpBase * Math.pow(region.hpGrowth, Math.min(n, BOSS_WAVE) - 1);
  return n > BOSS_WAVE ? base * Math.pow(BALANCE.overtime.hpGrowth, n - BOSS_WAVE) : base;
}

export function waveDamage(region: RegionDef, n: number): number {
  return region.damageBase * Math.pow(region.damageGrowth, n - 1);
}

/**
 * Shard multiplier for wave `n`: 1 in the region, rising in overtime (§8.2),
 * and in the Abyss by depth (§9).
 */
export function waveShardMult(n: number, region?: RegionDef): number {
  if (region?.abyss) return Math.pow(BALANCE.abyss.shardGrowth, n - 1);
  return n > BOSS_WAVE ? Math.pow(BALANCE.overtime.shardGrowth, n - BOSS_WAVE) : 1;
}

/** The effect of the rule of the region a run is in, or null (§11.1). */
export function regionRule(run: RunState): RegionRule | null {
  return runRegion(run).rule?.effect ?? null;
}

/**
 * A region's rule as stat contributions (§11.1), `1 + surge` times over
 * under Blight Surge (§9). The rule's one switch: the rest are read where
 * they act (`regionRule`), Brittle on every hit, Cinders and Echoes on a
 * kill, Blight on the wave roll.
 */
export function regionMods(region: RegionDef, surge = 0): StatMod[] {
  const rule = region.rule;
  if (!rule) return [];
  const e = rule.effect;
  switch (e.kind) {
    case 'stat':
      return [scaleMod(e.mod, 1 + surge)];
    case 'areaDamage':
    case 'cinders':
    case 'echoes':
    case 'blight':
      return [];
    default: {
      const exhaustive: never = e;
      return exhaustive;
    }
  }
}

/**
 * A new floor of the Abyss (§9) brings its own rule: the run's stats are
 * re-resolved with it in place of the last floor's.
 */
function enterFloor(run: RunState, region: RegionDef): void {
  run.mods = [...run.outerMods, ...regionMods(region, ruleSurge(pactLoad(run.pacts), region))];
  run.stats = resolveStats(allMods(run.mods, run.passives));
  run.tower.hp = Math.min(run.tower.hp, run.stats.maxHp);
}

/** True when wave `n` brings an elite (§4.3); under the Blight's rule, every wave. The boss wave never does. */
export function isEliteWave(region: RegionDef, n: number): boolean {
  if (isBossWave(region, n)) return false;
  if (region.rule?.effect.kind === 'blight') return true;
  const e = region.elites;
  const w = localWave(region, n);
  return w >= e.from && (w - e.from) % e.every === 0;
}

/** What the pacts add to a wave's roll (§9): more bodies, more elites. */
export interface WaveExtra {
  /** Bodies multiply by this (Hordes). */
  count: number;
  /** Elites added to an elite wave (Elites; the Blight's Surge adds to every wave). */
  elites: number;
}

const PLAIN: WaveExtra = { count: 1, elites: 0 };

export function spawnSeconds(n: number): number {
  const s = BALANCE.waves.spawnSeconds;
  return Math.min(s.max, s.base + s.perWave * (n - 1));
}

/**
 * Roll wave `n`'s spawn list. Pure given the rng: the same stream state gives
 * the same wave, which is what lets `inspect` and the determinism test agree
 * with the game. `pace` > 1 squeezes the wave into less time (Tallow Candle).
 */
export function rollWave(region: RegionDef, n: number, rng: Rng, pace = 1, extra: WaveExtra = PLAIN): SpawnEntry[] {
  if (isBossWave(region, n)) return [];
  const W = BALANCE.waves;
  // Counts, beats and the pool go by the floor's own wave in the Abyss.
  const w = localWave(region, n);
  const beat = region.beats[w];
  let count = Math.round((region.count.base + region.count.perWave * (w - 1)) * extra.count);
  if (beat?.kind === 'swarm') count = Math.round(count * beat.countMult);

  const pool = region.pool.filter((p) => p.from <= w);
  const weights = pool.map((p) => p.weight);
  const duration = spawnSeconds(w) / pace;
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
  // Pacts add more (§9), spaced after it.
  if (isEliteWave(region, n)) {
    for (let k = 0; k <= extra.elites; k++) {
      const auras = region.elites.auras;
      const aura: AuraId | null = auras.length > 0 ? rng.pick(auras) : null;
      const types = region.elites.types;
      const enemy = types && types.length > 0 ? rng.pick(types) : pool[rng.weighted(weights)].enemy;
      out.push({ at: duration / 2 + k * 1.5, enemy, angle: angle(), elite: { aura } });
    }
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

/** Shards for holding wave `n` (§8.3): growing with n in a region, with the depth in the Abyss. */
export function waveBonus(region: RegionDef, n: number): number {
  return region.abyss ? region.waveShards * waveShardMult(n, region) : region.waveShards * n * waveShardMult(n);
}

/** What the run's pacts add to wave `n`'s roll in `region` (§9). */
function waveExtra(run: RunState, region: RegionDef): WaveExtra {
  const load = pactLoad(run.pacts);
  const surge = region.rule?.effect.kind === 'blight' ? ruleSurge(load, region) : 0;
  return { count: load.count, elites: load.elites + surge };
}

export function startWave(run: RunState, region: RegionDef, n: number): void {
  // Reaching wave n pays for holding wave n − 1 (§8.3).
  if (n > 1) {
    const bonus = waveBonus(regionAt(run.regionId, n - 1), n - 1) * run.stats.shardMult;
    run.shards += bonus;
    run.shardsFrom.waves += bonus;
  }
  const rng = Rng.wrap(run.streams.waves);
  run.current = {
    n,
    startedAt: run.time,
    spawns: rollWave(region, n, rng, wavePace(run, n), waveExtra(run, region)),
    next: 0,
    doneAt: null,
    alive: 0,
  };
  run.wave = n;
  if (region.abyss && n > 1 && floorWave(n) === 1) enterFloor(run, region);
  if (run.weapons.length === 1) run.loneWave = n;
  run.events.push({ kind: 'waveStart', wave: n });
  if (isBossWave(region, n)) arriveBoss(run, region);
}

export interface SpawnOptions {
  elite?: { aura: AuraId | null };
  /**
   * Split fragments: generation 1, `hp` outright, a smaller body, and
   * `share` of a whole body's XP and shards, so a split pays about what
   * one body is worth rather than four.
   */
  fragment?: { hp: number; scale: number; share: number };
  /** A shade (Echoes, §11.1): risen once, it never rises again. */
  shade?: boolean;
  /** One body, even of a type that arrives as several (a Chorus's sibling, a boss's call). */
  single?: boolean;
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
  const load = pactLoad(run.pacts);
  const elite = opts.elite !== undefined;
  let hp = waveHp(region, wave) * def.hp * (elite ? E.hp : 1) * load.hp;
  let radius = def.radius * (elite ? E.scale : 1);
  if (opts.fragment) {
    hp = opts.fragment.hp;
    radius = def.radius * opts.fragment.scale;
  }
  const share = opts.fragment?.share ?? 1;
  // A Chorus (§11.1) arrives as its bodies at once; each pays its share.
  const chorus = def.verb.kind === 'chorus' && !elite && !opts.fragment && !opts.single ? def.verb.count : 1;
  const xp = (def.xp * (elite ? E.xp : 1) * share) / chorus;
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
    speed: def.speed * load.speed,
    radius,
    damage: waveDamage(region, wave) * def.damage,
    attackInterval: def.attackInterval,
    xp,
    shards: (region.shardBase * def.xp * share * waveShardMult(wave, region) * (elite ? E.shards * bounty : 1)) / chorus,
    mass: def.mass * (elite ? E.scale * E.scale : 1),
    stunnedUntil: 0,
    slow: 0,
    slowUntil: 0,
    hiddenUntil: 0,
    actTimer: firstAct(def.verb),
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
    under: def.verb.kind === 'burrow',
    group: 0,
    shade: opts.shade ?? false,
    court: 0,
    shell: def.verb.kind === 'carapace' ? Math.max(0, def.verb.hits - brittleShell(run)) : 0,
    dashUntil: 0,
    gildedUntil: 0,
    feeds: 0,
  };
  run.enemies.push(enemy);
  if (run.current && wave === run.current.n) run.current.alive++;
  if (!run.seen.includes(def.id)) {
    run.seen.push(def.id);
    run.events.push({ kind: 'firstSight', enemy: def.id });
  }
  if (elite) run.events.push({ kind: 'eliteSpawn', x, y, aura: enemy.aura });
  if (chorus > 1) {
    enemy.group = enemy.id;
    for (let i = 1; i < chorus; i++) {
      const a = (i / chorus) * Math.PI * 2;
      const r = enemy.radius * 1.6;
      const sib = spawnEnemy(run, region, type, wave, x + Math.cos(a) * r, y + Math.sin(a) * r, { single: true, shade: opts.shade });
      sib.group = enemy.id;
      sib.xp = enemy.xp;
      sib.shards = enemy.shards;
    }
  }
  return enemy;
}

/** Husk Splinter (§9): hits a Husk's shell swallows fewer. */
function brittleShell(run: RunState): number {
  const rank = run.behaviours['brittle-shell'] ?? 0;
  const R = BALANCE.relics.brittleShell;
  return rank > 0 ? R[Math.min(rank, R.length) - 1] : 0;
}

/** Seconds until a verb first acts: half its interval, so a new body acts soon but not at once. */
function firstAct(verb: EnemyVerb): number {
  switch (verb.kind) {
    case 'ranged':
    case 'heal':
    case 'blink':
    case 'summon':
    case 'silence':
    case 'charge':
      return verb.interval * 0.5;
    case 'phase':
      return verb.cycle - verb.hidden;
    case 'walker':
    case 'split':
    case 'shield':
    case 'burrow':
    case 'shards':
    case 'explode':
    case 'leech':
    case 'chorus':
    case 'carapace':
    case 'ward':
    case 'devour':
      return 0;
    default: {
      const exhaustive: never = verb;
      return exhaustive;
    }
  }
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
  // The next wave may be on the next floor of the Abyss: its own region.
  const next = regionAt(run.regionId, cur.n + 1);
  if (isBossWave(region, cur.n)) {
    // The boss wave holds until the boss falls; overtime (or the next floor) follows a beat later.
    const b = run.boss;
    if (b?.killedIn != null && run.time - (b.arrivedAt + b.killedIn) >= W.afterBoss) {
      startWave(run, next, cur.n + 1);
    }
    return;
  }
  if (cur.doneAt !== null && shouldAdvance(cur, run.time, wavePace(run, cur.n))) startWave(run, next, cur.n + 1);
}

/** The overlap rule (§4.2), pure so it is testable on its own. */
export function shouldAdvance(wave: WaveState, time: number, pace = 1): boolean {
  if (wave.doneAt === null) return false;
  const W = BALANCE.waves;
  if (wave.alive <= wave.spawns.length * W.clearFraction) return true;
  return time - wave.doneAt >= W.overlapSeconds / pace;
}
