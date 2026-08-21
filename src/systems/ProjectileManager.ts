import type { DamageType, Enemy, Projectile, TowerState } from '../types';
import { nextId } from '../utils/math';
import { PROJECTILE_HIT_PAD, world } from '../data/arena';
import { PROJECTILE_SPEED } from '../data/tower';
import { ENEMY_DEFS, isTargetable } from '../data/enemies';
import { BLESSING_TUNING, type BlessingBehavior } from '../data/blessings';
import { CORE_TUNING, type CoreBehavior } from '../data/cores';
import { OVERKILL_CARRY_BASE } from '../data/pacing';
import type { Tower } from './Tower';
import type { EnemyManager } from './EnemyManager';
import { EventBus } from '../game/EventBus';

/**
 * The only thing the projectile loop needs to know about the blessing draft.
 *
 * A narrow interface rather than the manager itself, so the combat path can be
 * driven from a test with a two-line stub and cannot reach anything else.
 */
export interface BlessingQuery {
  has(behavior: BlessingBehavior): boolean;
}

const NO_BLESSINGS: BlessingQuery = { has: () => false };

/**
 * The same narrow shape for the run's core (plan §6.2).
 *
 * `CoreManager` satisfies it, and so does a two-line stub — which is what the
 * behavior tests use, so the impact path can be driven without a `Game`.
 */
export interface CoreQuery {
  has(behavior: CoreBehavior): boolean;
}

const NO_CORE: CoreQuery = { has: () => false };

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
  /**
   * Extra targets this shot pierces, on top of the tower's own pierce.
   * The charged shot (gameplay plan §4.2) is the only user.
   */
  extraPierce?: number;
  variants?: ShotVariant[];
  aimX?: number;
  aimY?: number;
  isHoming?: boolean;
  turnRate?: number;
  lifetime?: number;
  /** Mortar blessing: blast radius on impact. */
  splashRadius?: number;
  /** Fraction of the landed hit that everything else in the blast takes. */
  splashFraction?: number;
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
  /** Flat armour ignored, applied after the percentage. Blessing-fed. */
  private armorPenFlat = 0;
  /** The run's blessings, for the behaviors that fire on impact. */
  private blessings: BlessingQuery = NO_BLESSINGS;
  /** The run's core, for the behaviors that fire on impact. */
  private core: CoreQuery = NO_CORE;
  private instantKillChance = 0;
  private critSplashFraction = 0;
  private critIgnoreArmor = false;
  /** Play-field size; projectiles are culled once they leave it by a margin. */
  private boundsWidth = world(1280);
  private boundsHeight = world(720);

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

  /** Flat armour ignored on top of the percentage (Sunder blessing). */
  setArmorPenFlat(value: number): void {
    this.armorPenFlat = Math.max(0, value);
  }

  /** Wire the run's blessing draft into the impact path. */
  setBlessings(query: BlessingQuery): void {
    this.blessings = query;
  }

  /** Wire the run's tower core into the impact path. */
  setCore(query: CoreQuery): void {
    this.core = query;
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
        splashRadius: opts.splashRadius,
        splashFraction: opts.splashFraction,
      };

      if (opts.piercing) {
        this.piercingRemaining[proj.id] = 2;
      } else if (opts.extraPierce) {
        this.piercingRemaining[proj.id] = 1 + this.pierceExtra + Math.max(0, Math.floor(opts.extraPierce));
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
        // `isTargetable`, not `alive`: a burrowed burrower and a splitter child
        // inside its spawn protection are on the field and shots pass straight
        // through them (plan §2.1/§2.2).
        if (!isTargetable(e)) continue;
        if (hitSet && hitSet.has(e.id)) continue;
        // `PROJECTILE_HIT_PAD`, not a literal 6: bodies scaled by
        // `ENTITY_SCALE` while flight and enemy speeds scaled by the larger
        // `WORLD_SCALE`, so without the pad every moving target became harder
        // to hit purely as a side effect of the zoom-out (UI plan §1.1).
        const r = this.enemyRadius(e) + PROJECTILE_HIT_PAD;
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
        } else if (this.tryExecute(enemy)) {
          // Executioner blessing already finished it; nothing else to apply.
        } else {
          const effectiveArmor = p.isCrit && this.critIgnoreArmor
            ? 0
            : Math.max(0, enemy.armor * (1 - this.armorPen) - this.armorPenFlat);
          const penEnemy = effectiveArmor !== enemy.armor
            ? { ...enemy, armor: effectiveArmor }
            : enemy;
          let final = this.tower.applyResists(penEnemy, p.damage, p.damageType);
          if (this.executeThreshold > 0 && enemy.hp / enemy.maxHp < this.executeThreshold) {
            final = Math.floor(final * (1 + this.executeMultiplier));
          }
          if (this.talentExecuteBonus > 0 && enemy.hp / enemy.maxHp < TALENT_EXECUTE_THRESHOLD) {
            final = Math.floor(final * (1 + this.talentExecuteBonus));
          }
          // Shatter: the payoff card for a frost build. Read from the enemy's
          // own chill state, not a global flag, so it rewards actually having
          // slowed *this* target.
          if (this.blessings.has('shatter') && this.enemies.isSlowed(enemy)) {
            final = Math.floor(final * (1 + BLESSING_TUNING.shatterBonus));
          }
          const hpBefore = enemy.hp;
          const killed = this.enemies.damage(enemy, final, p.isCrit);
          this.bus.emit('tower_damage_dealt', { amount: final });
          if (!killed) {
            const ts = this.tower.snapshot;
            if (ts.knockbackForce > 0) {
              this.enemies.applyKnockback(enemy, ts.knockbackForce, ts.x, ts.y);
            }
          }
          if (this.blessings.has('frost_shots')) {
            this.enemies.applyChill(
              enemy,
              BLESSING_TUNING.frostChillFactor,
              BLESSING_TUNING.frostChillDuration,
            );
          }
          // Frostwork's chill is harder and longer than the blessing's, and
          // both route through `applyChill`, whose "strongest wins, weaker only
          // refreshes" rule composes them without one diluting the other.
          if (this.core.has('chill_shots')) {
            this.enemies.applyChill(enemy, CORE_TUNING.chillFactor, CORE_TUNING.chillDuration);
          }
          // Crit splash evolution
          if (p.isCrit && this.critSplashFraction > 0) {
            const splashDamage = Math.max(1, Math.floor(final * this.critSplashFraction));
            const splashRadius = world(50);
            for (const e of this.enemies.queryRadius(enemy.x, enemy.y, splashRadius)) {
              if (e.id === enemy.id || !isTargetable(e)) continue;
              this.enemies.damage(e, splashDamage, false);
              this.bus.emit('tower_damage_dealt', { amount: splashDamage });
            }
          }
          // ── blessing behaviors on impact (plan §1.3) ──
          if (p.splashRadius && p.splashRadius > 0) {
            this.applyBlastSplash(p, enemy, final);
          }
          if (this.blessings.has('ricochet')) {
            this.applyRicochet(enemy, final);
          }
          if (p.isCrit && this.blessings.has('crit_chain')) {
            this.applyCritChain(enemy, final);
          }
          // Plan §7.5: overkill carries by default now; the blessing raises
          // the share rather than switching the mechanism on.
          if (killed) {
            this.applyOverkill(enemy, final - hpBefore);
          }
        }
        // Plan §2.2: a tank body-blocks. However much pierce the shot has, it
        // stops here — which is what gives the tank a job in a formation
        // instead of making it a fat circle that pierce walks through.
        const blocked = enemy.type === 'tank';
        const remaining = blocked ? 1 : this.pierceMax(p.id);
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

    const margin = world(120);
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

  // ── blessing behaviors (plan §1.3) ──

  /**
   * Executioner: finish a non-boss enemy already under the threshold.
   *
   * Checked *before* damage is computed, so it reads as "anything this weak
   * dies on contact" rather than as a conditional damage bonus. Bosses are
   * exempt by design — a one-shot on the encounter would delete Part 3.
   */
  private tryExecute(enemy: Enemy): boolean {
    if (!this.blessings.has('executioner')) return false;
    if (enemy.type === 'boss') return false;
    if (enemy.maxHp <= 0) return false;
    if (enemy.hp / enemy.maxHp >= BLESSING_TUNING.executeThreshold) return false;
    const dmg = enemy.hp;
    this.enemies.damage(enemy, dmg, false);
    this.bus.emit('tower_damage_dealt', { amount: dmg });
    return true;
  }

  /** The `n` nearest living enemies to a point, excluding `exclude`. */
  private nearestOthers(
    x: number,
    y: number,
    radius: number,
    exclude: Set<number>,
    count: number,
  ): Enemy[] {
    const found = this.enemies.queryRadius(x, y, radius);
    const scored: Array<{ e: Enemy; d: number }> = [];
    for (const e of found) {
      if (!isTargetable(e) || exclude.has(e.id)) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      scored.push({ e, d: dx * dx + dy * dy });
    }
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, count).map(s => s.e);
  }

  /** Mortar blessing: every 8th shot lands as a blast rather than a point hit. */
  private applyBlastSplash(p: Projectile, hit: Enemy, final: number): void {
    const fraction = p.splashFraction ?? 1;
    const splash = Math.max(1, Math.floor(final * fraction));
    for (const e of this.enemies.queryRadius(hit.x, hit.y, p.splashRadius ?? 0)) {
      if (e.id === hit.id || !isTargetable(e)) continue;
      this.enemies.damage(e, splash, false);
      this.bus.emit('tower_damage_dealt', { amount: splash });
    }
  }

  /**
   * Ricochet: the shot carries on to a nearby target.
   *
   * `ricochet_power` is the synergy follow-up — it upgrades the bounce to full
   * damage and lets it chain twice, which is what makes taking the epic on top
   * of the rare feel like a build rather than a second copy.
   */
  private applyRicochet(from: Enemy, final: number): void {
    const powered = this.blessings.has('ricochet_power');
    const bounces = powered ? BLESSING_TUNING.ricochetPowerBounces : 1;
    const fraction = powered
      ? BLESSING_TUNING.ricochetPowerDamage
      : BLESSING_TUNING.ricochetDamage;
    const dmg = Math.max(1, Math.floor(final * fraction));
    const struck = new Set<number>([from.id]);
    let originX = from.x;
    let originY = from.y;
    for (let i = 0; i < bounces; i++) {
      const [next] = this.nearestOthers(
        originX,
        originY,
        BLESSING_TUNING.ricochetRange,
        struck,
        1,
      );
      if (!next) return;
      struck.add(next.id);
      originX = next.x;
      originY = next.y;
      this.enemies.damage(next, dmg, false);
      this.bus.emit('tower_damage_dealt', { amount: dmg });
    }
  }

  /** Chain Crit: a crit forks into a short lightning chain. */
  private applyCritChain(from: Enemy, final: number): void {
    const dmg = Math.max(1, Math.floor(final * BLESSING_TUNING.critChainDamage));
    const struck = new Set<number>([from.id]);
    const path: Array<{ x: number; y: number }> = [{ x: from.x, y: from.y }];
    let originX = from.x;
    let originY = from.y;
    for (let i = 0; i < BLESSING_TUNING.critChainBounces; i++) {
      const [next] = this.nearestOthers(
        originX,
        originY,
        BLESSING_TUNING.critChainRange,
        struck,
        1,
      );
      if (!next) break;
      struck.add(next.id);
      originX = next.x;
      originY = next.y;
      path.push({ x: next.x, y: next.y });
      this.enemies.damage(next, dmg, false);
      this.bus.emit('tower_damage_dealt', { amount: dmg });
    }
    // Reuse the existing chain-lightning visual rather than inventing a second
    // vocabulary for the same idea.
    if (path.length >= 2) this.bus.emit('chain_lightning', { path });
  }

  /**
   * Overkill: excess damage on a killing blow carries to the next target.
   *
   * Baseline **10%** (plan §7.5), raised to 25% by the `overkill_carry`
   * blessing — one mechanism with two rates rather than two mechanisms that
   * would both fire on a blessed kill. Needs no throughput pricing: the carried
   * amount is a fraction of damage the tower already dealt, so it grows with
   * every damage purchase instead of shrinking against every fire-rate one.
   *
   * `nearestOthers` filters on `isTargetable`, which is what keeps a carry from
   * landing on a corpse, a burrowed enemy or a spawn-protected splitter child.
   */
  private applyOverkill(from: Enemy, overkill: number): void {
    if (overkill <= 0) return;
    const share = this.blessings.has('overkill_carry')
      ? BLESSING_TUNING.overkillCarry
      : OVERKILL_CARRY_BASE;
    const carried = Math.floor(overkill * share);
    if (carried <= 0) return;
    const [next] = this.nearestOthers(
      from.x,
      from.y,
      BLESSING_TUNING.overkillRange,
      new Set<number>([from.id]),
      1,
    );
    if (!next) return;
    this.enemies.damage(next, carried, false);
    this.bus.emit('tower_damage_dealt', { amount: carried });
  }

  reset(): void {
    this.projectiles = [];
    this.piercingRemaining = {};
    this.hitEnemies = {};
  }
}
