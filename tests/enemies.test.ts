/**
 * The behavioural roster (gameplay plan §2.8).
 *
 * Every one of these tests exists because the corresponding behaviour is worth
 * nothing if it silently stops firing: an enemy that no longer steals, blinks,
 * shields or hides still spawns, still has a bar, and still looks fine on
 * screen. The type system cannot see any of that, so this file is what makes
 * "is it still a threat?" a question with an answer.
 *
 * Everything is driven through the *real* managers at a fixed `dt`, because the
 * plan's whole cadence requirement is that these behaviours are correct inside
 * `Game.simulate`'s substeps rather than once per frame.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import { EnemyManager } from '../src/systems/EnemyManager';
import { ResourceManager } from '../src/systems/ResourceManager';
import { ProjectileManager } from '../src/systems/ProjectileManager';
import { Tower } from '../src/systems/Tower';
import { WaveManager } from '../src/systems/WaveManager';
import {
  ENEMY_BEHAVIOR,
  ENEMY_DEFS,
  isTargetable,
  spawnPoolForWave,
} from '../src/data/enemies';
import { TOWER_BASE } from '../src/data/tower';
import type { Enemy, GameStats, ResourceState, TowerState } from '../src/types';

/** One substep at the game's fixed rate. */
const DT = 1 / 120;
const TOWER_X = 400;
const TOWER_Y = 300;
const ARENA_W = 800;
const ARENA_H = 600;

function makeResources(gold: number): { resources: ResourceManager; state: ResourceState } {
  const state: ResourceState = {
    gold,
    mana: 0,
    maxMana: 100,
    manaRegen: 0,
    ascensionPoints: 0,
    apThisTranscendence: 0,
    transcendencePoints: 0,
    lifetimeAP: 0,
    lifetimeGold: 0,
  };
  const stats = { goldEarned: 0 } as unknown as GameStats;
  return { resources: new ResourceManager(state, stats, new EventBus()), state };
}

interface Harness {
  bus: EventBus;
  mgr: EnemyManager;
  gold: () => number;
  events: Array<{ name: string; payload: unknown }>;
  /** Run the manager for `seconds` of simulation time at the fixed substep. */
  run: (seconds: number) => void;
}

function harness(gold = 10_000): Harness {
  const bus = new EventBus();
  const { resources, state } = makeResources(gold);
  const mgr = new EnemyManager(bus, resources);
  mgr.setBounds(ARENA_W, ARENA_H);
  mgr.beginWave(40);
  const events: Array<{ name: string; payload: unknown }> = [];
  for (const name of [
    'tower_damaged', 'gold_stolen', 'gold_recovered', 'gold_escaped',
    'ward_projected', 'ward_absorbed', 'burrower_surfaced', 'enemy_blinked',
    'siege_fired', 'siege_impact', 'shield_restored', 'toast',
  ]) {
    bus.on(name, (payload) => events.push({ name, payload }));
  }
  return {
    bus,
    mgr,
    gold: () => state.gold,
    events,
    run: (seconds: number) => {
      const steps = Math.round(seconds / DT);
      for (let i = 0; i < steps; i++) mgr.tick(DT, TOWER_X, TOWER_Y);
    },
  };
}

/** A tower with enough range to see the whole arena. */
function makeTower(mode: TowerState['targetingMode'] = 'priority'): Tower {
  const tower = new Tower({ ...TOWER_BASE, cooldown: 0, range: 2000, targetingMode: mode });
  tower.setPosition(TOWER_X, TOWER_Y);
  return tower;
}

describe('thief (plan §2.1)', () => {
  it('steals a capped cut of current gold on contact, then runs for the edge', () => {
    const h = harness(10_000);
    // Spawned on top of the tower so contact happens on the first substep.
    const thief = h.mgr.spawn('thief', 40, TOWER_X + 10, TOWER_Y);
    h.run(0.05);

    const stolen = thief.stolenGold ?? 0;
    expect(stolen).toBeGreaterThan(0);
    // 6% of current gold, and never more than 30x a normal wave-40 drop.
    expect(stolen).toBeLessThanOrEqual(Math.floor(10_000 * ENEMY_BEHAVIOR.thiefStealFraction));
    expect(h.gold()).toBe(10_000 - stolen);
    expect(thief.fleeing).toBe(true);
    expect(h.events.some(e => e.name === 'gold_stolen')).toBe(true);

    // And it is now travelling away from the tower rather than attacking it.
    const before = Math.hypot(thief.x - TOWER_X, thief.y - TOWER_Y);
    h.run(0.5);
    expect(Math.hypot(thief.x - TOWER_X, thief.y - TOWER_Y)).toBeGreaterThan(before);
    expect(thief.attacking).toBe(false);
  });

  it('pays double when killed before it escapes', () => {
    const h = harness(10_000);
    const thief = h.mgr.spawn('thief', 40, TOWER_X + 10, TOWER_Y);
    h.run(0.05);
    const stolen = thief.stolenGold ?? 0;
    const afterTheft = h.gold();

    h.mgr.damage(thief, thief.hp + 1000, false);
    // The kill pays the enemy's own gold value *and* twice what it was carrying.
    expect(h.gold()).toBeGreaterThanOrEqual(afterTheft + stolen * ENEMY_BEHAVIOR.thiefRecoveryMult);
    const recovered = h.events.find(e => e.name === 'gold_recovered');
    expect(recovered).toBeTruthy();
    expect((recovered!.payload as { amount: number }).amount)
      .toBe(stolen * ENEMY_BEHAVIOR.thiefRecoveryMult);
  });

  it('takes the gold with it when it leaves the field', () => {
    const h = harness(10_000);
    // Placed near the left edge so its run is short.
    const thief = h.mgr.spawn('thief', 40, TOWER_X, TOWER_Y);
    h.run(0.05);
    const stolen = thief.stolenGold ?? 0;
    const afterTheft = h.gold();

    thief.x = -ENEMY_BEHAVIOR.blinkDistance;
    h.run(0.1);

    expect(h.mgr.list.some(e => e.id === thief.id)).toBe(false);
    // Gone for good: no recovery, no refund.
    expect(h.gold()).toBe(afterTheft);
    const escaped = h.events.find(e => e.name === 'gold_escaped');
    expect(escaped).toBeTruthy();
    expect((escaped!.payload as { amount: number }).amount).toBe(stolen);
  });

  it('holds the 15%-of-current-gold ceiling across a wave', () => {
    const h = harness(10_000);
    const before = h.gold();
    // Four thieves in one wave — more than `WaveManager` will ever spawn, which
    // is exactly why the ceiling is enforced here rather than only at spawn.
    for (let i = 0; i < 4; i++) {
      h.mgr.spawn('thief', 40, TOWER_X + 10 + i, TOWER_Y);
      h.run(0.05);
    }
    const taken = before - h.gold();
    expect(taken).toBeGreaterThan(0);
    expect(taken).toBeLessThanOrEqual(Math.ceil(before * ENEMY_BEHAVIOR.thiefWaveTheftCap));
  });

  it('resets the ceiling when a new wave begins', () => {
    const h = harness(10_000);
    h.mgr.spawn('thief', 40, TOWER_X + 10, TOWER_Y);
    h.run(0.05);
    const afterFirstWave = h.gold();
    h.mgr.beginWave(41);
    const t2 = h.mgr.spawn('thief', 41, TOWER_X + 10, TOWER_Y);
    h.run(0.05);
    expect(t2.stolenGold ?? 0).toBeGreaterThan(0);
    expect(h.gold()).toBeLessThan(afterFirstWave);
  });
});

describe('blinker (plan §2.1)', () => {
  it('teleports toward the tower on its interval', () => {
    const h = harness();
    const blinker = h.mgr.spawn('blinker', 40, TOWER_X + 400, TOWER_Y);

    // A quiet second: it only walks, and slowly — the type's base speed is
    // deliberately low, because the blink is how it covers ground.
    h.run(1);
    const before = blinker.x;
    h.run(0.5);
    const walkPerHalfSecond = before - blinker.x;
    expect(walkPerHalfSecond).toBeLessThan(ENEMY_BEHAVIOR.blinkDistance);

    // The substep the interval elapses on covers the blink distance on top of
    // the walk, in one discontinuous jump.
    const atBlink = blinker.x;
    h.run(ENEMY_BEHAVIOR.blinkInterval - 1.5 + 0.05);
    const jump = atBlink - blinker.x;
    expect(jump).toBeGreaterThan(ENEMY_BEHAVIOR.blinkDistance);
    expect(h.events.some(e => e.name === 'enemy_blinked')).toBe(true);
    expect(blinker.afterImageX).toBeDefined();
    // The after-image is left at the position it vacated, at least a blink
    // behind (plus whatever it has walked since).
    expect((blinker.afterImageX ?? 0) - blinker.x)
      .toBeGreaterThanOrEqual(ENEMY_BEHAVIOR.blinkDistance);
  });

  it('ignores knockback while the blink immunity is up', () => {
    const h = harness();
    const blinker = h.mgr.spawn('blinker', 40, TOWER_X + 400, TOWER_Y);
    h.run(ENEMY_BEHAVIOR.blinkInterval + 0.01);
    expect(blinker.blinkImmunity ?? 0).toBeGreaterThan(0);

    const x = blinker.x;
    h.mgr.applyKnockback(blinker, 200, TOWER_X, TOWER_Y);
    expect(blinker.x).toBe(x);

    // Once the window lapses it is a normal enemy again.
    h.run(ENEMY_BEHAVIOR.blinkImmunity + 0.05);
    h.mgr.applyKnockback(blinker, 200, TOWER_X, TOWER_Y);
    expect(blinker.x).toBeGreaterThan(x);
  });

  it('reaches the tower at the same rate regardless of substep size', () => {
    // The cadence claim in the plan: correct at dt = 1/120 and at 6.5x speed,
    // where `Game.simulate` runs many substeps per frame.
    const distances: number[] = [];
    for (const dt of [1 / 120, 1 / 240, 1 / 60]) {
      const h = harness();
      const blinker = h.mgr.spawn('blinker', 40, TOWER_X + 500, TOWER_Y);
      const steps = Math.round(10 / dt);
      for (let i = 0; i < steps; i++) h.mgr.tick(dt, TOWER_X, TOWER_Y);
      distances.push(blinker.x);
    }
    for (const d of distances) expect(d).toBeCloseTo(distances[0], 0);
  });
});

describe('warden (plan §2.1)', () => {
  it('projects an absorb shield onto nearby allies, capped at five', () => {
    const h = harness();
    const warden = h.mgr.spawn('warden', 40, TOWER_X + 300, TOWER_Y);
    const allies: Enemy[] = [];
    for (let i = 0; i < 7; i++) {
      allies.push(h.mgr.spawn('normal', 40, TOWER_X + 300 + i, TOWER_Y + 10));
    }
    h.run(DT * 2);

    const shielded = allies.filter(a => (a.absorbShield ?? 0) > 0);
    expect(shielded.length).toBe(ENEMY_BEHAVIOR.wardMaxTargets);
    const expected = Math.max(1, Math.floor(warden.maxHp * ENEMY_BEHAVIOR.wardShieldFraction));
    expect(shielded[0].absorbShield).toBe(expected);
    expect(shielded[0].wardenId).toBe(warden.id);
  });

  it('absorbs damage before HP, and refreshes on its interval', () => {
    const h = harness();
    const warden = h.mgr.spawn('warden', 40, TOWER_X + 300, TOWER_Y);
    const ally = h.mgr.spawn('normal', 40, TOWER_X + 300, TOWER_Y + 10);
    h.run(DT * 2);

    const pool = ally.absorbShield ?? 0;
    expect(pool).toBeGreaterThan(0);
    const hpBefore = ally.hp;

    // A hit smaller than the pool costs no HP at all.
    h.mgr.damage(ally, pool - 1, false);
    expect(ally.hp).toBe(hpBefore);
    expect(ally.absorbShield).toBe(1);
    expect(h.events.some(e => e.name === 'ward_absorbed')).toBe(true);

    // And the warden puts it back after `wardRefresh` seconds.
    h.run(ENEMY_BEHAVIOR.wardRefresh + 0.05);
    expect(ally.absorbShield).toBe(pool);
    expect(warden.alive).toBe(true);
  });

  it('bleeds through once the pool is spent', () => {
    const h = harness();
    h.mgr.spawn('warden', 40, TOWER_X + 300, TOWER_Y);
    const ally = h.mgr.spawn('normal', 40, TOWER_X + 300, TOWER_Y + 10);
    h.run(DT * 2);
    const pool = ally.absorbShield ?? 0;
    const hpBefore = ally.hp;
    h.mgr.damage(ally, pool + 5, false);
    expect(ally.absorbShield).toBe(0);
    expect(ally.hp).toBe(hpBefore - 5);
  });

  it('collapses every pool it was maintaining when it dies', () => {
    const h = harness();
    const warden = h.mgr.spawn('warden', 40, TOWER_X + 300, TOWER_Y);
    const ally = h.mgr.spawn('normal', 40, TOWER_X + 300, TOWER_Y + 10);
    h.run(DT * 2);
    expect(ally.absorbShield ?? 0).toBeGreaterThan(0);

    h.mgr.damage(warden, warden.hp + 1000, false);
    expect(ally.absorbShield).toBe(0);
    expect(ally.wardenId).toBeUndefined();
  });

  it('does not shield other wardens', () => {
    const h = harness();
    h.mgr.spawn('warden', 40, TOWER_X + 300, TOWER_Y);
    const second = h.mgr.spawn('warden', 40, TOWER_X + 305, TOWER_Y);
    h.run(DT * 2);
    expect(second.absorbShield ?? 0).toBe(0);
  });
});

describe('burrower (plan §2.1)', () => {
  it('is untargetable and invulnerable while burrowed', () => {
    const h = harness();
    const burrower = h.mgr.spawn('burrower', 40, TOWER_X + 400, TOWER_Y);
    expect(burrower.burrowed).toBe(true);
    expect(isTargetable(burrower)).toBe(false);

    const hp = burrower.hp;
    expect(h.mgr.damage(burrower, 9999, false)).toBe(false);
    expect(burrower.hp).toBe(hp);
    expect(burrower.alive).toBe(true);
  });

  it('is skipped by Tower.acquireTarget in every mode', () => {
    const h = harness();
    const burrower = h.mgr.spawn('burrower', 40, TOWER_X + 100, TOWER_Y);
    // Deliberately further away and lower HP, so every heuristic would
    // otherwise prefer the burrower.
    const decoy = h.mgr.spawn('tank', 40, TOWER_X + 300, TOWER_Y);

    for (const mode of ['priority', 'nearest', 'lowest_hp', 'strongest', 'boss', 'flying', 'last'] as const) {
      const target = makeTower(mode).acquireTarget(h.mgr.list);
      expect(target?.id, mode).toBe(decoy.id);
    }
    expect(burrower.burrowed).toBe(true);
  });

  it('is skipped by the ability target pickers', () => {
    // The plan calls these out by name: the highest-HP pick (Meteor Strike) and
    // the chain-bounce search (Chain Lightning) both walk `enemies.list`
    // directly, so neither is covered by `Tower.acquireTarget`.
    const h = harness();
    const burrower = h.mgr.spawn('burrower', 40, TOWER_X + 20, TOWER_Y);
    // Give it far more HP than anything else, so a highest-HP pick would take it.
    burrower.maxHp = 1e9;
    burrower.hp = 1e9;
    const decoy = h.mgr.spawn('normal', 40, TOWER_X + 300, TOWER_Y);

    const targetable = h.mgr.list.filter(isTargetable);
    expect(targetable.map(e => e.id)).toEqual([decoy.id]);
  });

  it('is passed through by projectiles', () => {
    const h = harness();
    const tower = makeTower();
    const projectiles = new ProjectileManager(h.bus, tower, h.mgr);
    projectiles.setBounds(ARENA_W, ARENA_H);
    const burrower = h.mgr.spawn('burrower', 40, TOWER_X + 100, TOWER_Y);
    const behind = h.mgr.spawn('normal', 40, TOWER_X + 200, TOWER_Y);

    projectiles.fire(behind, tower.snapshot, {
      rawDamage: 50,
      damageType: 'physical',
      isCrit: false,
      targetId: behind.id,
    });
    for (let i = 0; i < 60; i++) projectiles.tick(DT);

    expect(burrower.hp).toBe(burrower.maxHp);
    expect(behind.hp).toBeLessThan(behind.maxHp);
  });

  it('surfaces at the plan distance with a telegraph, then becomes fair game', () => {
    const h = harness();
    const burrower = h.mgr.spawn('burrower', 40, TOWER_X + 400, TOWER_Y);
    h.run(20);
    expect(burrower.burrowed).toBe(false);
    const surfaced = h.events.find(e => e.name === 'burrower_surfaced');
    expect(surfaced).toBeTruthy();
    const at = surfaced!.payload as { x: number; y: number };
    expect(Math.hypot(at.x - TOWER_X, at.y - TOWER_Y))
      .toBeLessThanOrEqual(ENEMY_BEHAVIOR.burrowSurfaceDistance + 2);

    // It cannot be shot on the way in, and can be the moment it is up.
    expect(isTargetable(burrower)).toBe(true);
    expect(h.mgr.damage(burrower, 1, false)).toBe(false);
    expect(burrower.hp).toBeLessThan(burrower.maxHp);
  });

  it('crosses the approach faster than it walks on the surface', () => {
    const h = harness();
    const buried = h.mgr.spawn('burrower', 40, TOWER_X + 400, TOWER_Y);
    const surfaced = h.mgr.spawn('burrower', 40, TOWER_X + 400, TOWER_Y + 40);
    surfaced.burrowed = false;
    h.run(1);
    expect(TOWER_X + 400 - buried.x).toBeGreaterThan(TOWER_X + 400 - surfaced.x);
  });
});

describe('siege (plan §2.1)', () => {
  it('halts at standoff range instead of closing', () => {
    const h = harness();
    const siege = h.mgr.spawn('siege', 40, TOWER_X + 400, TOWER_Y);
    h.run(20);
    const d = Math.hypot(siege.x - TOWER_X, siege.y - TOWER_Y);
    expect(d).toBeGreaterThan(ENEMY_BEHAVIOR.siegeStandoff - 5);
    expect(d).toBeLessThanOrEqual(ENEMY_BEHAVIOR.siegeStandoff + 5);
    expect(siege.siegeHalted).toBe(true);
    expect(siege.attacking).toBe(false);
  });

  it('routes its shell damage through tower_damaged', () => {
    const h = harness();
    const siege = h.mgr.spawn('siege', 40, TOWER_X + ENEMY_BEHAVIOR.siegeStandoff - 10, TOWER_Y);

    // Reload, then flight time.
    h.run(ENEMY_BEHAVIOR.siegeReload + 0.05);
    expect(h.events.some(e => e.name === 'siege_fired')).toBe(true);
    // The shell is in the air: nothing has hit the tower yet.
    expect(h.events.some(e => e.name === 'tower_damaged')).toBe(false);
    expect(h.mgr.hostileShotList.length).toBe(1);

    h.run(ENEMY_BEHAVIOR.siegeShellTravel + 0.05);
    const hit = h.events.find(e => e.name === 'tower_damaged');
    expect(hit).toBeTruthy();
    // Three times its melee damage, per the plan.
    expect(hit!.payload as number)
      .toBeCloseTo(siege.damage * ENEMY_BEHAVIOR.siegeShellDamageMult, 5);
    expect(h.mgr.hostileShotList.length).toBe(0);
    expect(h.events.some(e => e.name === 'siege_impact')).toBe(true);
  });

  it('never stockpiles shells during a long approach', () => {
    const h = harness();
    // Far away for many reload periods, then dropped into range.
    const siege = h.mgr.spawn('siege', 40, TOWER_X + 2000, TOWER_Y);
    h.run(ENEMY_BEHAVIOR.siegeReload * 4);
    expect(h.mgr.hostileShotList.length).toBe(0);
    siege.x = TOWER_X + ENEMY_BEHAVIOR.siegeStandoff - 10;
    h.run(DT * 2);
    expect(h.mgr.hostileShotList.length).toBe(1);
  });

  it('fires on the same cadence at every substep size', () => {
    const counts: number[] = [];
    for (const dt of [1 / 120, 1 / 240, 1 / 60]) {
      const h = harness();
      h.mgr.spawn('siege', 40, TOWER_X + ENEMY_BEHAVIOR.siegeStandoff - 10, TOWER_Y);
      const steps = Math.round(10 / dt);
      for (let i = 0; i < steps; i++) h.mgr.tick(dt, TOWER_X, TOWER_Y);
      counts.push(h.events.filter(e => e.name === 'siege_fired').length);
    }
    expect(new Set(counts).size).toBe(1);
  });
});

describe('verbs for the existing roster (plan §2.2)', () => {
  it('tank body-blocks: a shot never pierces past one', () => {
    const h = harness();
    const tower = makeTower();
    const projectiles = new ProjectileManager(h.bus, tower, h.mgr);
    projectiles.setBounds(ARENA_W, ARENA_H);
    projectiles.setPierceExtra(5);

    const tank = h.mgr.spawn('tank', 40, TOWER_X + 100, TOWER_Y);
    const behind = h.mgr.spawn('normal', 40, TOWER_X + 200, TOWER_Y);
    projectiles.fire(behind, tower.snapshot, {
      rawDamage: 5,
      damageType: 'physical',
      isCrit: false,
      targetId: behind.id,
    });
    for (let i = 0; i < 60; i++) projectiles.tick(DT);

    expect(tank.hp).toBeLessThan(tank.maxHp);
    expect(behind.hp).toBe(behind.maxHp);
  });

  it('still pierces past a non-tank', () => {
    // The mirror of the above, so the block is proven to be about tanks rather
    // than about pierce being broken.
    const h = harness();
    const tower = makeTower();
    const projectiles = new ProjectileManager(h.bus, tower, h.mgr);
    projectiles.setBounds(ARENA_W, ARENA_H);
    projectiles.setPierceExtra(5);

    const front = h.mgr.spawn('normal', 40, TOWER_X + 100, TOWER_Y);
    const behind = h.mgr.spawn('normal', 40, TOWER_X + 200, TOWER_Y);
    projectiles.fire(behind, tower.snapshot, {
      rawDamage: 5,
      damageType: 'physical',
      isCrit: false,
      targetId: behind.id,
    });
    for (let i = 0; i < 60; i++) projectiles.tick(DT);

    expect(front.hp).toBeLessThan(front.maxHp);
    expect(behind.hp).toBeLessThan(behind.maxHp);
  });

  it('healer advances while healthy and flees below 40% HP', () => {
    const h = harness();
    const healer = h.mgr.spawn('healer', 40, TOWER_X + 300, TOWER_Y);

    h.run(1);
    expect(healer.x).toBeLessThan(TOWER_X + 300);
    expect(healer.fleeing).toBeFalsy();

    healer.hp = Math.floor(healer.maxHp * (ENEMY_BEHAVIOR.healerFleeThreshold - 0.05));
    const wounded = healer.x;
    h.run(1);

    expect(healer.fleeing).toBe(true);
    expect(healer.x).toBeGreaterThan(wounded);
  });

  it('healer keeps healing while it retreats', () => {
    // The point of the flee (plan §2.2) is that it does not stop working — a
    // healer that ran away and went quiet would be safe to ignore, which is
    // the behaviour the change is meant to remove.
    const h = harness();
    const healer = h.mgr.spawn('healer', 40, TOWER_X + 300, TOWER_Y);
    const ally = h.mgr.spawn('normal', 40, TOWER_X + 300, TOWER_Y + 10);
    ally.hp = Math.floor(ally.maxHp / 2);
    healer.hp = Math.floor(healer.maxHp * (ENEMY_BEHAVIOR.healerFleeThreshold - 0.05));
    // Both are moving in opposite directions now, so the heal has to land
    // before they separate past `healRange`.
    healer.healCooldown = 0.05;

    const allyHp = ally.hp;
    const wounded = healer.x;
    h.run(0.2);

    expect(healer.fleeing).toBe(true);
    expect(healer.x).toBeGreaterThan(wounded);
    expect(ally.hp).toBeGreaterThan(allyHp);
  });

  it('flying ignores the wall contact band', () => {
    const h = harness();
    h.mgr.setWallContactExtra(36);
    const flier = h.mgr.spawn('flying', 40, TOWER_X + 200, TOWER_Y);
    const walker = h.mgr.spawn('normal', 40, TOWER_X, TOWER_Y + 200);
    h.run(12);

    const flierD = Math.hypot(flier.x - TOWER_X, flier.y - TOWER_Y);
    const walkerD = Math.hypot(walker.x - TOWER_X, walker.y - TOWER_Y);
    expect(flierD).toBeLessThan(walkerD - 20);
  });

  it('blinker also walks through the wall band', () => {
    const h = harness();
    h.mgr.setWallContactExtra(36);
    const blinker = h.mgr.spawn('blinker', 40, TOWER_X + 200, TOWER_Y);
    const walker = h.mgr.spawn('normal', 40, TOWER_X, TOWER_Y + 200);
    h.run(20);
    const blinkerD = Math.hypot(blinker.x - TOWER_X, blinker.y - TOWER_Y);
    const walkerD = Math.hypot(walker.x - TOWER_X, walker.y - TOWER_Y);
    expect(blinkerD).toBeLessThan(walkerD - 20);
  });

  it('splitter children spawn protected, scatter, then rejoin the fight', () => {
    const h = harness();
    const parent = h.mgr.spawn('splitter', 40, TOWER_X + 300, TOWER_Y);
    const child = h.mgr.spawnSplitterChild(parent, 40, parent.x, parent.y, 0);

    expect(isTargetable(child)).toBe(false);
    expect(h.mgr.damage(child, 9999, false)).toBe(false);
    expect(child.alive).toBe(true);

    const x0 = child.x;
    h.run(0.3);
    // Angle 0 is +x, i.e. directly away from the tower at TOWER_X + 300.
    expect(child.x).toBeGreaterThan(x0);

    h.run(ENEMY_BEHAVIOR.splitterSpawnProtection);
    expect(isTargetable(child)).toBe(true);
    expect(h.mgr.damage(child, 9999, false)).toBe(true);
  });

  it('shielded rebuilds a charge only after it has been left alone', () => {
    const h = harness();
    const shielded = h.mgr.spawn('shielded', 40, TOWER_X + 400, TOWER_Y);
    h.mgr.damage(shielded, 10, false);
    h.mgr.damage(shielded, 10, false);
    expect(shielded.shieldCharges).toBe(1);

    // Interrupted before the calm period elapses: nothing comes back.
    h.run(ENEMY_BEHAVIOR.shieldCalmBeforeRegen - 0.5);
    h.mgr.damage(shielded, 10, false);
    expect(shielded.shieldCharges).toBe(0);

    // Left alone: calm period, then one charge per interval.
    h.run(ENEMY_BEHAVIOR.shieldCalmBeforeRegen + ENEMY_BEHAVIOR.shieldRegenInterval + 0.1);
    expect(shielded.shieldCharges).toBe(1);
    h.run(ENEMY_BEHAVIOR.shieldRegenInterval);
    expect(shielded.shieldCharges).toBe(2);
    expect(h.events.filter(e => e.name === 'shield_restored').length).toBe(2);
  });

  it('never rebuilds past the defined charge count', () => {
    const h = harness();
    const shielded = h.mgr.spawn('shielded', 40, TOWER_X + 400, TOWER_Y);
    h.run(60);
    expect(shielded.shieldCharges).toBe(ENEMY_DEFS.shielded.shieldCharges);
  });
});

describe('priority targeting (plan §2.3)', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('prefers warden, then healer, then thief, then siege, then nearest', () => {
    const near = h.mgr.spawn('normal', 40, TOWER_X + 20, TOWER_Y);
    const siege = h.mgr.spawn('siege', 40, TOWER_X + 200, TOWER_Y);
    const thief = h.mgr.spawn('thief', 40, TOWER_X + 210, TOWER_Y);
    const healer = h.mgr.spawn('healer', 40, TOWER_X + 220, TOWER_Y);
    const warden = h.mgr.spawn('warden', 40, TOWER_X + 230, TOWER_Y);
    const tower = makeTower('priority');

    expect(tower.acquireTarget(h.mgr.list)?.id).toBe(warden.id);
    warden.alive = false;
    expect(tower.acquireTarget(h.mgr.list)?.id).toBe(healer.id);
    healer.alive = false;
    expect(tower.acquireTarget(h.mgr.list)?.id).toBe(thief.id);
    thief.alive = false;
    expect(tower.acquireTarget(h.mgr.list)?.id).toBe(siege.id);
    siege.alive = false;
    expect(tower.acquireTarget(h.mgr.list)?.id).toBe(near.id);
  });

  it('picks the nearest of several equally-urgent targets', () => {
    const far = h.mgr.spawn('warden', 40, TOWER_X + 300, TOWER_Y);
    const close = h.mgr.spawn('warden', 40, TOWER_X + 100, TOWER_Y);
    expect(makeTower('priority').acquireTarget(h.mgr.list)?.id).toBe(close.id);
    expect(far.alive).toBe(true);
  });

  it('respects range: an out-of-range warden does not beat an in-range trash mob', () => {
    h.mgr.spawn('warden', 40, TOWER_X + 900, TOWER_Y);
    const inRange = h.mgr.spawn('normal', 40, TOWER_X + 50, TOWER_Y);
    const tower = new Tower({ ...TOWER_BASE, cooldown: 0, range: 200, targetingMode: 'priority' });
    tower.setPosition(TOWER_X, TOWER_Y);
    expect(tower.acquireTarget(h.mgr.list)?.id).toBe(inRange.id);
  });

  it('is the default for a new game', () => {
    expect(TOWER_BASE.targetingMode).toBe('priority');
  });
});

describe('spawn pool (plan §2.4)', () => {
  it('unlocks each behavioural type at its documented wave', () => {
    for (const [type, wave] of [
      ['siege', 25], ['thief', 30], ['blinker', 35], ['warden', 40], ['burrower', 45],
    ] as const) {
      expect(ENEMY_DEFS[type].unlockWave, type).toBe(wave);
      expect(spawnPoolForWave(wave - 1).some(e => e.type === type), type).toBe(false);
      expect(spawnPoolForWave(wave).some(e => e.type === type), type).toBe(true);
    }
  });

  it('never offers the boss through the weighted pool', () => {
    expect(spawnPoolForWave(200).some(e => e.type === 'boss')).toBe(false);
  });

  it('spawns at most one thief per wave', () => {
    const bus = new EventBus();
    const { resources } = makeResources(0);
    const mgr = new EnemyManager(bus, resources);
    const wm = new WaveManager(bus, mgr, ARENA_W, ARENA_H, () => {}, () => {});
    // Enough waves that a 1-in-23 roll landing twice in one wave is otherwise
    // near-certain somewhere in the sample.
    for (let wave = 45; wave < 145; wave++) {
      if (wave % 10 === 0) continue;
      mgr.reset();
      wm.startWave(wave);
      // `startWave` pauses spawning on the 4% mutator-offer roll, and only the
      // modal resumes it. Nothing in a headless harness closes that modal, so
      // without this the test silently spawns nothing one run in twenty-five.
      wm.resumeSpawning();
      for (let i = 0; i < 400 && wm.snapshot.spawning; i++) wm.tick(1);
      const thieves = mgr.list.filter(e => e.type === 'thief').length;
      expect(thieves, `wave ${wave}`).toBeLessThanOrEqual(1);
    }
  });

  it('spawns fast enemies in packs that take slots rather than adding them', () => {
    const bus = new EventBus();
    const { resources } = makeResources(0);
    const mgr = new EnemyManager(bus, resources);
    const wm = new WaveManager(bus, mgr, ARENA_W, ARENA_H, () => {}, () => {});
    wm.startWave(47);
    // See above: the mutator-offer roll pauses spawning until a modal that does
    // not exist here closes it.
    wm.resumeSpawning();
    const target = wm.snapshot.enemiesToSpawn;
    for (let i = 0; i < 500 && wm.snapshot.spawning; i++) wm.tick(1);

    // Never over the wave's budget, whatever the pack rolls did.
    expect(wm.snapshot.enemiesSpawned).toBe(target);
    expect(mgr.list.length).toBe(target);
  });
});
