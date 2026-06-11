import type { AbilityId, AbilityState, Enemy } from '../types';
import {
  ABILITIES,
  ABILITY_BY_ID,
  computeEffectiveStats,
  type AbilityDef,
  type AbilityEffectType,
  type EffectiveAbilityStats,
} from '../data/abilities';
import { abilityUpgradeCost } from '../data/formulas';
import { EventBus } from '../game/EventBus';
import type { ResourceManager } from './ResourceManager';
import type { EnemyManager } from './EnemyManager';
import type { Tower } from './Tower';
import type { ProjectileManager } from './ProjectileManager';

interface AbilityManagerDeps {
  resources: ResourceManager;
  enemies: EnemyManager;
  tower: Tower;
  bus: EventBus;
  projectileManager: ProjectileManager;
  getState: (id: AbilityId) => AbilityState;
  onCast: (id: AbilityId) => void;
}

const MANA_UNLOCK_WAVE = 10;
const METEOR_SPLASH_RADIUS = 60;
const METEOR_SPLASH_MULTIPLIER = 2;
const CHAIN_BOUNCE_BASE = 5;
const CHAIN_BOUNCE_PER_LEVEL = 1;
const CHAIN_BOUNCE_MAX = 9;
const CHAIN_BOUNCE_RADIUS = 200;
const CHAIN_DECAY = 0.65;
const EXECUTE_BOSS_MULTIPLIER = 5;

export class AbilityManager {
  private readonly resources: ResourceManager;
  private readonly enemies: EnemyManager;
  private readonly tower: Tower;
  private readonly bus: EventBus;
  private readonly projectileMgr: ProjectileManager;
  private readonly getState: (id: AbilityId) => AbilityState;
  private readonly onCast: (id: AbilityId) => void;
  private goldBuffMultiplier = 1;
  private fireBuffMultiplier = 1;
  private upgradeGoldAdditive = 0;
  private abilityCostMultiplier = 1;
  private cooldownMultiplier = 1;
  private damageMultiplier = 1;
  private berserkFireBonus = 0;
  private critBonusChance = 0;
  private critBonusMultiplier = 1;
  private lifestealMultiplier = 1;
  private vampiricRegenBonus = 0;
  private lastVampiricRegenApplied = 0;

  constructor(deps: AbilityManagerDeps) {
    this.resources = deps.resources;
    this.enemies = deps.enemies;
    this.tower = deps.tower;
    this.bus = deps.bus;
    this.projectileMgr = deps.projectileManager;
    this.getState = deps.getState;
    this.onCast = deps.onCast;
  }

  isManaUnlocked(wave: number): boolean {
    return wave >= MANA_UNLOCK_WAVE;
  }

  setUpgradeGoldAdditive(value: number): void {
    this.upgradeGoldAdditive = value;
  }

  setAbilityCostMultiplier(value: number): void {
    this.abilityCostMultiplier = Math.max(0.1, Math.min(1, value));
  }

  setCooldownMultiplier(value: number): void {
    this.cooldownMultiplier = Math.max(0.1, Math.min(1, value));
  }

  setDamageMultiplier(value: number): void {
    this.damageMultiplier = Math.max(1, value);
  }

  setBerserkFireBonus(bonus: number): void {
    this.berserkFireBonus = bonus;
  }

  getAbilityLevel(id: AbilityId): number {
    const state = this.getState(id);
    if (!state) return 0;
    return Math.max(0, state.level);
  }

  isMaxed(id: AbilityId): boolean {
    const def = ABILITY_BY_ID[id];
    if (!def) return false;
    return this.getAbilityLevel(id) >= def.maxLevel;
  }

  getUnlockWave(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    return def ? def.unlockWave : MANA_UNLOCK_WAVE;
  }

  isAbilityUnlocked(id: AbilityId, wave: number): boolean {
    if (!this.isManaUnlocked(wave)) return false;
    return wave >= this.getUnlockWave(id);
  }

  /** Raw, un-discounted mana cost of the ability at the given level. */
  getBaseManaCost(id: AbilityId, level: number): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    const lvl = Math.max(1, Math.min(def.maxLevel, level));
    return def.manaCost + def.manaCostPerLevel * (lvl - 1);
  }

  /** Raw, un-discounted cooldown of the ability at the given level. */
  getBaseCooldown(id: AbilityId, level: number): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    const lvl = Math.max(1, Math.min(def.maxLevel, level));
    return Math.max(1, def.cooldown - def.cooldownReductionPerLevel * (lvl - 1));
  }

  getEffectiveManaCost(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    return Math.max(1, Math.ceil(this.getBaseManaCost(id, this.getAbilityLevel(id)) * this.abilityCostMultiplier));
  }

  getEffectiveCooldown(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    return Math.max(1, this.getBaseCooldown(id, this.getAbilityLevel(id)) * this.cooldownMultiplier);
  }

  getEffectiveEffectValue(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    const level = this.getAbilityLevel(id);
    return def.effectValue + def.effectValuePerLevel * (level - 1);
  }

  getEffectiveDuration(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    const level = this.getAbilityLevel(id);
    return def.duration + def.durationPerLevel * (level - 1);
  }

  getEffectiveStats(id: AbilityId): EffectiveAbilityStats {
    const def = ABILITY_BY_ID[id];
    const level = this.getAbilityLevel(id);
    const stats = computeEffectiveStats(def, level);
    // Apply multipliers + costs on top of the static compute.
    stats.manaCost = Math.max(1, Math.ceil(stats.manaCost * this.abilityCostMultiplier));
    stats.cooldown = Math.max(1, stats.cooldown * this.cooldownMultiplier);
    stats.upgradeCost = this.getUpgradeCost(id);
    stats.isMaxed = def ? level >= def.maxLevel : true;
    return stats;
  }

  getUpgradeCost(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    const level = this.getAbilityLevel(id);
    if (level >= def.maxLevel) return 0;
    return abilityUpgradeCost(def.upgradeBaseCost, def.upgradeCostGrowth, level);
  }

  canUpgrade(id: AbilityId, wave: number): boolean {
    if (!this.isAbilityUnlocked(id, wave)) return false;
    if (this.isMaxed(id)) return false;
    const cost = this.getUpgradeCost(id);
    if (cost <= 0) return false;
    if (!this.resources.canAfford(cost)) return false;
    return true;
  }

  upgradeAbility(id: AbilityId): boolean {
    if (this.isMaxed(id)) return false;
    const def = ABILITY_BY_ID[id];
    if (!def) return false;
    const cost = this.getUpgradeCost(id);
    if (cost <= 0) return false;
    if (!this.resources.spendGold(cost)) return false;
    const state = this.getState(id);
    state.level = Math.min(def.maxLevel, state.level + 1);
    this.bus.emit('ability_upgraded', { id, level: state.level });
    return true;
  }

  effectiveManaCost(def: { manaCost: number }): number {
    return Math.max(1, Math.ceil(def.manaCost * this.abilityCostMultiplier));
  }

  canCast(id: AbilityId, wave: number): boolean {
    if (!this.isAbilityUnlocked(id, wave)) return false;
    const state = this.getState(id);
    if (!state || state.level <= 0) return false;
    if (state.cooldown > 0) return false;
    if (this.resources.mana < this.getEffectiveManaCost(id)) return false;
    return true;
  }

  reasonBlocked(id: AbilityId, wave: number): string | null {
    if (!this.isManaUnlocked(wave)) {
      return `Unlocks at wave ${MANA_UNLOCK_WAVE}`;
    }
    const unlockWave = this.getUnlockWave(id);
    if (unlockWave > MANA_UNLOCK_WAVE && wave < unlockWave) {
      return `Unlocks at wave ${unlockWave}`;
    }
    const state = this.getState(id);
    if (!state || state.level <= 0) return 'Locked';
    if (state.cooldown > 0) {
      return `${state.cooldown.toFixed(1)}s`;
    }
    if (this.resources.mana < this.getEffectiveManaCost(id)) {
      return 'Not enough mana';
    }
    return null;
  }

  tryCast(id: AbilityId, wave: number): boolean {
    if (!this.canCast(id, wave)) return false;
    const def = ABILITY_BY_ID[id];
    if (!def) return false;
    this.resources.spendMana(this.getEffectiveManaCost(id));
    const state = this.getState(id);
    state.cooldown = this.getEffectiveCooldown(id);
    const duration = this.getEffectiveDuration(id);
    if (duration > 0) {
      state.active = true;
      state.activeTimer = duration;
    } else {
      state.active = false;
      state.activeTimer = 0;
    }
    const visualTarget = this.applyEffect(def.effectType, this.getEffectiveEffectValue(id), duration);
    this.bus.emit('ability_cast', { id, def });
    this.bus.emit('ability_visual', { id, def, target: visualTarget });
    this.onCast(id);
    return true;
  }

  castByHotkey(key: string, wave: number): boolean {
    const def = ABILITIES.find(a => a.hotkey === key);
    if (!def) return false;
    return this.tryCast(def.id, wave);
  }

  tick(dt: number): void {
    for (const def of ABILITIES) {
      const state = this.getState(def.id);
      if (state.cooldown > 0) {
        const prev = state.cooldown;
        state.cooldown = Math.max(0, state.cooldown - dt);
        if (state.cooldown === 0 && prev > 0) {
          this.bus.emit('ability_ready', { id: def.id });
        }
      }
      if (state.active) {
        state.activeTimer = Math.max(0, state.activeTimer - dt);
        if (state.activeTimer <= 0) {
          state.active = false;
          this.clearEffect(def.effectType);
        }
      }
    }
    this.applyOngoingBuffs();
  }

  private applyEffect(type: AbilityEffectType, value: number, duration: number): { x: number; y: number } | null {
    switch (type) {
      case 'aoe_damage':
        this.dealAoEDamage(value);
        return null;
      case 'slow':
        this.enemies.applySlow(value, duration);
        return null;
      case 'fire_rate_buff':
        this.fireBuffMultiplier = value * (1 + this.berserkFireBonus);
        return null;
      case 'gold_buff':
        this.goldBuffMultiplier = value;
        return null;
      case 'single_target_damage':
        return this.dealMeteorStrike(value);
      case 'chain_damage':
        this.dealChainLightning(value);
        return null;
      case 'crit_buff': {
        // value = bonus crit chance in percentage points
        this.critBonusChance = Math.max(0, Math.min(1, value / 100));
        this.critBonusMultiplier = 1.5;
        return null;
      }
      case 'lifesteal_buff': {
        this.lifestealMultiplier = Math.max(1, value);
        this.vampiricRegenBonus = 0.01;
        return null;
      }
      case 'execute_damage':
        this.applyExecute(value);
        return null;
      case 'multishot':
        this.applyMultishot(value);
        return null;
    }
  }

  private clearEffect(type: AbilityEffectType): void {
    switch (type) {
      case 'fire_rate_buff':
        this.fireBuffMultiplier = 1;
        break;
      case 'gold_buff':
        this.goldBuffMultiplier = 1;
        break;
      case 'crit_buff':
        this.critBonusChance = 0;
        this.critBonusMultiplier = 1;
        break;
      case 'lifesteal_buff':
        this.lifestealMultiplier = 1;
        this.vampiricRegenBonus = 0;
        break;
      case 'slow':
      case 'aoe_damage':
      case 'single_target_damage':
      case 'chain_damage':
      case 'execute_damage':
        break;
    }
  }

  private applyOngoingBuffs(): void {
    this.tower.setFireRateMultiplier(this.fireBuffMultiplier);
    this.tower.setCritBonus(this.critBonusChance, this.critBonusMultiplier);
    this.tower.setLifestealMultiplier(this.lifestealMultiplier);
    this.enemies.setGoldMultipliers(this.upgradeGoldAdditive, this.goldBuffMultiplier);
    const ts = this.tower.snapshot;
    if (this.lastVampiricRegenApplied !== 0) {
      ts.healthRegen -= this.lastVampiricRegenApplied;
      this.lastVampiricRegenApplied = 0;
    }
    if (this.vampiricRegenBonus > 0) {
      ts.healthRegen += this.vampiricRegenBonus;
      this.lastVampiricRegenApplied = this.vampiricRegenBonus;
    }
  }

  private dealAoEDamage(multiplier: number): void {
    const towerState = this.tower.snapshot;
    const raw = towerState.baseDamage * multiplier * this.damageMultiplier;
    let hitCount = 0;
    for (const enemy of this.enemies.list) {
      if (!enemy.alive) continue;
      const final = this.tower.applyResists(enemy, raw);
      this.enemies.damage(enemy, final, false);
      hitCount += 1;
    }
    if (hitCount > 0) {
      this.bus.emit('aoe_hit', { hitCount, totalDamage: raw, perEnemy: raw });
    }
  }

  private pickHighestHpTarget(): Enemy | null {
    let best: Enemy | null = null;
    let bestHp = -Infinity;
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      if (e.maxHp > bestHp) {
        bestHp = e.maxHp;
        best = e;
      }
    }
    return best;
  }

  private dealMeteorStrike(multiplier: number): { x: number; y: number } | null {
    const target = this.pickHighestHpTarget();
    if (!target) return null;
    const towerState = this.tower.snapshot;
    const heavyRaw = towerState.baseDamage * multiplier * this.damageMultiplier;
    const heavyFinal = this.tower.applyResists(target, heavyRaw);
    this.enemies.damage(target, heavyFinal, false);

    const splashRaw = heavyRaw * METEOR_SPLASH_MULTIPLIER;
    const r2 = METEOR_SPLASH_RADIUS * METEOR_SPLASH_RADIUS;
    let splashCount = 0;
    for (const e of this.enemies.list) {
      if (!e.alive || e.id === target.id) continue;
      const dx = e.x - target.x;
      const dy = e.y - target.y;
      if (dx * dx + dy * dy > r2) continue;
      const final = this.tower.applyResists(e, splashRaw);
      this.enemies.damage(e, final, false);
      splashCount += 1;
    }
    this.bus.emit('aoe_hit', {
      hitCount: 1 + splashCount,
      totalDamage: heavyFinal + splashRaw * splashCount,
      perEnemy: heavyFinal,
    });
    return { x: target.x, y: target.y };
  }

  private dealChainLightning(baseMultiplier: number): void {
    const list = this.enemies.list;
    if (list.length === 0) return;
    const towerState = this.tower.snapshot;
    const level = this.getAbilityLevel('chain_lightning');
    const bounces = Math.min(CHAIN_BOUNCE_MAX, CHAIN_BOUNCE_BASE + (level - 1) * CHAIN_BOUNCE_PER_LEVEL);
    const r2 = CHAIN_BOUNCE_RADIUS * CHAIN_BOUNCE_RADIUS;
    const hit = new Set<number>();

    let current: Enemy | null = null;
    let bestD2 = Infinity;
    const tx = towerState.x;
    const ty = towerState.y;
    for (const e of list) {
      if (!e.alive) continue;
      const dx = e.x - tx;
      const dy = e.y - ty;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        current = e;
      }
    }
    if (!current) return;

    const path: { x: number; y: number }[] = [{ x: tx, y: ty }, { x: current.x, y: current.y }];
    let totalDamage = 0;
    let perEnemy = 0;
    for (let i = 0; i < bounces && current; i++) {
      hit.add(current.id);
      const dmg = towerState.baseDamage * baseMultiplier * Math.pow(CHAIN_DECAY, i) * this.damageMultiplier;
      const final = this.tower.applyResists(current, dmg);
      this.enemies.damage(current, final, false);
      totalDamage += final;
      perEnemy = final;

      let next: Enemy | null = null;
      let bestND2 = Infinity;
      for (const e of list) {
        if (!e.alive) continue;
        if (hit.has(e.id)) continue;
        const dx = e.x - current!.x;
        const dy = e.y - current!.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        if (d2 < bestND2) {
          bestND2 = d2;
          next = e;
        }
      }
      if (next) {
        path.push({ x: next.x, y: next.y });
      }
      current = next;
    }
    if (totalDamage > 0) {
      this.bus.emit('chain_lightning', { path, totalDamage, perEnemy });
    }
  }

  private applyExecute(thresholdPct: number): void {
    const towerState = this.tower.snapshot;
    const bossThreshold = thresholdPct / 2;
    let kills = 0;
    let totalDamage = 0;
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const ratio = e.hp / e.maxHp;
      if (e.type === 'boss') {
        if (ratio > bossThreshold) continue;
        const dmg = towerState.baseDamage * EXECUTE_BOSS_MULTIPLIER * this.damageMultiplier;
        const final = this.tower.applyResists(e, dmg);
        this.enemies.damage(e, final, false);
        totalDamage += final;
      } else {
        if (ratio > thresholdPct / 100) continue;
        // Instant-kill: deal damage equal to current HP (minimum 1)
        const final = Math.max(1, e.hp);
        this.enemies.damage(e, final, false);
        totalDamage += final;
        kills += 1;
      }
    }
    if (kills > 0 || totalDamage > 0) {
      this.bus.emit('execute_hit', { kills, totalDamage });
    }
  }

  private applyMultishot(value: number): void {
    const count = Math.floor(value);
    const towerState = this.tower.snapshot;
    const alive = this.enemies.list.filter(e => e.alive);
    let totalDamage = 0;
    const fired: Array<{ id: number }> = [];

    if (alive.length === 0) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const rawDamage = towerState.baseDamage * 2 * this.damageMultiplier;
        totalDamage += rawDamage;
        this.projectileMgr.fire(null, towerState, {
          rawDamage,
          damageType: towerState.damageType,
          isCrit: false,
          targetId: null,
          isHoming: false,
          aimX: towerState.x + Math.cos(angle) * 100,
          aimY: towerState.y + Math.sin(angle) * 100,
        });
      }
    } else {
      const shuffled = [...alive].sort(() => Math.random() - 0.5);
      for (let i = 0; i < count; i++) {
        const target = i < shuffled.length ? shuffled[i] : alive[Math.floor(Math.random() * alive.length)];
        const rawDamage = towerState.baseDamage * 2 * this.damageMultiplier;
        totalDamage += rawDamage;
        this.projectileMgr.fire(target, towerState, {
          rawDamage,
          damageType: towerState.damageType,
          isCrit: false,
          targetId: target.id,
          isHoming: true,
          turnRate: Math.PI * 3,
          lifetime: 3,
        });
        fired.push({ id: target.id });
      }
    }

    if (fired.length > 0 || count > 0) {
      this.bus.emit('multishot_fired', { count: Math.max(fired.length, count), totalDamage });
    }
  }

  reset(): void {
    for (const def of ABILITIES) {
      const state = this.getState(def.id);
      state.cooldown = 0;
      state.active = false;
      state.activeTimer = 0;
    }
    this.goldBuffMultiplier = 1;
    this.fireBuffMultiplier = 1;
    this.abilityCostMultiplier = 1;
    this.cooldownMultiplier = 1;
    this.critBonusChance = 0;
    this.critBonusMultiplier = 1;
    this.lifestealMultiplier = 1;
    this.vampiricRegenBonus = 0;
    this.lastVampiricRegenApplied = 0;
    this.tower.setFireRateMultiplier(1);
    this.tower.setCritBonus(0, 1);
    this.tower.setLifestealMultiplier(1);
  }

  /** Reset every ability to level 1 (used by Transcendence). */
  resetLevels(): void {
    for (const def of ABILITIES) {
      const state = this.getState(def.id);
      state.level = 1;
      state.cooldown = 0;
      state.active = false;
      state.activeTimer = 0;
    }
  }
}

export type { AbilityDef };
