import type { TalentState, TalentBranch, TalentId } from '../types';
import { TALENTS, TALENT_BY_ID, TALENTS_BY_BRANCH } from '../data/talentTree';
import { EventBus } from '../game/EventBus';

export class TalentManager {
  private state: TalentState;
  private readonly bus: EventBus;
  private readonly towerXpUnspentPoints: () => number;
  private readonly spendTalentPoint: () => boolean;

  constructor(
    state: TalentState,
    bus: EventBus,
    deps: {
      towerXpUnspentPoints: () => number;
      spendTalentPoint: () => boolean;
    },
  ) {
    this.state = state;
    this.bus = bus;
    this.towerXpUnspentPoints = deps.towerXpUnspentPoints;
    this.spendTalentPoint = deps.spendTalentPoint;
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

  refundBranch(branch: TalentBranch): void {
    const branchTalents = TALENTS_BY_BRANCH[branch];
    let refunded = 0;
    for (const t of branchTalents) {
      const spent = this.state.allocated[t.id] ?? 0;
      if (spent > 0) {
        refunded += spent;
        delete this.state.allocated[t.id];
      }
    }
    if (refunded > 0) {
      this.bus.emit('talent_refunded', { branch, points: refunded });
    }
  }

  getEffectValue(effectStat: string): number {
    let total = 0;
    for (const [id, points] of Object.entries(this.state.allocated)) {
      if (points <= 0) continue;
      const def = TALENT_BY_ID[id];
      if (!def) continue;
      if (def.effect.stat === effectStat) {
        total += def.effect.perPoint * points;
      }
    }
    return total;
  }

  getAllocationSnapshot(): Record<TalentId, number> {
    return { ...this.state.allocated };
  }
}
