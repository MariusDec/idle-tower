import { Rng } from '../core/rng';
import { BALANCE } from '../content/balance';
import { PHONE_OVAL } from '../content/arena';
import { frameById } from '../content/frames';
import { isRush } from '../content/rush';
import { WEAPON_BY_ID } from '../content/weapons';
import type { BehaviourId, EnemyId, RegionDef, WeaponId } from '../content/types';
import type { RunConfig, RunInput, RunState, WeaponState } from './state';
import { newWeapon } from './systems/arms';
import { allMods, resolveStats } from './stats';
import { pactLoad, ruleSurge, surgeMods } from './pacts';
import { separateEnemies, sweepEnemies, tickEnemies } from './systems/enemies';
import { sweepProjectiles, tickBurns, tickProjectiles, tickRunes, tickWeapons } from './systems/combat';
import { banishCard, isWeaponId, pickCard, rerollDraft, takeSuggested, tickDraft, xpToNext } from './systems/draft';
import { tickBoss, tickPools, tickRings } from './systems/boss';
import { tickShots } from './systems/tower';
import { castUltimate, tickUltimate } from './systems/ultimate';
import { regionAt, regionMods, runRegion, tickWaves } from './systems/waves';

export { regionMods };

/** The enemy types a region's first `twinMountOpening` waves can bring: its pool, and any type a beat introduces. */
function openingTypes(region: RegionDef): Set<EnemyId> {
  const last = BALANCE.behaviours.twinMountOpening;
  const types = new Set<EnemyId>(region.pool.filter((p) => p.from <= last).map((p) => p.enemy));
  for (const [wave, beat] of Object.entries(region.beats)) {
    if (Number(wave) <= last && beat.kind === 'introduce') types.add(beat.enemy);
  }
  return types;
}

/**
 * What Twin Mount may draw (Q1, I3): the spares not weak against any of the
 * region's opening types (B1's `weakAgainst`), and of those the ones that
 * counter one, if any do. A tower whose both slots its opening blocks (Arcane
 * Bolt and Scattershot against Region 3's shields) lands nothing, so it gets
 * no drafts to mend it. Every spare blocked: all of them, as before.
 */
export function twinSpares(spares: readonly WeaponId[], region: RegionDef): readonly WeaponId[] {
  const opening = openingTypes(region);
  const clear = spares.filter((id) => !(WEAPON_BY_ID[id].weakAgainst ?? []).some((e) => opening.has(e)));
  if (clear.length === 0) return spares;
  const answers = clear.filter((id) => WEAPON_BY_ID[id].counters.some((e) => opening.has(e)));
  return answers.length > 0 ? answers : clear;
}

/**
 * The sim's entry points. The same `(config, seed, inputs)` always gives the
 * same run: nothing in `sim/` reads a clock, the DOM or `Math.random`.
 */
export function createRun(config: RunConfig, seed: number): RunState {
  const root = new Rng(seed);
  const frame = frameById(config.frameId);
  const region = regionAt(config.regionId, 1);
  // The pacts' tolls (§9) sit with the Forge's; the rule's share is kept
  // apart, so an Abyss floor can swap its rule for the next one's.
  const load = pactLoad(config.pacts);
  const outerMods = [...config.mods, ...load.mods, ...surgeMods(load, region)];
  const mods = [...outerMods, ...regionMods(region, ruleSurge(load, region))];
  const stats = resolveStats(allMods(mods, []));
  const owned = (id: BehaviourId): number => config.behaviours[id] ?? 0;
  const B = BALANCE.behaviours;
  // Head Start and Gatekeeper's Seal: the levels are real, so each banks its draft at once.
  // Boss Rush (N8) has no waves to grow on: the tower starts high.
  const rush = isRush(config.regionId) ? BALANCE.rush.level : 1;
  const level = Math.max(rush, 1 + B.headStart * owned('head-start') + owned('extra-level'));
  const startLevel = Math.min(BALANCE.maxLevel, 1 + B.openingSalvo * owned('opening-salvo'));
  // A Trial (N5) may mount another weapon than the frame's.
  const first = config.startingWeapon ?? frame.startingWeapon;
  const weapons: WeaponState[] = [newWeapon(first, startLevel)];
  // Twin Mount (§11.4): a second weapon from the pool, if a slot is free for
  // it, and not one the region's opening blunts (Q1, `twinSpares`).
  const spares = config.pool.filter((id): id is WeaponId => isWeaponId(id) && id !== first);
  if (owned('twin-mount') > 0 && config.weaponSlots >= 2 && spares.length > 0) {
    // Drilled and the Whetstone (§11.4) lift it like any new weapon.
    weapons.push(newWeapon(root.split('loadout').pick(twinSpares(spares, region)), Math.min(BALANCE.maxLevel, 1 + owned('drilled'))));
  }
  return {
    seed,
    regionId: config.regionId,
    arena: config.arena ?? PHONE_OVAL,
    trial: config.trial ?? null,
    tick: 0,
    time: 0,
    wave: 0,
    frameId: frame.id,
    outerMods,
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
    felled: [],
    floors: 0,
    pacts: { ...config.pacts },
    abyssRelics: [...config.abyssRelics],
    runes: [],
    wallRuneAt: -1e9,
    relics: [],
    elitesKilled: 0,
    firstHurtWave: null,
    loneWave: 0,
    shots: [],
    rings: [],
    fires: [],
    pools: [],
    evolved: [],
    fusions: [...(config.fusions ?? [])],
    fused: [],
    recipes: [...config.recipes],
    priority: config.priority ? [...config.priority] : null,
    never: config.never ? [...config.never] : null,
    behaviours: { ...config.behaviours },
    rerolls: owned('reroll'),
    banishes: owned('banish'),
    banished: [],
    swap: owned('specialist') > 0,
    revives: owned('second-wind'),
    enemies: [],
    projectiles: [],
    current: null,
    nextEnemyId: 1,
    seen: [],
    kills: 0,
    killsBy: {},
    damageBy: {},
    takenBy: {},
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
  if (input.banish !== undefined) banishCard(run, input.banish);
  if (input.pick !== undefined) pickCard(run, input.pick);
  if (input.takeAll) takeSuggested(run);
  if (input.ult) castUltimate(run);
}

/**
 * Advance the run by one fixed step of `dt` seconds. System order is part of
 * the contract: input, waves place bodies, the boss acts, bodies move, act
 * and spread, weapons fire, projectiles fly and kill, runes burst, burns bite, hostile shots and
 * shockwaves land, the dead are swept, a banked draft opens, then the tower
 * regenerates or falls.
 */
export function step(run: RunState, dt: number, input: RunInput = {}): void {
  if (run.outcome) return;
  run.tick++;
  run.time = run.tick * dt;
  applyInput(run, input);
  if (run.outcome) return;
  const region = runRegion(run);
  tickWaves(run, region);
  tickBoss(run, region, dt);
  tickEnemies(run, dt);
  separateEnemies(run);
  tickWeapons(run, dt);
  tickUltimate(run, dt);
  tickProjectiles(run, dt);
  tickRunes(run);
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
