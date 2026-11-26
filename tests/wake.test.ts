import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRun } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { REGIONS, regionByIndex } from '../src/content/regions';
import { glideImpacts, separateEnemies, tickEnemies, trampleAll } from '../src/sim/systems/enemies';
import { rollWave, spawnEnemy, waveDamage, waveHp } from '../src/sim/systems/waves';
import { damageEnemy, kill, knockBack, targetable, tickProjectiles, tickWeapons } from '../src/sim/systems/combat';
import { newWeapon } from '../src/sim/systems/arms';
import { Rng } from '../src/core/rng';
import { giantsOf, initWake, orbitShare, stormTargets, tickWake, tollFactor } from '../src/sim/systems/wake';
import type { RegionDef, RegionRule } from '../src/content/types';
import type { RunState } from '../src/sim/state';
import { body } from './helpers/body';

/**
 * The Wake's rules (plans/late-game/12 §4). The Toll is read in a copy of the
 * Bell Marches whose clock doesn't land on the sim's steps (2.005 s, 0.599 s),
 * so a window's edge never rounds a step either way; its natives are the real ones.
 */
const EVERY = 2.005;
const WINDOW = 0.599;
const BELLS: RegionDef = {
  ...regionByIndex(9),
  id: 'test-bells',
  index: 90,
  after: null,
  rule: { name: 'Toll', text: 'Bodies move only when the bell tolls.', effect: { kind: 'toll', every: EVERY, window: WINDOW } },
};

const regions = REGIONS as RegionDef[];

beforeAll(() => {
  if (!regions.some((r) => r.index === BELLS.index)) regions.push(BELLS);
});

afterAll(() => {
  const i = regions.indexOf(BELLS);
  if (i >= 0) regions.splice(i, 1);
});

function bellRun(): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  return createRun({ ...buildRunConfig(p), regionId: BELLS.index }, 1);
}

/** Advance the clock, the Wake's clocks and the bodies only. */
function tick(run: RunState): void {
  run.tick++;
  run.time = run.tick * SIM_DT;
  tickWake(run, BELLS, SIM_DT);
  tickEnemies(run, SIM_DT);
}

describe('the Toll (plans/late-game/12 §4.1)', () => {
  it('a run starts with only the clock its rule needs; Act 1 has none', () => {
    expect(initWake(regionByIndex(1))).toBeNull();
    expect(initWake(regionByIndex(6))).toBeNull();
    const run = bellRun();
    expect(run.wake).toEqual({
      toll: { next: BALANCE.waves.firstWaveDelay, last: -1e9, pace: 1, interval: EVERY },
      orbit: null,
      storm: null,
    });
    expect(run.streams.wake).toBeDefined();
    expect(createRun(buildRunConfig(newProfile(0)), 1).wake).toBeNull();
  });

  it('a body stands between tolls, and lurches to 0.9 of its own pace on average', () => {
    const run = bellRun();
    const e = body(run, { x: 1000, y: 0, px: 1000, py: 0, speed: 10 });
    const at: { time: number; x: number }[] = [];
    let tolls = 0;
    for (let i = 0; i < 30 / SIM_DT; i++) {
      const x = e.x;
      tick(run);
      if (run.events.some((ev) => ev.kind === 'toll')) {
        tolls++;
        at.push({ time: run.time, x });
      }
      run.events.length = 0;
      const t = run.wake!.toll!;
      if (run.time - t.last >= WINDOW) {
        expect(e.x).toBe(x);
        expect(e.moving).toBe(false);
      }
    }
    expect(tolls).toBeGreaterThan(10);
    // Whole toll cycles only, so a half-done lurch at the end doesn't count.
    const first = at[0];
    const last = at[at.length - 1];
    const avg = (first.x - last.x) / (last.time - first.time);
    expect(Math.abs(avg / (0.9 * e.speed) - 1)).toBeLessThan(0.02);
  });

  it('each Ringer alive quickens the next toll, down to the floor', () => {
    const run = bellRun();
    for (let i = 0; i < 10; i++) body(run, { type: 'ringer', x: 1000, y: i * 50 });
    while (!run.events.some((ev) => ev.kind === 'toll')) tick(run);
    // The Ringers' floor, unless the bell's own (the window × `minInterval`, D-27) is higher.
    expect(run.wake!.toll!.interval).toBeCloseTo(Math.max(EVERY * BALANCE.wake.toll.floor, WINDOW * BALANCE.wake.toll.minInterval));
    // One Ringer: one step of its hasten.
    const one = bellRun();
    body(one, { type: 'ringer', x: 1000, y: 0 });
    while (!one.events.some((ev) => ev.kind === 'toll')) tick(one);
    const ring = ENEMY_BY_ID.ringer.verb;
    expect(one.wake!.toll!.interval).toBeCloseTo(EVERY * (ring.kind === 'ring' ? ring.hasten : NaN));
  });

  it("the Carillon's quickening never takes the interval below the window's floor", () => {
    const run = bellRun();
    run.wake!.toll!.pace = 0.01;
    while (!run.events.some((ev) => ev.kind === 'toll')) tick(run);
    expect(run.wake!.toll!.interval).toBeCloseTo(WINDOW * BALANCE.wake.toll.minInterval);
  });

  it('a Sleepwalker moves every step at half pace', () => {
    const run = bellRun();
    const s = body(run, { type: 'sleepwalker', x: 1000, y: 0, speed: 10 });
    for (let i = 0; i < 3 / SIM_DT; i++) {
      const x = s.x;
      tick(run);
      expect(x - s.x).toBeCloseTo(10 * 0.5 * SIM_DT);
    }
  });

  it("a Straggler's window starts half an interval after the bell's", () => {
    const run = bellRun();
    const s = body(run, { type: 'straggler', x: 1000, y: 0, speed: 10 });
    const verb = ENEMY_BY_ID.straggler.verb;
    while (!run.events.some((ev) => ev.kind === 'toll')) tick(run);
    const t = run.wake!.toll!;
    // On the bell, it stands; half an interval on, it lurches.
    expect(tollFactor(run, s, verb)).toBe(0);
    run.time = t.last + t.interval / 2 + WINDOW / 2;
    expect(tollFactor(run, s, verb)).toBeGreaterThan(1);
    run.time = t.last + t.interval / 2 + WINDOW * 1.01;
    expect(tollFactor(run, s, verb)).toBe(0);
  });

  it('the boss, a court shade and a plate walk to their posts ignoring the bell', () => {
    const run = bellRun();
    run.time = 100;
    run.wake!.toll!.last = 0;
    const grunt = ENEMY_BY_ID.grunt.verb;
    expect(tollFactor(run, body(run, { x: 1000 }), grunt)).toBe(0);
    expect(tollFactor(run, body(run, { x: 1000, boss: 'carillon' }), null)).toBe(1);
    expect(tollFactor(run, body(run, { x: 1000, court: 1 }), null)).toBe(1);
    expect(tollFactor(run, body(run, { x: 1000, plate: 1 }), null)).toBe(1);
  });
});

function giantsRun(seed = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  return createRun({ ...buildRunConfig(p), regionId: 12 }, seed);
}

describe('Giants (plans/late-game/12 §4.4)', () => {
  it('a small body feels a giant it overlaps, however large the giant (the radius bound)', () => {
    const run = giantsRun();
    // An elite Titan grown by the rule: wider than any body the old bound (`MAX_RADIUS`) allowed for.
    const radius = ENEMY_BY_ID.titan.radius * BALANCE.elites.scale * 1.6;
    const giant = body(run, { type: 'titan', x: 600, y: 0, px: 600, py: 0, radius });
    const small = body(run, { type: 'tick', x: 600, y: 60, px: 600, py: 60, radius: 12 });
    separateEnemies(run);
    expect(small.y).toBeGreaterThan(60);
    expect(giant.y).toBeLessThan(0);
  });

  const REST = (): RegionDef => regionByIndex(12);
  const PLAIN = (): RegionDef => ({ ...regionByIndex(12), rule: null });

  it('halves a wave, and keeps its beats', () => {
    // Wave 3: only Titans (one to a pack), no beat, no elite.
    const giant = rollWave(REST(), 3, new Rng(5));
    const plain = rollWave(PLAIN(), 3, new Rng(5));
    expect(plain).toHaveLength(10);
    expect(giant).toHaveLength(5);
    // Wave 5 still introduces its Ticks, two packs of them.
    const five = rollWave(REST(), 5, new Rng(5));
    expect(five.filter((s) => s.enemy === 'tick').length).toBeGreaterThanOrEqual(2 * ENEMY_BY_ID.tick.pack[0]);
  });

  it('a giant has ×3.5 HP, ×1.6 radius, ×2 shards and XP, and the mass of its size', () => {
    const run = giantsRun();
    const g = spawnEnemy(run, REST(), 'titan', 3, 900, 0);
    const p = spawnEnemy(run, PLAIN(), 'titan', 3, 900, 0);
    expect(g.maxHp / p.maxHp).toBeCloseTo(3.5);
    expect(g.radius / p.radius).toBeCloseTo(1.6);
    expect(g.shards / p.shards).toBeCloseTo(2);
    expect(g.xp / p.xp).toBeCloseTo(2);
    expect(g.mass / p.mass).toBeCloseTo(1.6 * 1.6);
    // A split's fragments keep their own size.
    const f = spawnEnemy(run, REST(), 'titan', 3, 900, 0, { fragment: { hp: 10, scale: 0.5, share: 0.5 } });
    expect(f.radius).toBeCloseTo(ENEMY_BY_ID.titan.radius * 0.5);
  });

  it('Blight Surge grows them a quarter per rank, in size and HP, not in pay', () => {
    const run = giantsRun();
    run.pacts = { surge: 2 };
    const g = giantsOf(run, REST())!;
    expect(g.size).toBeCloseTo(1.6 * 1.25 ** 2);
    expect(g.hp).toBeCloseTo(3.5 * 1.25 ** 2);
    expect(g.reward).toBe(2);
    expect(giantsOf(run, regionByIndex(1))).toBeNull();
  });

  it('a Titan swallows a smaller body it overlaps and gains its HP, with no kill and no pay', () => {
    const run = giantsRun();
    const titan = body(run, { type: 'titan', x: 500, y: 0, radius: 41.6, hp: 300, maxHp: 300 });
    const grunt = body(run, { x: 520, y: 0, radius: 20, hp: 80, maxHp: 100 });
    const big = body(run, { x: 400, y: 40, radius: 40, hp: 100, maxHp: 100 });
    const kills = run.kills;
    const shards = run.shards;
    separateEnemies(run);
    trampleAll(run);
    expect(grunt.alive).toBe(false);
    expect(big.alive).toBe(true);
    expect(titan.hp).toBe(380);
    expect(titan.maxHp).toBe(380);
    expect(run.kills).toBe(kills);
    expect(run.shards).toBe(shards);
    expect(run.events.some((ev) => ev.kind === 'trample')).toBe(true);
  });

  it("a Tick can't be targeted while it rides, and leaps off when its host falls", () => {
    const run = giantsRun();
    const host = body(run, { type: 'titan', x: 300, y: 0, px: 300, py: 0, radius: 41.6 });
    const tick = body(run, { type: 'tick', x: 300, y: 150, px: 300, py: 150, radius: 12, speed: 150 });
    run.tick++;
    run.time = run.tick * SIM_DT;
    tickEnemies(run, SIM_DT);
    expect(tick.riding).toBe(host.id);
    expect(targetable(run, tick)).toBe(false);
    expect(damageEnemy(run, tick, 1000, true)).toBe(0);
    // It sits on the host's tower side.
    expect(tick.x).toBeCloseTo(300 - 41.6 * BALANCE.wake.giants.seat);
    expect(tick.y).toBeCloseTo(0);
    host.alive = false;
    run.tick++;
    run.time = run.tick * SIM_DT;
    tickEnemies(run, SIM_DT);
    expect(tick.riding).toBe(-1);
    expect(run.events.some((ev) => ev.kind === 'hop')).toBe(true);
    expect(targetable(run, tick)).toBe(true);
    // Once it has ridden, it walks.
    const x = tick.x;
    tickEnemies(run, SIM_DT);
    expect(tick.x).toBeLessThan(x);
    // It never rides a body too small to be a giant.
    const lone = giantsRun();
    body(lone, { x: 300, y: 0, radius: 20 });
    const t2 = body(lone, { type: 'tick', x: 300, y: 100, radius: 12 });
    tickEnemies(lone, SIM_DT);
    expect(t2.riding).toBe(0);
  });

  it('a Herdkeeper wards the bodies near it, not itself', () => {
    const run = giantsRun();
    const keeper = body(run, { type: 'herdkeeper', x: 600, y: 0 });
    const near = body(run, { x: 700, y: 0 });
    const far = body(run, { x: 600, y: 400 });
    tickEnemies(run, SIM_DT);
    const verb = ENEMY_BY_ID.herdkeeper.verb;
    expect(near.buffShield).toBe(verb.kind === 'herd' ? verb.shield : NaN);
    expect(keeper.buffShield).toBe(1);
    expect(far.buffShield).toBe(1);
  });

  it('a Towering elite takes 60% of a hit, and a crit whole', () => {
    const run = giantsRun();
    const e = body(run, { x: 300, y: 0, elite: true, aura: 'towering', hp: 1e6, maxHp: 1e6 });
    const plain = body(run, { x: 300, y: 50, hp: 1e6, maxHp: 1e6 });
    expect(damageEnemy(run, e, 100, false) / damageEnemy(run, plain, 100, false)).toBeCloseTo(BALANCE.elites.towering);
    expect(damageEnemy(run, e, 100, true) / damageEnemy(run, plain, 100, true)).toBeCloseTo(1);
  });
});

function orreryRun(seed = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  return createRun({ ...buildRunConfig(p), regionId: 10 }, seed);
}

/** Step the Orrery's clocks and bodies until `e` reaches the wall (or `max` s pass); the seconds it took. */
function walkIn(run: RunState, e: { inContact: boolean }, max = 60): number {
  const start = run.time;
  for (let i = 0; i < max / SIM_DT && !e.inContact; i++) {
    run.tick++;
    run.time = run.tick * SIM_DT;
    tickWake(run, regionByIndex(10), SIM_DT);
    tickEnemies(run, SIM_DT);
  }
  return run.time - start;
}

describe('the Orbit (plans/late-game/12 §4.2)', () => {
  it('a run in the Orrery starts with only the orbit clock', () => {
    expect(orreryRun().wake).toEqual({ toll: null, orbit: { spin: 1, wave: 0 }, storm: null });
  });

  it('a body spirals in: always closer, always turning, within 2% of a straight walk (D-29)', () => {
    const run = orreryRun();
    const e = body(run, { type: 'satellite', x: 600, y: 0, px: 600, py: 0, speed: 80 });
    const s = body(run, { type: 'comet', x: 0, y: 600, px: 0, py: 600, speed: 80 });
    let d = 600;
    let angle = 0;
    for (let i = 0; i < 2 / SIM_DT; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickWake(run, regionByIndex(10), SIM_DT);
      tickEnemies(run, SIM_DT);
      const nd = Math.hypot(e.x, e.y);
      const na = Math.atan2(e.y, e.x);
      expect(nd).toBeLessThan(d);
      expect(na).not.toBe(angle);
      d = nd;
      angle = na;
      // A Comet streaks straight in: its angle never changes.
      expect(Math.atan2(s.y, s.x)).toBe(Math.PI / 2);
    }
    expect(s.inContact).toBe(false);
    // Each alone, from the same distance: the spiral's walk against a straight one.
    const a = orreryRun();
    const spiral = walkIn(a, body(a, { type: 'satellite', x: 600, y: 0, px: 600, py: 0, speed: 80 }));
    const b = orreryRun();
    const comet = body(b, { type: 'comet', x: 600, y: 0, px: 600, py: 0, speed: 80 });
    const straight = walkIn(b, comet);
    expect(Math.atan2(comet.y, comet.x)).toBe(0);
    const ratio = spiral / straight;
    expect(ratio).toBeGreaterThan(0.98);
    expect(ratio).toBeLessThan(1.02);
  });

  it('turns the way the field spins, and a fresh spin is rolled each wave on the wake stream', () => {
    const run = orreryRun();
    const e = body(run, { type: 'satellite', x: 600, y: 0, px: 600, py: 0, speed: 80 });
    // Spin +1 turns (600, 0) toward −y, the sideways unit (−ry, rx) × spin; −1 turns it back.
    tickEnemies(run, SIM_DT);
    expect(e.y).toBeLessThan(0);
    run.wake!.orbit!.spin = -1;
    tickEnemies(run, SIM_DT);
    expect(e.y).toBeGreaterThan(e.py);
    const spins = new Set<number>();
    for (let w = 1; w <= 12; w++) {
      run.wave = w;
      tickWake(run, regionByIndex(10), SIM_DT);
      expect(run.wake!.orbit!.wave).toBe(w);
      spins.add(run.wake!.orbit!.spin);
    }
    expect(spins.size).toBe(2);
  });

  it('a Tidal neighbour swings it wider, but the spiral never becomes a ring', () => {
    const run = orreryRun();
    const e = body(run, { type: 'satellite', x: 600, y: 0, speed: 80 });
    const verb = ENEMY_BY_ID.satellite.verb;
    expect(orbitShare(run, e, verb)).toBeCloseTo(0.6);
    e.buffOrbit = BALANCE.elites.tidal;
    expect(orbitShare(run, e, verb)).toBe(BALANCE.wake.orbit.max);
    // Bosses, plates, Comets and anything walking out walk straight.
    expect(orbitShare(run, body(run, { boss: 'astrolabe' }), null)).toBe(0);
    expect(orbitShare(run, body(run, { plate: 1 }), null)).toBe(0);
    expect(orbitShare(run, body(run, { type: 'comet' }), ENEMY_BY_ID.comet.verb)).toBe(0);
    expect(orbitShare(run, body(run, { heading: -1 }), verb)).toBe(0);
    // Outside the Orrery, nothing orbits.
    const act1 = createRun(buildRunConfig(newProfile(0)), 1);
    expect(orbitShare(act1, body(act1, {}), ENEMY_BY_ID.grunt.verb)).toBe(0);
  });

  it('a Moon laps half the field at its lane before it closes in', () => {
    const run = orreryRun();
    const verb = ENEMY_BY_ID.moon.verb;
    if (verb.kind !== 'lane') throw new Error('the Moon keeps a lane');
    const m = body(run, { type: 'moon', x: 500, y: 0, px: 500, py: 0, speed: 60, radius: 30 });
    let lapping = 0;
    for (let i = 0; i < 40 / SIM_DT && !m.inContact; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickWake(run, regionByIndex(10), SIM_DT);
      tickEnemies(run, SIM_DT);
      if (Math.abs(Math.hypot(m.x, m.y) - verb.radius) <= 1) lapping += SIM_DT;
    }
    expect(lapping).toBeGreaterThanOrEqual((verb.sweep * verb.radius) / 60 - SIM_DT);
    expect(m.lane).toBeGreaterThanOrEqual(verb.sweep);
    expect(m.inContact).toBe(true);
  });
});

function stormRun(seed = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  const run = createRun({ ...buildRunConfig(p), regionId: 13 }, seed);
  run.stats = { ...run.stats, armor: 0 };
  // A fresh tower's wall is thinner than a wall strike: keep it standing to read the hits.
  run.tower.hp = 1e5;
  return run;
}

const STORM = regionByIndex(13);

/** The storm's next strike, now: the auras read first (as the step before would have), then the clock. */
function strikeNow(run: RunState): void {
  tickEnemies(run, SIM_DT);
  run.time = run.wake!.storm!.next;
  run.events.length = 0;
  tickWake(run, STORM, SIM_DT);
}

describe('the Storm (plans/late-game/12 §4.5)', () => {
  const rule = STORM.rule!.effect;
  if (rule.kind !== 'storm') throw new Error('Stormcrown storms');

  it('a run starts with the storm\'s clock, and only it', () => {
    expect(stormRun().wake).toEqual({ toll: null, orbit: null, storm: { next: rule.every } });
  });

  it('with no Conductor, a strike takes a tenth of the toughest body\'s Max HP, credited to the rule', () => {
    const run = stormRun();
    const small = body(run, { x: 200, hp: 300, maxHp: 300 });
    const big = body(run, { x: 400, hp: 800, maxHp: 1000 });
    const hp = run.tower.hp;
    strikeNow(run);
    expect(big.hp).toBeCloseTo(800 - 1000 * rule.damage);
    expect(small.hp).toBe(300);
    expect(run.tower.hp).toBe(hp);
    expect(run.damageBy.rule).toBeCloseTo(1000 * rule.damage);
    expect(run.events.filter((ev) => ev.kind === 'strike')).toEqual([{ kind: 'strike', x: big.x, y: big.y, tower: false }]);
    // The clock comes round again.
    expect(run.wake!.storm!.next).toBeCloseTo(run.time + rule.every);
    // Ties go to the nearer body, then the older.
    const tie = stormRun();
    const far = body(tie, { x: 400, hp: 500, maxHp: 500 });
    const near = body(tie, { x: 200, hp: 500, maxHp: 500 });
    expect(stormTargets(tie, 2)).toEqual([near, far]);
  });

  it('never strikes a boss, its court, its plates, a Groundling or a Charged elite\'s neighbours', () => {
    const run = stormRun();
    const boss = body(run, { x: 300, hp: 1e6, maxHp: 1e6, boss: 'thunderhead' });
    const court = body(run, { x: 300, y: 50, hp: 1e6, maxHp: 1e6, court: boss.id });
    const plate = body(run, { x: 300, y: -50, hp: 1e6, maxHp: 1e6, plate: boss.id });
    const ground = body(run, { type: 'groundling', x: -300, hp: 1e5, maxHp: 1e5 });
    const charged = body(run, { x: 0, y: 400, hp: 5e4, maxHp: 5e4, elite: true, aura: 'charged' });
    const near = body(run, { x: 0, y: 500, hp: 4e4, maxHp: 4e4 });
    const plain = body(run, { x: 0, y: -400, hp: 10, maxHp: 10 });
    strikeNow(run);
    for (const e of [boss, court, plate, ground, charged, near]) expect(e.hp).toBe(e.maxHp);
    expect(plain.hp).toBeCloseTo(10 - 10 * rule.damage);
  });

  it('while a Conductor stands, the strike hits the tower through `hurtTower`: armour holds, Aegis turns it', () => {
    const run = stormRun();
    const big = body(run, { x: 400, hp: 1000, maxHp: 1000 });
    const rod = body(run, { type: 'conductor', x: 300, hp: 50, maxHp: 50 });
    const hp = run.tower.hp;
    strikeNow(run);
    const hit = rule.wall * waveDamage(STORM, run.wave);
    expect(hp - run.tower.hp).toBeCloseTo(hit);
    expect(run.takenBy.storm).toBeCloseTo(hit);
    expect(big.hp).toBe(1000);
    expect(rod.hp).toBe(50);
    expect(run.events.filter((ev) => ev.kind === 'strike')).toEqual([{ kind: 'strike', x: 0, y: 0, tower: true }]);
    // Armour applies.
    run.stats = { ...run.stats, armor: 0.5 };
    const before = run.tower.hp;
    strikeNow(run);
    expect(before - run.tower.hp).toBeLessThan(hit);
    // Aegis's turn: nothing lands.
    run.tower.invulnUntil = run.wake!.storm!.next + 1;
    const held = run.tower.hp;
    strikeNow(run);
    expect(run.tower.hp).toBe(held);
    expect(run.events.some((ev) => ev.kind === 'blocked')).toBe(true);
    // The rod falls: the storm turns back on the field.
    rod.alive = false;
    run.tower.invulnUntil = 0;
    strikeNow(run);
    expect(big.hp).toBeCloseTo(1000 - 1000 * rule.damage);
  });

  it('a Squallcaller\'s shot brings the next strike 0.75 s sooner', () => {
    const run = stormRun();
    const verb = ENEMY_BY_ID.squallcaller.verb;
    if (verb.kind !== 'squall') throw new Error('a Squallcaller squalls');
    body(run, { type: 'squallcaller', x: verb.standoff - 10, actTimer: 0 });
    const next = run.wake!.storm!.next;
    run.tick++;
    run.time = run.tick * SIM_DT;
    tickEnemies(run, SIM_DT);
    expect(run.shots).toHaveLength(1);
    expect(run.wake!.storm!.next).toBeCloseTo(next - verb.hasten);
  });

  it('a Conductor stands off and never touches the wall', () => {
    const run = stormRun();
    const verb = ENEMY_BY_ID.conductor.verb;
    if (verb.kind !== 'conduct') throw new Error('a Conductor conducts');
    const rod = body(run, { type: 'conductor', x: 600, speed: 200, radius: 26 });
    const hp = run.tower.hp;
    for (let i = 0; i < 8 / SIM_DT; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickEnemies(run, SIM_DT);
    }
    expect(Math.hypot(rod.x, rod.y)).toBeCloseTo(verb.standoff, 0);
    expect(run.tower.hp).toBe(hp);
  });

  it('aim (D-18): Sunlance holds a Conductor over an elite; Drones hunt it first', () => {
    const tough = { hp: 1e6, maxHp: 1e6 };
    const run = stormRun();
    run.weapons = [newWeapon('sunlance', 1)];
    run.stats = { ...run.stats, critChance: 0 };
    body(run, { x: 150, y: 0, elite: true, ...tough });
    const rod = body(run, { type: 'conductor', x: -150, y: 0, ...tough });
    for (let i = 0; i < 2; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickWeapons(run, SIM_DT);
    }
    expect(run.weapons[0].beamTarget).toBe(rod.id);

    const drones = stormRun();
    drones.weapons = [newWeapon('sentinel-drones', 1)];
    drones.stats = { ...drones.stats, critChance: 0 };
    const grunt = body(drones, { x: 120, y: 0, ...tough });
    const far = body(drones, { type: 'conductor', x: -300, y: 0, ...tough });
    for (let i = 0; i < 3 / SIM_DT; i++) {
      drones.tick++;
      drones.time = drones.tick * SIM_DT;
      tickWeapons(drones, SIM_DT);
      tickProjectiles(drones, SIM_DT);
    }
    expect(far.hp).toBeLessThan(1e6);
    expect(grunt.hp).toBe(1e6);
  });

  it('the Blight Surge quickens the storm: ×0.8 the interval a rank', () => {
    const run = stormRun();
    run.pacts = { surge: 2 };
    strikeNow(run);
    expect(run.wake!.storm!.next - run.time).toBeCloseTo(rule.every * BALANCE.wake.storm.surge ** 2);
  });
});

// ── Glide (plans/late-game/12 §4.3) ──────────────────────────────────────

function seaRun(seed = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  return createRun({ ...buildRunConfig(p), regionId: 11 }, seed);
}

function fieldsRun(seed = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  return createRun(buildRunConfig(p), seed);
}

/** Step the bodies alone (no clocks, no weapons) once. */
function glideTick(run: RunState): void {
  run.tick++;
  run.time = run.tick * SIM_DT;
  tickEnemies(run, SIM_DT);
}

describe('Glide (plans/late-game/12 §4.3)', () => {
  const G = BALANCE.wake.glide;
  const rule = regionByIndex(11).rule!.effect as Extract<RegionRule, { kind: 'glide' }>;

  it('outside Glide, knockBack is the old shove: push / mass, straight out from the tower, at once', () => {
    const run = fieldsRun();
    const e = body(run, { x: 300, y: 400, mass: 2.5, inContact: true });
    knockBack(run, e, 32);
    // The old code, to the bit.
    const d = Math.hypot(300, 400);
    const move = 32 / 2.5;
    expect(e.x).toBe(300 + (300 / d) * move);
    expect(e.y).toBe(400 + (400 / d) * move);
    expect(e.inContact).toBe(false);
    expect(e.slideX).toBe(0);
    expect(e.slideY).toBe(0);
    expect(e.pushedUntil).toBe(0);
    expect(run.wake).toBeNull();
  });

  it('the Frozen Sea starts with no clocks of its own: Glide is read where it acts', () => {
    expect(seaRun().wake).toBeNull();
    expect(initWake(regionByIndex(11))).toBeNull();
  });

  it('under Glide a push becomes a slide of carry × push / mass, over in under a second', () => {
    const run = seaRun();
    const e = body(run, { x: 300, y: 0, px: 300, py: 0, mass: 1 });
    knockBack(run, e, 16);
    // Nothing moves at once: it slides.
    expect(e.x).toBe(300);
    expect(e.slideX).toBeCloseTo(16 * rule.carry * rule.friction, 9);
    let t = 0;
    while ((e.slideX !== 0 || e.slideY !== 0) && t < 3) {
      glideTick(run);
      t += SIM_DT;
      expect(e.moving).toBe(true);
    }
    expect(t).toBeLessThan(1);
    expect(e.x - 300).toBeGreaterThan(rule.carry * 16 * 0.95);
    expect(e.x - 300).toBeLessThan(rule.carry * 16 * 1.05);
    expect(e.y).toBe(0);
  });

  it('a sliding body neither walks nor hits, stunned or not, and never slides inside its stop', () => {
    const run = seaRun();
    const e = body(run, { x: 300, y: 0, speed: 100, stunnedUntil: 99 });
    e.slideX = 200;
    glideTick(run);
    expect(e.x).toBeCloseTo(300 + 200 * SIM_DT, 9);
    const wall = run.stats.radius + 20;
    const inward = body(run, { x: wall + 2, y: 0 });
    inward.slideX = -600;
    glideTick(run);
    expect(inward.x).toBeCloseTo(wall, 9);
    expect(inward.slideX).toBe(0);
  });

  it('a slider that touches a body hits both by the formula, hands on half its speed, once a cooldown', () => {
    const run = seaRun();
    run.tick = 60;
    run.time = 1;
    const s = body(run, { x: 300, y: 0, hp: 1e6, maxHp: 1e6, mass: 1.5, wave: 4 });
    const o = body(run, { x: 338, y: 0, hp: 1e6, maxHp: 1e6 });
    s.slideX = 240;
    separateEnemies(run);
    const speed = Math.hypot(s.slideX, s.slideY);
    glideImpacts(run);
    const hit = rule.impact * (speed / 100) * 1.5 * waveHp(regionByIndex(11), 4);
    expect(1e6 - o.hp).toBeCloseTo(hit, 6);
    expect(1e6 - s.hp).toBeCloseTo(hit, 6);
    expect(o.slideX).toBeCloseTo(240 * G.transfer, 9);
    expect(s.slideX).toBeCloseTo(240 * (1 - G.transfer), 9);
    expect(run.events.some((ev) => ev.kind === 'impact' && !ev.shatter)).toBe(true);
    // Still touching, but inside the cooldown: no second hit.
    const after = o.hp;
    glideImpacts(run);
    expect(o.hp).toBe(after);
    run.time += G.cooldown;
    glideImpacts(run);
    expect(o.hp).toBeLessThan(after);
  });

  it('bowls over: a struck body never strikes back, but slides on into the next', () => {
    const run = seaRun();
    run.time = 1;
    const a = body(run, { x: 300, y: 0, hp: 1e6, maxHp: 1e6 });
    const b = body(run, { x: 338, y: 0, hp: 1e6, maxHp: 1e6 });
    const c = body(run, { x: 376, y: 0, hp: 1e6, maxHp: 1e6 });
    a.slideX = 300;
    separateEnemies(run);
    glideImpacts(run);
    // a strikes b; b, sliding on, strikes c; nothing strikes a back.
    expect(run.events.filter((ev) => ev.kind === 'impact')).toHaveLength(2);
    expect(c.hp).toBeLessThan(1e6);
    expect(c.slideX).toBeGreaterThan(0);
    expect(b.impactAt).toBe(1);
    expect(1e6 - a.hp).toBeCloseTo(1e6 - b.hp - (1e6 - c.hp), 6);
  });

  it('a slider into a Floe takes its shatter, and the Floe never moves', () => {
    const run = seaRun();
    run.time = 1;
    const s = body(run, { x: 300, y: 0, hp: 1e6, maxHp: 1e6, mass: 1 });
    const floe = body(run, { type: 'floe', x: 352, y: 0, radius: 34, hp: 1e6, maxHp: 1e6, mass: 8 });
    s.slideX = 300;
    separateEnemies(run);
    const speed = Math.hypot(s.slideX, s.slideY);
    glideImpacts(run);
    const hit = rule.impact * (speed / 100) * 1 * waveHp(regionByIndex(11), 1);
    const verb = ENEMY_BY_ID.floe.verb as { shatter: number };
    expect(1e6 - floe.hp).toBeCloseTo(hit, 6);
    expect(1e6 - s.hp).toBeCloseTo(hit * verb.shatter, 6);
    expect(floe.slideX).toBe(0);
    expect(run.events.some((ev) => ev.kind === 'impact' && ev.shatter)).toBe(true);
    // Nor does a push move it.
    const at = floe.x;
    knockBack(run, floe, 100);
    expect(floe.slideX).toBe(0);
    expect(floe.x).toBe(at);
  });

  it('a cracked Floe (D-28) is never a target: nearest, toughest and Drones all pass it by', () => {
    const tough = { hp: 1e6, maxHp: 1e6 };
    const floeAt = { type: 'floe' as const, x: 120, y: 0, radius: 34, mass: 8, hp: 1e7, maxHp: 1e7, meltAt: 1e9 };
    for (const id of ['arcane-bolt', 'sunlance', 'sentinel-drones'] as const) {
      const run = seaRun();
      run.weapons = [newWeapon(id, 1)];
      run.stats = { ...run.stats, critChance: 0 };
      const floe = body(run, floeAt);
      const grunt = body(run, { x: -200, y: 0, ...tough });
      expect(targetable(run, floe)).toBe(false);
      for (let i = 0; i < 3 / SIM_DT; i++) {
        run.tick++;
        run.time = run.tick * SIM_DT;
        tickWeapons(run, SIM_DT);
        tickProjectiles(run, SIM_DT);
      }
      expect(floe.hp, id).toBe(1e7);
      expect(grunt.hp, id).toBeLessThan(1e6);
    }
  });

  it("a wave's Floe stays an ordinary body: nearest aims at it, and it never melts", () => {
    const run = seaRun();
    run.weapons = [newWeapon('arcane-bolt', 1)];
    run.stats = { ...run.stats, critChance: 0 };
    const floe = body(run, { type: 'floe', x: 120, y: 0, radius: 34, mass: 8, hp: 1e7, maxHp: 1e7 });
    const grunt = body(run, { x: -300, y: 0, hp: 1e6, maxHp: 1e6 });
    expect(targetable(run, floe)).toBe(true);
    for (let i = 0; i < (BALANCE.wake.floes.melt + 1) / SIM_DT; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickWake(run, regionByIndex(11), SIM_DT);
      tickWeapons(run, SIM_DT);
      tickProjectiles(run, SIM_DT);
    }
    expect(floe.alive).toBe(true);
    expect(floe.meltAt).toBeUndefined();
    expect(floe.hp).toBeLessThan(1e7);
    expect(grunt.hp).toBe(1e6);
  });

  it('a slider into a cracked Floe still deals its shatter, and the Floe takes the hit (D-28)', () => {
    const run = seaRun();
    run.time = 1;
    const s = body(run, { x: 300, y: 0, hp: 1e6, maxHp: 1e6, mass: 1 });
    const floe = body(run, { type: 'floe', x: 352, y: 0, radius: 34, hp: 1e6, maxHp: 1e6, mass: 8, speed: 0, meltAt: 1e9 });
    s.slideX = 300;
    separateEnemies(run);
    const speed = Math.hypot(s.slideX, s.slideY);
    glideImpacts(run);
    const hit = rule.impact * (speed / 100) * 1 * waveHp(regionByIndex(11), 1);
    const verb = ENEMY_BY_ID.floe.verb as { shatter: number };
    expect(1e6 - floe.hp).toBeCloseTo(hit, 6);
    expect(1e6 - s.hp).toBeCloseTo(hit * verb.shatter, 6);
    // Only an impact: any other hit on it lands nothing.
    expect(damageEnemy(run, floe, 100, false, 'homing')).toBe(0);
  });

  it('no impacts, and no slides, outside Glide', () => {
    const run = fieldsRun();
    run.time = 1;
    const s = body(run, { x: 300, y: 0, hp: 100 });
    const o = body(run, { x: 330, y: 0, hp: 100 });
    s.slideX = 300;
    separateEnemies(run);
    glideImpacts(run);
    expect(o.hp).toBe(100);
    expect(s.hp).toBe(100);
  });

  it('blasts push only under Glide (D-22): a Frost Ring pulse slides what it hits out from the tower', () => {
    const pulse = (run: RunState) => {
      run.weapons = [newWeapon('frost-ring', 1)];
      run.stats = { ...run.stats, critChance: 0 };
      const e = body(run, { x: 50, y: 30, px: 50, py: 30, hp: 1e6, maxHp: 1e6, mass: 1 });
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickWeapons(run, SIM_DT);
      expect(e.hp).toBeLessThan(1e6);
      return e;
    };
    const sea = pulse(seaRun());
    const d = Math.hypot(50, 30);
    const v = G.pulsePush * rule.carry * rule.friction;
    expect(sea.slideX).toBeCloseTo((50 / d) * v, 9);
    expect(sea.slideY).toBeCloseTo((30 / d) * v, 9);
    const fields = pulse(fieldsRun());
    expect(fields.slideX).toBe(0);
    expect(fields.x).toBe(50);
    expect(fields.y).toBe(30);
  });

  it('an Anchored elite holds its neighbours: no slide, no shove, no transfer', () => {
    const run = seaRun();
    body(run, { x: 400, y: 0, elite: true, aura: 'anchored' });
    const near = body(run, { x: 400, y: 100, mass: 1 });
    const far = body(run, { x: -400, y: 0, mass: 1 });
    glideTick(run);
    expect(near.braced).toBe(true);
    expect(far.braced).toBe(false);
    knockBack(run, near, 16);
    knockBack(run, far, 16);
    expect(near.slideX).toBe(0);
    expect(near.slideY).toBe(0);
    expect(Math.hypot(far.slideX, far.slideY)).toBeGreaterThan(0);
    // A slider into a braced body hits it, but hands on nothing.
    run.time = 5;
    const s = body(run, { x: 400, y: 135, hp: 1e6, maxHp: 1e6 });
    s.slideY = -300;
    near.hp = near.maxHp = 1e6;
    separateEnemies(run);
    glideImpacts(run);
    expect(near.hp).toBeLessThan(1e6);
    expect(near.slideY).toBe(0);
  });

  it('a Sledge latches the body ahead, pushes it as one, and both let go when either dies', () => {
    const run = seaRun();
    const s = body(run, { type: 'sledge', x: 400, y: 0, px: 400, py: 0, radius: 28, mass: 3, speed: 55 });
    const load = body(run, { type: 'skater', x: 352, y: 4, radius: 18, mass: 0.6, speed: 110 });
    // A body behind it is never taken.
    body(run, { type: 'skater', x: 450, y: 0, radius: 18 });
    glideTick(run);
    expect(s.towing).toBe(load.id);
    expect(load.towedBy).toBe(s.id);
    // Set down just ahead of its Sledge, on the tower's side.
    expect(Math.hypot(load.x, load.y)).toBeCloseTo(Math.hypot(s.x, s.y) - (28 + 18), 6);
    // It no longer walks at its own pace: it moves with the Sledge.
    const before = Math.hypot(load.x, load.y);
    glideTick(run);
    expect(before - Math.hypot(load.x, load.y)).toBeCloseTo(55 * SIM_DT, 6);
    // A push on either slides both, sharing it over their mass.
    knockBack(run, load, 16);
    expect(load.slideX).toBe(s.slideX);
    expect(Math.hypot(s.slideX, s.slideY)).toBeCloseTo((16 / (3 + 0.6)) * rule.carry * rule.friction, 6);
    kill(run, s);
    expect(load.towedBy).toBe(0);
    expect(s.towing).toBe(0);
  });

  it('a load at its stop is let go, and walks, hits and is shoved as any body', () => {
    const run = seaRun();
    const wall = run.stats.radius;
    const s = body(run, { type: 'sledge', x: wall + 18 + 28 + 30, y: 0, radius: 28, mass: 3, speed: 55 });
    const load = body(run, { type: 'skater', x: wall + 18 + 25, y: 0, radius: 18, mass: 0.6, speed: 110 });
    for (let i = 0; i < 60 && (s.towing !== 0 || i === 0); i++) glideTick(run);
    expect(s.towing).toBe(0);
    expect(load.towedBy).toBe(0);
    expect(Math.hypot(load.x, load.y)).toBeGreaterThanOrEqual(wall + 18 - 1e-6);
  });
});

describe('the Leviathan (plans/late-game/12 §7.1)', () => {
  it('opens on the Astrolabe and leads to Giants\' Rest', () => {
    expect(regionByIndex(11).after).toBe(10);
    expect(regionByIndex(12).after).toBe(11);
  });
});
