/**
 * Projectile travel, collision and lifetime (plan §1.6, §5.5).
 *
 * Swept collision (Part 1) and the hard lifetime cap (Part 5) both change what
 * happens to a projectile between two frames, which is exactly the code the
 * fixed-timestep work in §5.2 alters the step size of. These pin the behaviour
 * at every step size the game can produce.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import { Tower } from '../src/systems/Tower';
import { EnemyManager } from '../src/systems/EnemyManager';
import { ResourceManager } from '../src/systems/ResourceManager';
import { ProjectileManager } from '../src/systems/ProjectileManager';
import { PrestigeManager } from '../src/systems/PrestigeManager';
import { PROJECTILE_SPEED } from '../src/data/tower';
import { CORE_TUNING } from '../src/data/cores';
import {
  PRESTIGE_PROJECTILE_TUNING,
  SPLASH_FRACTION_CAP,
  TP_AOE_SPLASH_RADIUS,
  composeShotSplash,
} from '../src/data/prestige';
import type { GameStats, PrestigeState, ResourceState, TowerState } from '../src/types';

function harness() {
  const bus = new EventBus();
  const resources: ResourceState = {
    gold: 0, lifetimeGold: 0, mana: 0, maxMana: 100, manaRegen: 0,
    ascensionPoints: 0, lifetimeAP: 0, apThisTranscendence: 0, transcendencePoints: 0,
  } as unknown as ResourceState;
  const stats = { goldEarned: 0, enemiesKilled: 0 } as unknown as GameStats;
  const resourceMgr = new ResourceManager(resources, stats, bus);
  const enemies = new EnemyManager(bus, resourceMgr);
  const towerState = {
    x: 100, y: 300, hp: 100, maxHp: 100, baseDamage: 1e9, fireRate: 1, range: 2000,
    critChance: 0, critMultiplier: 1, healthRegen: 0, damageType: 'physical',
    knockbackForce: 0,
  } as unknown as TowerState;
  const tower = new Tower(towerState);
  const projectiles = new ProjectileManager(bus, tower, enemies);
  projectiles.setBounds(1280, 720);
  return { bus, enemies, tower, towerState, projectiles };
}

describe('swept collision (plan §1.6)', () => {
  /**
   * A projectile that starts short of an enemy and ends up well past it must
   * still hit. The point-in-circle test this replaced missed every one of
   * these, which is why raising the game speed used to cost DPS.
   */
  it.each([0.0167, 0.05, 0.108, 0.325])('hits an enemy it overshoots at dt=%s', (dt) => {
    const { enemies, towerState, projectiles } = harness();
    const enemy = enemies.spawn('normal', 1, 400, 300);
    const hpBefore = enemy.hp;

    projectiles.fire(enemy, towerState, {
      rawDamage: 1e9, damageType: 'physical', isCrit: false, targetId: enemy.id,
    });
    // Place the shot just short of the target so one step carries it past.
    const p = projectiles.list[0];
    p.x = enemy.x - 25;
    p.y = enemy.y;

    projectiles.tick(dt);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('hits the first enemy along the path, not the first in the array', () => {
    const { enemies, towerState, projectiles } = harness();
    const far = enemies.spawn('normal', 1, 600, 300);
    const near = enemies.spawn('normal', 1, 300, 300);
    far.hp = far.maxHp = 1e12;
    near.hp = near.maxHp = 1e12;

    projectiles.fire(far, towerState, {
      rawDamage: 1000, damageType: 'physical', isCrit: false, targetId: far.id,
    });
    projectiles.tick(0.325);

    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBe(far.maxHp);
  });

  it('misses when the segment passes wide of the enemy', () => {
    const { enemies, towerState, projectiles } = harness();
    const enemy = enemies.spawn('normal', 1, 400, 300);
    enemy.hp = enemy.maxHp = 1e12;
    // Fire along y = 300 but move the enemy far off that line.
    projectiles.fire(null, towerState, {
      rawDamage: 1000, damageType: 'physical', isCrit: false, targetId: null,
      aimX: 1200, aimY: 300,
    });
    enemy.y = 500;
    projectiles.tick(0.1);
    expect(enemy.hp).toBe(enemy.maxHp);
  });
});

describe('projectile lifetime (plan §5.5)', () => {
  it('retires a shot that never hits and never leaves the field', () => {
    const { towerState, projectiles } = harness();
    projectiles.fire(null, towerState, {
      rawDamage: 1, damageType: 'physical', isCrit: false, targetId: null,
      aimX: 200, aimY: 300,
    });
    expect(projectiles.list).toHaveLength(1);

    // Pin it in place so bounds culling can never be what retires it.
    const p = projectiles.list[0];
    p.vx = 0;
    p.vy = 0;
    for (let i = 0; i < 60 * 5; i++) projectiles.tick(1 / 60);
    expect(projectiles.list).toHaveLength(0);
  });

  it('keeps a shot alive for its normal flight across the arena', () => {
    const { towerState, projectiles } = harness();
    projectiles.fire(null, towerState, {
      rawDamage: 1, damageType: 'physical', isCrit: false, targetId: null,
      aimX: 1200, aimY: 300,
    });
    // Time to cross the full width at the real projectile speed.
    const crossing = 1280 / PROJECTILE_SPEED;
    for (let i = 0; i < Math.floor((crossing * 0.9) * 60); i++) projectiles.tick(1 / 60);
    expect(projectiles.list.length).toBe(1);
  });

  it('culls a shot that leaves the play field', () => {
    const { towerState, projectiles } = harness();
    projectiles.fire(null, towerState, {
      rawDamage: 1, damageType: 'physical', isCrit: false, targetId: null,
      aimX: 1200, aimY: 300,
    });
    for (let i = 0; i < 120; i++) projectiles.tick(1 / 60);
    expect(projectiles.list).toHaveLength(0);
  });

  it('drops everything on reset', () => {
    const { towerState, projectiles } = harness();
    projectiles.fire(null, towerState, {
      rawDamage: 1, damageType: 'physical', isCrit: false, targetId: null,
      aimX: 1200, aimY: 300,
    });
    projectiles.reset();
    expect(projectiles.list).toHaveLength(0);
  });
});

describe('Annihilation splash (upgrades plan §9.1 / gate 13)', () => {
  /**
   * `tp_aoe` shipped inert: `hasAoESplash()` / `getAoESplashFraction()` had no
   * consumer that reached the projectile, so a 12 TP perk changed nothing on
   * screen. Both halves are pinned here — the payload lands on a second enemy,
   * and the accessor still has a caller in `Game`.
   */
  function aoePrestige() {
    return new PrestigeManager(new EventBus(), {
      resources: { ascensionPoints: 0, lifetimeAP: 0, apThisTranscendence: 0 } as unknown as ResourceState,
      stats: { lifetimeAscensions: 1 } as unknown as GameStats,
      prestige: { apSpent: {}, tpSpent: { tp_aoe: 1 }, automationFlags: {} } as unknown as PrestigeState,
    });
  }

  it('damages a second enemy inside the radius', () => {
    const { enemies, towerState, projectiles } = harness();
    const prestige = aoePrestige();
    expect(prestige.hasAoESplash()).toBe(true);

    const target = enemies.spawn('normal', 1, 400, 300);
    // Well inside the blast, and not the projectile's target.
    const bystander = enemies.spawn('normal', 1, 400 + TP_AOE_SPLASH_RADIUS * 0.5, 300);
    const bystanderHp = bystander.hp;

    const splash = composeShotSplash({}, {
      splashRadius: TP_AOE_SPLASH_RADIUS,
      splashFraction: prestige.getAoESplashFraction(),
    });
    projectiles.fire(target, towerState, {
      rawDamage: 40, damageType: 'physical', isCrit: false, targetId: target.id, ...splash,
    });
    const p = projectiles.list[0];
    p.x = target.x - 5;
    p.y = target.y;
    projectiles.tick(0.05);

    expect(bystander.hp).toBeLessThan(bystanderHp);
  });

  it('composes with the artillery core by max radius and summed fraction', () => {
    const core = { splashRadius: CORE_TUNING.splashRadius, splashFraction: CORE_TUNING.splashFraction };
    const composed = composeShotSplash(core, { splashRadius: TP_AOE_SPLASH_RADIUS, splashFraction: 0.25 });
    expect(composed.splashRadius).toBe(Math.max(CORE_TUNING.splashRadius, TP_AOE_SPLASH_RADIUS));
    // The cap never takes a source below what it grants alone.
    expect(composed.splashFraction).toBeGreaterThanOrEqual(CORE_TUNING.splashFraction);
    expect(composed.splashFraction).toBeLessThanOrEqual(
      Math.max(CORE_TUNING.splashFraction, SPLASH_FRACTION_CAP),
    );
  });

  it('still has a consumer for hasAoESplash in Game', () => {
    const src = readFileSync(new URL('../src/game/Game.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/hasAoESplash\(\)/);
    expect(src).toMatch(/getAoESplashFraction\(\)/);
  });
});

/**
 * Overwatch and Skewer (revamp §6.1).
 *
 * Both are per-hit modifiers rather than stat keys — one needs the target's
 * distance, the other how many bodies the shot has already been through — so
 * these pin that they actually change a number on impact rather than shipping
 * as tooltip text.
 */
describe('shot evolutions (revamp §6.1)', () => {
  function damageDealt(range: number, enemyX: number, bonus: number): number {
    const { enemies, towerState, projectiles } = harness();
    towerState.range = range;
    towerState.baseDamage = 1000;
    projectiles.setEvolutionShotBonuses(bonus, 0);
    const enemy = enemies.spawn('normal', 1, enemyX, towerState.y);
    enemy.hp = enemy.maxHp = 1e9;
    enemy.armor = 0;
    const hpBefore = enemy.hp;

    projectiles.fire(enemy, towerState, {
      rawDamage: 1000, damageType: 'physical', isCrit: false, targetId: enemy.id,
    });
    const p = projectiles.list[0];
    p.x = enemy.x - 25;
    p.y = enemy.y;
    projectiles.tick(0.05);
    return hpBefore - enemy.hp;
  }

  it('Overwatch pays only past 70% of range', () => {
    // Tower sits at x=100 with a 1000-unit range: the band starts at x=800.
    const near = damageDealt(1000, 600, 0.10);
    const far = damageDealt(1000, 1000, 0.10);
    const farNoEvo = damageDealt(1000, 1000, 0);

    expect(near).toBe(farNoEvo);
    expect(far).toBeCloseTo(farNoEvo * 1.10, 4);
  });

  it('Skewer amplifies every target after the first on the same shot', () => {
    const { enemies, towerState, projectiles } = harness();
    towerState.baseDamage = 1000;
    projectiles.setPierceExtra(2);
    projectiles.setEvolutionShotBonuses(0, 0.15);

    const first = enemies.spawn('normal', 1, 300, towerState.y);
    const second = enemies.spawn('normal', 1, 500, towerState.y);
    for (const e of [first, second]) {
      e.hp = e.maxHp = 1e9;
      e.armor = 0;
    }

    projectiles.fire(second, towerState, {
      rawDamage: 1000, damageType: 'physical', isCrit: false, targetId: second.id,
    });
    for (let i = 0; i < 40; i++) projectiles.tick(0.05);

    const firstHit = 1e9 - first.hp;
    const secondHit = 1e9 - second.hp;
    expect(firstHit).toBeGreaterThan(0);
    expect(secondHit).toBeCloseTo(firstHit * 1.15, 4);
  });
});

describe('projectile payloads (revamp §7 / gate 12)', () => {
  const { extraDamageScale, rearDamageScale, scatterDamageScale } = PRESTIGE_PROJECTILE_TUNING;

  it('ships the §7 payload fractions', () => {
    expect(extraDamageScale).toBe(0.55);
    expect(rearDamageScale).toBe(0.55);
    expect(scatterDamageScale).toBe(0.35);
  });

  /**
   * The volley Game.buildShotVariants() produces with the whole AP suite: the
   * ordinary shot at full payload, Twin Arrows and Rear Guard at 55%, and each
   * of the two Scatter lanes at 35%.
   */
  it('lands Twin/Rear at 55% and each Scatter lane at 35% of rawDamage', () => {
    const { towerState, projectiles } = harness();
    const rawDamage = 1000;

    const created = projectiles.fire(null, towerState, {
      rawDamage, damageType: 'physical', isCrit: false, targetId: null,
      variants: [
        {},
        { posOffsetY: -10, damageScale: extraDamageScale },
        { angleOffset: -0.5, damageScale: scatterDamageScale },
        { angleOffset: 0.5, damageScale: scatterDamageScale },
        { angleOffset: Math.PI, posOffsetY: -10, damageScale: rearDamageScale },
      ],
    });

    expect(created.map(p => p.damage)).toEqual([
      rawDamage,
      rawDamage * 0.55,
      rawDamage * 0.35,
      rawDamage * 0.35,
      rawDamage * 0.55,
    ]);
    // The whole suite is worth x2.80 before geometry, not x5 (§7).
    const total = created.reduce((sum, p) => sum + p.damage, 0);
    expect(total).toBeCloseTo(rawDamage * 2.80, 6);
  });

  it('leaves an unscaled variant — ordinary, Barrage, Rapid Fire — at full payload', () => {
    const { towerState, projectiles } = harness();
    const created = projectiles.fire(null, towerState, {
      rawDamage: 1000, damageType: 'physical', isCrit: false, targetId: null,
      variants: [{}, { posOffsetY: -12 }, { posOffsetY: 12 }],
    });
    expect(created.every(p => p.damage === 1000)).toBe(true);
  });

  it('applies the payload through Game.buildShotVariants, not just at the call site', () => {
    const src = readFileSync(new URL('../src/game/Game.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('private buildShotVariants'));
    const fn = body.slice(0, body.indexOf('\n  }'));
    expect(fn).toContain('PRESTIGE_PROJECTILE_TUNING.extraDamageScale');
    expect(fn).toContain('PRESTIGE_PROJECTILE_TUNING.scatterDamageScale');
    expect(fn).toContain('PRESTIGE_PROJECTILE_TUNING.rearDamageScale');
  });
});
