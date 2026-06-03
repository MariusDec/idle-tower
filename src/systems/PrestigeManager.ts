import type { GameState, PrestigeState, ResourceState, GameStats } from '../types';
import {
  AP_PERKS,
  AP_PERK_BY_ID,
  TP_PERKS,
  TP_PERK_BY_ID,
  ASCENSION_UNLOCK_WAVE,
  TRANSCENDENCE_UNLOCK_AP,
  apForWave,
  tpForAP,
  canTranscend,
  type AutomationKey,
} from '../data/prestige';
import { EventBus } from '../game/EventBus';

export interface AscensionContext {
  resources: ResourceState;
  stats: GameStats;
  prestige: PrestigeState;
}

export class PrestigeManager {
  private readonly bus: EventBus;
  private readonly ctx: AscensionContext;

  constructor(bus: EventBus, ctx: AscensionContext) {
    this.bus = bus;
    this.ctx = ctx;
  }

  canAscend(wave: number): boolean {
    return wave >= ASCENSION_UNLOCK_WAVE;
  }

  previewAP(wave: number): number {
    return apForWave(wave);
  }

  ascensionUnlockWave(): number {
    return ASCENSION_UNLOCK_WAVE;
  }

  canTranscend(ascensionPoints: number = this.ctx.resources.ascensionPoints): boolean {
    return canTranscend(ascensionPoints);
  }

  previewTP(ascensionPoints: number = this.ctx.resources.ascensionPoints): number {
    return tpForAP(ascensionPoints);
  }

  transcendenceUnlockAP(): number {
    return TRANSCENDENCE_UNLOCK_AP;
  }

  apPerks(): typeof AP_PERKS {
    return AP_PERKS;
  }

  tpPerks(): typeof TP_PERKS {
    return TP_PERKS;
  }

  getAPLevel(perkId: string): number {
    return this.ctx.prestige.apSpent[perkId] ?? 0;
  }

  getTPLevel(perkId: string): number {
    return this.ctx.prestige.tpSpent[perkId] ?? 0;
  }

  getLevel(perkId: string): number {
    return this.getAPLevel(perkId) || this.getTPLevel(perkId);
  }

  getDamageBonusAdditive(): number {
    return 0;
  }

  getGoldBonusAdditive(): number {
    return 0;
  }

  getManaRegenBonusAdditive(): number {
    return 0;
  }

  getDamageBonus(): number {
    return 0;
  }

  getGoldBonus(): number {
    return 0;
  }

  getManaRegenBonus(): number {
    return 0;
  }

  getLifetimeAPBonus(): { damage: number; gold: number } {
    const bonus = Math.max(0, this.ctx.resources.lifetimeAP) * 0.02;
    return { damage: bonus, gold: bonus };
  }

  getExtraShots(): number {
    return this.getAPLevel('ap_extra_shots');
  }

  getScatterShots(): number {
    return this.getAPLevel('ap_scatter_shots');
  }

  getBackShots(): number {
    return this.getAPLevel('ap_back_shots');
  }

  getWaveSkipChance(): number {
    const def = AP_PERK_BY_ID['ap_wave_skipper'];
    if (!def) return 0;
    return def.effectPerLevel * this.getAPLevel('ap_wave_skipper');
  }

  getTPDamageMultiplicative(): number {
    let factor = 1;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'damage_mult') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) factor *= 1 + p.effectPerLevel * lvl;
    }
    return factor;
  }

  getTPResourceMultiplicative(): number {
    let factor = 1;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'resource_mult') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) factor *= 1 + p.effectPerLevel * lvl;
    }
    return factor;
  }

  isAutomationUnlocked(key: AutomationKey): boolean {
    for (const p of AP_PERKS) {
      if (p.effectType === 'auto_buy' && p.automationKey === key) {
        if (this.getAPLevel(p.id) > 0) return true;
      }
    }
    for (const p of TP_PERKS) {
      if (p.effectType === 'automation' && p.automationKey === key) {
        if (this.getTPLevel(p.id) > 0) return true;
      }
    }
    return false;
  }

  getAutomationEnabled(key: AutomationKey): boolean {
    return this.ctx.prestige.automationFlags[key];
  }

  setAutomationEnabled(key: AutomationKey, enabled: boolean): boolean {
    if (!this.isAutomationUnlocked(key)) return false;
    this.ctx.prestige.automationFlags[key] = enabled;
    this.bus.emit('automation_toggled', { key, enabled });
    return true;
  }

  canSpendAP(perkId: string): boolean {
    const def = AP_PERK_BY_ID[perkId];
    if (!def) return false;
    const level = this.getAPLevel(perkId);
    if (level >= def.maxLevel) return false;
    return this.ctx.resources.ascensionPoints >= def.costPerLevel;
  }

  canSpendTP(perkId: string): boolean {
    const def = TP_PERK_BY_ID[perkId];
    if (!def) return false;
    const level = this.getTPLevel(perkId);
    if (level >= def.maxLevel) return false;
    return this.ctx.resources.transcendencePoints >= def.costPerLevel;
  }

  spendAP(perkId: string): boolean {
    const def = AP_PERK_BY_ID[perkId];
    if (!def) return false;
    if (!this.canSpendAP(perkId)) return false;
    this.ctx.resources.ascensionPoints -= def.costPerLevel;
    this.ctx.prestige.apSpent[perkId] = this.getAPLevel(perkId) + 1;
    if (def.effectType === 'auto_buy' && def.automationKey) {
      this.ctx.prestige.automationFlags[def.automationKey] = true;
      this.bus.emit('automation_unlocked', { key: def.automationKey });
    }
    this.bus.emit('ap_spent', { id: perkId, level: this.ctx.prestige.apSpent[perkId] });
    return true;
  }

  spendTP(perkId: string): boolean {
    const def = TP_PERK_BY_ID[perkId];
    if (!def) return false;
    if (!this.canSpendTP(perkId)) return false;
    this.ctx.resources.transcendencePoints -= def.costPerLevel;
    this.ctx.prestige.tpSpent[perkId] = this.getTPLevel(perkId) + 1;
    if (def.effectType === 'automation' && def.automationKey) {
      this.ctx.prestige.automationFlags[def.automationKey] = true;
      this.bus.emit('automation_unlocked', { key: def.automationKey });
    }
    this.bus.emit('tp_spent', { id: perkId, level: this.ctx.prestige.tpSpent[perkId] });
    return true;
  }

  spendPerk(perkId: string): boolean {
    if (AP_PERK_BY_ID[perkId]) return this.spendAP(perkId);
    if (TP_PERK_BY_ID[perkId]) return this.spendTP(perkId);
    return false;
  }

  performAscension(state: GameState): { ap: number; rp: number } {
    const waveNumber = state.wave.highestWave;
    if (!this.canAscend(waveNumber)) return { ap: 0, rp: 0 };
    const ap = this.previewAP(waveNumber);
    const rp = ap;
    this.ctx.resources.ascensionPoints += ap;
    this.ctx.resources.lifetimeAP += ap;
    this.ctx.stats.ascensions += 1;
    this.ctx.stats.lifetimeAscensions += 1;
    this.bus.emit('ascension_performed', {
      apGained: ap,
      rpGained: rp,
      totalAP: this.ctx.resources.ascensionPoints,
      lifetimeAP: this.ctx.resources.lifetimeAP,
      ascensions: this.ctx.stats.ascensions,
    });
    return { ap, rp };
  }

  performTranscendence(_state: GameState): { tp: number } {
    const ascensionPoints = this.ctx.resources.ascensionPoints;
    if (!this.canTranscend(ascensionPoints)) return { tp: 0 };
    const tp = this.previewTP(ascensionPoints);
    this.ctx.resources.transcendencePoints += tp;
    this.ctx.stats.transcendences += 1;
    this.bus.emit('transcendence_performed', {
      tpGained: tp,
      totalTP: this.ctx.resources.transcendencePoints,
      transcendences: this.ctx.stats.transcendences,
    });
    return { tp };
  }
}
