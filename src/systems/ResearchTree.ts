import type { ResearchDef, ResearchEffectType } from '../data/research';
import {
  RESEARCH_NODES,
  RESEARCH_BY_ID,
  getResearchCost,
  getResearchEffectAtLevel,
  getResearchTime,
  researchPrereqSatisfied,
} from '../data/research';
import { EventBus } from '../game/EventBus';

export interface ResearchInProgressView {
  id: string;
  elapsed: number;
  total: number;
  targetLevel: number;
}

interface ResearchInProgressInternal {
  id: string;
  elapsed: number;
  targetLevel: number;
}

export interface ResearchRuntime {
  levels: Record<string, number>;
  rp: number;
  inProgress: ResearchInProgressInternal | null;
}

export class ResearchTree {
  private runtime: ResearchRuntime = { levels: {}, rp: 0, inProgress: null };
  private readonly bus: EventBus;
  private speedMultiplier = 1;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  get nodes(): ResearchDef[] {
    return RESEARCH_NODES;
  }

  get levels(): Readonly<Record<string, number>> {
    return this.runtime.levels;
  }

  get rp(): number {
    return this.runtime.rp;
  }

  get inProgress(): ResearchInProgressView | null {
    const ip = this.runtime.inProgress;
    if (!ip) return null;
    const def = RESEARCH_BY_ID[ip.id];
    const total = def
      ? getResearchTime(def, ip.targetLevel) * this.speedMultiplier
      : 0;
    return { id: ip.id, elapsed: ip.elapsed, total, targetLevel: ip.targetLevel };
  }

  get unlocked(): ReadonlySet<string> {
    return new Set(Object.keys(this.runtime.levels).filter(id => (this.runtime.levels[id] ?? 0) > 0));
  }

  setSpeedMultiplier(mult: number): void {
    this.speedMultiplier = Math.max(0.1, mult);
  }

  getLevel(id: string): number {
    return this.runtime.levels[id] ?? 0;
  }

  isUnlocked(id: string): boolean {
    return this.getLevel(id) > 0;
  }

  isMaxed(id: string): boolean {
    const def = RESEARCH_BY_ID[id];
    if (!def) return false;
    return this.getLevel(id) >= def.maxLevel;
  }

  isResearching(id: string): boolean {
    return this.runtime.inProgress?.id === id;
  }

  isAnyResearching(): boolean {
    return this.runtime.inProgress !== null;
  }

  getResearchProgress(id: string): { elapsed: number; total: number } | null {
    const ip = this.runtime.inProgress;
    if (!ip || ip.id !== id) return null;
    const def = RESEARCH_BY_ID[id];
    if (!def) return null;
    return {
      elapsed: ip.elapsed,
      total: getResearchTime(def, ip.targetLevel) * this.speedMultiplier,
    };
  }

  canStartResearch(id: string): boolean {
    const def = RESEARCH_BY_ID[id];
    if (!def) return false;
    const current = this.getLevel(id);
    if (current >= def.maxLevel) return false;
    if (this.runtime.inProgress !== null) return false;
    if (current === 0 && !researchPrereqSatisfied(id, this.runtime.levels)) return false;
    const cost = getResearchCost(def, current + 1);
    return this.runtime.rp >= cost;
  }

  reasonBlocked(id: string): string | null {
    const def = RESEARCH_BY_ID[id];
    if (!def) return 'Unknown research';
    const current = this.getLevel(id);
    if (current >= def.maxLevel) return 'Max level reached';
    if (this.runtime.inProgress?.id === id) return null;
    if (this.runtime.inProgress !== null) return 'Another research in progress';
    if (current === 0) {
      for (const pre of def.prerequisites) {
        if (!this.runtime.levels[pre]) {
          return `Requires ${RESEARCH_BY_ID[pre]?.name ?? pre}`;
        }
      }
    }
    const cost = getResearchCost(def, current + 1);
    if (this.runtime.rp < cost) return `Need ${Math.ceil(cost - this.runtime.rp)} more RP`;
    return null;
  }

  startResearch(id: string): boolean {
    if (!this.canStartResearch(id)) return false;
    const def = RESEARCH_BY_ID[id];
    const targetLevel = this.getLevel(id) + 1;
    const cost = getResearchCost(def, targetLevel);
    this.runtime.rp -= cost;
    this.runtime.inProgress = { id, elapsed: 0, targetLevel };
    this.bus.emit('research_started', { id, level: targetLevel });
    return true;
  }

  cancelResearch(): boolean {
    if (!this.runtime.inProgress) return false;
    const def = RESEARCH_BY_ID[this.runtime.inProgress.id];
    if (def) {
      this.runtime.rp += getResearchCost(def, this.runtime.inProgress.targetLevel);
    }
    const id = this.runtime.inProgress.id;
    this.runtime.inProgress = null;
    this.bus.emit('research_cancelled', { id });
    return true;
  }

  tick(dt: number): boolean {
    if (!this.runtime.inProgress) return false;
    const def = RESEARCH_BY_ID[this.runtime.inProgress.id];
    if (!def) {
      this.runtime.inProgress = null;
      return false;
    }
    const totalTime = getResearchTime(def, this.runtime.inProgress.targetLevel) * this.speedMultiplier;
    this.runtime.inProgress.elapsed += dt;
    if (this.runtime.inProgress.elapsed >= totalTime) {
      const { id, targetLevel } = this.runtime.inProgress;
      this.runtime.inProgress = null;
      this.runtime.levels[id] = targetLevel;
      this.bus.emit('research_unlocked', { id, level: targetLevel });
      return true;
    }
    return false;
  }

  advanceResearch(seconds: number): boolean {
    if (!this.runtime.inProgress || seconds <= 0) return false;
    const def = RESEARCH_BY_ID[this.runtime.inProgress.id];
    if (!def) return false;
    const totalTime = getResearchTime(def, this.runtime.inProgress.targetLevel) * this.speedMultiplier;
    this.runtime.inProgress.elapsed += seconds;
    if (this.runtime.inProgress.elapsed >= totalTime) {
      const { id, targetLevel } = this.runtime.inProgress;
      this.runtime.inProgress = null;
      this.runtime.levels[id] = targetLevel;
      this.bus.emit('research_unlocked', { id, level: targetLevel });
      return true;
    }
    return false;
  }

  unlock(id: string): boolean {
    const def = RESEARCH_BY_ID[id];
    if (!def || this.runtime.levels[id]) return false;
    this.runtime.levels[id] = 1;
    this.bus.emit('research_unlocked', { id, level: 1 });
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
    for (const [id, level] of Object.entries(this.runtime.levels)) {
      const def = RESEARCH_BY_ID[id];
      if (!def) continue;
      for (let lv = 1; lv <= level; lv++) total += getResearchCost(def, lv);
    }
    if (this.runtime.inProgress) {
      const def = RESEARCH_BY_ID[this.runtime.inProgress.id];
      if (def) {
        for (let lv = 1; lv <= this.runtime.inProgress.targetLevel; lv++) {
          total += getResearchCost(def, lv);
        }
      }
    }
    return total;
  }

  getLevelsSnapshot(): Record<string, number> {
    return { ...this.runtime.levels };
  }

  getPassiveRPRate(lifetimeHighestWave: number, gainMultiplier: number): number {
    return (0.05 * lifetimeHighestWave / 60) * (1 + gainMultiplier);
  }

  addPassiveRP(dt: number, lifetimeHighestWave: number, gainMultiplier: number): void {
    const rate = this.getPassiveRPRate(lifetimeHighestWave, gainMultiplier);
    if (rate > 0) this.addRP(rate * dt);
  }

  private sumEffect(effectType: ResearchEffectType): number {
    let sum = 0;
    for (const [id, level] of Object.entries(this.runtime.levels)) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === effectType) sum += getResearchEffectAtLevel(def, level);
    }
    return sum;
  }

  getPierceCount(): number {
    return this.sumEffect('pierce');
  }

  getGoldLuckChance(): number {
    return Math.min(1, this.sumEffect('gold_luck'));
  }

  getTowerDefense(): number {
    return Math.min(0.9, this.sumEffect('tower_defense'));
  }

  getChainKillAoE(): number {
    return this.sumEffect('chain_kill_aoe');
  }

  getCritManaRestore(): number {
    return this.sumEffect('crit_mana');
  }

  getAbilityPowerBonus(): number {
    return this.sumEffect('ability_power');
  }

  getIntermissionSpeedReduction(): number {
    return Math.min(0.9, this.sumEffect('intermission_speed'));
  }

  getEnemyHPReduction(): number {
    return Math.min(0.5, this.sumEffect('enemy_hp_reduce'));
  }

  getGoldMultiplicative(): number {
    let factor = 1;
    for (const [id, level] of Object.entries(this.runtime.levels)) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'gold_multi') factor += getResearchEffectAtLevel(def, level);
    }
    return factor;
  }

  getManaRegenMultiplicative(): number {
    let factor = 1;
    for (const [id, level] of Object.entries(this.runtime.levels)) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'mana_regen') factor += getResearchEffectAtLevel(def, level);
    }
    return factor;
  }

  getAbilityCostReduction(): number {
    return Math.min(0.9, this.sumEffect('ability_cost'));
  }

  getStartWave(): number {
    let best = 0;
    for (const [id, level] of Object.entries(this.runtime.levels)) {
      const def = RESEARCH_BY_ID[id];
      if (def?.effectType === 'start_wave') {
        best = Math.max(best, getResearchEffectAtLevel(def, level));
      }
    }
    return best;
  }

  getRPGainMultiplier(): number {
    return this.sumEffect('rp_gain');
  }

  getRPDropChanceBonus(): number {
    return this.sumEffect('rp_drop_chance');
  }

  replaceLevels(
    levels: Record<string, number>,
    rp: number,
    inProgress?: ResearchInProgressInternal | null,
  ): void {
    this.runtime.levels = { ...levels };
    this.runtime.rp = Math.max(0, rp);
    this.runtime.inProgress = inProgress ?? null;
  }
}
