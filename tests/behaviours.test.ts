import { describe, expect, it } from 'vitest';
import { applyInput, createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { regionByIndex } from '../src/content/regions';
import type { BehaviourId } from '../src/content/types';
import { damageEnemy } from '../src/sim/systems/combat';
import { gainXp } from '../src/sim/systems/draft';
import { tickEnemies } from '../src/sim/systems/enemies';
import type { RunState } from '../src/sim/state';
import { body } from './helpers/body';

function withForge(forge: Record<string, number>, seed = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  p.forge = forge;
  return createRun(buildRunConfig(p), seed);
}

const behaviour = (id: BehaviourId, n = 1): RunState => {
  const run = withForge({});
  run.behaviours[id] = n;
  return run;
};

describe('shards (§8.3)', () => {
  it('kills drop the region rate times the enemy weight, times shard gain', () => {
    const run = withForge({ 'fortune-shards': 2 });
    const e = body(run, { shards: 3 });
    damageEnemy(run, e, 1e6, false);
    expect(run.shards).toBeCloseTo(3 * (1 + 0.1 * 2));
    expect(run.shardsFrom.kills).toBeCloseTo(run.shards);
  });

  it('reaching wave n + 1 pays waveShards × n', () => {
    const run = withForge({});
    const region = regionByIndex(1);
    while (run.wave < 3 && !run.outcome) {
      step(run, SIM_DT);
      run.events.length = 0;
    }
    expect(run.shardsFrom.waves).toBeCloseTo(region.waveShards * (1 + 2));
  });
});

describe('Forge behaviours (§11.4)', () => {
  it('Overkill carries excess damage to the nearest enemy, once', () => {
    const run = behaviour('overkill');
    const a = body(run, { hp: 10, maxHp: 10 });
    const b = body(run, { x: 260 });
    const c = body(run, { x: 330 });
    damageEnemy(run, a, 50, false);
    expect(a.alive).toBe(false);
    expect(b.hp).toBeCloseTo(60);
    expect(c.hp).toBe(100);
  });

  it('without Overkill, the excess is lost', () => {
    const run = withForge({});
    const a = body(run, { hp: 10, maxHp: 10 });
    const b = body(run, { x: 260 });
    damageEnemy(run, a, 50, false);
    expect(b.hp).toBe(100);
  });

  it('Executioner finishes a body under its threshold', () => {
    const run = behaviour('executioner');
    const e = body(run, { hp: 100 * BALANCE.behaviours.executeBelow - 1 });
    damageEnemy(run, e, 1, false);
    expect(e.alive).toBe(false);
  });

  it('Thorns hits back the body that hit the tower', () => {
    const run = behaviour('thorns');
    const e = body(run, { x: run.stats.radius + 20, inContact: true, attackTimer: 0 });
    tickEnemies(run, SIM_DT);
    const dealt = e.damage;
    expect(e.hp).toBeCloseTo(100 - dealt * BALANCE.behaviours.thorns);
  });

  it('Second Wind turns one fall into a rise', () => {
    const run = withForge({});
    run.revives = 1;
    run.tower.hp = -5;
    step(run, SIM_DT);
    expect(run.outcome).toBeNull();
    expect(run.tower.hp).toBeGreaterThan(run.stats.maxHp * 0.49);
    run.tower.hp = -5;
    step(run, SIM_DT);
    expect(run.outcome?.kind).toBe('fell');
  });

  it('Last Stand speeds up the weapons when the tower is low', () => {
    const fire = (low: boolean): number => {
      const run = behaviour('last-stand');
      body(run, { hp: 1e12, maxHp: 1e12, x: 150 });
      if (low) run.tower.hp = run.stats.maxHp * 0.1;
      let shots = 0;
      for (let i = 0; i < 600; i++) {
        run.tower.hp = low ? run.stats.maxHp * 0.1 : run.stats.maxHp;
        run.current = { n: 99, startedAt: 0, spawns: [], next: 0, doneAt: 0, alive: 1 };
        step(run, SIM_DT);
        shots += run.events.filter((e) => e.kind === 'fire').length;
        run.events.length = 0;
      }
      return shots;
    };
    expect(fire(true) / fire(false)).toBeCloseTo(1 + BALANCE.behaviours.lastStandSpeed, 1);
  });

  it('Choice adds a card; Reroll replaces the hand and is spent', () => {
    const run = withForge({ 'might-damage': 1, scattershot: 1, choice: 1, reroll: 1 });
    gainXp(run, run.xpNext);
    step(run, SIM_DT);
    expect(run.draft!.cards).toHaveLength(BALANCE.draft.choices + 1);
    const before = run.draft;
    applyInput(run, { reroll: true });
    expect(run.draft).not.toBe(before);
    expect(run.rerolls).toBe(0);
    const again = run.draft;
    applyInput(run, { reroll: true });
    expect(run.draft).toBe(again);
  });
});
