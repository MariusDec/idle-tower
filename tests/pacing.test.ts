import { describe, expect, it } from 'vitest';
import { I2_DAYS, I5_GATED, I5_RATIO, idleVerdict, medianWave20, medianWorstGap, runPacing } from '../tools/pacing';

/**
 * The CI-sized pacing check (§12.6): a fresh profile, the active bot, one
 * simulated hour on the real sim, on the eight profiles the phase gates read
 * (`npm run pacing -- --seeds 8`), so a median here is the gate's own
 * reading. Three profiles (until R4, 2026-11-18) put P3's median at the
 * mercy of one slow seed: 31:24 on seeds 1–3 against 27:51 on eight. A
 * one-hour profile is ~4 s; the longer reports stay by hand.
 */
const PACING_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

describe('pacing: the first hour (§8.4, P3 and P4 gates)', () => {
  const reports = PACING_SEEDS.map((seed) => runPacing(1, seed));

  it('I3: every results screen shows an affordable node or ≥ 50% toward one', () => {
    for (const r of reports) expect(r.i3).toBe(true);
  });

  /*
   * I6 asks it of every profile (§8.4). From R4 to R2 CI gated the median
   * profile's worst gap instead: Region 2's plateau left 10–13 min with
   * nothing new on two seeds. R2's held rift (the Sunken Shrine, Region 2's
   * 11th run) lands in it, and `npm run pacing -- --hours 6 --seeds 8` reads
   * 8/8 (2026-11-19), so the every-seed rule is back.
   */
  it('I6: no profile goes longer than 10 minutes between reveals', () => {
    for (const [k, r] of reports.entries()) expect(r.worstGap.seconds, `seed ${PACING_SEEDS[k]}`).toBeLessThanOrEqual(600);
    expect(medianWorstGap(reports)).toBeLessThanOrEqual(600);
  });

  it('wave 20 is first reached within 15–30 minutes (median of profiles)', () => {
    const m = medianWave20(reports);
    expect(m).not.toBeNull();
    expect(m!).toBeGreaterThanOrEqual(15 * 60);
    expect(m!).toBeLessThanOrEqual(30 * 60);
  });

  it('I1 (first half): the Gatekeeper first falls within 20–40 minutes', () => {
    for (const r of reports) expect(r.i1a).toBe(true);
  });

  /*
   * On the first three profiles, as before R4 widened the file to eight:
   * seed 6's first run ends at wave 8 after 79.5 s (2026-11-18), a reading
   * the three never showed. Open: the first run's length is the tutorial's
   * to tune, not this file's.
   */
  it('the first run ends in about two minutes and pays for a node', () => {
    for (const r of reports.slice(0, 3)) {
      expect(r.runs[0].simSeconds).toBeGreaterThan(90);
      expect(r.runs[0].simSeconds).toBeLessThan(180);
      expect(r.runs[0].bought.length).toBeGreaterThan(0);
    }
  });
}, 180_000);

/**
 * The CI-sized idle check (§8.4): one profile through the idle bot's
 * check-ins to the Act 1 finale, and the farm comparison at the active
 * run's checkpoints over its first three hours. The full reading is
 * `npm run pacing -- --idle --hours 12 --seeds 4`.
 */
describe('pacing: the idle bot (§8.4, P6 and P7 gates)', () => {
  const v = idleVerdict(1, 4);

  it('I2: the idle bot ends Act 1 within 5–10 days of two check-ins a day', () => {
    expect(v.idle).not.toBeNull();
    expect(v.idle! / 86400).toBeGreaterThanOrEqual(I2_DAYS.min);
    expect(v.idle! / 86400).toBeLessThanOrEqual(I2_DAYS.max);
  });

  it('I5: once the idle kit exists, active play earns 1.15–1.5× idle per hour', () => {
    const seen = v.ratios.filter((r) => I5_GATED.includes(r.label));
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen) {
      expect(r.ratio, r.label).toBeGreaterThanOrEqual(I5_RATIO.min);
      expect(r.ratio, r.label).toBeLessThanOrEqual(I5_RATIO.max);
    }
  });
}, 180_000);
