import { describe, expect, it } from 'vitest';
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { recipeBook, recordRecipes } from '../src/meta/recipes';
import { featMet } from '../src/meta/feats';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { EVOLUTIONS } from '../src/content/evolutions';
import { PASSIVES } from '../src/content/passives';
import { WEAPONS } from '../src/content/weapons';
import { hashString, Rng } from '../src/core/rng';
import { armed, newWeapon } from '../src/sim/systems/arms';
import { bladeOrbit, damageEnemy, tickBurns, tickProjectiles, tickWeapons } from '../src/sim/systems/combat';
import { applyCard, candidateCards, draftChoices, rollOffer } from '../src/sim/systems/draft';
import { hurtTower } from '../src/sim/systems/tower';
import type { WeaponId } from '../src/content/types';
import type { RunConfig, RunState, SimEvent } from '../src/sim/state';
import { botInput } from '../tools/bot';
import { ALL_REGIONS, arsenalReport, I4_MAX_SHARE } from '../tools/arsenal';
import { body } from './helpers/body';

const ALL_WEAPONS = WEAPONS.map((w) => w.id);

/** A run past the first draft, with every weapon and passive in its pool, Alchemy owned, and nothing on the field. */
function armory(over: Partial<RunConfig> = {}, seed = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  const base = buildRunConfig(p);
  return createRun({
    ...base, pool: [...ALL_WEAPONS, ...PASSIVES.map((x) => x.id)], weaponSlots: 4, passiveSlots: 4,
    ...over, behaviours: { alchemy: 1, ...over.behaviours },
  }, seed);
}

/** Arm the run with just this weapon at `level`. */
function only(run: RunState, id: WeaponId, level = 1, evolved = false): void {
  run.weapons = [{ ...newWeapon(id, level), evolved }];
  run.stats = { ...run.stats, critChance: 0 };
}

/** Step the weapons and their shots (not the bodies) for `seconds`, keeping the events. */
function fight(run: RunState, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) {
    run.tick++;
    run.time = run.tick * SIM_DT;
    tickWeapons(run, SIM_DT);
    tickProjectiles(run, SIM_DT);
    tickBurns(run, SIM_DT);
    run.enemies = run.enemies.filter((e) => e.alive);
    run.projectiles = run.projectiles.filter((p) => p.alive);
    events.push(...run.events);
    run.events.length = 0;
  }
  return events;
}

const tough = { hp: 1e6, maxHp: 1e6 };

describe('the new patterns (§4.4, §11.2)', () => {
  it('Mortar lobs at the densest crowd and bursts in an area', () => {
    const run = armory();
    only(run, 'mortar');
    const lone = body(run, { x: 0, y: -150, ...tough });
    const pack = [0, 1, 2].map((i) => body(run, { x: 200 + i * 15, y: 0, ...tough }));
    const events = fight(run, 1.2);
    expect(events.some((e) => e.kind === 'blast' && e.style === 'shell')).toBe(true);
    for (const b of pack) expect(b.hp).toBeLessThan(1e6);
    expect(lone.hp).toBe(1e6);
  });

  it('a level-5 shell scatters its bomblets', () => {
    const run = armory();
    only(run, 'mortar', 5);
    body(run, { x: 200, y: 0, ...tough });
    const events = fight(run, 1.2);
    const p = weaponLevel('mortar', 5);
    // Both shells of the salvo land on the one body, each scattering its own.
    expect(events.filter((e) => e.kind === 'blast' && e.style === 'bomblet').length).toBe(p.count * p.bomblets);
  });

  it('Sunlance heats on one target, and starts cold on the next', () => {
    const run = armory();
    only(run, 'sunlance');
    const a = body(run, { x: 150, y: 0, ...tough });
    const hits = fight(run, 2.5).filter((e) => e.kind === 'hit').map((e) => (e as { amount: number }).amount);
    expect(hits[hits.length - 1]).toBeGreaterThan(hits[0] * 2);
    expect(a.hp).toBeLessThan(1e6);
    a.alive = false;
    const b = body(run, { x: -150, y: 0, ...tough });
    fight(run, SIM_DT * 2);
    expect(run.weapons[0].beamTarget).toBe(b.id);
    expect(run.weapons[0].heat).toBeLessThan(1.1);
  });

  it('a level-4 Sunlance burns through everything in its line', () => {
    const run = armory();
    only(run, 'sunlance', 4);
    const front = body(run, { x: 120, y: 0, ...tough });
    const behind = body(run, { x: 300, y: 4, ...tough });
    const aside = body(run, { x: 0, y: 300, ...tough });
    fight(run, 0.5);
    expect(front.hp).toBeLessThan(1e6);
    expect(behind.hp).toBeLessThan(1e6);
    expect(aside.hp).toBe(1e6);
  });

  it('Glaives cut what comes near the wall, and nothing out of reach', () => {
    const run = armory();
    only(run, 'glaives');
    const near = body(run, { x: 85, y: 0, radius: 12, ...tough });
    const far = body(run, { x: 300, y: 0, ...tough });
    const events = fight(run, 2);
    const hits = events.filter((e) => e.kind === 'hit').length;
    // Two blades turning 3.5 rad/s pass a body about 2.2 times in two seconds.
    expect(hits).toBeGreaterThanOrEqual(2);
    expect(hits).toBeLessThanOrEqual(3);
    expect(near.hp).toBeLessThan(1e6);
    expect(far.hp).toBe(1e6);
  });

  it('Sentinel Drones fly out to their quarry and fire on it', () => {
    const run = armory();
    only(run, 'sentinel-drones');
    const target = body(run, { x: 340, y: 0, ...tough });
    fight(run, 3);
    expect(run.weapons[0].drones).toHaveLength(2);
    for (const d of run.weapons[0].drones) expect(Math.hypot(d.x - target.x, d.y - target.y)).toBeLessThan(BALANCE.weapons.droneHover * 1.6);
    expect(target.hp).toBeLessThan(1e6);
  });

  it('Sentinel Drones arrive ready to fire, not with a backlog from the flight', () => {
    const run = armory();
    only(run, 'sentinel-drones');
    // At the edge of the leash: a long flight before the first shot.
    body(run, { x: run.stats.range, y: 0, ...tough });
    const shots: number[] = [];
    const n = Math.round(4 / SIM_DT);
    for (let i = 0; i < n; i++) {
      for (const e of fight(run, SIM_DT)) if (e.kind === 'fire') shots.push(run.time);
    }
    expect(shots.length).toBeGreaterThan(0);
    // Two drones, each at most one shot per interval: never more than two in a quarter second.
    for (const t of shots) expect(shots.filter((u) => u >= t && u < t + 0.25).length).toBeLessThanOrEqual(2);
  });

  it('Glaives sound a shot on each step a blade cuts', () => {
    const run = armory();
    only(run, 'glaives');
    const p = armed(run.stats, run.weapons[0]);
    body(run, { x: p.radius, y: 0, ...tough });
    const events = fight(run, 2);
    expect(events.some((e) => e.kind === 'fire' && e.weapon === 'glaives')).toBe(true);
  });
});

function weaponLevel(id: WeaponId, level: number) {
  return armed({ ...armory().stats }, { id, level, evolved: false });
}

describe('count caps (§12.5)', () => {
  it('past its cap, a count becomes damage', () => {
    const caps = BALANCE.caps as { bolts: number };
    const was = caps.bolts;
    caps.bolts = 2;
    try {
      const stats = armory().stats;
      const at5 = armed(stats, { id: 'arcane-bolt', level: 5, evolved: false });
      const at4 = armed(stats, { id: 'arcane-bolt', level: 4, evolved: false });
      expect(at5.count).toBe(2);
      // Level 5 is a third bolt; capped at two, each carries 3/2 of the hit.
      expect(at5.damage).toBeCloseTo(at4.damage * 1.5);
    } finally {
      caps.bolts = was;
    }
  });
});

describe('evolutions (§4.4)', () => {
  it('are offered if and only if the weapon is maxed and its partner owned', () => {
    for (const evo of EVOLUTIONS) {
      const run = armory();
      run.weapons = [newWeapon(evo.weapon, BALANCE.maxLevel - 1)];
      applyCard(run, { kind: 'passive', id: evo.passive, level: 1 });
      expect(candidateCards(run).some((c) => c.kind === 'evolution'), `${evo.id} early`).toBe(false);
      run.weapons[0].level = BALANCE.maxLevel;
      expect(candidateCards(run).filter((c) => c.kind === 'evolution')).toEqual([{ kind: 'evolution', id: evo.id }]);
      run.passives = [];
      expect(candidateCards(run).some((c) => c.kind === 'evolution'), `${evo.id} without partner`).toBe(false);
    }
  });

  it('wait for Alchemy', () => {
    const run = armory({ behaviours: { alchemy: 0 } });
    run.weapons = [newWeapon('arcane-bolt', 5)];
    run.passives = [{ id: 'precision', level: 1 }];
    expect(candidateCards(run).some((c) => c.kind === 'evolution')).toBe(false);
  });

  it('a ready evolution is in every hand', () => {
    const run = armory();
    run.weapons = [newWeapon('arcane-bolt', 5)];
    run.passives = [{ id: 'precision', level: 1 }];
    const rng = new Rng(3);
    for (let i = 0; i < 20; i++) expect(rollOffer(run, rng).some((c) => c.kind === 'evolution')).toBe(true);
  });

  it('Specialist evolves at level 3', () => {
    const run = armory({ behaviours: { specialist: 1 } });
    run.weapons = [newWeapon('glaives', 3)];
    run.passives = [{ id: 'reach', level: 1 }];
    expect(candidateCards(run)).toContainEqual({ kind: 'evolution', id: 'halo' });
  });

  it('evolving marks the weapon, records the recipe and spikes its damage', () => {
    const run = armory();
    run.weapons = [newWeapon('mortar', 5)];
    const before = armed(run.stats, run.weapons[0]).damage;
    applyCard(run, { kind: 'evolution', id: 'meteorfall' });
    expect(run.weapons[0].evolved).toBe(true);
    expect(run.evolved).toEqual(['meteorfall']);
    expect(run.events).toContainEqual({ kind: 'evolve', weapon: 'mortar', evolution: 'meteorfall' });
    expect(armed(run.stats, run.weapons[0]).damage).toBeCloseTo(before * BALANCE.evolutions.meteorfall.damage);
  });

  it('Seeker Swarm: a critical bolt bursts into seekers', () => {
    const run = armory();
    only(run, 'arcane-bolt', 5, true);
    run.stats = { ...run.stats, critChance: 1 };
    body(run, { x: 150, y: 0, ...tough });
    body(run, { x: 160, y: 120, ...tough });
    fight(run, 0.4);
    expect(run.projectiles.some((p) => p.seeker)).toBe(true);
  });

  it('Dragonbreath: pellets set bodies alight, and the fire leaps on death', () => {
    const run = armory();
    only(run, 'scattershot', 5, true);
    const a = body(run, { x: 150, y: 0, hp: 50, maxHp: 50 });
    const b = body(run, { x: 150, y: 60, ...tough });
    a.burn = 10;
    a.burnUntil = 99;
    damageEnemy(run, a, 1e9, false, 'cone');
    expect(b.burnUntil).toBeGreaterThan(run.time);
    const target = body(run, { x: 140, y: 0, ...tough });
    fight(run, 0.3);
    expect(target.burnUntil).toBeGreaterThan(run.time);
  });

  it('Storm Crown: three storms each cast their own lightning', () => {
    const run = armory();
    only(run, 'chain-lightning', 5, true);
    for (let i = 0; i < 6; i++) body(run, { x: Math.cos(i) * 200, y: Math.sin(i) * 200, ...tough });
    const events = fight(run, SIM_DT);
    expect(events.filter((e) => e.kind === 'chain').length).toBe(1 + BALANCE.evolutions['storm-crown'].storms);
  });

  it('Absolute Zero: pulses freeze, and a frozen body shatters when slain', () => {
    const run = armory();
    only(run, 'frost-ring', 5, true);
    const a = body(run, { x: 120, y: 0, ...tough });
    fight(run, SIM_DT);
    expect(a.frozenUntil).toBeGreaterThan(run.time);
    const near = body(run, { x: 150, y: 20, ...tough });
    const events: SimEvent[] = [];
    damageEnemy(run, a, 1e9, false, 'homing');
    events.push(...run.events);
    expect(events.some((e) => e.kind === 'blast' && e.style === 'shatter')).toBe(true);
    expect(near.hp).toBeLessThan(1e6);
  });

  it('Meteorfall: meteors fall on crowds and leave the ground burning', () => {
    const run = armory();
    only(run, 'mortar', 5, true);
    body(run, { x: 200, y: 0, ...tough });
    const events = fight(run, 1.5);
    expect(events.some((e) => e.kind === 'blast' && e.style === 'meteor')).toBe(true);
    expect(run.fires.length).toBeGreaterThan(0);
  });

  it('Judgment: at full heat the beam forks', () => {
    const run = armory();
    only(run, 'sunlance', 5, true);
    body(run, { x: 150, y: 0, ...tough });
    body(run, { x: 200, y: 40, ...tough });
    const events = fight(run, 6);
    expect(events.some((e) => e.kind === 'lance')).toBe(true);
  });

  it('Halo: the blades sweep out to the edge of range and back', () => {
    const run = armory();
    only(run, 'glaives', 5, true);
    const w = run.weapons[0];
    const p = armed(run.stats, w);
    const seen: number[] = [];
    for (let t = 0; t <= BALANCE.evolutions.halo.period; t += 0.25) {
      run.time = t;
      seen.push(bladeOrbit(run, w, p));
    }
    expect(Math.max(...seen)).toBeCloseTo(run.stats.range, 0);
    expect(Math.min(...seen)).toBeLessThan(run.stats.radius * 2);
  });

  it('Hive: a drone kill calls another drone, which fades', () => {
    const run = armory();
    only(run, 'sentinel-drones', 5, true);
    fight(run, SIM_DT);
    const owned = run.weapons[0].drones.length;
    const e = body(run, { x: 200, y: 0 });
    damageEnemy(run, e, 1e9, false, 'drone');
    expect(run.weapons[0].drones.length).toBe(owned + 1);
    fight(run, BALANCE.evolutions.hive.seconds + 0.5);
    expect(run.weapons[0].drones.length).toBe(owned);
  });
});

describe('keystones (§11.4)', () => {
  it('Hoarder takes a card from every draft, never below the floor', () => {
    expect(draftChoices(armory({ behaviours: { hoarder: 1 } }))).toBe(BALANCE.draft.choices - 1);
    expect(draftChoices(armory({ behaviours: { hoarder: 5 } }))).toBe(BALANCE.draft.minChoices);
  });

  it('Specialist leaves one weapon slot, whatever the Forge gave', () => {
    const p = newProfile(0);
    p.forge = { 'might-damage': 1, scattershot: 1, specialist: 1 };
    expect(buildRunConfig(p).weaponSlots).toBe(1);
  });

  it('Fortress bites back three times as hard, Thorns owned or not', () => {
    const plain = armory({ behaviours: { thorns: 1 } });
    const fort = armory({ behaviours: { fortress: 1 } });
    const a = body(plain, { x: 70, y: 0, ...tough });
    const b = body(fort, { x: 70, y: 0, ...tough });
    hurtTower(plain, 10, a.x, a.y, a);
    hurtTower(fort, 10, b.x, b.y, b);
    expect(1e6 - b.hp).toBeCloseTo((1e6 - a.hp) * BALANCE.behaviours.fortressThorns);
  });

  it('Glass Cannon halves Max HP and stops regeneration', () => {
    const p = newProfile(0);
    p.forge = { 'glass-cannon': 1 };
    const run = createRun(buildRunConfig(p), 1);
    expect(run.stats.maxHp).toBeCloseTo(BALANCE.tower.maxHp / 2);
    expect(run.stats.regen).toBe(0);
  });
});

describe('the pool grows with the Forge (§4.5)', () => {
  it('a passive that joins with a weapon waits for it', () => {
    const p = newProfile(0);
    expect(buildRunConfig(p).pool).not.toContain('area');
    p.forge = { mortar: 1 };
    expect(buildRunConfig(p).pool).toContain('area');
  });

  it('Velocity pierces at its last level', () => {
    const run = armory();
    applyCard(run, { kind: 'passive', id: 'velocity', level: 1 });
    expect(run.stats.pierce).toBe(0);
    applyCard(run, { kind: 'passive', id: 'velocity', level: BALANCE.maxLevel });
    expect(run.stats.pierce).toBe(1);
  });
});

describe('the Recipe Book (§5.3)', () => {
  it('shows a weapon half after a few runs carrying it, the riddle after a few maxing it', () => {
    const p = newProfile(0);
    const run = armory();
    run.weapons = [newWeapon('glaives', 5)];
    const halo = () => recipeBook(p).find((r) => r.evolution.id === 'halo')!;
    expect(halo()).toMatchObject({ found: false, weapon: false, hint: false });
    for (let i = 0; i < BALANCE.recipes.riddleRuns; i++) recordRecipes(p, run);
    expect(halo().hint).toBe(true);
    for (let i = BALANCE.recipes.riddleRuns; i < BALANCE.recipes.weaponRuns; i++) recordRecipes(p, run);
    expect(halo().weapon).toBe(true);
    expect(featMet(p, { kind: 'evolve' }, null)).toBe(false);
    run.evolved = ['halo'];
    expect(recordRecipes(p, run)).toEqual(['halo']);
    expect(recordRecipes(p, run)).toEqual([]);
    expect(halo()).toMatchObject({ found: true, hint: false });
    expect(featMet(p, { kind: 'evolve' }, null)).toBe(true);
  });
});

describe('determinism with the whole arsenal', () => {
  it('the same seed plays the same run', () => {
    const play = (): number => {
      const run = armory({ regionId: 2 }, 11);
      run.weapons = ALL_WEAPONS.slice(0, 4).map((id) => ({ ...newWeapon(id, 5), evolved: true }));
      run.passives = [{ id: 'area', level: 3 }, { id: 'focus', level: 3 }];
      for (let i = 0; i < 90 / SIM_DT && !run.outcome; i++) {
        step(run, SIM_DT, botInput(run, 'active'));
        run.events.length = 0;
      }
      const { events: _e, ...rest } = run;
      return hashString(JSON.stringify(rest));
    };
    expect(play()).toBe(play());
  });
});

/**
 * I4 (§8.4), across every region: the active bot, with every weapon in its
 * pool, never leans on one. The full report is `npm run arsenal`.
 */
describe('I4: no dominant weapon', () => {
  const r = arsenalReport(ALL_REGIONS, 12);

  it(`no weapon takes more than ${I4_MAX_SHARE * 100}% of the new-weapon picks`, () => {
    expect(r.worst.share).toBeLessThanOrEqual(I4_MAX_SHARE);
  });

  it('every weapon is taken somewhere', () => {
    expect(r.unpicked).toEqual([]);
  });

  it('evolutions happen at the frontier', () => {
    expect(Object.values(r.evolutions).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
}, 60_000);
