import { Rng } from '../core/rng';
import { FRAMES } from '../content/frames';
import { regionByIndex } from '../content/regions';
import type { RunConfig, RunInput, RunState } from './state';
import { separateEnemies, sweepEnemies, tickEnemies } from './systems/enemies';
import { sweepProjectiles, tickProjectiles, tickWeapons } from './systems/combat';
import { tickWaves } from './systems/waves';

/**
 * The sim's two entry points. The same `(config, seed, inputs)` always gives
 * the same run: nothing in `sim/` reads a clock, the DOM or `Math.random`.
 */
export function createRun(config: RunConfig, seed: number): RunState {
  const root = new Rng(seed);
  const frame = FRAMES.find((f) => f.id === config.frameId) ?? FRAMES[0];
  const stats = { ...config.stats };
  return {
    seed,
    regionId: config.regionId,
    tick: 0,
    time: 0,
    wave: 0,
    stats,
    tower: { hp: stats.maxHp, aim: -Math.PI / 2, hurtTick: -1 },
    weapons: [{ id: frame.startingWeapon, level: 1, cooldown: 0 }],
    enemies: [],
    projectiles: [],
    current: null,
    nextEnemyId: 1,
    seen: [],
    kills: 0,
    rng: root.state,
    streams: {
      waves: root.split('waves').state,
      crit: root.split('crit').state,
    },
    outcome: null,
    events: [],
  };
}

/**
 * Advance the run by one fixed step of `dt` seconds. System order is part of
 * the contract: waves place bodies, bodies move, hit and spread, weapons fire,
 * projectiles fly and kill, the dead are swept, then the tower regenerates or
 * falls.
 */
export function step(run: RunState, dt: number, input: RunInput = {}): void {
  if (run.outcome) return;
  run.tick++;
  run.time = run.tick * dt;
  if (input.retreat) {
    run.outcome = { kind: 'retreat', wave: run.wave, time: run.time };
    return;
  }
  const region = regionByIndex(run.regionId);
  tickWaves(run, region);
  tickEnemies(run, dt);
  separateEnemies(run);
  tickWeapons(run, dt);
  tickProjectiles(run, dt);
  sweepEnemies(run);
  sweepProjectiles(run);

  const t = run.tower;
  if (t.hp <= 0) {
    t.hp = 0;
    run.outcome = { kind: 'fell', wave: run.wave, time: run.time };
    run.events.push({ kind: 'fell' });
    return;
  }
  t.hp = Math.min(run.stats.maxHp, t.hp + run.stats.regen * dt);
}
