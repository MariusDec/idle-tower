import type { TowerXpState, EnemyType } from '../types';
import { TOWER_XP_TABLE, xpPerKill, xpPerWaveClear, xpToLevel, xpForNextLevel, talentPointsAtLevel } from '../data/xpTables';
import { EventBus } from '../game/EventBus';

export class TowerXpManager {
  private state: TowerXpState;
  private readonly bus: EventBus;
  private xpGainMultiplier = 1;

  constructor(state: TowerXpState, bus: EventBus) {
    this.state = state;
    this.bus = bus;
  }

  get level(): number { return this.state.level; }
  get xp(): number { return this.state.xp; }
  get totalXpEarned(): number { return this.state.totalXpEarned; }
  get unspentTalentPoints(): number { return this.state.unspentTalentPoints; }

  setXpGainMultiplier(mult: number): void {
    this.xpGainMultiplier = Math.max(0, mult);
  }

  addKillXp(type: EnemyType, wave: number): void {
    const gained = xpPerKill(type, wave);
    this.addXp(gained);
  }

  addWaveClearXp(wave: number): void {
    const gained = xpPerWaveClear(wave);
    this.addXp(gained);
  }

  private addXp(amount: number): void {
    if (amount <= 0) return;
    const gained = Math.floor(amount * this.xpGainMultiplier);
    if (gained <= 0) return;
    this.state.xp += gained;
    this.state.totalXpEarned += gained;
    const newLevel = xpToLevel(this.state.xp);
    while (this.state.level < newLevel) {
      this.state.level += 1;
      const expectedPoints = talentPointsAtLevel(this.state.level);
      const currentTotal = this.state.level - 1 + this.state.unspentTalentPoints;
      if (expectedPoints > currentTotal) {
        this.state.unspentTalentPoints += expectedPoints - currentTotal;
      } else {
        this.state.unspentTalentPoints += 1;
      }
      this.bus.emit('tower_leveled', {
        level: this.state.level,
        xp: this.state.xp,
        talentPoints: this.state.unspentTalentPoints,
      });
    }
  }

  getProgressToNextLevel(): number {
    const currentXp = this.state.xp;
    const currentLevel = this.state.level;
    if (xpToLevel(currentXp) > currentLevel) return 1;
    const needed = xpForNextLevel(currentLevel);
    if (needed <= 0 || needed === Infinity) return 1;
    const xpIntoLevel = currentXp - TOWER_XP_TABLE[currentLevel];
    return Math.min(1, Math.max(0, xpIntoLevel) / needed);
  }

  spendTalentPoint(): boolean {
    if (this.state.unspentTalentPoints <= 0) return false;
    this.state.unspentTalentPoints -= 1;
    return true;
  }

  grantTalentPoint(): void {
    this.state.unspentTalentPoints += 1;
    this.bus.emit('tower_leveled', {
      level: this.state.level,
      xp: this.state.xp,
      talentPoints: this.state.unspentTalentPoints,
    });
  }
}
