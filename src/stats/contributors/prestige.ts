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
  // prestige-abs §3.1: the tier-1 shelf lands on keys that already have
  // consumers — the discount is negative-signed the way the talent tree signs
  // it, so the two compose in one accumulator rather than fighting over sign.
  ap.add('upgradeCostDiscount', -p.apUpgradeDiscount);
  ap.mult('xpGainMultiplier', p.apXpGain);
  ap.add('rpDropChanceBonus', p.apRpDrop);
  ap.add('reviveCharges', p.apReviveCharges);
  // The two prestige layers and the Watch unlock all add into one fraction
  // (progress.md §3.1) rather than each holding its own ceiling — a ceiling per
  // source is how two of them end up multiplying by accident.
  ap.add('upgradeCapExtension', p.apUpgradeCapExtension);
  tp.add('upgradeCapExtension', p.tpUpgradeCapExtension);
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
  tp.mult('orbGoldMultiplier', p.orbGoldMultiplier);
  tp.add('abilityCostMultiplier', p.abilityManaCostReduction);
  tp.mult('abilityCooldownMultiplier', 1 - p.abilityCdr);
}
