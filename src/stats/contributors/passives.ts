import { PASSIVE_STATS } from '../../data/passiveAbilities';
import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/**
 * Passive abilities.
 *
 * Values arrive as **percent** (a `damage_pct` of 40 means +40%), except the
 * `_flat` stats, which arrive in the consumer's own raw unit. Two conversions
 * that were wrong before this rewrite are worth naming: `thorns` and
 * `lifesteal` are consumed as *fractions* (`e.damage * thorns`,
 * `hitAmount * lifesteal`), so the old `a.add('thorns', value)` reflected 300%
 * of every hit at level 0. Both now divide by 100 like everything else.
 *
 * The `never` default is the guard: a stat added to `PASSIVE_STATS` without a
 * case here does not compile.
 */
export function contributePassives(ctx: StatContext, acc: StatAccumulator): void {
  const a = acc.source('passive', 'Passives');
  for (const stat of PASSIVE_STATS) {
    const value = ctx.passives[stat] ?? 0;
    if (value === 0) continue;
    switch (stat) {
      // ── offense ──
      case 'damage_pct':                  a.mult('baseDamage', 1 + value / 100); break;
      case 'fire_rate_pct':               a.mult('fireRate', 1 + value / 100); break;
      case 'crit_chance_pct':             a.add('critChance', value / 100); break;
      case 'crit_damage_pct':             a.add('critMultiplier', value / 100); break;
      case 'armor_pen_pct':               a.add('armorPen', value / 100); break;
      case 'armor_pen_flat':              a.add('armorPenFlat', value); break;
      case 'pierce_flat':                 a.add('pierceExtra', Math.floor(value)); break;
      case 'double_shot_chance_pct':      a.add('doubleShotChance', value / 100); break;
      case 'extra_projectile_chance_pct': a.add('extraProjectileChance', value / 100); break;
      case 'execute_threshold_pct':       a.add('executeThreshold', value / 100); break;
      case 'execute_damage_multiplier_pct': a.add('executeMultiplier', value / 100); break;
      case 'instant_kill_chance_pct':     a.add('instantKillChance', value / 100); break;
      case 'boss_damage_pct':             a.add('bossDamageBonus', value / 100); break;
      case 'overwatch_damage_pct':        a.add('overwatchDamage', value / 100); break;
      case 'splash_radius_flat':          a.add('shotSplashRadius', value); break;
      case 'splash_fraction_pct':         a.add('shotSplashFraction', value / 100); break;

      // ── defense ──
      case 'max_hp_pct':                  a.mult('maxHp', 1 + value / 100); break;
      case 'armor_flat_pct':              a.add('armor', value / 100); break;
      case 'lifesteal_pct':               a.add('lifesteal', value / 100); break;
      case 'thorns_pct':                  a.add('thorns', value / 100); break;
      case 'dodge_chance_pct':            a.add('dodgeChance', value / 100); break;
      case 'knockback_pct':               a.mult('knockbackForce', 1 + value / 100); break;
      case 'wall_fraction_pct':           a.add('wallFraction', value / 100); break;
      case 'shield_charges_flat':         a.add('shieldMaxCharges', Math.floor(value)); break;
      case 'shield_recharge_pct':         a.add('shieldRechargeReduction', value / 100); break;
      case 'mana_shield_pct':             a.add('manaShieldFraction', value / 100); break;
      case 'second_wind_pct':             a.add('secondWindPower', value / 100); break;
      case 'revive_charges_flat':         a.add('reviveCharges', Math.floor(value)); break;

      // ── economy ──
      case 'gold_mult_pct':               a.mult('goldMultiplier', 1 + value / 100); break;
      case 'double_gold_chance_pct':      a.add('doubleGoldChance', value / 100); break;
      case 'orb_value_pct':               a.add('orbValueBonus', value / 100); break;
      case 'equipment_find_chance_pct':   a.add('equipmentFindChance', value / 100); break;
      // Negative: `UpgradeManager.getCost` multiplies by `1 + costDiscount`.
      case 'upgrade_cost_reduction_pct':  a.add('upgradeCostDiscount', -value / 100); break;
      case 'interest_pct':                a.add('interestRate', value / 100); break;
      case 'windfall_mult_flat':          a.add('windfallMultiplier', value); break;
      case 'auto_buy_speed_pct':          a.add('autoBuyIntervalReduction', value / 100); break;
      case 'xp_gain_pct':                 a.mult('xpGainMultiplier', 1 + value / 100); break;
      case 'rp_drop_chance_pct':          a.add('rpDropChanceBonus', value / 100); break;
      case 'momentum_gain_pct':           a.add('momentumGainBonus', value / 100); break;

      // ── arcana ──
      case 'mana_regen_pct':              a.mult('manaRegen', 1 + value / 100); break;
      case 'max_mana_flat':               a.add('maxMana', value); break;
      case 'max_mana_pct':                a.mult('maxMana', 1 + value / 100); break;
      case 'mana_on_kill_pct':            a.add('manaOnKillFraction', value / 100); break;
      case 'ability_damage_pct':          a.mult('abilityDamageMultiplier', 1 + value / 100); break;
      case 'ability_cooldown_pct':        a.mult('abilityCooldownMultiplier', 1 - value / 100); break;
      case 'ability_cost_pct':            a.mult('abilityCostMultiplier', 1 - value / 100); break;
      case 'magic_proc_chance_pct':       a.add('magicProcChance', value / 100); break;
      case 'buff_duration_pct':           a.add('buffDurationBonus', value / 100); break;
      case 'ability_echo_chance_pct':     a.add('abilityEchoChance', value / 100); break;

      default: {
        const exhaustive: never = stat;
        void exhaustive;
      }
    }
  }
}
