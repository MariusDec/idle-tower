import { describe, expect, it } from 'vitest';
import { I2_DAYS, I5_GATED, I5_RATIO, idleVerdict, medianWave20, runPacing } from '../tools/pacing';

/**
 * The CI-sized pacing check (§12.6): a fresh profile, the active bot, one
 * simulated hour on the real sim, three profiles. The full report is
 * `npm run pacing -- --seeds 8`, run by hand at each phase gate.
 */
describe('pacing: the first hour (§8.4, P3 and P4 gates)', () => {
  const reports = [1, 2, 3].map((seed) => runPacing(1, seed));

  it('I3: every results screen shows an affordable node or ≥ 50% toward one', () => {
    for (const r of reports) expect(r.i3).toBe(true);
  });

  it('I6: no gap between reveals longer than 10 minutes', () => {
    for (const r of reports) expect(r.worstGap.seconds).toBeLessThanOrEqual(600);
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

  it('the first run ends in about two minutes and pays for a node', () => {
    for (const r of reports) {
      expect(r.runs[0].simSeconds).toBeGreaterThan(90);
      expect(r.runs[0].simSeconds).toBeLessThan(180);
      expect(r.runs[0].bought.length).toBeGreaterThan(0);
    }
  });
}, 120_000);

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
