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
  abilityManaCost,
  buildAbilityDisplayText,
  computeEffectiveStats,
  precisionCritMultiplier,
  vampiricRegen,
  type AbilityDef,
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
import { renderAbilityTooltip } from '../src/ui/abilityFormat';

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

  it('scales the crit multiplier 1.5x -> 2.85x across its levels', () => {
    expect(precisionCritMultiplier(1)).toBeCloseTo(1.5, 6);
    // 1.5 + 0.15 * 9
    expect(precisionCritMultiplier(10)).toBeCloseTo(2.85, 6);
  });

  it('quotes both numbers the buff actually grants', () => {
    const l1 = buildAbilityDisplayText(def, 1);
    expect(l1).toContain('Boosts crit chance by 30%');
    expect(l1).toContain('multiplies crit damage by 1.5x');

    // L10: chance 30 + 3*9 = 57%, crit mult 2.85x.
    const l10 = buildAbilityDisplayText(def, 10);
    expect(l10).toContain('Boosts crit chance by 57%');
    expect(l10).toContain('multiplies crit damage by 2.85x');
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

  it('states the boss threshold as half the kill threshold and boss damage as a fraction of max HP', () => {
    // L1: kills below 12%; bosses lose 5% of max HP below floor(12/2) = 6%.
    expect(buildAbilityDisplayText(def, 1)).toContain('Bosses below 6% HP lose 5% of their max HP');
    // L10: kills below 30%; bosses below floor(30/2) = 15%; boss loss 5 + 0.8*9 = 12.2%.
    expect(buildAbilityDisplayText(def, 10)).toContain('Bosses below 15% HP lose 12.2% of their max HP');
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

interface AbilityHarness {
  abilities: AbilityManager;
  buffs: BuffRegistry;
  magnetCalls: boolean[];
  setLevels: (overrides: Partial<Record<AbilityId, number>>) => void;
}

/**
 * Build an AbilityManager wired to the harness, and surface the bits the
 * new Phase-5 cases need to inspect: the shared BuffRegistry (so a frost-nova
 * case can read back the brittle buff), the Gold Rush magnet callback (so a
 * gold-rush case can assert it fired), and a levels-mutator (so cases that
 * need a specific ability at level N can override without re-wiring the
 * whole fixture).
 */
function makeAbilityManager(h: Harness, rocketLevel: number = 1): AbilityHarness {
  const states = {} as Record<AbilityId, AbilityState>;
  const buffs = new BuffRegistry();
  const magnetCalls: boolean[] = [];
  for (const def of ABILITIES) {
    states[def.id] = {
      level: def.id === 'rocket_barrage' ? rocketLevel : 1,
      cooldown: 0,
      active: false,
      activeTimer: 0,
      xp: 0,
    };
  }
  const setLevels = (overrides: Partial<Record<AbilityId, number>>): void => {
    for (const [id, level] of Object.entries(overrides)) {
      const sid = id as AbilityId;
      if (states[sid]) states[sid].level = level;
    }
  };
  const abilities = new AbilityManager({
    resources: h.resources,
    enemies: h.enemies,
    tower: h.tower,
    bus: h.bus,
    projectileManager: h.projectiles,
    buffs,
    getState: (id) => states[id],
    onCast: () => {},
    setGoldRushMagnet: (on) => magnetCalls.push(on),
  });
  return { abilities, buffs, magnetCalls, setLevels };
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
    const { abilities } = makeAbilityManager(h, 1);

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
    const { abilities } = makeAbilityManager(h, 15);

    expect(abilities.tryCast('rocket_barrage', 40)).toBe(true);
    expect(h.projectiles.list.length).toBe(10);
  });

  it('delivers damage and splash through the full flight path', () => {
    const h = harness();
    const a = h.enemies.spawn('normal', 40, TOWER_X + world(150), TOWER_Y);
    const b = h.enemies.spawn('normal', 40, TOWER_X + world(170), TOWER_Y);
    beefUp(a, b);
    const { abilities } = makeAbilityManager(h, 1);

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
    const { abilities } = makeAbilityManager(h, 1);

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

// ── phase 5: abilities plan §I.1 ───────────────────────────────────────────

import {
  BUFF_FROST_BRITTLE,
  GLOBAL_NOVA_SLOW,
  METEOR_SPLASH_FRACTION,
  PLACEMENT_FOCUS_DAMAGE_BONUS,
  frostBrittle,
  placementRadius,
} from '../src/data/abilities';

describe('ability disc scales with level and the area stat', () => {
  it('placementRadius grows linearly and clamps at maxLevel', () => {
    const rain = ABILITY_BY_ID['rain_of_arrows'];
    expect(placementRadius('rain_of_arrows', 1)).toBe(rain.areaRadius!);
    expect(placementRadius('rain_of_arrows', 10)).toBe(
      rain.areaRadius! + (rain.areaRadiusPerLevel ?? 0) * 9,
    );
    // Over-level inputs clamp to maxLevel (10), so a level-99 disc equals L10.
    expect(placementRadius('rain_of_arrows', 99)).toBe(
      placementRadius('rain_of_arrows', 10),
    );
  });

  it('getEffectiveRadius multiplies by the area stat and clamps to [0.5, 3]', () => {
    const h = harness();
    const { abilities } = makeAbilityManager(h, 1);
    // Base: the area stat is 1, so the disc is exactly placementRadius.
    expect(abilities.getEffectiveRadius('rain_of_arrows')).toBe(
      placementRadius('rain_of_arrows', 1),
    );
    // +50% area stat → 1.5x disc.
    abilities.setAreaMultiplier(1.5);
    expect(abilities.getEffectiveRadius('rain_of_arrows')).toBeCloseTo(
      placementRadius('rain_of_arrows', 1) * 1.5,
      6,
    );
    // The clamp caps both ends — the table already bounds via contributors,
    // but the manager's own setter defends against bad input.
    abilities.setAreaMultiplier(99);
    expect(abilities.getEffectiveRadius('rain_of_arrows')).toBeCloseTo(
      placementRadius('rain_of_arrows', 1) * 3,
      6,
    );
    abilities.setAreaMultiplier(0.01);
    expect(abilities.getEffectiveRadius('rain_of_arrows')).toBeCloseTo(
      placementRadius('rain_of_arrows', 1) * 0.5,
      6,
    );
  });
});

describe('disc-scoped effects (plan §D.3, §D.4, §D.7)', () => {
  /** Damage a Rain of Arrows cast at `point` deals to a single enemy there. */
  function rainDamageAt(point: { x: number; y: number }, placement: 'focused' | 'auto'): number {
    const h = harness();
    const inside = h.enemies.spawn('normal', 60, point.x, point.y);
    beefUp(inside);
    const { abilities } = makeAbilityManager(h, 1);
    abilities.tryCast('rain_of_arrows', 60, placement === 'focused' ? point : 'auto');
    return 1e9 - inside.hp;
  }

  it('Rain of Arrows is disc-scoped: only the in-disc enemy loses HP', () => {
    const h = harness();
    // Place the inside enemy right next to the tower so the L1 disc covers it.
    const inside = h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);
    const outside = h.enemies.spawn('normal', 60, TOWER_X + world(2000), TOWER_Y);
    beefUp(inside, outside);
    const { abilities } = makeAbilityManager(h, 1);

    abilities.tryCast('rain_of_arrows', 60, { x: TOWER_X + world(50), y: TOWER_Y });

    expect(1e9 - inside.hp).toBeGreaterThan(0);
    expect(outside.hp).toBe(1e9);
  });

  it('Rain of Arrows focus bonus applies to the whole disc, not a sub-disc', () => {
    const point = { x: TOWER_X + world(50), y: TOWER_Y };
    // Same enemy setup, same point — the only variable is the placement
    // type, which controls the focus bonus on the *whole* cast.
    const focused = rainDamageAt(point, 'focused');
    const auto = rainDamageAt(point, 'auto');
    // The auto-placer may pick the same point (it's the only cluster), but
    // its cast carries no focus bonus — so the placed cast is exactly
    // stronger by the bonus across the whole disc.
    expect(focused).toBeGreaterThan(auto);
    expect(focused / auto).toBeCloseTo(1 + PLACEMENT_FOCUS_DAMAGE_BONUS, 1);
  });

  it('Meteor splash is a fraction of the heavy hit, not a multiple', () => {
    const h = harness();
    const target = h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);
    const inCrater = h.enemies.spawn('normal', 60, TOWER_X + world(55), TOWER_Y);
    // Target has more HP than the splash target — target must be picked.
    target.maxHp = 1e9;
    target.hp = 1e9;
    inCrater.maxHp = 1e9 / 2;
    inCrater.hp = 1e9 / 2;
    const { abilities } = makeAbilityManager(h, 1);
    abilities.tryCast('meteor_strike', 60, { x: TOWER_X + world(50), y: TOWER_Y });

    const targetLoss = 1e9 - target.hp;
    const splashLoss = 1e9 / 2 - inCrater.hp;
    expect(targetLoss).toBeGreaterThan(0);
    expect(splashLoss).toBeGreaterThan(0);
    expect(splashLoss).toBeCloseTo(targetLoss * METEOR_SPLASH_FRACTION, 0);
  });

  it('Meteor picks the highest-HP enemy in the crater, not the nearest', () => {
    const h = harness();
    const near = h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);
    const far = h.enemies.spawn('normal', 60, TOWER_X + world(80), TOWER_Y);
    // Far has more HP — that is the target the description promises to smash.
    near.maxHp = 1e9;
    near.hp = 1e9;
    far.maxHp = 2e9;
    far.hp = 2e9;
    const { abilities } = makeAbilityManager(h, 1);
    abilities.tryCast('meteor_strike', 60, { x: TOWER_X + world(60), y: TOWER_Y });

    // The higher-HP enemy (far) takes the heavy hit; the lower-HP enemy (near)
    // only takes the splash, which is 0.55x the heavy.
    const nearLoss = 1e9 - near.hp;
    const farLoss = 2e9 - far.hp;
    expect(farLoss).toBeGreaterThan(nearLoss);
    // The splash fraction exactly pins near's loss vs far's.
    expect(nearLoss / farLoss).toBeCloseTo(METEOR_SPLASH_FRACTION, 1);
  });

  it('Meteor does not crash when the crater kills mid-iteration', () => {
    const h = harness();
    // Five 1-HP enemies inside the crater: the heavy hit kills the target
    // before the splash loop starts iterating. The re-entrancy guard must
    // copy the query result into a fresh array first.
    const swarm = [];
    for (let i = 0; i < 5; i++) {
      swarm.push(h.enemies.spawn('normal', 60, TOWER_X + world(50) + i * 10, TOWER_Y));
      swarm[i].maxHp = 1;
      swarm[i].hp = 1;
    }
    const { abilities } = makeAbilityManager(h, 1);

    expect(() =>
      abilities.tryCast('meteor_strike', 60, { x: TOWER_X + world(55), y: TOWER_Y }),
    ).not.toThrow();

    for (const e of swarm) expect(e.hp).toBeLessThanOrEqual(0);
  });
});

describe('execute: percent of max HP, no resists', () => {
  it('Execute takes a fraction of boss max HP, scaling with level', () => {
    const h = harness();
    const boss = h.enemies.spawn('boss', 60, TOWER_X + world(50), TOWER_Y);
    boss.maxHp = 1e6;
    // L1 gate is 6%; sit at 5% so the cast triggers. Leave enough HP that
    // the `Math.min(e.hp, ...)` cap inside applyExecute does not clip the
    // expected damage.
    boss.hp = 0.05 * 1e6;   // = 50_000, above the 6% gate
    const { abilities } = makeAbilityManager(h, 1);
    const before = boss.hp;

    expect(abilities.tryCast('execute', 60)).toBe(true);

    const expectedLoss = 1e6 * 0.05;          // EXECUTE_BOSS_MAXHP_FRACTION at L1
    expect(before - boss.hp).toBeCloseTo(expectedLoss, 0);

    // L10: gate 15%, fraction 5% + 0.8% * 9 = 12.2%.
    const boss2 = h.enemies.spawn('boss', 60, TOWER_X + world(50), TOWER_Y);
    boss2.maxHp = 1e6;
    boss2.hp = 0.14 * 1e6;   // = 140_000, above the 15% gate
    const a2 = makeAbilityManager(h, 1);
    a2.setLevels({ execute: 10 });
    const before2 = boss2.hp;
    expect(a2.abilities.tryCast('execute', 60)).toBe(true);
    expect(before2 - boss2.hp).toBeCloseTo(1e6 * 0.122, 1);
  });

  it('Execute ignores boss magicResist — a full-resist boss still takes the execute', () => {
    const h = harness();
    const boss = h.enemies.spawn('boss', 60, TOWER_X + world(50), TOWER_Y);
    boss.maxHp = 1e6;
    boss.hp = 0.05 * 1e6;
    boss.magicResist = 0.99;   // would zero out a magic hit through applyResists
    const { abilities } = makeAbilityManager(h, 1);
    const before = boss.hp;

    expect(abilities.tryCast('execute', 60)).toBe(true);

    // Apply Resists would reduce 5% of max HP to a rounding error; Execute
    // must take the full fraction regardless.
    expect(before - boss.hp).toBeCloseTo(1e6 * 0.05, 0);
  });
});

describe('frost nova: global slow + brittle buff', () => {
  it('sets the brittle buff on cast and clears it on expiry', () => {
    const h = harness();
    h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);   // inside disc
    const { abilities, buffs } = makeAbilityManager(h, 1);

    expect(abilities.tryCast('frost_nova', 60, { x: TOWER_X + world(50), y: TOWER_Y })).toBe(true);

    const entry = buffs.entries.find((e) => e.id === BUFF_FROST_BRITTLE);
    expect(entry).toBeTruthy();
    expect(entry!.stat).toBe('chilledDamageBonus');
    expect(entry!.value).toBeCloseTo(frostBrittle(1), 6);

    // Frost Nova's duration is 5s; tick AbilityManager past it and the
    // buff clears through clearEffect (the buff itself is `remaining: null`
    // because the lifetime is owned by AbilityManager.activeTimer, not the
    // registry's per-buff countdown — a registry-level tick wouldn't expire
    // it).
    abilities.tick(6);
    expect(buffs.has(BUFF_FROST_BRITTLE)).toBe(false);
  });

  it('still slows every enemy globally, not just those inside the disc', () => {
    const h = harness();
    // Far enemy is well outside the disc but should still be slowed: the
    // global floor (§D.6 layer 1) is what makes Frost Nova a panic button.
    const far = h.enemies.spawn('normal', 60, TOWER_X + world(800), TOWER_Y);
    h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);   // in-disc
    const { abilities } = makeAbilityManager(h, 1);

    expect(abilities.tryCast('frost_nova', 60, { x: TOWER_X + world(50), y: TOWER_Y })).toBe(true);

    // GLOBAL_NOVA_SLOW is 0.85: the global slow factor means far is slowed
    // even though it is well outside the placed disc.
    expect(h.enemies.isSlowed(far)).toBe(true);
    // Sanity: the constant is what we think it is.
    expect(GLOBAL_NOVA_SLOW).toBe(0.85);
  });
});

describe('chain lightning: seeds at the placed point', () => {
  it('seeds at the placed point, not the tower', () => {
    const h = harness();
    // Two distinct clusters. The placed point sits over the far cluster;
    // the chain must start there, so the near cluster is untouched.
    const near = [];
    for (let i = 0; i < 3; i++) {
      near.push(h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y + i * 10));
    }
    const far = [];
    for (let i = 0; i < 3; i++) {
      far.push(h.enemies.spawn('normal', 60, TOWER_X + world(500), TOWER_Y + i * 10));
    }
    beefUp(...near, ...far);
    const { abilities } = makeAbilityManager(h, 1);

    abilities.tryCast('chain_lightning', 60, { x: TOWER_X + world(500), y: TOWER_Y + 10 });

    // Far cluster lost HP, near cluster did not.
    expect(far.some((e) => e.hp < 1e9)).toBe(true);
    expect(near.every((e) => e.hp === 1e9)).toBe(true);
  });
});

describe('auto-cast conditions (plan §F.2)', () => {
  it('rain_of_arrows refuses on a sparse field, accepts on a dense one', () => {
    const sparse = harness();
    sparse.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);
    sparse.enemies.spawn('normal', 60, TOWER_X + world(60), TOWER_Y);
    const { abilities: sparseAb } = makeAbilityManager(sparse, 1);
    // Plan §D.2: rain_of_arrows requires minInDisc: 3. Two enemies fails it.
    expect(sparseAb.autoCastConditionMet('rain_of_arrows')).toBe(false);

    const dense = harness();
    for (let i = 0; i < 5; i++) {
      dense.enemies.spawn('normal', 60, TOWER_X + world(50) + i * 10, TOWER_Y);
    }
    const { abilities: denseAb } = makeAbilityManager(dense, 1);
    expect(denseAb.autoCastConditionMet('rain_of_arrows')).toBe(true);
  });

  it('vampiric_aura refuses at full tower HP, accepts below 75%', () => {
    const full = harness();
    // Give the tower some HP so the condition has a real fraction to read.
    full.tower.snapshot.maxHp = 1000;
    full.tower.snapshot.hp = 1000;
    const { abilities: fullAb } = makeAbilityManager(full, 1);
    expect(fullAb.autoCastConditionMet('vampiric_aura')).toBe(false);

    const low = harness();
    low.tower.snapshot.maxHp = 1000;
    low.tower.snapshot.hp = 500;   // 50% of max — below the 75% gate
    const { abilities: lowAb } = makeAbilityManager(low, 1);
    expect(lowAb.autoCastConditionMet('vampiric_aura')).toBe(true);
  });

  it('a manual cast bypasses every condition — even on a sparse field', () => {
    const h = harness();
    h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);
    const { abilities } = makeAbilityManager(h, 1);
    // autoCastConditionMet would say no, but tryCast must succeed anyway
    // (plan §F.3) — a player who pressed the key gets the cast, full stop.
    expect(abilities.autoCastConditionMet('rain_of_arrows')).toBe(false);
    expect(abilities.tryCast('rain_of_arrows', 60, { x: TOWER_X + world(50), y: TOWER_Y })).toBe(true);
  });
});

describe('gold rush toggles the loot magnet (plan §D.9)', () => {
  it('flips the magnet dep on cast and clears it on expiry', () => {
    const h = harness();
    const { abilities, magnetCalls } = makeAbilityManager(h, 1);

    expect(abilities.tryCast('gold_rush', 60)).toBe(true);
    expect(magnetCalls).toEqual([true]);

    // Tick the buff past its duration to fire the clearEffect hook.
    abilities.tick(20);
    expect(magnetCalls).toEqual([true, false]);
  });
});

// ── plan §9.5: mana curve is flat enough, power curve clears it ──────────────

/**
 * Power at L1 and Lmax, in the form the §6.3 ratio uses.
 *
 * - `aoe_damage` / `chain_damage` / `single_target_damage` / `execute_damage`:
 *   `effectValue` (damage multiplier).
 * - `rocket_barrage`: `effectValue × count` (per-rocket damage × volley size).
 * - `crit_buff` / `fire_rate_buff` / `gold_buff` / `lifesteal_buff`: the buff
 *   value × duration (the buff is what the player actually pays for, and the
 *   duration is what makes it worth paying for).
 * - `slow`: `(1 - effectValue) × duration`. `effectValue` is the *speed*
 *   factor, so the slow fraction (1 - effectValue) is what gets stronger per
 *   level — multiplying by duration accounts for the longer-lived slow the
 *   level growth also buys.
 */
function powerRatio(def: AbilityDef): number {
  const l1 = computeEffectiveStats(def, 1);
  const lmax = computeEffectiveStats(def, def.maxLevel);
  if (def.effectType === 'slow') {
    return ((1 - lmax.effectValue) * lmax.duration) / ((1 - l1.effectValue) * l1.duration);
  }
  if (def.effectType === 'rocket_barrage') {
    return (lmax.effectValue * (lmax.count ?? 1)) / (l1.effectValue * (l1.count ?? 1));
  }
  if (
    def.effectType === 'crit_buff'
    || def.effectType === 'fire_rate_buff'
    || def.effectType === 'gold_buff'
    || def.effectType === 'lifesteal_buff'
  ) {
    return (lmax.effectValue * lmax.duration) / (l1.effectValue * l1.duration);
  }
  return lmax.effectValue / l1.effectValue;
}

function manaRatio(def: AbilityDef): number {
  return abilityManaCost(def, def.maxLevel) / def.manaCost;
}

describe('ability mana curve stays under the power curve (plan §6.2)', () => {
  // §6.2 shipped 5% per level, which read as too flat in play; the growth is
  // now 8%. A 10-level ability ends at 1.72x base cost, the 15-level Rocket
  // Barrage at 2.11x. The whole roster must land in that band — still short
  // of the pre-§6.2 1.8x-2.5x curve that outran the power gained.
  for (const def of ABILITIES) {
    it(`${def.id} mana-cost ratio sits between 1.7 and 2.15`, () => {
      const ratio = manaRatio(def);
      expect(ratio).toBeGreaterThanOrEqual(1.7);
      expect(ratio).toBeLessThanOrEqual(2.15);
    });
  }

  it('rocket_barrage specifically lands near the 2.12 cap (15 levels)', () => {
    // 45 × (1 + 0.08 × 14) = 95.4, rounded to 95, so the realised ratio is
    // 95/45 = 2.111... — close to but not exactly the 2.12 we wrote down.
    const def = ABILITY_BY_ID['rocket_barrage'];
    expect(manaRatio(def)).toBeCloseTo(1 + 0.08 * 14, 1);
  });
});

describe('levelling pays for itself (plan §6.3 / §9.5)', () => {
  // Floor is Berserk at 1.16 (§6.3 "After" table). Every other ability must
  // come out above the §9.5 > 1.1 threshold, with plenty of margin for the
  // four abilities whose power curves were also raised.
  for (const def of ABILITIES) {
    it(`${def.id} power/mana ratio exceeds 1.1 across the full ladder`, () => {
      const ratio = powerRatio(def) / manaRatio(def);
      expect(ratio).toBeGreaterThan(1.1);
    });
  }
});

describe('renderAbilityTooltip (plan §7.4 / §7.2)', () => {
  // The tooltip is the player's primary readout for what each ability does
  // and what it costs to upgrade. Two regressions the suite is here to
  // prevent:
  //
  //   1. Instants (duration === 0 at L1 AND durationPerLevel === 0) used to
  //      print a "Duration: 0.0s → 0.0s" row that lied about whether the
  //      ability had a window at all.
  //   2. The arrow column used to point at numbers that the cast would never
  //      actually cost (raw per-def table values, ignoring the player's
  //      multipliers). The manager-sourced `next` fixes that — but the suite
  //      pins the visible contract: maxed → no arrow, not-maxed → arrow.
  //
  // Both cases are checked against `renderAbilityTooltip` directly with a
  // minimal context. The DOM is downstream of this string, and the
  // hover/panel/popover all share the renderer.

  /** Abilities whose window is zero at every level — they hit, then they're done. */
  const INSTANTS: AbilityId[] = [
    'rain_of_arrows',
    'chain_lightning',
    'meteor_strike',
    'execute',
    'rocket_barrage',
  ];

  for (const id of INSTANTS) {
    it(`${id} (instant) omits the Duration row`, () => {
      const def = ABILITY_BY_ID[id];
      const stats = computeEffectiveStats(def, 1);
      const next = computeEffectiveStats(def, 2);
      const html = renderAbilityTooltip(def, {
        stats,
        next,
        cost: 100,
        canAfford: true,
        showCost: true,
        towerDamage: 100,
        xp: 0,
        xpNeeded: 0,
      });
      expect(html).not.toContain('>Duration<');
    });
  }

  it('emits the arrow column when next is present and omits it when maxed', () => {
    const def = ABILITY_BY_ID['rain_of_arrows'];
    const stats = computeEffectiveStats(def, 1);
    const next = computeEffectiveStats(def, 2);

    const withNext = renderAbilityTooltip(def, {
      stats,
      next,
      cost: 100,
      canAfford: true,
      showCost: true,
      towerDamage: 100,
      xp: 0,
      xpNeeded: 0,
    });
    expect(withNext).toContain('→');

    const maxed = renderAbilityTooltip(def, {
      stats: computeEffectiveStats(def, def.maxLevel),
      next: null,
      cost: 0,
      canAfford: false,
      showCost: true,
      towerDamage: 100,
      xp: 0,
      xpNeeded: 0,
    });
    expect(maxed).not.toContain('→');
  });
});
