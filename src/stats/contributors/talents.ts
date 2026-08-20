import { TALENT_STATS } from '../../data/talentTree';
import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

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
      // ── offense ──
      case 'base_damage_pct':
      case 'all_damage_pct':
      case 'magic_damage_pct':
      case 'all_magic_pct':
        a.mult('baseDamage', 1 + value);
        break;
      case 'fire_rate_pct':
        a.mult('fireRate', 1 + value);
        break;
      case 'crit_chance_pct':
        a.add('critChance', value);
        break;
      case 'crit_damage_pct':
        a.add('critMultiplier', value);
        break;
      case 'range_pct':
        a.mult('range', 1 + value);
        break;
      case 'armor_penetration_pct':
        a.add('armorPen', value);
        break;
      case 'execution_damage_pct':
        a.add('talentExecuteBonus', value);
        break;
      case 'extra_projectile_chance':
        a.add('extraProjectileChance', value);
        break;

      // ── defense ──
      case 'max_hp_pct':
        a.mult('maxHp', 1 + value);
        break;
      case 'defense_pct':
        a.mult('defense', 1 + value);
        break;
      case 'armor_pct':
        a.mult('armor', 1 + value);
        break;
      case 'thorns_pct':
        a.mult('thorns', 1 + value);
        break;
      case 'dodge_chance':
        a.add('dodgeChance', value);
        break;
      case 'wall_regen_pct':
        a.add('wallRegen', value);
        break;
      case 'shield_charges':
        // Zeroed in `resolveStats` when no shield recharge timer exists —
        // charges that can never come back are not charges.
        a.add('shieldMaxCharges', Math.floor(value));
        break;
      case 'health_regen_pct':
        a.mult('healthRegen', 1 + value);
        break;

      // ── utility ──
      case 'gold_mult_pct':
        a.mult('goldMultiplier', 1 + value);
        break;
      case 'mana_regen_pct':
        a.mult('manaRegen', 1 + value);
        break;
      case 'double_gold_chance':
        a.add('doubleGoldChance', value);
        break;
      case 'head_start_waves':
        a.add('headStartWaves', Math.floor(value));
        break;
      case 'max_mana_flat':
        a.add('maxMana', value);
        break;
      case 'equipment_find_chance':
        a.add('equipmentFindChance', value);
        break;
      case 'auto_buy_speed_pct':
        a.add('autoBuyIntervalReduction', value);
        break;
      case 'upgrade_cost_reduction':
        a.add('upgradeCostDiscount', -value);
        break;
      case 'all_effects_pct':
        // Mastery scales the other talents' per-point values; applied inside
        // TalentManager before the context is built.
        break;

      // ── magic ──
      case 'mana_cost_reduction':
        a.mult('abilityCostMultiplier', 1 - value);
        break;
      case 'magic_proc_chance':
        a.add('magicProcChance', value);
        break;
      case 'chain_bounce_count':
        a.add('chainBounceBonus', value);
        break;
      case 'slow_effect_pct':
        a.add('slowStrengthBonus', value);
        break;
      case 'meteor_damage_pct':
        a.add('meteorDamageBonus', value);
        break;
      case 'buff_duration_pct':
        a.add('buffDurationBonus', value);
        break;
      case 'mana_shield_pct':
        // "Convert 5% mana to HP per point": mana absorbs this fraction of
        // incoming damage, 1 mana per 1 HP.
        a.add('manaShieldFraction', value / 100);
        break;

      default: {
        const exhaustive: never = stat;
        void exhaustive;
      }
    }
  }
}
