import { ACHIEVEMENTS, type AchievementDef, type AchievementRewardType } from '../data/achievements';
import type { GameStats } from '../types';
import { EventBus } from '../game/EventBus';

export interface AchievementContext {
  getStats: () => GameStats;
  getAchievements: () => string[];
  researchCount: () => number;
}

export class AchievementManager {
  private readonly bus: EventBus;
  private readonly ctx: AchievementContext;
  private checkTimer = 0;

  constructor(bus: EventBus, ctx: AchievementContext) {
    this.bus = bus;
    this.ctx = ctx;
  }

  tick(dt: number): void {
    this.checkTimer += dt;
    if (this.checkTimer < 1) return;
    this.checkTimer = 0;
    this.checkAll();
  }

  private checkAll(): void {
    for (const def of ACHIEVEMENTS) {
      const achievements = this.ctx.getAchievements();
      if (achievements.includes(def.id)) continue;
      if (this.meetsCondition(def)) {
        achievements.push(def.id);
        this.bus.emit('achievement_unlocked', { id: def.id, name: def.name, reward: def.reward });
        this.bus.emit('toast', {
          kind: 'milestone',
          text: `Achievement: ${def.name} — ${def.reward.description}`,
          life: 6,
        });
      }
    }
  }

  private meetsCondition(def: AchievementDef): boolean {
    if (def.stat === 'researchCount') {
      return this.ctx.researchCount() >= def.threshold;
    }
    const value = (this.ctx.getStats() as unknown as Record<string, number>)[def.stat];
    if (value === undefined) return false;
    return value >= def.threshold;
  }

  isUnlocked(id: string): boolean {
    return this.ctx.getAchievements().includes(id);
  }

  getProgress(def: AchievementDef): number {
    if (def.stat === 'researchCount') {
      return this.ctx.researchCount();
    }
    return (this.ctx.getStats() as unknown as Record<string, number>)[def.stat] ?? 0;
  }

  getRewardMultiplier(type: AchievementRewardType): number {
    let total = 0;
    for (const def of ACHIEVEMENTS) {
      if (!this.ctx.getAchievements().includes(def.id)) continue;
      if (def.reward.type === type) total += def.reward.value;
    }
    return total;
  }

  get unlocked(): string[] {
    return this.ctx.getAchievements();
  }

  reset(): void {
    this.ctx.getAchievements().length = 0;
    //this.ctx.getStats().reset();
    //this.ctx.researchCount() = 0;
  }
}
