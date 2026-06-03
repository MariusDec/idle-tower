import type { ResearchDef } from '../data/research';
import {
  RESEARCH_NODES,
  RESEARCH_BY_ID,
  researchPrereqSatisfied,
} from '../data/research';
import { EventBus } from '../game/EventBus';

export interface ResearchInProgress {
  id: string;
  elapsed: number;
}

export interface ResearchRuntime {
  unlocked: Set<string>;
  rp: number;
  inProgress: ResearchInProgress | null;
}

export class ResearchTree {
  private runtime: ResearchRuntime = { unlocked: new Set(), rp: 0, inProgress: null };
  private readonly bus: EventBus;
  private speedMultiplier = 1;

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

  get inProgress(): ResearchInProgress | null {
    return this.runtime.inProgress;
  }

  setSpeedMultiplier(mult: number): void {
    this.speedMultiplier = Math.max(0.1, mult);
  }

  isUnlocked(id: string): boolean {
    return this.runtime.unlocked.has(id);
  }

  isResearching(id: string): boolean {
    return this.runtime.inProgress?.id === id;
  }

  isAnyResearching(): boolean {
    return this.runtime.inProgress !== null;
  }

  getResearchProgress(id: string): { elapsed: number; total: number } | null {
    if (this.runtime.inProgress?.id !== id) return null;
    const def = RESEARCH_BY_ID[id];
    if (!def) return null;
    return {
      elapsed: this.runtime.inProgress.elapsed,
      total: def.researchTime * this.speedMultiplier,
    };
  }

  canStartResearch(id: string): boolean {
    const def = RESEARCH_BY_ID[id];
    if (!def) return false;
    if (this.runtime.unlocked.has(id)) return false;
    if (this.runtime.inProgress !== null) return false;
    if (!researchPrereqSatisfied(id, this.runtime.unlocked)) return false;
    return this.runtime.rp >= def.cost;
  }

  reasonBlocked(id: string): string | null {
    const def = RESEARCH_BY_ID[id];
    if (!def) return 'Unknown research';
    if (this.runtime.unlocked.has(id)) return 'Already unlocked';
    if (this.runtime.inProgress?.id === id) return null; // actively researching = not blocked
    if (this.runtime.inProgress !== null) return 'Another research in progress';
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

  startResearch(id: string): boolean {
    if (!this.canStartResearch(id)) return false;
    const def = RESEARCH_BY_ID[id];
    this.runtime.rp -= def.cost;
    this.runtime.inProgress = { id, elapsed: 0 };
    this.bus.emit('research_started', { id });
    return true;
  }

  cancelResearch(): boolean {
    if (!this.runtime.inProgress) return false;
    const def = RESEARCH_BY_ID[this.runtime.inProgress.id];
    if (def) {
      this.runtime.rp += def.cost; // refund RP
    }
    const id = this.runtime.inProgress.id;
    this.runtime.inProgress = null;
    this.bus.emit('research_cancelled', { id });
    return true;
  }

  /** Called each frame with game delta time. Returns true if a research completed this frame. */
  tick(dt: number): boolean {
    if (!this.runtime.inProgress) return false;
    const def = RESEARCH_BY_ID[this.runtime.inProgress.id];
    if (!def) {
      this.runtime.inProgress = null;
      return false;
    }
    const totalTime = def.researchTime * this.speedMultiplier;
    this.runtime.inProgress.elapsed += dt;
    if (this.runtime.inProgress.elapsed >= totalTime) {
      const id = this.runtime.inProgress.id;
      this.runtime.inProgress = null;
      this.runtime.unlocked.add(id);
      this.bus.emit('research_unlocked', { id });
      return true;
    }
    return false;
  }

  /** Instant unlock (legacy, used for migration). Does NOT consume RP. */
  unlock(id: string): boolean {
    const def = RESEARCH_BY_ID[id];
    if (!def) return false;
    if (this.runtime.unlocked.has(id)) return false;
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
    // Include RP locked in active research
    if (this.runtime.inProgress) {
      const def = RESEARCH_BY_ID[this.runtime.inProgress.id];
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

  getTowerDefense(): number {
    let reduction = 0;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'tower_defense') reduction += def.effectValue;
    }
    return Math.min(0.9, reduction);
  }

  getChainKillAoE(): number {
    let value = 0;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'chain_kill_aoe') value += def.effectValue;
    }
    return value;
  }

  getCritManaRestore(): number {
    let value = 0;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'crit_mana') value += def.effectValue;
    }
    return value;
  }

  getAbilityPowerBonus(): number {
    let value = 0;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'ability_power') value += def.effectValue;
    }
    return value;
  }

  getIntermissionSpeedReduction(): number {
    let value = 0;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'intermission_speed') value += def.effectValue;
    }
    return Math.min(0.9, value);
  }

  getEnemyHPReduction(): number {
    let value = 0;
    for (const id of this.runtime.unlocked) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'enemy_hp_reduce') value += def.effectValue;
    }
    return Math.min(0.5, value);
  }

  replaceUnlocked(unlockedIds: string[], rp: number, inProgress?: ResearchInProgress | null): void {
    this.runtime.unlocked = new Set(unlockedIds);
    this.runtime.rp = Math.max(0, rp);
    this.runtime.inProgress = inProgress ?? null;
  }

  resetForAscension(): void {
    this.runtime = { unlocked: new Set(), rp: 0, inProgress: null };
  }
}
