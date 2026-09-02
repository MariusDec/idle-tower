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

import { simulateRun, waveProfile, orbGoldForWave, comboGoldMult, type WaveSample } from './model.ts';
import { ladderTable, ladderVerdict } from './ladder.ts';
import { CORE_BY_ID, CORE_IDS, DEFAULT_CORE, describeCoreStats } from '../src/data/cores.ts';
import { MANUAL_AIM } from '../src/data/tower.ts';
import { LOOT_TUNING } from '../src/data/loot.ts';
import { CONTRACT_TUNING } from '../src/data/contracts.ts';
import {
  COMBO_TIERS,
  EARLY_CALL_GOLD_PER_SECOND,
  EARLY_CALL_WINDOW_SECONDS,
  MAX_RISK,
  MOMENTUM_CAP,
  RISK_GOLD_PER_STEP,
  RISK_HP_PER_STEP,
  RISK_SPEED_PER_STEP,
  intermissionSecondsForWave,
  riskApBonus,
} from '../src/data/pacing.ts';
import { ASCENSION_UNLOCK_WAVE, AP_PERK_BY_ID, apForWave, computePerkEffect, perkCost } from '../src/data/prestige.ts';
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


/**
 * prestige-abs §8.3: what a level of Seed Capital is worth on a fresh run.
 *
 * Measured against the *fresh* tower (no lifetime AP, no blessings), which is
 * the run a first ascension actually returns to — the whole point of the node
 * is the first minute of the next run, and a deep run's income drowns it.
 */
function seedCapitalTable(): string {
  const def = AP_PERK_BY_ID['ap_seed_capital'];
  const baseline = simulateRun({ unlockWave: ASCENSION_UNLOCK_WAVE, sampleWaves: [], blessings: false });
  const rows: string[][] = [];
  for (let level = 0; level <= def.maxLevel; level++) {
    const startGold = Math.floor(computePerkEffect(def, level));
    let cumulative = 0;
    for (let l = 0; l < level; l++) cumulative += perkCost(def, l);
    const run = simulateRun({
      unlockWave: ASCENSION_UNLOCK_WAVE,
      sampleWaves: [],
      blessings: false,
      startGold,
    });
    rows.push([
      String(level),
      fmt(startGold),
      String(cumulative),
      String(run.wallWave),
      `${run.wallWave >= baseline.wallWave ? '+' : ''}${run.wallWave - baseline.wallWave}`,
      mins(run.timeToUnlockSec),
    ]);
  }
  return table(
    ['Level', 'Start gold', 'Cumulative AP', 'Wall wave', 'Δ wall', `To wave ${ASCENSION_UNLOCK_WAVE}`],
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

/**
 * Gameplay plan §6.4 — the gate Part 6 can actually fail.
 *
 * Every core against `marksman`, tier by tier. Two versions, because the wall
 * wave is quantised to boss waves (steps of 10 on a base of ~40, i.e. a
 * resolution of 25%) and a ±15% band cannot be *steered* by a metric that
 * coarse: the idle run is the drift check, and the blessing run — averaged over
 * seven draft sequences — is the one with enough resolution to tune against.
 */
function coreWallTable(blessings: boolean): string {
  const tiers = [0, 100, 1_000, 10_000, 100_000];
  const seeds = blessings ? BLESSING_SEEDS : [0];
  const wallsFor = (core: typeof CORE_IDS[number]) => tiers.map(lifetimeAP => mean(
    seeds.map(seed => simulateRun({
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
      sampleWaves: [],
      blessings,
      seed,
      core,
    }).wallWave),
  ));

  const base = wallsFor(DEFAULT_CORE);
  const rows = CORE_IDS.map(id => {
    const walls = wallsFor(id);
    const worst = walls
      .map((v, i) => (base[i] > 0 ? (v - base[i]) / base[i] : 0))
      .reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    return [
      CORE_BY_ID[id].name.replace(' Core', ''),
      ...walls.map(v => (blessings ? v.toFixed(1) : String(Math.round(v)))),
      `${worst >= 0 ? '+' : ''}${(worst * 100).toFixed(1)}%`,
      Math.abs(worst) <= 0.15 ? 'ok' : 'OUT OF BAND',
    ];
  });
  return table(
    [blessings ? 'Core (drafting)' : 'Core (idle)', ...tiers.map(t => fmt(t)), 'worst Δ', '±15%'],
    rows,
  );
}

/**
 * The continuous companion to the wall table: composed DPS at `marksman`'s own
 * wall wave, relative to `marksman`. Same "run power" definition the blessing
 * table uses, so it includes whatever the core's gold multiplier bought.
 */
function corePowerTable(): string {
  const tiers = [0, 100, 1_000, 10_000, 100_000];
  const powerAt = (core: typeof CORE_IDS[number], lifetimeAP: number, wave: number) => {
    const r = simulateRun({
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
      sampleWaves: [wave],
      blessings: false,
      core,
    });
    return r.samples.get(wave)?.dps ?? 0;
  };
  const baseWalls = tiers.map(lifetimeAP => simulateRun({
    damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
    goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
    unlockWave: ASCENSION_UNLOCK_WAVE,
    sampleWaves: [],
    blessings: false,
    core: DEFAULT_CORE,
  }).wallWave);

  const rows = CORE_IDS.map(id => [
    CORE_BY_ID[id].name.replace(' Core', ''),
    ...tiers.map((lifetimeAP, i) => {
      const wave = baseWalls[i];
      const base = powerAt(DEFAULT_CORE, lifetimeAP, wave);
      const v = powerAt(id, lifetimeAP, wave);
      const delta = base > 0 ? v / base - 1 : 0;
      return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
    }),
  ]);
  return table(['Core', ...tiers.map(t => fmt(t))], rows);
}

/** What each core actually is, so the tables above are readable on their own. */
function coreStatTable(): string {
  const rows = CORE_IDS.map(id => {
    const def = CORE_BY_ID[id];
    return [
      def.name.replace(' Core', ''),
      def.apCost === 0 ? 'default' : `${def.apCost} AP`,
      describeCoreStats(def).join(', ') || '—',
      def.behaviors.join(', ') || '—',
    ];
  });
  return table(['Core', 'Unlock', 'Stats', 'Shot behavior'], rows);
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

/**
 * Gameplay plan §7.8 — the gate Part 7 can actually fail.
 *
 * **Risk 0 must reproduce the current curve exactly.** If it does not, the dial
 * has leaked into the baseline and every number in every other table is
 * measuring a game the player did not choose. That is what this table is for,
 * and the integer idle wall is the right metric for it precisely because it is
 * coarse: a leak of any size shows as a changed number.
 */
function riskWallTable(): string {
  const tiers = [0, 100, 1_000, 10_000, 100_000];
  const rows: string[][] = [];
  for (let risk = 0; risk <= MAX_RISK; risk++) {
    const walls = tiers.map(lifetimeAP => simulateRun({
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
      sampleWaves: [],
      blessings: false,
      risk,
    }).wallWave);
    rows.push([
      String(risk),
      `+${(RISK_HP_PER_STEP * risk * 100).toFixed(0)}%`,
      `+${(RISK_SPEED_PER_STEP * risk * 100).toFixed(0)}%`,
      `+${(RISK_GOLD_PER_STEP * risk * 100).toFixed(0)}%`,
      `+${(riskApBonus(risk) * 100).toFixed(0)}%`,
      ...walls.map(String),
    ]);
  }
  return table(
    ['Risk', 'enemy HP', 'speed', 'gold', 'AP', ...tiers.map(t => fmt(t))],
    rows,
  );
}

/**
 * The other half of §7.8: **is the dial a choice?**
 *
 * "A dial nobody can survive is not a choice, and neither is one that is free
 * gold." The wall column above cannot answer that — it quantises to boss waves
 * — so this one runs the draft over seven seeds for fractional resolution, the
 * same trick §6.4's core table needed, and scores the thing the player is
 * actually trading for: **AP per run**, which is wall depth *and* the dial's
 * own multiplier.
 *
 * Read the result with the model's blind spot in mind. Enemy *speed* moves no
 * number here, because the model has no positions and no tower HP, so the
 * entire cost of `+40% enemy speed` at risk 5 — arriving sooner, hitting more
 * often, dying to the wall rather than to a timer — is missing. The dial is
 * therefore *more* attractive here than in the game, which is the safe
 * direction for "is it survivable" and the unsafe one for "is it free".
 */
function riskRewardTable(): string {
  const tiers = [0, 100, 1_000, 10_000, 100_000];
  const wallsFor = (risk: number) => tiers.map(lifetimeAP => mean(
    BLESSING_SEEDS.map(seed => simulateRun({
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
      sampleWaves: [],
      blessings: true,
      seed,
      risk,
    }).wallWave),
  ));
  const base = wallsFor(0);
  const baseAp = base.map(w => apForWave(Math.round(w)));
  const rows: string[][] = [];
  for (let risk = 0; risk <= MAX_RISK; risk++) {
    const walls = wallsFor(risk);
    const apRatio = walls.map((w, i) => (
      baseAp[i] > 0 ? (apForWave(Math.round(w)) * (1 + riskApBonus(risk))) / baseAp[i] - 1 : 0
    ));
    const wallDelta = mean(walls.map((w, i) => (base[i] > 0 ? w / base[i] - 1 : 0)));
    rows.push([
      String(risk),
      ...walls.map(w => w.toFixed(1)),
      `${wallDelta >= 0 ? '+' : ''}${(wallDelta * 100).toFixed(1)}%`,
      `${mean(apRatio) >= 0 ? '+' : ''}${(mean(apRatio) * 100).toFixed(0)}%`,
    ]);
  }
  return table(
    ['Risk', ...tiers.map(t => fmt(t)), 'wall Δ', 'AP/run Δ'],
    rows,
  );
}

/**
 * What the §7.1 and §7.2 faucets cost the curve.
 *
 * The same question Part 5 asked of contracts and Part 4 asked of orbs: idle
 * wall-wave drift must be **zero**, because the combo is a baseline faucet
 * that nothing the player does earns. Momentum is active-only and shows up in
 * the §4.5 idle-parity table above instead.
 */
function pacingTable(): string {
  const tiers = [0, 100, 1_000, 10_000, 100_000];
  const rows = tiers.map(lifetimeAP => {
    const common = {
      damageMult: 1 + lifetimeAPDamageBonus(lifetimeAP),
      goldMult: 1 + lifetimeAPGoldBonus(lifetimeAP),
      unlockWave: ASCENSION_UNLOCK_WAVE,
      sampleWaves: [],
      blessings: false,
    };
    const off = simulateRun({ ...common, pacing: false });
    const on = simulateRun({ ...common, pacing: true });
    return [
      fmt(lifetimeAP),
      String(off.wallWave),
      String(on.wallWave),
      on.wallWave === off.wallWave ? '0' : `${on.wallWave > off.wallWave ? '+' : ''}${on.wallWave - off.wallWave}`,
      `${((comboGoldMult(waveProfile(off.wallWave).count, 40) - 1) * 100).toFixed(1)}%`,
      `${intermissionSecondsForWave(off.wallWave)}s`,
    ];
  });
  return table(
    ['Lifetime AP', 'Wall (no pacing)', 'Wall (pacing)', 'Δ', 'combo at the wall', 'intermission'],
    rows,
  );
}

/**
 * Upgrades revamp §13.5 — the table the whole revamp is steered by.
 *
 * Fresh run only: no prestige multipliers, no blessings, idle, risk 0,
 * `marksman`. That is the curve every §14 gate is written against, and mixing
 * a blessed or prestiged run into it would hide the thing being measured.
 *
 * The `wall` row is the last wave the run actually cleared, so the sample has
 * to be taken in a second pass once the first has found it.
 */
function instrumentationTable(legacyBuyable: boolean): string {
  const common = {
    unlockWave: ASCENSION_UNLOCK_WAVE,
    blessings: false,
    legacyBuyable,
  };
  const probe = simulateRun({ ...common, sampleWaves: [] });
  const waves = [...new Set([5, 10, 20, 30, probe.wallWave])]
    .filter(w => w > 0 && w <= probe.wallWave)
    .sort((a, b) => a - b);
  const run = simulateRun({ ...common, sampleWaves: waves });

  const rows = waves.map(wave => {
    const s = run.samples.get(wave);
    if (!s) return [String(wave), ...Array(13).fill('—')];
    return [
      wave === probe.wallWave ? `${wave} (wall)` : String(wave),
      s.boss ? 'B' : '·',
      `${(s.budgetUse * 100).toFixed(0)}%`,
      s.shotsToKillNormal.toFixed(1),
      s.shotsToKillAverage.toFixed(1),
      String(s.levels.damage ?? 0),
      String(s.levels.fireRate ?? 0),
      String(s.levels.pierce ?? 0),
      String(s.levels.goldMulti ?? 0),
      Number.isFinite(s.wavesOfIncome.damage) ? s.wavesOfIncome.damage.toFixed(1) : '—',
      Number.isFinite(s.wavesOfIncome.fireRate) ? s.wavesOfIncome.fireRate.toFixed(1) : '—',
      s.targetsPerShot.toFixed(2),
      fmt(s.dps),
      `${s.bestPurchaseId} +${(s.bestPurchaseDpsDelta * 100).toFixed(1)}%`,
    ];
  });

  return table(
    [
      'Wave', 'B?', 'Budget use', 's2k normal', 's2k avg',
      'dmg', 'rate', 'pierce', 'greed',
      'waves/dmg', 'waves/rate', 'targets/shot', 'composed DPS', 'best single buy',
    ],
    rows,
  );
}

/** The one-line summary the §14 gates are read off. */
function instrumentationSummary(legacyBuyable: boolean): string {
  const r = simulateRun({
    unlockWave: ASCENSION_UNLOCK_WAVE,
    sampleWaves: [],
    blessings: false,
    legacyBuyable,
  });
  const nonBoss: number[] = [];
  const boss: number[] = [];
  const sampled = simulateRun({
    unlockWave: ASCENSION_UNLOCK_WAVE,
    sampleWaves: Array.from({ length: r.wallWave }, (_, i) => i + 1),
    blessings: false,
    legacyBuyable,
  });
  for (const s of sampled.samples.values()) {
    if (s.wave < 5) continue;
    (s.boss ? boss : nonBoss).push(s.budgetUse);
  }
  const band = (xs: number[]) => (xs.length === 0
    ? '—'
    : `${(Math.min(...xs) * 100).toFixed(0)}-${(Math.max(...xs) * 100).toFixed(0)}%`
      + ` (median ${(median(xs) * 100).toFixed(0)}%)`);
  return [
    `wall ${r.wallWave}, ${mins(r.durationSec)}, ${fmt(apForWave(r.wallWave))} AP banked`,
    `non-boss budget use (waves 5-wall): ${band(nonBoss)}`,
    `boss budget use: ${band(boss)}`,
    `run income growth: ${r.incomeGrowth.toFixed(3)}x per wave (§6.3 target ≤1.16x)`,
  ].join('\n');
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

console.log('\n=== Revamp §13.5 Instrumentation (fresh run: idle, no blessings, no prestige) ===\n');
console.log(instrumentationTable(false));
console.log('\n' + instrumentationSummary(false));
console.log(
  '\n`s2k` is shots to kill *one* enemy — extra lanes and Double Tap are coverage and rate,'
  + '\nnot damage per shot, so neither is folded in. `targets/shot` is the §4 coverage axis;'
  + '\nit is 1.00 until `pierce` / `splash` / the AP-TP coverage nodes exist (revamp tasks 4, 7, 8).\n',
);
console.log(
  'Armor note: `EnemyDef.armor` is a *fraction* of a hit (`K/(K+armor)`, K = ARMOR_SOFTENING),'
  + '\nnot the flat subtraction it was through task 4. Flat armour is a tax that never scales, so'
  + '\nunder §5\'s damage curve wave 10\'s boss (armor 6) took four fifths of every arrow and gates 5'
  + '\nand 6 became mutually exclusive at any damage table. The game and this model read the same'
  + '\nhelper, so the two cannot drift.\n',
);
console.log(
  'Cost note: `damage` ships at 8 / 1.18 and `fireRate` at 25 / 1.30, not §5.3\'s 10 / 1.16 and'
  + '\n40 / 1.18 (§16 lever 2). At 1.16 the buyer takes ~1 level/wave and +11%/level cancels'
  + '\n`ENEMY_HP_GROWTH` exactly — shots-to-kill never moves and nothing walls until `fireRate`'
  + '\nsaturates (measured wall 129, 175 min). The effect shapes and maxLevels are §5.3\'s.\n',
);
console.log(
  'Provenance: the revamp\'s §1 baseline was measured with a greedy buyer that could reach only'
  + '\nsix upgrade ids. §13.1 widened that to every line the model can price, which is a stronger'
  + '\ntower and therefore a different curve — not a drift. The old buyer is still reproducible:\n',
);
console.log(instrumentationTable(true));
console.log('\n' + instrumentationSummary(true));

console.log('\n=== §2.1 Wave / gold / HP curve (fresh run, greedy buyer, no blessings) ===\n');
console.log(curveTable());
console.log('\n=== §2.2 Wall wave and run length per prestige tier (no blessings) ===\n');
console.log(tiersTable(false));
console.log('\n=== §2.2b Wall wave and run length per prestige tier (with blessings) ===\n');
console.log(tiersTable(true));
console.log('\n=== prestige-abs §8.3 Seed Capital: wall wave vs. front-loaded gold ===\n');
console.log(seedCapitalTable());
console.log(
  '\nSeed Capital is the one node in the new tier-1 shelf whose base is a real balance risk:'
  + '\nfront-loaded gold compounds through the whole upgrade curve. L1 (200 gold) has to feel'
  + '\ngood; if the ladder measures past the band, §8.3 says cut the base before the ladder.\n',
);
console.log('\n=== Gameplay §1.6 Blessing draft: before / after ===\n');
console.log(blessingDeltaTable());
console.log('\n=== Gameplay §4.5 Idle parity: fully idle vs. perfect active play ===\n');
console.log(idleParityTable());
console.log(
  `\nCharged shot: ${MANUAL_AIM.chargeDpsSeconds} DPS-seconds of damage, `
  + `+${MANUAL_AIM.chargeExtraPierce} pierce, ${MANUAL_AIM.chargeSplashRadius}px splash, every `
  + `${MANUAL_AIM.chargeSeconds + MANUAL_AIM.chargeCooldown}s of wall-clock time.`,
);
console.log('\n=== Gameplay §5 Contracts: before / after (idle, no blessings) ===\n');
console.log(contractTable());
console.log(
  `\nContract AP bonus: +${CONTRACT_TUNING.apBonusStep * 100}% per contract that grants one, `
  + `capped at +${CONTRACT_TUNING.apBonusCap * 100}% for the run.`,
);
console.log('\n=== Gameplay §6.4 Tower cores: wall wave per core, per prestige tier ===\n');
console.log(coreWallTable(false));
console.log(
  '\nIdle wall-wave drift is zero for every core at every tier, which is the '
  + 'standard Parts 2-5 held.\nThe wall quantises to boss waves, so the same table '
  + 'is repeated with the draft running — averaged\nover ' + BLESSING_SEEDS.length
  + ' seeds it has real resolution, and it is where §6.4\'s ±15% is actually decided.\n',
);
console.log(coreWallTable(true));
console.log('\n=== Gameplay §6.4 Tower cores: composed DPS vs marksman ===\n');
console.log(corePowerTable());
console.log(
  '\nbloodforge is deliberately the outlier here: everything it buys is '
  + 'survivability, which\nthis column cannot see. The model prices it where it '
  + 'actually lands — seconds survived once\na wave overruns — which is the wall '
  + 'column above, where it is level with the rest.\n',
);
console.log(coreStatTable());

console.log('\n=== Gameplay §4.1 Loot orbs as a share of wave income ===\n');
console.log(orbFaucetTable());
console.log('\n=== Gameplay §7.8 Pacing faucets: before / after (idle, no blessings) ===\n');
console.log(pacingTable());
console.log(
  `\nCombo tiers: ${COMBO_TIERS.map(t => `${t.kills} kills +${(t.gold * 100).toFixed(0)}%`).join(', ')} `
  + `gold and XP, broken by a ${2}s gap between kills.`
  + `\nEarly call: +${(EARLY_CALL_GOLD_PER_SECOND * 100).toFixed(0)}% gold per second left on `
  + `the ${EARLY_CALL_WINDOW_SECONDS}s call window, momentum capped at `
  + `+${(MOMENTUM_CAP * 100).toFixed(0)}%.`
  + `\nIdle wall-wave drift is zero at every tier, which is the standard Parts 2-6 held.\n`,
);
console.log('\n=== Gameplay §7.8 Risk dial: idle wall wave per step (the drift check) ===\n');
console.log(riskWallTable());
console.log(
  '\nRisk 0 must reproduce the §2.2 table exactly — if it ever does not, the dial has '
  + 'leaked into the baseline.\nThe wall quantises to boss waves, so the same question is '
  + 'asked again below with the draft running,\nwhere it has the resolution to say whether '
  + 'the dial is a *choice*.\n',
);
console.log('\n=== Gameplay §7.8 Risk dial: what a run is worth (drafting, ' + BLESSING_SEEDS.length + ' seeds) ===\n');
console.log(riskRewardTable());
console.log(
  '\nEnemy speed is not modelled — no positions, no tower HP — so the whole cost of '
  + '+40% speed at risk 5\nis missing here. The dial is more attractive in this table than '
  + 'it is in the game.\n',
);
console.log(`\nAscension unlocks at wave ${ASCENSION_UNLOCK_WAVE}.\n`);

console.log('\n=== progress.md §1.1 The prestige ladder (idle, no blessings) ===\n');
console.log(ladderTable(false));
console.log('\n=== progress.md §1.1 The prestige ladder (drafting) ===\n');
console.log(ladderTable(true));
console.log(
  '\nEach row is one ascension: the AP it banks is the next row\'s multiplier, which is '
  + 'the\nonly thing every other table in this file cannot see. `dWall` decaying to +0 means '
  + 'the\nladder has a fixed point — the game stops there however healthy the per-tier tables '
  + 'look.\n',
);
console.log(ladderVerdict(true));
console.log('');
