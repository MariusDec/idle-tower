import type { UpgradeDef, UpgradeEvolution } from '../types';
import { UPGRADES } from '../data/upgrades';
import { upgradeCost } from '../data/formulas';
import type { ResourceManager } from './ResourceManager';
import { EventBus } from '../game/EventBus';

export class UpgradeManager {
  private levels: Record<string, number> = {};
  private readonly bus: EventBus;
  private readonly resources: ResourceManager;

  constructor(bus: EventBus, resources: ResourceManager) {
    this.bus = bus;
    this.resources = resources;
    for (const u of UPGRADES) {
      this.levels[u.id] = u.startLevel ?? 0;
    }
  }

  get all(): UpgradeDef[] {
    return UPGRADES;
  }

  getLevel(id: string): number {
    return this.levels[id] ?? 0;
  }

  getCost(id: string): number {
    const def = UPGRADES.find(u => u.id === id);
    if (!def) return Infinity;
    if (this.isMaxed(id)) return Infinity;
    return upgradeCost(def.baseCost, def.costGrowth, this.levels[id] ?? 0);
  }

  isMaxed(id: string): boolean {
    const def = UPGRADES.find(u => u.id === id);
    if (!def) return true;
    const level = this.levels[id] ?? 0;
    return def.maxLevel > 0 && level >= def.maxLevel;
  }

  canAfford(id: string): boolean {
    if (this.isMaxed(id)) return false;
    return this.resources.canAfford(this.getCost(id));
  }

  buy(id: string): boolean {
    const def = UPGRADES.find(u => u.id === id);
    if (!def) return false;
    if (this.isMaxed(id)) return false;
    const level = this.levels[id] ?? 0;
    const cost = upgradeCost(def.baseCost, def.costGrowth, level);
    if (!this.resources.spendGold(cost)) return false;
    const newLevel = level + 1;
    this.levels[id] = newLevel;
    this.bus.emit('upgrade_purchased', { id, level: newLevel });
    this.bus.emit('upgrades_changed', { ...this.levels });
    if (def.evolutions) {
      for (const evo of def.evolutions) {
        if (newLevel === evo.level) {
          this.bus.emit('upgrade_evolved', { id, level: newLevel, evolution: evo });
        }
      }
    }
    return true;
  }

  getActiveEvolutions(id: string): UpgradeEvolution[] {
    const def = UPGRADES.find(u => u.id === id);
    if (!def || !def.evolutions) return [];
    const level = this.levels[id] ?? 0;
    return def.evolutions.filter(e => level >= e.level);
  }

  getHighestEvolution(id: string): UpgradeEvolution | null {
    const active = this.getActiveEvolutions(id);
    if (active.length === 0) return null;
    return active[active.length - 1];
  }

  getNextEvolution(id: string): UpgradeEvolution | null {
    const def = UPGRADES.find(u => u.id === id);
    if (!def || !def.evolutions) return null;
    const level = this.levels[id] ?? 0;
    for (const evo of def.evolutions) {
      if (level < evo.level) return evo;
    }
    return null;
  }

  hasEvolutionEffect(effectId: string): boolean {
    for (const u of UPGRADES) {
      if (!u.evolutions) continue;
      const level = this.levels[u.id] ?? 0;
      for (const evo of u.evolutions) {
        if (level >= evo.level && evo.effectId === effectId) return true;
      }
    }
    return false;
  }

  getEvolutionEffectValue(effectId: string): number {
    for (const u of UPGRADES) {
      if (!u.evolutions) continue;
      const level = this.levels[u.id] ?? 0;
      let value = 0;
      for (const evo of u.evolutions) {
        if (level >= evo.level && evo.effectId === effectId) {
          value = evo.effectValue;
        }
      }
      if (value > 0) return value;
    }
    return 0;
  }

  reset(): void {
    for (const u of UPGRADES) {
      this.levels[u.id] = u.startLevel ?? 0;
    }
    this.bus.emit('upgrades_changed', { ...this.levels });
  }

  replaceLevels(levels: Record<string, number>): void {
    for (const u of UPGRADES) {
      const start = u.startLevel ?? 0;
      this.levels[u.id] = Math.max(start, levels[u.id] ?? 0);
    }
    this.bus.emit('upgrades_changed', { ...this.levels });
  }

  snapshot(): Record<string, number> {
    return { ...this.levels };
  }
}
