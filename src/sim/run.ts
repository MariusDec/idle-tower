import { Rng } from '../core/rng';
import { BALANCE } from '../content/balance';
import { PHONE_OVAL } from '../content/arena';
import { frameById } from '../content/frames';
import { isRush } from '../content/rush';
import { ABYSS_INDEX, floorStart } from '../content/abyss';
import { waypointLevel } from '../content/strata';
import { WEAPON_BY_ID } from '../content/weapons';
import type { BehaviourId, EnemyId, RegionDef, WeaponId } from '../content/types';
import type { AnomalyPlan, RunConfig, RunInput, RunState, WeaponState } from './state';
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
import { chooseRift, shutRift, tapRift, tickRifts } from './systems/rifts';
import { formNeed } from './systems/form';
import { claimReliquary, fadeReliquaries, tickReliquaries } from './systems/reliquaries';

export { regionMods };

/** The enemy types a region's first `twinMountOpening` waves can bring: its pool, and any type a beat introduces. */
export function openingTypes(region: RegionDef): Set<EnemyId> {
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

/** The run's anomaly roll (plans/late-game/04 §3): held or not, then its wait in eligible drafts. */
function rollAnomaly(rng: Rng, chance: number): AnomalyPlan {
  const held = chance >= 1 || rng.chance(chance);
  return { held, delay: held ? rng.int(0, BALANCE.anomalies.delay) : 0, offered: null, taken: null };
}

/**
 * The sim's entry points. The same `(config, seed, inputs)` always gives the
 * same run: nothing in `sim/` reads a clock, the DOM or `Math.random`.
 */
export function createRun(config: RunConfig, seed: number): RunState {
  const root = new Rng(seed);
  const frame = frameById(config.frameId);
  // A waypoint (plans/late-game/08 §4.4): an Abyss run may start at a stratum's foot.
  const startFloor = config.regionId === ABYSS_INDEX ? Math.max(1, Math.floor(config.startFloor ?? 1)) : 1;
  const startWave = floorStart(startFloor);
  const region = regionAt(config.regionId, startWave);
  // The pacts' tolls (§9) sit with the Forge's; the rule's share is kept
  // apart, so an Abyss floor can swap its rule for the next one's.
  const load = pactLoad(config.pacts);
  const outerMods = [...config.mods, ...load.mods, ...surgeMods(load, region)];
  const mods = [...outerMods, ...regionMods(region, ruleSurge(load, region))];
  const stats = resolveStats(allMods(mods, []));
  const owned = (id: BehaviourId): number => config.behaviours[id] ?? 0;
  const B = BALANCE.behaviours;
  // Head Start and Gatekeeper's Seal: the levels are real, so each banks its draft at once.
  // Boss Rush (N8) has no waves to grow on: the tower starts high. So does a
  // run from a waypoint, at the level a descent from the top reaches there.
  const rush = isRush(config.regionId) ? BALANCE.rush.level : startFloor > 1 ? waypointLevel(startFloor) : 1;
  const level = Math.max(rush, 1 + B.headStart * owned('head-start') + owned('extra-level'));
  const startLevel = Math.min(BALANCE.maxLevel, 1 + B.openingSalvo * owned('opening-salvo'));
  // A Trial (N5) may mount another weapon than the frame's.
  const first = config.startingWeapon ?? frame.startingWeapon;
  // Specialist (§11.4): the starting weapon is its signature.
  const weapons: WeaponState[] = [{ ...newWeapon(first, startLevel), signature: owned('specialist') > 0 }];
  // Twin Mount (§11.4): a second weapon from the pool, if a slot is free for
  // it, and not one the region's opening blunts (Q1, `twinSpares`). It is not
  // mounted: the first draft is sure to offer it (`rollOffer`).
  const spares = config.pool.filter((id): id is WeaponId => isWeaponId(id) && id !== first);
  const twinOffer = owned('twin-mount') > 0 && config.weaponSlots >= 2 && spares.length > 0
    ? root.split('loadout').pick(twinSpares(spares, region))
    : null;
  // Anomalies (plans/late-game/04 §3): whether this run holds one, and how
  // many eligible drafts it waits. A split leaves the root as it is.
  const anomalyStream = root.split('anomaly');
  const anomaly = config.anomaly ? rollAnomaly(anomalyStream, config.anomaly.chance) : null;
  return {
    seed,
    regionId: config.regionId,
    arena: config.arena ?? PHONE_OVAL,
    trial: config.trial ?? null,
    contract: config.contract ?? null,
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
    twinOffer,
    // Primed (§11.4): the first ultimate is ready the moment the run starts.
    ult: { charge: owned('charged-start') > 0 ? 1 : 0, need: BALANCE.ultimate.charge, casts: 0, until: 0, timer: 0 },
    shards: 0,
    shardsFrom: { kills: 0, waves: 0, cards: 0, elites: 0, boss: 0, rifts: 0 },
    firstKill: config.firstKill,
    relicDrops: config.relicDrops,
    boss: null,
    felled: [],
    floors: startFloor - 1,
    startWave,
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
      // Rifts (plans/late-game/02): `split` leaves the root as it is, so older seeds play as before.
      rifts: root.split('rifts').state,
      riftFx: root.split('riftFx').state,
      // Cursed relics (plans/late-game/03): their own stream, so a run with none draws as before.
      curse: root.split('curse').state,
      // Anomalies (plans/late-game/04): the roll, the wait and the weapon, on their own stream.
      anomaly: anomalyStream.state,
      // The strata (plans/late-game/08): which bodies the Inversion turns, on their own stream.
      strata: root.split('strata').state,
    },
    riftCfg: config.rifts ?? null,
    rift: null,
    riftRoll: { wave: 0, miss: 0, count: 0, last: 0, floor: 0 },
    riftHolds: [],
    riftLog: [],
    forgedHand: false,
    reliquaryCfg: config.reliquaries ?? null,
    reliquaries: [],
    reliquaryCount: 0,
    reliquariesClaimed: 0,
    reliquariesFaded: 0,
    anomaly,
    secrets: config.secrets ? {
      live: [...config.secrets.live],
      heard: [...config.secrets.heard],
      found: [...config.secrets.found],
      counts: { ...config.secrets.tally },
      fresh: [],
      stirred: null,
      sighted: [],
      felled: [],
      on: 0,
      off: 0,
    } : null,
    form: { need: formNeed(config), wave: null },
    omen: config.omen ? { day: config.omen.day, practice: config.omen.practice, log: [], resumes: 0 } : null,
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
  if (run.omen) logInput(run.omen.log, run.tick, input);
  if (input.retreat) {
    shutRift(run);
    fadeReliquaries(run);
    run.outcome = { kind: 'retreat', wave: run.wave, time: run.time };
    return;
  }
  if (input.claim !== undefined) claimReliquary(run, input.claim);
  if (input.tapRift) tapRift(run);
  if (input.chooseRift !== undefined) chooseRift(run, input.chooseRift);
  if (input.reroll) rerollDraft(run);
  if (input.banish !== undefined) banishCard(run, input.banish);
  if (input.pick !== undefined) pickCard(run, input.pick);
  if (input.takeAll) takeSuggested(run);
  if (input.ult) castUltimate(run);
}

/**
 * The Daily Omen's input ops (plans/late-game/11 §4.7): one number each, an
 * index added to its base. `resume` is the app's, never the player's.
 */
export const OMEN_OP = {
  retreat: 1, reroll: 2, takeAll: 3, ult: 4, tapRift: 5, resume: 6,
  pick: 100, banish: 200, chooseRift: 300, claim: 1000,
} as const;

/** Append `input` to an Omen's log at `tick`, one pair per part, in the order `applyInput` applies them. */
function logInput(log: number[], tick: number, input: RunInput): void {
  const O = OMEN_OP;
  if (input.retreat) {
    log.push(tick, O.retreat);
    return;
  }
  if (input.claim !== undefined) log.push(tick, O.claim + input.claim);
  if (input.tapRift) log.push(tick, O.tapRift);
  // −1 leaves the rift: stored one up, so every op stays positive.
  if (input.chooseRift !== undefined) log.push(tick, O.chooseRift + input.chooseRift + 1);
  if (input.reroll) log.push(tick, O.reroll);
  if (input.banish !== undefined) log.push(tick, O.banish + input.banish);
  if (input.pick !== undefined) log.push(tick, O.pick + input.pick);
  if (input.takeAll) log.push(tick, O.takeAll);
  if (input.ult) log.push(tick, O.ult);
}

/** One logged op back to its input; null for the app's `resume`. */
export function omenInput(op: number): RunInput | null {
  const O = OMEN_OP;
  if (op >= O.claim) return { claim: op - O.claim };
  if (op >= O.chooseRift) return { chooseRift: op - O.chooseRift - 1 };
  if (op >= O.banish) return { banish: op - O.banish };
  if (op >= O.pick) return { pick: op - O.pick };
  switch (op) {
    case O.retreat: return { retreat: true };
    case O.reroll: return { reroll: true };
    case O.takeAll: return { takeAll: true };
    case O.ult: return { ult: true };
    case O.tapRift: return { tapRift: true };
    default: return null;
  }
}

/** The app resumed this Omen from a snapshot (§4.5): counted, logged, never punished. */
export function noteResume(run: RunState): void {
  if (!run.omen) return;
  run.omen.resumes++;
  run.omen.log.push(run.tick, OMEN_OP.resume);
}

/**
 * Advance the run by one fixed step of `dt` seconds. System order is part of
 * the contract: input, waves place bodies, the boss acts, bodies move, act
 * and spread, weapons fire, projectiles fly and kill, runes burst, burns bite, hostile shots and
 * shockwaves land, the dead are swept, a banked draft opens, then the tower
 * regenerates or falls.
 *
 * `weaponSteps` is for the balance tools' coarse steps (`--fast`) alone: the
 * weapons act that many times in `dt`, each over its share, since a weapon
 * attacks at most once each time it acts. A late build fires 30–80 times a
 * second; one coarse step for three of the game's would cap it at 20.
 */
export function step(run: RunState, dt: number, input: RunInput = {}, weaponSteps = 1): void {
  if (run.outcome) return;
  run.tick++;
  run.time = run.tick * dt;
  applyInput(run, input);
  if (run.outcome) return;
  const region = runRegion(run);
  tickWaves(run, region);
  // Step 2b: rifts roll at a wave's start, show, and shut (plans/late-game/02).
  tickRifts(run, runRegion(run));
  tickBoss(run, region, dt);
  tickEnemies(run, dt);
  separateEnemies(run);
  for (let k = 0; k < weaponSteps; k++) tickWeapons(run, dt / weaponSteps);
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
  tickReliquaries(run);

  const t = run.tower;
  // Glass Crown's curse (plans/late-game/03): the tower never rises again.
  if (t.hp <= 0 && run.revives > 0 && !run.behaviours.unrisen) {
    // Second Wind (§11.4): once per owned level, the fall becomes a rise.
    run.revives--;
    t.hp = run.stats.maxHp * BALANCE.behaviours.secondWindHp;
    run.events.push({ kind: 'revive' });
  }
  if (t.hp <= 0) {
    t.hp = 0;
    run.draft = null;
    shutRift(run);
    fadeReliquaries(run);
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
