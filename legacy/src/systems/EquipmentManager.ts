import type { EquipmentSlot, Equipment, EquipmentStatType, Rarity } from '../types';
import {
  rollDrop as dataRollDrop,
  equipmentSellValue,
  generateEquipment,
  upgradeRarity,
  EQUIPMENT_DEFS,
  REFORGE_COST_MULT,
  REFORGE_INPUTS,
  REFORGE_LEGENDARY_LEVEL_GAIN,
  type DropOptions,
} from '../data/equipment';
import { EventBus } from '../game/EventBus';

/**
 * Gear rolls one wave may spend, per source (plans/economy.md §3.2).
 *
 * One each. The *first* elite kill of a wave rolls for gear and the rest do
 * not; the boss gets its own roll. A miss spends the budget too — that is what
 * makes the expected value `1 x chance` rather than `elites x chance`, and it
 * is why the drop rate no longer grows with a wave's body count.
 */
const ROLLS_PER_WAVE: Record<'boss' | 'elite' | 'milestone', number> = {
  elite: 1,
  boss: 1,
  milestone: Number.POSITIVE_INFINITY,
};

export class EquipmentManager {
  private inventory: Equipment[];
  private equipped: Partial<Record<EquipmentSlot, Equipment>>;
  private readonly bus: EventBus;
  private findChanceBonus = 0;
  /** Rolls already spent on the current wave, keyed by source. */
  private rollsThisWave: Record<string, number> = {};

  constructor(
    inventory: Equipment[],
    equipped: Partial<Record<EquipmentSlot, Equipment>>,
    bus: EventBus,
  ) {
    this.inventory = inventory;
    this.equipped = equipped;
    this.bus = bus;
  }

  get inventoryList(): Equipment[] {
    return this.inventory;
  }

  get equippedMap(): Partial<Record<EquipmentSlot, Equipment>> {
    return this.equipped;
  }

  /** Lucky Finds talent: additive bonus to the drop chance. */
  setFindChanceBonus(bonus: number): void {
    this.findChanceBonus = Math.max(0, bonus);
  }

  rollDrop(
    wave: number,
    source: 'boss' | 'elite' | 'milestone',
    options: DropOptions = {},
  ): Equipment | null {
    // A guaranteed drop is a reward the player earned (a swift boss kill, a
    // Windfall chest), not a farm; it neither consumes nor respects the budget.
    if (options.guaranteed !== true) {
      const spent = this.rollsThisWave[source] ?? 0;
      if (spent >= ROLLS_PER_WAVE[source]) return null;
      this.rollsThisWave[source] = spent + 1;
    }
    const eq = dataRollDrop(wave, source, this.findChanceBonus, options);
    if (eq) {
      this.inventory.push(eq);
      this.bus.emit('equipment_dropped', { equipment: eq });
    }
    return eq;
  }

  /** Called on `wave_started`: a new wave gets a fresh budget. */
  beginWave(): void {
    this.rollsThisWave = {};
  }

  equip(slot: EquipmentSlot, id: string): boolean {
    const idx = this.inventory.findIndex(e => e.id === id);
    if (idx === -1) return false;
    const item = this.inventory[idx];
    if (item.slot !== slot) return false;
    // Equipping counts as "seen": it clears the NEW dot and the tab badge.
    item.seen = true;

    const current = this.equipped[slot];
    if (current) {
      this.inventory.push(current);
    }

    this.equipped[slot] = item;
    this.inventory.splice(idx, 1);
    this.bus.emit('equipment_equipped', { slot, equipment: item });
    return true;
  }

  unequip(slot: EquipmentSlot): boolean {
    const item = this.equipped[slot];
    if (!item) return false;

    // It was seen the moment it was equipped (or before, from an old save);
    // returning to the inventory must not resurrect the NEW dot.
    this.inventory.push({ ...item, stats: [...item.stats], seen: true });
    delete this.equipped[slot];
    this.bus.emit('equipment_unequipped', { slot });
    return true;
  }

  getEquippedBonuses(): Partial<Record<EquipmentStatType, number>> {
    const bonuses: Partial<Record<EquipmentStatType, number>> = {};
    for (const s of Object.keys(this.equipped) as EquipmentSlot[]) {
      const item = this.equipped[s];
      if (!item) continue;
      for (const stat of item.stats) {
        bonuses[stat.type] = (bonuses[stat.type] ?? 0) + stat.value;
      }
    }
    return bonuses;
  }

  /** Gold for scrapping an inventory item — see `equipmentSellValue`. */
  getSellValue(id: string): number {
    const item = this.inventory.find(e => e.id === id);
    if (!item) return 0;
    return equipmentSellValue(item);
  }

  sell(id: string): number {
    const idx = this.inventory.findIndex(e => e.id === id);
    if (idx === -1) return 0;
    const value = this.getSellValue(id);
    this.inventory.splice(idx, 1);
    return value;
  }

  /**
   * What a reforge of these three items would cost and produce, or null when
   * the selection is not a legal reforge (progress-steps A.3).
   *
   * Split from `reforge` so the panel can label the button with the real
   * numbers and the action can never promise something it will not deliver —
   * the same split `Game.deploymentTarget` / `deploy` uses.
   */
  previewReforge(ids: string[]): { cost: number; rarity: Rarity; level: number } | null {
    const items = this.resolveReforgeInputs(ids);
    if (!items) return null;
    const rarity = items[0].rarity;
    const deepest = items.reduce((a, e) => Math.max(a, e.level ?? 1), 1);
    const priciest = items.reduce((a, e) => Math.max(a, equipmentSellValue(e)), 0);
    return {
      cost: Math.max(1, Math.floor(priciest * REFORGE_COST_MULT)),
      rarity: upgradeRarity(rarity, 1),
      // A legendary has no tier left to climb, so it climbs in level instead.
      level: rarity === 'legendary' ? deepest + REFORGE_LEGENDARY_LEVEL_GAIN : deepest,
    };
  }

  /**
   * Consume three same-rarity inventory items and return one of the next
   * rarity up, rolled at the deepest input's level (A.3).
   *
   * Deliberately slot-agnostic: the point is to give a pile of redundant
   * same-tier drops somewhere to go, and requiring a slot match would make the
   * sink depend on which slots happened to drop rather than on how much gear
   * the player has. The *result's* slot is rolled fresh, so a reforge is a
   * trade rather than an upgrade of one particular item.
   *
   * Returns null and consumes nothing when the selection is illegal or the
   * gold is not there — a partial reforge would destroy items for nothing.
   */
  reforge(ids: string[], gold: number): { item: Equipment; cost: number } | null {
    const preview = this.previewReforge(ids);
    if (!preview) return null;
    if (gold < preview.cost) return null;
    const items = this.resolveReforgeInputs(ids);
    if (!items) return null;

    // Equipped items are not in `inventory`, so nothing here can strip the
    // tower mid-run; `resolveReforgeInputs` only ever resolves against it.
    for (const item of items) {
      const idx = this.inventory.findIndex(e => e.id === item.id);
      if (idx !== -1) this.inventory.splice(idx, 1);
    }
    const pool = EQUIPMENT_DEFS.filter(d => d.minWave <= preview.level);
    const def = (pool.length > 0 ? pool : EQUIPMENT_DEFS)[
      Math.floor(Math.random() * (pool.length > 0 ? pool.length : EQUIPMENT_DEFS.length))
    ];
    const item = generateEquipment(def.id, preview.rarity, preview.level);
    this.inventory.push(item);
    this.bus.emit('equipment_reforged', { item, cost: preview.cost, consumed: ids.length });
    return { item, cost: preview.cost };
  }

  /**
   * The three distinct inventory items `ids` names, all of one rarity, or null.
   *
   * Every rejection reason is the same answer — null — because the button is
   * only enabled on a legal selection; this is the guard that makes the API
   * safe to call from anywhere, not the place that explains the rule.
   */
  private resolveReforgeInputs(ids: string[]): Equipment[] | null {
    if (ids.length !== REFORGE_INPUTS) return null;
    if (new Set(ids).size !== ids.length) return null;
    const items: Equipment[] = [];
    for (const id of ids) {
      const item = this.inventory.find(e => e.id === id);
      if (!item) return null;
      items.push(item);
    }
    if (!items.every(e => e.rarity === items[0].rarity)) return null;
    return items;
  }

  getSlot(slot: EquipmentSlot): Equipment | null {
    return this.equipped[slot] ?? null;
  }

  reset(): void {
    this.inventory.length = 0;
    for (const key of Object.keys(this.equipped)) {
      delete this.equipped[key as EquipmentSlot];
    }
    this.rollsThisWave = {};
  }
}
