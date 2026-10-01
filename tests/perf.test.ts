import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { buildRunConfig } from '../src/meta/runConfig';
import { createRun, step } from '../src/sim/run';
import { runRegion, spawnEnemy } from '../src/sim/systems/waves';
import { SIM_DT } from '../src/app/loop';
import { botInput } from '../tools/bot';
import { veteran } from '../tools/inspect';

/**
 * The frame budget (§12.5), headless: the sim's share of a frame with a
 * late build (every Forge node, the bot's draft, evolutions as they come)
 * against a full field. The browser half, the renderer at each quality
 * tier, is the dev harness `tower.bench` (docs/performance.md); this half
 * runs in CI.
 *
 * At 3× the app runs three steps a frame, and a mid-range phone is several
 * times slower than a dev machine, so a step must stay well under a
 * millisecond here. The ceiling below is loose enough for a busy CI box.
 */
const STEP_BUDGET_MS = 2;
/** Steps measured once the field is full, after a warm-up. */
const WARMUP = 120;
const MEASURE = 600;

describe('frame budget (§12.5)', () => {
  it(`steps a late build against ${BALANCE.maxEnemies} bodies inside ${STEP_BUDGET_MS} ms`, () => {
    const run = createRun({ ...buildRunConfig(veteran('all')), regionId: 6 }, 11);
    // Play until the build is grown: four weapons, or the boss wave's door.
    while (!run.outcome && run.wave < 15 && run.weapons.length < 4) step(run, SIM_DT, botInput(run, 'active'));
    run.events.length = 0;
    const region = runRegion(run);
    const types = region.pool.map((p) => p.enemy);
    let spawned = 0;
    const fill = (): void => {
      let alive = 0;
      for (const e of run.enemies) if (e.alive) alive++;
      for (let i = alive; i < BALANCE.maxEnemies; i++, spawned++) {
        const a = (spawned * 2.399) % (Math.PI * 2);
        const d = 420 + (spawned % 7) * 70;
        // Bodies that never fall: the worst case is a full field being shot at, not a field refilling.
        const e = spawnEnemy(run, region, types[spawned % types.length], run.wave, Math.cos(a) * d, Math.sin(a) * d);
        e.hp = e.maxHp = 1e12;
      }
      run.tower.hp = run.stats.maxHp;
    };
    const times: number[] = [];
    for (let i = 0; i < WARMUP + MEASURE && !run.outcome; i++) {
      fill();
      const t0 = performance.now();
      step(run, SIM_DT, botInput(run, 'active'));
      if (i >= WARMUP) times.push(performance.now() - t0);
      run.events.length = 0;
    }
    expect(run.weapons.length).toBeGreaterThanOrEqual(3);
    expect(times.length).toBe(MEASURE);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    expect(mean, `mean step ${mean.toFixed(2)} ms with ${run.weapons.map((w) => w.id).join(', ')}`).toBeLessThan(STEP_BUDGET_MS);
  });
});
