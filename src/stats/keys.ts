import { TOWER_BASE } from '../data/tower';

/**
 * Every stat the pipeline resolves.
 *
 * This union is closed on purpose: `resolveStats` builds a
 * `Record<StatKey, number>`, so adding a key without giving it a base is a
 * compile error, and a contributor that writes a key nobody reads shows up as
 * an unused entry in `applyResolvedStats`. Before this existed, eight systems
 * wrote into `TowerState` directly with `=` and the last writer won — which is
 * what silently disabled twenty talents and every gold multiplier (plan §1).
 */
export type StatKey =
  // ── tower: offense ──
  | 'baseDamage'
  | 'fireRate'
  | 'range'
  | 'critChance'
  | 'critMultiplier'
  // ── tower: defense ──
  | 'maxHp'
  | 'healthRegen'
  | 'defense'
  | 'armor'
  | 'knockbackForce'
  | 'lifesteal'
  | 'thorns'
  | 'dodgeChance'
  | 'manaShieldFraction'
  | 'shieldMaxCharges'
  | 'shieldRechargeTime'
  | 'wallFraction'
  | 'wallRegen'
  // ── tower: kit ──
  | 'shockwaveSize'
  | 'shockwaveCooldown'
  | 'landMineDamage'
  | 'landMineFrequency'
  | 'doubleShotChance'
  | 'quickShotChance'
  | 'quickShotTime'
  | 'extraProjectileChance'
  | 'magicProcChance'
  // ── resources ──
  | 'manaRegen'
  | 'maxMana'
  // ── economy ──
  | 'goldAdditive'
  | 'goldMultiplier'
  | 'goldOnKill'
  | 'critGold'
  | 'waveGold'
  | 'goldLuckChance'
  | 'doubleGoldChance'
  | 'upgradeCostDiscount'
  | 'equipmentFindChance'
  | 'xpGainMultiplier'
  // ── abilities ──
  | 'abilityCostMultiplier'
  | 'abilityCooldownMultiplier'
  | 'abilityDamageMultiplier'
  | 'berserkFireBonus'
  | 'chainBounceBonus'
  | 'slowStrengthBonus'
  | 'meteorDamageBonus'
  | 'buffDurationBonus'
  // ── projectiles ──
  | 'armorPen'
  | 'pierceExtra'
  | 'executeThreshold'
  | 'executeMultiplier'
  | 'talentExecuteBonus'
  | 'instantKillChance'
  | 'critSplash'
  | 'critIgnoreArmor'
  // ── wave & meta ──
  | 'waveSkipChance'
  | 'intermissionMultiplier'
  | 'enemyHpReduction'
  | 'rpDropChanceBonus'
  | 'autoBuyIntervalReduction'
  | 'headStartWaves'
  | 'wallContactExtra';

/**
 * Which system a contribution came from. Carried through to `Breakdown` so the
 * Stats panel can attribute a number, and so a bug like "gold shows x12 but
 * applies x3" cannot survive a glance at the tooltip.
 */
export type StatSource =
  | 'base'
  | 'upgrade'
  | 'evolution'
  | 'prestige'
  | 'research'
  | 'achievement'
  | 'talent'
  | 'passive'
  | 'equipment'
  | 'waveModifier'
  | 'buff'
  | 'derived';

/**
 * Seed value for each key's additive bucket. Anything not listed starts at 0;
 * multiplier-shaped keys start at 1 so an empty multiplicative bucket is a
 * no-op.
 */
export const STAT_BASES: Record<StatKey, number> = {
  baseDamage: TOWER_BASE.baseDamage,
  fireRate: TOWER_BASE.fireRate,
  range: TOWER_BASE.range,
  critChance: TOWER_BASE.critChance,
  critMultiplier: TOWER_BASE.critMultiplier,

  maxHp: TOWER_BASE.maxHp,
  healthRegen: 0,
  defense: 0,
  armor: 0,
  knockbackForce: 0,
  lifesteal: 0,
  thorns: 0,
  dodgeChance: 0,
  manaShieldFraction: 0,
  shieldMaxCharges: 0,
  shieldRechargeTime: 0,
  wallFraction: 0,
  wallRegen: 0,

  shockwaveSize: 0,
  shockwaveCooldown: 0,
  landMineDamage: 0,
  landMineFrequency: 0,
  doubleShotChance: 0,
  quickShotChance: 0,
  quickShotTime: 0,
  extraProjectileChance: 0,
  magicProcChance: 0,

  manaRegen: 1,
  maxMana: 100,

  goldAdditive: 0,
  goldMultiplier: 1,
  goldOnKill: 0,
  critGold: 0,
  waveGold: 0,
  goldLuckChance: 0,
  doubleGoldChance: 0,
  upgradeCostDiscount: 0,
  equipmentFindChance: 0,
  xpGainMultiplier: 1,

  abilityCostMultiplier: 1,
  abilityCooldownMultiplier: 1,
  abilityDamageMultiplier: 1,
  berserkFireBonus: 0,
  chainBounceBonus: 0,
  slowStrengthBonus: 0,
  meteorDamageBonus: 0,
  buffDurationBonus: 0,

  armorPen: 0,
  pierceExtra: 0,
  executeThreshold: 0,
  executeMultiplier: 0,
  talentExecuteBonus: 0,
  instantKillChance: 0,
  critSplash: 0,
  critIgnoreArmor: 0,

  waveSkipChance: 0,
  intermissionMultiplier: 1,
  enemyHpReduction: 0,
  rpDropChanceBonus: 0,
  autoBuyIntervalReduction: 0,
  headStartWaves: 0,
  wallContactExtra: 0,
};

export const STAT_KEYS = Object.keys(STAT_BASES) as StatKey[];

interface StatClamp {
  min?: number;
  max?: number;
  /** Round the resolved value down to an integer (charges, bounces, waves). */
  integer?: boolean;
}

/**
 * Applied once, after both buckets have been folded — never mid-composition.
 * Clamping between contributors is what made the old code order-dependent.
 */
export const STAT_CLAMPS: Partial<Record<StatKey, StatClamp>> = {
  baseDamage: { min: 1 },
  fireRate: { min: 0.01 },
  range: { min: 1 },
  critChance: { min: 0, max: 1 },
  critMultiplier: { min: 1 },
  // No floor on maxHp: zero is the legitimate "not initialised yet" value that
  // `applyResolvedStats` keys its first HP fill on.
  healthRegen: { min: 0 },
  defense: { min: 0 },
  armor: { min: 0 },
  lifesteal: { min: 0 },
  thorns: { min: 0 },
  dodgeChance: { min: 0, max: 0.75 },
  manaShieldFraction: { min: 0, max: 0.9 },
  shieldMaxCharges: { min: 0, integer: true },
  maxMana: { min: 1 },
  manaRegen: { min: 0 },
  magicProcChance: { min: 0, max: 1 },
  extraProjectileChance: { min: 0, max: 1 },
  doubleGoldChance: { min: 0, max: 1 },
  goldMultiplier: { min: 0 },
  abilityCostMultiplier: { min: 0.1, max: 1 },
  abilityCooldownMultiplier: { min: 0.1, max: 1 },
  abilityDamageMultiplier: { min: 1 },
  chainBounceBonus: { min: 0, integer: true },
  pierceExtra: { min: 0, integer: true },
  headStartWaves: { min: 0, integer: true },
  enemyHpReduction: { min: 0, max: 0.9 },
  intermissionMultiplier: { min: 0.1, max: 1 },
  waveSkipChance: { min: 0, max: 1 },
};
