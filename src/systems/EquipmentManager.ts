import type { EquipmentSlot, Equipment, EquipmentStatType } from '../types';
import { rollDrop as dataRollDrop, equipmentSellValue, type DropOptions } from '../data/equipment';
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
