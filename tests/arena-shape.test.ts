import { describe, expect, it } from 'vitest';
import {
  ARENA, PHONE_OVAL, inLight, meanRim, ovalOf, rimAxes, rimPoint, rimRadius, spawnPoint, type Oval, type Squareness,
} from '../src/content/arena';
import { stageOval } from '../src/render/camera';
import { formOf } from '../src/app/formFactor';
import { createRun } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { regionByIndex } from '../src/content/regions';
import { arriveBoss } from '../src/sim/systems/boss';

/**
 * The light's shape on large screens (plans/large-screens.md §5, §11.3): a
 * superellipse of squareness n, with n = 2 the phone's ellipse unchanged.
 */
const NS: readonly Squareness[] = [2, 3, 4];
const SHAPES: readonly Oval[] = NS.flatMap((n) => [
  ovalOf(1.92, true, n), ovalOf(1.24, true, n), ovalOf(1, true, n), ovalOf(1.54, false, n), ovalOf(1.78, false, n),
]);
const LIGHTS = [500, 760, 1300];

describe('form factors (§3)', () => {
  it('classes a box by its short side and orientation, with the height guard', () => {
    expect(formOf(375, 812)).toBe('compact');
    expect(formOf(599, 900)).toBe('compact');
    expect(formOf(600, 900)).toBe('medium');
    expect(formOf(1000, 1000)).toBe('medium');
    expect(formOf(1280, 800)).toBe('expanded');
    expect(formOf(1000, 499)).toBe('compact');
    expect(formOf(1000, 500)).toBe('compact'); // short side 500 < 600
    expect(formOf(1000, 600)).toBe('expanded');
    expect(formOf(Number.NaN, 900)).toBe('compact');
  });
});

describe('the light on a phone is the ellipse it was', () => {
  it('every phone stage takes n = 2, so phones cannot drift', () => {
    for (let w = 360; w <= 430; w += 10) {
      for (let h = 640; h <= 932; h += 23) expect(stageOval(w, h).n, `${w}×${h}`).toBe(2);
    }
    // The letterboxed column on a desktop is phone-sized too.
    expect(stageOval(480, 1000).n).toBe(2);
    expect(PHONE_OVAL.n).toBe(2);
  });

  it('large stages square off: medium 3, expanded 3 or 4 by aspect', () => {
    expect(stageOval(768, 1024).n).toBe(3);
    expect(stageOval(1920, 1080).n).toBe(3);
    expect(stageOval(1100, 800).n).toBe(4);
  });

  it('spawns where it always did, bit for bit, at n = 2', () => {
    for (const L of LIGHTS) {
      for (let i = 0; i < 64; i++) {
        const a = i * 0.37;
        const rim = rimAxes(L, PHONE_OVAL);
        expect(spawnPoint(a, L, PHONE_OVAL)).toEqual({
          x: Math.cos(a) * rim.x * ARENA.spawnScale,
          y: Math.sin(a) * rim.y * ARENA.spawnScale,
        });
      }
    }
  });
});

describe('the superellipse (§5.2, §5.3)', () => {
  it('rimPoint lies on the shape, and on the axes at 0, ±π/2 and π', () => {
    for (const oval of SHAPES) {
      for (const L of LIGHTS) {
        const rim = rimAxes(L, oval);
        for (let i = 0; i < 48; i++) {
          const p = rimPoint((i / 48) * Math.PI * 2, L, oval);
          expect(rimRadius(p.x, p.y, rim.x, rim.y, oval.n)).toBeCloseTo(1, 9);
        }
        expect(rimPoint(0, L, oval).x).toBeCloseTo(rim.x, 9);
        expect(rimPoint(Math.PI / 2, L, oval).y).toBeCloseTo(rim.y, 9);
        expect(rimPoint(Math.PI, L, oval).x).toBeCloseTo(-rim.x, 9);
        expect(rimPoint(-Math.PI / 2, L, oval).y).toBeCloseTo(-rim.y, 9);
      }
    }
  });

  it("inLight's edge for a point is the rim scaled by darkScale", () => {
    for (const oval of SHAPES) {
      for (let i = 0; i < 32; i++) {
        const p = rimPoint((i / 32) * Math.PI * 2 + 0.05, 700, oval, ARENA.darkScale);
        expect(inLight(p.x * (1 - 1e-9), p.y * (1 - 1e-9), 0, 700, oval)).toBe(true);
        expect(inLight(p.x * (1 + 1e-6), p.y * (1 + 1e-6), 0, 700, oval)).toBe(false);
      }
    }
  });

  it('spawns outside the rim and inside the dark', () => {
    for (const oval of SHAPES) {
      for (const L of LIGHTS) {
        const rim = rimAxes(L, oval);
        for (let i = 0; i < 24; i++) {
          const p = spawnPoint((i / 24) * Math.PI * 2, L, oval);
          expect(rimRadius(p.x, p.y, rim.x, rim.y, oval.n)).toBeGreaterThan(1);
          expect(inLight(p.x, p.y, 0, L, oval)).toBe(true);
        }
      }
    }
  });

  it('never accepts a body wholly past the dark, at any n (the corners included)', () => {
    // The opaque edge, densely sampled: a body is in reach only if its disc touches inside it.
    for (const oval of SHAPES) {
      const L = 600;
      const edge = Array.from({ length: 2048 }, (_, i) => rimPoint((i / 2048) * Math.PI * 2, L, oval, ARENA.darkScale));
      const rim = rimAxes(L, oval);
      let seed = 7;
      const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 600; k++) {
        const t = rand() * Math.PI * 2;
        const r = 4 + rand() * 120;
        const p = rimPoint(t, L, oval, ARENA.darkScale * (0.98 + rand() * 0.3));
        if (!inLight(p.x, p.y, r, L, oval)) continue;
        const inside = rimRadius(p.x, p.y, rim.x * ARENA.darkScale, rim.y * ARENA.darkScale, oval.n) <= 1;
        const gap = Math.min(...edge.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
        // The sampled edge is a polyline: allow its chord error.
        expect(inside || gap <= r + 2, `n ${oval.n} at ${p.x.toFixed(0)}, ${p.y.toFixed(0)} r ${r.toFixed(0)}`).toBe(true);
      }
    }
  });

  it('squarer is a longer walk: the mean rim grows with n', () => {
    for (const aspect of [1, 1.24, 1.92]) {
      const means = NS.map((n) => meanRim(500, ovalOf(aspect, true, n)));
      expect(means[1]).toBeGreaterThan(means[0]);
      expect(means[2]).toBeGreaterThan(means[1]);
    }
  });
});

describe('the opening and the boss come from the short axis (§5.5)', () => {
  it('a boss arrives from a flank on a tall light, from above or below on a wide one', () => {
    for (const [arena, axis] of [[PHONE_OVAL, 'x'], [ovalOf(1.24, true, 3), 'x'], [ovalOf(1.54, false, 3), 'y'], [ovalOf(1.78, false, 2), 'y']] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        const run = createRun({ ...buildRunConfig(newProfile(0)), arena }, seed);
        arriveBoss(run, regionByIndex(1));
        const boss = run.enemies.find((e) => e.id === run.boss!.enemy)!;
        const rim = rimAxes(run.stats.light, arena);
        // On the short axis's end: the other coordinate is (all but) zero.
        if (axis === 'x') expect(Math.abs(boss.y)).toBeLessThan(1e-6 * rim.y);
        else expect(Math.abs(boss.x)).toBeLessThan(1e-6 * rim.x);
      }
    }
  });
});
