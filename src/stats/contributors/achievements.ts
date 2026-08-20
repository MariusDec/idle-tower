import { ACHIEVEMENT_REWARD_CONSUMERS, type AchievementRewardType } from '../../data/achievements';
import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

const REWARD_TYPES = Object.keys(ACHIEVEMENT_REWARD_CONSUMERS) as AchievementRewardType[];

/**
 * Achievement rewards.
 *
 * Types that feed the same stat are summed into one factor before it is
 * applied — `damage_mult` and `all_damage` at +10% each are +20%, not +21% —
 * matching how the rewards are worded. The switch is exhaustive, so a new
 * reward type cannot ship unread the way nine of them once did (plan §1.5).
 */
export function contributeAchievements(ctx: StatContext, acc: StatAccumulator): void {
  let damage = 0;
  let fireRate = 0;
  let maxHp = 0;
  let gold = 0;
  let abilityCdr = 0;
  let costReduction = 0;

  for (const type of REWARD_TYPES) {
    const value = ctx.achievements[type] ?? 0;
    if (value === 0) continue;
    switch (type) {
      case 'damage_mult':
      case 'all_damage':
        damage += value;
        break;
      case 'fire_rate_mult':
        fireRate += value;
        break;
      case 'max_hp_mult':
        maxHp += value;
        break;
      case 'gold_mult':
        gold += value;
        break;
      case 'ability_cdr':
        abilityCdr += value;
        break;
      case 'upgrade_cost_reduction':
        costReduction += value;
        break;
      case 'all_stats':
        damage += value;
        fireRate += value;
        gold += value;
        break;

      // Consumed outside the stat pipeline: on-kill gold, the run-start grant,
      // shot variants, and the prestige gain previews.
      case 'boss_gold_mult':
      case 'start_gold':
      case 'extra_projectile':
      case 'ap_gain_mult':
      case 'rp_gain_mult':
      case 'tp_gain_mult':
      case 'prestige_gain_mult':
        break;

      default: {
        const exhaustive: never = type;
        void exhaustive;
      }
    }
  }

  const a = acc.source('achievement', 'Achievements');
  a.mult('baseDamage', 1 + damage);
  a.mult('fireRate', 1 + fireRate);
  a.mult('maxHp', 1 + maxHp);
  a.mult('goldMultiplier', 1 + gold);
  a.mult('abilityCooldownMultiplier', 1 - abilityCdr);
  a.add('upgradeCostDiscount', -costReduction);
}
