/**
 * Number formatting. Act 1 keeps displayed numbers at or below ~10⁶ (§8.2),
 * so K and M carry almost everything; the longer suffix ladder is for Act 2.
 */
export const SUFFIXES: readonly string[] = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
];

/** Compact: `999`, `1.23K`, `45.6M`. Values under 1000 are floored integers. */
export function formatNumber(n: number): string {
  if (!isFinite(n)) return '∞';
  if (n < 0) return '-' + formatNumber(-n);
  if (n < 1000) return String(Math.floor(n));
  const tier = Math.floor(Math.log10(n) / 3);
  if (tier >= SUFFIXES.length) return n.toExponential(2);
  const scaled = n / Math.pow(1000, tier);
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return scaled.toFixed(digits) + SUFFIXES[tier];
}

/** `m:ss`, for run durations. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
