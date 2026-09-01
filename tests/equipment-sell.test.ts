import { describe, it, expect } from 'vitest';
import { generateEquipment, equipmentSellValue, EQUIPMENT_DEF_BY_ID } from '../src/data/equipment';
import { EquipmentManager } from '../src/systems/EquipmentManager';
import { EventBus } from '../src/game/EventBus';
import type { Equipment } from '../src/types';

const DEF = 'arcane_focus';

describe('equipment sell value', () => {
  it('grows with the item level', () => {
    const early = equipmentSellValue(generateEquipment(DEF, 'rare', 5));
    const deep = equipmentSellValue(generateEquipment(DEF, 'rare', 60));
    expect(deep).toBeGreaterThan(early * 20);
  });

  it('grows with rarity at a fixed level', () => {
    const level = 40;
    const values = (['common', 'uncommon', 'rare', 'epic', 'legendary'] as const)
      .map(r => equipmentSellValue(generateEquipment(DEF, r, level)));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it('is worth a meaningful slice of late-game gold, not a flat pittance', () => {
    // The old curve capped at 500g (10 x 50 for a legendary) at every depth.
    expect(equipmentSellValue(generateEquipment(DEF, 'legendary', 60))).toBeGreaterThan(5000);
  });

  it('floors a pre-level save item at its def minWave rather than wave 1', () => {
    const def = EQUIPMENT_DEF_BY_ID['guardian_banner'];
    const legacy: Equipment = { ...generateEquipment('guardian_banner', 'epic', 1), level: 1 };
    expect(def.minWave).toBeGreaterThan(1);
    expect(equipmentSellValue(legacy)).toBe(
      equipmentSellValue({ ...legacy, level: def.minWave }),
    );
  });

  it('sell() pays the quoted value and removes the item', () => {
    const mgr = new EquipmentManager([], {}, new EventBus());
    const item = generateEquipment(DEF, 'epic', 30);
    mgr.inventoryList.push(item);
    const quoted = mgr.getSellValue(item.id);
    expect(quoted).toBe(equipmentSellValue(item));
    expect(mgr.sell(item.id)).toBe(quoted);
    expect(mgr.inventoryList).toHaveLength(0);
    expect(mgr.getSellValue(item.id)).toBe(0);
  });

  it('stamps the drop wave onto the item level', () => {
    const mgr = new EquipmentManager([], {}, new EventBus());
    const eq = mgr.rollDrop(37, 'boss', { guaranteed: true });
    expect(eq?.level).toBe(37);
  });
});
