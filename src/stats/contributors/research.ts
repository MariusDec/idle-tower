import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/** Completed research nodes. */
export function contributeResearch(ctx: StatContext, acc: StatAccumulator): void {
  const r = ctx.research;
  const a = acc.source('research', 'Research');

  a.mult('goldAdditive', r.goldMultiplicative);
  a.mult('manaRegen', r.manaRegenMultiplicative);
  a.add('abilityCostMultiplier', r.abilityCostReduction);
  a.add('abilityDamageMultiplier', r.abilityPowerBonus);
  a.add('pierceExtra', r.pierceCount);
  a.add('goldLuckChance', r.goldLuckChance);
  a.add('intermissionMultiplier', -r.intermissionSpeedReduction);
  a.add('enemyHpReduction', r.enemyHpReduction);
  a.add('rpDropChanceBonus', r.rpDropChanceBonus);
}
