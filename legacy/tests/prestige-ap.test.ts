import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import { PrestigeManager } from '../src/systems/PrestigeManager';
import { AP_PERKS, AP_PERK_BY_ID, TP_PERK_BY_ID, FIRST_ASCENSION_AP, SECOND_WIND_LEVELS, perkCost, computePerkEffect, describeAPPerkBonus } from '../src/data/prestige';
import { UPGRADES, UPGRADE_BY_ID } from '../src/data/upgrades';
import {
  effectiveMaxLevel,
  setUpgradeCapExtension,
  resetUpgradeCapExtension,
  MAX_CAP_EXTENSION,
} from '../src/data/upgradeCaps';
import { WATCH_CAP_EXTENSION } from '../src/data/watch';
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

/**
 * Cheapest total AP that ends with `perkId` at `level`, prerequisites included.
 *
 * Prerequisites are OR-based, so the cheapest path takes the cheapest parent.
 * Memoised on `id:level`; the tree is acyclic, so the recursion terminates.
 */
const minCostMemo = new Map<string, number>();
function minCostToOwn(perkId: string, level = 1): number {
  const key = `${perkId}:${level}`;
  const memo = minCostMemo.get(key);
  if (memo !== undefined) return memo;
  const def = AP_PERK_BY_ID[perkId];
  if (!def) return Infinity;
  let own = 0;
  for (let l = 0; l < level; l++) own += perkCost(def, l);
  const reqs = def.prerequisites ?? [];
  const gate = reqs.length === 0
    ? 0
    : Math.min(...reqs.map(r => minCostToOwn(r.perkId, r.minLevel)));
  const total = own + gate;
  minCostMemo.set(key, total);
  return total;
}

describe('AP tree gates (revamp §8, gates 10 and 11)', () => {
  it('gate 10: a first ascension cannot buy any projectile perk', () => {
    expect(FIRST_ASCENSION_AP).toBe(25);
    for (const alloc of reachableAllocations(FIRST_ASCENSION_AP)) {
      for (const id of SIGNATURE) expect(alloc[id] ?? 0).toBe(0);
      expect(alloc.ap_pierce ?? 0).toBe(0);
    }
  });

  /**
   * prestige-abs §8.1 replaces the old gate 10.
   *
   * The retired assertion — "the first ascension is one utility choice, not a
   * shopping list" — was right when 25 AP could buy a 7x damage multiplier. It
   * became the bug once tier 1 was four scalars: it *codified* a first
   * ascension worth +2% to +8% composed throughput. The half that still
   * matters (no projectile coverage at 25 AP) is kept above; these three are
   * the inversion.
   */
  it('gate 10: a first ascension buys a shelf, not a single row', () => {
    const allocs = reachableAllocations(FIRST_ASCENSION_AP);

    // Three or more *different* perks in one budget — the thing the old gate
    // forbade and §R6 requires.
    const widest = Math.max(...allocs.map(a => Object.values(a).filter(l => l > 0).length));
    expect(widest).toBeGreaterThanOrEqual(3);

    // The shelf is wide as well as deep: eight distinct nodes are reachable.
    const nodes = new Set<string>();
    for (const alloc of allocs) {
      for (const [id, level] of Object.entries(alloc)) if (level > 0) nodes.add(id);
    }
    expect(nodes.size).toBeGreaterThanOrEqual(8);

    // At least one reachable build contains something that is not a
    // percentage — a first ascension that only moves multipliers is the shelf
    // this plan replaced.
    const nonScalar = ['ap_auto_upgrader', 'ap_seed_capital'];
    expect(allocs.some(a => nonScalar.some(id => (a[id] ?? 0) > 0))).toBe(true);
  });

  it('gate 10: Auto-Upgrader is a purchase, not the whole budget', () => {
    // §3.2, fault 2: at 25 it consumed a first ascension entirely.
    expect(perkCost(AP_PERK_BY_ID.ap_auto_upgrader, 0)).toBe(12);
    expect(perkCost(AP_PERK_BY_ID.ap_auto_upgrader, 0)).toBeLessThan(FIRST_ASCENSION_AP / 2);
  });

  it('plan §3.2: Auto-Upgrader ladder widens to three levels at 12 / 24 / 48 AP', () => {
    // costScaling is 2, costPerLevel is 12: the third level lands at 48 AP
    // and the whole tier at 84 AP. The first ascension-only assertion above
    // still holds because it talks about the *first* level.
    expect(perkCost(AP_PERK_BY_ID.ap_auto_upgrader, 0)).toBe(12);
    expect(perkCost(AP_PERK_BY_ID.ap_auto_upgrader, 1)).toBe(24);
    expect(perkCost(AP_PERK_BY_ID.ap_auto_upgrader, 2)).toBe(48);
    expect(AP_PERK_BY_ID.ap_auto_upgrader.maxLevel).toBe(3);
  });

  it('plan §3.3: getAutoBuyCount honours the perk level and the Watch grant', () => {
    // Perk level is the budget: L3 buys three per tick. A bare unlock from the
    // Watch's `overseer` has no level, so it counts as one. With nothing
    // granting auto-buy at all the count is zero and the manager will not run.
    const maxed = mgrWith(0, { ap_auto_upgrader: 3 });
    expect(maxed.getAutoBuyCount()).toBe(3);
    const none = mgrWith(0);
    expect(none.getAutoBuyCount()).toBe(0);
    const overseerBus = new EventBus();
    const overseer = new PrestigeManager(overseerBus, {
      resources: { ascensionPoints: 0, lifetimeAP: 0, apThisTranscendence: 0 } as unknown as ResourceState,
      stats: {} as unknown as GameStats,
      prestige: { apSpent: {}, tpSpent: {}, automationFlags: {} } as unknown as PrestigeState,
      externalAutomation: (k) => k === 'autoBuy',
    });
    expect(overseer.getAutoBuyCount()).toBe(1);
  });

  it('gate: the one-time nodes land on the second ascension, not the fourth', () => {
    // §3.4: ~45 AP is ascension #2. Lodestone opens on Seed Capital L2 (11 AP).
    const lodestone = mgrWith(45, { ap_seed_capital: 2 });
    expect(lodestone.canSpendAP('ap_lodestone')).toBe(true);
    // …and it is not reachable on the first.
    for (const alloc of reachableAllocations(FIRST_ASCENSION_AP)) {
      expect(alloc.ap_lodestone ?? 0).toBe(0);
    }
  });

  it('Second Wind is a signature-priced ladder, gated but not early', () => {
    // The perk stopped being a cheap +1 charge: at 120 AP it is a saved-for
    // purchase, and its five levels buy the revive's quality, never a second
    // charge. The prerequisite still opens on Auto-Upgrader alone.
    expect(perkCost(AP_PERK_BY_ID.ap_second_wind, 0)).toBe(120);
    expect(AP_PERK_BY_ID.ap_second_wind.maxLevel).toBe(SECOND_WIND_LEVELS.length);
    expect(mgrWith(45, { ap_auto_upgrader: 1 }).canSpendAP('ap_second_wind')).toBe(false);
    expect(mgrWith(120, { ap_auto_upgrader: 1 }).canSpendAP('ap_second_wind')).toBe(true);
    for (const lvl of [1, 2, 3, 4, 5]) {
      expect(mgrWith(0, { ap_second_wind: lvl }).getAPReviveCharges()).toBe(1);
    }
    // 33% → 50% → 50% + shove → 75% → a full bar.
    const fractions = [1, 2, 3, 4, 5].map(
      lvl => mgrWith(0, { ap_second_wind: lvl }).getAPReviveHpFraction(),
    );
    expect(fractions).toEqual([0.33, 0.5, 0.5, 0.75, 1]);
    const shockwaves = [1, 2, 3, 4, 5].map(
      lvl => mgrWith(0, { ap_second_wind: lvl }).hasAPReviveShockwave(),
    );
    expect(shockwaves).toEqual([false, false, true, true, true]);
    expect(mgrWith(0).getAPReviveHpFraction()).toBe(0);
    expect(mgrWith(0).hasAPReviveShockwave()).toBe(false);
  });

  it('gate 11: 82 AP buys at most one signature node plus one utility line', () => {
    // Argued from the cheapest path to each node rather than from an
    // exhaustive walk: prestige-abs widened the tree to 23 perks, and the
    // reachable set at 82 AP is large enough that enumerating it is minutes of
    // test time for an answer `minCostToOwn` gives exactly. If the *cheapest*
    // way to own any one signature node already costs more than the budget,
    // no allocation inside the budget holds one — let alone two.
    for (const id of [...SIGNATURE, 'ap_pierce']) {
      expect(minCostToOwn(id)).toBeGreaterThan(82);
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
  it('is twenty-five perks in four tiers', () => {
    // 13 before prestige-abs, + the six-node tier-1 shelf (§3.1), the four
    // hook-carrying nodes (§5), Deep Stores (progress-steps §3.10) and
    // Forward Camp (§6.4).
    expect(AP_PERKS).toHaveLength(25);
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

  it('gate: prestige-abs §3.1 routes every new node onto a live consumer', () => {
    const mgr = mgrWith(0, {
      ap_seed_capital: 3,
      ap_prospector: 4,
      ap_veterancy: 2,
      ap_field_notes: 2,
      ap_lodestone: 1,
      ap_second_wind: 1,
      ap_field_kit: 2,
      ap_opening_gambit: 1,
      ap_broker: 2,
      ap_attunement: 2,
    });
    // Seed Capital's ladder is `200 * 1.45^(L-1)`, not a running sum of it.
    expect(mgr.getStartGold()).toBeCloseTo(200 * Math.pow(1.45, 2), 6);
    expect(mgr.getAPUpgradeDiscount()).toBeCloseTo(0.06, 6);
    expect(mgr.getAPXpMultiplier()).toBeCloseTo(1.16, 6);
    expect(mgr.getAPRpDropBonus()).toBeCloseTo(0.005, 6);
    expect(mgr.hasOrbMagnet()).toBe(true);
    expect(mgr.getAPReviveCharges()).toBe(1);
    expect(mgr.getStartingRerollTokens()).toBe(2);
    expect(mgr.getFirstDraftWave()).toBe(1);
    expect(mgr.getContractRewardMultiplier()).toBeCloseTo(1.4, 6);
    expect(mgr.getAbilityUnlockOffset()).toBe(6);
  });

  it('gate: an untouched tree leaves every new channel at its identity', () => {
    const mgr = mgrWith(0);
    expect(mgr.getStartGold()).toBe(0);
    expect(mgr.getAPUpgradeDiscount()).toBe(0);
    expect(mgr.getAPXpMultiplier()).toBe(1);
    expect(mgr.getAPRpDropBonus()).toBe(0);
    expect(mgr.hasOrbMagnet()).toBe(false);
    expect(mgr.getAPReviveCharges()).toBe(0);
    expect(mgr.getStartingRerollTokens()).toBe(0);
    expect(mgr.getFirstDraftWave()).toBe(3);
    expect(mgr.getContractRewardMultiplier()).toBe(1);
    expect(mgr.getAbilityUnlockOffset()).toBe(0);
  });

  /**
   * §8.4: `describeAPPerkBonus` ends in `default: return ''`, so a perk whose
   * effect type has no arm renders a blank line next to a price rather than
   * failing to compile. Mirrors the "consumes every perk effect it sells"
   * test below.
   */
  it('gate: every effect type the AP table sells renders a bonus line', () => {
    for (const p of AP_PERKS) {
      for (const level of [0, 1, p.maxLevel === 999 ? 10 : p.maxLevel]) {
        const text = describeAPPerkBonus(p, level, level >= p.maxLevel);
        expect(text, `${p.id} at level ${level}`).not.toBe('');
      }
    }
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

describe('upgrade cap extension (progress.md §3)', () => {
  beforeEach(() => resetUpgradeCapExtension());
  afterEach(() => resetUpgradeCapExtension());

  it('leaves every cap alone at extension 0', () => {
    for (const u of UPGRADES) {
      expect(effectiveMaxLevel(u), u.id).toBe(u.maxLevel);
    }
  });

  it('extends only the scalar lines', () => {
    setUpgradeCapExtension(1.0);
    expect(effectiveMaxLevel(UPGRADE_BY_ID.damage)).toBe(400);
    expect(effectiveMaxLevel(UPGRADE_BY_ID.health)).toBe(400);
    // Coverage and cadence axes keep their table ceiling forever — extending
    // them is the runaway the original caps were written to prevent.
    expect(effectiveMaxLevel(UPGRADE_BY_ID.fireRate)).toBe(45);
    expect(effectiveMaxLevel(UPGRADE_BY_ID.pierce)).toBe(6);
    expect(effectiveMaxLevel(UPGRADE_BY_ID.splash)).toBe(25);
  });

  it('clamps at MAX_CAP_EXTENSION', () => {
    setUpgradeCapExtension(999);
    expect(effectiveMaxLevel(UPGRADE_BY_ID.damage)).toBe(200 + 200 * MAX_CAP_EXTENSION);
  });

  it('sums the three sources into one fraction', () => {
    // Deep Stores 4 (+1.0) + Foundry 8 (+4.0) + the Watch unlock (+0.5) = 5.5
    const ap = computePerkEffect(AP_PERK_BY_ID.ap_deep_stores, 4);
    const tp = computePerkEffect(TP_PERK_BY_ID.tp_foundry, 8);
    expect(ap).toBeCloseTo(1.0, 6);
    expect(tp).toBeCloseTo(4.0, 6);
    expect(ap + tp + WATCH_CAP_EXTENSION).toBeCloseTo(5.5, 6);
  });
});

describe('Forward Camp (progress.md §6.2)', () => {
  it('sells 50 / 70 / 85 percent', () => {
    const p = AP_PERK_BY_ID.ap_forward_camp;
    expect(computePerkEffect(p, 1)).toBeCloseTo(0.50, 6);
    expect(computePerkEffect(p, 2)).toBeCloseTo(0.70, 6);
    expect(computePerkEffect(p, 3)).toBeCloseTo(0.85, 6);
  });

  it('is zero until bought', () => {
    expect(mgrWith(0, {}).getDeployFraction()).toBe(0);
    expect(mgrWith(0, { ap_forward_camp: 3 }).getDeployFraction()).toBeCloseTo(0.85, 6);
  });
});
