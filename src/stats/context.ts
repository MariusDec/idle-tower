import type { EquipmentStatType } from '../types';
import type { AchievementRewardType } from '../data/achievements';
import type { TalentStat } from '../data/talentTree';
import type { PassiveStat } from '../data/passiveAbilities';
import type { EvolutionEffectId } from '../data/upgrades';
import type { BlessingBehavior, BlessingStat } from '../data/blessings';
import { DEFAULT_CORE, type CoreId } from '../data/cores';
import type { BuffEntry } from './BuffRegistry';

/** Prestige contributions, read once per recompute from `PrestigeManager`. */
export interface PrestigeInputs {
  /** Lifetime-AP passive bonus (diminishing), as fractions. */
  lifetimeDamage: number;
  lifetimeGold: number;
  /** Bonuses from AP actually spent on perks, as fractions. */
  apDamage: number;
  apGold: number;
  /** Ascension fire-rate multiplier from Deep Quiver (already `1 + x` shaped). */
  apFireRate: number;
  /** Flat pierce from Bodkin Mastery. */
  apPierce: number;
  /** Prospector's upgrade-cost reduction, as a positive fraction. */
  apUpgradeDiscount: number;
  /** Veterancy's XP multiplier (already `1 + x` shaped). */
  apXpGain: number;
  /** Field Notes' added RP drop chance, as a fraction. */
  apRpDrop: number;
  /** Second Wind's extra revive charges, as a whole number. */
  apReviveCharges: number;
  /** Transcendence multipliers (already `1 + x` shaped). */
  tpDamage: number;
  tpFireRate: number;
  tpManaRegen: number;
  tpResource: number;
  /** Additive transcendence bonuses. */
  tpCritDamage: number;
  tpPierce: number;
  /** Salvage's loot-orb gold multiplier (already `1 + x` shaped). */
  orbGoldMultiplier: number;
  /** Negative fractions: mana cost reduction and cooldown reduction. */
  abilityManaCostReduction: number;
  abilityCdr: number;
  treasureChance: number;
  waveSkipChance: number;
  hasExecuteDamage: boolean;
  executeDamageMultiplier: number;
}

/** Research contributions, read once per recompute from `ResearchTree`. */
export interface ResearchInputs {
  goldMultiplicative: number;
  manaRegenMultiplicative: number;
  /** Negative fraction. */
  abilityCostReduction: number;
  abilityPowerBonus: number;
  abilityAreaBonus: number;
  pierceCount: number;
  goldLuckChance: number;
  intermissionSpeedReduction: number;
  enemyHpReduction: number;
  rpDropChanceBonus: number;
}

export interface WaveModifierInputs {
  goldAdditive: number;
  playerDamageMult: number;
}

/**
 * Pacing inputs (plan §7), snapshotted from `PacingManager`.
 *
 * All three are *discrete* on purpose. `risk` moves only on a wave boundary,
 * `comboTier` only when a threshold is crossed, and `momentum` only when a
 * wave is called early or the streak breaks — which is what lets `Game`
 * recompute on a signature change instead of every substep.
 */
export interface PacingInputs {
  /** The risk level the live wave is running (0-5), not the dial setting. */
  risk: number;
  /** Accumulated early-call gold bonus, as a fraction. */
  momentum: number;
  /** Combo tier index: 0 for no combo, 1-4 for the tiers. */
  comboTier: number;
}

/**
 * The run's blessings (plan §1).
 *
 * `stats` arrives already summed across stacks — `BlessingManager` owns that
 * arithmetic, and folds `greed_engine`'s wave-scaling gold into `goldPct` on
 * the way, because its value depends on run state the context has no other
 * reason to carry. `behaviors` is here only for the handful of behaviors that
 * are stat-shaped rather than combat hooks (`last_stand`).
 */
export interface BlessingInputs {
  stats: Readonly<Partial<Record<BlessingStat, number>>>;
  behaviors: readonly BlessingBehavior[];
}

/**
 * The complete, immutable input to a stat recompute.
 *
 * Everything here is plain data — no manager references — so `resolveStats` is
 * a pure function that a test can call with a literal. That is what makes the
 * golden tests in `tests/stats.test.ts` possible, and it is the difference
 * between "the pipeline is correct" and "the pipeline is correct on the one
 * path someone happened to click through".
 */
export interface StatContext {
  /** Current wave number — a few effects scale with run depth. */
  wave: number;
  /**
   * The run's tower core (plan §6).
   *
   * Not optional and not nullable: every run has one, `marksman` is the
   * default, and a context that could omit it would let a code path silently
   * resolve a coreless tower that the game can never actually be in.
   */
  core: CoreId;
  /** Tower HP as a fraction of max, for HP-threshold evolutions. */
  hpFraction: number;
  /** Upgrade id → level. */
  upgrades: Readonly<Record<string, number>>;
  /** Evolution effect → value; absent effects are 0. */
  evolutions: Readonly<Partial<Record<EvolutionEffectId, number>>>;
  prestige: PrestigeInputs;
  research: ResearchInputs;
  achievements: Readonly<Partial<Record<AchievementRewardType, number>>>;
  talents: Readonly<Partial<Record<TalentStat, number>>>;
  passives: Readonly<Partial<Record<PassiveStat, number>>>;
  equipment: Readonly<Partial<Record<EquipmentStatType, number>>>;
  /** Run-scoped blessing draft picks. */
  blessings: BlessingInputs;
  /** Null when no mutator is running on the current wave. */
  waveModifier: WaveModifierInputs | null;
  /** Risk dial, early-call momentum and the kill combo (plan §7). */
  pacing: PacingInputs;
  /** Timed buffs currently in effect (abilities, quick shot, manual aim). */
  buffs: readonly BuffEntry[];
  /** Mana / max mana at the moment of the recompute. Read by the Battery keystone. */
  manaFraction: number;
  /** Talent behaviours currently held. */
  talentBehaviors: string[];  // Will be TalentBehavior[] once talentTree.ts is updated in Step 5
}

/** A context with every contributor empty — the baseline tower. */
export function emptyStatContext(): StatContext {
  return {
    wave: 1,
    core: DEFAULT_CORE,
    hpFraction: 1,
    upgrades: {},
    evolutions: {},
    prestige: {
      lifetimeDamage: 0,
      lifetimeGold: 0,
      apDamage: 0,
      apGold: 0,
      apFireRate: 1,
      apPierce: 0,
      apUpgradeDiscount: 0,
      apXpGain: 1,
      apRpDrop: 0,
      apReviveCharges: 0,
      tpDamage: 1,
      tpFireRate: 1,
      tpManaRegen: 1,
      tpResource: 1,
      tpCritDamage: 0,
      tpPierce: 0,
      orbGoldMultiplier: 1,
      abilityManaCostReduction: 0,
      abilityCdr: 0,
      treasureChance: 0,
      waveSkipChance: 0,
      hasExecuteDamage: false,
      executeDamageMultiplier: 0,
    },
    research: {
      goldMultiplicative: 1,
      manaRegenMultiplicative: 1,
      abilityCostReduction: 0,
      abilityPowerBonus: 0,
      abilityAreaBonus: 0,
      pierceCount: 0,
      goldLuckChance: 0,
      intermissionSpeedReduction: 0,
      enemyHpReduction: 0,
      rpDropChanceBonus: 0,
    },
    achievements: {},
    talents: {},
    passives: {},
    equipment: {},
    blessings: { stats: {}, behaviors: [] },
    waveModifier: null,
    pacing: { risk: 0, momentum: 0, comboTier: 0 },
    buffs: [],
    manaFraction: 1,
    talentBehaviors: [],
  };
}
