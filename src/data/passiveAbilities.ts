import type { PassiveAbilityId } from '../types';

export interface PassiveAbilityDef {
  id: PassiveAbilityId;
  name: string;
  description: string;
  /** Effect stat type (matched in applyUpgradeEffects) */
  stat: string;
  /** Base effect value at level 0 (percent) */
  basePercent: number;
  /** Additional percent per level */
  perLevelPercent: number;
  /** Maximum level */
  maxLevel: number;
  /** XP earned per kill when this is unlocked */
  xpPerKill: number;
  /** XP earned per wave clear when this is unlocked */
  xpPerWave: number;
  /** Minimum wave to unlock */
  unlockWave: number;
  /** Gold cost to unlock after wave is passed */
  unlockGoldCost: number;
  /** Base cost for gold-based upgrade (used with upgradeCostGrowth) */
  upgradeBaseCost: number;
  /** Cost growth factor per level (used with upgradeBaseCost) */
  upgradeCostGrowth: number;
  glyph: string;
  color: string;
}

export const PASSIVE_ABILITIES: PassiveAbilityDef[] = [
  {
    id: 'passive_markmanship',
    name: 'Marksmanship',
    description: 'Increases tower damage by {value}%.',
    stat: 'damage_pct',
    basePercent: 2,
    perLevelPercent: 2,
    maxLevel: 50,
    xpPerKill: 1,
    xpPerWave: 5,
    unlockWave: 10,
    unlockGoldCost: 50,
    upgradeBaseCost: 100,
    upgradeCostGrowth: 1.5,
    glyph: '🎯',
    color: '#e74c3c',
  },
  {
    id: 'passive_fortitude',
    name: 'Fortitude',
    description: 'Increases max HP by {value}%.',
    stat: 'max_hp_pct',
    basePercent: 3,
    perLevelPercent: 2,
    maxLevel: 50,
    xpPerKill: 1,
    xpPerWave: 5,
    unlockWave: 20,
    unlockGoldCost: 200,
    upgradeBaseCost: 150,
    upgradeCostGrowth: 1.6,
    glyph: '❤',
    color: '#2ecc71',
  },
  {
    id: 'passive_scavenger',
    name: 'Scavenger',
    description: 'Increases gold earned by {value}%.',
    stat: 'gold_mult_pct',
    basePercent: 3,
    perLevelPercent: 2,
    maxLevel: 50,
    xpPerKill: 1,
    xpPerWave: 5,
    unlockWave: 25,
    unlockGoldCost: 500,
    upgradeBaseCost: 200,
    upgradeCostGrowth: 1.65,
    glyph: '💰',
    color: '#f1c40f',
  },
  {
    id: 'passive_haste',
    name: 'Haste',
    description: 'Increases fire rate by {value}%.',
    stat: 'fire_rate_pct',
    basePercent: 2,
    perLevelPercent: 1.5,
    maxLevel: 50,
    xpPerKill: 1,
    xpPerWave: 3,
    unlockWave: 30,
    unlockGoldCost: 2500,
    upgradeBaseCost: 400,
    upgradeCostGrowth: 1.85,
    glyph: '⚡',
    color: '#3498db',
  },
  {
    id: 'passive_mana_spring',
    name: 'Mana Spring',
    description: 'Increases mana regen by {value}%.',
    stat: 'mana_regen_pct',
    basePercent: 3,
    perLevelPercent: 2,
    maxLevel: 50,
    xpPerKill: 1,
    xpPerWave: 3,
    unlockWave: 35,
    unlockGoldCost: 750,
    upgradeBaseCost: 250,
    upgradeCostGrowth: 1.7,
    glyph: '💠',
    color: '#5b8def',
  },
  {
    id: 'passive_thorns_aura',
    name: 'Thorns Aura',
    description: 'Reflects {value}% damage back to attackers.',
    stat: 'thorns_pct',
    basePercent: 3,
    perLevelPercent: 2.5,
    maxLevel: 30,
    xpPerKill: 1,
    xpPerWave: 3,
    unlockWave: 45,
    unlockGoldCost: 1500,
    upgradeBaseCost: 350,
    upgradeCostGrowth: 1.8,
    glyph: '⚔',
    color: '#e67e22',
  },
  {
    id: 'passive_precision',
    name: 'Precision',
    description: 'Increases crit chance by {value}%.',
    stat: 'crit_chance_pct',
    basePercent: 1,
    perLevelPercent: 0.5,
    maxLevel: 30,
    xpPerKill: 1,
    xpPerWave: 4,
    unlockWave: 50,
    unlockGoldCost: 1000,
    upgradeBaseCost: 300,
    upgradeCostGrowth: 1.75,
    glyph: '◎',
    color: '#f39c12',
  },
  {
    id: 'passive_life_steal',
    name: 'Life Steal',
    description: 'Heals for {value}% of damage dealt.',
    stat: 'lifesteal_pct',
    basePercent: 1,
    perLevelPercent: 1,
    maxLevel: 30,
    xpPerKill: 1,
    xpPerWave: 2,
    unlockWave: 65,
    unlockGoldCost: 4000,
    upgradeBaseCost: 500,
    upgradeCostGrowth: 1.9,
    glyph: '💉',
    color: '#c44a4a',
  },
];

export const PASSIVE_BY_ID: Record<string, PassiveAbilityDef> = PASSIVE_ABILITIES.reduce(
  (acc, a) => { acc[a.id] = a; return acc; },
  {} as Record<string, PassiveAbilityDef>,
);

/** Returns the effective percentage value for a passive at a given level. */
export function passiveEffectValue(def: PassiveAbilityDef, level: number): number {
  return def.basePercent + def.perLevelPercent * level;
}

/** Gold cost to upgrade a passive from its current level to the next. */
export function passiveUpgradeCost(def: PassiveAbilityDef, level: number): number {
  if (level < 0) return def.upgradeBaseCost;
  return Math.floor(def.upgradeBaseCost * Math.pow(def.upgradeCostGrowth, level));
}
