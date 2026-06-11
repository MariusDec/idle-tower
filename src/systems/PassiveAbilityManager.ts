import type { EnemyType } from '../types';
import { PASSIVE_ABILITIES, passiveEffectValue } from '../data/passiveAbilities';
import { passiveXpForLevel } from '../data/xpTables';
import { EventBus } from '../game/EventBus';

export class PassiveAbilityManager {
  private state: Record<string, { level: number; xp: number }>;
  private readonly bus: EventBus;

  constructor(
    state: Record<string, { level: number; xp: number }>,
    bus: EventBus,
  ) {
    this.state = state;
    this.bus = bus;
  }

  ensureInitialized(): void {
    for (const def of PASSIVE_ABILITIES) {
      if (!this.state[def.id]) {
        this.state[def.id] = { level: 0, xp: 0 };
      }
    }
  }

  addKillXp(_enemyType: EnemyType, wave: number): void {
    for (const def of PASSIVE_ABILITIES) {
      if (wave < def.unlockWave) continue;
      const s = this.state[def.id];
      if (!s) continue;
      this.addXp(def, s, def.xpPerKill);
    }
  }

  addWaveClearXp(wave: number): void {
    for (const def of PASSIVE_ABILITIES) {
      if (wave < def.unlockWave) continue;
      const s = this.state[def.id];
      if (!s) continue;
      this.addXp(def, s, def.xpPerWave);
    }
  }

  private addXp(def: typeof PASSIVE_ABILITIES[number], state: { level: number; xp: number }, amount: number): void {
    if (amount <= 0) return;
    if (state.level >= def.maxLevel) return;
    state.xp += amount;
    this.checkLevelUp(def, state);
  }

  private checkLevelUp(def: typeof PASSIVE_ABILITIES[number], state: { level: number; xp: number }): void {
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
      if (!s || s.level <= 0) continue;
      total += passiveEffectValue(def, s.level);
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

  isUnlocked(wave: number, unlockWave: number): boolean {
    return wave >= unlockWave;
  }

  reset(): void {
    for (const key of Object.keys(this.state)) {
      this.state[key] = { level: 0, xp: 0 };
    }
  }
}
