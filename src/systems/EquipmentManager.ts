import type { EquipmentSlot, Equipment, Rarity, EquipmentStatType } from '../types';
import { rollDrop as dataRollDrop } from '../data/equipment';
import { EventBus } from '../game/EventBus';

export class EquipmentManager {
  private inventory: Equipment[];
  private equipped: Partial<Record<EquipmentSlot, Equipment>>;
  private readonly bus: EventBus;

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

  rollDrop(wave: number, source: 'boss' | 'milestone'): Equipment | null {
    const eq = dataRollDrop(wave, source);
    if (eq) {
      this.inventory.push(eq);
      this.bus.emit('equipment_dropped', { equipment: eq });
    }
    return eq;
  }

  equip(slot: EquipmentSlot, id: string): boolean {
    const idx = this.inventory.findIndex(e => e.id === id);
    if (idx === -1) return false;
    const item = this.inventory[idx];
    if (item.slot !== slot) return false;

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

    this.inventory.push({ ...item, stats: [...item.stats] });
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

  getSellValue(id: string): number {
    const idx = this.inventory.findIndex(e => e.id === id);
    if (idx === -1) return 0;
    const item = this.inventory[idx];
    const rarityMultiplier: Record<Rarity, number> = {
      common: 1,
      uncommon: 2,
      rare: 5,
      epic: 15,
      legendary: 50,
    };
    return 10 * (rarityMultiplier[item.rarity] ?? 1);
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
  }
}
