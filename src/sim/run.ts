import { Rng } from '../core/rng';
import { BALANCE } from '../content/balance';
import { FRAMES } from '../content/frames';
import { regionByIndex } from '../content/regions';
import type { BehaviourId } from '../content/types';
import type { RunConfig, RunInput, RunState } from './state';
import { allMods, resolveStats } from './stats';
import { separateEnemies, sweepEnemies, tickEnemies } from './systems/enemies';
import { sweepProjectiles, tickProjectiles, tickWeapons } from './systems/combat';
import { pickCard, rerollDraft, tickDraft, xpToNext } from './systems/draft';
import { castUltimate } from './systems/ultimate';
import { tickWaves } from './systems/waves';

/**
 * The sim's entry points. The same `(config, seed, inputs)` always gives the
 * same run: nothing in `sim/` reads a clock, the DOM or `Math.random`.
 */
export function createRun(config: RunConfig, seed: number): RunState {
  const root = new Rng(seed);
  const frame = FRAMES.find((f) => f.id === config.frameId) ?? FRAMES[0];
  const mods = [...config.mods];
  const stats = resolveStats(allMods(mods, []));
  const owned = (id: BehaviourId): number => config.behaviours[id] ?? 0;
  const B = BALANCE.behaviours;
  const level = 1 + B.headStart * owned('head-start');
  const startLevel = Math.min(BALANCE.maxLevel, 1 + B.openingSalvo * owned('opening-salvo'));
  return {
    seed,
    regionId: config.regionId,
    tick: 0,
    time: 0,
    wave: 0,
    frameId: frame.id,
    mods,
    stats,
    tower: { hp: stats.maxHp, hurtTick: -1 },
    weaponSlots: config.weaponSlots,
    passiveSlots: config.passiveSlots,
    pool: [...config.pool],
    weapons: [{ id: frame.startingWeapon, level: startLevel, cooldown: 0, aim: -Math.PI / 2 }],
    passives: [],
    // Head Start: the levels are real, so each banks its draft at once.
    level,
    xp: 0,
    xpNext: xpToNext(level),
    pendingDrafts: level - 1,
    draft: null,
    draftsOpened: 0,
    firstDraft: config.firstDraft ? [...config.firstDraft] : null,
    ult: { charge: 0, need: BALANCE.ultimate.charge, casts: 0 },
    shards: 0,
    shardsFrom: { kills: 0, waves: 0, cards: 0 },
    behaviours: { ...config.behaviours },
    rerolls: owned('reroll'),
    revives: owned('second-wind'),
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
      draft: root.split('draft').state,
    },
    outcome: null,
    events: [],
  };
}

/**
 * Apply the player's input. `step` calls this first; the app may also call it
 * between steps, e.g. to take a card while the arena is paused for the very
 * first draft. Either way it lands on a step boundary, so a run is still
 * `(config, seed, inputs by tick)`.
 */
export function applyInput(run: RunState, input: RunInput): void {
  if (run.outcome) return;
  if (input.retreat) {
    run.outcome = { kind: 'retreat', wave: run.wave, time: run.time };
    return;
  }
  if (input.reroll) rerollDraft(run);
  if (input.pick !== undefined) pickCard(run, input.pick);
  if (input.ult) castUltimate(run);
}

/**
 * Advance the run by one fixed step of `dt` seconds. System order is part of
 * the contract: input, waves place bodies, bodies move, hit and spread,
 * weapons fire, projectiles fly and kill, the dead are swept, a banked draft
 * opens, then the tower regenerates or falls.
 */
export function step(run: RunState, dt: number, input: RunInput = {}): void {
  if (run.outcome) return;
  run.tick++;
  run.time = run.tick * dt;
  applyInput(run, input);
  if (run.outcome) return;
  const region = regionByIndex(run.regionId);
  tickWaves(run, region);
  tickEnemies(run, dt);
  separateEnemies(run);
  tickWeapons(run, dt);
  tickProjectiles(run, dt);
  sweepEnemies(run);
  sweepProjectiles(run);
  tickDraft(run);

  const t = run.tower;
  if (t.hp <= 0 && run.revives > 0) {
    // Second Wind (§11.4): once per owned level, the fall becomes a rise.
    run.revives--;
    t.hp = run.stats.maxHp * BALANCE.behaviours.secondWindHp;
    run.events.push({ kind: 'revive' });
  }
  if (t.hp <= 0) {
    t.hp = 0;
    run.draft = null;
    run.outcome = { kind: 'fell', wave: run.wave, time: run.time };
    run.events.push({ kind: 'fell' });
    return;
  }
  t.hp = Math.min(run.stats.maxHp, t.hp + run.stats.regen * dt);
}
