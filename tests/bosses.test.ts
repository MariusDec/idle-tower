import { describe, expect, it } from 'vitest';
import { applyInput, createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { BOSS_BY_ID } from '../src/content/bosses';
import { regionByIndex } from '../src/content/regions';
import { BOSS_WAVE, rollWave, startWave, waveDamage, waveHp, waveShardMult } from '../src/sim/systems/waves';
import { tickWake } from '../src/sim/systems/wake';
import { bossBody, tickBoss, tickRings, weakPoint, weakPointMult } from '../src/sim/systems/boss';
import { body } from './helpers/body';
import { damageEnemy, targetable } from '../src/sim/systems/combat';
import { healTower, hurtTower } from '../src/sim/systems/tower';
import { tickEnemies } from '../src/sim/systems/enemies';
import { mitigate } from '../src/sim/systems/damage';
import { Rng } from '../src/core/rng';
import type { RunState } from '../src/sim/state';

/** A run that has just started wave 20 in `region`, its boss on the field. */
function atBoss(region = 1, seed = 1, firstKill = true): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  const run = createRun({ ...buildRunConfig(p), regionId: region, firstKill }, seed);
  startWave(run, regionByIndex(region), BOSS_WAVE);
  run.events.length = 0;
  return run;
}

/** Walk the boss straight to its post. */
function toPost(run: RunState): void {
  const e = bossBody(run)!;
  const d = BOSS_BY_ID[run.boss!.id].standoff;
  e.x = e.px = d;
  e.y = e.py = 0;
}

describe('the boss wave (§4.2, §4.3)', () => {
  it('wave 20 is the boss and nothing else', () => {
    expect(rollWave(regionByIndex(1), BOSS_WAVE, new Rng(1))).toEqual([]);
    const run = atBoss();
    expect(run.boss?.id).toBe('gatekeeper');
    const body = bossBody(run)!;
    expect(body.boss).toBe('gatekeeper');
    expect(body.maxHp).toBeCloseTo(waveHp(regionByIndex(1), BOSS_WAVE) * BOSS_BY_ID.gatekeeper.hp);
  });

  it('holds the wave until the boss falls, then overtime follows', () => {
    const run = atBoss();
    for (let i = 0; i < 600; i++) step(run, SIM_DT);
    expect(run.wave).toBe(BOSS_WAVE);
    damageEnemy(run, bossBody(run)!, 1e12, false);
    expect(run.boss?.killedIn).not.toBeNull();
    for (let i = 0; i < Math.ceil((BALANCE.waves.afterBoss + 0.5) / SIM_DT) && !run.outcome; i++) step(run, SIM_DT);
    expect(run.wave).toBe(BOSS_WAVE + 1);
  });

  it('pays ×5 on a first kill (§8.1) and the plain rate after', () => {
    const first = atBoss(1, 1, true);
    const again = atBoss(1, 1, false);
    damageEnemy(first, bossBody(first)!, 1e12, false);
    damageEnemy(again, bossBody(again)!, 1e12, false);
    expect(first.shardsFrom.boss).toBeCloseTo(again.shardsFrom.boss * BALANCE.boss.firstKill);
    expect(first.events.some((e) => e.kind === 'bossKill' && e.first)).toBe(true);
  });

  it('overtime is steeper in HP and richer in shards', () => {
    const r = regionByIndex(1);
    expect(waveHp(r, 22) / waveHp(r, 21)).toBeCloseTo(BALANCE.overtime.hpGrowth);
    expect(waveShardMult(20)).toBe(1);
    expect(waveShardMult(23)).toBeCloseTo(BALANCE.overtime.shardGrowth ** 3);
  });
});

describe('boss patterns', () => {
  it('turns phases at its HP thresholds, summoning on entry', () => {
    const run = atBoss();
    const e = bossBody(run)!;
    toPost(run);
    e.hp = e.maxHp * 0.6;
    const before = run.enemies.length;
    tickBoss(run, regionByIndex(1), SIM_DT);
    expect(run.boss!.phase).toBe(1);
    expect(run.events.some((ev) => ev.kind === 'bossPhase' && ev.phase === 1)).toBe(true);
    expect(run.enemies.length).toBeGreaterThan(before);
  });

  it('winds up, then a shockwave rolls out and hits the tower once', () => {
    const run = atBoss();
    toPost(run);
    const region = regionByIndex(1);
    for (let i = 0; i < 20 / SIM_DT && run.rings.length === 0; i++) tickBoss(run, region, SIM_DT);
    expect(run.rings).toHaveLength(1);
    const hp = run.tower.hp;
    let hits = 0;
    for (let i = 0; i < 3 / SIM_DT; i++) {
      tickRings(run, SIM_DT);
      hits += run.events.filter((e) => e.kind === 'towerHit').length;
      run.events.length = 0;
    }
    expect(hits).toBe(1);
    expect(run.tower.hp).toBeLessThan(hp);
  });

  it('a Nova in the wind-up staggers it and the slam is lost', () => {
    const run = atBoss();
    toPost(run);
    const region = regionByIndex(1);
    for (let i = 0; i < 20 / SIM_DT && run.boss!.windup === 0; i++) tickBoss(run, region, SIM_DT);
    expect(run.boss!.windup).toBeGreaterThan(0);
    run.ult.charge = 1;
    applyInput(run, { ult: true });
    expect(run.boss!.windup).toBe(0);
    expect(run.boss!.staggeredUntil).toBeGreaterThan(run.time);
    for (let i = 0; i < 1 / SIM_DT; i++) tickBoss(run, region, SIM_DT);
    expect(run.rings).toHaveLength(0);
  });

  it('the Bog Mother sinks out of reach and rises elsewhere', () => {
    const run = atBoss(2);
    toPost(run);
    const e = bossBody(run)!;
    e.hp = e.maxHp * 0.6;
    const region = regionByIndex(2);
    for (let i = 0; i < 20 / SIM_DT && !run.boss!.submerged; i++) tickBoss(run, region, SIM_DT);
    expect(run.boss!.submerged).toBe(true);
    expect(damageEnemy(run, e, 1e9, false)).toBe(0);
    const at = Math.atan2(e.y, e.x);
    for (let i = 0; i < 5 / SIM_DT && run.boss!.submerged; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickBoss(run, region, SIM_DT);
    }
    expect(run.boss!.submerged).toBe(false);
    expect(Math.atan2(e.y, e.x)).not.toBeCloseTo(at);
  });

  it('enrages after its time and walks to the wall', () => {
    const run = atBoss();
    // A tower that can't fall and can't fire: only the clock moves the fight.
    run.stats.maxHp = run.tower.hp = 1e12;
    run.weapons.length = 0;
    for (let i = 0; i < (BALANCE.boss.enrageAfter + 30) / SIM_DT && !run.outcome; i++) step(run, SIM_DT);
    expect(run.boss!.enraged).toBe(true);
    const e = bossBody(run)!;
    expect(Math.hypot(e.x, e.y)).toBeCloseTo(run.stats.radius + e.radius, 0);
  });

  it('remembers the low point of the fight, even one Second Wind lifts', () => {
    const run = atBoss();
    run.revives = 1;
    hurtTower(run, run.stats.maxHp * 2, 0, 100, null, 'slams');
    step(run, SIM_DT);
    expect(run.outcome).toBeNull();
    expect(run.tower.hp).toBeGreaterThan(0);
    expect(run.boss!.minHp).toBe(0);
  });
});

describe('the enrage clock (plans/late-game/12a)', () => {
  /** Seconds from the boss's arrival to its enrage, the clock alone moving. */
  function enrageTime(region: number): number {
    const run = atBoss(region);
    const r = regionByIndex(region);
    while (!run.boss!.enraged && run.time < 600) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickBoss(run, r, SIM_DT);
    }
    return run.time - run.boss!.arrivedAt;
  }

  it('an Act 1 boss enrages at the default', () => {
    expect(BOSS_BY_ID.gatekeeper.enrageAfter).toBeUndefined();
    expect(enrageTime(1)).toBeCloseTo(BALANCE.boss.enrageAfter, 1);
  });

  it('a Wake boss enrages at its own time', () => {
    const own = BOSS_BY_ID.carillon.enrageAfter!;
    expect(own).toBeGreaterThan(BALANCE.boss.enrageAfter);
    expect(enrageTime(9)).toBeCloseTo(own, 1);
  });
});

describe('Rampart against rage (§11.4)', () => {
  /** The boss at the wall, `enraged` or not, against a tower with Rampart (or without). */
  function atWall(rampart: boolean, enraged: boolean): RunState {
    const run = atBoss();
    if (rampart) run.behaviours = { ...run.behaviours, rampart: 1 };
    run.weapons.length = 0;
    const e = bossBody(run)!;
    e.x = e.px = run.stats.radius + e.radius;
    e.y = e.py = 0;
    if (enraged) {
      run.tick = Math.round((run.boss!.arrivedAt + BALANCE.boss.enrageAfter + 25) / SIM_DT);
      run.time = run.tick * SIM_DT;
    }
    tickBoss(run, regionByIndex(1), SIM_DT);
    expect(run.boss!.enraged).toBe(enraged);
    return run;
  }

  it('caps an unenraged contact hit as before', () => {
    const run = atWall(true, false);
    const e = bossBody(run)!;
    const hp = run.tower.hp;
    hurtTower(run, 1e9, e.x, e.y, e, 'contact');
    expect(hp - run.tower.hp).toBeCloseTo(run.stats.maxHp * BALANCE.behaviours.rampartCap);
  });

  it('caps the hit before the enrage grows it', () => {
    const run = atWall(true, true);
    const e = bossBody(run)!;
    const rage = Math.pow(BALANCE.boss.enrageGrowth, 3);
    expect(e.damage / (waveDamage(regionByIndex(1), BOSS_WAVE) * BOSS_BY_ID.gatekeeper.damage)).toBeCloseTo(rage);
    run.stats.maxHp = run.tower.hp = 1e12;
    hurtTower(run, 1e15, e.x, e.y, e, 'contact');
    expect(1e12 - run.tower.hp).toBeCloseTo(1e12 * BALANCE.behaviours.rampartCap * rage, -3);
  });

  it('leaves a hit without Rampart as it was', () => {
    const run = atWall(false, true);
    const e = bossBody(run)!;
    run.stats.maxHp = run.tower.hp = 1e12;
    hurtTower(run, e.damage, e.x, e.y, e, 'contact');
    expect(1e12 - run.tower.hp).toBeCloseTo(mitigate(e.damage, run.stats.armor), -3);
  });

  it('an enraged boss still ends a fight with a tower that out-heals the cap', () => {
    const run = atWall(true, false);
    const region = regionByIndex(1);
    // Regen twice what capped hits take away: before the fix, a fight that never ends.
    const cap = run.stats.maxHp * BALANCE.behaviours.rampartCap;
    const regen = (2 * cap) / BALANCE.boss.attackInterval;
    const enrageAt = run.boss!.arrivedAt + BALANCE.boss.enrageAfter;
    while (run.tower.hp > 0 && run.time < enrageAt + 600) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickBoss(run, region, SIM_DT);
      tickEnemies(run, SIM_DT);
      if (run.tower.hp > 0) healTower(run, regen * SIM_DT);
    }
    expect(run.tower.hp).toBeLessThanOrEqual(0);
    expect(run.time - enrageAt).toBeLessThan(240);
  });
});

describe('the Carillon (plans/late-game/12 §7.1)', () => {
  /** The Carillon at its post, in phase `phase`, with the bell about to toll. */
  function carillon(phase: number): RunState {
    const run = atBoss(9);
    toPost(run);
    const e = bossBody(run)!;
    const below = [1, 0.6, 0.3][phase];
    e.hp = e.maxHp * below;
    tickBoss(run, regionByIndex(9), SIM_DT);
    expect(run.boss!.phase).toBe(phase);
    run.events.length = 0;
    run.rings.length = 0;
    return run;
  }

  /** Step the boss and the bell until the bell tolls. */
  function untilToll(run: RunState): void {
    for (let i = 0; i < 30 / SIM_DT && !run.events.some((ev) => ev.kind === 'toll'); i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickBoss(run, regionByIndex(9), SIM_DT);
      tickWake(run, regionByIndex(9), SIM_DT);
    }
  }

  it('rolls a peal at the wall on each toll, from its second phase, and not before', () => {
    const calm = carillon(0);
    untilToll(calm);
    expect(calm.rings).toHaveLength(0);
    const run = carillon(1);
    untilToll(run);
    expect(run.rings).toHaveLength(1);
    const e = bossBody(run)!;
    const p = BOSS_BY_ID.carillon.phases[1].patterns[0];
    expect(p.kind).toBe('peal');
    expect(run.rings[0].speed).toBe(p.kind === 'peal' ? p.speed : NaN);
    expect(run.rings[0].damage).toBeCloseTo((p.kind === 'peal' ? p.damage : NaN) * waveDamage(regionByIndex(9), BOSS_WAVE));
    expect(run.rings[0].x).toBe(e.x);
    expect(run.events.some((ev) => ev.kind === 'slam')).toBe(true);
  });

  it('quickens the bell: the next interval halves, never below the floor', () => {
    const run = carillon(2);
    untilToll(run);
    const before = run.wake!.toll!.interval;
    // Its first quickening comes `every` seconds into the phase.
    for (let i = 0; i < 21 / SIM_DT; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickBoss(run, regionByIndex(9), SIM_DT);
    }
    expect(run.wake!.toll!.pace).toBeCloseTo(0.5);
    run.events.length = 0;
    run.wake!.toll!.next = run.time;
    untilToll(run);
    const rule = regionByIndex(9).rule!.effect;
    const floor = rule.kind === 'toll' ? rule.window * BALANCE.wake.toll.minInterval : NaN;
    expect(run.wake!.toll!.interval).toBeCloseTo(Math.max(floor, before * 0.5));
  });

  it('its quickened toll never comes sooner than 1.5 s (D-27)', () => {
    const run = carillon(2);
    run.wake!.toll!.pace = 1e-3;
    run.wake!.toll!.next = run.time;
    untilToll(run);
    expect(run.wake!.toll!.interval).toBeGreaterThanOrEqual(1.5 - 1e-9);
  });
});

describe('the Sleeping Colossus (plans/late-game/12 §7.1)', () => {
  function colossus(phase: number): RunState {
    const run = atBoss(12);
    toPost(run);
    const e = bossBody(run)!;
    e.hp = e.maxHp * [1, 0.6, 0.3][phase];
    tickBoss(run, regionByIndex(12), SIM_DT);
    expect(run.boss!.phase).toBe(phase);
    run.events.length = 0;
    return run;
  }

  it('its heart turns, and a hit lands ×3 only while the heart faces the tower', () => {
    const run = colossus(0);
    const e = bossBody(run)!;
    const p = BOSS_BY_ID.colossus.phases[0].patterns[0];
    if (p.kind !== 'weakpoint') throw new Error('phase 0 is the weak point');
    // At its post on +x, the tower lies at angle π from it.
    run.boss!.facet = Math.PI;
    expect(weakPoint(run)!.facing).toBe(true);
    expect(weakPointMult(run, e)).toBe(p.mult);
    e.armor = 0;
    const facing = damageEnemy(run, e, 100, false);
    run.boss!.facet = 0;
    expect(weakPoint(run)!.facing).toBe(false);
    expect(weakPointMult(run, e)).toBe(1);
    const away = damageEnemy(run, e, 100, false);
    expect(facing / away).toBeCloseTo(p.mult);
    // It turns at its spin.
    const f0 = run.boss!.facet;
    tickBoss(run, regionByIndex(12), SIM_DT);
    expect(run.boss!.facet - f0).toBeCloseTo(p.spin * SIM_DT);
    // Anything but the boss's body is untouched.
    expect(weakPointMult(run, body(run))).toBe(1);
  });

  it('its last phase has no heart; it feasts on a Titan near it, healing by its HP with no kill', () => {
    const run = colossus(2);
    expect(weakPoint(run)).toBeNull();
    const e = bossBody(run)!;
    e.hp = e.maxHp * 0.2;
    const titan = body(run, { type: 'titan', x: e.x - 100, y: 0, hp: 5000, maxHp: 5000 });
    const far = body(run, { type: 'titan', x: e.x - 600, y: 0, hp: 5000, maxHp: 5000 });
    const grunt = body(run, { x: e.x - 50, y: 0 });
    const kills = run.kills;
    const shards = run.shards;
    const hp = e.hp;
    for (let i = 0; i < 5 / SIM_DT && titan.alive; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickBoss(run, regionByIndex(12), SIM_DT);
    }
    expect(titan.alive).toBe(false);
    expect(far.alive).toBe(true);
    expect(grunt.alive).toBe(true);
    expect(e.hp).toBeCloseTo(Math.min(e.maxHp, hp + 5000));
    expect(run.kills).toBe(kills);
    expect(run.shards).toBe(shards);
    expect(run.events.some((ev) => ev.kind === 'trample')).toBe(true);
  });
});

describe('the Astrolabe (plans/late-game/12 §7.1, §7.2)', () => {
  it('wears six plates spaced evenly round it, turning on the clock', () => {
    const run = atBoss(10);
    toPost(run);
    const e = bossBody(run)!;
    const spec = BOSS_BY_ID.astrolabe.plates!;
    const plates = () => run.enemies.filter((o) => o.alive && o.plate === e.id);
    expect(plates()).toHaveLength(6);
    expect(run.boss!.plates).toBe(6);
    tickBoss(run, regionByIndex(10), SIM_DT);
    const angles = (): number[] => plates().map((o) => Math.atan2(o.y - e.y, o.x - e.x));
    const at0 = angles();
    // Evenly spaced: each a sixth of a turn from the next, and all at one distance off the rim.
    const sorted = [...at0].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k] - sorted[k - 1]).toBeCloseTo(Math.PI / 3, 5);
    for (const o of plates()) expect(Math.hypot(o.x - e.x, o.y - e.y)).toBeCloseTo(e.radius + spec.radius * 0.6, 5);
    // A second later, each has turned `orbit` radians about the boss.
    const t0 = run.time;
    for (let i = 0; i < 1 / SIM_DT; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickBoss(run, regionByIndex(10), SIM_DT);
    }
    const turned = angles().map((a, k) => Math.atan2(Math.sin(a - at0[k]), Math.cos(a - at0[k])));
    for (const d of turned) expect(d).toBeCloseTo((run.time - t0) * spec.orbit!, 5);
  });

  it('reverses the field from its second phase: the spin flips, every `every` s', () => {
    const run = atBoss(10);
    toPost(run);
    const e = bossBody(run)!;
    e.hp = e.maxHp * 0.6;
    tickBoss(run, regionByIndex(10), SIM_DT);
    expect(run.boss!.phase).toBe(1);
    // The second phase cracks every plate away.
    expect(run.enemies.some((o) => o.alive && o.plate === e.id)).toBe(false);
    const spin = run.wake!.orbit!.spin;
    const flips: number[] = [];
    for (let i = 0; i < 20 / SIM_DT; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      run.events.length = 0;
      tickBoss(run, regionByIndex(10), SIM_DT);
      for (const ev of run.events) if (ev.kind === 'orbitTurn') flips.push(ev.spin);
    }
    const p = BOSS_BY_ID.astrolabe.phases[1].patterns[0];
    expect(p.kind).toBe('reverse');
    // Half a period in, then every period: 4 s, 12 s, 20 s.
    expect(flips).toEqual([-spin, spin, -spin].slice(0, flips.length));
    expect(flips.length).toBeGreaterThanOrEqual(2);
    expect(run.wake!.orbit!.spin).toBe(flips[flips.length - 1]);
  });
});

describe('the Leviathan (plans/late-game/12 §7.1)', () => {
  const F = BALANCE.wake.floes;
  const floes = (run: RunState) => run.enemies.filter((o) => o.alive && o.type === 'floe');

  it('cracks stationary Floes loose in its first phase: unpaid, between the wall and its post', () => {
    const run = atBoss(11);
    toPost(run);
    const def = BOSS_BY_ID.leviathan;
    const p = def.phases[0].patterns.find((q) => q.kind === 'floes')!;
    expect(p.kind === 'floes' && !p.ring).toBe(true);
    for (let i = 0; i < 6 / SIM_DT; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickBoss(run, regionByIndex(11), SIM_DT);
    }
    const out = floes(run);
    expect(out).toHaveLength(p.kind === 'floes' ? p.count : 0);
    expect(run.events.filter((ev) => ev.kind === 'floe')).toHaveLength(out.length);
    for (const f of out) {
      expect(f).toMatchObject({ speed: 0, xp: 0, shards: 0, wave: BOSS_WAVE });
      const d = Math.hypot(f.x, f.y);
      expect(d).toBeGreaterThanOrEqual(run.stats.radius + F.near - 1e-6);
      expect(d).toBeLessThanOrEqual(def.standoff - F.far + 1e-6);
    }
  });

  it('rings the wall with eight Floes, once, on entering its last phase', () => {
    const run = atBoss(11);
    toPost(run);
    const e = bossBody(run)!;
    e.hp = e.maxHp * 0.3;
    tickBoss(run, regionByIndex(11), SIM_DT);
    expect(run.boss!.phase).toBe(2);
    const ring = floes(run);
    expect(ring).toHaveLength(8);
    for (const [k, f] of ring.entries()) {
      expect(Math.hypot(f.x, f.y)).toBeCloseTo(run.stats.radius + F.ring, 6);
      const a = Math.atan2(f.y, f.x) - Math.atan2(e.y, e.x) - (k / 8) * Math.PI * 2;
      expect(Math.cos(a)).toBeCloseTo(1, 6);
    }
    for (let i = 0; i < 20 / SIM_DT; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickBoss(run, regionByIndex(11), SIM_DT);
    }
    expect(floes(run)).toHaveLength(8);
  });

  it('its Floes melt `melt` s after they crack, and all of them when it falls, unpaid (D-28)', () => {
    const run = atBoss(11);
    toPost(run);
    const e = bossBody(run)!;
    e.hp = e.maxHp * 0.3;
    tickBoss(run, regionByIndex(11), SIM_DT);
    const ring = floes(run);
    expect(ring).toHaveLength(8);
    for (const f of ring) {
      expect(f.meltAt).toBeCloseTo(run.time + F.melt, 9);
      expect(targetable(run, f)).toBe(false);
    }
    // A wave's Floe is no terrain: it doesn't melt with the boss.
    const stray = body(run, { type: 'floe', x: 400, y: 0, radius: 34 });
    const kills = run.kills;
    damageEnemy(run, e, 1e12, false);
    expect(run.boss?.killedIn).not.toBeNull();
    expect(floes(run)).toEqual([stray]);
    // Only the boss's own kill counts: a Floe melts unkilled.
    expect(run.kills).toBe(kills + 1);
    expect(run.killsBy.floe).toBeUndefined();
  });

  it('its Floes melt on their own `melt` s after they crack', () => {
    const run = atBoss(11);
    toPost(run);
    const e = bossBody(run)!;
    e.hp = e.maxHp * 0.3;
    tickBoss(run, regionByIndex(11), SIM_DT);
    expect(floes(run)).toHaveLength(8);
    const t0 = run.time;
    while ((run.tick + 1) * SIM_DT < t0 + F.melt - SIM_DT / 2) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickWake(run, regionByIndex(11), SIM_DT);
    }
    expect(floes(run)).toHaveLength(8);
    run.tick++;
    run.time = run.tick * SIM_DT;
    tickWake(run, regionByIndex(11), SIM_DT);
    expect(floes(run)).toHaveLength(0);
  });

  it('opens no relic slot (D-13)', () => {
    expect(BOSS_BY_ID.leviathan.relicSlot).toBe(false);
  });
});

describe('the Thunderhead (plans/late-game/12 §7.1)', () => {
  function thunderhead(phase: number): RunState {
    const run = atBoss(13);
    toPost(run);
    const e = bossBody(run)!;
    e.hp = e.maxHp * [1, 0.66, 0.33][phase];
    tickBoss(run, regionByIndex(13), SIM_DT);
    expect(run.boss!.phase).toBe(phase);
    run.events.length = 0;
    return run;
  }

  function advance(run: RunState, seconds: number): void {
    for (let i = 0; i < seconds / SIM_DT; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickBoss(run, regionByIndex(13), SIM_DT);
      tickWake(run, regionByIndex(13), SIM_DT);
    }
  }

  it('its bolt winds up from its post, then strikes the tower through `hurtTower`', () => {
    const run = thunderhead(0);
    const p = BOSS_BY_ID.thunderhead.phases[0].patterns[0];
    if (p.kind !== 'bolt') throw new Error('phase 0 is the bolt');
    run.stats = { ...run.stats, armor: 0 };
    // Its timer opens at half its period; the windup shows first.
    const hp = run.tower.hp;
    const until = p.every * 0.5 + SIM_DT;
    advance(run, until);
    expect(run.events.some((ev) => ev.kind === 'windup')).toBe(true);
    expect(run.tower.hp).toBe(hp);
    expect(run.events.some((ev) => ev.kind === 'strike')).toBe(false);
    advance(run, p.windup);
    const strike = run.events.find((ev) => ev.kind === 'strike');
    expect(strike).toMatchObject({ kind: 'strike', tower: true });
    expect(hp - run.tower.hp).toBeCloseTo(p.damage * waveDamage(regionByIndex(13), BOSS_WAVE));
    expect(run.takenBy.storm).toBeGreaterThan(0);
  });

  it('off its post, a bolt waits', () => {
    const run = thunderhead(0);
    const e = bossBody(run)!;
    e.x = e.px = 900;
    const hp = run.tower.hp;
    advance(run, 6);
    expect(run.events.some((ev) => ev.kind === 'windup')).toBe(false);
    expect(run.tower.hp).toBe(hp);
  });

  it('its tempest halves the storm\'s clock and forks each strike', () => {
    const run = thunderhead(2);
    const p = BOSS_BY_ID.thunderhead.phases[2].patterns[0];
    if (p.kind !== 'tempest') throw new Error('phase 2 is the tempest');
    const rule = regionByIndex(13).rule!.effect;
    if (rule.kind !== 'storm') throw new Error('Stormcrown storms');
    const a = body(run, { x: 300, y: 0, hp: 1000, maxHp: 1000 });
    const b = body(run, { x: -300, y: 0, hp: 900, maxHp: 900 });
    const c = body(run, { x: 0, y: 300, hp: 800, maxHp: 800 });
    run.time = run.wake!.storm!.next;
    tickWake(run, regionByIndex(13), SIM_DT);
    expect(run.wake!.storm!.next - run.time).toBeCloseTo(rule.every * p.pace);
    // Forked: the two toughest are struck, the third is spared.
    expect(run.events.filter((ev) => ev.kind === 'strike')).toHaveLength(p.forks);
    expect(a.hp).toBeCloseTo(1000 - 1000 * rule.damage);
    expect(b.hp).toBeCloseTo(900 - 900 * rule.damage);
    expect(c.hp).toBe(800);
    // Never on the boss itself (D-19).
    expect(bossBody(run)!.hp).toBeCloseTo(bossBody(run)!.maxHp * 0.33);
  });

  it('only its fall opens a relic slot in the Wake (D-13)', () => {
    for (const id of ['carillon', 'astrolabe', 'colossus'] as const) expect(BOSS_BY_ID[id].relicSlot).toBe(false);
    expect(BOSS_BY_ID.thunderhead.relicSlot).toBe(true);
  });
});
