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

export function formatNumber(n: number): string {
  if (!isFinite(n)) return 'Infinity';
  if (n < 0) return '-' + formatNumber(-n);
  if (n < 1000) return Math.floor(n).toLocaleString();
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
