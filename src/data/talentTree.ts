import type { IconId } from './icons';

// ── Types ────────────────────────────────────────────────────────────────────

export type TalentBranch = 'offense' | 'defense' | 'utility' | 'magic';

export const TALENT_STATS = [
  // ── Wrath ──
  'base_damage_pct', 'all_damage_pct', 'fire_rate_pct', 'crit_chance_pct',
  'crit_damage_pct', 'range_pct', 'armor_penetration_pct', 'execution_damage_pct',
  'extra_projectile_chance', 'focus_stack_pct', 'kill_frenzy_pct', 'overwatch_damage_pct',
  'boss_damage_pct', 'crit_followup_chance', 'shot_splash_radius', 'shot_splash_fraction',
  // ── Bulwark ──
  'max_hp_pct', 'defense_pct', 'armor_pct', 'thorns_pct', 'dodge_chance',
  'wall_regen_pct', 'wall_contact_pct', 'shield_charges', 'shield_recharge_pct',
  'health_regen_pct', 'knockback_pct', 'second_wind_pct', 'low_hp_damage_pct',
  // ── Fortune ──
  'gold_mult_pct', 'xp_gain_pct', 'double_gold_chance', 'head_start_waves',
  'equipment_find_chance', 'upgrade_cost_reduction', 'orb_value_pct', 'momentum_gain_pct',
  'auto_buy_speed_pct', 'windfall_mult', 'interest_pct', 'enemy_hp_pct',
  // ── Arcana ──
  'ability_damage_pct', 'mana_cost_reduction', 'ability_cooldown_pct', 'mana_regen_pct',
  'max_mana_flat', 'max_mana_pct', 'magic_proc_chance', 'slow_effect_pct',
  'chilled_damage_pct', 'chain_bounce_count', 'meteor_damage_pct', 'mana_shield_pct',
  'ability_echo_chance', 'mana_on_kill_pct', 'buff_duration_pct',
] as const;

export type TalentStat = typeof TALENT_STATS[number];

export type TalentBehavior =
  | 'relentless' | 'retaliation' | 'juggernaut' | 'archivist'
  | 'quartermaster' | 'archmage' | 'battery';

export const TALENT_BEHAVIOR_CONSUMERS: Record<TalentBehavior, string> = {
  relentless:    'Game.simulate (shot cadence) → ProjectileManager.fire({ variants })',
  retaliation:   'Game hostile-shot resolution → EnemyManager.damage (thorns)',
  juggernaut:    'Game.damageTower (wall check) + wall-break handler',
  archivist:     'TalentManager.respecCost → 0',
  quartermaster: 'AutomationManager.runAutoBuy (ability upgrades + gold reserve)',
  archmage:      'Game ability_cast handler → BuffRegistry (fireRate)',
  battery:       'stats/contributors/talents (reads ctx.manaFraction)',
};

export const TALENT_TUNING = {
  focusMaxStacks: 5,
  bloodlustMaxStacks: 8,
  bloodlustSeconds: 4,
  overwatchRangeFraction: 0.7,
  critFollowUpDamage: 0.6,
  secondWindThreshold: 0.35,
  secondWindDamageRatio: 2.5,
  secondWindSeconds: 6,
  lowHpThreshold: 0.5,
  windfallInterval: 10,
  windfallEquipmentThreshold: 8,
  interestCapBase: 2000,
  relentlessShotInterval: 5,
  relentlessShots: 3,
  relentlessDamage: 0.65,
  juggernautDamageReduction: 0.30,
  juggernautImmunitySeconds: 4,
  archmageFireRateBonus: 0.20,
  archmageBuffSeconds: 5,
  batteryManaThreshold: 0.8,
  batteryDamageBonus: 0.30,
  quartermasterGoldReserve: 0.4,
  prospectorDriftPerPoint: 1.67,
} as const;

export interface TalentEffectType {
  stat: TalentStat;
  perPoint: number;
}

export interface TalentDef {
  id: string;
  name: string;
  description: string;
  branch: TalentBranch;
  row: number;
  col: number;
  maxPoints: number;
  requiresBranchPoints: number;
  prerequisites: string[];
  effects: TalentEffectType[];
  behavior?: TalentBehavior;
  exclusiveGroup?: string;
  endless?: true;
  icon: IconId;
  color: string;
}

// ── Talent data ──────────────────────────────────────────────────────────────

export const TALENTS: TalentDef[] = [
  // ══════════════════════════════════════════════════════════════════════════
  //  Wrath (offense)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'wr_edge',
    name: 'Honed Edge',
    description: '+6% base damage per point',
    branch: 'offense',
    row: 1, col: 2,
    maxPoints: 5,
    requiresBranchPoints: 0,
    prerequisites: [],
    effects: [{ stat: 'base_damage_pct', perPoint: 0.06 }],
    icon: 'crossed-swords',
    color: '#d9534f',
  },
  {
    id: 'wr_cadence',
    name: 'Cadence',
    description: '+4% fire rate per point',
    branch: 'offense',
    row: 1, col: 4,
    maxPoints: 5,
    requiresBranchPoints: 0,
    prerequisites: [],
    effects: [{ stat: 'fire_rate_pct', perPoint: 0.04 }],
    icon: 'supersonic-arrow',
    color: '#d9534f',
  },
  {
    id: 'wr_precision',
    name: 'Precision',
    description: '+3% crit chance per point',
    branch: 'offense',
    row: 2, col: 1,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['wr_edge'],
    effects: [{ stat: 'crit_chance_pct', perPoint: 0.03 }],
    icon: 'crosshair-arrow',
    color: '#d9534f',
  },
  {
    id: 'wr_cruelty',
    name: 'Cruelty',
    description: '+15% crit damage per point',
    branch: 'offense',
    row: 2, col: 2,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['wr_edge'],
    effects: [{ stat: 'crit_damage_pct', perPoint: 0.15 }],
    icon: 'deadly-strike',
    color: '#d9534f',
  },
  {
    id: 'wr_focus_fire',
    name: 'Focus Fire',
    description: '+4% focus stack bonus per point',
    branch: 'offense',
    row: 2, col: 4,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['wr_cadence'],
    effects: [{ stat: 'focus_stack_pct', perPoint: 0.04 }],
    icon: 'eye-target',
    color: '#d9534f',
  },
  {
    id: 'wr_volley',
    name: 'Volley',
    description: '+4% extra projectile chance per point',
    branch: 'offense',
    row: 2, col: 5,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['wr_cadence'],
    effects: [{ stat: 'extra_projectile_chance', perPoint: 0.04 }],
    icon: 'missile-swarm',
    color: '#d9534f',
  },
  {
    id: 'wr_executioner',
    name: 'Executioner',
    description: '+12% execution damage per point',
    branch: 'offense',
    row: 3, col: 1,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['wr_precision', 'wr_cruelty'],
    effects: [{ stat: 'execution_damage_pct', perPoint: 0.12 }],
    icon: 'executioner-hood',
    color: '#d9534f',
  },
  {
    id: 'wr_bloodlust',
    name: 'Bloodlust',
    description: '+1.5% kill frenzy per point',
    branch: 'offense',
    row: 3, col: 3,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['wr_cruelty', 'wr_focus_fire'],
    effects: [{ stat: 'kill_frenzy_pct', perPoint: 0.015 }],
    icon: 'enrage',
    color: '#d9534f',
  },
  {
    id: 'wr_overwatch',
    name: 'Overwatch',
    description: '+10% range, +8% overwatch damage per point',
    branch: 'offense',
    row: 3, col: 5,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['wr_focus_fire', 'wr_volley'],
    effects: [
      { stat: 'range_pct', perPoint: 0.10 },
      { stat: 'overwatch_damage_pct', perPoint: 0.08 },
    ],
    icon: 'telescope',
    color: '#d9534f',
  },
  {
    id: 'wr_siegebreaker',
    name: 'Siegebreaker',
    description: '+8% armor penetration, +12% boss damage per point',
    branch: 'offense',
    row: 4, col: 2,
    maxPoints: 4,
    requiresBranchPoints: 22,
    prerequisites: ['wr_executioner', 'wr_bloodlust'],
    effects: [
      { stat: 'armor_penetration_pct', perPoint: 0.08 },
      { stat: 'boss_damage_pct', perPoint: 0.12 },
    ],
    icon: 'armor-punch',
    color: '#d9534f',
  },
  {
    id: 'wr_killing_spree',
    name: 'Killing Spree',
    description: '+10% crit follow-up chance per point',
    branch: 'offense',
    row: 4, col: 4,
    maxPoints: 4,
    requiresBranchPoints: 22,
    prerequisites: ['wr_bloodlust', 'wr_overwatch'],
    effects: [{ stat: 'crit_followup_chance', perPoint: 0.10 }],
    icon: 'striking-arrows',
    color: '#d9534f',
  },
  {
    id: 'wr_key_annihilation',
    name: 'Annihilation',
    description: '+70% base damage, -25% fire rate, +55 splash radius, +45% splash fraction',
    branch: 'offense',
    row: 5, col: 1,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['wr_siegebreaker'],
    effects: [
      { stat: 'base_damage_pct', perPoint: 0.70 },
      { stat: 'fire_rate_pct', perPoint: -0.25 },
      { stat: 'shot_splash_radius', perPoint: 55 },
      { stat: 'shot_splash_fraction', perPoint: 0.45 },
    ],
    exclusiveGroup: 'offense_keystone',
    icon: 'bright-explosion',
    color: '#d9534f',
  },
  {
    id: 'wr_key_deadeye',
    name: 'Deadeye',
    description: '+15% crit chance, +150% crit damage, -20% base damage',
    branch: 'offense',
    row: 5, col: 3,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['wr_siegebreaker', 'wr_killing_spree'],
    effects: [
      { stat: 'crit_chance_pct', perPoint: 0.15 },
      { stat: 'crit_damage_pct', perPoint: 1.50 },
      { stat: 'base_damage_pct', perPoint: -0.20 },
    ],
    exclusiveGroup: 'offense_keystone',
    icon: 'dead-eye',
    color: '#d9534f',
  },
  {
    id: 'wr_key_relentless',
    name: 'Relentless',
    description: 'Every 5th shot fires 3 projectiles at 65% damage',
    branch: 'offense',
    row: 5, col: 5,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['wr_killing_spree'],
    effects: [],
    behavior: 'relentless',
    exclusiveGroup: 'offense_keystone',
    icon: 'pentarrows-tornado',
    color: '#d9534f',
  },
  {
    id: 'wr_endless_fury',
    name: 'Fury',
    description: '+0.5% all damage per point (endless)',
    branch: 'offense',
    row: 6, col: 3,
    maxPoints: 999,
    requiresBranchPoints: 10,
    prerequisites: [],
    effects: [{ stat: 'all_damage_pct', perPoint: 0.005 }],
    endless: true,
    icon: 'over-infinity',
    color: '#d9534f',
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  Bulwark (defense)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'bw_toughness',
    name: 'Toughness',
    description: '+6% max HP per point',
    branch: 'defense',
    row: 1, col: 2,
    maxPoints: 5,
    requiresBranchPoints: 0,
    prerequisites: [],
    effects: [{ stat: 'max_hp_pct', perPoint: 0.06 }],
    icon: 'armor-vest',
    color: '#4ec97a',
  },
  {
    id: 'bw_plating',
    name: 'Plating',
    description: '+5% defense per point',
    branch: 'defense',
    row: 1, col: 4,
    maxPoints: 5,
    requiresBranchPoints: 0,
    prerequisites: [],
    effects: [{ stat: 'defense_pct', perPoint: 0.05 }],
    icon: 'layered-armor',
    color: '#4ec97a',
  },
  {
    id: 'bw_evasion',
    name: 'Evasion',
    description: '+3% dodge chance per point',
    branch: 'defense',
    row: 2, col: 1,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['bw_toughness'],
    effects: [{ stat: 'dodge_chance', perPoint: 0.03 }],
    icon: 'acrobatic',
    color: '#4ec97a',
  },
  {
    id: 'bw_thornmail',
    name: 'Thornmail',
    description: '+12% thorns damage per point',
    branch: 'defense',
    row: 2, col: 2,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['bw_toughness'],
    effects: [{ stat: 'thorns_pct', perPoint: 0.12 }],
    icon: 'spiked-armor',
    color: '#4ec97a',
  },
  {
    id: 'bw_ramparts',
    name: 'Ramparts',
    description: '+15% wall regen, +12% wall contact per point',
    branch: 'defense',
    row: 2, col: 4,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['bw_plating'],
    effects: [
      { stat: 'wall_regen_pct', perPoint: 0.15 },
      { stat: 'wall_contact_pct', perPoint: 0.12 },
    ],
    icon: 'brick-wall',
    color: '#4ec97a',
  },
  {
    id: 'bw_regrowth',
    name: 'Regrowth',
    description: '+8% health regen per point',
    branch: 'defense',
    row: 2, col: 5,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['bw_plating'],
    effects: [{ stat: 'health_regen_pct', perPoint: 0.08 }],
    icon: 'regeneration',
    color: '#4ec97a',
  },
  {
    id: 'bw_aegis',
    name: 'Aegis',
    description: '+1 shield charge, +12% shield recharge per point',
    branch: 'defense',
    row: 3, col: 1,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['bw_evasion', 'bw_thornmail'],
    effects: [
      { stat: 'shield_charges', perPoint: 1 },
      { stat: 'shield_recharge_pct', perPoint: 0.12 },
    ],
    icon: 'energy-shield',
    color: '#4ec97a',
  },
  {
    id: 'bw_second_wind',
    name: 'Second Wind',
    description: '+6% second wind power per point',
    branch: 'defense',
    row: 3, col: 3,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['bw_thornmail', 'bw_ramparts'],
    effects: [{ stat: 'second_wind_pct', perPoint: 0.06 }],
    icon: 'shining-heart',
    color: '#4ec97a',
  },
  {
    id: 'bw_bastion',
    name: 'Bastion',
    description: '+25% knockback force per point',
    branch: 'defense',
    row: 3, col: 5,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['bw_ramparts', 'bw_regrowth'],
    effects: [{ stat: 'knockback_pct', perPoint: 0.25 }],
    icon: 'stone-wall',
    color: '#4ec97a',
  },
  {
    id: 'bw_ironhide',
    name: 'Ironhide',
    description: '+10% armor, +6% max HP per point',
    branch: 'defense',
    row: 4, col: 2,
    maxPoints: 4,
    requiresBranchPoints: 22,
    prerequisites: ['bw_aegis', 'bw_second_wind'],
    effects: [
      { stat: 'armor_pct', perPoint: 0.10 },
      { stat: 'max_hp_pct', perPoint: 0.06 },
    ],
    icon: 'metal-plate',
    color: '#4ec97a',
  },
  {
    id: 'bw_vengeance',
    name: 'Vengeance',
    description: '+15% thorns, +10% low HP damage per point',
    branch: 'defense',
    row: 4, col: 4,
    maxPoints: 4,
    requiresBranchPoints: 22,
    prerequisites: ['bw_second_wind', 'bw_bastion'],
    effects: [
      { stat: 'thorns_pct', perPoint: 0.15 },
      { stat: 'low_hp_damage_pct', perPoint: 0.10 },
    ],
    icon: 'spiked-halo',
    color: '#4ec97a',
  },
  {
    id: 'bw_key_fortress',
    name: 'Fortress',
    description: '+45% max HP, +30% defense, -15% range',
    branch: 'defense',
    row: 5, col: 1,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['bw_ironhide'],
    effects: [
      { stat: 'max_hp_pct', perPoint: 0.45 },
      { stat: 'defense_pct', perPoint: 0.30 },
      { stat: 'range_pct', perPoint: -0.15 },
    ],
    exclusiveGroup: 'defense_keystone',
    icon: 'locked-fortress',
    color: '#4ec97a',
  },
  {
    id: 'bw_key_retaliation',
    name: 'Retaliation',
    description: '+200% thorns damage; thorns hit all nearby enemies',
    branch: 'defense',
    row: 5, col: 3,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['bw_ironhide', 'bw_vengeance'],
    effects: [{ stat: 'thorns_pct', perPoint: 2.00 }],
    behavior: 'retaliation',
    exclusiveGroup: 'defense_keystone',
    icon: 'armored-boomerang',
    color: '#4ec97a',
  },
  {
    id: 'bw_key_juggernaut',
    name: 'Juggernaut',
    description: '30% damage reduction; immune for 4s after wall breaks',
    branch: 'defense',
    row: 5, col: 5,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['bw_vengeance'],
    effects: [],
    behavior: 'juggernaut',
    exclusiveGroup: 'defense_keystone',
    icon: 'rock-golem',
    color: '#4ec97a',
  },
  {
    id: 'bw_endless_resolve',
    name: 'Resolve',
    description: '+0.6% max HP, +0.3% defense per point (endless)',
    branch: 'defense',
    row: 6, col: 3,
    maxPoints: 999,
    requiresBranchPoints: 10,
    prerequisites: [],
    effects: [
      { stat: 'max_hp_pct', perPoint: 0.006 },
      { stat: 'defense_pct', perPoint: 0.003 },
    ],
    endless: true,
    icon: 'over-infinity',
    color: '#4ec97a',
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  Fortune (utility)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'ft_greed',
    name: 'Greed',
    description: '+8% gold per point',
    branch: 'utility',
    row: 1, col: 2,
    maxPoints: 5,
    requiresBranchPoints: 0,
    prerequisites: [],
    effects: [{ stat: 'gold_mult_pct', perPoint: 0.08 }],
    icon: 'shiny-purse',
    color: '#f0b23c',
  },
  {
    id: 'ft_insight',
    name: 'Insight',
    description: '+6% XP gain per point',
    branch: 'utility',
    row: 1, col: 4,
    maxPoints: 5,
    requiresBranchPoints: 0,
    prerequisites: [],
    effects: [{ stat: 'xp_gain_pct', perPoint: 0.06 }],
    icon: 'wisdom',
    color: '#f0b23c',
  },
  {
    id: 'ft_scavenge',
    name: 'Scavenge',
    description: '+5% double gold chance per point',
    branch: 'utility',
    row: 2, col: 1,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['ft_greed'],
    effects: [{ stat: 'double_gold_chance', perPoint: 0.05 }],
    icon: 'knapsack',
    color: '#f0b23c',
  },
  {
    id: 'ft_head_start',
    name: 'Head Start',
    description: '+2 starting waves per point',
    branch: 'utility',
    row: 2, col: 2,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['ft_greed'],
    effects: [{ stat: 'head_start_waves', perPoint: 2 }],
    icon: 'checkered-flag',
    color: '#f0b23c',
  },
  {
    id: 'ft_lucky_finds',
    name: 'Lucky Finds',
    description: '+6% equipment find chance per point',
    branch: 'utility',
    row: 2, col: 4,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['ft_insight'],
    effects: [{ stat: 'equipment_find_chance', perPoint: 0.06 }],
    icon: 'clover',
    color: '#f0b23c',
  },
  {
    id: 'ft_thrift',
    name: 'Thrift',
    description: '-3% upgrade cost per point',
    branch: 'utility',
    row: 2, col: 5,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['ft_insight'],
    effects: [{ stat: 'upgrade_cost_reduction', perPoint: 0.03 }],
    icon: 'cog',
    color: '#f0b23c',
  },
  {
    id: 'ft_prospector',
    name: 'Prospector',
    description: '+12% orb value per point',
    branch: 'utility',
    row: 3, col: 1,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['ft_scavenge', 'ft_head_start'],
    effects: [{ stat: 'orb_value_pct', perPoint: 0.12 }],
    icon: 'magnet',
    color: '#f0b23c',
  },
  {
    id: 'ft_tempo',
    name: 'Tempo',
    description: '+40% momentum gain per point',
    branch: 'utility',
    row: 3, col: 3,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['ft_head_start', 'ft_lucky_finds'],
    effects: [{ stat: 'momentum_gain_pct', perPoint: 0.40 }],
    icon: 'fast-forward-button',
    color: '#f0b23c',
  },
  {
    id: 'ft_autonomy',
    name: 'Autonomy',
    description: '+7% auto-buy speed per point',
    branch: 'utility',
    row: 3, col: 5,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['ft_lucky_finds', 'ft_thrift'],
    effects: [{ stat: 'auto_buy_speed_pct', perPoint: 0.07 }],
    icon: 'vintage-robot',
    color: '#f0b23c',
  },
  {
    id: 'ft_windfall',
    name: 'Windfall',
    description: '+2.0x windfall multiplier per point',
    branch: 'utility',
    row: 4, col: 2,
    maxPoints: 4,
    requiresBranchPoints: 22,
    prerequisites: ['ft_prospector', 'ft_tempo'],
    effects: [{ stat: 'windfall_mult', perPoint: 2.0 }],
    icon: 'open-treasure-chest',
    color: '#f0b23c',
  },
  {
    id: 'ft_interest',
    name: 'Interest',
    description: '+0.5% interest per point',
    branch: 'utility',
    row: 4, col: 4,
    maxPoints: 4,
    requiresBranchPoints: 22,
    prerequisites: ['ft_tempo', 'ft_autonomy'],
    effects: [{ stat: 'interest_pct', perPoint: 0.005 }],
    icon: 'gold-mine',
    color: '#f0b23c',
  },
  {
    id: 'ft_key_midas',
    name: 'Midas Touch',
    description: '+60% gold, +12% enemy HP',
    branch: 'utility',
    row: 5, col: 1,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['ft_windfall'],
    effects: [
      { stat: 'gold_mult_pct', perPoint: 0.60 },
      { stat: 'enemy_hp_pct', perPoint: 0.12 },
    ],
    exclusiveGroup: 'utility_keystone',
    icon: 'crown-coin',
    color: '#f0b23c',
  },
  {
    id: 'ft_key_archivist',
    name: 'Archivist',
    description: '+60% XP gain; respec costs nothing',
    branch: 'utility',
    row: 5, col: 3,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['ft_windfall', 'ft_interest'],
    effects: [{ stat: 'xp_gain_pct', perPoint: 0.60 }],
    behavior: 'archivist',
    exclusiveGroup: 'utility_keystone',
    icon: 'book-pile',
    color: '#f0b23c',
  },
  {
    id: 'ft_key_quartermaster',
    name: 'Quartermaster',
    description: '-15% upgrade cost; auto-buy reserves 40% gold',
    branch: 'utility',
    row: 5, col: 5,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['ft_interest'],
    effects: [{ stat: 'upgrade_cost_reduction', perPoint: 0.15 }],
    behavior: 'quartermaster',
    exclusiveGroup: 'utility_keystone',
    icon: 'gears',
    color: '#f0b23c',
  },
  {
    id: 'ft_endless_avarice',
    name: 'Avarice',
    description: '+0.4% gold, +0.25% XP per point (endless)',
    branch: 'utility',
    row: 6, col: 3,
    maxPoints: 999,
    requiresBranchPoints: 10,
    prerequisites: [],
    effects: [
      { stat: 'gold_mult_pct', perPoint: 0.004 },
      { stat: 'xp_gain_pct', perPoint: 0.0025 },
    ],
    endless: true,
    icon: 'over-infinity',
    color: '#f0b23c',
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  Arcana (magic)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'ar_power',
    name: 'Arcane Power',
    description: '+7% ability damage per point',
    branch: 'magic',
    row: 1, col: 2,
    maxPoints: 5,
    requiresBranchPoints: 0,
    prerequisites: [],
    effects: [{ stat: 'ability_damage_pct', perPoint: 0.07 }],
    icon: 'bolt-spell-cast',
    color: '#a95cff',
  },
  {
    id: 'ar_thrift',
    name: 'Mana Thrift',
    description: '-4% mana cost per point',
    branch: 'magic',
    row: 1, col: 4,
    maxPoints: 5,
    requiresBranchPoints: 0,
    prerequisites: [],
    effects: [{ stat: 'mana_cost_reduction', perPoint: 0.04 }],
    icon: 'vial',
    color: '#a95cff',
  },
  {
    id: 'ar_flow',
    name: 'Mana Flow',
    description: '+7% mana regen per point',
    branch: 'magic',
    row: 2, col: 1,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['ar_power'],
    effects: [{ stat: 'mana_regen_pct', perPoint: 0.07 }],
    icon: 'droplets',
    color: '#a95cff',
  },
  {
    id: 'ar_reservoir',
    name: 'Reservoir',
    description: '+20 max mana per point',
    branch: 'magic',
    row: 2, col: 2,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['ar_power'],
    effects: [{ stat: 'max_mana_flat', perPoint: 20 }],
    icon: 'energy-tank',
    color: '#a95cff',
  },
  {
    id: 'ar_enchanted',
    name: 'Enchanted Shots',
    description: '+6% magic proc chance per point',
    branch: 'magic',
    row: 2, col: 4,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['ar_thrift'],
    effects: [{ stat: 'magic_proc_chance', perPoint: 0.06 }],
    icon: 'rune-sword',
    color: '#a95cff',
  },
  {
    id: 'ar_attunement',
    name: 'Attunement',
    description: '-7% ability cooldown per point',
    branch: 'magic',
    row: 2, col: 5,
    maxPoints: 3,
    requiresBranchPoints: 4,
    prerequisites: ['ar_thrift'],
    effects: [{ stat: 'ability_cooldown_pct', perPoint: 0.07 }],
    icon: 'hourglass',
    color: '#a95cff',
  },
  {
    id: 'ar_frostbite',
    name: 'Frostbite',
    description: '+8% slow effect, +7% chilled damage per point',
    branch: 'magic',
    row: 3, col: 1,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['ar_flow', 'ar_reservoir'],
    effects: [
      { stat: 'slow_effect_pct', perPoint: 0.08 },
      { stat: 'chilled_damage_pct', perPoint: 0.07 },
    ],
    icon: 'snowflake-1',
    color: '#a95cff',
  },
  {
    id: 'ar_conduit',
    name: 'Conduit',
    description: '+1 chain bounce, +8% meteor damage per point',
    branch: 'magic',
    row: 3, col: 3,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['ar_reservoir', 'ar_enchanted'],
    effects: [
      { stat: 'chain_bounce_count', perPoint: 1 },
      { stat: 'meteor_damage_pct', perPoint: 0.08 },
    ],
    icon: 'lightning-branches',
    color: '#a95cff',
  },
  {
    id: 'ar_ward',
    name: 'Mana Ward',
    description: '+6% mana shield per point',
    branch: 'magic',
    row: 3, col: 5,
    maxPoints: 3,
    requiresBranchPoints: 12,
    prerequisites: ['ar_enchanted', 'ar_attunement'],
    effects: [{ stat: 'mana_shield_pct', perPoint: 6 }],
    icon: 'magic-shield',
    color: '#a95cff',
  },
  {
    id: 'ar_echo',
    name: 'Spell Echo',
    description: '+8% ability echo chance per point',
    branch: 'magic',
    row: 4, col: 2,
    maxPoints: 4,
    requiresBranchPoints: 22,
    prerequisites: ['ar_frostbite', 'ar_conduit'],
    effects: [{ stat: 'ability_echo_chance', perPoint: 0.08 }],
    icon: 'echo-ripples',
    color: '#a95cff',
  },
  {
    id: 'ar_harvest',
    name: 'Soul Harvest',
    description: '+0.3% mana on kill, +8% buff duration per point',
    branch: 'magic',
    row: 4, col: 4,
    maxPoints: 4,
    requiresBranchPoints: 22,
    prerequisites: ['ar_conduit', 'ar_ward'],
    effects: [
      { stat: 'mana_on_kill_pct', perPoint: 0.003 },
      { stat: 'buff_duration_pct', perPoint: 0.08 },
    ],
    icon: 'chalice-drops',
    color: '#a95cff',
  },
  {
    id: 'ar_key_archmage',
    name: 'Archmage',
    description: '+60% ability damage; casting grants +20% fire rate for 5s',
    branch: 'magic',
    row: 5, col: 1,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['ar_echo'],
    effects: [{ stat: 'ability_damage_pct', perPoint: 0.60 }],
    behavior: 'archmage',
    exclusiveGroup: 'magic_keystone',
    icon: 'wizard-face',
    color: '#a95cff',
  },
  {
    id: 'ar_key_overcharge',
    name: 'Overcharge',
    description: '+130% ability damage, -60% mana cost reduction',
    branch: 'magic',
    row: 5, col: 3,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['ar_echo', 'ar_harvest'],
    effects: [
      { stat: 'ability_damage_pct', perPoint: 1.30 },
      { stat: 'mana_cost_reduction', perPoint: -0.60 },
    ],
    exclusiveGroup: 'magic_keystone',
    icon: 'lightning-trio',
    color: '#a95cff',
  },
  {
    id: 'ar_key_battery',
    name: 'Battery',
    description: '+50% max mana; above 80% mana, +30% damage',
    branch: 'magic',
    row: 5, col: 5,
    maxPoints: 1,
    requiresBranchPoints: 32,
    prerequisites: ['ar_harvest'],
    effects: [{ stat: 'max_mana_pct', perPoint: 0.50 }],
    behavior: 'battery',
    exclusiveGroup: 'magic_keystone',
    icon: 'energy-tank',
    color: '#a95cff',
  },
  {
    id: 'ar_endless_ascendance',
    name: 'Ascendance',
    description: '+0.5% ability damage, +0.3% mana regen per point (endless)',
    branch: 'magic',
    row: 6, col: 3,
    maxPoints: 999,
    requiresBranchPoints: 10,
    prerequisites: [],
    effects: [
      { stat: 'ability_damage_pct', perPoint: 0.005 },
      { stat: 'mana_regen_pct', perPoint: 0.003 },
    ],
    endless: true,
    icon: 'over-infinity',
    color: '#a95cff',
  },
];

// ── Derived exports ──────────────────────────────────────────────────────────

export type TalentId = typeof TALENTS[number]['id'];

export const TALENT_BY_ID: Record<string, TalentDef> = Object.fromEntries(
  TALENTS.map(t => [t.id, t]),
);

export const TALENTS_BY_BRANCH: Record<TalentBranch, TalentDef[]> = {
  offense: TALENTS.filter(t => t.branch === 'offense'),
  defense: TALENTS.filter(t => t.branch === 'defense'),
  utility: TALENTS.filter(t => t.branch === 'utility'),
  magic: TALENTS.filter(t => t.branch === 'magic'),
};

/** Rows 1-5 of a branch, in (row, col) order — what the grid renders. */
export const TALENT_GRID: Record<TalentBranch, TalentDef[]> = Object.fromEntries(
  (['offense', 'defense', 'utility', 'magic'] as TalentBranch[]).map(b => [
    b,
    TALENTS_BY_BRANCH[b].filter(t => !t.endless).sort((a, b) => a.row - b.row || a.col - b.col),
  ]),
) as Record<TalentBranch, TalentDef[]>;

/** The one endless node per branch. */
export const TALENT_ENDLESS: Record<TalentBranch, TalentDef> = Object.fromEntries(
  (['offense', 'defense', 'utility', 'magic'] as TalentBranch[]).map(b => [
    b,
    TALENTS_BY_BRANCH[b].find(t => t.endless)!,
  ]),
) as Record<TalentBranch, TalentDef>;

// ── Respec cost ──────────────────────────────────────────────────────────────

export const TALENT_RESPEC_BASE = 250;
export const TALENT_RESPEC_EXPONENT = 1.35;

export function talentRespecCost(points: number): number {
  const p = Math.max(0, Math.floor(points));
  if (p <= 0) return 0;
  return Math.floor(TALENT_RESPEC_BASE * Math.pow(p, TALENT_RESPEC_EXPONENT));
}

// ── Display helpers ──────────────────────────────────────────────────────────

/** Short noun for each stat, used by `formatTalentEffectLine` and `describeTalentEffects`. */
export const TALENT_STAT_LABELS: Record<TalentStat, string> = {
  // ── Wrath ──
  base_damage_pct: 'base damage',
  all_damage_pct: 'all damage',
  fire_rate_pct: 'fire rate',
  crit_chance_pct: 'crit chance',
  crit_damage_pct: 'crit damage',
  range_pct: 'range',
  armor_penetration_pct: 'armor penetration',
  execution_damage_pct: 'execution damage',
  extra_projectile_chance: 'extra projectile chance',
  focus_stack_pct: 'focus stack bonus',
  kill_frenzy_pct: 'kill frenzy',
  overwatch_damage_pct: 'overwatch damage',
  boss_damage_pct: 'boss damage',
  crit_followup_chance: 'crit follow-up chance',
  shot_splash_radius: 'splash radius',
  shot_splash_fraction: 'splash damage',
  // ── Bulwark ──
  max_hp_pct: 'max HP',
  defense_pct: 'defense',
  armor_pct: 'armor',
  thorns_pct: 'thorns damage',
  dodge_chance: 'dodge chance',
  wall_regen_pct: 'wall regen',
  wall_contact_pct: 'wall damage',
  shield_charges: 'shield charges',
  shield_recharge_pct: 'shield recharge',
  health_regen_pct: 'health regen',
  knockback_pct: 'knockback',
  second_wind_pct: 'second wind damage',
  low_hp_damage_pct: 'low HP damage',
  // ── Fortune ──
  gold_mult_pct: 'gold earned',
  xp_gain_pct: 'XP gain',
  double_gold_chance: 'double gold chance',
  head_start_waves: 'head start waves',
  equipment_find_chance: 'equipment find chance',
  upgrade_cost_reduction: 'upgrade cost',
  orb_value_pct: 'loot orb value',
  momentum_gain_pct: 'momentum gain',
  auto_buy_speed_pct: 'auto-buy speed',
  windfall_mult: 'windfall bonus',
  interest_pct: 'interest',
  enemy_hp_pct: 'enemy HP',
  // ── Arcana ──
  ability_damage_pct: 'ability damage',
  mana_cost_reduction: 'ability mana cost',
  ability_cooldown_pct: 'ability cooldown',
  mana_regen_pct: 'mana regen',
  max_mana_flat: 'max mana',
  max_mana_pct: 'max mana',
  magic_proc_chance: 'magic proc chance',
  slow_effect_pct: 'slow effect',
  chilled_damage_pct: 'damage vs chilled',
  chain_bounce_count: 'chain bounces',
  meteor_damage_pct: 'meteor damage',
  mana_shield_pct: 'mana shield',
  ability_echo_chance: 'ability echo chance',
  mana_on_kill_pct: 'mana per kill',
  buff_duration_pct: 'buff duration',
};

/** Format a single stat value as a signed number (+30%, +5, −2.5). */
export function formatTalentEffectValue(stat: TalentStat, value: number): string {
  const isPercent = stat.endsWith('_pct')
    || stat.includes('chance')
    || stat.includes('fraction')
    || stat === 'mana_cost_reduction'
    || stat === 'upgrade_cost_reduction';

  let display: number;
  let suffix: string;
  if (isPercent) {
    display = Math.abs(value) < 1 ? value * 100 : value;
    suffix = '%';
  } else {
    display = value;
    suffix = '';
  }

  const sign = display > 0 ? '+' : display < 0 ? '\u2212' : '';
  const abs = Math.abs(display);
  const formatted = abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1);
  return sign + formatted + suffix;
}

/** "+30% base damage" — one resolved effect line, label included. */
export function formatTalentEffectLine(stat: TalentStat, value: number): string {
  return `${formatTalentEffectValue(stat, value)} ${TALENT_STAT_LABELS[stat]}`;
}

/** Live effect lines for a talent at `points`, one string per defined effect. */
export function describeTalentEffects(def: TalentDef, points: number): string[] {
  const lines: string[] = [];
  for (const eff of def.effects) {
    const v = eff.perPoint * points;
    if (v === 0) continue;
    lines.push(formatTalentEffectLine(eff.stat, v));
  }
  return lines;
}
