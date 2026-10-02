import { describe, expect, it } from 'vitest';
import { calibrate, drifted, MAX_DRIFT } from '../tools/calibrate';

/**
 * T2: the draft scorer's damage estimate stays within reach of what the sim
 * lands, for every weapon at levels 1, 3 and 5, and evolved. A change to a
 * weapon's firing that the estimate doesn't follow fails here, by name.
 */
describe('the scorer knows its own accuracy (T2)', () => {
  it(`every weapon's estimate is within ${MAX_DRIFT * 100}% of the sim`, () => {
    const off = drifted(calibrate()).map((r) => `${r.weapon} L${r.level}${r.evolved ? ' evolved' : ''}: ×${r.ratio.toFixed(2)}`);
    expect(off).toEqual([]);
  });
});
