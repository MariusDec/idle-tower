import type { ResearchDef } from '../data/research';
import {
  RESEARCH_NODES,
  RESEARCH_BY_ID,
  researchPrereqSatisfied,
} from '../data/research';
import { EventBus } from '../game/EventBus';

export interface ResearchRuntime {
  unlocked: Set<string>;
  rp: number;
}

export class ResearchTree {
  private runtime: ResearchRuntime = { unlocked: new Set(), rp: 0 };
  private readonly bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  get nodes(): ResearchDef[] {
    return RESEARCH_NODES;
  }

  get rp(): number {
    return this.runtime.rp;
  }

  get unlocked(): ReadonlySet<string> {
    return this.runtime.unlocked;
  }

  isUnlocked(id: string): boolean {
    return this.runtime.unlocked.has(id);
  }

  canUnlock(id: string): boolean {
    const def = RESEARCH_BY_ID[id];
    if (!def) return false;
    if (this.runtime.unlocked.has(id)) return false;
    if (!researchPrereqSatisfied(id, this.runtime.unlocked)) return false;
    return this.runtime.rp >= def.cost;
  }

  reasonBlocked(id: string): string | null {
    const def = RESEARCH_BY_ID[id];
    if (!def) return 'Unknown research';
    if (this.runtime.unlocked.has(id)) return 'Already unlocked';
    for (const pre of def.prerequisites) {
      if (!this.runtime.unlocked.has(pre)) {
        const preName = RESEARCH_BY_ID[pre]?.name ?? pre;
        return `Requires ${preName}`;
      }
    }
    if (this.runtime.rp < def.cost) {
      return `Need ${def.cost - this.runtime.rp} more RP`;
    }
    return null;
  }

  unlock(id: string): boolean {
    if (!this.canUnlock(id)) return false;
    const def = RESEARCH_BY_ID[id];
    this.runtime.rp -= def.cost;
    this.runtime.unlocked.add(id);
    this.bus.emit('research_unlocked', { id });
    return true;
  }

  addRP(amount: number): number {
    if (amount <= 0) return 0;
    const prev = this.runtime.rp;
    this.runtime.rp += amount;
    this.bus.emit('rp_changed', { rp: this.runtime.rp, delta: this.runtime.rp - prev });
    return this.runtime.rp - prev;
  }

  spentRP(): number {
    let total = 0;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def) total += def.cost;
    }
    return total;
  }

  getPierceCount(): number {
    let sum = 0;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'pierce') sum += def.effectValue;
    }
    return sum;
  }

  getGoldMultiplicative(): number {
    let factor = 1;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'gold_multi') factor += def.effectValue;
    }
    return factor;
  }

  getGoldLuckChance(): number {
    let chance = 0;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'gold_luck') chance += def.effectValue;
    }
    return Math.min(1, chance);
  }

  getManaRegenMultiplicative(): number {
    let factor = 1;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'mana_regen') factor += def.effectValue;
    }
    return factor;
  }

  getAbilityCostReduction(): number {
    let reduction = 0;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'ability_cost') reduction += def.effectValue;
    }
    return Math.min(0.9, reduction);
  }

  getStartWave(): number {
    let best = 0;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'start_wave') best = Math.max(best, def.effectValue);
    }
    return best;
  }

  replaceUnlocked(unlockedIds: string[], rp: number): void {
    this.runtime.unlocked = new Set(unlockedIds);
    this.runtime.rp = Math.max(0, rp);
  }

  resetForAscension(): void {
    this.runtime = { unlocked: new Set(), rp: 0 };
  }
}
