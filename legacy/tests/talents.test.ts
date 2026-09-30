/**
 * TalentManager tests (plan §14.3).
 *
 * Covers: allocation gating, branch gates, prerequisite ≥1 rule,
 * exclusiveGroup blocking, behaviours cache, effect values, respec pricing,
 * and archivist free-respec.
 */

import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import { TalentManager } from '../src/systems/TalentManager';
import {
  TALENTS_BY_BRANCH,
  TALENT_BY_ID,
  talentRespecCost,
  type TalentBehavior,
  type TalentStat,
} from '../src/data/talentTree';
import type { TalentState } from '../src/types';

/** Build a TalentManager with controllable deps. */
function makeTalentManager(opts?: {
  unspentPoints?: number;
  gold?: number;
}) {
  const bus = new EventBus();
  const state: TalentState = { allocated: {} };
  let points = opts?.unspentPoints ?? 100;
  let gold = opts?.gold ?? 1_000_000;
  const mgr = new TalentManager(state, bus, {
    towerXpUnspentPoints: () => points,
    spendTalentPoint: () => (points > 0 ? ((points -= 1), true) : false),
    grantTalentPoint: () => { points += 1; },
    spendGold: (amount) => (gold >= amount ? ((gold -= amount), true) : false),
  });
  return { mgr, state, bus, getPoints: () => points, getGold: () => gold };
}

// ── §14.3.1 allocating with 0 unspent points ─────────────────────────────

describe('allocating with 0 unspent points', () => {
  it('fails and changes nothing', () => {
    const { mgr, state } = makeTalentManager({ unspentPoints: 0 });
    const id = TALENTS_BY_BRANCH['offense'][0].id;
    expect(mgr.allocate(id)).toBe(false);
    expect(state.allocated[id]).toBeUndefined();
    expect(mgr.totalAllocatedPoints()).toBe(0);
  });
});

// ── §14.3.2 branch gate (row-2 node requires 4 branch points) ────────────

describe('branch gate', () => {
  it('a row-2 node is refused until 4 points sit in the branch', () => {
    const { mgr } = makeTalentManager();
    // wr_precision is row-2, requiresBranchPoints: 4, prereq: wr_edge
    const edge = 'wr_edge';
    const precision = 'wr_precision';

    // Allocate 3 points in wr_edge (row-1, max 5) — only 3 branch points
    mgr.allocate(edge);
    mgr.allocate(edge);
    mgr.allocate(edge);
    expect(mgr.pointsInBranch('offense')).toBe(3);
    expect(mgr.blockedReason(precision)).toBe('gate');
    expect(mgr.allocate(precision)).toBe(false);

    // One more point in the branch → 4 total
    mgr.allocate(edge);
    expect(mgr.pointsInBranch('offense')).toBe(4);
    expect(mgr.blockedReason(precision)).toBeNull();
    expect(mgr.allocate(precision)).toBe(true);
  });
});

// ── §14.3.3 prerequisite ≥1 rank (not maxed) ─────────────────────────────

describe('prerequisite ≥1 rank', () => {
  it('a prerequisite at 1 rank is enough (regression against old "maxed parent" rule)', () => {
    const { mgr } = makeTalentManager();
    // wr_cruelty requires wr_edge (max 5). One rank in wr_edge should suffice.
    const edge = 'wr_edge';
    const cruelty = 'wr_cruelty';

    mgr.allocate(edge); // 1 rank in wr_edge
    // Need 4 branch points for row-2
    mgr.allocate(edge);
    mgr.allocate(edge);
    mgr.allocate(edge);
    expect(mgr.pointsInBranch('offense')).toBe(4);

    // wr_edge is at 4/5 — NOT maxed (allocated 4 times to meet branch gate)
    expect(mgr.getAllocationSnapshot()[edge]).toBe(4);
    // But the prerequisite is met (≥1 rank)
    expect(mgr.blockedReason(cruelty)).toBeNull();
    expect(mgr.allocate(cruelty)).toBe(true);
  });
});

// ── §14.3.4 exclusiveGroup blocking ──────────────────────────────────────

describe('exclusiveGroup blocking', () => {
  it('taking one keystone blocks the other two, and refundBranch releases them', () => {
    const { mgr, state } = makeTalentManager();

    // Build up offense branch to 32 points so keystones unlock.
    // wr_edge (5) + wr_cadence (5) + wr_precision (3) + wr_cruelty (3)
    //   + wr_focus_fire (3) + wr_volley (3) + wr_executioner (3)
    //   + wr_bloodlust (3) + wr_overwatch (3) = 31 → need 1 more
    // Add wr_siegebreaker (4) → 35, but siegbreaker requires 22 branch points
    // and prereqs wr_executioner + wr_bloodlust.
    // Let's just allocate enough points to reach 32.
    const branch = TALENTS_BY_BRANCH['offense'];
    // Allocate row-1 nodes first
    for (let i = 0; i < 5; i++) mgr.allocate('wr_edge');
    for (let i = 0; i < 5; i++) mgr.allocate('wr_cadence');
    // Row-2 nodes (need 4 branch points — already have 10)
    for (let i = 0; i < 3; i++) mgr.allocate('wr_precision');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_cruelty');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_focus_fire');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_volley');
    // Row-3 nodes (need 12 branch points — already have 22)
    for (let i = 0; i < 3; i++) mgr.allocate('wr_executioner');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_bloodlust');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_overwatch');
    // Now at 31 branch points. Need 32 for keystones.
    // Row-4 nodes (need 22 branch points)
    mgr.allocate('wr_siegebreaker');  // prereq for annihilation + deadeye
    mgr.allocate('wr_killing_spree'); // prereq for deadeye + relentless
    // Now at 33 branch points.

    expect(mgr.pointsInBranch('offense')).toBe(33);

    // All three keystones should be allocatable
    expect(mgr.blockedReason('wr_key_annihilation')).toBeNull();
    expect(mgr.blockedReason('wr_key_deadeye')).toBeNull();
    expect(mgr.blockedReason('wr_key_relentless')).toBeNull();

    // Take Annihilation
    expect(mgr.allocate('wr_key_annihilation')).toBe(true);

    // The other two should now be blocked
    expect(mgr.blockedReason('wr_key_deadeye')).toBe('exclusive');
    expect(mgr.blockedReason('wr_key_relentless')).toBe('exclusive');
    expect(mgr.allocate('wr_key_deadeye')).toBe(false);
    expect(mgr.allocate('wr_key_relentless')).toBe(false);

    // Refund the branch releases the exclusive block
    expect(mgr.refundBranch('offense')).toBe(true);
    expect(mgr.pointsInBranch('offense')).toBe(0);
    // After refund, keystones are no longer blocked by exclusive
    // (but prerequisites are also cleared, so blockedReason returns 'prereq')
    expect(mgr.blockedReason('wr_key_deadeye')).toBe('prereq');
  });
});

// ── §14.3.5 behaviours() reflects allocation and refund ──────────────────

describe('behaviours()', () => {
  it('reflects allocation and refund', () => {
    const { mgr } = makeTalentManager();

    // No behaviors initially
    expect(mgr.behaviors().size).toBe(0);
    expect(mgr.hasBehavior('relentless')).toBe(false);

    // Allocate wr_edge (no behavior) — still empty
    mgr.allocate('wr_edge');
    expect(mgr.behaviors().size).toBe(0);

    // Build up to relentless keystone
    for (let i = 0; i < 4; i++) mgr.allocate('wr_edge');
    for (let i = 0; i < 5; i++) mgr.allocate('wr_cadence');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_precision');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_cruelty');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_focus_fire');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_volley');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_executioner');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_bloodlust');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_overwatch');
    for (let i = 0; i < 1; i++) mgr.allocate('wr_killing_spree');
    mgr.allocate('wr_key_relentless');

    expect(mgr.hasBehavior('relentless')).toBe(true);
    expect(mgr.behaviors().has('relentless')).toBe(true);

    // Refund clears the behavior
    mgr.refundBranch('offense');
    expect(mgr.hasBehavior('relentless')).toBe(false);
    expect(mgr.behaviors().size).toBe(0);
  });
});

// ── §14.3.6 getAllEffectValues sums multi-effect nodes ────────────────────

describe('getAllEffectValues()', () => {
  it('sums multi-effect nodes and no longer applies any global multiplier', () => {
    const { mgr } = makeTalentManager();

    // wr_overwatch has two effects: range_pct +0.10, overwatch_damage_pct +0.08
    // Build up branch to unlock it
    for (let i = 0; i < 5; i++) mgr.allocate('wr_edge');
    for (let i = 0; i < 5; i++) mgr.allocate('wr_cadence');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_precision');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_cruelty');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_focus_fire');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_volley');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_executioner');
    for (let i = 0; i < 3; i++) mgr.allocate('wr_bloodlust');
    mgr.allocate('wr_overwatch');

    const effects = mgr.getAllEffectValues();

    // wr_edge: 5 × 0.06 = 0.30 base_damage_pct
    expect(effects.get('base_damage_pct')).toBeCloseTo(0.30, 10);

    // wr_cadence: 5 × 0.04 = 0.20 fire_rate_pct
    expect(effects.get('fire_rate_pct')).toBeCloseTo(0.20, 10);

    // wr_overwatch: 1 × 0.10 = 0.10 range_pct, 1 × 0.08 = 0.08 overwatch_damage_pct
    expect(effects.get('range_pct')).toBeCloseTo(0.10, 10);
    expect(effects.get('overwatch_damage_pct')).toBeCloseTo(0.08, 10);

    // No global multiplier (Mastery is gone) — values are raw perPoint × points
    // Verify no unknown stats
    for (const [stat, value] of effects) {
      expect(typeof stat).toBe('string');
      expect(typeof value).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

// ── §14.3.7 respec cost matches formula; archivist makes it 0 ────────────

describe('respec cost', () => {
  it('talentRespecCost matches the §10.5 table', () => {
    // talentRespecCost(p) = floor(250 * p^1.35)
    expect(talentRespecCost(0)).toBe(0);
    expect(talentRespecCost(1)).toBe(Math.floor(250 * Math.pow(1, 1.35)));
    expect(talentRespecCost(5)).toBe(Math.floor(250 * Math.pow(5, 1.35)));
    expect(talentRespecCost(10)).toBe(Math.floor(250 * Math.pow(10, 1.35)));
    expect(talentRespecCost(20)).toBe(Math.floor(250 * Math.pow(20, 1.35)));
  });

  it('hasBehavior("archivist") makes respec cost 0', () => {
    const { mgr } = makeTalentManager();

    // Allocate some points
    for (let i = 0; i < 5; i++) mgr.allocate('wr_edge');

    // Without archivist, cost is nonzero
    expect(mgr.branchRespecCost('offense')).toBe(talentRespecCost(5));
    expect(mgr.fullRespecCost()).toBe(talentRespecCost(5));

    // Build up to archivist keystone in utility branch
    for (let i = 0; i < 5; i++) mgr.allocate('ft_greed');
    for (let i = 0; i < 5; i++) mgr.allocate('ft_insight');
    for (let i = 0; i < 3; i++) mgr.allocate('ft_scavenge');
    for (let i = 0; i < 3; i++) mgr.allocate('ft_head_start');
    for (let i = 0; i < 3; i++) mgr.allocate('ft_lucky_finds');
    for (let i = 0; i < 3; i++) mgr.allocate('ft_thrift');
    for (let i = 0; i < 3; i++) mgr.allocate('ft_prospector');
    for (let i = 0; i < 3; i++) mgr.allocate('ft_tempo');
    for (let i = 0; i < 3; i++) mgr.allocate('ft_autonomy');
    for (let i = 0; i < 4; i++) mgr.allocate('ft_windfall');
    for (let i = 0; i < 4; i++) mgr.allocate('ft_interest');
    mgr.allocate('ft_key_archivist');

    expect(mgr.hasBehavior('archivist')).toBe(true);

    // Both respec costs are now 0
    expect(mgr.branchRespecCost('offense')).toBe(0);
    expect(mgr.branchRespecCost('utility')).toBe(0);
    expect(mgr.fullRespecCost()).toBe(0);
  });
});

// ── §14.3.8 unaffordable respec is refused and changes nothing ───────────

describe('unaffordable respec', () => {
  it('is refused and changes nothing', () => {
    const { mgr, state, getPoints, getGold } = makeTalentManager({ gold: 0 });

    // Allocate some points
    for (let i = 0; i < 5; i++) mgr.allocate('wr_edge');
    const before = mgr.pointsInBranch('offense');
    const pointsBefore = getPoints();

    // Refund should fail (no gold)
    expect(mgr.refundBranch('offense')).toBe(false);
    expect(mgr.pointsInBranch('offense')).toBe(before);
    expect(getPoints()).toBe(pointsBefore);

    // Full refund also fails
    expect(mgr.refundAll()).toBe(false);
    expect(mgr.totalAllocatedPoints()).toBe(before);
  });
});

// ── §14.3.9 blockedReason returns correct codes ──────────────────────────

describe('blockedReason', () => {
  it('returns "maxed" when at maxPoints', () => {
    const { mgr } = makeTalentManager();
    const id = 'wr_edge'; // maxPoints: 5
    for (let i = 0; i < 5; i++) mgr.allocate(id);
    expect(mgr.blockedReason(id)).toBe('maxed');
  });

  it('returns "no_points" when unspent points are 0', () => {
    const { mgr } = makeTalentManager({ unspentPoints: 0 });
    expect(mgr.blockedReason('wr_edge')).toBe('no_points');
  });

  it('returns "prereq" when a prerequisite has 0 ranks', () => {
    const { mgr } = makeTalentManager();
    // wr_precision requires wr_edge — not allocated yet
    expect(mgr.blockedReason('wr_precision')).toBe('prereq');
  });

  it('returns "gate" when branch points are insufficient', () => {
    const { mgr } = makeTalentManager();
    // wr_precision requires 4 branch points
    mgr.allocate('wr_edge'); // 1 branch point
    expect(mgr.blockedReason('wr_precision')).toBe('gate');
  });

  it('returns null when all conditions are met', () => {
    const { mgr } = makeTalentManager();
    for (let i = 0; i < 4; i++) mgr.allocate('wr_edge');
    expect(mgr.blockedReason('wr_precision')).toBeNull();
  });
});

// ── §14.3.10 getAllocationSnapshot returns a copy ─────────────────────────

describe('getAllocationSnapshot', () => {
  it('returns a copy that does not mutate with further allocations', () => {
    const { mgr } = makeTalentManager();
    mgr.allocate('wr_edge');
    const snap = mgr.getAllocationSnapshot();
    mgr.allocate('wr_edge');
    expect(snap['wr_edge']).toBe(1);
    expect(mgr.getAllocationSnapshot()['wr_edge']).toBe(2);
  });
});
