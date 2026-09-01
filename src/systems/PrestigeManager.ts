import type { GameState, PrestigeState, ResourceState, GameStats } from '../types';
import {
  AP_PERKS,
  AP_PERK_BY_ID,
  TP_PERKS,
  TP_PERK_BY_ID,
  ASCENSION_UNLOCK_WAVE,
  FIRST_ASCENSION_AP,
  TRANSCENDENCE_UNLOCK_AP,
  apForWave,
  tpForAP,
  canTranscend,
  perkCost,
  computePerkEffect,
  BASE_IDLE_TIME_SECONDS,
  abilityUnlockOffset,
  secondWindTier,
  type AutomationKey,
} from '../data/prestige';
import { BLESSING_FIRST_DRAFT_WAVE } from '../data/blessings';
import { lifetimeAPDamageBonus, lifetimeAPGoldBonus } from '../data/formulas';
import { CORE_BY_ID, type CoreId } from '../data/cores';
import { EventBus } from '../game/EventBus';
import type { AchievementRewardType } from '../data/achievements';

/**
 * Who banked a run-scoped AP bonus. A closed union so a third source cannot be
 * added without a decision about how it is persisted and reset.
 */
export type RunApSource = 'boss' | 'contract';

export interface AscensionContext {
  resources: ResourceState;
  stats: GameStats;
  prestige: PrestigeState;
  /**
   * Achievement reward lookup. Injected lazily because the achievement manager
   * is constructed after this one.
   */
  achievementMultiplier?: (type: AchievementRewardType) => number;
  /**
   * Out-of-tree automation grants (plans/milestones.md §5.6).
   *
   * The Watch's `overseer` unlock unlocks `autoBuy` without an AP perk; this
   * callback lets `Game` route that decision here. Default returns `false`
   * for every key, so the manager's perk tables remain the only grant path
   * for any caller that does not pass one.
   */
  externalAutomation?: (key: AutomationKey) => boolean;
}

export class PrestigeManager {
  private readonly bus: EventBus;
  private readonly ctx: AscensionContext;
  /**
   * Run-scoped AP bonus, by source.
   *
   * A separate channel from the lifetime achievement bonuses, because those are
   * permanent and this one is the run's own: they compose (`(1 + ach) * (1 +
   * run)`) rather than one silently overwriting the other.
   *
   * It is keyed by source rather than being one number because two systems bank
   * into it — flawless boss encounters (plan §3.4) and completed contracts
   * (plan §5.2) — and each has its own ceiling and its own persistence block
   * (`GameState.bossRun`, `GameState.contracts`). One shared scalar would mean
   * a contract restore could silently erase the boss bonus, or vice versa.
   * Both are *set* on load from their own saved figure, and summed here.
   */
  private runApBonusBySource: Record<RunApSource, number> = { boss: 0, contract: 0 };
  /**
   * The risk dial's AP bonus (plan §7.4), as a fraction.
   *
   * Deliberately *not* a `RunApSource`. The two sources above are earned and
   * banked — they accumulate over a run and share a +50% ceiling — whereas
   * risk is a live setting with no ceiling of its own that stops applying the
   * moment the dial goes back to 0. Summing it into the same pool would have
   * let the contract cap silently swallow it, and let a contract restore
   * overwrite it. It multiplies instead, so the two compose.
   */
  private riskApBonus = 0;

  constructor(bus: EventBus, ctx: AscensionContext) {
    this.bus = bus;
    this.ctx = ctx;
  }

  /** Bank a run-scoped AP bonus for the rest of this run. */
  addRunApBonus(fraction: number, source: RunApSource = 'boss'): void {
    if (fraction <= 0) return;
    this.runApBonusBySource[source] += fraction;
  }

  /** Restore one source's banked bonus from a save (or clear it on reset). */
  setRunApBonus(fraction: number, source: RunApSource = 'boss'): void {
    this.runApBonusBySource[source] = Math.max(0, fraction);
  }

  /** Set the risk dial's AP bonus. Derived from `PacingManager.activeRisk`. */
  setRiskApBonus(fraction: number): void {
    this.riskApBonus = Math.max(0, fraction);
  }

  getRiskApBonus(): number {
    return this.riskApBonus;
  }

  /** The composed run bonus across every source. */
  getRunApBonus(): number {
    let total = 0;
    for (const key of Object.keys(this.runApBonusBySource) as RunApSource[]) {
      total += this.runApBonusBySource[key];
    }
    return total;
  }

  canAscend(wave: number): boolean {
    return wave >= ASCENSION_UNLOCK_WAVE;
  }

  private achievementBonus(type: AchievementRewardType): number {
    return this.ctx.achievementMultiplier?.(type) ?? 0;
  }

  previewAP(wave: number): number {
    const bonus = this.achievementBonus('ap_gain_mult') + this.achievementBonus('prestige_gain_mult');
    const earned = Math.floor(
      apForWave(wave) * (1 + bonus) * (1 + this.getRunApBonus()) * (1 + this.riskApBonus),
    );
    // Plan §2.3.4: the very first ascension is scripted to be worth taking, so
    // a new player's introduction to prestige is a visible jump in power
    // rather than a rounding error.
    if (this.ctx.stats.lifetimeAscensions <= 0) return Math.max(FIRST_ASCENSION_AP, earned);
    return earned;
  }

  ascensionUnlockWave(): number {
    return ASCENSION_UNLOCK_WAVE;
  }

  canTranscend(ascensionPoints: number = this.ctx.resources.apThisTranscendence): boolean {
    return canTranscend(ascensionPoints);
  }

  previewTP(ascensionPoints: number = this.ctx.resources.apThisTranscendence): number {
    const bonus = this.achievementBonus('tp_gain_mult') + this.achievementBonus('prestige_gain_mult');
    return Math.floor(tpForAP(ascensionPoints) * (1 + bonus));
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
    const lifetimeAP = this.ctx.resources.lifetimeAP;
    return {
      damage: lifetimeAPDamageBonus(lifetimeAP),
      gold: lifetimeAPGoldBonus(lifetimeAP),
    };
  }

  /**
   * Additive damage bonus from unbounded AP perks (plan §2.3.5).
   * Separate from `getLifetimeAPBonus` so the two compose rather than one
   * silently standing in for the other.
   */
  getAPDamageBonus(): number {
    let bonus = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'damage_mult') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) bonus += computePerkEffect(p, lvl);
    }
    return bonus;
  }

  /** Additive gold bonus from unbounded AP perks (plan §2.3.5). */
  getAPGoldBonus(): number {
    let bonus = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'resource_mult') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) bonus += computePerkEffect(p, lvl);
    }
    return bonus;
  }

  /**
   * Fire-rate multiplier from Deep Quiver (revamp §8.2).
   *
   * Multiplicative per perk the way the TP fire-rate node composes, so the two
   * layers stack the same way; consumed in `stats/contributors/prestige.ts`.
   */
  getAPFireRateMultiplier(): number {
    let factor = 1;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'fire_rate_mult') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) factor *= 1 + computePerkEffect(p, lvl);
    }
    return factor;
  }

  /** Flat `pierceExtra` from Bodkin Mastery (revamp §8.2). */
  getAPPierceBonus(): number {
    let total = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'pierce') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) total += Math.floor(computePerkEffect(p, lvl));
    }
    return total;
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
    return computePerkEffect(def, this.getAPLevel('ap_wave_skipper'));
  }

  getTPDamageMultiplicative(): number {
    let factor = 1;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'damage_mult') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) factor *= 1 + computePerkEffect(p, lvl);
    }
    return factor;
  }

  getTPResourceMultiplicative(): number {
    let factor = 1;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'resource_mult') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) factor *= 1 + computePerkEffect(p, lvl);
    }
    return factor;
  }

  isAutomationUnlocked(key: AutomationKey): boolean {
    // Watch unlocks are a second, independent grant path
    // (plans/milestones.md §5.6). Checked first because it is a set lookup
    // and the perk scan is not.
    if (this.ctx.externalAutomation?.(key)) return true;
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
    // Plan §3.2: the AP layer is a tree now, so it obeys the same prerequisite
    // and exclusivity rules the TP tree always has.
    if (!this.meetsPrerequisites(perkId)) return false;
    if (this.isExcluded(perkId)) return false;
    return this.ctx.resources.ascensionPoints >= perkCost(def, level);
  }

  canSpendTP(perkId: string): boolean {
    const def = TP_PERK_BY_ID[perkId];
    if (!def) return false;
    const level = this.getTPLevel(perkId);
    if (level >= def.maxLevel) return false;
    if (!this.meetsPrerequisites(perkId)) return false;
    if (this.isExcluded(perkId)) return false;
    return this.ctx.resources.transcendencePoints >= perkCost(def, level);
  }

  /** A perk by id from either layer — the two id spaces do not overlap. */
  private perkDef(perkId: string) {
    return AP_PERK_BY_ID[perkId] ?? TP_PERK_BY_ID[perkId] ?? null;
  }

  meetsPrerequisites(perkId: string): boolean {
    const def = this.perkDef(perkId);
    if (!def || !def.prerequisites || def.prerequisites.length === 0) return true;
    return def.prerequisites.some(
      req => this.getLevel(req.perkId) >= req.minLevel,
    );
  }

  isExcluded(perkId: string): boolean {
    const def = this.perkDef(perkId);
    if (!def || !def.exclusive || def.exclusive.length === 0) return false;
    return def.exclusive.some(excId => this.getLevel(excId) > 0);
  }

  /**
   * Human-readable reason a perk cannot be bought yet, or null when it can be
   * (ignoring affordability, which the panel reports separately).
   */
  perkBlockedReason(perkId: string): string | null {
    const def = this.perkDef(perkId);
    if (!def) return null;
    if (this.isExcluded(perkId)) {
      const blocker = (def.exclusive ?? []).find(id => this.getLevel(id) > 0);
      const name = blocker ? this.perkDef(blocker)?.name ?? blocker : 'another perk';
      return `Locked out by ${name}`;
    }
    if (!this.meetsPrerequisites(perkId)) {
      const reqs = (def.prerequisites ?? []).map(r => {
        const name = this.perkDef(r.perkId)?.name ?? r.perkId;
        return r.minLevel > 1 ? `${name} Lv.${r.minLevel}` : name;
      });
      return reqs.length > 0 ? `Requires ${reqs.join(' or ')}` : null;
    }
    return null;
  }

  // ── New TP tree query methods ──

  getTPFireRateMultiplier(): number {
    let factor = 1;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'fire_rate_mult') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) factor *= 1 + computePerkEffect(p, lvl);
    }
    return factor;
  }

  getTPCritDamageBonus(): number {
    let bonus = 0;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'crit_damage_mult') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) bonus += computePerkEffect(p, lvl);
    }
    return bonus;
  }

  getTPPierceBonus(): number {
    let total = 0;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'pierce') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) total += Math.floor(computePerkEffect(p, lvl));
    }
    return total;
  }

  hasAoESplash(): boolean {
    for (const p of TP_PERKS) {
      if (p.effectType !== 'aoe_splash') continue;
      if (this.getTPLevel(p.id) > 0) return true;
    }
    return false;
  }

  getAoESplashFraction(): number {
    for (const p of TP_PERKS) {
      if (p.effectType !== 'aoe_splash') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) return computePerkEffect(p, lvl);
    }
    return 0;
  }

  hasExecuteDamage(): boolean {
    for (const p of TP_PERKS) {
      if (p.effectType !== 'execute_damage') continue;
      if (this.getTPLevel(p.id) > 0) return true;
    }
    return false;
  }

  getExecuteDamageMultiplier(): number {
    for (const p of TP_PERKS) {
      if (p.effectType !== 'execute_damage') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) return computePerkEffect(p, lvl);
    }
    return 0;
  }

  getTreasureChance(): number {
    let chance = 0;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'treasure_chance') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) chance += computePerkEffect(p, lvl);
    }
    return chance;
  }

  getTPManaRegenMultiplier(): number {
    let factor = 1;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'mana_regen_mult') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) factor *= 1 + computePerkEffect(p, lvl);
    }
    return factor;
  }

  /**
   * Gold every run opens with, across both layers.
   *
   * `tp_head_start` and `ap_seed_capital` (prestige-abs §3.1) are the same
   * effect bought in two currencies, so they sum here rather than each growing
   * its own call site in `Game`.
   */
  getStartGold(): number {
    let total = 0;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'start_gold') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) total += computePerkEffect(p, lvl);
    }
    for (const p of AP_PERKS) {
      if (p.effectType !== 'start_gold') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) total += computePerkEffect(p, lvl);
    }
    return total;
  }

  // ── prestige-abs §3.1: the tier-1 shelf ──
  //
  // Each of these is the same scan-the-table shape as the rows above; `Game`
  // reads them once per stat recompute and routes them onto the `StatKey` that
  // already has a consumer.

  /** Prospector: upgrade-cost reduction as a positive fraction. */
  getAPUpgradeDiscount(): number {
    let total = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'upgrade_cost') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) total += computePerkEffect(p, lvl);
    }
    return total;
  }

  /** Veterancy: tower/passive XP multiplier, already `1 + x` shaped. */
  getAPXpMultiplier(): number {
    let bonus = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'xp_gain') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) bonus += computePerkEffect(p, lvl);
    }
    return 1 + bonus;
  }

  /** Field Notes: added to the base RP drop chance, as a fraction. */
  getAPRpDropBonus(): number {
    let total = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'rp_drop') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) total += computePerkEffect(p, lvl);
    }
    return total;
  }

  /**
   * Second Wind: extra revive charges, as a whole number.
   *
   * Every level grants the same single charge (see `SECOND_WIND_LEVELS`) — the
   * levels buy the revive's *quality*, which the two accessors below carry.
   * Unlike the evolution and the passive charges this one is not once per run:
   * `Game` puts it on a `SECOND_WIND_RESTOCK_SECONDS` clock after each use.
   */
  getAPReviveCharges(): number {
    let total = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'revive_charge') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) total += Math.floor(computePerkEffect(p, lvl));
    }
    return total;
  }

  /** Highest Second Wind level held, or 0 when the perk is unbought. */
  private getReviveLevel(): number {
    let best = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'revive_charge') continue;
      best = Math.max(best, this.getAPLevel(p.id));
    }
    return best;
  }

  /** HP fraction a Second Wind revive restores, or 0 without the perk. */
  getAPReviveHpFraction(): number {
    const lvl = this.getReviveLevel();
    return lvl > 0 ? secondWindTier(lvl).hpFraction : 0;
  }

  /** Whether a Second Wind revive also shoves the field back (level 3+). */
  hasAPReviveShockwave(): boolean {
    const lvl = this.getReviveLevel();
    return lvl > 0 && secondWindTier(lvl).shockwave;
  }

  /**
   * Lodestone: whether the permanent loot magnet is held.
   *
   * A boolean rather than a `StatKey`, because the accumulator is
   * numeric-by-contract and a 0/1 key invites a 0.5 nobody can interpret. It
   * routes through `LootManager.setMagnetSource('prestige', …)`, which is
   * ref-counted alongside the `orb_magnet` blessing and Gold Rush.
   */
  hasOrbMagnet(): boolean {
    for (const p of AP_PERKS) {
      if (p.effectType !== 'orb_magnet') continue;
      if (this.getAPLevel(p.id) > 0) return true;
    }
    return false;
  }

  // ── prestige-abs §5: the nodes with their own manager hook ──

  /** Opening Gambit: the wave the run's first blessing draft lands on. */
  getFirstDraftWave(): number {
    for (const p of AP_PERKS) {
      if (p.effectType !== 'first_draft_wave') continue;
      if (this.getAPLevel(p.id) > 0) return 1;
    }
    return BLESSING_FIRST_DRAFT_WAVE;
  }

  /** Field Kit: blessing reroll tokens banked at the start of every run. */
  getStartingRerollTokens(): number {
    let total = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'blessing_rerolls') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) total += Math.floor(computePerkEffect(p, lvl));
    }
    return total;
  }

  /** Attunement: waves every ability unlock is pulled forward by. */
  getAbilityUnlockOffset(): number {
    return abilityUnlockOffset(this.ctx.prestige.apSpent);
  }

  /** Broker: contract gold and RP multiplier, already `1 + x` shaped. */
  getContractRewardMultiplier(): number {
    let bonus = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'contract_reward') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) bonus += computePerkEffect(p, lvl);
    }
    return 1 + bonus;
  }

  /**
   * Salvage (§9.2): the loot-orb gold multiplier, `1 + fraction`.
   *
   * Replaces Midas Touch's per-hit faucet — this rides wave income, so it
   * cannot be farmed by stacking fire rate and projectile count.
   */
  getOrbGoldMultiplier(): number {
    let mult = 1;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'orb_gold_mult') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) mult += computePerkEffect(p, lvl);
    }
    return mult;
  }

  getAbilityCDR(): number {
    let cdr = 0;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'ability_cdr') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) cdr += computePerkEffect(p, lvl);
    }
    return cdr;
  }

  getAbilityManaCostReduction(): number {
    for (const p of TP_PERKS) {
      if (p.effectType !== 'ability_cdr') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) return -0.40;
    }
    return 0;
  }

  getWaveStartBonus(): number {
    let total = 0;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'wave_start') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) total += computePerkEffect(p, lvl);
    }
    return total;
  }

  getAutoBuySpeedReduction(): number {
    let total = 0;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'auto_buy_speed') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) total += computePerkEffect(p, lvl);
    }
    return total;
  }

  /**
   * How many upgrades auto-buy may purchase in one tick.
   *
   * The Auto-Upgrader perk's *level* is the budget: L1 buys one upgrade per
   * interval, L3 buys three. A grant from another source — the Watch's
   * `overseer` unlock — has no level, so it counts as one. Returns 0 when
   * auto-buy is not unlocked at all, which is what stops the manager from
   * running a loop it has no permission for.
   */
  getAutoBuyCount(): number {
    const fromPerk = this.getAPLevel('ap_auto_upgrader');
    if (fromPerk > 0) return fromPerk;
    return this.isAutomationUnlocked('autoBuy') ? 1 : 0;
  }

  /** Returns the multiplier for research time (e.g. 0.55 = 45% faster). */
  getResearchSpeedMultiplier(): number {
    let reduction = 0;
    for (const p of AP_PERKS) {
      if (p.effectType !== 'research_speed') continue;
      const lvl = this.getAPLevel(p.id);
      if (lvl > 0) reduction += computePerkEffect(p, lvl);
    }
    return Math.max(0.1, 1 - reduction);
  }

  getGameSpeedBonus(): number {
    let bonus = 0;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'game_speed') continue;
      const lvl = this.getTPLevel(p.id);
      if (lvl > 0) bonus += computePerkEffect(p, lvl);
    }
    return bonus;
  }

  /**
   * Offline-progress cap in seconds (plan §10.1).
   *
   * Derived, never stored: `BASE_IDLE_TIME_SECONDS` plus 8h per level of
   * `ap_idle_time`. The save layer calls this through `Game` when it needs the
   * cap, so a perk purchase moves the ceiling on the next offline walk.
   */
  getIdleTimeCapSeconds(): number {
    const def = AP_PERK_BY_ID['ap_idle_time'];
    if (!def) return BASE_IDLE_TIME_SECONDS;
    return BASE_IDLE_TIME_SECONDS + computePerkEffect(def, this.getAPLevel('ap_idle_time'));
  }

  spendAP(perkId: string): boolean {
    const def = AP_PERK_BY_ID[perkId];
    if (!def) return false;
    if (!this.canSpendAP(perkId)) return false;
    this.ctx.resources.ascensionPoints -= perkCost(def, this.getAPLevel(perkId));
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
    this.ctx.resources.transcendencePoints -= perkCost(def, this.getTPLevel(perkId));
    this.ctx.prestige.tpSpent[perkId] = this.getTPLevel(perkId) + 1;
    if (def.effectType === 'automation' && def.automationKey) {
      this.ctx.prestige.automationFlags[def.automationKey] = true;
      this.bus.emit('automation_unlocked', { key: def.automationKey });
    }
    this.bus.emit('tp_spent', { id: perkId, level: this.ctx.prestige.tpSpent[perkId] });
    return true;
  }

  // ── tower cores (plan §6.2) ──

  /**
   * Whether the player can afford to unlock a core right now.
   *
   * Cores are an AP *spend*, not an AP perk: they have no levels, no
   * prerequisites and no exclusivity, and `AP_PERKS` is a table the panel
   * renders row by row with a level counter. Threading a one-shot purchase with
   * a different UI through `perkCost`/`computePerkEffect` would have meant
   * every consumer of that table learning about a perk that has no effect
   * value. The spend lives here because this is the class that owns the AP
   * balance; whether the core is *already owned* is `CoreManager`'s business,
   * so the caller passes the answer in.
   */
  canUnlockCore(id: CoreId, alreadyUnlocked: boolean): boolean {
    if (alreadyUnlocked) return false;
    const def = CORE_BY_ID[id];
    if (!def || def.apCost <= 0) return false;
    return this.ctx.resources.ascensionPoints >= def.apCost;
  }

  /** Debit the AP for a core. Returns false without spending when it cannot. */
  spendOnCore(id: CoreId, alreadyUnlocked: boolean): boolean {
    if (!this.canUnlockCore(id, alreadyUnlocked)) return false;
    this.ctx.resources.ascensionPoints -= CORE_BY_ID[id].apCost;
    this.bus.emit('ap_spent', { id: `core:${id}`, level: 1 });
    return true;
  }

  /**
   * Refund every AP spent on perks and clear the AP tree (prestige-abs §6.1).
   *
   * Widening tier 1 into a real decision makes a wrong first choice a
   * permanent one, and a respec is what makes the decision safe to take. AP
   * perks are permanent and never run-scoped, so unlike a TP respec there is
   * nothing here that could be timed against a live run for profit.
   *
   * Two things the refund is deliberately *not*:
   *  - **Cores are not refunded.** They are an AP spend, not a perk, and they
   *    are not in `apSpent` at all. The confirm dialog says so.
   *  - **`automationFlags` is not left alone.** `autoBuy` is set true on
   *    purchase and read back from the stored flag, so clearing the tree
   *    without re-deriving the flags would leave a player who reforged away
   *    Auto-Upgrader still auto-buying. Every flag is re-derived against the
   *    post-reforge tables (which still see the Watch's `overseer` grant).
   *
   * Returns the AP credited back.
   */
  reforge(): number {
    let refund = 0;
    for (const [perkId, level] of Object.entries(this.ctx.prestige.apSpent)) {
      const def = AP_PERK_BY_ID[perkId];
      if (!def || !Number.isFinite(level) || level <= 0) continue;
      for (let l = 0; l < level; l++) refund += perkCost(def, l);
    }
    this.ctx.prestige.apSpent = {};
    this.ctx.resources.ascensionPoints += refund;
    const flags = this.ctx.prestige.automationFlags;
    for (const key of Object.keys(flags) as AutomationKey[]) {
      flags[key] = this.isAutomationUnlocked(key) && flags[key];
    }
    this.bus.emit('ap_reforged', { refunded: refund });
    return refund;
  }

  /** AP a reforge would credit back right now. Drives the confirm dialog. */
  reforgeValue(): number {
    let refund = 0;
    for (const [perkId, level] of Object.entries(this.ctx.prestige.apSpent)) {
      const def = AP_PERK_BY_ID[perkId];
      if (!def || !Number.isFinite(level) || level <= 0) continue;
      for (let l = 0; l < level; l++) refund += perkCost(def, l);
    }
    return refund;
  }

  spendPerk(perkId: string): boolean {
    if (AP_PERK_BY_ID[perkId]) return this.spendAP(perkId);
    if (TP_PERK_BY_ID[perkId]) return this.spendTP(perkId);
    return false;
  }

  performAscension(state: GameState): { ap: number } {
    const waveNumber = state.wave.highestWave;
    if (!this.canAscend(waveNumber)) return { ap: 0 };
    const ap = this.previewAP(waveNumber);
    this.ctx.resources.ascensionPoints += ap;
    this.ctx.resources.apThisTranscendence += ap;
    this.ctx.resources.lifetimeAP += ap;
    this.ctx.stats.ascensions += 1;
    this.ctx.stats.lifetimeAscensions += 1;
    // The run bonuses are *this run's*: the ascension that pays them out is
    // also the one that ends the run that earned them. Every source clears.
    this.runApBonusBySource = { boss: 0, contract: 0 };
    this.bus.emit('ascension_performed', {
      apGained: ap,
      totalAP: this.ctx.resources.ascensionPoints,
      lifetimeAP: this.ctx.resources.lifetimeAP,
      ascensions: this.ctx.stats.ascensions,
    });
    return { ap };
  }

  performTranscendence(_state: GameState): { tp: number } {
    const ascensionPoints = this.ctx.resources.apThisTranscendence;
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
