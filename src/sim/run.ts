import { Rng } from '../core/rng';
import { BALANCE } from '../content/balance';
import { frameById } from '../content/frames';
import { regionByIndex } from '../content/regions';
import type { BehaviourId, RegionDef, StatMod, WeaponId } from '../content/types';
import type { RunConfig, RunInput, RunState, WeaponState } from './state';
import { newWeapon } from './systems/arms';
import { allMods, resolveStats } from './stats';
import { separateEnemies, sweepEnemies, tickEnemies } from './systems/enemies';
import { sweepProjectiles, tickBurns, tickProjectiles, tickWeapons } from './systems/combat';
import { isWeaponId, pickCard, rerollDraft, tickDraft, xpToNext } from './systems/draft';
import { tickBoss, tickPools, tickRings } from './systems/boss';
import { tickShots } from './systems/tower';
import { castUltimate, tickUltimate } from './systems/ultimate';
import { tickWaves } from './systems/waves';

/**
 * A region's rule as stat contributions (§11.1). The rule's one switch: the
 * rest are read where they act (`systems/waves.ts#regionRule`), Brittle on every hit, Cinders
 * and Echoes on a kill, Blight on the wave roll.
 */
export function regionMods(region: RegionDef): StatMod[] {
  const rule = region.rule;
  if (!rule) return [];
  const e = rule.effect;
  switch (e.kind) {
    case 'stat':
      return [e.mod];
    case 'areaDamage':
    case 'cinders':
    case 'echoes':
    case 'blight':
      return [];
    default: {
      const exhaustive: never = e;
      return exhaustive;
    }
  }
}

/**
 * The sim's entry points. The same `(config, seed, inputs)` always gives the
 * same run: nothing in `sim/` reads a clock, the DOM or `Math.random`.
 */
export function createRun(config: RunConfig, seed: number): RunState {
  const root = new Rng(seed);
  const frame = frameById(config.frameId);
  const region = regionByIndex(config.regionId);
  const mods = [...config.mods, ...regionMods(region)];
  const stats = resolveStats(allMods(mods, []));
  const owned = (id: BehaviourId): number => config.behaviours[id] ?? 0;
  const B = BALANCE.behaviours;
  // Head Start and Gatekeeper's Seal: the levels are real, so each banks its draft at once.
  const level = 1 + B.headStart * owned('head-start') + owned('extra-level');
  const startLevel = Math.min(BALANCE.maxLevel, 1 + B.openingSalvo * owned('opening-salvo'));
  const weapons: WeaponState[] = [newWeapon(frame.startingWeapon, startLevel)];
  // Twin Mount (§11.4): a second weapon from the pool, if a slot is free for it.
  const spares = config.pool.filter((id): id is WeaponId => isWeaponId(id) && id !== frame.startingWeapon);
  if (owned('twin-mount') > 0 && config.weaponSlots >= 2 && spares.length > 0) {
    weapons.push(newWeapon(root.split('loadout').pick(spares), 1));
  }
  return {
    seed,
    regionId: config.regionId,
    tick: 0,
    time: 0,
    wave: 0,
    frameId: frame.id,
    mods,
    stats,
    tower: { hp: stats.maxHp, hurtTick: -1, invulnUntil: 0 },
    weaponSlots: config.weaponSlots,
    passiveSlots: config.passiveSlots,
    pool: [...config.pool],
    weapons,
    passives: [],
    level,
    xp: 0,
    xpNext: xpToNext(level),
    pendingDrafts: level - 1,
    draft: null,
    draftsOpened: 0,
    firstDraft: config.firstDraft ? [...config.firstDraft] : null,
    // Primed (§11.4): the first ultimate is ready the moment the run starts.
    ult: { charge: owned('charged-start') > 0 ? 1 : 0, need: BALANCE.ultimate.charge, casts: 0, until: 0, timer: 0 },
    shards: 0,
    shardsFrom: { kills: 0, waves: 0, cards: 0, elites: 0, boss: 0 },
    firstKill: config.firstKill,
    relicDrops: config.relicDrops,
    boss: null,
    relics: [],
    elitesKilled: 0,
    firstHurtWave: null,
    loneWave: 0,
    shots: [],
    rings: [],
    fires: [],
    pools: [],
    evolved: [],
    recipes: [...config.recipes],
    priority: config.priority ? [...config.priority] : null,
    behaviours: { ...config.behaviours },
    rerolls: owned('reroll'),
    revives: owned('second-wind'),
    enemies: [],
    projectiles: [],
    current: null,
    nextEnemyId: 1,
    seen: [],
    kills: 0,
    killsBy: {},
    rng: root.state,
    streams: {
      waves: root.split('waves').state,
      crit: root.split('crit').state,
      draft: root.split('draft').state,
      loot: root.split('loot').state,
      arms: root.split('arms').state,
      foes: root.split('foes').state,
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
 * the contract: input, waves place bodies, the boss acts, bodies move, act
 * and spread, weapons fire, projectiles fly and kill, burns bite, hostile shots and
 * shockwaves land, the dead are swept, a banked draft opens, then the tower
 * regenerates or falls.
 */
export function step(run: RunState, dt: number, input: RunInput = {}): void {
  if (run.outcome) return;
  run.tick++;
  run.time = run.tick * dt;
  applyInput(run, input);
  if (run.outcome) return;
  const region = regionByIndex(run.regionId);
  tickWaves(run, region);
  tickBoss(run, region, dt);
  tickEnemies(run, dt);
  separateEnemies(run);
  tickWeapons(run, dt);
  tickUltimate(run, dt);
  tickProjectiles(run, dt);
  tickBurns(run, dt);
  tickShots(run, dt);
  tickRings(run, dt);
  tickPools(run, dt);
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
  t.hp = Math.min(run.stats.maxHp, t.hp + run.stats.regen * regenMult(run) * dt);
}

/**
 * Mother's Tear (§11.5): regen multiplies while no enemy is within half
 * range. Oath of Stone (§11.4): it triples while a boss stands.
 */
function regenMult(run: RunState): number {
  const b = run.boss;
  const oath = run.behaviours.oath && b && b.killedIn === null ? BALANCE.behaviours.oathRegen : 1;
  const rank = run.behaviours['still-regen'] ?? 0;
  if (rank === 0) return oath;
  const r2 = (run.stats.range / 2) ** 2;
  for (const e of run.enemies) if (e.alive && e.x * e.x + e.y * e.y <= r2) return oath;
  const R = BALANCE.relics.stillRegen;
  return oath * R[Math.min(rank, R.length) - 1];
}
