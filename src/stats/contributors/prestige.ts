import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/** Execute threshold granted by the transcendence perk, as an HP fraction. */
const PRESTIGE_EXECUTE_THRESHOLD = 0.25;

/**
 * Ascension and transcendence perks.
 *
 * Lifetime AP (passive, diminishing) and spent AP (chosen, unbounded) are one
 * additive bonus inside the ascension layer; the transcendence multipliers sit
 * outside it, so a transcendence is worth the same proportional jump at every
 * AP total.
 */
export function contributePrestige(ctx: StatContext, acc: StatAccumulator): void {
  const p = ctx.prestige;
  const ap = acc.source('prestige', 'Ascension points');
  const tp = acc.source('prestige', 'Transcendence points');

  ap.mult('baseDamage', 1 + p.lifetimeDamage + p.apDamage);
  ap.add('goldAdditive', p.lifetimeGold + p.apGold);
  ap.add('goldLuckChance', p.treasureChance);
  ap.add('waveSkipChance', p.waveSkipChance);
  ap.mult('fireRate', p.apFireRate);
  ap.add('pierceExtra', p.apPierce);
  if (p.hasExecuteDamage) {
    ap.add('executeThreshold', PRESTIGE_EXECUTE_THRESHOLD);
    ap.add('executeMultiplier', p.executeDamageMultiplier);
  }

  tp.mult('baseDamage', p.tpDamage);
  tp.mult('fireRate', p.tpFireRate);
  tp.mult('manaRegen', p.tpManaRegen);
  tp.mult('goldAdditive', p.tpResource);
  tp.add('critMultiplier', p.tpCritDamage);
  tp.add('pierceExtra', p.tpPierce);
  tp.add('abilityCostMultiplier', p.abilityManaCostReduction);
  tp.mult('abilityCooldownMultiplier', 1 - p.abilityCdr);
}
