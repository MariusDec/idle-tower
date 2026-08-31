import type { PassiveAbilityId } from '../types';
import type { IconId } from './icons';
import { passiveXpForLevel } from './xpTables';

/**
 * Stats a passive may grant.
 *
 * Closed on purpose: `stats/contributors/passives.ts` switches over it with a
 * `never` default, so a stat nothing consumes is a compile error rather than a
 * milestone rank that silently does nothing. Values are **percent** unless the
 * name ends in `_flat`, in which case they are the consumer's own raw unit.
 */
export type PassiveStat =
  // ── offense ──
  | 'damage_pct'
  | 'fire_rate_pct'
  | 'crit_chance_pct'
  | 'crit_damage_pct'
  | 'armor_pen_pct'
  | 'armor_pen_flat'
  | 'pierce_flat'
  | 'double_shot_chance_pct'
  | 'extra_projectile_chance_pct'
  | 'execute_threshold_pct'
  | 'execute_damage_multiplier_pct'
  | 'instant_kill_chance_pct'
  | 'boss_damage_pct'
  | 'overwatch_damage_pct'
  | 'splash_radius_flat'
  | 'splash_fraction_pct'
  // ── defense ──
  | 'max_hp_pct'
  | 'armor_flat_pct'
  | 'lifesteal_pct'
  | 'thorns_pct'
  | 'dodge_chance_pct'
  | 'knockback_pct'
  | 'wall_fraction_pct'
  | 'shield_charges_flat'
  | 'shield_recharge_pct'
  | 'mana_shield_pct'
  | 'second_wind_pct'
  | 'revive_charges_flat'
  // ── economy ──
  | 'gold_mult_pct'
  | 'double_gold_chance_pct'
  | 'orb_value_pct'
  | 'equipment_find_chance_pct'
  | 'upgrade_cost_reduction_pct'
  | 'interest_pct'
  | 'windfall_mult_flat'
  | 'auto_buy_speed_pct'
  | 'xp_gain_pct'
  | 'rp_drop_chance_pct'
  | 'momentum_gain_pct'
  // ── arcana ──
  | 'mana_regen_pct'
  | 'max_mana_flat'
  | 'max_mana_pct'
  | 'mana_on_kill_pct'
  | 'ability_damage_pct'
  | 'ability_cooldown_pct'
  | 'ability_cost_pct'
  | 'magic_proc_chance_pct'
  | 'buff_duration_pct'
  | 'ability_echo_chance_pct';

export const PASSIVE_STATS: readonly PassiveStat[] = [
  'damage_pct', 'fire_rate_pct', 'crit_chance_pct', 'crit_damage_pct',
  'armor_pen_pct', 'armor_pen_flat', 'pierce_flat', 'double_shot_chance_pct',
  'extra_projectile_chance_pct', 'execute_threshold_pct',
  'execute_damage_multiplier_pct', 'instant_kill_chance_pct', 'boss_damage_pct',
  'overwatch_damage_pct', 'splash_radius_flat', 'splash_fraction_pct',
  'max_hp_pct', 'armor_flat_pct', 'lifesteal_pct', 'thorns_pct',
  'dodge_chance_pct', 'knockback_pct', 'wall_fraction_pct',
  'shield_charges_flat', 'shield_recharge_pct', 'mana_shield_pct',
  'second_wind_pct', 'revive_charges_flat',
  'gold_mult_pct', 'double_gold_chance_pct', 'orb_value_pct',
  'equipment_find_chance_pct', 'upgrade_cost_reduction_pct', 'interest_pct',
  'windfall_mult_flat', 'auto_buy_speed_pct', 'xp_gain_pct',
  'rp_drop_chance_pct', 'momentum_gain_pct',
  'mana_regen_pct', 'max_mana_flat', 'max_mana_pct', 'mana_on_kill_pct',
  'ability_damage_pct', 'ability_cooldown_pct', 'ability_cost_pct',
  'magic_proc_chance_pct', 'buff_duration_pct', 'ability_echo_chance_pct',
] as const;

/** The four thematic groups the panel renders as sections. */
export type PassiveFamily = 'warfare' | 'aegis' | 'avarice' | 'attunement';

export const PASSIVE_FAMILIES: readonly { id: PassiveFamily; label: string; color: string }[] = [
  { id: 'warfare',    label: 'Warfare',    color: '#ff8b46' },
  { id: 'aegis',      label: 'Aegis',      color: '#4ec97a' },
  { id: 'avarice',    label: 'Avarice',    color: '#f0b23c' },
  { id: 'attunement', label: 'Attunement', color: '#a95cff' },
];

/** One scaling line: `base + perLevel * level`, in the stat's own unit. */
export interface PassiveEffect {
  stat: PassiveStat;
  base: number;
  perLevel: number;
}

/**
 * A milestone rank. Granted in full the moment `level >= at`, and never scales
 * again — that is what makes hitting one an event rather than a rounding.
 */
export interface PassiveMilestone {
  at: number;
  /** Panel copy, e.g. "+6% crit chance". */
  label: string;
  grants: readonly { stat: PassiveStat; value: number }[];
}

/** Every passive has ranks at exactly these levels. */
export const PASSIVE_MILESTONE_LEVELS: readonly number[] = [5, 10, 15, 20, 25];

/** Every passive caps here. */
export const PASSIVE_MAX_LEVEL = 25;

export interface PassiveAbilityDef {
  id: PassiveAbilityId;
  name: string;
  family: PassiveFamily;
  /** One-line identity, shown under the name. Never contains a number. */
  tagline: string;
  /** Scaling lines. `describePassiveEffects` renders these. */
  effects: readonly PassiveEffect[];
  milestones: readonly PassiveMilestone[];
  /** Minimum *lifetime* highest wave before the unlock button appears. */
  unlockWave: number;
  /** Gold to unlock. `round2sig(6 * waveGoldRef(unlockWave))`. */
  unlockGoldCost: number;
  /** Gold for level 0→1. `round2sig(4 * waveGoldRef(unlockWave))`. */
  upgradeBaseCost: number;
  /** XP for level 1. `round2sig(10 * passiveWaveXpRef(unlockWave))`. */
  xpBase: number;
  icon: IconId;
  color: string;
}

/**
 * Gold cost doubles every level.
 *
 * 2.0 rather than the old 1.5–1.9 because the *economy* itself grows ~1.11x per
 * wave: any growth below ~1.11^7 makes a level cheaper, in waves-of-income, the
 * deeper the player is. At 2.0 a level costs roughly one extra wave of depth
 * than the one before it, forever.
 */
export const PASSIVE_COST_GROWTH = 2.0;

/** Gold to go from `level` to `level + 1`. */
export function passiveUpgradeCost(def: PassiveAbilityDef, level: number): number {
  if (level < 0) return def.upgradeBaseCost;
  return Math.floor(def.upgradeBaseCost * Math.pow(PASSIVE_COST_GROWTH, level));
}

/** Total value of `stat` this passive contributes at `level`, 0 if it grants none. */
export function passiveStatValue(
  def: PassiveAbilityDef,
  stat: PassiveStat,
  level: number,
): number {
  let total = 0;
  for (const e of def.effects) {
    if (e.stat === stat) total += e.base + e.perLevel * level;
  }
  for (const m of def.milestones) {
    if (level < m.at) continue;
    for (const g of m.grants) {
      if (g.stat === stat) total += g.value;
    }
  }
  return total;
}

/** The next milestone above `level`, or null when all five are taken. */
export function nextPassiveMilestone(
  def: PassiveAbilityDef,
  level: number,
): PassiveMilestone | null {
  for (const m of def.milestones) if (level < m.at) return m;
  return null;
}

/** Display unit for a stat: how one raw value is written in the panel. */
export function formatPassiveStat(stat: PassiveStat, value: number): string {
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  switch (stat) {
    case 'armor_pen_flat':      return `+${n(value)} flat armour ignored`;
    case 'pierce_flat':         return `+${n(value)} pierce`;
    case 'splash_radius_flat':  return `+${n(value)} splash radius`;
    case 'shield_charges_flat': return `+${n(value)} shield charge`;
    case 'revive_charges_flat': return `+${n(value)} revive per run`;
    case 'windfall_mult_flat':  return `+${n(value)}x windfall chest`;
    case 'max_mana_flat':       return `+${n(value)} max mana`;
    default:                    return `+${n(value)}% ${PASSIVE_STAT_LABELS[stat]}`;
  }
}

/** Short noun for each stat, used by `formatPassiveStat`. */
export const PASSIVE_STAT_LABELS: Record<PassiveStat, string> = {
  damage_pct: 'tower damage',
  fire_rate_pct: 'fire rate',
  crit_chance_pct: 'crit chance',
  crit_damage_pct: 'crit damage',
  armor_pen_pct: 'armour penetration',
  armor_pen_flat: 'flat armour ignored',
  pierce_flat: 'pierce',
  double_shot_chance_pct: 'double-shot chance',
  extra_projectile_chance_pct: 'extra-projectile chance',
  execute_threshold_pct: 'execute threshold',
  execute_damage_multiplier_pct: 'execute damage',
  instant_kill_chance_pct: 'instant-kill chance',
  boss_damage_pct: 'boss damage',
  overwatch_damage_pct: 'damage at long range',
  splash_radius_flat: 'splash radius',
  splash_fraction_pct: 'splash damage',
  max_hp_pct: 'max HP',
  armor_flat_pct: 'damage reduction',
  lifesteal_pct: 'life steal',
  thorns_pct: 'damage reflected',
  dodge_chance_pct: 'dodge chance',
  knockback_pct: 'knockback',
  wall_fraction_pct: 'wall HP (of max HP)',
  shield_charges_flat: 'shield charges',
  shield_recharge_pct: 'faster shield recharge',
  mana_shield_pct: 'damage absorbed by mana',
  second_wind_pct: 'Second Wind power',
  revive_charges_flat: 'revives per run',
  gold_mult_pct: 'gold earned',
  double_gold_chance_pct: 'double-gold chance',
  orb_value_pct: 'loot orb value',
  equipment_find_chance_pct: 'equipment find chance',
  upgrade_cost_reduction_pct: 'cheaper tower upgrades',
  interest_pct: 'interest on banked gold',
  windfall_mult_flat: 'windfall chest',
  auto_buy_speed_pct: 'auto-buy speed',
  xp_gain_pct: 'XP gain',
  rp_drop_chance_pct: 'research point drop chance',
  momentum_gain_pct: 'momentum gain',
  mana_regen_pct: 'mana regen',
  max_mana_flat: 'max mana',
  max_mana_pct: 'max mana',
  mana_on_kill_pct: 'max mana per kill',
  ability_damage_pct: 'ability damage',
  ability_cooldown_pct: 'shorter ability cooldowns',
  ability_cost_pct: 'cheaper abilities',
  magic_proc_chance_pct: 'magic proc chance',
  buff_duration_pct: 'buff duration',
  ability_echo_chance_pct: 'ability echo chance',
};

/** Live effect lines for a passive at `level`, one string per active stat. */
export function describePassiveEffects(def: PassiveAbilityDef, level: number): string[] {
  const seen: PassiveStat[] = [];
  for (const e of def.effects) if (!seen.includes(e.stat)) seen.push(e.stat);
  for (const m of def.milestones) {
    if (level < m.at) continue;
    for (const g of m.grants) if (!seen.includes(g.stat)) seen.push(g.stat);
  }
  return seen
    .map(s => ({ s, v: passiveStatValue(def, s, level) }))
    .filter(x => x.v !== 0)
    .map(x => formatPassiveStat(x.s, x.v));
}

export function passiveXpToNextLevel(def: PassiveAbilityDef, level: number): number {
  if (level >= PASSIVE_MAX_LEVEL) return 0;
  return passiveXpForLevel(def, level + 1);
}

export const PASSIVE_ABILITIES: PassiveAbilityDef[] = [
  // ─────────────────────────── Warfare ───────────────────────────
  {
    id: 'passive_marksmanship',
    name: 'Marksmanship',
    family: 'warfare',
    tagline: 'Every shot hits harder.',
    icon: 'bullseye',
    color: '#ff8b46',
    unlockWave: 5,
    unlockGoldCost: 200,
    upgradeBaseCost: 130,
    xpBase: 260,
    effects: [{ stat: 'damage_pct', base: 8, perLevel: 4 }],
    milestones: [
      { at: 5,  label: '+8% armour penetration', grants: [{ stat: 'armor_pen_pct', value: 8 }] },
      { at: 10, label: '+6% crit chance',        grants: [{ stat: 'crit_chance_pct', value: 6 }] },
      { at: 15, label: '+1 pierce',              grants: [{ stat: 'pierce_flat', value: 1 }] },
      { at: 20, label: '+60% crit damage',       grants: [{ stat: 'crit_damage_pct', value: 60 }] },
      { at: 25, label: '+40% tower damage',      grants: [{ stat: 'damage_pct', value: 40 }] },
    ],
  },
  {
    id: 'passive_haste',
    name: 'Haste',
    family: 'warfare',
    tagline: 'More shots in the air.',
    icon: 'wingfoot',
    color: '#ffc879',
    unlockWave: 18,
    unlockGoldCost: 790,
    upgradeBaseCost: 520,
    xpBase: 550,
    effects: [{ stat: 'fire_rate_pct', base: 6, perLevel: 3 }],
    milestones: [
      { at: 5,  label: '+8% double-shot chance',      grants: [{ stat: 'double_shot_chance_pct', value: 8 }] },
      { at: 10, label: '+10% extra-projectile chance', grants: [{ stat: 'extra_projectile_chance_pct', value: 10 }] },
      { at: 15, label: '+15% fire rate',               grants: [{ stat: 'fire_rate_pct', value: 15 }] },
      { at: 20, label: '+12% double-shot chance',      grants: [{ stat: 'double_shot_chance_pct', value: 12 }] },
      { at: 25, label: '+25% fire rate',               grants: [{ stat: 'fire_rate_pct', value: 25 }] },
    ],
  },
  {
    id: 'passive_executioner',
    name: 'Executioner',
    family: 'warfare',
    tagline: 'Finish what the volley started.',
    icon: 'guillotine',
    color: '#d9534f',
    unlockWave: 40,
    unlockGoldCost: 7800,
    upgradeBaseCost: 5200,
    xpBase: 1100,
    effects: [
      { stat: 'execute_threshold_pct', base: 3, perLevel: 0.4 },
      { stat: 'execute_damage_multiplier_pct', base: 40, perLevel: 4 },
    ],
    milestones: [
      { at: 5,  label: '+10% boss damage',        grants: [{ stat: 'boss_damage_pct', value: 10 }] },
      { at: 10, label: '+1.2% instant-kill chance', grants: [{ stat: 'instant_kill_chance_pct', value: 1.2 }] },
      { at: 15, label: '+50% execute damage',     grants: [{ stat: 'execute_damage_multiplier_pct', value: 50 }] },
      { at: 20, label: '+10% armour penetration', grants: [{ stat: 'armor_pen_pct', value: 10 }] },
      { at: 25, label: '+5% execute threshold',   grants: [{ stat: 'execute_threshold_pct', value: 5 }] },
    ],
  },
  {
    id: 'passive_siege_doctrine',
    name: 'Siege Doctrine',
    family: 'warfare',
    tagline: 'Built for the things that do not die.',
    icon: 'catapult',
    color: '#ffa96f',
    unlockWave: 75,
    unlockGoldCost: 300000,
    upgradeBaseCost: 200000,
    xpBase: 2100,
    effects: [{ stat: 'boss_damage_pct', base: 10, perLevel: 4 }],
    milestones: [
      { at: 5,  label: '+6 flat armour ignored', grants: [{ stat: 'armor_pen_flat', value: 6 }] },
      { at: 10, label: 'Shots splash',           grants: [
        { stat: 'splash_radius_flat', value: 60 },
        { stat: 'splash_fraction_pct', value: 15 },
      ] },
      { at: 15, label: '+20% boss damage',        grants: [{ stat: 'boss_damage_pct', value: 20 }] },
      { at: 20, label: '+12% armour penetration', grants: [{ stat: 'armor_pen_pct', value: 12 }] },
      { at: 25, label: '+25% damage at long range', grants: [{ stat: 'overwatch_damage_pct', value: 25 }] },
    ],
  },

  // ──────────────────────────── Aegis ────────────────────────────
  {
    id: 'passive_fortitude',
    name: 'Fortitude',
    family: 'aegis',
    tagline: 'The tower simply refuses to fall.',
    icon: 'health-increase',
    color: '#4ec97a',
    unlockWave: 10,
    unlockGoldCost: 340,
    upgradeBaseCost: 230,
    xpBase: 370,
    effects: [{ stat: 'max_hp_pct', base: 10, perLevel: 5 }],
    milestones: [
      { at: 5,  label: '+1.5% life steal',      grants: [{ stat: 'lifesteal_pct', value: 1.5 }] },
      { at: 10, label: '+6% damage reduction',  grants: [{ stat: 'armor_flat_pct', value: 6 }] },
      { at: 15, label: '+25% max HP',           grants: [{ stat: 'max_hp_pct', value: 25 }] },
      { at: 20, label: '+1 revive per run',     grants: [{ stat: 'revive_charges_flat', value: 1 }] },
      { at: 25, label: '+25% Second Wind power', grants: [{ stat: 'second_wind_pct', value: 25 }] },
    ],
  },
  {
    id: 'passive_retribution',
    name: 'Retribution',
    family: 'aegis',
    tagline: 'Touching the tower costs them.',
    icon: 'spiked-halo',
    color: '#79d2ff',
    unlockWave: 30,
    unlockGoldCost: 2700,
    upgradeBaseCost: 1800,
    xpBase: 840,
    effects: [{ stat: 'thorns_pct', base: 8, perLevel: 2 }],
    milestones: [
      { at: 5,  label: '+5% dodge chance',      grants: [{ stat: 'dodge_chance_pct', value: 5 }] },
      { at: 10, label: '+50% knockback',        grants: [{ stat: 'knockback_pct', value: 50 }] },
      { at: 15, label: '+15% damage reflected', grants: [{ stat: 'thorns_pct', value: 15 }] },
      { at: 20, label: '+15% wall HP',          grants: [{ stat: 'wall_fraction_pct', value: 15 }] },
      { at: 25, label: '+10% dodge chance',     grants: [{ stat: 'dodge_chance_pct', value: 10 }] },
    ],
  },
  {
    id: 'passive_aegis_ward',
    name: 'Aegis Ward',
    family: 'aegis',
    tagline: 'Mana takes the hit the tower cannot.',
    icon: 'magic-shield',
    color: '#4a9eff',
    unlockWave: 58,
    unlockGoldCost: 51000,
    upgradeBaseCost: 34000,
    xpBase: 1600,
    effects: [{ stat: 'mana_shield_pct', base: 4, perLevel: 1.2 }],
    milestones: [
      { at: 5,  label: '+1 shield charge',           grants: [{ stat: 'shield_charges_flat', value: 1 }] },
      { at: 10, label: '+20% faster shield recharge', grants: [{ stat: 'shield_recharge_pct', value: 20 }] },
      { at: 15, label: '+25% max mana',              grants: [{ stat: 'max_mana_pct', value: 25 }] },
      { at: 20, label: '+1 shield charge',           grants: [{ stat: 'shield_charges_flat', value: 1 }] },
      { at: 25, label: '+12% damage absorbed by mana', grants: [{ stat: 'mana_shield_pct', value: 12 }] },
    ],
  },

  // ─────────────────────────── Avarice ───────────────────────────
  {
    id: 'passive_scavenger',
    name: 'Scavenger',
    family: 'avarice',
    tagline: 'Nothing dies without paying.',
    icon: 'gold-nuggets',
    color: '#f0b23c',
    unlockWave: 14,
    unlockGoldCost: 520,
    upgradeBaseCost: 340,
    xpBase: 460,
    effects: [{ stat: 'gold_mult_pct', base: 10, perLevel: 5 }],
    milestones: [
      { at: 5,  label: '+6% double-gold chance',      grants: [{ stat: 'double_gold_chance_pct', value: 6 }] },
      { at: 10, label: '+25% loot orb value',         grants: [{ stat: 'orb_value_pct', value: 25 }] },
      { at: 15, label: '+25% gold earned',            grants: [{ stat: 'gold_mult_pct', value: 25 }] },
      { at: 20, label: '+5% equipment find chance',   grants: [{ stat: 'equipment_find_chance_pct', value: 5 }] },
      { at: 25, label: '+12% double-gold chance',     grants: [{ stat: 'double_gold_chance_pct', value: 12 }] },
    ],
  },
  {
    id: 'passive_treasury',
    name: 'Treasury',
    family: 'avarice',
    tagline: 'Gold you keep is gold you earned twice.',
    icon: 'money-stack',
    color: '#ffdf9a',
    unlockWave: 48,
    unlockGoldCost: 18000,
    upgradeBaseCost: 12000,
    xpBase: 1300,
    effects: [{ stat: 'upgrade_cost_reduction_pct', base: 1, perLevel: 0.4 }],
    milestones: [
      { at: 5,  label: '+1% interest on banked gold', grants: [{ stat: 'interest_pct', value: 1 }] },
      { at: 10, label: '+2x windfall chest',          grants: [{ stat: 'windfall_mult_flat', value: 2 }] },
      { at: 15, label: '+4% cheaper tower upgrades',  grants: [{ stat: 'upgrade_cost_reduction_pct', value: 4 }] },
      { at: 20, label: '+25% auto-buy speed',         grants: [{ stat: 'auto_buy_speed_pct', value: 25 }] },
      { at: 25, label: '+2% interest on banked gold', grants: [{ stat: 'interest_pct', value: 2 }] },
    ],
  },
  {
    id: 'passive_prospector',
    name: 'Prospector',
    family: 'avarice',
    tagline: 'You learn more from every wave than anyone else.',
    icon: 'treasure-map',
    color: '#c08cff',
    unlockWave: 88,
    unlockGoldCost: 1200000,
    upgradeBaseCost: 780000,
    xpBase: 2600,
    effects: [{ stat: 'xp_gain_pct', base: 8, perLevel: 4 }],
    milestones: [
      { at: 5,  label: '+3% research point drop chance', grants: [{ stat: 'rp_drop_chance_pct', value: 3 }] },
      { at: 10, label: '+6% equipment find chance',      grants: [{ stat: 'equipment_find_chance_pct', value: 6 }] },
      { at: 15, label: '+30% loot orb value',            grants: [{ stat: 'orb_value_pct', value: 30 }] },
      { at: 20, label: '+50% momentum gain',             grants: [{ stat: 'momentum_gain_pct', value: 50 }] },
      { at: 25, label: '+6% research point drop chance', grants: [{ stat: 'rp_drop_chance_pct', value: 6 }] },
    ],
  },

  // ────────────────────────── Attunement ─────────────────────────
  {
    id: 'passive_mana_spring',
    name: 'Mana Spring',
    family: 'attunement',
    tagline: 'The well never runs dry.',
    icon: 'fountain',
    color: '#7f6cff',
    unlockWave: 24,
    unlockGoldCost: 1500,
    upgradeBaseCost: 980,
    xpBase: 690,
    effects: [{ stat: 'mana_regen_pct', base: 10, perLevel: 6 }],
    milestones: [
      { at: 5,  label: '+40 max mana',            grants: [{ stat: 'max_mana_flat', value: 40 }] },
      { at: 10, label: '+0.4% max mana per kill', grants: [{ stat: 'mana_on_kill_pct', value: 0.4 }] },
      { at: 15, label: '+10% cheaper abilities',  grants: [{ stat: 'ability_cost_pct', value: 10 }] },
      { at: 20, label: '+30% max mana',           grants: [{ stat: 'max_mana_pct', value: 30 }] },
      { at: 25, label: '+0.8% max mana per kill', grants: [{ stat: 'mana_on_kill_pct', value: 0.8 }] },
    ],
  },
  {
    id: 'passive_arcane_focus',
    name: 'Arcane Focus',
    family: 'attunement',
    tagline: 'Spells land like siege engines.',
    icon: 'wizard-staff',
    color: '#a95cff',
    unlockWave: 65,
    unlockGoldCost: 110000,
    upgradeBaseCost: 71000,
    xpBase: 1800,
    effects: [{ stat: 'ability_damage_pct', base: 10, perLevel: 4 }],
    milestones: [
      { at: 5,  label: '+8% shorter ability cooldowns', grants: [{ stat: 'ability_cooldown_pct', value: 8 }] },
      { at: 10, label: '+5% magic proc chance',         grants: [{ stat: 'magic_proc_chance_pct', value: 5 }] },
      { at: 15, label: '+25% buff duration',            grants: [{ stat: 'buff_duration_pct', value: 25 }] },
      { at: 20, label: '+8% ability echo chance',       grants: [{ stat: 'ability_echo_chance_pct', value: 8 }] },
      { at: 25, label: '+30% ability damage',           grants: [{ stat: 'ability_damage_pct', value: 30 }] },
    ],
  },
];

export const PASSIVE_BY_ID: Record<string, PassiveAbilityDef> = PASSIVE_ABILITIES.reduce(
  (acc, a) => { acc[a.id] = a; return acc; },
  {} as Record<string, PassiveAbilityDef>,
);
