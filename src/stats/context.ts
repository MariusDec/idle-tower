import type { EquipmentStatType } from '../types';
import type { AchievementRewardType } from '../data/achievements';
import type { TalentStat } from '../data/talentTree';
import type { PassiveStat } from '../data/passiveAbilities';
import type { EvolutionEffectId } from '../data/upgrades';
import type { BlessingBehavior, BlessingStat } from '../data/blessings';
import type { BuffEntry } from './BuffRegistry';

/** Prestige contributions, read once per recompute from `PrestigeManager`. */
export interface PrestigeInputs {
  /** Lifetime-AP passive bonus (diminishing), as fractions. */
  lifetimeDamage: number;
  lifetimeGold: number;
  /** Bonuses from AP actually spent on perks, as fractions. */
  apDamage: number;
  apGold: number;
  /** Transcendence multipliers (already `1 + x` shaped). */
  tpDamage: number;
  tpFireRate: number;
  tpManaRegen: number;
  tpResource: number;
  /** Additive transcendence bonuses. */
  tpCritDamage: number;
  tpPierce: number;
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
  /** Timed buffs currently in effect (abilities, quick shot, manual aim). */
  buffs: readonly BuffEntry[];
}

/** A context with every contributor empty — the baseline tower. */
export function emptyStatContext(): StatContext {
  return {
    wave: 1,
    hpFraction: 1,
    upgrades: {},
    evolutions: {},
    prestige: {
      lifetimeDamage: 0,
      lifetimeGold: 0,
      apDamage: 0,
      apGold: 0,
      tpDamage: 1,
      tpFireRate: 1,
      tpManaRegen: 1,
      tpResource: 1,
      tpCritDamage: 0,
      tpPierce: 0,
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
    buffs: [],
  };
}
