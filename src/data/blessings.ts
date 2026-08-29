/**
 * Blessings — the in-run roguelite draft (plan §1).
 *
 * Progression in this game is otherwise entirely vertical: upgrades, talents,
 * research and gear all only ever go up, so two runs at the same lifetime AP
 * differ only in how far the same numbers got. Blessings are the one layer that
 * is *run-scoped* and *chosen*: three offers every few waves, wiped on
 * ascension, so run #40 can be a ricochet run and run #41 a frost run.
 *
 * Two closed unions carry the content, and both have a compile-time consumer:
 * `BlessingStat` is switched exhaustively in `stats/contributors/blessings.ts`,
 * and `BlessingBehavior` is keyed exhaustively by
 * `BLESSING_BEHAVIOR_CONSUMERS` below. A stat or behavior nothing reads is a
 * type error, not a card that quietly does nothing — the same mechanism that
 * killed the last plan's twenty inert talents.
 */

import type { CoreId } from './cores';
import type { IconId } from './icons';
import { world } from './arena';
import { RARITY } from './palette';

export type BlessingRarity = 'common' | 'rare' | 'epic';

/**
 * Closed union — every stat a blessing can move must have a consumer.
 *
 * `enemySpeedPct`, `enemyHpPct` and `enemyDamagePct` are the odd ones out: they
 * resolve through the same pipeline as everything else but are written to
 * `EnemyManager`, not to `TowerState` (plan §1.4).
 */
export const BLESSING_STATS = [
  'damagePct', 'fireRatePct', 'critChancePct', 'critDamagePct', 'rangePct',
  'goldPct', 'maxHpPct', 'lifestealPct', 'manaRegenPct', 'abilityDamagePct',
  'armorPenFlat', 'pierceFlat', 'enemySpeedPct', 'enemyHpPct', 'enemyDamagePct',
] as const;
export type BlessingStat = typeof BLESSING_STATS[number];

/** Behaviors are queried by id, like upgrade evolutions. */
export type BlessingBehavior =
  | 'ricochet'          // shots bounce to one extra target for 60% damage
  | 'ricochet_power'    // ricochet bounces deal full damage and can chain twice
  | 'mortar'            // every 8th shot lands as a 90px splash
  | 'crit_chain'        // crits fire a 3-bounce chain for 40% damage
  | 'frost_shots'       // hits chill for 20% slow, 1.5s
  | 'shatter'           // damage +35% vs chilled/slowed enemies
  | 'orb_magnet'        // loot orbs (Part 4) home to the tower at full value
  | 'split_on_kill'     // a kill fires two 40% shards at nearby enemies
  | 'homing'            // projectiles seek the nearest enemy, re-targeting on pierce
  | 'overkill_carry'    // 25% of overkill damage carries to the next target
  | 'siphon'            // kills restore 1% max mana
  | 'executioner'       // instantly kill non-boss enemies below 8% HP
  | 'last_stand'        // below 30% tower HP: +60% damage
  | 'greed_engine';     // gold multiplier grows +2% per wave cleared this run

/**
 * Where each behavior is actually read.
 *
 * A `Record` over the union rather than a comment, so adding a behavior without
 * deciding where it is consumed does not compile. `tests/content-coverage.test.ts`
 * asserts the entries are non-empty and that the one deferred entry
 * (`orb_magnet`) is still excluded from the offer pool.
 */
export const BLESSING_BEHAVIOR_CONSUMERS: Record<BlessingBehavior, string> = {
  ricochet: 'ProjectileManager.applyRicochet',
  ricochet_power: 'ProjectileManager.applyRicochet (bounce count + damage)',
  mortar: 'Game.simulate (shot cadence) → ProjectileManager splash on hit',
  crit_chain: 'ProjectileManager.applyCritChain',
  frost_shots: 'ProjectileManager (on hit) → EnemyManager.applyChill',
  shatter: 'ProjectileManager (on hit, vs EnemyManager.isChilled)',
  orb_magnet: 'LootManager.setMagnetSource("blessing", …) (auto-collect rate + drift speed)',
  split_on_kill: 'Game enemy_killed handler',
  homing: 'Game.simulate / fireChargedShot → ProjectileManager.steerHoming',
  overkill_carry: 'ProjectileManager (on kill)',
  siphon: 'Game enemy_killed handler',
  executioner: 'ProjectileManager (on hit, pre-damage)',
  last_stand: 'stats/contributors/blessings (reads ctx.hpFraction)',
  greed_engine: 'BlessingManager.getStatTotals → goldPct',
};

export interface BlessingDef {
  id: string;
  name: string;
  icon: IconId;
  description: string;
  rarity: BlessingRarity;
  /** Draw weight within the eligible pool. */
  weight: number;
  /** 1 for behaviors, 3–5 for scaling. */
  maxStacks: number;
  minWave?: number;
  /** Scaling blessings declare stat deltas; behavior blessings declare `behavior`. */
  effects?: Array<{ stat: BlessingStat; perStack: number }>;
  behavior?: BlessingBehavior;
  /** Only offered when the player already holds this blessing (synergy follow-ups). */
  requires?: string;
  /**
   * Offer weight multiplier when the player runs this core (plan §6.2).
   *
   * **1.5x, and never exclusive.** A core biases the draft toward the cards
   * that build on it; it must never gate one away, because cross-core builds
   * are most of what makes a second run of the same core interesting. The
   * weight is applied in `BlessingManager.offerWeight`, which multiplies rather
   * than filters, so every eligible card keeps a non-zero draw chance at every
   * core — `tests/cores.test.ts` asserts exactly that.
   */
  corePreference?: Partial<Record<CoreId, number>>;
  /**
   * False while the blessing's consumer has not shipped yet. Excluded from
   * `rollOffer`, so a no-op card can exist in the table (and stay type-checked)
   * without ever reaching the player.
   */
  offerable?: boolean;
}

/**
 * How much a core tilts its favoured cards (plan §6.2).
 *
 * One constant rather than a literal on each card, because the plan's
 * requirement is about the *mechanism* ("1.5x, never exclusive"), not about any
 * individual card — and a per-card literal is how one of them quietly becomes
 * 3x during a re-tune.
 */
export const CORE_PREFERENCE_WEIGHT = 1.5;

/** Draft cadence and budget (plan §1.1). */
export const BLESSING_FIRST_DRAFT_WAVE = 3;
export const BLESSING_DRAFT_INTERVAL = 4;
export const BLESSING_OFFER_SIZE = 3;
export const BLESSING_MAX_PICKS = 30;
/** Free rerolls granted at the start of each draft, before held tokens. */
export const BLESSING_FREE_REROLLS = 1;

/**
 * Every magic number a behavior needs, in one place, so the combat code reads
 * as intent and a re-tune is a one-line diff here rather than a hunt through
 * `ProjectileManager`.
 */
export const BLESSING_TUNING = {
  ricochetRange: 200,
  ricochetDamage: 0.30,
  ricochetPowerDamage: 0.6,
  /** Bounces per shot: 1 with `ricochet`, this many with `ricochet_power`. */
  ricochetPowerBounces: 2,
  mortarInterval: 8,
  mortarRadius: world(90),
  /** The mortar shot itself hits for this much of a normal shot. */
  mortarDamageMult: 1.5,
  /** Everything else in the blast takes this fraction of the mortar's hit. */
  mortarSplashFraction: 1.0,
  critChainBounces: 3,
  critChainRange: 180,
  critChainDamage: 0.20,
  /** Speed multiplier applied to a chilled enemy. */
  frostChillFactor: 0.8,
  frostChillDuration: 1.5,
  shatterBonus: 0.15,
  splitShardCount: 2,
  splitShardDamage: 0.125,
  splitShardRange: 220,
  siphonManaFraction: 0.01,
  executeThreshold: 0.08,
  lastStandHpFraction: 0.3,
  lastStandDamage: 0.6,
  greedPerWave: 0.01,
  overkillCarry: 0.25,
  overkillRange: 200,
} as const;

/**
 * The pool.
 *
 * Commons are the filler that makes a rare feel earned; rares change the
 * picture; epics are run-defining, and four of them are **trade-offs** — the
 * first decisions in this game a player can get *wrong*, which is the whole
 * reason the right ones feel like anything.
 */
export const BLESSINGS: BlessingDef[] = [
  // ── Common (weight 10) ──
  {
    id: 'bl_sharpen',
    name: 'Sharpened Tips',
    icon: 'arrowhead',
    description: '+3% damage',
    rarity: 'common',
    weight: 10,
    maxStacks: 3,
    effects: [{ stat: 'damagePct', perStack: 0.03 }],
  },
  {
    id: 'bl_tempo',
    name: 'Tempo',
    icon: 'drum',
    description: '+2.5% fire rate',
    rarity: 'common',
    weight: 10,
    maxStacks: 3,
    effects: [{ stat: 'fireRatePct', perStack: 0.025 }],
  },
  {
    id: 'bl_focus',
    name: 'Focus',
    icon: 'eye-target',
    description: '+2% crit chance',
    rarity: 'common',
    weight: 10,
    maxStacks: 3,
    effects: [{ stat: 'critChancePct', perStack: 0.02 }],
    corePreference: { marksman: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_cruelty',
    name: 'Cruelty',
    icon: 'dripping-blade',
    description: '+12% crit damage',
    rarity: 'common',
    weight: 10,
    maxStacks: 3,
    effects: [{ stat: 'critDamagePct', perStack: 0.12 }],
    corePreference: { marksman: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_reach',
    name: 'Reach',
    icon: 'lob-arrow',
    description: '+15% range',
    rarity: 'common',
    weight: 10,
    maxStacks: 3,
    effects: [{ stat: 'rangePct', perStack: 0.15 }],
    corePreference: { marksman: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_avarice',
    name: 'Avarice',
    icon: 'receive-money',
    description: '+10% gold',
    rarity: 'common',
    weight: 10,
    maxStacks: 4,
    effects: [{ stat: 'goldPct', perStack: 0.10 }],
  },
  {
    id: 'bl_vigor',
    name: 'Vigor',
    icon: 'shining-heart',
    description: '+20% max HP',
    rarity: 'common',
    weight: 10,
    maxStacks: 4,
    effects: [{ stat: 'maxHpPct', perStack: 0.20 }],
    corePreference: { bloodforge: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_wellspring',
    name: 'Wellspring',
    icon: 'well',
    description: '+25% mana regeneration',
    rarity: 'common',
    weight: 10,
    maxStacks: 3,
    effects: [{ stat: 'manaRegenPct', perStack: 0.25 }],
    corePreference: { arcane: CORE_PREFERENCE_WEIGHT },
  },

  // ── Rare (weight 5) ──
  {
    id: 'bl_ricochet',
    name: 'Ricochet',
    icon: 'zig-arrow',
    description: 'Shots bounce to one extra target for 30% damage',
    rarity: 'rare',
    weight: 5,
    maxStacks: 1,
    behavior: 'ricochet',
  },
  {
    id: 'bl_mortar',
    name: 'Mortar Round',
    icon: 'falling-bomb',
    description: 'Every 8th shot lands as a 90px splash for 150% damage',
    rarity: 'rare',
    weight: 5,
    maxStacks: 1,
    behavior: 'mortar',
    corePreference: { artillery: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_frost',
    name: 'Frostbite',
    icon: 'frozen-arrow',
    description: 'Hits chill: −20% enemy speed for 1.5s',
    rarity: 'rare',
    weight: 5,
    maxStacks: 1,
    behavior: 'frost_shots',
    corePreference: { frostwork: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_split',
    name: 'Splinter',
    icon: 'striking-splinter',
    description: 'Kills fire two 15% shards at nearby enemies',
    rarity: 'rare',
    weight: 5,
    maxStacks: 1,
    behavior: 'split_on_kill',
  },
  {
    id: 'bl_homing',
    name: 'Seeker Shots',
    icon: 'spiral-arrow',
    description: 'Projectiles seek the nearest enemy',
    rarity: 'rare',
    weight: 5,
    maxStacks: 1,
    behavior: 'homing',
  },
  {
    id: 'bl_siphon',
    name: 'Siphon',
    icon: 'extraction-orb',
    description: 'Kills restore 1% max mana',
    rarity: 'rare',
    weight: 5,
    maxStacks: 1,
    behavior: 'siphon',
    corePreference: { arcane: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_pierce',
    name: 'Piercing Shot',
    icon: 'spine-arrow',
    description: '+2 pierce',
    rarity: 'rare',
    weight: 5,
    maxStacks: 2,
    effects: [{ stat: 'pierceFlat', perStack: 2 }],
    corePreference: { artillery: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_sunder',
    name: 'Sunder',
    icon: 'armor-punch',
    description: '+4 armour penetration',
    rarity: 'rare',
    weight: 5,
    maxStacks: 2,
    effects: [{ stat: 'armorPenFlat', perStack: 4 }],
    corePreference: { artillery: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_arcane',
    name: 'Arcane Surge',
    icon: 'star-swirl',
    description: '+30% ability damage',
    rarity: 'rare',
    weight: 5,
    maxStacks: 2,
    minWave: 10,
    effects: [{ stat: 'abilityDamagePct', perStack: 0.30 }],
    corePreference: { arcane: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_bulwark',
    name: 'Bulwark',
    icon: 'roman-shield',
    description: '+5% lifesteal',
    rarity: 'rare',
    weight: 5,
    maxStacks: 2,
    effects: [{ stat: 'lifestealPct', perStack: 0.05 }],
    corePreference: { bloodforge: CORE_PREFERENCE_WEIGHT },
  },

  // ── Epic (weight 2) ──
  {
    id: 'bl_executioner',
    name: 'Executioner',
    icon: 'reaper-scythe',
    description: 'Instantly kill non-boss enemies below 8% HP',
    rarity: 'epic',
    weight: 2,
    maxStacks: 1,
    behavior: 'executioner',
  },
  {
    id: 'bl_crit_chain',
    name: 'Chain Crit',
    icon: 'lightning-trio',
    description: 'Crits fire a 3-bounce chain for 20% damage',
    rarity: 'epic',
    weight: 2,
    maxStacks: 1,
    behavior: 'crit_chain',
  },
  {
    id: 'bl_overkill',
    name: 'Overkill',
    icon: 'punch-blast',
    description: '25% of overkill damage carries to the next target',
    rarity: 'epic',
    weight: 2,
    maxStacks: 1,
    behavior: 'overkill_carry',
  },
  {
    id: 'bl_last_stand',
    name: 'Last Stand',
    icon: 'cracked-shield',
    description: '+60% damage while below 30% tower HP',
    rarity: 'epic',
    weight: 2,
    maxStacks: 1,
    behavior: 'last_stand',
    corePreference: { bloodforge: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_greed_engine',
    name: 'Greed Engine',
    icon: 'gold-mine',
    description: '+1% gold per wave cleared this run, uncapped',
    rarity: 'epic',
    weight: 2,
    maxStacks: 1,
    behavior: 'greed_engine',
  },
  {
    id: 'bl_glass',
    name: 'Glass Cannon',
    icon: 'glass-heart',
    description: '+35% damage, −35% max HP',
    rarity: 'epic',
    weight: 2,
    maxStacks: 1,
    effects: [
      { stat: 'damagePct', perStack: 0.35 },
      { stat: 'maxHpPct', perStack: -0.35 },
    ],
    corePreference: { artillery: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_sniper',
    name: "Sniper's Creed",
    icon: 'crosshair',
    description: '−30% range, +20% fire rate',
    rarity: 'epic',
    weight: 2,
    maxStacks: 1,
    effects: [
      { stat: 'rangePct', perStack: -0.30 },
      { stat: 'fireRatePct', perStack: 0.20 },
    ],
    corePreference: { marksman: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_reckless',
    name: 'Reckless Greed',
    icon: 'rolling-dices',
    description: '+20% enemy speed, +25% gold',
    rarity: 'epic',
    weight: 2,
    maxStacks: 1,
    effects: [
      { stat: 'enemySpeedPct', perStack: 0.20 },
      { stat: 'goldPct', perStack: 0.25 },
    ],
  },
  {
    id: 'bl_brittle',
    name: 'Brittle Bones',
    icon: 'crossed-bones',
    description: '−10% enemy HP, +25% enemy damage',
    rarity: 'epic',
    weight: 2,
    maxStacks: 1,
    effects: [
      { stat: 'enemyHpPct', perStack: -0.10 },
      { stat: 'enemyDamagePct', perStack: 0.25 },
    ],
  },
  {
    id: 'bl_shatter',
    name: 'Shatter',
    icon: 'shatter',
    description: '+15% damage against slowed or chilled enemies',
    rarity: 'epic',
    weight: 2,
    maxStacks: 1,
    behavior: 'shatter',
    requires: 'bl_frost',
    corePreference: { frostwork: CORE_PREFERENCE_WEIGHT },
  },
  {
    id: 'bl_ricochet_power',
    name: 'Rebound',
    icon: 'armored-boomerang',
    description: 'Bounces deal 60% damage and chain twice',
    rarity: 'epic',
    weight: 2,
    maxStacks: 1,
    behavior: 'ricochet_power',
    requires: 'bl_ricochet',
  },

  {
    id: 'bl_magnet',
    name: 'Lodestone',
    icon: 'magnet',
    description: 'Loot orbs home twice as fast and pay full value',
    rarity: 'rare',
    weight: 5,
    maxStacks: 1,
    behavior: 'orb_magnet',
  },
];

export const BLESSING_BY_ID: Record<string, BlessingDef> = BLESSINGS.reduce(
  (acc, b) => {
    acc[b.id] = b;
    return acc;
  },
  {} as Record<string, BlessingDef>,
);

/**
 * Blessings use three of the five equipment rarities, and they use the *same*
 * three colours: a rare blessing and a rare sword should not be two different
 * blues. See `src/data/palette.ts`.
 */
export const BLESSING_RARITY_COLORS: Record<BlessingRarity, string> = {
  common: RARITY.common,
  rare: RARITY.rare,
  epic: RARITY.epic,
};

/** Human-readable effect line for a def at a given held stack count. */
export function describeBlessing(def: BlessingDef, stacks: number): string {
  if (!def.effects || def.effects.length === 0 || stacks <= 1) return def.description;
  const parts = def.effects.map(e => `${formatStatDelta(e.stat, e.perStack * stacks)}`);
  return `${def.description} (now ${parts.join(', ')})`;
}

/** Format one resolved stat delta the way the card and the held list show it. */
export function formatStatDelta(stat: BlessingStat, value: number): string {
  const flat = stat === 'armorPenFlat' || stat === 'pierceFlat';
  const sign = value >= 0 ? '+' : '−';
  const magnitude = Math.abs(value);
  const num = flat ? `${magnitude}` : `${Math.round(magnitude * 100)}%`;
  return `${sign}${num} ${BLESSING_STAT_LABELS[stat]}`;
}

export const BLESSING_STAT_LABELS: Record<BlessingStat, string> = {
  damagePct: 'damage',
  fireRatePct: 'fire rate',
  critChancePct: 'crit chance',
  critDamagePct: 'crit damage',
  rangePct: 'range',
  goldPct: 'gold',
  maxHpPct: 'max HP',
  lifestealPct: 'lifesteal',
  manaRegenPct: 'mana regen',
  abilityDamagePct: 'ability damage',
  armorPenFlat: 'armour pen',
  pierceFlat: 'pierce',
  enemySpeedPct: 'enemy speed',
  enemyHpPct: 'enemy HP',
  enemyDamagePct: 'enemy damage',
};
