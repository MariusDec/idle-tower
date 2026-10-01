import type { Enemy, RunState } from '../../src/sim/state';

/** A plain body for a test, pushed onto `run`: a still grunt at (200, 0) unless overridden. */
export function body(run: RunState, over: Partial<Enemy> = {}): Enemy {
  const e: Enemy = {
    id: run.nextEnemyId++, type: 'grunt', boss: null, elite: false, aura: null, gen: 0,
    wave: 1, alive: true, x: 200, y: 0, px: 200, py: 0,
    hp: 100, maxHp: 100, armor: 0, speed: 0, radius: 20, damage: 10, attackInterval: 1,
    xp: 1, shards: 1, mass: 1, stunnedUntil: 0, slow: 0, slowUntil: 0, hiddenUntil: 0, actTimer: 0,
    moving: false, buffSpeed: 1, buffShield: 1, fury: 1, attackTimer: 0, inContact: false, hitTick: -1,
    burn: 0, burnUntil: 0, burnTimer: 0, frozenUntil: 0, under: false, group: 0, shade: false, court: 0,
    ...over,
  };
  run.enemies.push(e);
  return e;
}
