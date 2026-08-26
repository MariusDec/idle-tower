import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import { PrestigeManager } from '../src/systems/PrestigeManager';
import { AP_PERKS, AP_PERK_BY_ID, FIRST_ASCENSION_AP, perkCost } from '../src/data/prestige';
import { CORES } from '../src/data/cores';
import type { GameStats, PrestigeState, ResourceState } from '../src/types';

/** The three single-level coverage nodes — revamp §8.2's signature purchases. */
const SIGNATURE = ['ap_extra_shots', 'ap_back_shots', 'ap_scatter_shots'] as const;

function mgrWith(ap: number, spent: Record<string, number> = {}): PrestigeManager {
  return new PrestigeManager(new EventBus(), {
    resources: { ascensionPoints: ap, lifetimeAP: ap, apThisTranscendence: 0 } as unknown as ResourceState,
    stats: { lifetimeAscensions: 1 } as unknown as GameStats,
    prestige: { apSpent: { ...spent }, tpSpent: {}, automationFlags: {} } as unknown as PrestigeState,
  });
}

/**
 * Every AP allocation reachable from `budget`, as level vectors.
 *
 * The gates in §14 are about what a *budget* can buy, not about one greedy
 * path, so the search is exhaustive: memoised over (spend vector) so the
 * prerequisite tree is explored once per reachable state.
 */
function reachableAllocations(budget: number): Record<string, number>[] {
  const out: Record<string, number>[] = [];
  const seen = new Set<string>();
  const key = (s: Record<string, number>) =>
    AP_PERKS.map(p => s[p.id] ?? 0).join(',');

  const walk = (spent: Record<string, number>, left: number) => {
    const k = key(spent);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ ...spent });
    const mgr = mgrWith(left, spent);
    for (const perk of AP_PERKS) {
      if (!mgr.canSpendAP(perk.id)) continue;
      const level = spent[perk.id] ?? 0;
      const cost = perkCost(perk, level);
      walk({ ...spent, [perk.id]: level + 1 }, left - cost);
    }
  };
  walk({}, budget);
  return out;
}

describe('AP tree gates (revamp §8, gates 10 and 11)', () => {
  it('gate 10: a first ascension cannot buy any projectile perk', () => {
    expect(FIRST_ASCENSION_AP).toBe(25);
    for (const alloc of reachableAllocations(FIRST_ASCENSION_AP)) {
      for (const id of SIGNATURE) expect(alloc[id] ?? 0).toBe(0);
      expect(alloc.ap_pierce ?? 0).toBe(0);
    }
  });

  it('gate 10: the first ascension is one utility choice, not a shopping list', () => {
    // Auto-Upgrader alone is the whole budget; Quiver reaches L4 and Wave
    // Skipper L3 costs 30, one short (§8.3).
    expect(perkCost(AP_PERK_BY_ID.ap_auto_upgrader, 0)).toBe(25);
    const quiver = AP_PERK_BY_ID.ap_quiver;
    const quiverFour = [0, 1, 2, 3].reduce((sum, l) => sum + perkCost(quiver, l), 0);
    expect(quiverFour).toBeLessThanOrEqual(27);
    const skipper = AP_PERK_BY_ID.ap_wave_skipper;
    const skipperThree = [0, 1, 2].reduce((sum, l) => sum + perkCost(skipper, l), 0);
    expect(skipperThree).toBeGreaterThan(FIRST_ASCENSION_AP);
  });

  it('gate 11: 82 AP buys at most one signature node plus one utility line', () => {
    for (const alloc of reachableAllocations(82)) {
      const signatures = SIGNATURE.reduce((n, id) => n + (alloc[id] ?? 0), 0)
        + Math.min(1, alloc.ap_pierce ?? 0);
      expect(signatures).toBeLessThanOrEqual(1);
    }
  });

  it('gate 11: a wall-depth budget still affords the §8.3 utility opener', () => {
    const mgr = mgrWith(82);
    expect(mgr.spendAP('ap_auto_upgrader')).toBe(true);
    let bought = 0;
    while (mgr.spendAP('ap_might')) bought++;
    expect(bought).toBe(6);
    expect(mgr.getAPDamageBonus()).toBeCloseTo(0.12, 6);
  });
});

describe('AP tree shape (revamp §8.2 / §8.4)', () => {
  it('is thirteen perks in four tiers', () => {
    expect(AP_PERKS).toHaveLength(13);
    expect(new Set(AP_PERKS.map(p => p.tier))).toEqual(new Set([1, 2, 3, 4]));
  });

  it('makes the three projectile nodes single-level signatures', () => {
    for (const id of SIGNATURE) expect(AP_PERK_BY_ID[id].maxLevel).toBe(1);
    expect(perkCost(AP_PERK_BY_ID.ap_extra_shots, 0)).toBe(60);
    expect(perkCost(AP_PERK_BY_ID.ap_back_shots, 0)).toBe(90);
    expect(perkCost(AP_PERK_BY_ID.ap_scatter_shots, 0)).toBe(200);
  });

  it('keeps prerequisites OR-based, matching the panel copy', () => {
    const mgr = mgrWith(10_000, { ap_quiver: 3 });
    // Might lists Auto-Upgrader *or* Quiver L3; the second parent alone opens it.
    expect(mgr.meetsPrerequisites('ap_might')).toBe(true);
  });

  it('locks Warlord and Tycoon out of each other', () => {
    const warlord = AP_PERK_BY_ID.ap_warlord;
    const tycoon = AP_PERK_BY_ID.ap_tycoon;
    expect(warlord.exclusive).toContain('ap_tycoon');
    expect(tycoon.exclusive).toContain('ap_warlord');
    const mgr = mgrWith(100_000, { ap_might: 10, ap_fortune: 10 });
    expect(mgr.canSpendAP('ap_tycoon')).toBe(true);
    expect(mgr.spendAP('ap_warlord')).toBe(true);
    expect(mgr.isExcluded('ap_tycoon')).toBe(true);
    expect(mgr.canSpendAP('ap_tycoon')).toBe(false);
  });

  it('consumes every perk effect it sells', () => {
    // Quiver → fire rate, Bodkin Mastery → pierceExtra. A perk whose effect
    // nothing reads is flavour text with a price tag (§1.6's `tp_aoe`).
    const quiver = mgrWith(0, { ap_quiver: 10 });
    expect(quiver.getAPFireRateMultiplier()).toBeCloseTo(1.2, 6);
    const bodkin = mgrWith(0, { ap_pierce: 2 });
    expect(bodkin.getAPPierceBonus()).toBe(2);
  });

  it('prices core unlocks against the signature nodes (§8.4)', () => {
    const costs = Object.fromEntries(CORES.map(c => [c.id, c.apCost]));
    expect(costs).toMatchObject({
      marksman: 0, artillery: 30, frostwork: 45, bloodforge: 60, arcane: 90,
    });
  });
});
