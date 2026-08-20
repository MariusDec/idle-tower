import { EVOLUTION_EFFECT_IDS } from '../../data/upgrades';
import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/**
 * Upgrade evolutions. The switch is exhaustive over `EvolutionEffectId`: an
 * evolution added to the data tables without a decision here is a compile
 * error, even if that decision is "handled by an event handler, not a stat".
 */
export function contributeEvolutions(ctx: StatContext, acc: StatAccumulator): void {
  const a = acc.source('evolution', 'Evolution');
  for (const id of EVOLUTION_EFFECT_IDS) {
    const value = ctx.evolutions[id] ?? 0;
    if (value === 0) continue;
    switch (id) {
      case 'armor_pen':
        a.add('armorPen', value, 'Armor Piercing');
        break;
      case 'berserk_fire_bonus':
        a.add('berserkFireBonus', value, 'Berserker');
        break;
      case 'crit_ignore_armor':
        a.add('critIgnoreArmor', 1, 'Crits Ignore Armor');
        break;
      case 'crit_splash':
        a.add('critSplash', value, 'Critical Splash');
        break;
      case 'instant_kill':
        a.add('instantKillChance', value, 'Instant Kill');
        break;
      case 'shield_fast_recharge':
        // Floored at 3 s in `resolveStats`, so a stacked reduction cannot make
        // the shield effectively permanent.
        a.mult('shieldRechargeTime', 1 - value, 'Rapid Shield');
        break;
      case 'hp_threshold_damage':
        if (ctx.hpFraction > 0.8) a.mult('baseDamage', 1 + value, 'Full Power');
        break;
      case 'wave_gold_scaling':
        a.add('goldAdditive', value * Math.max(0, ctx.wave - 1), "Dragon's Hoard");
        break;

      // Consumed as behaviour by event handlers and managers rather than as a
      // stat: extra shots, revive, mine splitting, on-kill/on-full-mana gold,
      // shockwave slow and the mana shield trigger.
      case 'double_shot':
      case 'enlightenment':
      case 'golden_tide':
      case 'kill_streak_gold':
      case 'mana_full_gold':
      case 'mana_shield':
      case 'mine_split':
      case 'revive':
      case 'shockwave_slow':
        break;

      default: {
        const exhaustive: never = id;
        void exhaustive;
      }
    }
  }
}
