import type { TalentState, TalentBranch, TalentId } from '../types';
import {
  TALENTS,
  TALENT_BY_ID,
  TALENTS_BY_BRANCH,
  talentRespecCost,
  type TalentStat,
  type TalentBehavior,
} from '../data/talentTree';
import { EventBus } from '../game/EventBus';

export class TalentManager {
  private state: TalentState;
  private readonly bus: EventBus;
  private readonly towerXpUnspentPoints: () => number;
  private readonly spendTalentPoint: () => boolean;
  private readonly grantTalentPoint: () => void;
  private readonly spendGold: (amount: number) => boolean;

  /** Cached set of active behaviours, rebuilt on allocate/refund. */
  private behaviorCache: Set<TalentBehavior> | null = null;

  constructor(
    state: TalentState,
    bus: EventBus,
    deps: {
      towerXpUnspentPoints: () => number;
      spendTalentPoint: () => boolean;
      grantTalentPoint: () => void;
      spendGold: (amount: number) => boolean;
    },
  ) {
    this.state = state;
    this.bus = bus;
    this.towerXpUnspentPoints = deps.towerXpUnspentPoints;
    this.spendTalentPoint = deps.spendTalentPoint;
    this.grantTalentPoint = deps.grantTalentPoint;
    this.spendGold = deps.spendGold;
  }

  // ── Allocation ──────────────────────────────────────────────────────────

  /** ≥1 rank in any prerequisite, branch gate met, exclusivity respected. */
  canAllocate(id: TalentId): boolean {
    const def = TALENT_BY_ID[id];
    if (!def) return false;
    if ((this.state.allocated[id] ?? 0) >= def.maxPoints) return false;
    if (this.towerXpUnspentPoints() <= 0) return false;
    for (const p of def.prerequisites) {
      if ((this.state.allocated[p] ?? 0) < 1) return false; // ≥1 rank, not maxed
    }
    if (this.pointsInBranch(def.branch) < def.requiresBranchPoints) return false;
    if (def.exclusiveGroup) {
      for (const t of TALENTS_BY_BRANCH[def.branch]) {
        if (
          t.id !== def.id &&
          t.exclusiveGroup === def.exclusiveGroup &&
          (this.state.allocated[t.id] ?? 0) > 0
        )
          return false;
      }
    }
    return true;
  }

  allocate(id: TalentId): boolean {
    if (!this.canAllocate(id)) return false;
    if (!this.spendTalentPoint()) return false;

    const current = this.state.allocated[id] ?? 0;
    this.state.allocated[id] = current + 1;
    this.behaviorCache = null; // invalidate

    const totalSpent = Object.values(this.state.allocated).reduce((s, v) => s + v, 0);
    this.bus.emit('talent_allocated', {
      talentId: id,
      points: this.state.allocated[id],
      totalSpent,
    });

    return true;
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  /** Points currently allocated in one branch. */
  pointsInBranch(branch: TalentBranch): number {
    let total = 0;
    for (const t of TALENTS_BY_BRANCH[branch]) total += this.state.allocated[t.id] ?? 0;
    return total;
  }

  /** Points currently allocated across every branch. */
  totalAllocatedPoints(): number {
    let total = 0;
    for (const points of Object.values(this.state.allocated)) total += points;
    return total;
  }

  /** Every behaviour held, for the stat context. */
  behaviors(): Set<TalentBehavior> {
    if (!this.behaviorCache) {
      this.behaviorCache = new Set<TalentBehavior>();
      for (const [id, points] of Object.entries(this.state.allocated)) {
        if (points <= 0) continue;
        const def = TALENT_BY_ID[id];
        if (def?.behavior) this.behaviorCache.add(def.behavior);
      }
    }
    return this.behaviorCache;
  }

  hasBehavior(b: TalentBehavior): boolean {
    return this.behaviors().has(b);
  }

  /** Why a node is not buyable, for the detail card. null when it is. */
  blockedReason(id: TalentId): 'maxed' | 'no_points' | 'prereq' | 'gate' | 'exclusive' | null {
    const def = TALENT_BY_ID[id];
    if (!def) return 'maxed'; // unknown id treated as maxed
    if ((this.state.allocated[id] ?? 0) >= def.maxPoints) return 'maxed';
    if (this.towerXpUnspentPoints() <= 0) return 'no_points';
    for (const p of def.prerequisites) {
      if ((this.state.allocated[p] ?? 0) < 1) return 'prereq';
    }
    if (this.pointsInBranch(def.branch) < def.requiresBranchPoints) return 'gate';
    if (def.exclusiveGroup) {
      for (const t of TALENTS_BY_BRANCH[def.branch]) {
        if (
          t.id !== def.id &&
          t.exclusiveGroup === def.exclusiveGroup &&
          (this.state.allocated[t.id] ?? 0) > 0
        )
          return 'exclusive';
      }
    }
    return null;
  }

  // ── Effect values ───────────────────────────────────────────────────────

  getAllEffectValues(): Map<TalentStat, number> {
    const totals = new Map<TalentStat, number>();
    const add = (stat: TalentStat, value: number) => {
      if (value === 0) return;
      totals.set(stat, (totals.get(stat) ?? 0) + value);
    };
    for (const [id, points] of Object.entries(this.state.allocated)) {
      if (points <= 0) continue;
      const def = TALENT_BY_ID[id];
      if (!def) continue;
      for (const effect of def.effects) {
        add(effect.stat, effect.perPoint * points);
      }
    }
    return totals;
  }

  getAllocationSnapshot(): Record<TalentId, number> {
    return { ...this.state.allocated };
  }

  // ── Respec ──────────────────────────────────────────────────────────────

  /** Gold a branch respec would cost right now. */
  branchRespecCost(branch: TalentBranch): number {
    if (this.hasBehavior('archivist')) return 0;
    return talentRespecCost(this.pointsInBranch(branch));
  }

  /** Gold a full respec would cost right now. */
  fullRespecCost(): number {
    if (this.hasBehavior('archivist')) return 0;
    return talentRespecCost(this.totalAllocatedPoints());
  }

  /**
   * Refund one branch for gold.
   *
   * Only whole-branch refunds are supported — single-node refund could orphan
   * a keystone that depends on prerequisites in the same branch.
   */
  refundBranch(branch: TalentBranch): boolean {
    return this.refundTalents(TALENTS_BY_BRANCH[branch].map(t => t.id), branch);
  }

  /** Refund every branch at once. */
  refundAll(): boolean {
    return this.refundTalents(TALENTS.map(t => t.id), null);
  }

  private refundTalents(ids: TalentId[], branch: TalentBranch | null): boolean {
    let points = 0;
    for (const id of ids) points += this.state.allocated[id] ?? 0;
    if (points <= 0) return false;
    const cost = this.hasBehavior('archivist') ? 0 : talentRespecCost(points);
    if (cost > 0 && !this.spendGold(cost)) return false;
    for (const id of ids) delete this.state.allocated[id];
    for (let i = 0; i < points; i++) this.grantTalentPoint();
    this.behaviorCache = null; // invalidate
    this.bus.emit('talent_refunded', { branch, points, cost });
    return true;
  }
}
