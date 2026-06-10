import type { Enemy, EnemyType, AuraType, Projectile } from '../types';
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
import type { ResearchTree } from './ResearchTree';

const ENEMY_GAP = 2;

// Elite enemy constants
const ELITE_UNLOCK_WAVE = 21;
const ELITE_SPAWN_CHANCE_BASE = 0.02;
const ELITE_SPAWN_CHANCE_MAX_WAVE = 200;
const ELITE_SPAWN_CHANCE_MAX = 0.08;
const ELITE_HP_MULT = 2.5;
const AURA_RADIUS = 180;
const HASTE_SPEED_BONUS = 0.5;
const THORNS_REFLECT_FRACTION = 0.1;
const GREED_GOLD_MULT = 3;
const VITALITY_REGEN_FRACTION = 0.01; // 1% maxHP per second
const RETRIBUTION_BUFF_DURATION = 5;
const RETRIBUTION_BUFF_DAMAGE_MULT = 1.5;
const RETRIBUTION_BUFF_SPEED_MULT = 1.5;

/** Compute elite spawn chance for a given wave. */
export function eliteChanceForWave(wave: number): number {
  if (wave < ELITE_UNLOCK_WAVE) return 0;
  return Math.min(
    ELITE_SPAWN_CHANCE_MAX,
    ELITE_SPAWN_CHANCE_BASE +
      ((wave - ELITE_UNLOCK_WAVE) * (ELITE_SPAWN_CHANCE_MAX - ELITE_SPAWN_CHANCE_BASE)) /
        (ELITE_SPAWN_CHANCE_MAX_WAVE - ELITE_UNLOCK_WAVE),
  );
}

const ELITE_AURA_COLORS: Record<AuraType, string> = {
  haste: 'rgba(60, 180, 255, 0.3)',
  thorns: 'rgba(255, 100, 30, 0.3)',
  greed: 'rgba(255, 215, 0, 0.35)',
  vitality: 'rgba(60, 220, 100, 0.3)',
  retribution: 'rgba(180, 50, 220, 0.3)',
};

export { ELITE_AURA_COLORS, AURA_RADIUS, RETRIBUTION_BUFF_DURATION };

export class EnemyManager {
  private enemies: Enemy[] = [];
  private readonly bus: EventBus;
  private readonly resources: ResourceManager;
  private readonly researchTree: ResearchTree | null;
  private goldMultipliers: { additive: number; multiplicative: number } = {
    additive: 0,
    multiplicative: 1,
  };
  private slowFactor = 1;
  private slowTimer = 0;
  private goldLuckChance = 0;
  private goldLuckMultiplier = 1;
  private thorns = 0;
  private wallContactExtra = 0;
  private hpReduction = 0;
  private vulnerableEnemies: Map<number, number> = new Map();
  private killStreakGoldBonus = 0;
  private manaFullGoldBonus = 0;
  private rpDropChanceBonus = 0;
  /** Multiplier applied to enemy movement speed on spawn (default 1). */
  private speedMult = 1;
  /** Multiplier applied to enemy damage dealt to the tower (default 1). */
  private damageToTowerMult = 1;
  /** Multiplier applied to enemy max HP on spawn (default 1). */
  private hpMult = 1;
  /** Retribution buffs: enemy ID → remaining duration. */
  private retributionBuffs: Map<number, number> = new Map();

  constructor(bus: EventBus, resources: ResourceManager, researchTree?: ResearchTree) {
    this.bus = bus;
    this.resources = resources;
    this.researchTree = researchTree ?? null;
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

  setThorns(thorns: number): void {
    this.thorns = thorns;
  }

  setWallContactExtra(extra: number): void {
    this.wallContactExtra = extra;
  }

  setHPReduction(reduction: number): void {
    this.hpReduction = Math.max(0, Math.min(0.5, reduction));
  }

  setKillStreakGoldBonus(bonus: number): void {
    this.killStreakGoldBonus = bonus;
  }

  setRPDropChanceBonus(bonus: number): void {
    this.rpDropChanceBonus = Math.max(0, bonus);
  }

  setManaFullGoldBonus(bonus: number): void {
    this.manaFullGoldBonus = bonus;
  }

  /**
   * Multiplier applied to enemy movement speed on spawn. Set to 1 to reset.
   * Boss enrage multiplies speed on top of this value.
   */
  setSpeedMult(mult: number): void {
    this.speedMult = Math.max(0.1, mult);
  }

  /**
   * Multiplier applied to damage enemies deal to the tower each frame.
   * Set to 1 to reset.
   */
  setDamageToTowerMult(mult: number): void {
    this.damageToTowerMult = Math.max(0, mult);
  }

  /**
   * Multiplier applied to enemy HP on spawn (after wave scaling, before
   * research hpReduction). Set to 1 to reset.
   */
  setHPMult(mult: number): void {
    this.hpMult = Math.max(0.1, mult);
  }

  applySlow(factor: number, duration: number): void {
    if (factor < this.slowFactor || this.slowTimer <= 0) {
      this.slowFactor = factor;
      this.slowTimer = duration;
    } else {
      this.slowTimer = Math.max(this.slowTimer, duration);
    }
  }

  spawn(type: EnemyType, wave: number, spawnX: number, spawnY: number, overrides: Partial<Enemy> = {}): Enemy {
    const def = ENEMY_DEFS[type];
    let hp: number;
    if (type === 'boss') hp = bossHPForWave(def.baseHP, wave);
    else hp = enemyHPForWave(def.baseHP, wave);
    if (this.hpReduction > 0) hp = Math.max(1, Math.floor(hp * (1 - this.hpReduction)));
    if (this.hpMult !== 1) hp = Math.max(1, Math.floor(hp * this.hpMult));
    const isElite = overrides.elite === true;
    if (isElite) hp = Math.max(1, Math.floor(hp * ELITE_HP_MULT));
    const speed = enemySpeedForWave(def.baseSpeed, wave) * this.speedMult;
    const gold = goldDropForWave(def.baseGold, wave);
    const damage = enemyDamageForWave(def.baseDamage, wave);
    const fireRate = Math.max(0.2, def.fireRate);
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
      ...(type === 'shielded' ? { shieldCharges: def.shieldCharges ?? 3 } : {}),
      ...(type === 'healer' ? { healCooldown: def.healCooldown ?? 2.5 } : {}),
      ...(type === 'boss' ? { enraged: false, enrageTriggered: false } : {}),
      ...overrides,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  /**
   * Spawn an elite version of an enemy with the given aura.
   */
  spawnElite(type: EnemyType, wave: number, spawnX: number, spawnY: number, aura: AuraType): Enemy {
    return this.spawn(type, wave, spawnX, spawnY, {
      elite: true,
      aura,
    });
  }

  /**
   * Apply damage to an enemy. For shielded enemies, consumes a charge instead
   * of HP. Returns true if enemy was killed by this hit.
   */
  damage(enemy: Enemy, amount: number, isCrit: boolean = false): boolean {
    if (!enemy.alive) return false;
    // Shielded: each charge absorbs a hit regardless of damage amount
    if (enemy.type === 'shielded' && (enemy.shieldCharges ?? 0) > 0) {
      enemy.shieldCharges = (enemy.shieldCharges ?? 0) - 1;
      this.bus.emit('shield_break', { x: enemy.x, y: enemy.y });
      this.bus.emit('enemy_damaged', { enemy, amount: 0, killed: false, isCrit, blocked: true });
      return false;
    }
    enemy.hp -= amount;
    // Thorns aura: reflect fraction of damage back to tower (only if not blocked by shield)
    if (enemy.alive && enemy.aura === 'thorns' && enemy.elite) {
      this.computeThornsReflection(amount);
    }
    // Boss enrage: trigger once when HP drops below 50% of maxHP
    if (enemy.type === 'boss' && !enemy.enrageTriggered && enemy.hp / enemy.maxHp <= 0.5) {
      enemy.enrageTriggered = true;
      enemy.enraged = true;
      enemy.fireRate *= 1.5;
      enemy.speed *= 1.3;
      enemy.attackCooldown = Math.max(0, 1 / enemy.fireRate);
      this.bus.emit('boss_enraged', { enemy });
    }
    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.alive = false;
      // Retribution aura: on death, buff nearby enemies
      if (enemy.aura === 'retribution' && enemy.elite) {
        this.triggerRetribution(enemy);
      }
      this.bus.emit('enemy_damaged', { enemy, amount, killed: true, isCrit });
      this.bus.emit('enemy_killed', enemy);
      this.resources.addGold(this.computeGold(enemy));
      const def = ENEMY_DEFS[enemy.type];
      const chance = (def.rpChance ?? 0) + this.rpDropChanceBonus;
      if (chance > 0 && Math.random() < Math.min(1, chance)) {
        this.bus.emit('rp_dropped', { x: enemy.x, y: enemy.y, amount: 1 });
        if (this.researchTree) this.researchTree.addRP(1);
      }
      return true;
    }
    this.bus.emit('enemy_damaged', { enemy, amount, killed: false, isCrit });
    return false;
  }

  private computeGold(enemy: Enemy): number {
    const base = enemy.goldValue;
    const additive = 1 + this.goldMultipliers.additive;
    let amount = base * additive * this.goldMultipliers.multiplicative;
    if (this.killStreakGoldBonus > 0) amount *= 1 + this.killStreakGoldBonus;
    if (this.manaFullGoldBonus > 0) amount *= 1 + this.manaFullGoldBonus;
    if (enemy.aura === 'greed' && enemy.elite) amount *= GREED_GOLD_MULT;
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

  isVulnerable(enemy: Enemy): number {
    return this.vulnerableEnemies.has(enemy.id) ? 0 : 0;
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

    // Tick knockback vulnerability timers
    for (const [id, remaining] of this.vulnerableEnemies) {
      const next = remaining - dt;
      if (next <= 0) this.vulnerableEnemies.delete(id);
      else this.vulnerableEnemies.set(id, next);
    }

    const newlyReached: Enemy[] = [];
    let totalDamage = 0;

    // Pre-compute haste aura multipliers (per-frame reset)
    const hasteMultipliers = this.computeHasteMultipliers();

    // Tick retribution buff timers
    this.tickRetributionBuffs(dt);

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = towerX - e.x;
      const dy = towerY - e.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const contact = TOWER_HIT_RADIUS + ENEMY_DEFS[e.type].radius + ENEMY_GAP + this.wallContactExtra;

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
          this.bus.emit('enemy_attack', { x: e.x, y: e.y, type: e.type });
          let dmgMult = this.damageToTowerMult;
          if (this.retributionBuffs.has(e.id)) dmgMult *= RETRIBUTION_BUFF_DAMAGE_MULT;
          totalDamage += e.damage * dmgMult;
          if (this.thorns > 0) {
            const thornDmg = Math.floor(e.damage * this.thorns);
            if (thornDmg > 0) this.damage(e, thornDmg, false);
          }
          e.attackCooldown += 1 / e.fireRate;
        }
      } else {
        let speedMult = hasteMultipliers.get(e.id) ?? 1;
        if (this.retributionBuffs.has(e.id)) speedMult *= RETRIBUTION_BUFF_SPEED_MULT;
        const inv = e.speed * this.slowFactor * speedMult * dt / d;
        e.x += dx * inv;
        e.y += dy * inv;
      }

      // Healer AI: every healCooldown seconds, find lowest-HP non-healer ally
      // within healRange and restore healFraction of its maxHP.
      if (e.type === 'healer' && (e.healCooldown ?? 0) > 0) {
        e.healCooldown = (e.healCooldown ?? 0) - dt;
        if (e.healCooldown <= 0) {
          const def = ENEMY_DEFS.healer;
          const range = def.healRange ?? 150;
          const fraction = def.healFraction ?? 0.15;
          const cooldownReset = def.healCooldown ?? 2.5;
          // Find lowest-HP non-healer alive ally in range
          let target: Enemy | null = null;
          let lowestRatio = 1;
          for (const other of this.enemies) {
            if (!other.alive) continue;
            if (other.id === e.id) continue;
            if (other.type === 'healer') continue;
            if (other.hp >= other.maxHp) continue;
            const ddx = other.x - e.x;
            const ddy = other.y - e.y;
            if (ddx * ddx + ddy * ddy > range * range) continue;
            const r = other.hp / other.maxHp;
            if (r < lowestRatio) {
              lowestRatio = r;
              target = other;
            }
          }
          if (target) {
            const heal = Math.max(1, Math.floor(target.maxHp * fraction));
            target.hp = Math.min(target.maxHp, target.hp + heal);
            this.bus.emit('enemy_healed', { healer: e, target, amount: heal });
            e.healCooldown = cooldownReset;
          } else {
            // Don't fully reset: small partial decay so healer still has cadence
            e.healCooldown = 0.5;
          }
        }
      }
    }

    if (newlyReached.length > 0) {
      this.bus.emit('enemies_reached_tower', newlyReached);
    }
    if (totalDamage > 0) {
      this.bus.emit('tower_damaged', totalDamage);
    }

    // Process vitality aura (heal nearby enemies)
    this.processVitalityAura(dt);

    // Sync retribution timers to enemy objects for renderer
    for (const e of this.enemies) {
      e.retributionTimer = this.retributionBuffs.get(e.id) ?? 0;
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
    this.goldLuckMultiplier = 0;
    this.vulnerableEnemies.clear();
    this.killStreakGoldBonus = 0;
    this.manaFullGoldBonus = 0;
    this.rpDropChanceBonus = 0;
    this.speedMult = 1;
    this.damageToTowerMult = 1;
    this.hpMult = 1;
    this.retributionBuffs.clear();
  }

  /**
   * Spawn a splitter child at given location (used for split-on-death).
   */
  spawnSplitterChild(parent: Enemy, wave: number, x: number, y: number): Enemy {
    const def = ENEMY_DEFS.splitter;
    const childHp = Math.max(1, Math.floor(parent.maxHp * (def.splitHpFraction ?? 0.5)));
    const childSpeed = parent.speed * (def.splitSpeedMultiplier ?? 1.4);
    const childGold = Math.max(1, Math.floor(parent.goldValue * 0.5));
    const childDamage = Math.max(1, Math.floor(parent.damage * 0.7));
    return this.spawn('splitter', wave, x, y, {
      hp: childHp,
      maxHp: childHp,
      speed: childSpeed,
      goldValue: childGold,
      damage: childDamage,
      isSplitChild: true,
      elite: false,
      aura: null,
    });
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

  /**
   * Compute haste aura multipliers for all enemies.
   * Enemies near a haste elite get +50% speed.
   */
  private computeHasteMultipliers(): Map<number, number> {
    const result = new Map<number, number>();
    const r2 = AURA_RADIUS * AURA_RADIUS;
    for (const e of this.enemies) {
      if (!e.alive || e.aura !== 'haste' || !e.elite) continue;
      for (const other of this.enemies) {
        if (!other.alive || other.id === e.id) continue;
        const dx = other.x - e.x;
        const dy = other.y - e.y;
        if (dx * dx + dy * dy <= r2) {
          const existing = result.get(other.id) ?? 1;
          result.set(other.id, existing * (1 + HASTE_SPEED_BONUS));
        }
      }
    }
    return result;
  }

  /**
   * Process vitality aura: elite heals nearby enemies for 1% maxHP/s.
   */
  private processVitalityAura(dt: number): void {
    const r2 = AURA_RADIUS * AURA_RADIUS;
    for (const e of this.enemies) {
      if (!e.alive || e.aura !== 'vitality' || !e.elite) continue;
      for (const other of this.enemies) {
        if (!other.alive || other.id === e.id) continue;
        if (other.hp >= other.maxHp) continue;
        const dx = other.x - e.x;
        const dy = other.y - e.y;
        if (dx * dx + dy * dy > r2) continue;
        const heal = Math.max(1, Math.floor(other.maxHp * VITALITY_REGEN_FRACTION * dt));
        other.hp = Math.min(other.maxHp, other.hp + heal);
      }
    }
  }

  /**
   * Emit a thorns_reflected event when a projectile hits a thorns-aura elite.
   */
  private computeThornsReflection(damage: number): void {
    const reflected = Math.floor(damage * THORNS_REFLECT_FRACTION);
    if (reflected > 0) {
      this.bus.emit('thorns_reflected', reflected);
    }
  }

  /**
   * On death of a retribution-aura elite, buff nearby enemies.
   */
  private triggerRetribution(dead: Enemy): void {
    const r2 = AURA_RADIUS * AURA_RADIUS;
    for (const e of this.enemies) {
      if (!e.alive || e.id === dead.id) continue;
      const dx = e.x - dead.x;
      const dy = e.y - dead.y;
      if (dx * dx + dy * dy > r2) continue;
      this.retributionBuffs.set(e.id, RETRIBUTION_BUFF_DURATION);
    }
  }

  /**
   * Tick retribution buff timers.
   */
  private tickRetributionBuffs(dt: number): void {
    for (const [id, remaining] of this.retributionBuffs) {
      const next = remaining - dt;
      if (next <= 0) this.retributionBuffs.delete(id);
      else this.retributionBuffs.set(id, next);
    }
  }
}
