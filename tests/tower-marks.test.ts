/**
 * The tower-mark table (`plans/tower-ui.md`).
 *
 * Marks are presentation, so nothing here checks a balance number. What it does
 * check is the two ways the table can be silently wrong: a threshold ladder
 * that is not monotonic (so a step can never be reached), and an `announce`
 * list that does not line up with it (so a toast reads the wrong line or
 * `undefined`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TOWER_MARKS, TOWER_MARK_IDS, TOWER_MARK_BY_ID, DEFAULT_TOWER_MARKS,
  computeTowerMarks,
} from '../src/data/towerMarks';
import { UPGRADE_BY_ID } from '../src/data/upgrades';
import { ICON_IDS } from '../src/data/icons';

describe('the tower-mark table', () => {
  it('has a unique id per mark', () => {
    expect(new Set(TOWER_MARK_IDS).size).toBe(TOWER_MARKS.length);
  });

  for (const def of TOWER_MARKS) {
    describe(def.id, () => {
      it('names only real upgrades', () => {
        expect(def.sources.length).toBeGreaterThan(0);
        for (const id of def.sources) {
          expect(UPGRADE_BY_ID[id], `${def.id} sources unknown upgrade "${id}"`).toBeDefined();
        }
      });

      it('has an ascending, positive threshold ladder', () => {
        expect(def.thresholds.length).toBeGreaterThan(0);
        for (let i = 0; i < def.thresholds.length; i++) {
          expect(def.thresholds[i]).toBeGreaterThan(0);
          if (i > 0) expect(def.thresholds[i]).toBeGreaterThan(def.thresholds[i - 1]);
        }
      });

      it('can actually reach its top step', () => {
        // `sum` marks add their sources' caps; `max` marks take the largest.
        const caps = def.sources.map(id => UPGRADE_BY_ID[id].maxLevel);
        const reachable = def.combine === 'sum'
          ? caps.reduce((a, b) => a + b, 0)
          : Math.max(...caps);
        const top = def.thresholds[def.thresholds.length - 1];
        expect(reachable, `${def.id} step ${def.thresholds.length} is unreachable`)
          .toBeGreaterThanOrEqual(top);
      });

      it('announces every step exactly once', () => {
        expect(def.announce.length).toBe(def.thresholds.length);
        for (const line of def.announce) expect(line.trim().length).toBeGreaterThan(0);
      });

      it('names an icon that exists', () => {
        expect(ICON_IDS).toContain(def.icon);
      });
    });
  }
});

describe('computeTowerMarks', () => {
  it('is all-zero for a fresh set of levels', () => {
    expect(DEFAULT_TOWER_MARKS.steps.barrel).toBe(0);
    expect(DEFAULT_TOWER_MARKS.key).toBe('0.'.repeat(TOWER_MARKS.length));
  });

  it('steps exactly at the threshold, not one level early or late', () => {
    for (const def of TOWER_MARKS) {
      const at = def.thresholds[0];
      const below: Record<string, number> = {};
      const on: Record<string, number> = {};
      // Put the whole combined level on the first source; for `sum` that is
      // the same total, for `max` it is the max.
      below[def.sources[0]] = at - 1;
      on[def.sources[0]] = at;
      expect(computeTowerMarks(below).steps[def.id], `${def.id} stepped early`).toBe(0);
      expect(computeTowerMarks(on).steps[def.id], `${def.id} did not step`).toBe(1);
    }
  });

  it('sums the sources of a `sum` mark and takes the max of a `max` one', () => {
    const optics = TOWER_MARK_BY_ID.optics;
    const half = Math.ceil(optics.thresholds[0] / 2);
    const split = { critChance: half, critDamage: optics.thresholds[0] - half };
    expect(computeTowerMarks(split).steps.optics).toBe(1);

    const barrel = TOWER_MARK_BY_ID.barrel;
    expect(barrel.combine).toBe('max');
    expect(computeTowerMarks({ damage: barrel.thresholds[0] }).steps.barrel).toBe(1);
  });

  it('gives a different key to a different set of steps', () => {
    const a = computeTowerMarks({ damage: 4 });
    const b = computeTowerMarks({ damage: 12 });
    expect(a.key).not.toBe(b.key);
    expect(a.key).not.toBe(DEFAULT_TOWER_MARKS.key);
  });

  it('freezes what it returns, so the renderer can hold it by reference', () => {
    const marks = computeTowerMarks({ damage: 30 });
    expect(Object.isFrozen(marks)).toBe(true);
    expect(Object.isFrozen(marks.steps)).toBe(true);
  });
});

/**
 * The coverage guard: a mark nobody paints is flavour text, exactly like the
 * twenty dead talents `tests/content-coverage.test.ts` was written for.
 */
describe('every mark is consumed by the renderer', () => {
  const RENDERER = readFileSync(resolve(__dirname, '../src/game/Renderer.ts'), 'utf8');
  for (const id of TOWER_MARK_IDS) {
    it(`${id} is read in Renderer.ts`, () => {
      // The painters either read `this.marks.steps.${id}` directly or destructure
      // to a local (`const m = this.marks.steps; m.${id}`). Either proves the
      // mark is consumed — what we are catching here is a mark that *isn't*.
      const consumed = RENDERER.includes(`steps.${id}`) || RENDERER.includes(`m.${id}`);
      expect(
        consumed,
        `no painter reads \`this.marks.steps.${id}\` — the mark changes nothing on screen`,
      ).toBe(true);
    });
  }
});

describe('the tower sprite cache is evictable', () => {
  const RENDERER = readFileSync(resolve(__dirname, '../src/game/Renderer.ts'), 'utf8');

  it('paints the drum, plinth, turret and wall through `towerPart`', () => {
    for (const family of ["'drum'", "'plinth'", "'turret'", '`wall|${state}`']) {
      expect(
        RENDERER.includes(`towerPart(${family}`),
        `${family} must be baked in the evictable tower cache, not in \`part\` — `
        + 'the mark key space is combinatorial (see plans/tower-ui.md §C)',
      ).toBe(true);
    }
  });

  it('clears that cache when the signature moves', () => {
    expect(RENDERER).toContain('this.towerSprites.clear()');
  });
});
