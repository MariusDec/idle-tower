import type { TalentState, TalentBranch, TalentId } from '../types';
import { TALENTS, TALENT_BY_ID, TALENTS_BY_BRANCH, talentRespecCost, type TalentStat } from '../data/talentTree';
import { EventBus } from '../game/EventBus';

export class TalentManager {
  private state: TalentState;
  private readonly bus: EventBus;
  private readonly towerXpUnspentPoints: () => number;
  private readonly spendTalentPoint: () => boolean;
  private readonly grantTalentPoint: () => void;
  private readonly spendGold: (amount: number) => boolean;

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

  canAllocate(talentId: TalentId): boolean {
    const def = TALENT_BY_ID[talentId];
    if (!def) return false;
    const currentPoints = this.state.allocated[talentId] ?? 0;
    if (currentPoints >= def.maxPoints) return false;
    if (this.towerXpUnspentPoints() <= 0) return false;
    for (const prereqId of def.prerequisites) {
      const prereqDef = TALENT_BY_ID[prereqId];
      if (!prereqDef) return false;
      const prereqPoints = this.state.allocated[prereqId] ?? 0;
      if (prereqPoints < prereqDef.maxPoints) return false;
    }
    if (def.exclusive) {
      const sameTierExclusives = TALENTS.filter(
        t => t.branch === def.branch && t.tier === def.tier && t.exclusive && t.id !== def.id,
      );
      for (const ex of sameTierExclusives) {
        if ((this.state.allocated[ex.id] ?? 0) > 0) return false;
      }
    }
    return true;
  }

  allocate(talentId: TalentId): boolean {
    const def = TALENT_BY_ID[talentId];
    if (!def) return false;
    if (!this.canAllocate(talentId)) return false;
    if (!this.spendTalentPoint()) return false;

    const currentPoints = this.state.allocated[talentId] ?? 0;
    this.state.allocated[talentId] = currentPoints + 1;

    const totalSpent = Object.values(this.state.allocated).reduce((s, v) => s + v, 0);
    this.bus.emit('talent_allocated', {
      talentId,
      points: this.state.allocated[talentId],
      totalSpent,
    });

    return true;
  }

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

  /** Gold a branch respec would cost right now. */
  branchRespecCost(branch: TalentBranch): number {
    return talentRespecCost(this.pointsInBranch(branch));
  }

  /** Gold a full respec would cost right now. */
  fullRespecCost(): number {
    return talentRespecCost(this.totalAllocatedPoints());
  }

  /**
   * Refund one branch for gold (plan §4.7).
   *
   * Both halves of this used to be missing: the advertised cost was never
   * charged, and the refunded points were deleted rather than returned to the
   * unspent pool — a "respec" that silently destroyed progress.
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
    const cost = talentRespecCost(points);
    if (cost > 0 && !this.spendGold(cost)) return false;
    for (const id of ids) delete this.state.allocated[id];
    for (let i = 0; i < points; i++) this.grantTalentPoint();
    this.bus.emit('talent_refunded', { branch, points, cost });
    return true;
  }

  getEffectValue(effectStat: TalentStat): number {
    let total = 0;
    for (const [id, points] of Object.entries(this.state.allocated)) {
      if (points <= 0) continue;
      const def = TALENT_BY_ID[id];
      if (!def) continue;
      if (def.effect.stat === effectStat) {
        total += def.effect.perPoint * points;
      }
      if (def.secondary && def.secondary.stat === effectStat) {
        total += def.secondary.perPoint * points;
      }
    }
    return total;
  }

  /**
   * Total value of every allocated talent stat, keyed by stat.
   *
   * `all_effects_pct` (Mastery) is folded in here rather than at the call site:
   * it scales every other talent's contribution.
   */
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
      add(def.effect.stat, def.effect.perPoint * points);
      if (def.secondary) add(def.secondary.stat, def.secondary.perPoint * points);
    }
    const mastery = totals.get('all_effects_pct') ?? 0;
    if (mastery > 0) {
      for (const [stat, value] of totals) {
        if (stat === 'all_effects_pct') continue;
        totals.set(stat, value * (1 + mastery));
      }
    }
    return totals;
  }

  getAllocationSnapshot(): Record<TalentId, number> {
    return { ...this.state.allocated };
  }
}
