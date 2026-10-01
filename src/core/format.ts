/**
 * Number formatting. Act 1 keeps displayed numbers at or below ~10⁶ (§8.2),
 * so K and M carry almost everything; the longer suffix ladder is for Act 2,
 * where the Abyss and the masteries climb past 10³⁰ (§9). Past the ladder,
 * three significant figures and an exponent: `1.23e66`.
 */
export const SUFFIXES: readonly string[] = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
  'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg',
];

/** Compact: `999`, `1.23K`, `45.6M`. Values under 1000 are floored integers. */
export function formatNumber(n: number): string {
  if (!isFinite(n)) return '∞';
  if (n < 0) return '-' + formatNumber(-n);
  if (n < 1000) return String(Math.floor(n));
  // Floating point can put 1e33 a hair under its tier: nudge before the log.
  let tier = Math.floor(Math.log10(n) / 3 + 1e-12);
  let scaled = n / Math.pow(1000, tier);
  // Rounding may carry a mantissa up to 1000: that is the next tier's 1.00.
  if (Number(scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)) >= 1000) {
    tier++;
    scaled /= 1000;
  }
  if (tier >= SUFFIXES.length) {
    const [m, e] = n.toExponential(2).split('e');
    return `${m}e${Number(e)}`;
  }
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return scaled.toFixed(digits) + SUFFIXES[tier];
}

/** `m:ss`, for run durations. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
