import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import { PrestigeManager } from '../src/systems/PrestigeManager';
import { TP_PERKS, TP_PERK_BY_ID, computePerkEffect, perkCost } from '../src/data/prestige';
import { LootManager } from '../src/systems/LootManager';
import type { GameStats, PrestigeState, ResourceState } from '../src/types';

function mgrWith(tp: number, spent: Record<string, number> = {}): PrestigeManager {
  return new PrestigeManager(new EventBus(), {
    resources: {
      ascensionPoints: 0,
      lifetimeAP: 0,
      apThisTranscendence: 0,
      transcendencePoints: tp,
      lifetimeTP: tp,
    } as unknown as ResourceState,
    stats: { lifetimeAscensions: 1, lifetimeTranscensions: 1 } as unknown as GameStats,
    prestige: { apSpent: {}, tpSpent: { ...spent }, automationFlags: {} } as unknown as PrestigeState,
  });
}

describe('transcendence tree (revamp §9)', () => {
  it('gives a first transcendence ~5 levels of Cosmic Power, not 13 (gate 16)', () => {
    const cosmic = TP_PERK_BY_ID.tp_damage;
    let budget = 25;
    let level = 0;
    while (budget >= perkCost(cosmic, level)) {
      budget -= perkCost(cosmic, level);
      level += 1;
    }
    expect(level).toBe(5);
    // 3 + 3 + 4 + 5 + 7 = 22, leaving 3 unspent.
    expect(budget).toBe(3);
    // +65%, not the old table's +330%.
    expect(computePerkEffect(cosmic, level)).toBeCloseTo(0.646, 2);
    // The old table handed 13 levels for +330% at this budget; even reaching
    // L13 now costs 4x the budget and pays well under half that.
    expect(computePerkEffect(cosmic, 13)).toBeLessThan(1.3);
    let l13Cost = 0;
    for (let l = 0; l < 13; l++) l13Cost += perkCost(cosmic, l);
    expect(l13Cost).toBeGreaterThan(100);
  });

  it('keeps the §9.1 Cosmic Power ladder', () => {
    const cosmic = TP_PERK_BY_ID.tp_damage;
    const ladder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => perkCost(cosmic, l));
    expect(ladder).toEqual([3, 3, 4, 5, 7, 9, 11, 14, 17, 22]);
  });

  it('caps the branch perks where §9 says (so the tree is a choice)', () => {
    const max = Object.fromEntries(TP_PERKS.map((p) => [p.id, p.maxLevel]));
    expect(max).toMatchObject({
      tp_fire_rate: 20,
      tp_crit: 25,
      tp_pierce: 6,
      tp_treasure: 15,
      tp_mana: 15,
      tp_head_start: 12,
      tp_wave_start: 8,
      tp_game_speed: 6,
      tp_efficiency: 7,
    });
    // Wave Commander now tops out at wave 16, not 30.
    expect(computePerkEffect(TP_PERK_BY_ID.tp_wave_start, 8)).toBe(16);
    // Accelerator's ceiling matches its copy: +0.5x a level, +3x at max.
    expect(computePerkEffect(TP_PERK_BY_ID.tp_game_speed, 6)).toBeCloseTo(3, 6);
  });

  it('sizes Head Start against one early run, not against a fortune', () => {
    const hs = TP_PERK_BY_ID.tp_head_start;
    expect(computePerkEffect(hs, 1)).toBe(400);
    expect(Math.round(computePerkEffect(hs, 4))).toBe(2475);
    expect(Math.round(computePerkEffect(hs, 12))).toBe(29731);
  });

  it('replaces Midas Touch with Salvage, exclusive with Arcane Abundance', () => {
    expect(TP_PERK_BY_ID.tp_midas).toBeUndefined();
    const salvage = TP_PERK_BY_ID.tp_salvage;
    expect(salvage.costPerLevel).toBe(28);
    expect(salvage.maxLevel).toBe(1);
    expect(salvage.effectType).toBe('orb_gold_mult');
    expect(salvage.exclusive).toContain('tp_arcane');
    expect(TP_PERK_BY_ID.tp_arcane.exclusive).toContain('tp_salvage');
    // No perk sells an effect nothing reads any more (§1.6).
    expect(TP_PERKS.some((p) => (p.effectType as string) === 'gold_on_hit')).toBe(false);
  });

  it('reads Salvage as a +40% orb-gold multiplier', () => {
    expect(mgrWith(0).getOrbGoldMultiplier()).toBe(1);
    expect(mgrWith(0, { tp_salvage: 1 }).getOrbGoldMultiplier()).toBeCloseTo(1.4, 6);
  });

  it('pays 40% more gold per orb with Salvage (LootManager wiring)', () => {
    const wave = 12;
    const total = (mult: number): number => {
      let sum = 0;
      const mgr = new LootManager({
        towerPos: () => ({ x: 0, y: 0 }),
        pay: (kind, amount) => {
          if (kind === 'gold') sum += amount;
        },
      });
      mgr.setGoldMultiplier(mult);
      // `rng: () => 0.99` misses the reroll and mana rolls, so a boss drop is
      // all gold orbs — the channel Salvage buys.
      mgr.dropForKill({ x: 10, y: 10, wave, maxMana: 0, isBoss: true, rng: () => 0.99 });
      mgr.collectAt(10, 10, 50);
      return sum;
    };

    const base = total(1);
    expect(base).toBeGreaterThan(0);
    const salvaged = total(mgrWith(0, { tp_salvage: 1 }).getOrbGoldMultiplier());
    expect(salvaged / base).toBeCloseTo(1.4, 1);
  });
});
