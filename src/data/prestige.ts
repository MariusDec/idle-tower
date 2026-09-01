import type { PrestigeLayer } from '../types';
import type { IconId } from './icons';
import { evalFormula } from './formulas';
import { world } from './arena';
import { formatNumber } from '../utils/bigNumber';

export type PrestigePerkEffect =
  | 'extra_shots'
  | 'scatter_shots'
  | 'back_shots'
  | 'auto_buy'
  | 'wave_skip'
  | 'damage_mult'
  | 'resource_mult'
  | 'automation'
  | 'fire_rate_mult'
  | 'crit_damage_mult'
  | 'pierce'
  | 'aoe_splash'
  | 'execute_damage'
  | 'treasure_chance'
  | 'mana_regen_mult'
  | 'start_gold'
  | 'orb_gold_mult'
  | 'ability_cdr'
  | 'wave_start'
  | 'auto_buy_speed'
  | 'research_speed'
  | 'game_speed'
  | 'idle_time'
  // ── prestige-abs §3.1: the tier-1 shelf ──
  | 'upgrade_cost'
  | 'xp_gain'
  | 'rp_drop'
  | 'orb_magnet'
  | 'revive_charge'
  // ── prestige-abs §5: the nodes with their own manager hook ──
  | 'first_draft_wave'
  | 'blessing_rerolls'
  | 'ability_unlock'
  | 'contract_reward';

export type AutomationKey = 'autoBuy' | 'autoAbilities' | 'autoAscend' | 'autoTranscend';

export type TPBranch = 'wrath' | 'fortune' | 'dominion';

export interface PerkPrerequisite {
  perkId: string;
  minLevel: number;
}

export interface PrestigePerkDef {
  id: string;
  layer: PrestigeLayer;
  name: string;
  description: string;
  costPerLevel: number;
  costScaling: number | string;
  maxLevel: number;
  effectType: PrestigePerkEffect;
  effectPerLevel: number | string;
  baseEffect?: number;
  icon: IconId;
  color: string;
  automationKey?: AutomationKey;
  branch?: TPBranch;
  tier?: number;
  prerequisites?: PerkPrerequisite[];
  exclusive?: string[];
}

export function perkCost(def: PrestigePerkDef, level: number): number {
  const s = typeof def.costScaling === 'string' ? evalFormula(def.costScaling, level) : def.costScaling;
  return Math.floor(def.costPerLevel * Math.pow(s, level));
}

const perkEffectCache = new Map<string, number>();

export function computePerkEffect(def: PrestigePerkDef, level: number): number {
  if (level <= 0) return 0;
  const cacheKey = `${def.id}:${level}`;
  const cached = perkEffectCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let v: number;
  if (def.baseEffect && level == 1) {
    v = def.baseEffect;
  } else if (typeof def.effectPerLevel === 'string') {
    v = def.baseEffect ?? 0;
    for (let i = 2; i <= level; i++) {
      v += evalFormula(def.effectPerLevel, i);
    }
  } else if (def.baseEffect !== undefined) {
    v = def.baseEffect + def.effectPerLevel * (level - 1);
  } else {
    v = def.effectPerLevel * level;
  }

  perkEffectCache.set(cacheKey, v);
  return v;
}

/**
 * Wave at which the first ascension unlocks (plan §2.3.4).
 *
 * Was 30, which took ~40 minutes of waves with almost no purchasing decisions
 * before the game's central mechanic was even introduced. Idle games want the
 * first prestige inside 15-25 minutes.
 */
export const ASCENSION_UNLOCK_WAVE = 20;

/**
 * Idle-time cap tuning (plan §10.1).
 *
 * The offline cap starts at 8 hours and grows 8h per level of `ap_idle_time`,
 * to a 4-day ceiling. The two constants live next to the perk that spends
 * them so the welcome-back copy and the perk row can stay in step with the
 * effect without hard-coding seconds at either call site.
 */
export const BASE_IDLE_TIME_SECONDS = 8 * 60 * 60;
export const IDLE_TIME_PER_LEVEL_SECONDS = 8 * 60 * 60;
export const IDLE_TIME_MAX_LEVEL = 11;

/**
 * Compact duration for the idle cap (plan §10.1). The cap is always a whole
 * number of hours, so this never needs a minutes field: `8h`, `1d`, `1d 8h`,
 * `4d`.
 */
export function formatIdleDuration(seconds: number): string {
  const hours = Math.max(0, Math.round(seconds / 3600));
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  if (days > 0) return h > 0 ? `${days}d ${h}h` : `${days}d`;
  return `${hours}h`;
}

/**
 * Default wave for the auto-Ascend target. Sits above the unlock wave so the
 * automation does not fire the instant ascension becomes legal.
 */
export const DEFAULT_AUTO_ASCEND_WAVE = 40;

/**
 * AP floor for a player's very first ascension. Guarantees the first prestige
 * is worth taking rather than something to be postponed.
 */
export const FIRST_ASCENSION_AP = 25;
export const TRANSCENDENCE_UNLOCK_AP = 100;

/**
 * Revamp §7: the AP projectile perks add *coverage*, not a damage multiplier.
 * Every extra lane carries a fraction of the volley's payload, so the whole
 * suite is worth ~x2.8 before geometry rather than the ~x13 it used to be.
 *
 * One shared block: `Game.buildShotVariants()` ships it and `sim/model.ts`
 * reads it, so the simulator measures the number that actually fires.
 */
/**
 * Waves Attunement (prestige-abs §5) pulls every ability unlock forward, per
 * level. Shared because three readers have to agree on it: the ability gate
 * itself, the milestone strip and the progression tab. A constant one of them
 * did not import is exactly how the strip starts lying about wave numbers.
 */
export const ABILITY_UNLOCK_WAVES_PER_LEVEL = 3;

/**
 * Second Wind, level by level (the revive perk's quality ladder).
 *
 * The perk always grants exactly *one* charge — what the levels buy is how
 * much of the bar the tower comes back with, and from level 3 a shockwave
 * that shoves the field off the tower so the revive is not immediately spent
 * on the same pack that just killed it. Indexed by `level - 1`.
 */
export const SECOND_WIND_LEVELS: readonly { hpFraction: number; shockwave: boolean }[] = [
  { hpFraction: 0.33, shockwave: false },
  { hpFraction: 0.50, shockwave: false },
  { hpFraction: 0.50, shockwave: true },
  { hpFraction: 0.75, shockwave: true },
  { hpFraction: 1.00, shockwave: true },
];

/**
 * Seconds before a spent Second Wind charge restocks.
 *
 * The charge used to be once per run, which made it a flat extension of the
 * run's length; on a restock clock it is a defensive cooldown the player can
 * actually play around, and it keeps paying out in the long runs the later
 * levels are bought for.
 */
export const SECOND_WIND_RESTOCK_SECONDS = 300;

/** Second Wind's revive at `level`, clamped to the ladder above. */
export function secondWindTier(level: number): { hpFraction: number; shockwave: boolean } {
  const i = Math.min(SECOND_WIND_LEVELS.length, Math.max(1, Math.floor(level))) - 1;
  return SECOND_WIND_LEVELS[i];
}

export const PRESTIGE_PROJECTILE_TUNING = {
  extraDamageScale: 0.55,   // Twin Arrows, front lane
  rearDamageScale: 0.55,    // Rear Guard, behind the tower
  scatterDamageScale: 0.35, // Scatter Shot, each of two angled lanes
} as const;

/**
 * Revamp §8: twelve perks in four tiers.
 *
 * The old tree let 25 AP — a first ascension — buy seven full-damage
 * projectiles, a ~7x multiplier bought once and never revisited (§1.5). The
 * three projectile nodes are now **single-level signature purchases** at
 * 60/90/200 AP, each carrying a fraction of the volley (§7), so the first
 * ascension buys exactly one utility line and coverage is something a player
 * saves several runs for.
 *
 * Prerequisites stay **OR**-based in `PrestigeManager.meetsPrerequisites` —
 * the panel renders them as "Requires A or B", so a node listing two parents
 * opens on either one.
 */
export const AP_PERKS: PrestigePerkDef[] = [
  // ── Tier 1: the first ascension's single choice ──────────────────
  {
    id: 'ap_auto_upgrader',
    layer: 'ascension',
    name: 'Auto-Upgrader',
    description: 'Auto-buys 1 upgrade every 10s; each level buys one more per tick',
    // prestige-abs §3.2 (fault 2): was 25 — exactly a first ascension's whole
    // budget, so the one transformative tier-1 node was an all-or-nothing
    // choice. At 12 it is a purchase alongside two or three others, and it is
    // still worth taking before the Watch's `overseer` hands auto-buy out free.
    // plan §3.2: the perk ladder widens to three levels (12 / 24 / 48 AP,
    // 84 total) and the per-tick budget equals the level.
    costPerLevel: 12,
    costScaling: 2,
    maxLevel: 3,
    effectType: 'auto_buy',
    effectPerLevel: 0,
    icon: 'auto-repair',
    color: '#e8a93b',
    automationKey: 'autoBuy',
    tier: 1,
  },
  {
    id: 'ap_wave_skipper',
    layer: 'ascension',
    name: 'Wave Skipper',
    description: '+1.5% chance per level to skip a wave and instantly collect its rewards',
    // prestige-abs §3.2: the old ladder reached +3% for the first 15 AP, which
    // is a rounding error on a run. 1.42/1.5% reaches +4.5% for the first 26.
    costPerLevel: 6,
    costScaling: 1.42,
    maxLevel: 12,
    effectType: 'wave_skip',
    effectPerLevel: 0.015,
    icon: 'fast-forward-button',
    color: '#3ec46d',
    tier: 1,
  },
  {
    id: 'ap_quiver',
    layer: 'ascension',
    name: 'Deep Quiver',
    description: '+2% fire rate per level',
    costPerLevel: 5,
    costScaling: 1.22,
    maxLevel: 30,
    effectType: 'fire_rate_mult',
    effectPerLevel: 0.02,
    icon: 'lightning-arc',
    color: '#5b8def',
    tier: 1,
  },
  {
    id: 'ap_idle_time',
    layer: 'ascension',
    name: 'Extended Watch',
    description: 'Tower auto-battles for an additional 8 hours while away.',
    costPerLevel: 14,
    costScaling: 1.6,
    maxLevel: IDLE_TIME_MAX_LEVEL,
    effectType: 'idle_time',
    effectPerLevel: IDLE_TIME_PER_LEVEL_SECONDS,
    icon: 'hourglass',
    color: '#5b8def',
    tier: 1
  },
  // ── prestige-abs §3.1: the widened tier-1 shelf ──────────────────
  //
  // Six nodes, each a different *verb*, each visible inside a minute of the
  // next run starting. Every one resolves through a `StatKey` that already has
  // a consumer or through a manager method that already exists, so the shelf
  // is data plus plumbing rather than new combat code (§R3).
  {
    id: 'ap_seed_capital',
    layer: 'ascension',
    name: 'Seed Capital',
    description: 'Start each run with bonus gold, growing 45% per level',
    costPerLevel: 5,
    costScaling: 1.30,
    maxLevel: 8,
    effectType: 'start_gold',
    // The player-facing figure is `200 * 1.45^(L-1)` — 200 at L1, 2 695 at L8.
    // `computePerkEffect` *sums* a string `effectPerLevel` from level 2 up, so
    // the per-level term is the geometric step (`200*1.45^(L-1) -
    // 200*1.45^(L-2)` = `90*1.45^(L-2)`) and the sum telescopes back to the
    // quoted curve. Writing the curve itself here would compound it twice.
    effectPerLevel: '90 * Math.pow(1.45, {level} - 2)',
    baseEffect: 200,
    icon: 'shiny-purse',
    color: '#e8a93b',
    tier: 1,
  },
  {
    id: 'ap_prospector',
    layer: 'ascension',
    name: 'Prospector',
    description: '-1.5% upgrade cost per level',
    costPerLevel: 4,
    costScaling: 1.30,
    maxLevel: 10,
    effectType: 'upgrade_cost',
    effectPerLevel: 0.015,
    icon: 'gold-mine',
    color: '#3ec46d',
    tier: 1,
  },
  {
    id: 'ap_veterancy',
    layer: 'ascension',
    name: 'Veterancy',
    description: '+8% tower XP per level',
    costPerLevel: 5,
    costScaling: 1.28,
    maxLevel: 8,
    effectType: 'xp_gain',
    effectPerLevel: 0.08,
    icon: 'brain',
    color: '#9b59ff',
    tier: 1,
  },
  // ── Tier 2: the unbounded sinks and the research line ────────────
  {
    id: 'ap_might',
    layer: 'ascension',
    name: 'Ascendant Might',
    description: '+2% all damage per level. Never caps.',
    costPerLevel: 6,
    costScaling: 1.20,
    maxLevel: 999,
    effectType: 'damage_mult',
    effectPerLevel: 0.02,
    icon: 'mighty-force',
    color: '#d04848',
    tier: 2,
    prerequisites: [
      { perkId: 'ap_auto_upgrader', minLevel: 1 },
      { perkId: 'ap_quiver', minLevel: 3 },
      // prestige-abs §3.3: a third OR-parent, so the economy opener reaches the
      // damage sink without buying automation or fire rate first.
      { perkId: 'ap_prospector', minLevel: 3 },
    ],
  },
  {
    id: 'ap_fortune',
    layer: 'ascension',
    name: 'Ascendant Fortune',
    description: '+2% all gold per level. Never caps.',
    costPerLevel: 6,
    costScaling: 1.20,
    maxLevel: 999,
    effectType: 'resource_mult',
    effectPerLevel: 0.02,
    icon: 'crown-coin',
    color: '#e8a93b',
    tier: 2,
    prerequisites: [
      { perkId: 'ap_auto_upgrader', minLevel: 1 },
      { perkId: 'ap_wave_skipper', minLevel: 2 },
      { perkId: 'ap_seed_capital', minLevel: 3 },
    ],
  },
  {
    id: 'ap_research_speed',
    layer: 'ascension',
    name: 'Scholarly Focus',
    description: '-8% research time per level',
    costPerLevel: 8,
    costScaling: 1.8,
    maxLevel: 5,
    effectType: 'research_speed',
    effectPerLevel: 0.08,
    icon: 'book-pile',
    color: '#9b59ff',
    tier: 2,
    prerequisites: [
      { perkId: 'ap_auto_upgrader', minLevel: 1 },
      { perkId: 'ap_field_notes', minLevel: 2 },
    ],
  },
  {
    id: 'ap_field_notes',
    layer: 'ascension',
    name: 'Field Notes',
    description: '+0.25% research point drop chance per level',
    costPerLevel: 6,
    costScaling: 1.45,
    maxLevel: 6,
    effectType: 'rp_drop',
    effectPerLevel: 0.0025,
    icon: 'book-pile',
    color: '#9b59ff',
    tier: 2,
    prerequisites: [
      { perkId: 'ap_veterancy', minLevel: 2 },
      { perkId: 'ap_auto_upgrader', minLevel: 1 },
    ],
  },
  {
    id: 'ap_lodestone',
    layer: 'ascension',
    name: 'Lodestone',
    description: 'Loot orbs always home to the tower and are collected at full value',
    costPerLevel: 18,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'orb_magnet',
    effectPerLevel: 1,
    icon: 'magnet',
    color: '#e8a93b',
    tier: 2,
    prerequisites: [
      { perkId: 'ap_seed_capital', minLevel: 2 },
      { perkId: 'ap_wave_skipper', minLevel: 2 },
    ],
  },
  {
    id: 'ap_second_wind',
    layer: 'ascension',
    name: 'Second Wind',
    description: 'Revive charge that restocks 5 minutes after it is spent; '
      + 'later levels revive at more HP and add a shockwave',
    costPerLevel: 120,
    costScaling: 1.5,
    maxLevel: SECOND_WIND_LEVELS.length,
    effectType: 'revive_charge',
    // One charge at every level: the levels buy *quality* of the revive (HP
    // and the shove), not more of them. `baseEffect` + a zero step keeps
    // `computePerkEffect` returning 1 from level 1 through 5.
    baseEffect: 1,
    effectPerLevel: 0,
    icon: 'shining-heart',
    color: '#d04848',
    tier: 2,
    prerequisites: [
      { perkId: 'ap_quiver', minLevel: 3 },
      { perkId: 'ap_auto_upgrader', minLevel: 1 },
    ],
  },
  // ── prestige-abs §5: the nodes that each cost a manager hook ─────
  {
    id: 'ap_field_kit',
    layer: 'ascension',
    name: 'Field Kit',
    description: 'Start each run with one banked blessing reroll per level',
    costPerLevel: 8,
    costScaling: 1.5,
    maxLevel: 3,
    effectType: 'blessing_rerolls',
    effectPerLevel: 1,
    icon: 'knapsack',
    color: '#3ec46d',
    tier: 2,
    prerequisites: [
      { perkId: 'ap_seed_capital', minLevel: 2 },
      { perkId: 'ap_veterancy', minLevel: 2 },
    ],
  },
  {
    id: 'ap_opening_gambit',
    layer: 'ascension',
    name: 'Opening Gambit',
    description: 'The first blessing draft arrives on wave 1 instead of wave 3',
    costPerLevel: 22,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'first_draft_wave',
    effectPerLevel: 1,
    icon: 'prayer',
    color: '#9b59ff',
    tier: 2,
    prerequisites: [
      { perkId: 'ap_field_kit', minLevel: 1 },
      { perkId: 'ap_auto_upgrader', minLevel: 1 },
    ],
  },
  {
    id: 'ap_broker',
    layer: 'ascension',
    name: 'Broker',
    description: '+20% contract gold and research points per level',
    costPerLevel: 10,
    costScaling: 1.5,
    maxLevel: 4,
    effectType: 'contract_reward',
    effectPerLevel: 0.20,
    icon: 'receive-money',
    color: '#e8a93b',
    tier: 2,
    prerequisites: [
      { perkId: 'ap_prospector', minLevel: 3 },
      { perkId: 'ap_auto_upgrader', minLevel: 1 },
    ],
  },
  // ── Tier 3: the signature coverage nodes, one level each ─────────
  {
    id: 'ap_extra_shots',
    layer: 'ascension',
    name: 'Twin Arrows',
    description: 'Adds one front projectile at 55% damage',
    costPerLevel: 60,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'extra_shots',
    effectPerLevel: 1,
    icon: 'double-shot',
    color: '#d04848',
    tier: 3,
    prerequisites: [
      { perkId: 'ap_might', minLevel: 5 },
      { perkId: 'ap_quiver', minLevel: 5 },
    ],
  },
  {
    id: 'ap_pierce',
    layer: 'ascension',
    name: 'Bodkin Mastery',
    description: '+1 pierce per level',
    costPerLevel: 75,
    costScaling: 2.2,
    maxLevel: 3,
    effectType: 'pierce',
    effectPerLevel: 1,
    icon: 'piercing-sword',
    color: '#d04848',
    tier: 3,
    prerequisites: [{ perkId: 'ap_might', minLevel: 5 }],
  },
  {
    id: 'ap_back_shots',
    layer: 'ascension',
    name: 'Rear Guard',
    description: 'Adds one rear projectile at 55% damage',
    costPerLevel: 90,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'back_shots',
    effectPerLevel: 1,
    icon: 'return-arrow',
    color: '#5b8def',
    tier: 3,
    prerequisites: [{ perkId: 'ap_extra_shots', minLevel: 1 }],
  },
  {
    id: 'ap_attunement',
    layer: 'ascension',
    name: 'Attunement',
    description: 'Abilities unlock 3 waves earlier per level',
    costPerLevel: 20,
    costScaling: 1.8,
    maxLevel: 3,
    effectType: 'ability_unlock',
    effectPerLevel: ABILITY_UNLOCK_WAVES_PER_LEVEL,
    icon: 'concentration-orb',
    color: '#5b8def',
    tier: 3,
    prerequisites: [
      { perkId: 'ap_field_notes', minLevel: 2 },
      { perkId: 'ap_veterancy', minLevel: 4 },
    ],
  },
  // ── Tier 4: the deep-run fork ────────────────────────────────────
  {
    id: 'ap_scatter_shots',
    layer: 'ascension',
    name: 'Scatter Shot',
    description: 'Adds two angled projectiles at 35% damage each',
    costPerLevel: 200,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'scatter_shots',
    effectPerLevel: 1,
    icon: 'pentarrows-tornado',
    color: '#ff7a3a',
    tier: 4,
    prerequisites: [
      { perkId: 'ap_back_shots', minLevel: 1 },
      { perkId: 'ap_pierce', minLevel: 2 },
    ],
  },
  {
    id: 'ap_warlord',
    layer: 'ascension',
    name: 'Warlord',
    description: '+5% all damage per level. Locks out Tycoon.',
    costPerLevel: 40,
    costScaling: 1.32,
    maxLevel: 12,
    effectType: 'damage_mult',
    effectPerLevel: 0.05,
    icon: 'crossed-swords',
    color: '#ff5252',
    tier: 4,
    prerequisites: [{ perkId: 'ap_might', minLevel: 10 }],
    exclusive: ['ap_tycoon'],
  },
  {
    id: 'ap_tycoon',
    layer: 'ascension',
    name: 'Tycoon',
    description: '+5% all gold per level. Locks out Warlord.',
    costPerLevel: 40,
    costScaling: 1.32,
    maxLevel: 12,
    effectType: 'resource_mult',
    effectPerLevel: 0.05,
    icon: 'gems',
    color: '#ffd54a',
    tier: 4,
    prerequisites: [{ perkId: 'ap_fortune', minLevel: 10 }],
    exclusive: ['ap_warlord'],
  },
];

/**
 * The bonus line an AP perk row shows (prestige-abs §8.4).
 *
 * Lives here rather than on `PrestigePanel` because the panel's `default:
 * return ''` arm is a silent failure mode: a perk whose effect type has no arm
 * compiles fine and renders a *blank* line with a price tag next to it. As a
 * free function over the def it can be asserted non-empty for every effect
 * type the table actually sells, which is the gate that closes that hole.
 */
export function describeAPPerkBonus(p: PrestigePerkDef, level: number, atMax: boolean): string {
  const pct = (scale: number) => Math.round(scale * 100);
  const extraPct = pct(PRESTIGE_PROJECTILE_TUNING.extraDamageScale);
  const rearPct = pct(PRESTIGE_PROJECTILE_TUNING.rearDamageScale);
  const scatterPct = pct(PRESTIGE_PROJECTILE_TUNING.scatterDamageScale);
  switch (p.effectType) {
    // Revamp §7/§12.5: these rows state the *payload*, never a bare
    // projectile count — an extra lane carries a fraction of the volley, and
    // a player pricing the node against its cost has to be able to see that.
    case 'extra_shots':
      return atMax
        ? `+${level} front projectile${level === 1 ? '' : 's'} at ${extraPct}% damage`
        : `Adds one front projectile at ${extraPct}% damage`;
    case 'scatter_shots':
      return atMax
        ? `+${level * 2} angled projectile${level * 2 === 1 ? '' : 's'} at ${scatterPct}% damage each`
        : `Adds two angled projectiles at ${scatterPct}% damage each`;
    case 'back_shots':
      return atMax
        ? `+${level} rear projectile${level === 1 ? '' : 's'} at ${rearPct}% damage`
        : `Adds one rear projectile at ${rearPct}% damage`;
    // Coverage, stated as what a shot does rather than as a bare stat name.
    case 'pierce':
      return level > 0
        ? `Shots pass through ${computePerkEffect(p, level).toFixed(0)} more ${computePerkEffect(p, level) === 1 ? 'enemy' : 'enemies'}`
        : 'Shots pass through one more enemy per level';
    case 'auto_buy':
      // plan §3.2: the perk's level is the per-tick purchase budget, so the
      // copy states it directly. The unwritten branch must still name the
      // unlock so a first-time reader knows what they are buying.
      return level > 0
        ? `Auto-buys ${level} upgrade${level === 1 ? '' : 's'} per tick`
        : 'Unlocks Auto-Upgrade (1 upgrade per tick, +1 per level)';
    case 'wave_skip':
      return atMax
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% wave skip chance`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% wave skip chance per level`;
    // The unbought rows quote what the *first* level buys rather than
    // rendering blank (§8.4) — a price tag with no bonus next to it is the
    // hole this function was lifted out of the panel to close.
    case 'damage_mult':
      return level > 0
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% damage`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% damage per level`;
    case 'resource_mult':
      return level > 0
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% gold`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% gold per level`;
    case 'fire_rate_mult':
      return level > 0
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% fire rate`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% fire rate per level`;
    case 'research_speed':
      return level > 0
        ? `-${(computePerkEffect(p, level) * 100).toFixed(0)}% research time`
        : `-${(computePerkEffect(p, 1) * 100).toFixed(0)}% research time per level`;
    case 'idle_time':
      return `+${formatIdleDuration(computePerkEffect(p, 1))} offline cap`;
    // ── prestige-abs §3.1 / §5 ──
    case 'start_gold':
      return level > 0
        ? `${formatNumber(Math.floor(computePerkEffect(p, level)))} starting gold`
        : `Start with ${formatNumber(Math.floor(computePerkEffect(p, 1)))} gold`;
    case 'upgrade_cost':
      return level > 0
        ? `-${(computePerkEffect(p, level) * 100).toFixed(1)}% upgrade cost`
        : `-${(computePerkEffect(p, 1) * 100).toFixed(1)}% upgrade cost per level`;
    case 'xp_gain':
      return level > 0
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% tower XP`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% tower XP per level`;
    case 'rp_drop':
      return level > 0
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% RP drop chance`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% RP drop chance per level`;
    case 'orb_magnet':
      return 'Loot orbs home to the tower at full value';
    case 'revive_charge': {
      // Level 0 quotes what the first level buys, like every other row here.
      const t = secondWindTier(level > 0 ? level : 1);
      const hp = `Revive at ${Math.round(t.hpFraction * 100)}% HP`;
      const wave = t.shockwave ? ' + shockwave' : '';
      const restock = `, restocks ${Math.round(SECOND_WIND_RESTOCK_SECONDS / 60)} min after use`;
      return `${hp}${wave}${restock}`;
    }
    case 'first_draft_wave':
      return 'First blessing draft on wave 1';
    case 'blessing_rerolls':
      return level > 0
        ? `${computePerkEffect(p, level).toFixed(0)} banked reroll${computePerkEffect(p, level) === 1 ? '' : 's'} each run`
        : '1 banked blessing reroll per level';
    case 'ability_unlock':
      return level > 0
        ? `Abilities unlock ${computePerkEffect(p, level).toFixed(0)} waves earlier`
        : `Abilities unlock ${computePerkEffect(p, 1).toFixed(0)} waves earlier per level`;
    case 'contract_reward':
      return level > 0
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% contract rewards`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% contract rewards per level`;
    default:
      return '';
  }
}

export const AP_PERK_BY_ID: Record<string, PrestigePerkDef> = AP_PERKS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<string, PrestigePerkDef>,
);

/**
 * Waves every ability unlock is pulled forward by, given a spend map.
 *
 * A free function over `apSpent` rather than a `PrestigeManager` method,
 * because the three readers that must agree on it are not all near a manager:
 * the ability gate has one, but the milestone strip and the progression tab
 * only ever see `GameState`. One derivation, three call sites, no drift.
 */
export function abilityUnlockOffset(apSpent: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const p of AP_PERKS) {
    if (p.effectType !== 'ability_unlock') continue;
    const lvl = apSpent[p.id] ?? 0;
    if (lvl > 0) total += Math.floor(computePerkEffect(p, lvl));
  }
  return total;
}

/**
 * AP banked for ascending at a given wave.
 *
 * The old shape (`20 + 1.13^(w-30) * sqrt(w-30)`) was tuned for a wall around
 * wave 37. With the flatter HP curve of §2.3.1 the wall sits far deeper, and
 * `1.13^depth` turned a first run into thousands of AP — enough to skip the
 * entire ascension layer. The gentler `1.06^depth` keeps a 20-wave-deeper run
 * worth ~3x as much AP, which is roughly what it costs to get there.
 */
export function apForWave(waveNumber: number): number {
  if (waveNumber < ASCENSION_UNLOCK_WAVE) return 0;
  const depth = waveNumber - ASCENSION_UNLOCK_WAVE;
  return Math.max(0, 15 + Math.floor(5 * Math.pow(1.06, depth) * Math.sqrt(depth + 1)));
}

export const TP_PERKS: PrestigePerkDef[] = [
  // ── Wrath Branch (Offensive) ──────────────────────────────────
  {
    id: 'tp_damage',
    layer: 'transcendence',
    name: 'Cosmic Power',
    description: 'All damage, growing every level. Never caps (gains taper).',
    // Revamp §9.1: 3 TP base on a 1.25 ladder (3, 3, 4, 5, 7, 9, 11, 14, 17, 22)
    // against a 0.20/sqrt(level) gain. A first transcendence (25 TP) buys ~5
    // levels for +65%, not 13 levels for +330%: the branch nodes stay live
    // purchases instead of being strictly dominated by this one row.
    costPerLevel: 3,
    costScaling: 1.25,
    maxLevel: 999,
    effectType: 'damage_mult',
    effectPerLevel: '0.20 / Math.sqrt({level})',
    baseEffect: 0.20,
    icon: 'orbital-rays',
    color: '#9b59ff',
    branch: 'wrath',
    tier: 1,
  },
  {
    id: 'tp_fire_rate',
    layer: 'transcendence',
    name: 'Rapid Assault',
    description: '+4% fire rate per level',
    costPerLevel: 4,
    costScaling: 1.35,
    maxLevel: 20,
    effectType: 'fire_rate_mult',
    effectPerLevel: 0.04,
    icon: 'lightning-arc',
    color: '#d04848',
    branch: 'wrath',
    tier: 2,
    prerequisites: [{ perkId: 'tp_damage', minLevel: 3 }],
  },
  {
    id: 'tp_crit',
    layer: 'transcendence',
    name: 'Lethal Precision',
    description: '+4% crit damage per level',
    costPerLevel: 4,
    costScaling: 1.35,
    maxLevel: 25,
    effectType: 'crit_damage_mult',
    effectPerLevel: 0.04,
    icon: 'target-arrows',
    color: '#ff7a3a',
    branch: 'wrath',
    tier: 2,
    prerequisites: [{ perkId: 'tp_damage', minLevel: 3 }],
  },
  {
    id: 'tp_pierce',
    layer: 'transcendence',
    name: 'Piercing Fury',
    description: '+1 pierce per 2 levels',
    costPerLevel: 10,
    costScaling: 1.9,
    maxLevel: 6,
    effectType: 'pierce',
    effectPerLevel: 0.5,
    icon: 'piercing-sword',
    color: '#d04848',
    branch: 'wrath',
    tier: 3,
    prerequisites: [
      { perkId: 'tp_fire_rate', minLevel: 3 },
      { perkId: 'tp_crit', minLevel: 3 },
    ],
  },
  {
    id: 'tp_aoe',
    layer: 'transcendence',
    name: 'Annihilation',
    description: 'Projectiles deal 25% AoE splash damage on impact',
    costPerLevel: 30,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'aoe_splash',
    effectPerLevel: 0.25,
    icon: 'explosion-rays',
    color: '#d04848',
    branch: 'wrath',
    tier: 4,
    prerequisites: [{ perkId: 'tp_pierce', minLevel: 2 }],
    exclusive: ['tp_execute'],
  },
  {
    id: 'tp_execute',
    layer: 'transcendence',
    name: 'Executioner',
    description: '+150% damage to enemies below 25% HP',
    costPerLevel: 30,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'execute_damage',
    effectPerLevel: 1.5,
    icon: 'reaper-scythe',
    color: '#9b59ff',
    branch: 'wrath',
    tier: 4,
    prerequisites: [{ perkId: 'tp_pierce', minLevel: 2 }],
    exclusive: ['tp_aoe'],
  },

  // ── Fortune Branch (Economic) ─────────────────────────────────
  {
    id: 'tp_resource',
    layer: 'transcendence',
    name: 'Astral Harvest',
    description: 'All resource gain, growing every level. Never caps (gains taper).',
    costPerLevel: 3,
    costScaling: 1.25,
    maxLevel: 999,
    effectType: 'resource_mult',
    /** Tapered on the same ladder as `tp_damage` — see the note there. */
    effectPerLevel: '0.12 / Math.sqrt({level})',
    baseEffect: 0.12,
    icon: 'star-gate',
    color: '#3ec46d',
    branch: 'fortune',
    tier: 1,
  },
  {
    id: 'tp_treasure',
    layer: 'transcendence',
    name: 'Treasure Hunter',
    description: '+2% chance for 3× gold drop per level',
    costPerLevel: 4,
    costScaling: 1.38,
    maxLevel: 15,
    effectType: 'treasure_chance',
    effectPerLevel: 0.02,
    icon: 'treasure-map',
    color: '#e8a93b',
    branch: 'fortune',
    tier: 2,
    prerequisites: [{ perkId: 'tp_resource', minLevel: 3 }],
  },
  {
    id: 'tp_mana',
    layer: 'transcendence',
    name: 'Mana Well',
    description: '+10% mana regen per level',
    costPerLevel: 4,
    costScaling: 1.38,
    maxLevel: 15,
    effectType: 'mana_regen_mult',
    effectPerLevel: 0.10,
    icon: 'well',
    color: '#5b8def',
    branch: 'fortune',
    tier: 2,
    prerequisites: [{ perkId: 'tp_resource', minLevel: 3 }],
  },
  {
    id: 'tp_head_start',
    layer: 'transcendence',
    name: 'Head Start',
    description: 'Start each ascension with bonus gold, growing 30% per level',
    costPerLevel: 5,
    costScaling: 1.7,
    maxLevel: 12,
    effectType: 'start_gold',
    // Revamp §9.1/§9.2: 400 x 1.30^(level-1) totals 400 at L1 and 29 731 at the
    // new L12 cap — roughly one early run's income at the depth where the last
    // level is affordable, against the old table's 1 874 391.
    effectPerLevel: '400 * Math.pow(1.30, {level} - 1)',
    baseEffect: 400,
    icon: 'checkered-flag',
    color: '#e8a93b',
    branch: 'fortune',
    tier: 3,
    prerequisites: [
      { perkId: 'tp_treasure', minLevel: 2 },
      { perkId: 'tp_mana', minLevel: 2 },
    ],
  },
  {
    id: 'tp_salvage',
    layer: 'transcendence',
    name: 'Salvage',
    // Revamp §9.2: replaces Midas Touch, which paid gold on every projectile
    // hit — a faucet that scaled with fire rate and projectile count, the one
    // shape the economy forbids everywhere else. Salvage scales with wave
    // income instead, which is the rule the rest of the economy follows.
    description: '+40% gold from loot orbs',
    costPerLevel: 28,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'orb_gold_mult',
    effectPerLevel: 0.40,
    icon: 'crown',
    color: '#e8a93b',
    branch: 'fortune',
    tier: 4,
    prerequisites: [{ perkId: 'tp_head_start', minLevel: 5 }],
    exclusive: ['tp_arcane'],
  },
  {
    id: 'tp_arcane',
    layer: 'transcendence',
    name: 'Arcane Abundance',
    description: '-30% ability cooldowns, -40% ability mana costs',
    costPerLevel: 28,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'ability_cdr',
    effectPerLevel: 0.30,
    icon: 'sparkles',
    color: '#5b8def',
    branch: 'fortune',
    tier: 4,
    prerequisites: [{ perkId: 'tp_head_start', minLevel: 5 }],
    exclusive: ['tp_salvage'],
  },

  // ── Dominion Branch (Utility/Automation) ──────────────────────
  {
    id: 'tp_auto_cast',
    layer: 'transcendence',
    name: 'Auto-Caster',
    description: 'Unlocks automation: auto-casts abilities when off cooldown and mana is sufficient',
    costPerLevel: 8,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'automation',
    effectPerLevel: 0,
    icon: 'clockwork',
    color: '#5b8def',
    automationKey: 'autoAbilities',
    branch: 'dominion',
    tier: 2,
  },
  {
    id: 'tp_wave_start',
    layer: 'transcendence',
    name: 'Wave Commander',
    description: 'Start each ascension at wave 2 × level',
    costPerLevel: 3,
    costScaling: 1.55,
    maxLevel: 8,
    effectType: 'wave_start',
    effectPerLevel: 2,
    icon: 'level-end-flag',
    color: '#3ec46d',
    branch: 'dominion',
    tier: 2,
  },
  {
    id: 'tp_efficiency',
    layer: 'transcendence',
    name: 'Efficiency',
    description: 'Auto-buy interval -1s per level (min 3s)',
    costPerLevel: 3,
    costScaling: 1.5,
    maxLevel: 7,
    effectType: 'auto_buy_speed',
    effectPerLevel: 1,
    icon: 'cog',
    color: '#e8a93b',
    branch: 'dominion',
    tier: 2,
  },
  {
    id: 'tp_game_speed',
    layer: 'transcendence',
    name: 'Accelerator',
    description: 'Each level adds +0.5× to max game speed',
    costPerLevel: 6,
    costScaling: 2.2,
    maxLevel: 6,
    effectType: 'game_speed',
    // Plan §9.3: the copy above promises +0.5x a level; the effect used to
    // grant +1x, so a maxed Accelerator ran the game at 11x while the panel
    // claimed 6x. The description is the contract — the number follows it.
    effectPerLevel: 0.5,
    icon: 'fast-forward-button',
    color: '#a855f7',
    branch: 'dominion',
    tier: 2,
  },
  {
    id: 'tp_auto_ascend',
    layer: 'transcendence',
    name: 'Auto-Ascender',
    description: 'Unlocks automation: auto-Ascends when you reach the target wave',
    costPerLevel: 20,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'automation',
    effectPerLevel: 0,
    icon: 'upgrade',
    color: '#d04848',
    automationKey: 'autoAscend',
    branch: 'dominion',
    tier: 3,
    prerequisites: [
      { perkId: 'tp_auto_cast', minLevel: 1 },
      { perkId: 'tp_wave_start', minLevel: 3 },
    ],
  },
  {
    id: 'tp_auto_transcend',
    layer: 'transcendence',
    name: 'Auto-Transcender',
    description: 'Unlocks automation: auto-Transcends when at least 100 AP is reached',
    costPerLevel: 40,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'automation',
    effectPerLevel: 0,
    icon: 'over-infinity',
    color: '#9b59ff',
    automationKey: 'autoTranscend',
    branch: 'dominion',
    tier: 4,
    prerequisites: [{ perkId: 'tp_auto_ascend', minLevel: 1 }],
  },
];

export const TP_PERK_BY_ID: Record<string, PrestigePerkDef> = TP_PERKS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<string, PrestigePerkDef>,
);

/**
 * TP banked for transcending with `ap` ascension points.
 *
 * Plan §3.2: `log2(ap+1)^2` gave 44 TP at 100 AP and only 276 at 100 000 — a
 * thousand times the ascension work for six times the reward, which made every
 * transcendence after the second worse than the one before it. The power law
 * below starts lower (25 TP for a first transcendence, still several levels of
 * a tier-1 perk) and keeps paying: 1 000x the AP is now ~16x the TP.
 */
export function tpForAP(ap: number): number {
  if (ap < TRANSCENDENCE_UNLOCK_AP) return 0;
  return Math.max(0, Math.floor(4 * Math.pow(ap, 0.4)));
}

export function canTranscend(ap: number): boolean {
  return ap >= TRANSCENDENCE_UNLOCK_AP;
}

/**
 * Annihilation's blast radius (plan §9.1).
 *
 * `tp_aoe` grants a fraction, not a radius, so the radius lives here next to
 * the perk rather than being invented at the call site. Sized under the
 * artillery core's `world(70)`: the perk is a universal top-up, not a core.
 */
export const TP_AOE_SPLASH_RADIUS = world(60);

/**
 * Cap on a single shot's summed splash fraction (plan §5.2).
 *
 * Composition rule: **max radius, summed fraction to the cap**. The cap can
 * never take a source below what it grants on its own, so the artillery core
 * (0.5) keeps its blast and Annihilation adds on top of the smaller sources.
 */
export const SPLASH_FRACTION_CAP = 0.4;

export interface ShotSplash {
  splashRadius?: number;
  splashFraction?: number;
}

/**
 * Compose two splash payloads into the one channel `FireOptions` carries.
 *
 * Two splash payloads on one impact is one impact's worth of splash charged
 * twice, which is what the max-radius half prevents; the summed-fraction half
 * is what stops a second source from being silently free.
 */
export function composeShotSplash(base: ShotSplash, add: ShotSplash): ShotSplash {
  const baseRadius = base.splashRadius ?? 0;
  const addRadius = add.splashRadius ?? 0;
  if (baseRadius <= 0 && addRadius <= 0) return { ...base };
  const baseFraction = baseRadius > 0 ? base.splashFraction ?? 1 : 0;
  const addFraction = addRadius > 0 ? add.splashFraction ?? 1 : 0;
  return {
    splashRadius: Math.max(baseRadius, addRadius),
    splashFraction: Math.max(
      baseFraction,
      addFraction,
      Math.min(SPLASH_FRACTION_CAP, baseFraction + addFraction),
    ),
  };
}
