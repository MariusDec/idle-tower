import type { AbilityId } from '../types';
import type { IconId } from './icons';
import { world } from './arena';

export type AbilityEffectType =
  | 'aoe_damage'
  | 'slow'
  | 'fire_rate_buff'
  | 'gold_buff'
  | 'single_target_damage'
  | 'chain_damage'
  | 'crit_buff'
  | 'lifesteal_buff'
  | 'execute_damage'
  | 'rocket_barrage';

export interface AbilityDef {
  id: AbilityId;
  name: string;
  description: string;
  manaCost: number;
  cooldown: number;
  duration: number;
  effectType: AbilityEffectType;
  effectValue: number;
  icon: IconId;
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
  /** Base projectile count for abilities that fire a volley. */
  effectCount?: number;
  /** Extra projectiles per level above 1. */
  effectCountPerLevel?: number;
  /** Extra seconds added to duration per level above 1. */
  durationPerLevel: number;
  /** XP earned per cast of this ability. */
  xpPerCast: number;
}

/**
 * Plan §3.1.
 *
 * Two changes to the shape of this table:
 *
 * - **Unlock waves are front-loaded.** Berserk (was 30) and Gold Rush (was 45)
 *   sat past the point where a first run stalls, so a new player never saw
 *   half the ability roster. They now land at 14 and 26, giving the opening
 *   ladder 10 / 14 / 18 / 22 / 26 / 28 and putting seven of the ten abilities
 *   inside a first run. Their upgrade base costs were rebased onto the
 *   `400 * 1.135^(unlockWave - 10)` trend the rest of the table follows, so an
 *   earlier unlock is not an unaffordable one.
 * - **Upgrade cost growth is ~1.8, was 2.55-3.15.** Ability upgrades compete
 *   with tower upgrades for the same gold but scaled far faster: Rain of
 *   Arrows level 10 cost `400 * 3^9` = 7.9M, which no run could ever pay. At
 *   1.8 the same level costs `400 * 1.8^9` = 79K — expensive, but reachable,
 *   which is what makes the ability XP track (which discounts this cost and
 *   levels the ability on its own) worth engaging with.
 * - **Top-end base costs are capped for per-run affordability.** Once ability
 *   levels became ascension-scoped — re-bought with gold every run instead of
 *   carried across ascensions — Execute (`69600 → 20000`) and Vampiric Aura
 *   (`107000 → 25000`) sat out of a mid-run budget's reach, so their bases
 *   were lowered while keeping the shared 1.85 growth factor.
 */
export const ABILITIES: AbilityDef[] = [
  {
    id: 'rain_of_arrows',
    name: 'Rain of Arrows',
    description: 'Strikes all enemies for {dmg}x tower damage.',
    manaCost: 30,
    cooldown: 15,
    duration: 0,
    effectType: 'aoe_damage',
    effectValue: 4.2,
    icon: 'arrow-cluster',
    color: '#f1c40f',
    hotkey: '1',
    unlockWave: 10,
    maxLevel: 10,
    upgradeBaseCost: 400,
    upgradeCostGrowth: 1.75,
    manaCostPerLevel: 5,
    cooldownReductionPerLevel: 0.5,
    effectValuePerLevel: 0.85,
    durationPerLevel: 0,
    xpPerCast: 5,
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
    icon: 'frozen-orb',
    color: '#5b8def',
    hotkey: '2',
    unlockWave: 18,
    maxLevel: 10,
    upgradeBaseCost: 1300,
    upgradeCostGrowth: 1.8,
    manaCostPerLevel: 4,
    cooldownReductionPerLevel: 0.8,
    effectValuePerLevel: -0.02,
    durationPerLevel: 0.5,
    xpPerCast: 5,
  },
  {
    id: 'chain_lightning',
    name: 'Chain Lightning',
    description: 'Strikes the nearest enemy for {dmg}x tower damage and arcs to nearby targets.',
    manaCost: 40,
    cooldown: 18,
    duration: 0,
    effectType: 'chain_damage',
    effectValue: 2.5,
    icon: 'chain-lightning',
    color: '#9aa7ff',
    hotkey: '3',
    unlockWave: 22,
    maxLevel: 10,
    upgradeBaseCost: 1400,
    upgradeCostGrowth: 1.8,
    manaCostPerLevel: 4,
    cooldownReductionPerLevel: 0.5,
    effectValuePerLevel: 0.25,
    durationPerLevel: 0,
    xpPerCast: 6,
  },
  {
    id: 'precision_shot',
    name: 'Precision Shot',
    description: 'Boosts crit chance by {dmg}% and multiplies crit damage by {crit}x for {dur}s.',
    manaCost: 35,
    cooldown: 22,
    duration: 6,
    effectType: 'crit_buff',
    effectValue: 30,
    icon: 'arrow-scope',
    color: '#ffd34a',
    hotkey: '4',
    unlockWave: 28,
    maxLevel: 10,
    upgradeBaseCost: 3450,
    upgradeCostGrowth: 1.8,
    manaCostPerLevel: 4,
    cooldownReductionPerLevel: 0.6,
    effectValuePerLevel: 2,
    durationPerLevel: 0.4,
    xpPerCast: 5,
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
    icon: 'enrage',
    color: '#d04848',
    hotkey: '5',
    unlockWave: 14,
    maxLevel: 10,
    upgradeBaseCost: 900,
    upgradeCostGrowth: 1.85,
    manaCostPerLevel: 6,
    cooldownReductionPerLevel: 1.0,
    effectValuePerLevel: 0.15,
    durationPerLevel: 0.5,
    xpPerCast: 6,
  },
  {
    id: 'meteor_strike',
    name: 'Meteor Strike',
    description: 'Smashes the highest-HP enemy for {dmg}x damage. Splash to nearby enemies.',
    manaCost: 60,
    cooldown: 25,
    duration: 0,
    effectType: 'single_target_damage',
    effectValue: 10,
    icon: 'burning-meteor',
    color: '#ff7a1a',
    hotkey: '6',
    unlockWave: 40,
    maxLevel: 10,
    upgradeBaseCost: 19600,
    upgradeCostGrowth: 1.85,
    manaCostPerLevel: 6,
    cooldownReductionPerLevel: 0.5,
    effectValuePerLevel: 1.25,
    durationPerLevel: 0,
    xpPerCast: 8,
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
    icon: 'coins-pile',
    color: '#f1c40f',
    hotkey: '7',
    unlockWave: 26,
    maxLevel: 10,
    upgradeBaseCost: 3400,
    upgradeCostGrowth: 1.8,
    manaCostPerLevel: 8,
    cooldownReductionPerLevel: 1.5,
    effectValuePerLevel: 0.25,
    durationPerLevel: 1.0,
    xpPerCast: 10,
  },
  {
    id: 'execute',
    name: 'Execute',
    description: 'Kills non-boss enemies below {dmg}% HP. Bosses below {boss}% HP take 4.2x damage.',
    manaCost: 50,
    cooldown: 30,
    duration: 0,
    effectType: 'execute_damage',
    effectValue: 12,
    icon: 'guillotine',
    color: '#a020f0',
    hotkey: '8',
    unlockWave: 50,
    maxLevel: 10,
    upgradeBaseCost: 20000,
    upgradeCostGrowth: 1.85,
    manaCostPerLevel: 6,
    cooldownReductionPerLevel: 0.8,
    effectValuePerLevel: 2,
    durationPerLevel: 0,
    xpPerCast: 7,
  },
  {
    id: 'rocket_barrage',
    name: 'Rocket Barrage',
    description: 'Fires {count} homing rockets at nearby enemies. Each deals {dmg}x tower damage and explodes.',
    manaCost: 45,
    cooldown: 20,
    duration: 0,
    effectType: 'rocket_barrage',
    effectValue: 1.65,
    icon: 'split-arrows',
    color: '#ff6b35',
    hotkey: '0',
    unlockWave: 35,
    maxLevel: 15,
    upgradeBaseCost: 12000,
    upgradeCostGrowth: 1.85,
    manaCostPerLevel: 3,
    cooldownReductionPerLevel: 0.3,
    effectValuePerLevel: 0.21,
    effectCount: 6,
    effectCountPerLevel: 0.3,
    durationPerLevel: 0,
    xpPerCast: 6,
  },
  {
    id: 'vampiric_aura',
    name: 'Vampiric Aura',
    description: 'Gain +{ls}% lifesteal and regenerate {rg}% max HP per second for {dur}s.',
    manaCost: 45,
    cooldown: 35,
    duration: 8,
    effectType: 'lifesteal_buff',
    effectValue: 0.06,
    icon: 'fangs-circle',
    color: '#c44a4a',
    hotkey: '9',
    unlockWave: 55,
    maxLevel: 10,
    upgradeBaseCost: 25000,
    upgradeCostGrowth: 1.85,
    manaCostPerLevel: 5,
    cooldownReductionPerLevel: 1.0,
    effectValuePerLevel: 0.02,
    durationPerLevel: 0.4,
    xpPerCast: 7,
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
  /** Effective projectile count, for volley abilities (Rocket Barrage). */
  count?: number;
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

function stripTrailingZero(n: number, digits: number = 2): string {
  if (!Number.isFinite(n)) return '0';
  if (digits == 0) return Math.floor(n).toString();
  const s = n.toFixed(digits).replace(/\.?0+$/, '');
  return s === '' || s === '-' ? '0' : s;
}

/**
 * Level-scaled halves of the two buff abilities whose tooltips must quote what
 * they actually grant (ability revamp phase 4).
 *
 * - Precision Shot's crit multiplier used to sit at a flat 1.5x at every
 *   level while the upgrade pitch implied per-level growth; the curve is now
 *   real (+10% crit damage per level above 1).
 * - Vampiric Aura's regen grows alongside its lifesteal so the aura stays
 *   self-sufficient sustain rather than a multiplier on a stat most builds
 *   never invest in.
 *
 * Both live next to the table they describe because `buildAbilityDisplayText`
 * needs them for the {crit}/{rg} tokens, and `AbilityManager` applies exactly
 * these numbers — one source, no doc/code drift.
 */
/** Vampiric Aura's base regen, as a fraction of maxHP per second. */
export const VAMPIRIC_REGEN = 0.01;
/** Extra regen fraction per level above 1. */
export const VAMPIRIC_REGEN_PER_LEVEL = 0.005;

export function vampiricRegen(level: number): number {
  return VAMPIRIC_REGEN + VAMPIRIC_REGEN_PER_LEVEL * (Math.max(1, level) - 1);
}

/** Crit multiplier at level 1. */
export const CRIT_BUFF_DAMAGE_MULTIPLIER = 1.5;
/** Extra crit multiplier per level above 1. */
export const CRIT_BUFF_DAMAGE_PER_LEVEL = 0.1;

export function precisionCritMultiplier(level: number): number {
  return CRIT_BUFF_DAMAGE_MULTIPLIER + CRIT_BUFF_DAMAGE_PER_LEVEL * (Math.max(1, level) - 1);
}

/** Build a level-aware description string from the static template. */
export function buildAbilityDisplayText(def: AbilityDef, level: number): string {
  const clampedLevel = Math.max(1, Math.min(def.maxLevel, level));
  const lvlOffset = clampedLevel - 1;
  const effectValue = def.effectValue + def.effectValuePerLevel * lvlOffset;
  const duration = def.duration + def.durationPerLevel * lvlOffset;
  const count = def.effectCount !== undefined
    ? def.effectCount + (def.effectCountPerLevel ?? 0) * lvlOffset
    : undefined;
  return def.description
    .replace('{count}', count !== undefined ? String(Math.floor(count)) : '0')
    .replace('{dmg}', stripTrailingZero(effectValue))
    .replace('{slow}', String(Math.round((1 - effectValue) * 100)))
    .replace('{dur}', stripTrailingZero(duration))
    // Lifesteal and regen are stored as fractions; the text quotes percent.
    .replace('{ls}', stripTrailingZero(effectValue * 100))
    .replace('{rg}', stripTrailingZero(vampiricRegen(clampedLevel) * 100))
    .replace('{crit}', stripTrailingZero(precisionCritMultiplier(clampedLevel)))
    .replace('{boss}', String(Math.floor(effectValue / 2)));
}

export function computeEffectiveStats(def: AbilityDef, level: number): EffectiveAbilityStats {
  const clampedLevel = Math.max(1, Math.min(def.maxLevel, level));
  const lvlOffset = clampedLevel - 1;
  const manaCost = def.manaCost + def.manaCostPerLevel * lvlOffset;
  const cooldown = Math.max(1, def.cooldown - def.cooldownReductionPerLevel * lvlOffset);
  const duration = def.duration + def.durationPerLevel * lvlOffset;
  const effectValue = def.effectValue + def.effectValuePerLevel * lvlOffset;
  const count = def.effectCount !== undefined
    ? def.effectCount + (def.effectCountPerLevel ?? 0) * lvlOffset
    : undefined;

  return {
    level: clampedLevel,
    manaCost,
    cooldown,
    duration,
    effectValue,
    ...(count !== undefined ? { count } : {}),
    displayEffectValue: formatEffectForDisplay(def.effectType, effectValue, count),
    displayDuration: formatDurationForDisplay(duration),
    displayText: buildAbilityDisplayText(def, clampedLevel),
    upgradeCost: 0,
    isMaxed: clampedLevel >= def.maxLevel,
    isUnlocked: true,
  };
}

function formatEffectForDisplay(type: AbilityEffectType, value: number, count?: number): string {
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
      // Additive lifesteal reads as "+N%", not "Nx" of a base that may be zero.
      return `+${stripTrailingZero(value * 100)}%`;
    case 'execute_damage':
      return `${stripTrailingZero(value)}%`;
    case 'rocket_barrage':
      // Rockets and per-rocket damage are the two numbers a player tunes, so
      // the tooltip reads them together rather than hiding one behind "2x".
      return `${Math.floor(count ?? 0)} @ ${stripTrailingZero(value)}x`;
  }
}

function formatDurationForDisplay(seconds: number): string {
  if (seconds <= 0) return '0s';
  return `${stripTrailingZero(seconds)}s`;
}

/**
 * Abilities that can be *placed* (gameplay plan §4.3).
 *
 * `radius` is the focus disc drawn at the cursor and the disc the extra effect
 * lands in. It is also the radius the auto-placer scores clusters with, so the
 * automatic fallback and the manual verb are aiming at the same shape.
 */
export const METEOR_SPLASH_RADIUS = world(60);

export const PLACEABLE_ABILITIES: Partial<Record<AbilityId, { radius: number }>> = {
  rain_of_arrows: { radius: world(130) },
  frost_nova: { radius: world(150) },
  // Deliberately the *existing* splash radius, not the 90 px §4.2 uses for the
  // charged shot: a placed Meteor Strike must be today's Meteor Strike with a
  // player-chosen epicentre, not a quietly wider one.
  meteor_strike: { radius: METEOR_SPLASH_RADIUS },
};

export function isPlaceable(id: AbilityId): boolean {
  return PLACEABLE_ABILITIES[id] !== undefined;
}

export function placementRadius(id: AbilityId): number {
  return PLACEABLE_ABILITIES[id]?.radius ?? 0;
}

/**
 * What landing the disc on a good cluster is worth (plan §4.3: "roughly +30%
 * on those three abilities").
 *
 * Rain of Arrows and Frost Nova are *global* effects today, so a targeted cast
 * cannot be modelled as "only hits the disc" without being a flat nerf and a
 * regression for every existing player. Instead the global effect is unchanged
 * and the disc gets a bonus on top: extra damage for Rain of Arrows, a deeper
 * and longer chill for Frost Nova. Meteor Strike genuinely relocates — its
 * epicentre becomes the placed point.
 */
export const PLACEMENT_FOCUS_DAMAGE_BONUS = 0.6;
/** Extra speed removed inside a placed Frost Nova, and its duration scale. */
export const PLACEMENT_FOCUS_CHILL = 0.25;
export const PLACEMENT_FOCUS_CHILL_DURATION = 1.5;
