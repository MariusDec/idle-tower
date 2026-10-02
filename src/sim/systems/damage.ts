import { BALANCE } from '../../content/balance';

/**
 * Armour is a curve, not a cliff (S2): a hit lands `hit / (hit + armour)` of
 * itself, so a hit three times the armour lands 75%, one equal to it half,
 * and a small one never quite nothing. Big hits still beat many small ones.
 * `minFraction` is a backstop. The same rule for enemies and the tower.
 */
export function mitigate(raw: number, armor: number): number {
  if (raw <= 0) return 0;
  if (armor <= 0) return raw;
  return Math.max(raw * BALANCE.damage.minFraction, (raw * raw) / (raw + armor));
}

/** The share of a hit of `raw` that lands through `armor`: the curve `mitigate` follows. */
export function landedShare(raw: number, armor: number): number {
  return raw > 0 ? mitigate(raw, armor) / raw : 0;
}
