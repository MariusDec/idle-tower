export const SUFFIXES: readonly string[] = [
  '',
  'K',
  'M',
  'B',
  'T',
  'Qa',
  'Qi',
  'Sx',
  'Sp',
  'Oc',
  'No',
  'Dc',
  'Udc',
  'Ddc',
  'Tdc',
  'Qadc',
  'Qidc',
  'Sxdc',
  'Spdc',
  'Ocdc',
  'Nodc',
  'Vg',
];

export function formatNumber(n: number, decimalCount = 0): string {
  if (!isFinite(n)) return 'Infinity';

  const decimalFactor = Math.pow(10, decimalCount);
  if (n < 0) return '-' + formatNumber(-n);
  if (n < 1000) return (Math.floor(n * decimalFactor) / decimalFactor).toLocaleString();

  const exp = Math.floor(Math.log10(n));
  const tier = Math.floor(exp / 3);
  const scaled = n / Math.pow(1000, tier);
  if (tier < SUFFIXES.length) {
    return scaled.toFixed(2) + SUFFIXES[tier];
  }
  return n.toExponential(2);
}

export function formatInt(n: number): string {
  if (!isFinite(n)) return 'Infinity';
  if (n < 0) return '-' + formatInt(-n);
  return Math.floor(n).toLocaleString();
}

export interface DecimalFormatOptions {
  /**
   * Keep the decimal places even when they are trailing zeros — "5.0" rather
   * than "5". Rates read as fractional when the scale is visible, even while
   * the smoothed value happens to sit on a round number.
   */
  keepTrailingZeros?: boolean;
}

/**
 * Compact readout for small live numbers (damage/heal/regen).
 *
 * Values under 10 keep one decimal place so fractional ticks read accurately;
 * larger values show as integers so the label does not sprawl.
 */
export function formatWithOptionalDecimal(
  n: number,
  decimalCount = 1,
  options: DecimalFormatOptions = {},
): string {
  if (!isFinite(n)) return 'Infinity';
  if (n < 0) return '-' + formatWithOptionalDecimal(-n, decimalCount, options);
  if (n >= 10) return formatInt(n);
  const s = n.toFixed(decimalCount);
  return options.keepTrailingZeros ? s : s.replace(/\.?0+$/, '');
}
