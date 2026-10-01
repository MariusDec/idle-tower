import { describe, expect, it } from 'vitest';
import { applyInput, createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { regionByIndex } from '../src/content/regions';
import { isEliteWave, rollWave, spawnEnemy, waveHp } from '../src/sim/systems/waves';
import { damageEnemy, tickWeapons } from '../src/sim/systems/combat';
import { tickEnemies } from '../src/sim/systems/enemies';
import { tickShots } from '../src/sim/systems/tower';
import { Rng } from '../src/core/rng';
import type { RunConfig, RunState } from '../src/sim/state';
import { body } from './helpers/body';

function inRegion(region: number, over: Partial<RunConfig> = {}, seed = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  return createRun({ ...buildRunConfig(p), regionId: region, ...over }, seed);
}

describe('Region 2 verbs (§4.3, §11.1)', () => {
  it('a Splitter bursts into three fragments that never split again and pay a share', () => {
    const run = inRegion(2);
    const s = spawnEnemy(run, regionByIndex(2), 'splitter', 3, 200, 0);
    damageEnemy(run, s, 1e9, false);
    const verb = ENEMY_BY_ID.splitter.verb;
    if (verb.kind !== 'split') throw new Error('splitter must split');
    const frags = run.enemies.filter((e) => e.alive && e.type === 'splitter');
    expect(frags).toHaveLength(verb.count);
    for (const f of frags) {
      expect(f.gen).toBe(1);
      expect(f.maxHp).toBeCloseTo(s.maxHp * verb.hp);
      expect(f.shards).toBeCloseTo(s.shards * verb.reward);
    }
    damageEnemy(run, frags[0], 1e9, false);
    expect(run.enemies.filter((e) => e.alive)).toHaveLength(verb.count - 1);
  });

  it('Mire Lily makes the fragments frail', () => {
    const run = inRegion(2, { behaviours: { 'frail-splits': 1 } });
    const s = spawnEnemy(run, regionByIndex(2), 'splitter', 3, 200, 0);
    damageEnemy(run, s, 1e9, false);
    const verb = ENEMY_BY_ID.splitter.verb as { hp: number };
    const f = run.enemies.find((e) => e.alive)!;
    expect(f.maxHp).toBeCloseTo(s.maxHp * verb.hp * BALANCE.relics.frailSplits[0]);
  });

  it('a Spitter stops at its standoff and lobs shots that land on the wall', () => {
    const run = inRegion(2);
    const verb = ENEMY_BY_ID.spitter.verb;
    if (verb.kind !== 'ranged') throw new Error('spitter must be ranged');
    const sp = spawnEnemy(run, regionByIndex(2), 'spitter', 5, verb.standoff + 30, 0);
    const hp = run.tower.hp;
    for (let i = 0; i < 8 / SIM_DT; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickEnemies(run, SIM_DT);
      tickShots(run, SIM_DT);
    }
    expect(Math.hypot(sp.x, sp.y)).toBeCloseTo(verb.standoff, 0);
    expect(sp.inContact).toBe(false);
    expect(run.tower.hp).toBeLessThan(hp);
  });

  it('a Mender heals its neighbours, not itself', () => {
    const run = inRegion(2);
    const m = spawnEnemy(run, regionByIndex(2), 'mender', 5, 300, 0);
    const hurt = body(run, { x: 330, y: 0, hp: 10, maxHp: 100 });
    m.hp = m.maxHp / 2;
    m.actTimer = 0;
    tickEnemies(run, SIM_DT);
    expect(hurt.hp).toBeGreaterThan(10);
    expect(m.hp).toBeCloseTo(m.maxHp / 2);
  });

  it('the Mist rule cuts the range by 15%', () => {
    expect(inRegion(2).stats.range).toBeCloseTo(inRegion(1).stats.range * 0.85);
  });
});

describe('elites (§4.3)', () => {
  it('come on their region\'s waves, never the boss wave', () => {
    const r1 = regionByIndex(1);
    expect(isEliteWave(r1, r1.elites.from)).toBe(true);
    expect(isEliteWave(r1, r1.elites.from + 1)).toBe(false);
    expect(isEliteWave(r1, 20)).toBe(false);
    const wave = rollWave(r1, r1.elites.from, new Rng(4));
    expect(wave.filter((s) => s.elite)).toHaveLength(1);
    expect(wave.find((s) => s.elite)!.elite!.aura).toBeNull();
    const r2 = regionByIndex(2);
    const aura = rollWave(r2, r2.elites.from, new Rng(4)).find((s) => s.elite)!.elite!.aura;
    expect(r2.elites.auras).toContain(aura);
  });

  it('carry ×8 HP and pay ×10 shards', () => {
    const run = inRegion(1);
    const r = regionByIndex(1);
    const plain = spawnEnemy(run, r, 'grunt', 10, 300, 0);
    const elite = spawnEnemy(run, r, 'grunt', 10, 300, 50, { elite: { aura: null } });
    expect(elite.maxHp).toBeCloseTo(plain.maxHp * BALANCE.elites.hp);
    expect(elite.shards).toBeCloseTo(plain.shards * BALANCE.elites.shards);
    expect(plain.maxHp).toBeCloseTo(waveHp(r, 10));
  });

  it('a Shield elite halves what its neighbours take, but not itself', () => {
    const run = inRegion(2);
    const r = regionByIndex(2);
    const shield = spawnEnemy(run, r, 'splitter', 5, 300, 0, { elite: { aura: 'shield' } });
    const near = body(run, { x: 320, y: 20, hp: 1000, maxHp: 1000 });
    tickEnemies(run, SIM_DT);
    expect(damageEnemy(run, near, 100, false)).toBeCloseTo(100 * BALANCE.elites.shield);
    expect(damageEnemy(run, shield, 100, false)).toBeCloseTo(100);
  });

  it('a Vengeful elite enrages its neighbours as it dies', () => {
    const run = inRegion(2);
    const v = spawnEnemy(run, regionByIndex(2), 'spitter', 5, 300, 0, { elite: { aura: 'vengeful' } });
    const near = body(run, { x: 330, y: 0 });
    damageEnemy(run, v, 1e12, false);
    expect(near.fury).toBe(BALANCE.elites.vengeful);
  });

  it('drop relics only once a relic slot is open', () => {
    let drops = 0;
    let none = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const relicDrops of [true, false]) {
        const run = inRegion(1, { relicDrops }, seed);
        const e = spawnEnemy(run, regionByIndex(1), 'grunt', 10, 300, 0, { elite: { aura: null } });
        damageEnemy(run, e, 1e12, false);
        if (relicDrops) drops += run.relics.length;
        else none += run.relics.length;
      }
    }
    expect(none).toBe(0);
    expect(drops).toBeGreaterThan(0);
  });
});

describe('Frost Ring and Aegis (§11.2, §11.6)', () => {
  it('a pulse hits everything inside its radius and slows it', () => {
    const run = inRegion(1);
    run.weapons = [{ id: 'frost-ring', level: 1, cooldown: 0, aim: 0 }];
    const a = body(run, { x: 100, y: 0, hp: 1000, maxHp: 1000 });
    const b = body(run, { x: 0, y: -120, hp: 1000, maxHp: 1000 });
    const far = body(run, { x: 300, y: 0, hp: 1000, maxHp: 1000 });
    tickWeapons(run, SIM_DT);
    expect(a.hp).toBeLessThan(1000);
    expect(b.hp).toBeLessThan(1000);
    expect(far.hp).toBe(1000);
    expect(a.slow).toBeGreaterThan(0);
    expect(a.slowUntil).toBeGreaterThan(run.time);
  });

  it('the Bastion starts with Frost Ring and +50% Max HP', () => {
    const p = newProfile(0);
    p.bosses['bog-mother'] = { kills: 1, fastest: 60 };
    p.frame = 'bastion';
    const run = createRun(buildRunConfig(p), 1);
    expect(run.weapons[0].id).toBe('frost-ring');
    expect(run.stats.maxHp).toBeCloseTo(BALANCE.tower.maxHp * 1.5);
  });

  it('Aegis turns hits away and reflects contact', () => {
    const p = newProfile(0);
    p.bosses['bog-mother'] = { kills: 1, fastest: 60 };
    p.frame = 'bastion';
    const run = createRun(buildRunConfig(p), 1);
    run.ult.charge = 1;
    applyInput(run, { ult: true });
    expect(run.tower.invulnUntil).toBeGreaterThan(run.time);
    const e = body(run, { x: run.stats.radius + 20, y: 0, radius: 20, hp: 1000, maxHp: 1000, damage: 30, attackTimer: 0, inContact: true });
    const hp = run.tower.hp;
    for (let i = 0; i < 2 / SIM_DT; i++) step(run, SIM_DT);
    expect(run.tower.hp).toBeGreaterThanOrEqual(hp);
    expect(e.hp).toBeLessThan(1000);
  });
});
