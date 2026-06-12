import type { EnemyType, PassiveAbilityState } from '../types';
import { PASSIVE_ABILITIES, PASSIVE_BY_ID, passiveUpgradeCost } from '../data/passiveAbilities';
import { passiveXpForLevel } from '../data/xpTables';
import { EventBus } from '../game/EventBus';

const PASSIVE_XP_MULTIPLIER = 0.07;

export class PassiveAbilityManager {
  private state: Record<string, PassiveAbilityState>;
  private readonly bus: EventBus;

  constructor(
    state: Record<string, PassiveAbilityState>,
    bus: EventBus,
  ) {
    this.state = state;
    this.bus = bus;
  }

  ensureInitialized(): void {
    for (const def of PASSIVE_ABILITIES) {
      if (!this.state[def.id]) {
        this.state[def.id] = { level: 0, xp: 0, unlocked: false };
      } else if (this.state[def.id].unlocked === undefined) {
        this.state[def.id].unlocked = false;
      }
    }
  }

  addKillXp(_enemyType: EnemyType, _wave: number): void {
    for (const def of PASSIVE_ABILITIES) {
      const s = this.state[def.id];
      if (!s || !s.unlocked) continue;
      this.addXp(def, s, def.xpPerKill);
    }
  }

  addWaveClearXp(_wave: number): void {
    for (const def of PASSIVE_ABILITIES) {
      const s = this.state[def.id];
      if (!s || !s.unlocked) continue;
      this.addXp(def, s, def.xpPerWave);
    }
  }

  private addXp(def: typeof PASSIVE_ABILITIES[number], state: PassiveAbilityState, amount: number): void {
    if (amount <= 0) return;
    if (state.level >= def.maxLevel) return;
    state.xp += amount * PASSIVE_XP_MULTIPLIER;
    this.checkLevelUp(def, state);
  }

  private checkLevelUp(def: typeof PASSIVE_ABILITIES[number], state: PassiveAbilityState): void {
    while (state.level < def.maxLevel) {
      const needed = passiveXpForLevel(state.level + 1);
      if (state.xp < needed) break;
      state.xp -= needed;
      state.level += 1;
      this.bus.emit('passive_leveled', { id: def.id, level: state.level });
    }
  }

  getEffectValue(stat: string): number {
    let total = 0;
    this.ensureInitialized();
    for (const def of PASSIVE_ABILITIES) {
      if (def.stat !== stat) continue;
      const s = this.state[def.id];
      if (!s || !s.unlocked || s.level <= 0) continue;
      total += def.basePercent + def.perLevelPercent * s.level;
    }
    return total;
  }

  getLevel(id: string): number {
    const s = this.state[id];
    return s?.level ?? 0;
  }

  getXp(id: string): number {
    const s = this.state[id];
    return s?.xp ?? 0;
  }

  isUnlocked(id: string): boolean {
    const s = this.state[id];
    return s?.unlocked ?? false;
  }

  isMaxed(id: string): boolean {
    const s = this.state[id];
    if (!s) return false;
    const def = PASSIVE_BY_ID[id];
    return def ? s.level >= def.maxLevel : true;
  }

  canUnlock(id: string, wave: number): boolean {
    const s = this.state[id];
    if (!s || s.unlocked) return false;
    const def = PASSIVE_BY_ID[id];
    if (!def) return false;
    return wave >= def.unlockWave;
  }

  getUnlockCost(id: string): number {
    const def = PASSIVE_BY_ID[id];
    return def?.unlockGoldCost ?? 0;
  }

  unlock(id: string): void {
    const s = this.state[id];
    if (!s || s.unlocked) return;
    s.unlocked = true;
  }

  getUpgradeCost(id: string): number {
    const def = PASSIVE_BY_ID[id];
    if (!def) return 0;
    const s = this.state[id];
    if (!s || !s.unlocked || s.level >= def.maxLevel) return 0;
    const baseCost = passiveUpgradeCost(def, s.level);
    if (baseCost <= 0) return 0;
    const needed = passiveXpForLevel(s.level + 1);
    if (needed <= 0) return baseCost;
    const discount = Math.min(1, s.xp / needed);
    return Math.max(1, Math.floor(baseCost * (1 - discount)));
  }

  canUpgrade(id: string, gold: number): boolean {
    const s = this.state[id];
    if (!s || !s.unlocked) return false;
    const def = PASSIVE_BY_ID[id];
    if (!def || s.level >= def.maxLevel) return false;
    return gold >= this.getUpgradeCost(id);
  }

  upgrade(id: string): number {
    const def = PASSIVE_BY_ID[id];
    if (!def) return 0;
    const s = this.state[id];
    if (!s || !s.unlocked || s.level >= def.maxLevel) return 0;
    const cost = this.getUpgradeCost(id);
    if (cost <= 0) return 0;
    s.level += 1;
    s.xp = 0;
    this.bus.emit('passive_leveled', { id, level: s.level });
    return cost;
  }

  reset(): void {
    for (const key of Object.keys(this.state)) {
      this.state[key] = { level: 0, xp: 0, unlocked: false };
    }
  }
}
