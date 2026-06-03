import type { AbilityId, AbilityState } from '../types';
import { ABILITIES, ABILITY_BY_ID } from '../data/abilities';
import { EventBus } from '../game/EventBus';
import type { ResourceManager } from './ResourceManager';
import type { EnemyManager } from './EnemyManager';
import type { Tower } from './Tower';

interface AbilityManagerDeps {
  resources: ResourceManager;
  enemies: EnemyManager;
  tower: Tower;
  bus: EventBus;
  getState: (id: AbilityId) => AbilityState;
  onCast: (id: AbilityId) => void;
}

const MANA_UNLOCK_WAVE = 10;

type EffectType = 'aoe_damage' | 'slow' | 'fire_rate_buff' | 'gold_buff';

export class AbilityManager {
  private readonly resources: ResourceManager;
  private readonly enemies: EnemyManager;
  private readonly tower: Tower;
  private readonly bus: EventBus;
  private readonly getState: (id: AbilityId) => AbilityState;
  private readonly onCast: (id: AbilityId) => void;
  private goldBuffMultiplier = 1;
  private fireBuffMultiplier = 1;
  private upgradeGoldAdditive = 0;
  private abilityCostMultiplier = 1;
  private cooldownMultiplier = 1;
  private damageMultiplier = 1;
  private berserkFireBonus = 0;

  constructor(deps: AbilityManagerDeps) {
    this.resources = deps.resources;
    this.enemies = deps.enemies;
    this.tower = deps.tower;
    this.bus = deps.bus;
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

  effectiveManaCost(def: { manaCost: number }): number {
    return Math.max(1, Math.ceil(def.manaCost * this.abilityCostMultiplier));
  }

  canCast(id: AbilityId, wave: number): boolean {
    if (!this.isManaUnlocked(wave)) return false;
    const def = ABILITY_BY_ID[id];
    if (!def) return false;
    const state = this.getState(id);
    if (state.level <= 0) return false;
    if (state.cooldown > 0) return false;
    if (this.resources.mana < this.effectiveManaCost(def)) return false;
    return true;
  }

  reasonBlocked(id: AbilityId, wave: number): string | null {
    if (!this.isManaUnlocked(wave)) {
      return `Unlocks at wave ${MANA_UNLOCK_WAVE}`;
    }
    const state = this.getState(id);
    if (state.level <= 0) return 'Locked';
    if (state.cooldown > 0) {
      return `${state.cooldown.toFixed(1)}s`;
    }
    const def = ABILITY_BY_ID[id];
    if (this.resources.mana < this.effectiveManaCost(def)) {
      return 'Not enough mana';
    }
    return null;
  }

  tryCast(id: AbilityId, wave: number): boolean {
    if (!this.canCast(id, wave)) return false;
    const def = ABILITY_BY_ID[id];
    this.resources.spendMana(this.effectiveManaCost(def));
    const state = this.getState(id);
    state.cooldown = def.cooldown * this.cooldownMultiplier;
    if (def.duration > 0) {
      state.active = true;
      state.activeTimer = def.duration;
    }
    this.applyEffect(def.effectType, def.effectValue, def.duration);
    this.bus.emit('ability_cast', { id, def });
    this.bus.emit('ability_visual', { id, def });
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

  private applyEffect(type: EffectType, value: number, duration: number): void {
    switch (type) {
      case 'aoe_damage':
        this.dealAoEDamage(value);
        break;
      case 'slow':
        this.enemies.applySlow(value, duration);
        break;
      case 'fire_rate_buff':
        this.fireBuffMultiplier = value * (1 + this.berserkFireBonus);
        break;
      case 'gold_buff':
        this.goldBuffMultiplier = value;
        break;
    }
  }

  private clearEffect(type: EffectType): void {
    switch (type) {
      case 'fire_rate_buff':
        this.fireBuffMultiplier = 1;
        break;
      case 'gold_buff':
        this.goldBuffMultiplier = 1;
        break;
      case 'slow':
      case 'aoe_damage':
        break;
    }
  }

  private applyOngoingBuffs(): void {
    this.tower.setFireRateMultiplier(this.fireBuffMultiplier);
    this.enemies.setGoldMultipliers(this.upgradeGoldAdditive, this.goldBuffMultiplier);
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
    this.tower.setFireRateMultiplier(1);
  }
}
