import type { DamageType, Enemy, Projectile, TowerState } from '../types';
import { nextId } from '../utils/math';
import { PROJECTILE_SPEED } from '../data/tower';
import { ENEMY_DEFS } from '../data/enemies';
import type { Tower } from './Tower';
import type { EnemyManager } from './EnemyManager';
import { EventBus } from '../game/EventBus';

/** HP fraction below which the Executioner talent's bonus damage applies. */
const TALENT_EXECUTE_THRESHOLD = 0.5;

/**
 * Hard lifetime for any projectile, in simulation seconds (plan §5.5).
 *
 * Bounds culling only retires shots that actually leave the play field; a
 * homing projectile circling a target it can never catch, or one fired into a
 * corner, otherwise stays in the list (and in every projectile-vs-enemy loop)
 * indefinitely. At 720 px/s this is several times longer than crossing the
 * arena takes, so it never truncates a shot that was going to land.
 */
const MAX_PROJECTILE_AGE = 4;

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
  /** Executioner talent: bonus damage against enemies below half HP. */
  private talentExecuteBonus = 0;
  private armorPen = 0;
  private instantKillChance = 0;
  private critSplashFraction = 0;
  private critIgnoreArmor = false;
  /** Play-field size; projectiles are culled once they leave it by a margin. */
  private boundsWidth = 1280;
  private boundsHeight = 720;

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

  /** Executioner talent: +damage to enemies below `TALENT_EXECUTE_THRESHOLD`. */
  setTalentExecuteBonus(bonus: number): void {
    this.talentExecuteBonus = Math.max(0, bonus);
  }

  setBounds(width: number, height: number): void {
    this.boundsWidth = width;
    this.boundsHeight = height;
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
        age: 0,
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
      // Remember where the projectile was: at 720 px/s a single step can cover
      // far more than an enemy's radius (especially at high game speed), so
      // collision is tested against the whole travel segment, not the end point.
      const prevX = p.x;
      const prevY = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Every projectile ages, so one that never hits anything and never
      // leaves the play field still retires (plan §5.5).
      const age = (p.age ?? 0) + dt;
      p.age = age;
      if (age >= MAX_PROJECTILE_AGE) {
        p.alive = false;
        continue;
      }

      // Homing logic
      if (p.homingTargetId !== undefined && p.turnRate !== undefined) {
        if (p.lifetime !== undefined && age >= p.lifetime) {
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
      const segX = p.x - prevX;
      const segY = p.y - prevY;
      const segLenSq = segX * segX + segY * segY;
      // Nearest enemy *along the travel segment*, so a fast projectile hits the
      // first thing in its path rather than whatever comes first in the array.
      let hit: Enemy | null = null;
      let hitT = Infinity;
      for (const e of this.enemies.list) {
        if (!e.alive) continue;
        if (hitSet && hitSet.has(e.id)) continue;
        const r = this.enemyRadius(e) + 6;
        let t = 0;
        if (segLenSq > 0) {
          t = ((e.x - prevX) * segX + (e.y - prevY) * segY) / segLenSq;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
        }
        const cx = prevX + segX * t - e.x;
        const cy = prevY + segY * t - e.y;
        if (cx * cx + cy * cy <= r * r && t < hitT) {
          hit = e;
          hitT = t;
        }
      }
      if (hit) {
        const enemy = hit;
        // Instant kill evolution (non-boss only)
        if (this.instantKillChance > 0 && enemy.type !== 'boss' && Math.random() < this.instantKillChance) {
          const dmg = enemy.hp;
          this.enemies.damage(enemy, dmg, false);
          this.bus.emit('tower_damage_dealt', { amount: dmg });
        } else {
          const penEnemy = this.armorPen > 0 || (p.isCrit && this.critIgnoreArmor)
            ? { ...enemy, armor: p.isCrit && this.critIgnoreArmor ? 0 : Math.max(0, enemy.armor * (1 - this.armorPen)) }
            : enemy;
          let final = this.tower.applyResists(penEnemy, p.damage, p.damageType);
          if (this.executeThreshold > 0 && enemy.hp / enemy.maxHp < this.executeThreshold) {
            final = Math.floor(final * (1 + this.executeMultiplier));
          }
          if (this.talentExecuteBonus > 0 && enemy.hp / enemy.maxHp < TALENT_EXECUTE_THRESHOLD) {
            final = Math.floor(final * (1 + this.talentExecuteBonus));
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
            for (const e of this.enemies.queryRadius(enemy.x, enemy.y, splashRadius)) {
              if (e.id === enemy.id) continue;
              this.enemies.damage(e, splashDamage, false);
              this.bus.emit('tower_damage_dealt', { amount: splashDamage });
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

    const margin = 120;
    const maxX = this.boundsWidth + margin;
    const maxY = this.boundsHeight + margin;
    this.projectiles = this.projectiles.filter(p => {
      if (!p.alive || p.x < -margin || p.x > maxX || p.y < -margin || p.y > maxY) {
        delete this.hitEnemies[p.id];
        delete this.piercingRemaining[p.id];
        return false;
      }
      return true;
    });
  }

  private enemyRadius(enemy: Enemy): number {
    return ENEMY_DEFS[enemy.type].radius;
  }

  reset(): void {
    this.projectiles = [];
    this.piercingRemaining = {};
    this.hitEnemies = {};
  }
}
