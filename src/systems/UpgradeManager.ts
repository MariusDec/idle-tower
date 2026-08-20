import type { UpgradeDef, UpgradeEvolution } from '../types';
import { UPGRADES, UPGRADE_BY_ID } from '../data/upgrades';
import { upgradeCost } from '../data/formulas';
import type { ResourceManager } from './ResourceManager';
import { EventBus } from '../game/EventBus';

/**
 * Hard ceiling on how many levels a single "max" purchase may walk, so an
 * unbounded upgrade with a cheap early curve cannot spin the loop forever.
 */
const MAX_BULK_LEVELS = 1000;

/** What a bulk purchase would buy: how many levels, and what they cost in total. */
export interface BulkPlan {
  levels: number;
  cost: number;
}

export class UpgradeManager {
  private levels: Record<string, number> = {};
  private readonly bus: EventBus;
  private readonly resources: ResourceManager;
  private costDiscount = 0;
  /**
   * Evolution effects unlocked by the current levels (plan §5.8).
   *
   * `hasEvolutionEffect` is called several times per frame from
   * `Game.update`, and each call used to walk every upgrade's every evolution.
   * The answer only changes when a level changes, so it is computed there
   * instead. `activeEvolutionIds` keeps the "is it unlocked" semantics (an
   * evolution with `effectValue: 0` still counts) separate from the value
   * lookup, which reports the first upgrade in table order with a non-zero
   * value — same as the linear scan it replaces.
   */
  private activeEvolutionIds = new Set<string>();
  private activeEvolutionValues = new Map<string, number>();

  constructor(bus: EventBus, resources: ResourceManager) {
    this.bus = bus;
    this.resources = resources;
    for (const u of UPGRADES) {
      this.levels[u.id] = u.startLevel ?? 0;
    }
    this.rebuildEvolutionCache();
  }

  setCostDiscount(discount: number): void {
    this.costDiscount = Math.min(0, Math.max(-0.5, discount));
  }

  get all(): UpgradeDef[] {
    return UPGRADES;
  }

  getLevel(id: string): number {
    return this.levels[id] ?? 0;
  }

  getCost(id: string): number {
    const def = UPGRADE_BY_ID[id];
    if (!def) return Infinity;
    if (this.isMaxed(id)) return Infinity;
    const cost = upgradeCost(def.baseCost, def.costGrowth, this.levels[id] ?? 0);
    return Math.floor(cost * (1 + this.costDiscount));
  }

  /** Cost of the single level that takes this upgrade from `level` to `level + 1`. */
  private costAtLevel(def: UpgradeDef, level: number): number {
    return Math.floor(upgradeCost(def.baseCost, def.costGrowth, level) * (1 + this.costDiscount));
  }

  /**
   * What buying `count` more levels of `id` would cost.
   *
   * Costs are summed level-by-level rather than closed-form because
   * `costGrowth` may be a per-level formula string, so there is no single
   * geometric ratio to exponentiate. `levels` is clamped by `maxLevel`, so a
   * plan can come back smaller than `count` (or empty, at max).
   */
  getBulkPlan(id: string, count: number): BulkPlan {
    const def = UPGRADE_BY_ID[id];
    if (!def || count <= 0) return { levels: 0, cost: 0 };
    const start = this.levels[id] ?? 0;
    const room = def.maxLevel > 0 ? def.maxLevel - start : MAX_BULK_LEVELS;
    const levels = Math.min(count, room, MAX_BULK_LEVELS);
    if (levels <= 0) return { levels: 0, cost: 0 };
    let cost = 0;
    for (let i = 0; i < levels; i++) cost += this.costAtLevel(def, start + i);
    return { levels, cost };
  }

  /**
   * A plan that lands the upgrade on the next multiple of `step`.
   *
   * This is what the ×10 button buys: from level 18 it takes 2 levels to reach
   * 20, and from level 30 it takes the full 10 to reach 40. Buying towards a
   * round number keeps the level readout tidy and makes the button's effect
   * predictable from the level alone, which a flat "+10" does not.
   */
  getRoundedPlan(id: string, step: number): BulkPlan {
    if (step <= 1) return this.getBulkPlan(id, Math.max(1, step));
    const level = this.levels[id] ?? 0;
    const target = (Math.floor(level / step) + 1) * step;
    return this.getBulkPlan(id, target - level);
  }

  /**
   * The largest plan affordable out of `gold` (defaults to the live balance).
   * Walks levels one at a time for the same reason `getBulkPlan` does.
   */
  getMaxAffordablePlan(id: string, gold: number = this.resources.gold): BulkPlan {
    const def = UPGRADE_BY_ID[id];
    if (!def) return { levels: 0, cost: 0 };
    const start = this.levels[id] ?? 0;
    const room = def.maxLevel > 0 ? def.maxLevel - start : MAX_BULK_LEVELS;
    let levels = 0;
    let cost = 0;
    while (levels < Math.min(room, MAX_BULK_LEVELS)) {
      const next = cost + this.costAtLevel(def, start + levels);
      if (next > gold) break;
      cost = next;
      levels += 1;
    }
    return { levels, cost };
  }

  isMaxed(id: string): boolean {
    const def = UPGRADE_BY_ID[id];
    if (!def) return true;
    const level = this.levels[id] ?? 0;
    return def.maxLevel > 0 && level >= def.maxLevel;
  }

  canAfford(id: string): boolean {
    if (this.isMaxed(id)) return false;
    return this.resources.canAfford(this.getCost(id));
  }

  buy(id: string): boolean {
    const def = UPGRADE_BY_ID[id];
    if (!def) return false;
    if (this.isMaxed(id)) return false;
    const level = this.levels[id] ?? 0;
    const cost = upgradeCost(def.baseCost, def.costGrowth, level);
    const effectiveCost = Math.floor(cost * (1 + this.costDiscount));
    if (!this.resources.spendGold(effectiveCost)) return false;
    const newLevel = level + 1;
    this.levels[id] = newLevel;
    this.rebuildEvolutionCache();
    this.bus.emit('upgrade_purchased', { id, level: newLevel, levelsGained: 1 });
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

  /**
   * Buy up to `count` levels in one transaction.
   *
   * The whole plan is paid for at once and the events fire once for the batch
   * (with `levelsGained` so listeners can account for the size), rather than
   * replaying a single-level purchase N times — otherwise a x100 buy would
   * emit 100 toasts, 100 saves and 100 stat recomputes. Evolutions crossed by
   * the jump each still announce themselves.
   */
  buyBulk(id: string, count: number): number {
    const def = UPGRADE_BY_ID[id];
    if (!def) return 0;
    const plan = this.getBulkPlan(id, count);
    if (plan.levels <= 0) return 0;
    const affordable = this.getMaxAffordablePlan(id);
    const levels = Math.min(plan.levels, affordable.levels);
    if (levels <= 0) return 0;
    const cost = levels === plan.levels ? plan.cost : this.getBulkPlan(id, levels).cost;
    if (!this.resources.spendGold(cost)) return 0;

    const start = this.levels[id] ?? 0;
    const newLevel = start + levels;
    this.levels[id] = newLevel;
    this.rebuildEvolutionCache();
    this.bus.emit('upgrade_purchased', { id, level: newLevel, levelsGained: levels });
    this.bus.emit('upgrades_changed', { ...this.levels });
    if (def.evolutions) {
      for (const evo of def.evolutions) {
        if (evo.level > start && evo.level <= newLevel) {
          this.bus.emit('upgrade_evolved', { id, level: newLevel, evolution: evo });
        }
      }
    }
    return levels;
  }

  getActiveEvolutions(id: string): UpgradeEvolution[] {
    const def = UPGRADE_BY_ID[id];
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
    const def = UPGRADE_BY_ID[id];
    if (!def || !def.evolutions) return null;
    const level = this.levels[id] ?? 0;
    for (const evo of def.evolutions) {
      if (level < evo.level) return evo;
    }
    return null;
  }

  hasEvolutionEffect(effectId: string): boolean {
    return this.activeEvolutionIds.has(effectId);
  }

  getEvolutionEffectValue(effectId: string): number {
    return this.activeEvolutionValues.get(effectId) ?? 0;
  }

  /** Recompute the evolution lookups. Called from every level mutation. */
  private rebuildEvolutionCache(): void {
    this.activeEvolutionIds.clear();
    this.activeEvolutionValues.clear();
    for (const u of UPGRADES) {
      if (!u.evolutions) continue;
      const level = this.levels[u.id] ?? 0;
      // Within one upgrade the highest reached evolution wins; across
      // upgrades the first one in table order with a non-zero value does.
      const perUpgrade = new Map<string, number>();
      for (const evo of u.evolutions) {
        if (level < evo.level) continue;
        this.activeEvolutionIds.add(evo.effectId);
        perUpgrade.set(evo.effectId, evo.effectValue);
      }
      for (const [effectId, value] of perUpgrade) {
        if (value > 0 && !this.activeEvolutionValues.has(effectId)) {
          this.activeEvolutionValues.set(effectId, value);
        }
      }
    }
  }

  reset(): void {
    for (const u of UPGRADES) {
      this.levels[u.id] = u.startLevel ?? 0;
    }
    this.rebuildEvolutionCache();
    this.bus.emit('upgrades_changed', { ...this.levels });
  }

  replaceLevels(levels: Record<string, number>): void {
    for (const u of UPGRADES) {
      const start = u.startLevel ?? 0;
      this.levels[u.id] = Math.max(start, levels[u.id] ?? 0);
    }
    this.rebuildEvolutionCache();
    this.bus.emit('upgrades_changed', { ...this.levels });
  }

  snapshot(): Record<string, number> {
    return { ...this.levels };
  }
}
