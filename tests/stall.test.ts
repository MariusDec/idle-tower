import { describe, expect, it } from 'vitest';
import { createRun } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { BALANCE } from '../src/content/balance';
import { BOSS_WAVE, runRegion, startWave, tickWaves } from '../src/sim/systems/waves';
import { hordeFury } from '../src/sim/systems/tower';
import type { RunState } from '../src/sim/state';
import { body } from './helpers/body';

const O = BALANCE.overtime;

/** A run on wave `n` with the field full and the wave's first spawn already due. */
function fullField(n: number): RunState {
  const run = createRun(buildRunConfig(newProfile(0)), 1);
  startWave(run, runRegion(run), n);
  for (let i = 0; i < BALANCE.maxEnemies; i++) body(run);
  run.time = run.current!.startedAt + run.current!.spawns[0].at;
  return run;
}

/** Tick the waves at `seconds` past now, keeping the events it sent. */
function tickAt(run: RunState, seconds: number): void {
  run.time += seconds;
  tickWaves(run, runRegion(run));
}

describe('a stalled overtime wave (the full field holds it back)', () => {
  it('enrages its horde once held for stallAfter, and its hits grow with time', () => {
    const run = fullField(BOSS_WAVE + 5);
    tickAt(run, 0);
    expect(run.current!.heldSince).toBe(run.time);
    tickAt(run, O.stallAfter - 1);
    expect(hordeFury(run)).toBe(1);
    expect(run.events.some((e) => e.kind === 'hordeEnrage')).toBe(false);
    tickAt(run, 1);
    expect(run.events.filter((e) => e.kind === 'hordeEnrage')).toHaveLength(1);
    expect(hordeFury(run)).toBe(O.stallGrowth);
    tickAt(run, O.stallEvery * 2);
    expect(hordeFury(run)).toBeCloseTo(O.stallGrowth ** 3);
    expect(run.events.filter((e) => e.kind === 'hordeEnrage')).toHaveLength(1);
  });

  it('calms once a held spawn gets in: the tower is still killing', () => {
    const run = fullField(BOSS_WAVE + 5);
    tickAt(run, 0);
    tickAt(run, O.stallAfter);
    expect(hordeFury(run)).toBeGreaterThan(1);
    run.enemies.splice(0, 1);
    tickAt(run, 0.1);
    expect(run.current!.heldSince).toBeUndefined();
    expect(hordeFury(run)).toBe(1);
  });

  it('never applies before the boss: a full field in the region is just a hard wave', () => {
    const run = fullField(10);
    tickAt(run, 0);
    tickAt(run, O.stallAfter * 4);
    expect(run.current!.heldSince).toBeUndefined();
    expect(hordeFury(run)).toBe(1);
  });
});
