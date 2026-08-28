import type { AbilityId } from '../types';
import type { IconId } from './icons';
import { WORLD_SCALE, world } from './arena';

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

/**
 * When automation is allowed to spend mana on an ability.
 *
 * The mana budget cannot pay for the whole roster (plan §1.8), so automation
 * has to choose. A condition is a *floor*, never a preference: an ability with
 * no condition is always allowed.
 */
export interface AutoCastCondition {
  /** Minimum targetable enemies alive anywhere on the field. */
  minEnemies?: number;
  /** Minimum targetable enemies inside the ability's own disc at its best spot. */
  minInDisc?: number;
  /** Only cast while a boss is alive. */
  bossOnly?: boolean;
  /** Only cast while the lead boss's HP fraction is at or below this. */
  bossHpBelow?: number;
  /** Only cast while the tower's HP fraction is at or below this. */
  towerHpBelow?: number;
}

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
  /**
   * Effect disc, in world units, at level 1. Present iff the ability is
   * targeted. `world()`-scaled at definition time like every other radius.
   */
  areaRadius?: number;
  /** Extra radius (world units) per level above 1. */
  areaRadiusPerLevel?: number;
  /**
   * Automation gate (plan §C.1). When set, automation only casts this ability
   * when the condition holds; a manual cast bypasses the gate entirely.
   * `undefined` means "always eligible" — the existing behaviour.
   */
  autoCast?: AutoCastCondition;
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
    description: 'Rains arrows on a {area} area for {dmg}x tower damage.',
    manaCost: 30,
    cooldown: 12,
    duration: 0,
    effectType: 'aoe_damage',
    effectValue: 6.5,
    icon: 'arrow-cluster',
    color: '#f1c40f',
    hotkey: '1',
    unlockWave: 10,
    maxLevel: 10,
    upgradeBaseCost: 400,
    upgradeCostGrowth: 1.75,
    manaCostPerLevel: 5,
    cooldownReductionPerLevel: 0.5,
    effectValuePerLevel: 1.15,
    durationPerLevel: 0,
    xpPerCast: 5,
    areaRadius: world(170),
    areaRadiusPerLevel: world(16),
    autoCast: { minInDisc: 3 },
  },
  {
    id: 'frost_nova',
    name: 'Frost Nova',
    description: 'Chills a {area} area by {slow}% for {dur}s. All enemies take +{brittle}% damage while it lasts.',
    manaCost: 25,
    cooldown: 18,
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
    areaRadius: world(190),
    areaRadiusPerLevel: world(14),
    autoCast: { minInDisc: 4 },
  },
  {
    id: 'chain_lightning',
    name: 'Chain Lightning',
    description: 'Strikes the nearest enemy for {dmg}x tower damage and arcs to nearby targets.',
    manaCost: 34,
    cooldown: 14,
    duration: 0,
    effectType: 'chain_damage',
    effectValue: 4.0,
    icon: 'chain-lightning',
    color: '#9aa7ff',
    hotkey: '3',
    unlockWave: 22,
    maxLevel: 10,
    upgradeBaseCost: 1400,
    upgradeCostGrowth: 1.8,
    manaCostPerLevel: 3,
    cooldownReductionPerLevel: 0.4,
    effectValuePerLevel: 0.45,
    durationPerLevel: 0,
    xpPerCast: 6,
    areaRadius: world(120),
    areaRadiusPerLevel: world(8),
    autoCast: { minEnemies: 2 },
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
    autoCast: { minEnemies: 3 },
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
    autoCast: { minEnemies: 4 },
  },
  {
    id: 'meteor_strike',
    name: 'Meteor Strike',
    description: 'Smashes the highest-HP enemy for {dmg}x damage. Splash to nearby enemies.',
    manaCost: 60,
    cooldown: 25,
    duration: 0,
    effectType: 'single_target_damage',
    effectValue: 18,
    icon: 'burning-meteor',
    color: '#ff7a1a',
    hotkey: '6',
    unlockWave: 40,
    maxLevel: 10,
    upgradeBaseCost: 19600,
    upgradeCostGrowth: 1.85,
    manaCostPerLevel: 6,
    cooldownReductionPerLevel: 0.5,
    effectValuePerLevel: 2.2,
    durationPerLevel: 0,
    xpPerCast: 8,
    areaRadius: world(70),
    areaRadiusPerLevel: world(9),
    autoCast: { minInDisc: 1 },
  },
  {
    id: 'gold_rush',
    name: 'Gold Rush',
    description: 'Multiplies gold drops by {dmg}x for {dur}s.',
    manaCost: 50,
    cooldown: 40,
    duration: 12,
    effectType: 'gold_buff',
    effectValue: 2.6,
    icon: 'coins-pile',
    color: '#f1c40f',
    hotkey: '7',
    unlockWave: 26,
    maxLevel: 10,
    upgradeBaseCost: 3400,
    upgradeCostGrowth: 1.8,
    manaCostPerLevel: 8,
    cooldownReductionPerLevel: 1.0,
    effectValuePerLevel: 0.30,
    durationPerLevel: 0.6,
    xpPerCast: 10,
    autoCast: { minEnemies: 6 },
  },
  {
    id: 'execute',
    name: 'Execute',
    description: 'Kills non-boss enemies below {dmg}% HP. Bosses below {boss}% HP lose {bossdmg}% of their max HP.',
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
    autoCast: { minEnemies: 1 },
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
    areaRadius: world(220),
    areaRadiusPerLevel: world(10),
    autoCast: { minEnemies: 3 },
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
    autoCast: { towerHpBelow: 0.75 },
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
  /**
   * Effective disc radius, in world units (post-`WORLD_SCALE`). Zero for
   * non-targeted abilities. The tooltip quotes it via `displayArea`.
   */
  area: number;
  /** Human-friendly disc radius, e.g. `"170 px"`. Empty string when not targeted. */
  displayArea: string;
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

/** Splash as a fraction of the heavy hit, matching every other splash in the game. */
export const METEOR_SPLASH_FRACTION = 0.55;

/** What Execute takes off a boss, as a fraction of the boss's **max** HP. */
export const EXECUTE_BOSS_MAXHP_FRACTION = 0.05;
export const EXECUTE_BOSS_MAXHP_PER_LEVEL = 0.008;

export function executeBossFrac(level: number): number {
  return EXECUTE_BOSS_MAXHP_FRACTION + EXECUTE_BOSS_MAXHP_PER_LEVEL * (Math.max(1, level) - 1);
}

/** Global flat slow applied by Frost Nova so idle play keeps a panic-button floor. */
export const GLOBAL_NOVA_SLOW = 0.85;

/** Buff id used by Frost Nova's brittle damage channel. Single source of truth
 *  for `AbilityManager` to `set` / `clear` and for any handler that needs to
 *  recognise the entry. */
export const BUFF_FROST_BRITTLE = 'ability:frostBrittle';
/** Brittle damage bonus (additive to chilledDamageBonus) at level 1. */
export const FROST_BRITTLE_BASE = 0.25;
/** Extra brittle damage bonus per level above 1. */
export const FROST_BRITTLE_PER_LEVEL = 0.03;

export function frostBrittle(level: number): number {
  return FROST_BRITTLE_BASE + FROST_BRITTLE_PER_LEVEL * (Math.max(1, level) - 1);
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
  // `{area}` quotes the disc in pre-scale (raw px) units, like `range`, so the
  // number is comparable to the range ring the player already reads.
  const area = (def.areaRadius !== undefined && def.areaRadius > 0)
    ? Math.round(
        (def.areaRadius + (def.areaRadiusPerLevel ?? 0) * lvlOffset) / WORLD_SCALE,
      )
    : null;
  return def.description
    .replace('{count}', count !== undefined ? String(Math.floor(count)) : '0')
    .replace('{dmg}', stripTrailingZero(effectValue))
    .replace('{slow}', String(Math.round((1 - effectValue) * 100)))
    .replace('{dur}', stripTrailingZero(duration))
    // Lifesteal and regen are stored as fractions; the text quotes percent.
    .replace('{ls}', stripTrailingZero(effectValue * 100))
    .replace('{rg}', stripTrailingZero(vampiricRegen(clampedLevel) * 100))
    .replace('{crit}', stripTrailingZero(precisionCritMultiplier(clampedLevel)))
    .replace('{boss}', String(Math.floor(effectValue / 2)))
    .replace('{bossdmg}', stripTrailingZero(executeBossFrac(clampedLevel) * 100, 1))
    .replace('{brittle}', stripTrailingZero(frostBrittle(clampedLevel) * 100))
    .replace('{area}', area !== null ? `${area} px` : '');
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
  // Plan §G.4: pre-scale (raw px) so the tooltip number is comparable to the
  // range ring the player already reads. `AbilityManager.getEffectiveStats`
  // overwrites this with the area-multiplied disc.
  const area = placementRadius(def.id, clampedLevel);
  const displayArea = area > 0 ? `${Math.round(area / WORLD_SCALE)} px` : '';

  return {
    level: clampedLevel,
    manaCost,
    cooldown,
    duration,
    effectValue,
    ...(count !== undefined ? { count } : {}),
    area,
    displayArea,
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
 * True when `id` is a *targeted* ability — one the player picks a point for.
 *
 * Plan §C.1: replaces `isPlaceable` as the canonical name. A def with a
 * non-zero `areaRadius` is targeted; a def without one is a self-buff. Phase 2
 * retires the legacy `PLACEABLE_ABILITIES` fallback so the per-def table is
 * the single source of truth.
 */
export function isTargeted(id: AbilityId): boolean {
  return (ABILITY_BY_ID[id]?.areaRadius ?? 0) > 0;
}

/** Legacy alias — kept so existing call sites keep compiling. */
export const isPlaceable = isTargeted;

/**
 * The radius, in world units, of `id`'s disc at `level`.
 *
 * Linear growth on purpose: the disc is the one ability stat the player
 * *sees*, and a geometric curve on a radius is a quartic curve on the area it
 * covers, which turns a level-10 Rain of Arrows into a screen-wipe.
 *
 * Levels are clamped to `[1, def.maxLevel]` so a passed -1 or 99 cannot push
 * the disc negative or grow it without a cap. A non-targeted ability returns 0.
 */
export function placementRadius(id: AbilityId, level: number = 1): number {
  const def = ABILITY_BY_ID[id];
  if (!def || !def.areaRadius) return 0;
  const lvl = Math.max(1, Math.min(def.maxLevel, level));
  return def.areaRadius + (def.areaRadiusPerLevel ?? 0) * (lvl - 1);
}

/**
 * What landing the disc on a good cluster is worth (plan §D.3 / §D.6).
 *
 * The disc is the whole effect for Rain of Arrows and the splash band for
 * Meteor, so a player-aimed cast carries the bonus on its full area. A
 * player-aimed disc is already better placed than an auto-aimed one, and the
 * bonus is sized so a focus click is the difference between "good" and
 * "wasted", not the difference between "fine" and "overkill".
 */
export const PLACEMENT_FOCUS_DAMAGE_BONUS = 0.25;
/** Extra speed removed inside a placed Frost Nova, and its duration scale. */
export const PLACEMENT_FOCUS_CHILL = 0.25;
export const PLACEMENT_FOCUS_CHILL_DURATION = 1.5;
