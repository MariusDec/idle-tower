import { describe, it, expect } from 'vitest';
import {
  generateEquipment,
  equipmentSellValue,
  EQUIPMENT_DEF_BY_ID,
  REFORGE_COST_MULT,
  REFORGE_INPUTS,
  REFORGE_LEGENDARY_LEVEL_GAIN,
} from '../src/data/equipment';
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

/**
 * Reforging (plans/progress-steps.md A.3).
 *
 * `rollRarity`'s depth ramp saturates at wave 100, so from there on gear is a
 * solved axis. These tests hold the two properties that make the sink safe:
 * it never produces something from nothing, and it never consumes without
 * producing.
 */
describe('gear reforging (progress-steps A.3)', () => {
  const mgrWith = (items: Equipment[]): EquipmentManager => {
    const mgr = new EquipmentManager([], {}, new EventBus());
    for (const i of items) mgr.inventoryList.push(i);
    return mgr;
  };
  const three = (rarity: Equipment['rarity'], levels: number[]): Equipment[] =>
    levels.map(l => generateEquipment(DEF, rarity, l));

  it('turns three of a rarity into one of the next, at the deepest level', () => {
    const inputs = three('rare', [20, 60, 45]);
    const mgr = mgrWith(inputs);
    const preview = mgr.previewReforge(inputs.map(i => i.id))!;
    expect(preview.rarity).toBe('epic');
    expect(preview.level).toBe(60);

    const done = mgr.reforge(inputs.map(i => i.id), preview.cost)!;
    expect(done.item.rarity).toBe('epic');
    expect(done.item.level).toBe(60);
    // Three in, one out.
    expect(mgr.inventoryList).toHaveLength(1);
    expect(mgr.inventoryList[0].id).toBe(done.item.id);
  });

  it('costs the priciest input times the multiplier', () => {
    const inputs = three('rare', [20, 60, 45]);
    const mgr = mgrWith(inputs);
    const priciest = Math.max(...inputs.map(equipmentSellValue));
    expect(mgr.previewReforge(inputs.map(i => i.id))!.cost)
      .toBe(Math.floor(priciest * REFORGE_COST_MULT));
  });

  it('climbs a legendary in level, because it has no tier left', () => {
    const inputs = three('legendary', [100, 140, 120]);
    const mgr = mgrWith(inputs);
    const preview = mgr.previewReforge(inputs.map(i => i.id))!;
    expect(preview.rarity).toBe('legendary');
    expect(preview.level).toBe(140 + REFORGE_LEGENDARY_LEVEL_GAIN);
    // Which is the whole point: the sell value keeps climbing past the ladder.
    const out = mgr.reforge(inputs.map(i => i.id), preview.cost)!;
    expect(equipmentSellValue(out.item))
      .toBeGreaterThan(Math.max(...inputs.map(equipmentSellValue)));
  });

  it('refuses a mixed-rarity set, and consumes nothing', () => {
    const inputs = [
      generateEquipment(DEF, 'rare', 30),
      generateEquipment(DEF, 'rare', 30),
      generateEquipment(DEF, 'epic', 30),
    ];
    const mgr = mgrWith(inputs);
    const ids = inputs.map(i => i.id);
    expect(mgr.previewReforge(ids)).toBeNull();
    expect(mgr.reforge(ids, 1e12)).toBeNull();
    expect(mgr.inventoryList).toHaveLength(REFORGE_INPUTS);
  });

  it('refuses the wrong count, a duplicate, and an unknown id', () => {
    const inputs = three('rare', [30, 30, 30]);
    const mgr = mgrWith(inputs);
    const ids = inputs.map(i => i.id);
    expect(mgr.previewReforge(ids.slice(0, 2))).toBeNull();
    expect(mgr.previewReforge([...ids, ids[0]])).toBeNull();
    // A duplicate would otherwise consume one item and count it twice.
    expect(mgr.previewReforge([ids[0], ids[0], ids[1]])).toBeNull();
    expect(mgr.previewReforge([ids[0], ids[1], 'nope'])).toBeNull();
    expect(mgr.inventoryList).toHaveLength(REFORGE_INPUTS);
  });

  it('consumes nothing when the gold is short', () => {
    const inputs = three('rare', [30, 30, 30]);
    const mgr = mgrWith(inputs);
    const ids = inputs.map(i => i.id);
    const cost = mgr.previewReforge(ids)!.cost;
    expect(mgr.reforge(ids, cost - 1)).toBeNull();
    expect(mgr.inventoryList).toHaveLength(REFORGE_INPUTS);
    // And it goes through at exactly the quoted price.
    expect(mgr.reforge(ids, cost)).not.toBeNull();
  });

  it('leaves equipped items out of reach', () => {
    // Equipped gear lives in `equipped`, not `inventory`, so a reforge can
    // never strip the tower mid-run.
    const worn = generateEquipment(DEF, 'rare', 30);
    const mgr = new EquipmentManager([], { [worn.slot]: worn }, new EventBus());
    const spare = three('rare', [30, 30]);
    for (const i of spare) mgr.inventoryList.push(i);
    expect(mgr.previewReforge([worn.id, spare[0].id, spare[1].id])).toBeNull();
  });
});
