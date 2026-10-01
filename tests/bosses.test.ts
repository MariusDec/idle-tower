import { describe, expect, it } from 'vitest';
import { applyInput, createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { BOSS_BY_ID } from '../src/content/bosses';
import { regionByIndex } from '../src/content/regions';
import { BOSS_WAVE, rollWave, startWave, waveHp, waveShardMult } from '../src/sim/systems/waves';
import { bossBody, tickBoss, tickRings } from '../src/sim/systems/boss';
import { damageEnemy } from '../src/sim/systems/combat';
import { hurtTower } from '../src/sim/systems/tower';
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
    hurtTower(run, run.stats.maxHp * 2, 0, 100, null);
    step(run, SIM_DT);
    expect(run.outcome).toBeNull();
    expect(run.tower.hp).toBeGreaterThan(0);
    expect(run.boss!.minHp).toBe(0);
  });
});
