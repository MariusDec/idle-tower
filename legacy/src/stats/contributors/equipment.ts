import { EQUIPMENT_STAT_TYPES } from '../../data/equipment';
import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/** Equipped gear. Every equipment stat is a percentage multiplier. */
export function contributeEquipment(ctx: StatContext, acc: StatAccumulator): void {
  const a = acc.source('equipment', 'Equipment');
  for (const stat of EQUIPMENT_STAT_TYPES) {
    const value = ctx.equipment[stat] ?? 0;
    if (value === 0) continue;
    const factor = 1 + value / 100;
    switch (stat) {
      case 'damage_pct':
      case 'all_damage_pct':
        a.mult('baseDamage', factor);
        break;
      case 'fire_rate_pct': a.mult('fireRate', factor); break;
      case 'crit_chance_pct': a.mult('critChance', factor); break;
      case 'crit_damage_pct': a.mult('critMultiplier', factor); break;
      case 'range_pct': a.mult('range', factor); break;
      case 'max_hp_pct': a.mult('maxHp', factor); break;
      case 'defense_pct': a.mult('defense', factor); break;
      case 'armor_pct': a.mult('armor', factor); break;
      case 'gold_mult_pct': a.mult('goldMultiplier', factor); break;
      case 'mana_regen_pct': a.mult('manaRegen', factor); break;
      case 'lifesteal_pct': a.mult('lifesteal', factor); break;
      case 'thorns_pct': a.mult('thorns', factor); break;
      case 'knockback_pct': a.mult('knockbackForce', factor); break;

      default: {
        const exhaustive: never = stat;
        void exhaustive;
      }
    }
  }
}
