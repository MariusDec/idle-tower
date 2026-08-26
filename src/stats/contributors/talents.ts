import type { StatContext } from '../context.ts';
import type { StatAccumulator } from '../accumulator.ts';
import { TALENT_STATS, TALENT_TUNING } from '../../data/talentTree.ts';

/**
 * The talent tree.
 *
 * The `never` default is the guard that made §1.4 fixable: twenty talents once
 * shipped costing points and changing no number, because their stat string had
 * no consumer anywhere. Adding a stat to `TALENT_STATS` without a case here no
 * longer compiles.
 */
export function contributeTalents(ctx: StatContext, acc: StatAccumulator): void {
  const a = acc.source('talent', 'Talents');
  for (const stat of TALENT_STATS) {
    const value = ctx.talents[stat] ?? 0;
    if (value === 0) continue;
    switch (stat) {
      // ── Wrath ──
      case 'base_damage_pct':
      case 'all_damage_pct':      a.mult('baseDamage', 1 + value); break;
      case 'fire_rate_pct':       a.mult('fireRate', 1 + value); break;
      case 'crit_chance_pct':     a.add('critChance', value); break;
      case 'crit_damage_pct':     a.add('critMultiplier', value); break;
      case 'range_pct':           a.mult('range', 1 + value); break;
      case 'armor_penetration_pct': a.add('armorPen', value); break;
      case 'execution_damage_pct':  a.add('talentExecuteBonus', value); break;
      case 'extra_projectile_chance': a.add('extraProjectileChance', value); break;
      case 'focus_stack_pct':     a.add('focusStackBonus', value); break;
      case 'kill_frenzy_pct':     a.add('killFrenzyPerStack', value); break;
      case 'overwatch_damage_pct': a.add('overwatchDamage', value); break;
      case 'boss_damage_pct':     a.add('bossDamageBonus', value); break;
      case 'crit_followup_chance': a.add('critFollowUpChance', value); break;
      case 'shot_splash_radius':  a.add('shotSplashRadius', value); break;
      case 'shot_splash_fraction': a.add('shotSplashFraction', value); break;

      // ── Bulwark ──
      case 'max_hp_pct':          a.mult('maxHp', 1 + value); break;
      case 'defense_pct':         a.mult('defense', 1 + value); break;
      case 'armor_pct':           a.mult('armor', 1 + value); break;
      case 'thorns_pct':          a.mult('thorns', 1 + value); break;
      case 'dodge_chance':        a.add('dodgeChance', value); break;
      case 'wall_regen_pct':      a.add('wallRegen', value); break;
      case 'wall_contact_pct':    a.add('wallContactExtra', value); break;
      case 'shield_charges':      a.add('shieldMaxCharges', Math.floor(value)); break;
      case 'shield_recharge_pct': a.add('shieldRechargeReduction', value); break;
      case 'health_regen_pct':    a.mult('healthRegen', 1 + value); break;
      case 'knockback_pct':       a.mult('knockbackForce', 1 + value); break;
      case 'second_wind_pct':     a.add('secondWindPower', value); break;
      case 'low_hp_damage_pct':
        if (ctx.hpFraction < TALENT_TUNING.lowHpThreshold) {
          a.mult('baseDamage', 1 + value, 'Vengeance');
        }
        break;

      // ── Fortune ──
      case 'gold_mult_pct':       a.mult('goldMultiplier', 1 + value); break;
      case 'xp_gain_pct':         a.mult('xpGainMultiplier', 1 + value); break;
      case 'double_gold_chance':  a.add('doubleGoldChance', value); break;
      case 'head_start_waves':    a.add('headStartWaves', Math.floor(value)); break;
      case 'equipment_find_chance': a.add('equipmentFindChance', value); break;
      case 'upgrade_cost_reduction': a.add('upgradeCostDiscount', -value); break;
      case 'orb_value_pct':       a.add('orbValueBonus', value); break;
      case 'momentum_gain_pct':   a.add('momentumGainBonus', value); break;
      case 'auto_buy_speed_pct':  a.add('autoBuyIntervalReduction', value); break;
      case 'windfall_mult':       a.add('windfallMultiplier', value); break;
      case 'interest_pct':        a.add('interestRate', value); break;
      case 'enemy_hp_pct':        a.mult('enemyHpMult', 1 + value); break;

      // ── Arcana ──
      case 'ability_damage_pct':  a.mult('abilityDamageMultiplier', 1 + value); break;
      case 'mana_cost_reduction': a.mult('abilityCostMultiplier', 1 - value); break;
      case 'ability_cooldown_pct': a.mult('abilityCooldownMultiplier', 1 - value); break;
      case 'mana_regen_pct':      a.mult('manaRegen', 1 + value); break;
      case 'max_mana_flat':       a.add('maxMana', value); break;
      case 'max_mana_pct':        a.mult('maxMana', 1 + value); break;
      case 'magic_proc_chance':   a.add('magicProcChance', value); break;
      case 'slow_effect_pct':     a.add('slowStrengthBonus', value); break;
      case 'chilled_damage_pct':  a.add('chilledDamageBonus', value); break;
      case 'chain_bounce_count':  a.add('chainBounceBonus', value); break;
      case 'meteor_damage_pct':   a.add('meteorDamageBonus', value); break;
      case 'mana_shield_pct':     a.add('manaShieldFraction', value / 100); break;
      case 'ability_echo_chance': a.add('abilityEchoChance', value); break;
      case 'mana_on_kill_pct':    a.add('manaOnKillFraction', value); break;
      case 'buff_duration_pct':   a.add('buffDurationBonus', value); break;

      default: { const exhaustive: never = stat; void exhaustive; }
    }
  }

  // ── Keystone behaviours that resolve as stats ──
  if (ctx.talentBehaviors.includes('battery')
      && ctx.manaFraction >= TALENT_TUNING.batteryManaThreshold) {
    a.mult('baseDamage', 1 + TALENT_TUNING.batteryDamageBonus, 'Battery');
  }
}
