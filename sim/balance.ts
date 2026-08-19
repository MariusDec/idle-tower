/**
 * Balance report (plan §7.1). Run with `npm run sim`.
 *
 * Prints the two tables the plan's Part 2 was written against:
 *   §2.1 the wave/gold/HP curve, and
 *   §2.2 wall-wave and run length per prestige tier.
 *
 * Diff the output before and after a balance change — that is the whole point
 * of keeping this file.
 */

import { simulateRun, waveProfile, type WaveSample } from './model.ts';
import { ASCENSION_UNLOCK_WAVE, apForWave } from '../src/data/prestige.ts';
import { lifetimeAPDamageBonus, lifetimeAPGoldBonus } from '../src/data/formulas.ts';

const SAMPLE_WAVES = [1, 10, 20, 30, 50, 100];

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + ' K';
  if (abs >= 10) return n.toFixed(0);
  if (abs >= 0.01) return n.toFixed(3);
  return n.toExponential(1);
}

function mins(sec: number): string {
  if (!Number.isFinite(sec)) return 'never';
  if (sec < 90) return `${sec.toFixed(0)}s`;
  return `${(sec / 60).toFixed(0)} min`;
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)),
  );
  const line = (cells: string[]) =>
    '| ' + cells.map((c, i) => (c ?? '').padStart(widths[i])).join(' | ') + ' |';
  const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

function curveTable(): string {
  const rows: string[][] = [];
  const base = simulateRun({ unlockWave: ASCENSION_UNLOCK_WAVE, sampleWaves: SAMPLE_WAVES });
  for (const wave of SAMPLE_WAVES) {
    const p = waveProfile(wave);
    const s: WaveSample | undefined = base.samples.get(wave);
    rows.push([
      String(wave),
      fmt(p.totalHp / p.count),
      fmt(p.totalHp),
      s ? fmt(s.goldEarned) : fmt(p.baseGold),
      s ? fmt(s.goldPerHp) : fmt(p.baseGold / p.totalHp),
      s ? `${s.clearSec.toFixed(0)}s` : '—',
    ]);
  }
  return table(
    ['Wave', 'Avg HP', 'Wave HP', 'Wave gold', 'gold/HP', 'clear'],
    rows,
  );
}

function tiersTable(): string {
  const tiers = [0, 100, 1_000, 10_000, 100_000];
  const rows = tiers.map(lifetimeAP => {
    const r = simulateRun({
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
      sampleWaves: [],
    });
    return [
      fmt(lifetimeAP),
      `+${(lifetimeAPDamageBonus(lifetimeAP) * 100).toFixed(0)}%`,
      String(r.wallWave),
      mins(r.timeToUnlockSec),
      mins(r.durationSec),
      fmt(apForWave(r.wallWave)),
    ];
  });
  return table(
    ['Lifetime AP', 'Dmg bonus', 'Wall wave', `To wave ${ASCENSION_UNLOCK_WAVE}`, 'Run length', 'AP earned'],
    rows,
  );
}

console.log('\n=== §2.1 Wave / gold / HP curve (fresh run, greedy buyer) ===\n');
console.log(curveTable());
console.log('\n=== §2.2 Wall wave and run length per prestige tier ===\n');
console.log(tiersTable());
console.log(`\nAscension unlocks at wave ${ASCENSION_UNLOCK_WAVE}.\n`);
