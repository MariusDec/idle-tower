/**
 * Rocket Barrage (ability revamp, phase 3).
 *
 * Two layers, mirroring how the rest of this suite is cut:
 *
 * - The stat surface (`computeEffectiveStats` / `buildAbilityDisplayText`),
 *   pinned as golden numbers: volley size 6 → ~10 across 15 levels, per-rocket
 *   damage 2x → 5.5x.
 * - The behaviour, driven through the *real* managers at the fixed substep:
 *   splash delivered through `ProjectileManager.applyBlastSplash`, and a full
 *   `tryCast('rocket_barrage')` proving the rockets carry their splash and
 *   sprite tag into flight.
 */

import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import {
  ABILITIES,
  ABILITY_BY_ID,
  buildAbilityDisplayText,
  computeEffectiveStats,
  precisionCritMultiplier,
  vampiricRegen,
} from '../src/data/abilities';
import { world } from '../src/data/arena';
import { TOWER_BASE } from '../src/data/tower';
import type { AbilityId, AbilityState, GameStats, ResourceState } from '../src/types';
import { Tower } from '../src/systems/Tower';
import { EnemyManager } from '../src/systems/EnemyManager';
import { ProjectileManager } from '../src/systems/ProjectileManager';
import { ResourceManager } from '../src/systems/ResourceManager';
import { BuffRegistry } from '../src/stats/BuffRegistry';
import { emptyStatContext, resolveStats } from '../src/stats';
import { AbilityManager } from '../src/systems/AbilityManager';

/** One substep at the game's fixed rate. */
const DT = 1 / 120;
const TOWER_X = world(400);
const TOWER_Y = world(300);
const ARENA_W = world(800);
const ARENA_H = world(600);

describe('rocket_barrage effective stats', () => {
  const def = ABILITY_BY_ID['rocket_barrage'];

  it('grows the volley 6 -> ~10 across its 15 levels', () => {
    const count = (level: number) => computeEffectiveStats(def, level).count!;
    expect(def.maxLevel).toBe(15);
    expect(count(1)).toBeCloseTo(6, 6);
    // 6 + 0.3 * 9
    expect(count(10)).toBeCloseTo(8.7, 6);
    expect(Math.floor(count(10))).toBe(8);
    // 6 + 0.3 * 14
    expect(count(15)).toBeCloseTo(10.2, 6);
    expect(Math.floor(count(15))).toBe(10);
  });

  it('grows per-rocket damage 1.65x -> 4.59x at L15', () => {
    const dmg = (level: number) => computeEffectiveStats(def, level).effectValue;
    expect(dmg(1)).toBe(1.65);
    // 1.65 + 0.21 * 14
    expect(dmg(15)).toBeCloseTo(4.59, 6);
  });

  it('leaves every other ability without a count field', () => {
    for (const a of ABILITIES) {
      if (a.id === 'rocket_barrage') continue;
      expect(computeEffectiveStats(a, 5).count, a.id).toBeUndefined();
    }
  });
});

describe('rocket_barrage display text', () => {
  const def = ABILITY_BY_ID['rocket_barrage'];

  it('carries the floored count and the per-rocket multiplier', () => {
    const l1 = buildAbilityDisplayText(def, 1);
    expect(l1).toContain('Fires 6 homing rockets');
    expect(l1).toContain('deals 1.65x tower damage');

    // L10: count 8.7 floors to 8; damage is 3.54x.
    const l10 = buildAbilityDisplayText(def, 10);
    expect(l10).toContain('Fires 8 homing rockets');
    expect(l10).toContain('deals 3.54x tower damage');
  });

  it('reads as "<count> @ <mult>x" in the tooltip effect slot', () => {
    expect(computeEffectiveStats(def, 1).displayEffectValue).toBe('6 @ 1.65x');
    expect(computeEffectiveStats(def, 15).displayEffectValue).toBe('10 @ 4.59x');
  });
});

// ── phase 4: vampiric aura / precision shot / execute ────────────────────────

describe('precision_shot crit curve (phase 4)', () => {
  const def = ABILITY_BY_ID['precision_shot'];

  it('scales the crit multiplier 1.5x -> 2.4x across its levels', () => {
    expect(precisionCritMultiplier(1)).toBeCloseTo(1.5, 6);
    // 1.5 + 0.1 * 9
    expect(precisionCritMultiplier(10)).toBeCloseTo(2.4, 6);
  });

  it('quotes both numbers the buff actually grants', () => {
    const l1 = buildAbilityDisplayText(def, 1);
    expect(l1).toContain('Boosts crit chance by 30%');
    expect(l1).toContain('multiplies crit damage by 1.5x');

    // L10: chance 30 + 2*9 = 48%, crit mult 2.4x.
    const l10 = buildAbilityDisplayText(def, 10);
    expect(l10).toContain('Boosts crit chance by 48%');
    expect(l10).toContain('multiplies crit damage by 2.4x');
  });
});

describe('vampiric_aura self-sufficiency (phase 4)', () => {
  const def = ABILITY_BY_ID['vampiric_aura'];

  it('grants additive lifesteal 6% -> 24% across its levels', () => {
    const ls = (level: number) => computeEffectiveStats(def, level).effectValue;
    expect(ls(1)).toBeCloseTo(0.06, 6);
    // 0.06 + 0.02 * 9
    expect(ls(10)).toBeCloseTo(0.24, 6);
  });

  it('scales regen from 1%/s to 5.5%/s of max HP', () => {
    expect(vampiricRegen(1)).toBeCloseTo(0.01, 6);
    // 0.01 + 0.005 * 9
    expect(vampiricRegen(10)).toBeCloseTo(0.055, 6);
  });

  it('quotes both percentages at the same level', () => {
    const l1 = buildAbilityDisplayText(def, 1);
    expect(l1).toContain('+6% lifesteal');
    expect(l1).toContain('regenerate 1% max HP per second');

    const l10 = buildAbilityDisplayText(def, 10);
    expect(l10).toContain('+24% lifesteal');
    expect(l10).toContain('regenerate 5.5% max HP per second');
  });

  it('reads as a percentage in the tooltip effect slot', () => {
    expect(computeEffectiveStats(def, 1).displayEffectValue).toBe('+6%');
    expect(computeEffectiveStats(def, 10).displayEffectValue).toBe('+24%');
  });

  /**
   * The whole point of the rework: the old mult-kind buff was x3 of whatever
   * base lifesteal existed — x3 of zero is nothing. Composed through the real
   * pipeline with ONLY the ability buff present, the additive bucket must
   * carry the value alone.
   */
  it('composes an ability-add buff onto a zero base lifesteal', () => {
    const { stats } = resolveStats({
      ...emptyStatContext(),
      buffs: [
        { id: 'ability:lifesteal', stat: 'lifesteal', kind: 'add', value: 0.06, label: 'Vampiric Aura', remaining: null },
      ],
    });
    expect(stats.lifesteal).toBeCloseTo(0.06, 6);
  });
});

describe('execute boss threshold text (phase 4)', () => {
  const def = ABILITY_BY_ID['execute'];

  it('states the boss threshold as half the kill threshold', () => {
    // L1: kills below 12%; bosses take 4.2x below floor(12/2) = 6%.
    expect(buildAbilityDisplayText(def, 1)).toContain('Bosses below 6% HP take 4.2x damage');
    // L10: kills below 30%; bosses below floor(30/2) = 15%.
    expect(buildAbilityDisplayText(def, 10)).toContain('Bosses below 15% HP take 4.2x damage');
  });
});

// ── behavioural ──────────────────────────────────────────────────────────────

interface Harness {
  bus: EventBus;
  enemies: EnemyManager;
  tower: Tower;
  projectiles: ProjectileManager;
  resources: ResourceManager;
  events: Array<{ name: string; payload: unknown }>;
}

function makeResources(gold: number, mana: number, bus: EventBus): ResourceManager {
  const state: ResourceState = {
    gold,
    mana,
    maxMana: Math.max(100, mana),
    manaRegen: 0,
    ascensionPoints: 0,
    apThisTranscendence: 0,
    transcendencePoints: 0,
    lifetimeAP: 0,
    lifetimeGold: 0,
  };
  const stats = { goldEarned: 0 } as unknown as GameStats;
  return new ResourceManager(state, stats, bus);
}

/** A tower with enough range to see the whole arena and a readable damage figure. */
function makeTower(): Tower {
  const tower = new Tower({ ...TOWER_BASE, baseDamage: 10, cooldown: 0, range: 2000 });
  tower.setPosition(TOWER_X, TOWER_Y);
  return tower;
}

function harness(): Harness {
  const bus = new EventBus();
  const resources = makeResources(10_000, 1000, bus);
  const enemies = new EnemyManager(bus, resources);
  enemies.setBounds(ARENA_W, ARENA_H);
  enemies.beginWave(40);
  const tower = makeTower();
  const projectiles = new ProjectileManager(bus, tower, enemies);
  projectiles.setBounds(ARENA_W, ARENA_H);
  const events: Array<{ name: string; payload: unknown }> = [];
  for (const name of ['rockets_fired', 'projectile_exploded']) {
    bus.on(name, (payload) => events.push({ name, payload }));
  }
  return { bus, enemies, tower, projectiles, resources, events };
}

/** Big enough HP pools that nothing dies mid-assertion. */
function beefUp(...enemies: Array<{ maxHp: number; hp: number }>): void {
  for (const e of enemies) {
    e.maxHp = 1e9;
    e.hp = 1e9;
  }
}

/** Tick projectiles until none are left alive (or a generous ceiling passes). */
function runUntilSettled(projectiles: ProjectileManager, maxSeconds = 5): void {
  const steps = Math.round(maxSeconds / DT);
  for (let i = 0; i < steps && projectiles.list.some(p => p.alive); i++) {
    projectiles.tick(DT);
  }
}

function makeAbilityManager(h: Harness, rocketLevel: number): AbilityManager {
  const states = {} as Record<AbilityId, AbilityState>;
  for (const def of ABILITIES) {
    states[def.id] = {
      level: def.id === 'rocket_barrage' ? rocketLevel : 1,
      cooldown: 0,
      active: false,
      activeTimer: 0,
      xp: 0,
    };
  }
  return new AbilityManager({
    resources: h.resources,
    enemies: h.enemies,
    tower: h.tower,
    bus: h.bus,
    projectileManager: h.projectiles,
    buffs: new BuffRegistry(),
    getState: (id) => states[id],
    onCast: () => {},
  });
}

describe('splash plumbing (ProjectileManager)', () => {
  it('deals everything else in the blast a fraction of the landed hit', () => {
    const h = harness();
    // B sits just past A along the shot line, inside the blast but out of the
    // bolt's way — a non-piercing shot stops on A, so whatever B loses is splash.
    const a = h.enemies.spawn('normal', 40, TOWER_X + world(150), TOWER_Y);
    const b = h.enemies.spawn('normal', 40, TOWER_X + world(170), TOWER_Y);
    beefUp(a, b);

    h.projectiles.fire(a, h.tower.snapshot, {
      rawDamage: 1000,
      damageType: 'physical',
      isCrit: false,
      targetId: a.id,
      splashRadius: world(60),
      splashFraction: 0.5,
    });
    runUntilSettled(h.projectiles);

    const lossA = 1e9 - a.hp;
    const lossB = 1e9 - b.hp;
    expect(lossA).toBeGreaterThan(0);
    // `applyBlastSplash` takes floor(hp lost by the struck enemy x fraction).
    expect(lossB).toBe(Math.max(1, Math.floor(lossA * 0.5)));
    const exploded = h.events.find(e => e.name === 'projectile_exploded');
    expect(exploded).toBeTruthy();
    expect((exploded!.payload as { radius: number }).radius).toBe(world(60));
  });

  it('leaves enemies outside the blast radius untouched', () => {
    const h = harness();
    const a = h.enemies.spawn('normal', 40, TOWER_X + world(150), TOWER_Y);
    const far = h.enemies.spawn('normal', 40, TOWER_X + world(400), TOWER_Y);
    beefUp(a, far);

    h.projectiles.fire(a, h.tower.snapshot, {
      rawDamage: 1000,
      damageType: 'physical',
      isCrit: false,
      targetId: a.id,
      splashRadius: world(60),
      splashFraction: 0.5,
    });
    runUntilSettled(h.projectiles);

    expect(1e9 - a.hp).toBeGreaterThan(0);
    expect(far.hp).toBe(1e9);
  });
});

describe('Rocket Barrage through tryCast', () => {
  it('fires six L1 rockets that home, carry splash, and draw as rockets', () => {
    const h = harness();
    const a = h.enemies.spawn('normal', 40, TOWER_X + world(200), TOWER_Y);
    const b = h.enemies.spawn('normal', 40, TOWER_X + world(260), TOWER_Y);
    beefUp(a, b);
    const abilities = makeAbilityManager(h, 1);

    expect(abilities.tryCast('rocket_barrage', 40)).toBe(true);

    expect(h.projectiles.list.length).toBe(6);
    for (const p of h.projectiles.list) {
      expect(p.visual).toBe('rocket');
      expect(p.homingTargetId).toBeDefined();
      expect(p.turnRate).toBe(Math.PI * 3);
      expect(p.lifetime).toBe(3);
      expect(p.splashRadius).toBe(world(60));
      expect(p.splashFraction).toBe(0.5);
    }
    // Distinct-first: two enemies on the field, so both are targeted before
    // the extra rockets double up at random.
    const targets = new Set(h.projectiles.list.map(p => p.homingTargetId));
    expect(targets.has(a.id)).toBe(true);
    expect(targets.has(b.id)).toBe(true);

    const fired = h.events.find(e => e.name === 'rockets_fired')!.payload as {
      count: number;
      totalDamage: number;
    };
    expect(fired.count).toBe(6);
    // 6 rockets x baseDamage 10 x mult 1.65.
    expect(fired.totalDamage).toBeCloseTo(99, 6);
  });

  it('floors the count: an L15 cast fires ten rockets', () => {
    const h = harness();
    h.enemies.spawn('normal', 40, TOWER_X + world(200), TOWER_Y);
    const abilities = makeAbilityManager(h, 15);

    expect(abilities.tryCast('rocket_barrage', 40)).toBe(true);
    expect(h.projectiles.list.length).toBe(10);
  });

  it('delivers damage and splash through the full flight path', () => {
    const h = harness();
    const a = h.enemies.spawn('normal', 40, TOWER_X + world(150), TOWER_Y);
    const b = h.enemies.spawn('normal', 40, TOWER_X + world(170), TOWER_Y);
    beefUp(a, b);
    const abilities = makeAbilityManager(h, 1);

    abilities.tryCast('rocket_barrage', 40);
    runUntilSettled(h.projectiles);

    // Everything resolved, everyone got hit, and at least one rocket popped
    // its ring event for the decorative shockwave.
    expect(h.projectiles.list.length).toBe(0);
    expect(a.hp).toBeLessThan(1e9);
    expect(b.hp).toBeLessThan(1e9);
    expect(h.events.some(e => e.name === 'projectile_exploded')).toBe(true);
  });

  it('duds into a radial spread with no splash on an empty field', () => {
    const h = harness(); // no enemies spawned
    const abilities = makeAbilityManager(h, 1);

    expect(abilities.tryCast('rocket_barrage', 40)).toBe(true);

    expect(h.projectiles.list.length).toBe(6);
    for (const p of h.projectiles.list) {
      expect(p.visual).toBe('rocket');
      expect(p.homingTargetId).toBeUndefined();
      expect(p.splashRadius).toBeUndefined();
    }
    const fired = h.events.find(e => e.name === 'rockets_fired')!.payload as {
      count: number;
      totalDamage: number;
    };
    expect(fired.count).toBe(6);
    expect(fired.totalDamage).toBeCloseTo(99, 6);

    // And they still retire rather than circling forever (plan §5.5).
    runUntilSettled(h.projectiles);
    expect(h.projectiles.list.length).toBe(0);
  });
});
