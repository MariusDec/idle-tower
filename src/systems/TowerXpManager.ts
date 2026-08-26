import type { TowerXpState, EnemyType } from '../types';
import { TOWER_XP_TABLE, TOWER_LEVEL_CAP, xpPerKill, xpPerWaveClear, pioneerBonusXp, xpToLevel, xpForNextLevel, talentPointsAtLevel } from '../data/xpTables';
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
  get atCap(): boolean { return this.state.level >= TOWER_LEVEL_CAP; }
  get xp(): number { return this.state.xp; }
  get totalXpEarned(): number { return this.state.totalXpEarned; }
  get unspentTalentPoints(): number { return this.state.unspentTalentPoints; }

  setXpGainMultiplier(mult: number): void {
    this.xpGainMultiplier = Math.max(0, mult);
  }

  addKillXp(type: EnemyType, wave: number): void {
    this.addXp(xpPerKill(type, wave));
  }

  addWaveClearXp(wave: number, lifetimeHighestWave: number): void {
    this.addXp(xpPerWaveClear(wave) + pioneerBonusXp(wave, lifetimeHighestWave));
  }

  private addXp(amount: number): void {
    if (amount <= 0) return;
    const gained = Math.floor(amount * this.xpGainMultiplier);
    if (gained <= 0) return;
    this.state.totalXpEarned += gained;
    if (this.atCap) return;
    this.state.xp = Math.min(this.state.xp + gained, TOWER_XP_TABLE[TOWER_LEVEL_CAP]);
    const newLevel = xpToLevel(this.state.xp);
    while (this.state.level < newLevel) {
      const previousLevel = this.state.level;
      this.state.level += 1;
      // Grant exactly the delta in total points owed between the two levels.
      this.state.unspentTalentPoints +=
        talentPointsAtLevel(this.state.level) - talentPointsAtLevel(previousLevel);
      this.bus.emit('tower_leveled', {
        level: this.state.level,
        xp: this.state.xp,
        talentPoints: this.state.unspentTalentPoints,
      });
    }
  }

  getProgressToNextLevel(): number {
    if (this.atCap) return 1;
    const currentXp = this.state.xp;
    const currentLevel = this.state.level;
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
