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
  isHoming?: boolean;
  turnRate?: number;
  lifetime?: number;
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
  private hitEnemies: Record<number, Set<number>> = {};
  private executeThreshold = 0;
  private executeMultiplier = 0;
  private armorPen = 0;
  private instantKillChance = 0;
  private critSplashFraction = 0;
  private critIgnoreArmor = false;

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

  setExecuteBonus(threshold: number, multiplier: number): void {
    this.executeThreshold = threshold;
    this.executeMultiplier = multiplier;
  }

  setArmorPen(value: number): void {
    this.armorPen = Math.max(0, Math.min(1, value));
  }

  setEvolutionCombatEffects(instantKill: number, critSplash: number, critIgnoreArmor: boolean): void {
    this.instantKillChance = instantKill;
    this.critSplashFraction = critSplash;
    this.critIgnoreArmor = critIgnoreArmor;
  }

  private pierceMax(id: number): number {
    const rem = this.piercingRemaining[id];
    return rem !== undefined ? rem : 1 + this.pierceExtra;
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
        homingTargetId: opts.isHoming ? opts.targetId ?? undefined : undefined,
        turnRate: opts.isHoming ? (opts.turnRate ?? Math.PI * 3) : undefined,
        lifetime: opts.isHoming ? (opts.lifetime ?? 3) : undefined,
        age: opts.isHoming ? 0 : undefined,
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

      // Homing logic
      if (p.homingTargetId !== undefined && p.turnRate !== undefined) {
        p.age = (p.age ?? 0) + dt;
        if (p.lifetime !== undefined && p.age >= p.lifetime) {
          p.alive = false;
          continue;
        }
        const target = this.enemies.list.find(e => e.alive && e.id === p.homingTargetId);
        if (target) {
          const dx = target.x - p.x;
          const dy = target.y - p.y;
          const desiredAngle = Math.atan2(dy, dx);
          const currentAngle = Math.atan2(p.vy, p.vx);
          let diff = desiredAngle - currentAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const maxTurn = p.turnRate * dt;
          const clamped = Math.max(-maxTurn, Math.min(maxTurn, diff));
          const newAngle = currentAngle + clamped;
          const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          p.vx = Math.cos(newAngle) * speed;
          p.vy = Math.sin(newAngle) * speed;
        }
      }

      const hitSet = this.hitEnemies[p.id];
      const hits: Enemy[] = [];
      for (const e of this.enemies.list) {
        if (!e.alive) continue;
        if (hitSet && hitSet.has(e.id)) continue;
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
        // Instant kill evolution (non-boss only)
        if (this.instantKillChance > 0 && enemy.type !== 'boss' && Math.random() < this.instantKillChance) {
          const dmg = enemy.hp;
          this.enemies.damage(enemy, dmg, false);
          this.bus.emit('tower_damage_dealt', { amount: dmg });
        } else {
          const penEnemy = this.armorPen > 0 || (p.isCrit && this.critIgnoreArmor)
            ? { ...enemy, armor: p.isCrit && this.critIgnoreArmor ? 0 : Math.max(0, enemy.armor * (1 - this.armorPen)) }
            : enemy;
          let final = this.tower.applyResists(penEnemy, p.damage);
          if (this.executeThreshold > 0 && enemy.hp / enemy.maxHp < this.executeThreshold) {
            final = Math.floor(final * (1 + this.executeMultiplier));
          }
          const vulnBonus = this.enemies.isVulnerable(enemy);
          if (vulnBonus > 0) {
            final = Math.floor(final * (1 + vulnBonus));
          }
          const killed = this.enemies.damage(enemy, final, p.isCrit);
          this.bus.emit('tower_damage_dealt', { amount: final });
          if (!killed) {
            const ts = this.tower.snapshot;
            if (ts.knockbackForce > 0) {
              this.enemies.applyKnockback(enemy, ts.knockbackForce, ts.x, ts.y);
            }
          }
          // Crit splash evolution
          if (p.isCrit && this.critSplashFraction > 0) {
            const splashDamage = Math.max(1, Math.floor(final * this.critSplashFraction));
            const splashRadius = 50;
            for (const e of this.enemies.list) {
              if (!e.alive || e.id === enemy.id) continue;
              const dx = e.x - enemy.x;
              const dy = e.y - enemy.y;
              if (dx * dx + dy * dy <= splashRadius * splashRadius) {
                this.enemies.damage(e, splashDamage, false);
                this.bus.emit('tower_damage_dealt', { amount: splashDamage });
              }
            }
          }
        }
        const remaining = this.pierceMax(p.id);
        if (remaining > 1) {
          this.piercingRemaining[p.id] = remaining - 1;
          if (!this.hitEnemies[p.id]) this.hitEnemies[p.id] = new Set();
          this.hitEnemies[p.id].add(enemy.id);
        } else {
          p.alive = false;
          delete this.piercingRemaining[p.id];
          delete this.hitEnemies[p.id];
        }
      }
    }

    this.projectiles = this.projectiles.filter(p => {
      if (!p.alive || p.x < -100 || p.x > 9999 || p.y < -100 || p.y > 9999) {
        delete this.hitEnemies[p.id];
        return false;
      }
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
    this.hitEnemies = {};
  }
}
