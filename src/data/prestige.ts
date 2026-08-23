import type { PrestigeLayer } from '../types';
import type { IconId } from './icons';
import { evalFormula } from './formulas';
import { world } from './arena';

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
  | 'gold_on_hit'
  | 'ability_cdr'
  | 'wave_start'
  | 'auto_buy_speed'
  | 'research_speed'
  | 'game_speed'
  | 'idle_time';

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
    description: 'Unlocks Auto-Upgrade: buys upgrades every 10s using your chosen strategy',
    costPerLevel: 25,
    costScaling: 1,
    maxLevel: 1,
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
    description: '+1% chance per level to skip a wave and instantly collect its rewards',
    costPerLevel: 6,
    costScaling: 1.60,
    maxLevel: 15,
    effectType: 'wave_skip',
    effectPerLevel: 0.01,
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
    prerequisites: [{ perkId: 'ap_auto_upgrader', minLevel: 1 }],
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
    tier: 2,
    prerequisites: [{ perkId: 'ap_auto_upgrader', minLevel: 1 }],
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

export const AP_PERK_BY_ID: Record<string, PrestigePerkDef> = AP_PERKS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<string, PrestigePerkDef>,
);

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
    costPerLevel: 1,
    costScaling: 1.12,
    maxLevel: 999,
    effectType: 'damage_mult',
    // Plan §3.2: was a flat +50%/level against a 1.12^level cost, which made
    // this single node strictly better than every capped branch perk at any
    // TP total — the branches were decoration. The per-level gain now decays
    // as 1/sqrt(level), so the node still absorbs unlimited TP (~+2*sqrt(N)*50%
    // total) while a capped perk's fixed percentage stays competitive.
    effectPerLevel: '0.5 / Math.sqrt({level})',
    baseEffect: 0.5,
    icon: 'orbital-rays',
    color: '#9b59ff',
    branch: 'wrath',
    tier: 1,
  },
  {
    id: 'tp_fire_rate',
    layer: 'transcendence',
    name: 'Rapid Assault',
    description: '+8% fire rate per level',
    costPerLevel: 2,
    costScaling: 1.32,
    maxLevel: 25,
    effectType: 'fire_rate_mult',
    effectPerLevel: 0.08,
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
    description: '+5% crit damage per level',
    costPerLevel: 2,
    costScaling: 1.32,
    maxLevel: 30,
    effectType: 'crit_damage_mult',
    effectPerLevel: 0.05,
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
    costPerLevel: 4,
    costScaling: 1.8,
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
    costPerLevel: 12,
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
    description: '+200% damage to enemies below 25% HP',
    costPerLevel: 12,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'execute_damage',
    effectPerLevel: 2.0,
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
    costPerLevel: 1,
    costScaling: 1.12,
    maxLevel: 999,
    effectType: 'resource_mult',
    /** Tapered for the same reason as `tp_damage` — see the note there. */
    effectPerLevel: '0.25 / Math.sqrt({level})',
    baseEffect: 0.25,
    icon: 'star-gate',
    color: '#3ec46d',
    branch: 'fortune',
    tier: 1,
  },
  {
    id: 'tp_treasure',
    layer: 'transcendence',
    name: 'Treasure Hunter',
    description: '+3% chance for 3× gold drop per level',
    costPerLevel: 2,
    costScaling: 1.35,
    maxLevel: 20,
    effectType: 'treasure_chance',
    effectPerLevel: 0.03,
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
    description: '+15% mana regen per level',
    costPerLevel: 2,
    costScaling: 1.35,
    maxLevel: 20,
    effectType: 'mana_regen_mult',
    effectPerLevel: 0.15,
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
    description: 'Start each ascension with level × 500 gold',
    costPerLevel: 3,
    costScaling: 1.6,
    maxLevel: 20,
    effectType: 'start_gold',
    // Plan §3.2: a flat 500/level is a rounding error by the time a player has
    // 20 levels of it. Geometric growth keeps the opener meaningful against a
    // gold curve that is itself exponential.
    effectPerLevel: '500 * Math.pow(1.45, {level} - 1)',
    baseEffect: 500,
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
    id: 'tp_midas',
    layer: 'transcendence',
    name: 'Midas Touch',
    description: 'Enemies drop 10% of kill gold on every projectile hit',
    costPerLevel: 12,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'gold_on_hit',
    effectPerLevel: 0.10,
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
    costPerLevel: 12,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'ability_cdr',
    effectPerLevel: 0.30,
    icon: 'sparkles',
    color: '#5b8def',
    branch: 'fortune',
    tier: 4,
    prerequisites: [{ perkId: 'tp_head_start', minLevel: 5 }],
    exclusive: ['tp_midas'],
  },

  // ── Dominion Branch (Utility/Automation) ──────────────────────
  {
    id: 'tp_auto_cast',
    layer: 'transcendence',
    name: 'Auto-Caster',
    description: 'Unlocks automation: auto-casts abilities when off cooldown and mana is sufficient',
    costPerLevel: 6,
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
    description: 'Start each ascension at wave 3 × level',
    costPerLevel: 2,
    costScaling: 1.5,
    maxLevel: 10,
    effectType: 'wave_start',
    effectPerLevel: 3,
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
    costPerLevel: 2,
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
    costPerLevel: 3,
    costScaling: 2.4,
    maxLevel: 10,
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
    costPerLevel: 12,
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
    costPerLevel: 25,
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
