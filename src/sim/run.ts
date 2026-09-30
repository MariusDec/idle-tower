import { Rng } from '../core/rng';
import type { RunConfig } from '../meta/runConfig';
import { BALANCE } from '../content/balance';
import type { RunInput, RunState } from './state';

/**
 * The sim's two entry points. The same `(config, seed, inputs)` always gives
 * the same run: nothing in `sim/` reads a clock, the DOM or `Math.random`.
 */
export function createRun(config: RunConfig, seed: number): RunState {
  const rng = new Rng(seed);
  return {
    seed,
    regionId: config.regionId,
    tick: 0,
    time: 0,
    wave: 1,
    tower: { hp: BALANCE.tower.maxHp, maxHp: BALANCE.tower.maxHp },
    rng: rng.state,
    outcome: null,
  };
}

/** Advance the run by one fixed step of `dt` seconds. */
export function step(run: RunState, dt: number, input: RunInput = {}): void {
  if (run.outcome) return;
  run.tick++;
  run.time = run.tick * dt;
  if (input.retreat) {
    run.outcome = { kind: 'retreat', wave: run.wave, time: run.time };
  }
}
