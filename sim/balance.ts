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

import { simulateRun, waveProfile, orbGoldForWave, type WaveSample } from './model.ts';
import { MANUAL_AIM } from '../src/data/tower.ts';
import { LOOT_TUNING } from '../src/data/loot.ts';
import { CONTRACT_TUNING } from '../src/data/contracts.ts';
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
  const base = simulateRun({
    unlockWave: ASCENSION_UNLOCK_WAVE,
    sampleWaves: SAMPLE_WAVES,
    blessings: false,
  });
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

function tiersTable(blessings: boolean): string {
  const tiers = [0, 100, 1_000, 10_000, 100_000];
  const seeds = blessings ? BLESSING_SEEDS : [0];
  const rows = tiers.map(lifetimeAP => {
    const runs = seeds.map(seed => simulateRun({
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
      sampleWaves: [],
      blessings,
      seed,
    }));
    const wall = mean(runs.map(r => r.wallWave));
    return [
      fmt(lifetimeAP),
      `+${(lifetimeAPDamageBonus(lifetimeAP) * 100).toFixed(0)}%`,
      blessings ? wall.toFixed(1) : String(runs[0].wallWave),
      mins(mean(runs.map(r => r.timeToUnlockSec))),
      mins(mean(runs.map(r => r.durationSec))),
      fmt(apForWave(Math.round(wall))),
    ];
  });
  return table(
    ['Lifetime AP', 'Dmg bonus', 'Wall wave', `To wave ${ASCENSION_UNLOCK_WAVE}`, 'Run length', 'AP earned'],
    rows,
  );
}

/**
 * Seeds the blessing tables average over.
 *
 * One run is one draft sequence, and the wall is quantised to boss waves — a
 * single seed reports 49 or 59 with nothing in between, which reads as a much
 * bigger swing than the tuning actually moved. Averaging several draft
 * sequences is what makes the number comparable across a balance change.
 */
const BLESSING_SEEDS = [0x5eed, 1, 7, 99, 12345, 555, 8080];

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Gameplay plan §1.6: what the blessing draft is worth, tier by tier.
 *
 * Both columns are produced by the same model with the draft switched off and
 * on, so the delta is attributable to blessings alone rather than to anything
 * else that moved in the same commit. "Run power" is the composed DPS at a
 * matched wave — it therefore includes the upgrades the extra gold bought, not
 * just the stats the cards granted.
 */
function blessingDeltaTable(): string {
  const tiers = [0, 100, 1_000, 10_000, 100_000];
  const rows = tiers.map(lifetimeAP => {
    const common = {
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
    };
    // Compare power at the wave the *un-blessed* run walls on: the deepest
    // point both runs actually reach, and the one where "how much further did
    // blessings take me" is a fair question.
    const powerWave = simulateRun({ ...common, sampleWaves: [], blessings: false }).wallWave;
    const before = simulateRun({ ...common, sampleWaves: [powerWave], blessings: false });
    const runs = BLESSING_SEEDS.map(seed =>
      simulateRun({ ...common, sampleWaves: [powerWave], blessings: true, seed }),
    );
    const walls = runs.map(r => r.wallWave);
    const picks = runs.map(r => r.blessingPicks);
    const baseDps = before.samples.get(powerWave)?.dps ?? 0;
    const power = baseDps > 0
      ? runs.map(r => (r.samples.get(powerWave)?.dps ?? 0) / baseDps)
      : [1];
    return [
      fmt(lifetimeAP),
      String(before.wallWave),
      mean(walls).toFixed(1),
      `+${(mean(walls) - before.wallWave).toFixed(1)}`,
      mean(picks).toFixed(1),
      `${mean(power).toFixed(2)}x`,
      String(powerWave),
    ];
  });
  return table(
    ['Lifetime AP', 'Wall (no bless)', 'Wall (bless)', 'Δ', 'Picks', 'Run power', 'measured at wave'],
    rows,
  );
}

/**
 * Gameplay plan §4.5 — the idle-parity check, which is the gate Part 4 can
 * actually fail.
 *
 * Two runs of the same model: fully idle (nothing held, orbs drift home for
 * 40%, abilities auto-placed) versus perfect active play (mouse held for the
 * +30% fire rate, a charged shot every cycle, every orb clicked for 100%,
 * every placeable ability aimed). "Advantage" is composed DPS at the wave the
 * *idle* run walls on — the same "run power" definition the blessing table
 * uses, so it includes the upgrades the extra orb gold bought rather than only
 * the damage the verbs did.
 *
 * The plan's band is +25-40%. Above +50% the charged-shot multiplier gets cut.
 */
function idleParityTable(): string {
  const tiers = [0, 100, 1_000, 10_000, 100_000];
  const rows = tiers.map(lifetimeAP => {
    const common = {
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
      blessings: false,
    };
    const powerWave = simulateRun({ ...common, sampleWaves: [] }).wallWave;
    const idle = simulateRun({ ...common, sampleWaves: [powerWave], active: false });
    const act = simulateRun({ ...common, sampleWaves: [powerWave], active: true });
    const idleDps = idle.samples.get(powerWave)?.dps ?? 0;
    const activeDps = act.samples.get(powerWave)?.dps ?? 0;
    const advantage = idleDps > 0 ? activeDps / idleDps - 1 : 0;
    return [
      fmt(lifetimeAP),
      String(idle.wallWave),
      String(act.wallWave),
      `+${(advantage * 100).toFixed(1)}%`,
      (idle.samples.get(powerWave)?.fireRate ?? 0).toFixed(2),
      String(powerWave),
    ];
  });
  return table(
    ['Lifetime AP', 'Wall (idle)', 'Wall (active)', 'Active advantage', 'shots/s', 'measured at wave'],
    rows,
  );
}

/** What the orb faucet is actually worth, as a share of a wave's income. */
function orbFaucetTable(): string {
  // Boss waves *and* ordinary ones: the boss budget is per encounter, so a
  // boss wave's orb income is a very different fraction of a very different
  // pot, and showing only multiples of ten would have hidden that.
  const waves = [9, 10, 19, 20, 39, 40, 99, 100];
  const rows = waves.map(wave => {
    const p = waveProfile(wave);
    const full = orbGoldForWave(wave);
    return [
      String(wave),
      fmt(p.baseGold),
      fmt(full),
      `${((full * LOOT_TUNING.autoCollectRate) / p.baseGold * 100).toFixed(1)}%`,
      `${(full / p.baseGold * 100).toFixed(1)}%`,
    ];
  });
  return table(
    ['Wave', 'Wave gold', 'Orb gold (full)', 'idle (40%)', 'clicked (100%)'],
    rows,
  );
}

/**
 * Gameplay plan §5 — what contracts cost the curve.
 *
 * The gate this part can fail is the one Parts 2-4 all held: **idle wall-wave
 * drift must be zero**. Contracts pay gold sized off `estimateWaveGold`, so
 * they are a faucet in exactly the way orbs are, and the question is whether
 * the faucet is small enough to disappear into the upgrade curve's rounding.
 *
 * The AP column is the other half: `apBonusPct` is capped at +50% by
 * `ContractManager`, and this reports what a full run actually reaches, which
 * is the number that says whether the cap is a real ceiling or decoration.
 */
function contractTable(): string {
  const tiers = [0, 100, 1_000, 10_000, 100_000];
  const rows = tiers.map(lifetimeAP => {
    const common = {
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
      sampleWaves: [],
      blessings: false,
    };
    const off = simulateRun({ ...common, contracts: false });
    const on = simulateRun({ ...common, contracts: true });
    return [
      fmt(lifetimeAP),
      String(off.wallWave),
      String(on.wallWave),
      on.wallWave === off.wallWave ? '0' : `${on.wallWave > off.wallWave ? '+' : ''}${on.wallWave - off.wallWave}`,
      String(on.contractsCompleted),
      `+${(on.contractApBonus * 100).toFixed(0)}%`,
      `${(on.contractGoldShare * 100).toFixed(1)}%`,
    ];
  });
  return table(
    ['Lifetime AP', 'Wall (no contracts)', 'Wall (contracts)', 'Δ', 'Completed', 'AP bonus', 'gold share'],
    rows,
  );
}

console.log('\n=== §2.1 Wave / gold / HP curve (fresh run, greedy buyer, no blessings) ===\n');
console.log(curveTable());
console.log('\n=== §2.2 Wall wave and run length per prestige tier (no blessings) ===\n');
console.log(tiersTable(false));
console.log('\n=== §2.2b Wall wave and run length per prestige tier (with blessings) ===\n');
console.log(tiersTable(true));
console.log('\n=== Gameplay §1.6 Blessing draft: before / after ===\n');
console.log(blessingDeltaTable());
console.log('\n=== Gameplay §4.5 Idle parity: fully idle vs. perfect active play ===\n');
console.log(idleParityTable());
console.log(
  `\nCharged shot: ${MANUAL_AIM.chargeDamageMult}x damage, +${MANUAL_AIM.chargeExtraPierce} pierce, `
  + `${MANUAL_AIM.chargeSplashRadius}px splash, every `
  + `${MANUAL_AIM.chargeSeconds + MANUAL_AIM.chargeCooldown}s of wall-clock time.`,
);
console.log('\n=== Gameplay §5 Contracts: before / after (idle, no blessings) ===\n');
console.log(contractTable());
console.log(
  `\nContract AP bonus: +${CONTRACT_TUNING.apBonusStep * 100}% per contract that grants one, `
  + `capped at +${CONTRACT_TUNING.apBonusCap * 100}% for the run.`,
);
console.log('\n=== Gameplay §4.1 Loot orbs as a share of wave income ===\n');
console.log(orbFaucetTable());
console.log(`\nAscension unlocks at wave ${ASCENSION_UNLOCK_WAVE}.\n`);
