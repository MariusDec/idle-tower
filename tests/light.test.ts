import { describe, expect, it } from 'vitest';
import { ARENA, PHONE_OVAL, inLight, ovalOf, spawnPoint } from '../src/content/arena';
import { damageEnemy, targetable } from '../src/sim/systems/combat';
import { runRegion, spawnEnemy } from '../src/sim/systems/waves';
import { BALANCE } from '../src/content/balance';
import { BOSSES } from '../src/content/bosses';
import { ENEMIES } from '../src/content/enemies';
import { buildRunConfig } from '../src/meta/runConfig';
import { createRun, step } from '../src/sim/run';
import { SIM_DT } from '../src/app/loop';
import { botInput } from '../tools/bot';
import { veteran } from '../tools/inspect';

/**
 * The rule (plans/camera-and-fog.md §2, checked as §7 asks): what the tower
 * can hit ⊆ what's lit. A late build, every Forge node owned, played by the
 * active bot: on every tick the range ring is inside the light, and no hit
 * lands on a body wholly outside it. Played on a phone's oval and a wide
 * stage's, the two shapes a run may take.
 */
const BIGGEST = Math.max(
  ...ENEMIES.map((d) => d.radius * BALANCE.elites.scale),
  ...BOSSES.map((b) => b.radius),
);

describe('the light (camera-and-fog §2)', () => {
  it('no body is hit outside the light, and range + margin ≤ L on every tick', () => {
    for (const [regionId, arena] of [[1, PHONE_OVAL], [6, ovalOf(1.6, false)]] as const) {
      const run = createRun({ ...buildRunConfig(veteran('all')), regionId, arena }, 3);
      let hits = 0;
      while (!run.outcome && run.time < 150) {
        const before = run.stats.light;
        step(run, SIM_DT, botInput(run, 'active'));
        const light = Math.max(before, run.stats.light);
        expect(run.stats.range + ARENA.lightMargin).toBeLessThanOrEqual(run.stats.light + 1e-9);
        for (const e of run.events) {
          if (e.kind !== 'hit') continue;
          hits++;
          expect(inLight(e.x, e.y, BIGGEST, light, run.arena), `tick ${run.tick} at ${e.x.toFixed(0)}, ${e.y.toFixed(0)}`).toBe(true);
        }
        run.events.length = 0;
      }
      expect(hits).toBeGreaterThan(100);
    }
  }, 60_000);

  it('a body in the full dark cannot be hit; one just spawned, under the rim, can', () => {
    for (const arena of [PHONE_OVAL, ovalOf(1.6, false)]) {
      const run = createRun({ ...buildRunConfig(veteran('none')), arena }, 5);
      const region = runRegion(run);
      for (const angle of [0, Math.PI / 2, 2.4]) {
        const p = spawnPoint(angle, run.stats.light, run.arena);
        const e = spawnEnemy(run, region, 'grunt', 1, p.x * 1.2, p.y * 1.2);
        e.radius = 0;
        expect(targetable(run, e)).toBe(false);
        expect(damageEnemy(run, e, 1, false)).toBe(0);
        e.x = p.x;
        e.y = p.y;
        expect(targetable(run, e)).toBe(true);
        expect(damageEnemy(run, e, 1, false)).toBeGreaterThan(0);
      }
    }
  });
});
