import type { Enemy, EnemyType, Projectile } from '../types';
import { distance2, nextId } from '../utils/math';
import { ENEMY_DEFS } from '../data/enemies';
import {
  bossHPForWave,
  enemyDamageForWave,
  enemyHPForWave,
  enemySpeedForWave,
  goldDropForWave,
} from '../data/formulas';
import { TOWER_HIT_RADIUS } from '../data/tower';
import { EventBus } from '../game/EventBus';
import type { ResourceManager } from './ResourceManager';

const ENEMY_GAP = 2;

export class EnemyManager {
  private enemies: Enemy[] = [];
  private readonly bus: EventBus;
  private readonly resources: ResourceManager;
  private goldMultipliers: { additive: number; multiplicative: number } = {
    additive: 0,
    multiplicative: 1,
  };
  private slowFactor = 1;
  private slowTimer = 0;
  private goldLuckChance = 0;
  private goldLuckMultiplier = 1;

  constructor(bus: EventBus, resources: ResourceManager) {
    this.bus = bus;
    this.resources = resources;
  }

  get list(): Enemy[] {
    return this.enemies;
  }

  setGoldMultipliers(additive: number, multiplicative: number): void {
    this.goldMultipliers = { additive, multiplicative };
  }

  setGoldLuck(chance: number, multiplier: number): void {
    this.goldLuckChance = Math.max(0, Math.min(1, chance));
    this.goldLuckMultiplier = Math.max(1, multiplier);
  }

  applySlow(factor: number, duration: number): void {
    if (factor < this.slowFactor || this.slowTimer <= 0) {
      this.slowFactor = factor;
      this.slowTimer = duration;
    } else {
      this.slowTimer = Math.max(this.slowTimer, duration);
    }
  }

  spawn(type: EnemyType, wave: number, spawnX: number, spawnY: number): Enemy {
    const def = ENEMY_DEFS[type];
    let hp: number;
    if (type === 'boss') hp = bossHPForWave(def.baseHP, wave);
    else hp = enemyHPForWave(def.baseHP, wave);
    const speed = enemySpeedForWave(def.baseSpeed, wave);
    const gold = goldDropForWave(def.baseGold, wave);
    const damage = enemyDamageForWave(def.baseDamage, wave);
    const fireRate = Math.max(0.01, def.fireRate);
    const enemy: Enemy = {
      id: nextId(),
      type,
      x: spawnX,
      y: spawnY,
      hp,
      maxHp: hp,
      speed,
      armor: def.armor,
      magicResist: def.magicResist,
      goldValue: gold,
      damage,
      fireRate,
      attackCooldown: 1 / fireRate,
      attacking: false,
      alive: true,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  damage(enemy: Enemy, amount: number, isCrit: boolean = false): boolean {
    if (!enemy.alive) return false;
    enemy.hp -= amount;
    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.alive = false;
      this.bus.emit('enemy_damaged', { enemy, amount, killed: true, isCrit });
      this.bus.emit('enemy_killed', enemy);
      this.resources.addGold(this.computeGold(enemy));
      return true;
    }
    this.bus.emit('enemy_damaged', { enemy, amount, killed: false, isCrit });
    return false;
  }

  private computeGold(enemy: Enemy): number {
    const base = enemy.goldValue;
    const additive = 1 + this.goldMultipliers.additive;
    let amount = base * additive * this.goldMultipliers.multiplicative;
    if (this.goldLuckChance > 0 && Math.random() < this.goldLuckChance) {
      amount *= this.goldLuckMultiplier;
    }
    return Math.max(1, Math.floor(amount));
  }

  projectileHit(proj: Projectile, enemy: Enemy, finalDamage: number): boolean {
    if (!proj.alive || !enemy.alive) return false;
    proj.alive = false;
    this.damage(enemy, finalDamage);
    return true;
  }

  applyKnockback(enemy: Enemy, force: number, fromX: number, fromY: number): void {
    if (force <= 0) return;
    const dx = enemy.x - fromX;
    const dy = enemy.y - fromY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.001) return;
    enemy.x += (dx / d) * force;
    enemy.y += (dy / d) * force;
  }

  applyShockwave(radius: number, fromX: number, fromY: number): void {
    if (radius <= 0) return;
    const r2 = radius * radius;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - fromX;
      const dy = e.y - fromY;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2);
      if (d < 0.001) continue;
      e.x = fromX + (dx / d) * radius;
      e.y = fromY + (dy / d) * radius;
    }
  }

  tick(dt: number, towerX: number, towerY: number): void {
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowFactor = 1;
    }

    const newlyReached: Enemy[] = [];
    let totalDamage = 0;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = towerX - e.x;
      const dy = towerY - e.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const contact = TOWER_HIT_RADIUS + ENEMY_DEFS[e.type].radius + ENEMY_GAP;

      if (d <= contact) {
        if (d > 0) {
          const ratio = contact / d;
          e.x = towerX - dx * ratio;
          e.y = towerY - dy * ratio;
        }

        if (!e.attacking) {
          e.attacking = true;
          e.attackCooldown = 1 / e.fireRate;
          newlyReached.push(e);
        }

        e.attackCooldown -= dt;
        if (e.attackCooldown <= 0) {
          totalDamage += e.damage;
          e.attackCooldown += 1 / e.fireRate;
        }
      } else {
        const inv = e.speed * this.slowFactor * dt / d;
        e.x += dx * inv;
        e.y += dy * inv;
      }
    }

    if (newlyReached.length > 0) {
      this.bus.emit('enemies_reached_tower', newlyReached);
    }
    if (totalDamage > 0) {
      this.bus.emit('tower_damaged', totalDamage);
    }

    this.enemies = this.enemies.filter(e => e.alive);
  }

  findById(id: number): Enemy | null {
    for (const e of this.enemies) {
      if (e.id === id) return e;
    }
    return null;
  }

  reset(): void {
    this.enemies = [];
    this.slowFactor = 1;
    this.slowTimer = 0;
    this.goldLuckChance = 0;
    this.goldLuckMultiplier = 1;
  }

  aliveCount(): number {
    let c = 0;
    for (const e of this.enemies) if (e.alive) c++;
    return c;
  }

  furthestDistanceTo(towerX: number, towerY: number): number {
    let best = -1;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d2 = distance2(e.x, e.y, towerX, towerY);
      if (d2 > best) best = d2;
    }
    return best;
  }
}
