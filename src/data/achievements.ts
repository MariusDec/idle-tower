export type AchievementCategory = 'combat' | 'wave' | 'economy' | 'prestige' | 'mastery';

export type AchievementRewardType =
  | 'damage_mult'
  | 'fire_rate_mult'
  | 'gold_mult'
  | 'boss_gold_mult'
  | 'start_gold'
  | 'all_damage'
  | 'extra_projectile'
  | 'ap_gain_mult'
  | 'rp_gain_mult'
  | 'tp_gain_mult'
  | 'prestige_gain_mult'
  | 'ability_cdr'
  | 'max_hp_mult'
  | 'all_stats'
  | 'upgrade_cost_reduction';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  stat: string;
  threshold: number;
  reward: {
    type: AchievementRewardType;
    value: number;
    description: string;
  };
  glyph: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── Combat ──
  {
    id: 'ach_first_blood',
    name: 'First Blood',
    description: 'Kill 100 enemies',
    category: 'combat',
    stat: 'enemiesKilled',
    threshold: 100,
    reward: { type: 'damage_mult', value: 0.05, description: '+5% damage' },
    glyph: '🗡',
  },
  {
    id: 'ach_centurion',
    name: 'Centurion',
    description: 'Kill 10,000 enemies',
    category: 'combat',
    stat: 'enemiesKilled',
    threshold: 10000,
    reward: { type: 'damage_mult', value: 0.10, description: '+10% damage' },
    glyph: '⚔',
  },
  {
    id: 'ach_boss_slayer',
    name: 'Boss Slayer',
    description: 'Kill 10 bosses',
    category: 'combat',
    stat: 'bossesKilled',
    threshold: 10,
    reward: { type: 'boss_gold_mult', value: 0.20, description: '+20% boss gold' },
    glyph: '💀',
  },
  {
    id: 'ach_sharpshooter',
    name: 'Sharpshooter',
    description: 'Fire 50,000 shots',
    category: 'combat',
    stat: 'shotsFired',
    threshold: 50000,
    reward: { type: 'fire_rate_mult', value: 0.10, description: '+10% fire rate' },
    glyph: '🎯',
  },

  // ── Wave ──
  {
    id: 'ach_survivor',
    name: 'Survivor',
    description: 'Reach wave 50',
    category: 'wave',
    stat: 'lifetimeHighestWave',
    threshold: 50,
    reward: { type: 'start_gold', value: 100, description: '+100 starting gold' },
    glyph: '🛡',
  },
  {
    id: 'ach_veteran',
    name: 'Veteran',
    description: 'Reach wave 100',
    category: 'wave',
    stat: 'lifetimeHighestWave',
    threshold: 100,
    reward: { type: 'all_damage', value: 0.05, description: '+5% all damage' },
    glyph: '⭐',
  },
  {
    id: 'ach_legend',
    name: 'Legend',
    description: 'Reach wave 250',
    category: 'wave',
    stat: 'lifetimeHighestWave',
    threshold: 250,
    reward: { type: 'extra_projectile', value: 1, description: '+1 extra projectile' },
    glyph: '👑',
  },
  {
    id: 'ach_unstoppable',
    name: 'Unstoppable',
    description: 'Reach wave 500',
    category: 'wave',
    stat: 'lifetimeHighestWave',
    threshold: 500,
    reward: { type: 'ap_gain_mult', value: 0.25, description: '+25% AP gain' },
    glyph: '🏆',
  },

  // ── Economy ──
  {
    id: 'ach_coin_collector',
    name: 'Coin Collector',
    description: 'Earn 100,000 lifetime gold',
    category: 'economy',
    stat: 'goldEarned',
    threshold: 100000,
    reward: { type: 'gold_mult', value: 0.10, description: '+10% gold' },
    glyph: '🪙',
  },
  {
    id: 'ach_tycoon',
    name: 'Tycoon',
    description: 'Earn 10,000,000 lifetime gold',
    category: 'economy',
    stat: 'goldEarned',
    threshold: 10000000,
    reward: { type: 'gold_mult', value: 0.20, description: '+20% gold' },
    glyph: '💎',
  },
  {
    id: 'ach_investor',
    name: 'Investor',
    description: 'Purchase 500 total upgrades',
    category: 'economy',
    stat: 'totalUpgradesPurchased',
    threshold: 500,
    reward: { type: 'upgrade_cost_reduction', value: 0.05, description: '-5% upgrade costs' },
    glyph: '📈',
  },

  // ── Prestige ──
  {
    id: 'ach_reborn',
    name: 'Reborn',
    description: 'Ascend 10 times',
    category: 'prestige',
    stat: 'lifetimeAscensions',
    threshold: 10,
    reward: { type: 'ap_gain_mult', value: 0.10, description: '+10% AP gain' },
    glyph: '🔄',
  },
  {
    id: 'ach_enlightened',
    name: 'Enlightened',
    description: 'Ascend 100 times',
    category: 'prestige',
    stat: 'lifetimeAscensions',
    threshold: 100,
    reward: { type: 'rp_gain_mult', value: 0.25, description: '+25% RP gain' },
    glyph: '✨',
  },
  {
    id: 'ach_transcendent',
    name: 'Transcendent',
    description: 'Transcend 5 times',
    category: 'prestige',
    stat: 'transcendences',
    threshold: 5,
    reward: { type: 'tp_gain_mult', value: 0.10, description: '+10% TP gain' },
    glyph: '🌟',
  },
  {
    id: 'ach_eternal',
    name: 'Eternal',
    description: 'Transcend 25 times',
    category: 'prestige',
    stat: 'transcendences',
    threshold: 25,
    reward: { type: 'prestige_gain_mult', value: 0.25, description: '+25% all prestige gains' },
    glyph: '∞',
  },

  // ── Mastery ──
  {
    id: 'ach_ability_master',
    name: 'Ability Master',
    description: 'Cast 500 abilities',
    category: 'mastery',
    stat: 'abilitiesCast',
    threshold: 500,
    reward: { type: 'ability_cdr', value: 0.10, description: '-10% ability cooldowns' },
    glyph: '🔮',
  },
  {
    id: 'ach_endurance',
    name: 'Endurance',
    description: 'Reach wave 50 in a single run',
    category: 'mastery',
    stat: 'lifetimeHighestWave',
    threshold: 50,
    reward: { type: 'max_hp_mult', value: 0.15, description: '+15% max HP' },
    glyph: '💪',
  },
  {
    id: 'ach_researcher',
    name: 'Scholar',
    description: 'Unlock all 8 research nodes',
    category: 'mastery',
    stat: 'researchCount',
    threshold: 8,
    reward: { type: 'rp_gain_mult', value: 0.50, description: '+50% RP gain' },
    glyph: '📚',
  },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = ACHIEVEMENTS.reduce(
  (acc, a) => {
    acc[a.id] = a;
    return acc;
  },
  {} as Record<string, AchievementDef>,
);
