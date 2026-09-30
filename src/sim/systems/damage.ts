import { BALANCE } from '../../content/balance';

/**
 * Armour is a flat reduction with a floor (§4.4): a hit always lands at least
 * `minFraction` of itself. The same rule for enemies and the tower.
 */
export function mitigate(raw: number, armor: number): number {
  if (raw <= 0) return 0;
  return Math.max(raw * BALANCE.damage.minFraction, raw - Math.max(0, armor));
}
