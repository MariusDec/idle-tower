import { BLESSING_STATS, BLESSING_TUNING } from '../../data/blessings';
import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/**
 * The run's blessing draft (plan §1).
 *
 * The switch is exhaustive over `BlessingStat` with a `never` default: adding a
 * stat to `BLESSING_STATS` without deciding what it moves does not compile.
 * That is the same guard that made §1.4 of the previous plan fixable, and it is
 * why a blessing cannot ship as a card that costs a pick and changes no number.
 *
 * Three of the stats deliberately do not touch the tower — `enemySpeedMult`,
 * `enemyHpMult` and `enemyDamageMult` are written to `EnemyManager` by
 * `Game.applyResolvedStats`. They still resolve here so a trade-off card
 * composes with the wave mutator's own enemy multipliers instead of one
 * overwriting the other.
 */
export function contributeBlessings(ctx: StatContext, acc: StatAccumulator): void {
  const a = acc.source('blessing', 'Blessings');
  const totals = ctx.blessings.stats;
  for (const stat of BLESSING_STATS) {
    const value = totals[stat] ?? 0;
    if (value === 0) continue;
    switch (stat) {
      case 'damagePct':
        a.mult('baseDamage', 1 + value);
        break;
      case 'fireRatePct':
        a.mult('fireRate', 1 + value);
        break;
      case 'critChancePct':
        a.add('critChance', value);
        break;
      case 'critDamagePct':
        a.add('critMultiplier', value);
        break;
      case 'rangePct':
        a.mult('range', 1 + value);
        break;
      case 'goldPct':
        // Additive, so a blessing's gold composes with prestige and research
        // the way every other additive gold source does (plan §1.1).
        a.add('goldAdditive', value);
        break;
      case 'maxHpPct':
        a.mult('maxHp', 1 + value);
        break;
      case 'lifestealPct':
        a.add('lifesteal', value);
        break;
      case 'manaRegenPct':
        a.mult('manaRegen', 1 + value);
        break;
      case 'abilityDamagePct':
        a.mult('abilityDamageMultiplier', 1 + value);
        break;
      case 'armorPenFlat':
        a.add('armorPenFlat', value);
        break;
      case 'pierceFlat':
        a.add('pierceExtra', Math.floor(value));
        break;
      case 'enemySpeedPct':
        a.mult('enemySpeedMult', 1 + value);
        break;
      case 'enemyHpPct':
        a.mult('enemyHpMult', 1 + value);
        break;
      case 'enemyDamagePct':
        a.mult('enemyDamageMult', 1 + value);
        break;
      default: {
        const exhaustive: never = stat;
        void exhaustive;
      }
    }
  }

  // `last_stand` is declared as a behavior because it reads as one, but its
  // effect is a stat gated on live HP — the same shape as the `hp_threshold_damage`
  // evolution, and handled the same way: off the context's `hpFraction`, so it
  // is recomputed by the one pass that recomputes everything else.
  if (
    ctx.blessings.behaviors.includes('last_stand')
    && ctx.hpFraction < BLESSING_TUNING.lastStandHpFraction
  ) {
    a.mult('baseDamage', 1 + BLESSING_TUNING.lastStandDamage, 'Last Stand');
  }
}
