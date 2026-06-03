import type { DamageType, Enemy, Projectile, TowerState } from '../types';
import { nextId } from '../utils/math';
import { PROJECTILE_SPEED } from '../data/tower';
import type { Tower } from './Tower';
import type { EnemyManager } from './EnemyManager';
import { EventBus } from '../game/EventBus';

export interface ShotVariant {
  angleOffset?: number;
  posOffsetX?: number;
  posOffsetY?: number;
}

export interface FireOptions {
  rawDamage: number;
  damageType: DamageType;
  isCrit: boolean;
  targetId: number | null;
  piercing?: boolean;
  variants?: ShotVariant[];
  aimX?: number;
  aimY?: number;
}

export class ProjectileManager {
  private projectiles: Projectile[] = [];
  private readonly bus: EventBus;
  private readonly tower: Tower;
  private readonly enemies: EnemyManager;
  private damageMultipliers: { additive: number; multiplicative: number } = {
    additive: 0,
    multiplicative: 1,
  };
  private pierceExtra = 0;
  private piercingRemaining: Record<number, number> = {};

  constructor(bus: EventBus, tower: Tower, enemies: EnemyManager) {
    this.bus = bus;
    this.tower = tower;
    this.enemies = enemies;
  }

  get list(): Projectile[] {
    return this.projectiles;
  }

  setDamageMultipliers(additive: number, multiplicative: number): void {
    this.damageMultipliers = { additive, multiplicative };
  }

  setPierceExtra(value: number): void {
    this.pierceExtra = Math.max(0, Math.floor(value));
  }

  private pierceMax(id: number): number {
    return 1 + (this.piercingRemaining[id] ?? this.pierceExtra);
  }

  fire(target: Enemy | null, towerState: TowerState, opts: FireOptions): Projectile[] {
    const aimX = opts.aimX ?? (target ? target.x : towerState.x + 1);
    const aimY = opts.aimY ?? (target ? target.y : towerState.y);
    const dx = aimX - towerState.x;
    const dy = aimY - towerState.y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const baseVx = (dx / d) * PROJECTILE_SPEED;
    const baseVy = (dy / d) * PROJECTILE_SPEED;
    const baseAngle = Math.atan2(baseVy, baseVx);
    const cosA = Math.cos(baseAngle);
    const sinA = Math.sin(baseAngle);

    const additive = 1 + this.damageMultipliers.additive;
    const scaled = opts.rawDamage * additive * this.damageMultipliers.multiplicative;

    const variants = opts.variants && opts.variants.length > 0 ? opts.variants : [{}];
    const created: Projectile[] = [];

    for (const v of variants) {
      const a = baseAngle + (v.angleOffset ?? 0);
      const vx = Math.cos(a) * PROJECTILE_SPEED;
      const vy = Math.sin(a) * PROJECTILE_SPEED;
      const ox = v.posOffsetX ?? 0;
      const oy = v.posOffsetY ?? 0;

      const proj: Projectile = {
        id: nextId(),
        x: towerState.x + ox * cosA - oy * sinA,
        y: towerState.y + ox * sinA + oy * cosA,
        targetId: opts.targetId,
        vx,
        vy,
        damage: scaled,
        damageType: opts.damageType,
        isCrit: opts.isCrit,
        alive: true,
      };

      if (opts.piercing) {
        this.piercingRemaining[proj.id] = 2;
      }
      this.bus.emit('projectile_fired', { projectile: proj, isCrit: opts.isCrit });
      this.projectiles.push(proj);
      created.push(proj);
    }

    return created;
  }

  tick(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const hits: Enemy[] = [];
      for (const e of this.enemies.list) {
        if (!e.alive) continue;
        const r = this.enemyRadius(e) + 6;
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        if (dx * dx + dy * dy <= r * r) {
          hits.push(e);
          break;
        }
      }
      if (hits.length > 0) {
        const enemy = hits[0];
        const final = this.tower.applyResists(enemy, p.damage);
        const killed = this.enemies.damage(enemy, final, p.isCrit);
        if (!killed) {
          const ts = this.tower.snapshot;
          if (ts.knockbackForce > 0) {
            this.enemies.applyKnockback(enemy, ts.knockbackForce, ts.x, ts.y);
          }
        }
        const remaining = this.pierceMax(p.id);
        if (remaining > 1) {
          this.piercingRemaining[p.id] = remaining - 1;
        } else {
          p.alive = false;
          delete this.piercingRemaining[p.id];
        }
      }
    }

    this.projectiles = this.projectiles.filter(p => {
      if (!p.alive) return false;
      if (p.x < -100 || p.x > 9999 || p.y < -100 || p.y > 9999) return false;
      return true;
    });
  }

  private enemyRadius(enemy: Enemy): number {
    switch (enemy.type) {
      case 'tank': return 18;
      case 'boss': return 30;
      case 'flying': return 11;
      case 'healer': return 14;
      case 'fast': return 10;
      case 'normal':
      default: return 12;
    }
  }

  reset(): void {
    this.projectiles = [];
    this.piercingRemaining = {};
  }
}
