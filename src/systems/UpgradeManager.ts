import type { UpgradeDef } from '../types';
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
      this.levels[u.id] = 0;
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
    this.levels[id] = level + 1;
    this.bus.emit('upgrade_purchased', { id, level: this.levels[id] });
    this.bus.emit('upgrades_changed', { ...this.levels });
    return true;
  }

  reset(): void {
    for (const u of UPGRADES) {
      this.levels[u.id] = 0;
    }
    this.bus.emit('upgrades_changed', { ...this.levels });
  }

  replaceLevels(levels: Record<string, number>): void {
    for (const u of UPGRADES) {
      this.levels[u.id] = levels[u.id] ?? 0;
    }
    this.bus.emit('upgrades_changed', { ...this.levels });
  }

  snapshot(): Record<string, number> {
    return { ...this.levels };
  }
}
