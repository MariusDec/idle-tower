import type { IconId } from './icons';

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

/**
 * Where each reward type is actually consumed. The `Record` forces this map to
 * stay complete, so a new reward type cannot be added without deciding which
 * system reads it — nine reward types previously shipped with no consumer.
 */
export const ACHIEVEMENT_REWARD_CONSUMERS: Record<AchievementRewardType, string> = {
  damage_mult: 'stats/contributors/achievements → baseDamage',
  fire_rate_mult: 'stats/contributors/achievements → fireRate',
  gold_mult: 'stats/contributors/achievements → goldMultiplier',
  boss_gold_mult: 'Game enemy_killed handler (boss branch)',
  start_gold: 'Game.applySavedStateReset',
  all_damage: 'stats/contributors/achievements → baseDamage',
  extra_projectile: 'Game.buildShotVariants',
  ap_gain_mult: 'PrestigeManager.previewAP',
  rp_gain_mult: 'Game.rpGainMultiplier',
  tp_gain_mult: 'PrestigeManager.previewTP',
  prestige_gain_mult: 'PrestigeManager.previewAP + previewTP',
  ability_cdr: 'stats/contributors/achievements → abilityCooldownMultiplier',
  max_hp_mult: 'stats/contributors/achievements → maxHp',
  all_stats: 'stats/contributors/achievements → baseDamage, fireRate, goldMultiplier',
  upgrade_cost_reduction: 'stats/contributors/achievements → upgradeCostDiscount',
};

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
  icon: IconId;
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
    icon: 'bloody-sword',
  },
  {
    id: 'ach_centurion',
    name: 'Centurion',
    description: 'Kill 10,000 enemies',
    category: 'combat',
    stat: 'enemiesKilled',
    threshold: 10000,
    reward: { type: 'damage_mult', value: 0.10, description: '+10% damage' },
    icon: 'crossed-swords',
  },
  {
    id: 'ach_boss_slayer',
    name: 'Boss Slayer',
    description: 'Kill 5 bosses',
    category: 'combat',
    stat: 'bossesKilled',
    // Five boss *waves*, which is wave 50. This asked for ten back when a boss
    // wave spawned `2 + tier` bosses and wave 40 alone paid nine of them; one
    // boss per wave means the same threshold would have moved an early-game
    // achievement to wave 100.
    threshold: 5,
    reward: { type: 'boss_gold_mult', value: 0.20, description: '+20% boss gold' },
    icon: 'crowned-skull',
  },
  {
    id: 'ach_sharpshooter',
    name: 'Sharpshooter',
    description: 'Fire 50,000 shots',
    category: 'combat',
    stat: 'shotsFired',
    threshold: 50000,
    reward: { type: 'fire_rate_mult', value: 0.10, description: '+10% fire rate' },
    icon: 'bullseye',
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
    icon: 'shield',
  },
  {
    id: 'ach_veteran',
    name: 'Veteran',
    description: 'Reach wave 100',
    category: 'wave',
    stat: 'lifetimeHighestWave',
    threshold: 100,
    reward: { type: 'all_damage', value: 0.05, description: '+5% all damage' },
    icon: 'star-medal',
  },
  {
    id: 'ach_legend',
    name: 'Legend',
    description: 'Reach wave 250',
    category: 'wave',
    stat: 'lifetimeHighestWave',
    threshold: 250,
    reward: { type: 'extra_projectile', value: 1, description: '+1 extra projectile' },
    icon: 'crown',
  },
  {
    id: 'ach_unstoppable',
    name: 'Unstoppable',
    description: 'Reach wave 500',
    category: 'wave',
    stat: 'lifetimeHighestWave',
    threshold: 500,
    reward: { type: 'ap_gain_mult', value: 0.25, description: '+25% AP gain' },
    icon: 'trophy',
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
    icon: 'two-coins',
  },
  {
    id: 'ach_tycoon',
    name: 'Tycoon',
    description: 'Earn 10,000,000 lifetime gold',
    category: 'economy',
    stat: 'goldEarned',
    threshold: 10000000,
    reward: { type: 'gold_mult', value: 0.20, description: '+20% gold' },
    icon: 'gems',
  },
  {
    id: 'ach_investor',
    name: 'Investor',
    description: 'Purchase 500 total upgrades',
    category: 'economy',
    stat: 'totalUpgradesPurchased',
    threshold: 500,
    reward: { type: 'upgrade_cost_reduction', value: 0.05, description: '-5% upgrade costs' },
    icon: 'progression',
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
    icon: 'upgrade',
  },
  {
    id: 'ach_enlightened',
    name: 'Enlightened',
    description: 'Ascend 100 times',
    category: 'prestige',
    stat: 'lifetimeAscensions',
    threshold: 100,
    reward: { type: 'rp_gain_mult', value: 0.25, description: '+25% RP gain' },
    icon: 'sparkles',
  },
  {
    id: 'ach_transcendent',
    name: 'Transcendent',
    description: 'Transcend 5 times',
    category: 'prestige',
    stat: 'transcendences',
    threshold: 5,
    reward: { type: 'tp_gain_mult', value: 0.10, description: '+10% TP gain' },
    icon: 'star-formation',
  },
  {
    id: 'ach_eternal',
    name: 'Eternal',
    description: 'Transcend 25 times',
    category: 'prestige',
    stat: 'transcendences',
    threshold: 25,
    reward: { type: 'prestige_gain_mult', value: 0.25, description: '+25% all prestige gains' },
    icon: 'over-infinity',
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
    icon: 'crystal-ball',
  },
  {
    id: 'ach_endurance',
    name: 'Endurance',
    description: 'Reach wave 50 in a single run',
    category: 'mastery',
    stat: 'lifetimeHighestWave',
    threshold: 50,
    reward: { type: 'max_hp_mult', value: 0.15, description: '+15% max HP' },
    icon: 'heart-tower',
  },
  {
    id: 'ach_researcher',
    name: 'Scholar',
    description: 'Unlock all 8 research nodes',
    category: 'mastery',
    stat: 'researchCount',
    threshold: 8,
    reward: { type: 'rp_gain_mult', value: 0.50, description: '+50% RP gain' },
    icon: 'book-pile',
  },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = ACHIEVEMENTS.reduce(
  (acc, a) => {
    acc[a.id] = a;
    return acc;
  },
  {} as Record<string, AchievementDef>,
);
