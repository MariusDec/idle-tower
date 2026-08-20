import { PASSIVE_STATS } from '../../data/passiveAbilities';
import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/** Passive abilities. Values arrive as percentages, not fractions. */
export function contributePassives(ctx: StatContext, acc: StatAccumulator): void {
  const a = acc.source('passive', 'Passives');
  for (const stat of PASSIVE_STATS) {
    const value = ctx.passives[stat] ?? 0;
    if (value === 0) continue;
    switch (stat) {
      case 'damage_pct':
        a.mult('baseDamage', 1 + value / 100);
        break;
      case 'max_hp_pct':
        a.mult('maxHp', 1 + value / 100);
        break;
      case 'gold_mult_pct':
        a.mult('goldMultiplier', 1 + value / 100);
        break;
      case 'fire_rate_pct':
        a.mult('fireRate', 1 + value / 100);
        break;
      case 'mana_regen_pct':
        a.mult('manaRegen', 1 + value / 100);
        break;
      case 'crit_chance_pct':
        a.add('critChance', value / 100);
        break;
      // Thorns and lifesteal are already flat damage figures, so the passive
      // adds points rather than a percentage.
      case 'thorns_pct':
        a.add('thorns', value);
        break;
      case 'lifesteal_pct':
        a.add('lifesteal', value);
        break;

      default: {
        const exhaustive: never = stat;
        void exhaustive;
      }
    }
  }
}
