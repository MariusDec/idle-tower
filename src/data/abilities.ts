import type { AbilityId } from '../types';

export type AbilityEffectType =
  | 'aoe_damage'
  | 'slow'
  | 'fire_rate_buff'
  | 'gold_buff'
  | 'single_target_damage'
  | 'chain_damage'
  | 'crit_buff'
  | 'lifesteal_buff'
  | 'execute_damage';

export interface AbilityDef {
  id: AbilityId;
  name: string;
  description: string;
  manaCost: number;
  cooldown: number;
  duration: number;
  effectType: AbilityEffectType;
  effectValue: number;
  glyph: string;
  color: string;
  hotkey: string;
  /** Wave at which this ability becomes usable. Mana system itself unlocks at wave 10. */
  unlockWave: number;
  /** Maximum upgrade level. 1 = base (no upgrades). */
  maxLevel: number;
  /** Base gold cost of the first upgrade (level 1 -> 2). */
  upgradeBaseCost: number;
  /** Cost multiplier per upgrade level. */
  upgradeCostGrowth: number;
  /** Extra mana cost added per level above 1. */
  manaCostPerLevel: number;
  /** Seconds shaved off the cooldown per level above 1. */
  cooldownReductionPerLevel: number;
  /** Delta applied to effectValue per level above 1. */
  effectValuePerLevel: number;
  /** Extra seconds added to duration per level above 1. */
  durationPerLevel: number;
}

export const ABILITIES: AbilityDef[] = [
  {
    id: 'rain_of_arrows',
    name: 'Rain of Arrows',
    description: 'Strikes all enemies for {dmg}x tower damage.',
    manaCost: 30,
    cooldown: 15,
    duration: 0,
    effectType: 'aoe_damage',
    effectValue: 5,
    glyph: 'R',
    color: '#f1c40f',
    hotkey: '1',
    unlockWave: 10,
    maxLevel: 10,
    upgradeBaseCost: 200,
    upgradeCostGrowth: 1.6,
    manaCostPerLevel: 5,
    cooldownReductionPerLevel: 0.5,
    effectValuePerLevel: 1.0,
    durationPerLevel: 0,
  },
  {
    id: 'frost_nova',
    name: 'Frost Nova',
    description: 'Slows all enemies by {slow}% for {dur}s.',
    manaCost: 25,
    cooldown: 20,
    duration: 5,
    effectType: 'slow',
    effectValue: 0.5,
    glyph: 'F',
    color: '#5b8def',
    hotkey: '2',
    unlockWave: 18,
    maxLevel: 10,
    upgradeBaseCost: 300,
    upgradeCostGrowth: 1.55,
    manaCostPerLevel: 4,
    cooldownReductionPerLevel: 0.8,
    effectValuePerLevel: -0.02,
    durationPerLevel: 0.5,
  },
  {
    id: 'chain_lightning',
    name: 'Chain Lightning',
    description: 'Strikes the nearest enemy for {dmg}x tower damage and arcs to nearby targets.',
    manaCost: 40,
    cooldown: 18,
    duration: 0,
    effectType: 'chain_damage',
    effectValue: 3,
    glyph: 'L',
    color: '#9aa7ff',
    hotkey: '7',
    unlockWave: 22,
    maxLevel: 10,
    upgradeBaseCost: 400,
    upgradeCostGrowth: 1.5,
    manaCostPerLevel: 4,
    cooldownReductionPerLevel: 0.5,
    effectValuePerLevel: 0.3,
    durationPerLevel: 0,
  },
  {
    id: 'precision_shot',
    name: 'Precision Shot',
    description: 'Boosts crit chance by {dmg}% for {dur}s.',
    manaCost: 35,
    cooldown: 22,
    duration: 6,
    effectType: 'crit_buff',
    effectValue: 30,
    glyph: 'P',
    color: '#ffd34a',
    hotkey: '6',
    unlockWave: 28,
    maxLevel: 10,
    upgradeBaseCost: 450,
    upgradeCostGrowth: 1.5,
    manaCostPerLevel: 4,
    cooldownReductionPerLevel: 0.6,
    effectValuePerLevel: 2,
    durationPerLevel: 0.4,
  },
  {
    id: 'berserk',
    name: 'Berserk',
    description: 'Multiplies tower fire rate by {dmg}x for {dur}s.',
    manaCost: 40,
    cooldown: 30,
    duration: 8,
    effectType: 'fire_rate_buff',
    effectValue: 2,
    glyph: 'B',
    color: '#d04848',
    hotkey: '3',
    unlockWave: 30,
    maxLevel: 10,
    upgradeBaseCost: 500,
    upgradeCostGrowth: 1.5,
    manaCostPerLevel: 6,
    cooldownReductionPerLevel: 1.0,
    effectValuePerLevel: 0.15,
    durationPerLevel: 0.5,
  },
  {
    id: 'meteor_strike',
    name: 'Meteor Strike',
    description: 'Smashes the highest-HP enemy for {dmg}x damage. Splash to nearby enemies.',
    manaCost: 60,
    cooldown: 25,
    duration: 0,
    effectType: 'single_target_damage',
    effectValue: 12,
    glyph: 'M',
    color: '#ff7a1a',
    hotkey: '5',
    unlockWave: 40,
    maxLevel: 10,
    upgradeBaseCost: 600,
    upgradeCostGrowth: 1.55,
    manaCostPerLevel: 6,
    cooldownReductionPerLevel: 0.5,
    effectValuePerLevel: 1.5,
    durationPerLevel: 0,
  },
  {
    id: 'gold_rush',
    name: 'Gold Rush',
    description: 'Multiplies gold drops by {dmg}x for {dur}s.',
    manaCost: 50,
    cooldown: 60,
    duration: 15,
    effectType: 'gold_buff',
    effectValue: 3,
    glyph: 'G',
    color: '#f1c40f',
    hotkey: '4',
    unlockWave: 45,
    maxLevel: 10,
    upgradeBaseCost: 800,
    upgradeCostGrowth: 1.45,
    manaCostPerLevel: 8,
    cooldownReductionPerLevel: 1.5,
    effectValuePerLevel: 0.25,
    durationPerLevel: 1.0,
  },
  {
    id: 'execute',
    name: 'Execute',
    description: 'Kills non-boss enemies below {dmg}% HP. Heavy damage to wounded bosses.',
    manaCost: 50,
    cooldown: 30,
    duration: 0,
    effectType: 'execute_damage',
    effectValue: 12,
    glyph: 'E',
    color: '#a020f0',
    hotkey: '9',
    unlockWave: 50,
    maxLevel: 10,
    upgradeBaseCost: 600,
    upgradeCostGrowth: 1.5,
    manaCostPerLevel: 6,
    cooldownReductionPerLevel: 0.8,
    effectValuePerLevel: 2,
    durationPerLevel: 0,
  },
  {
    id: 'vampiric_aura',
    name: 'Vampiric Aura',
    description: 'Multiplies lifesteal by {dmg}x and adds HP regen for {dur}s.',
    manaCost: 45,
    cooldown: 35,
    duration: 8,
    effectType: 'lifesteal_buff',
    effectValue: 3,
    glyph: 'V',
    color: '#c44a4a',
    hotkey: '8',
    unlockWave: 55,
    maxLevel: 10,
    upgradeBaseCost: 700,
    upgradeCostGrowth: 1.5,
    manaCostPerLevel: 5,
    cooldownReductionPerLevel: 1.0,
    effectValuePerLevel: 0.5,
    durationPerLevel: 0.4,
  },
];

export const ABILITY_BY_ID: Record<AbilityId, AbilityDef> = ABILITIES.reduce(
  (acc, a) => {
    acc[a.id] = a;
    return acc;
  },
  {} as Record<AbilityId, AbilityDef>,
);

export interface EffectiveAbilityStats {
  level: number;
  manaCost: number;
  cooldown: number;
  duration: number;
  effectValue: number;
  /** Human-friendly effect value for display (e.g. slow % for Frost Nova). */
  displayEffectValue: string;
  /** Human-friendly duration in seconds. */
  displayDuration: string;
  /** Dynamic description text, e.g. "Strikes all enemies for 7x tower damage." */
  displayText: string;
  /** Per-level upgrade gold cost (cost of going from `level` to `level + 1`). */
  upgradeCost: number;
  /** True when level === maxLevel. */
  isMaxed: boolean;
  /** True when level is at or above unlockWave minimum. */
  isUnlocked: boolean;
}

function stripTrailingZero(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const s = n.toFixed(2).replace(/\.?0+$/, '');
  return s === '' || s === '-' ? '0' : s;
}

/** Build a level-aware description string from the static template. */
export function buildAbilityDisplayText(def: AbilityDef, level: number): string {
  const clampedLevel = Math.max(1, Math.min(def.maxLevel, level));
  const lvlOffset = clampedLevel - 1;
  const effectValue = def.effectValue + def.effectValuePerLevel * lvlOffset;
  const duration = def.duration + def.durationPerLevel * lvlOffset;
  return def.description
    .replace('{dmg}', stripTrailingZero(effectValue))
    .replace('{slow}', String(Math.round((1 - effectValue) * 100)))
    .replace('{dur}', stripTrailingZero(duration));
}

export function computeEffectiveStats(def: AbilityDef, level: number): EffectiveAbilityStats {
  const clampedLevel = Math.max(1, Math.min(def.maxLevel, level));
  const lvlOffset = clampedLevel - 1;
  const manaCost = def.manaCost + def.manaCostPerLevel * lvlOffset;
  const cooldown = Math.max(1, def.cooldown - def.cooldownReductionPerLevel * lvlOffset);
  const duration = def.duration + def.durationPerLevel * lvlOffset;
  const effectValue = def.effectValue + def.effectValuePerLevel * lvlOffset;

  return {
    level: clampedLevel,
    manaCost,
    cooldown,
    duration,
    effectValue,
    displayEffectValue: formatEffectForDisplay(def.effectType, effectValue),
    displayDuration: formatDurationForDisplay(duration),
    displayText: buildAbilityDisplayText(def, clampedLevel),
    upgradeCost: 0,
    isMaxed: clampedLevel >= def.maxLevel,
    isUnlocked: true,
  };
}

function formatEffectForDisplay(type: AbilityEffectType, value: number): string {
  switch (type) {
    case 'aoe_damage':
    case 'fire_rate_buff':
    case 'gold_buff':
    case 'single_target_damage':
    case 'chain_damage':
      return `${stripTrailingZero(value)}x`;
    case 'slow':
      return `${Math.round((1 - value) * 100)}%`;
    case 'crit_buff':
      return `+${stripTrailingZero(value)}%`;
    case 'lifesteal_buff':
      return `${stripTrailingZero(value)}x`;
    case 'execute_damage':
      return `${stripTrailingZero(value)}%`;
  }
}

function formatDurationForDisplay(seconds: number): string {
  if (seconds <= 0) return '0s';
  return `${stripTrailingZero(seconds)}s`;
}
