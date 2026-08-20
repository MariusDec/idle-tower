/**
 * Projectile travel, collision and lifetime (plan §1.6, §5.5).
 *
 * Swept collision (Part 1) and the hard lifetime cap (Part 5) both change what
 * happens to a projectile between two frames, which is exactly the code the
 * fixed-timestep work in §5.2 alters the step size of. These pin the behaviour
 * at every step size the game can produce.
 */

import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import { Tower } from '../src/systems/Tower';
import { EnemyManager } from '../src/systems/EnemyManager';
import { ResourceManager } from '../src/systems/ResourceManager';
import { ProjectileManager } from '../src/systems/ProjectileManager';
import { PROJECTILE_SPEED } from '../src/data/tower';
import type { GameStats, ResourceState, TowerState } from '../src/types';

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
