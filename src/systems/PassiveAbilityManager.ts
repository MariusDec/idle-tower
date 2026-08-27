import type { EnemyType, PassiveAbilityState } from '../types';
import {
  PASSIVE_ABILITIES,
  PASSIVE_BY_ID,
  PASSIVE_MAX_LEVEL,
  PASSIVE_STATS,
  passiveStatValue,
  passiveUpgradeCost,
  type PassiveAbilityDef,
  type PassiveStat,
} from '../data/passiveAbilities';
import { passiveXpForLevel, passiveXpPerKill, passiveXpPerWaveClear } from '../data/xpTables';
import { EventBus } from '../game/EventBus';

/**
 * The passive-ability track.
 *
 * Two currencies, one bar. XP fills it and a full bar levels for free; gold
 * buys whatever fraction of the bar is still empty, at a pro-rata price. Both
 * curves are anchored to the passive's own `unlockWave` (see `xpTables.ts` §3
 * and `passiveAbilities.ts` §4.2), which is the fix for the old system's
 * headline defect: one shared XP table against a faucet that grew with the live
 * wave meant a late passive gained ten levels inside its first wave.
 */
export class PassiveAbilityManager {
  private state: Record<string, PassiveAbilityState>;
  private readonly bus: EventBus;
  /** Fed from `applyResolvedStats`, so Prospector and the combo tier count. */
  private xpGainMultiplier = 1;
  /** Recomputed on any level/unlock change; read once per stat recompute. */
  private statCache: Partial<Record<PassiveStat, number>> | null = null;

  constructor(state: Record<string, PassiveAbilityState>, bus: EventBus) {
    this.state = state;
    this.bus = bus;
  }

  ensureInitialized(): void {
    for (const def of PASSIVE_ABILITIES) {
      const s = this.state[def.id];
      if (!s) {
        this.state[def.id] = { level: 0, xp: 0, unlocked: false };
      } else {
        if (s.unlocked === undefined) s.unlocked = false;
        s.level = Math.max(0, Math.min(PASSIVE_MAX_LEVEL, Math.floor(s.level ?? 0)));
        s.xp = Math.max(0, s.xp ?? 0);
      }
    }
    // Ids that no longer exist (an old save, a renamed passive) are dropped so
    // they cannot sit in the save forever contributing nothing.
    for (const id of Object.keys(this.state)) {
      if (!PASSIVE_BY_ID[id]) delete this.state[id];
    }
    this.statCache = null;
  }

  setXpGainMultiplier(mult: number): void {
    this.xpGainMultiplier = Math.max(0, mult);
  }

  addKillXp(type: EnemyType, wave: number): void {
    const amount = passiveXpPerKill(type, wave) * this.xpGainMultiplier;
    this.grantAll(amount);
  }

  addWaveClearXp(wave: number): void {
    const amount = passiveXpPerWaveClear(wave) * this.xpGainMultiplier;
    this.grantAll(amount);
  }

  /** Offline catch-up: raw XP already scaled by the caller. */
  addRawXp(amount: number): void {
    this.grantAll(amount);
  }

  private grantAll(amount: number): void {
    if (!(amount > 0)) return;
    for (const def of PASSIVE_ABILITIES) {
      const s = this.state[def.id];
      if (!s || !s.unlocked || s.level >= PASSIVE_MAX_LEVEL) continue;
      s.xp += amount;
      this.checkLevelUp(def, s);
    }
  }

  private checkLevelUp(def: PassiveAbilityDef, state: PassiveAbilityState): void {
    while (state.level < PASSIVE_MAX_LEVEL) {
      const needed = passiveXpForLevel(def, state.level + 1);
      if (needed <= 0 || state.xp < needed) break;
      state.xp -= needed;
      state.level += 1;
      this.onLeveled(def, state.level, 'xp');
    }
    if (state.level >= PASSIVE_MAX_LEVEL) state.xp = 0;
  }

  private onLeveled(def: PassiveAbilityDef, level: number, via: 'xp' | 'gold'): void {
    this.statCache = null;
    const milestone = def.milestones.find(m => m.at === level) ?? null;
    this.bus.emit('passive_leveled', {
      id: def.id,
      name: def.name,
      level,
      via,
      maxed: level >= PASSIVE_MAX_LEVEL,
      milestone: milestone ? { at: milestone.at, label: milestone.label } : null,
    });
  }

  /** Summed contribution of every unlocked passive to every stat. */
  getStatTotals(): Readonly<Partial<Record<PassiveStat, number>>> {
    if (this.statCache) return this.statCache;
    const out: Partial<Record<PassiveStat, number>> = {};
    for (const def of PASSIVE_ABILITIES) {
      const s = this.state[def.id];
      // Unlocking costs gold, so it must *do* something immediately: every
      // effect's `base` is the level-0 value and applies the moment it unlocks.
      if (!s || !s.unlocked) continue;
      for (const stat of PASSIVE_STATS) {
        const v = passiveStatValue(def, stat, s.level);
        if (v !== 0) out[stat] = (out[stat] ?? 0) + v;
      }
    }
    this.statCache = out;
    return out;
  }

  getLevel(id: string): number { return this.state[id]?.level ?? 0; }
  getXp(id: string): number { return this.state[id]?.xp ?? 0; }
  isUnlocked(id: string): boolean { return this.state[id]?.unlocked ?? false; }

  isMaxed(id: string): boolean {
    const s = this.state[id];
    return s ? s.level >= PASSIVE_MAX_LEVEL : false;
  }

  /** XP needed for the next level, or 0 at max. */
  getXpForNextLevel(id: string): number {
    const def = PASSIVE_BY_ID[id];
    const s = this.state[id];
    if (!def || !s || s.level >= PASSIVE_MAX_LEVEL) return 0;
    return passiveXpForLevel(def, s.level + 1);
  }

  /** Count of unlocked passives, for the panel header. */
  get unlockedCount(): number {
    let n = 0;
    for (const def of PASSIVE_ABILITIES) if (this.state[def.id]?.unlocked) n += 1;
    return n;
  }

  /** Sum of every passive's level, for the panel header. */
  get totalLevels(): number {
    let n = 0;
    for (const def of PASSIVE_ABILITIES) n += this.state[def.id]?.level ?? 0;
    return n;
  }

  canUnlock(id: string, lifetimeHighestWave: number): boolean {
    const s = this.state[id];
    const def = PASSIVE_BY_ID[id];
    if (!s || !def || s.unlocked) return false;
    return lifetimeHighestWave >= def.unlockWave;
  }

  getUnlockCost(id: string): number {
    return PASSIVE_BY_ID[id]?.unlockGoldCost ?? 0;
  }

  unlock(id: string): void {
    const s = this.state[id];
    if (!s || s.unlocked) return;
    s.unlocked = true;
    this.statCache = null;
  }

  /** Undiscounted price of the next level. */
  getFullUpgradeCost(id: string): number {
    const def = PASSIVE_BY_ID[id];
    const s = this.state[id];
    if (!def || !s || !s.unlocked || s.level >= PASSIVE_MAX_LEVEL) return 0;
    return passiveUpgradeCost(def, s.level);
  }

  /** Fraction of the next level already paid for by banked XP, 0..1. */
  getXpDiscount(id: string): number {
    const needed = this.getXpForNextLevel(id);
    if (needed <= 0) return 0;
    return Math.min(1, (this.state[id]?.xp ?? 0) / needed);
  }

  /** Price actually charged: the full price times the empty part of the bar. */
  getUpgradeCost(id: string): number {
    const full = this.getFullUpgradeCost(id);
    if (full <= 0) return 0;
    return Math.max(1, Math.floor(full * (1 - this.getXpDiscount(id))));
  }

  canUpgrade(id: string, gold: number): boolean {
    const cost = this.getUpgradeCost(id);
    return cost > 0 && gold >= cost;
  }

  /** Buys the next level. Returns the gold spent, or 0 if it could not. */
  upgrade(id: string): number {
    const def = PASSIVE_BY_ID[id];
    const s = this.state[id];
    if (!def || !s || !s.unlocked || s.level >= PASSIVE_MAX_LEVEL) return 0;
    const cost = this.getUpgradeCost(id);
    if (cost <= 0) return 0;
    s.level += 1;
    // Banked XP was spent as the discount, so it does not roll over.
    s.xp = 0;
    this.onLeveled(def, s.level, 'gold');
    return cost;
  }

  /** Transcendence only. Ascension leaves passives alone. */
  reset(): void {
    for (const key of Object.keys(this.state)) delete this.state[key];
    this.ensureInitialized();
  }
}
