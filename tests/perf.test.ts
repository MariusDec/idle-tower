import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { buildRunConfig } from '../src/meta/runConfig';
import { createRun, step } from '../src/sim/run';
import { runRegion, spawnEnemy } from '../src/sim/systems/waves';
import { SIM_DT } from '../src/app/loop';
import { botInput } from '../tools/bot';
import { veteran } from '../tools/inspect';
import { PHONE_OVAL, ovalOf } from '../src/content/arena';

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

/**
 * A phone's ellipse, and a squircle (plans/large-screens.md §5.4): `inLight`
 * runs in every targeting loop, and n = 4 must cost no more than n = 2.
 */
const ARENAS = [
  ['a phone', PHONE_OVAL, 6, false, false],
  ['a tablet\'s squircle', ovalOf(1.24, true, 4), 6, false, false],
  // The Bell Marches (plans/late-game/12 §11): the Toll, every body standing between tolls.
  ['a phone, in the Bell Marches', PHONE_OVAL, 9, false, false],
  // Giants' Rest (§11): giants widen every neighbour search, Titans trample, and a Champion Titan towers over them.
  ['a phone, in Giants’ Rest with a Champion Titan', PHONE_OVAL, 12, true, false],
  // The Frozen Sea (§4.3, §11): Glide, a third of the bodies sliding, each slider looking for an impact.
  ['a phone, in the Frozen Sea with a third of the bodies sliding', PHONE_OVAL, 11, false, true],
] as const;

describe('frame budget (§12.5)', () => {
  it.each(ARENAS)(`steps a late build against ${BALANCE.maxEnemies} bodies inside ${STEP_BUDGET_MS} ms on %s`, (_, arena, regionId, champion, sliding) => {
    const run = createRun({ ...buildRunConfig(veteran('all')), regionId, arena }, 11);
    // A real late build: an endless node bought "out" would make every stat infinite.
    for (const [key, v] of Object.entries(run.stats)) expect(Number.isFinite(v), key).toBe(true);
    // Play until the build is grown: four weapons, or the boss wave's door.
    while (!run.outcome && run.wave < 15 && run.weapons.length < 4) step(run, SIM_DT, botInput(run, 'active'));
    run.events.length = 0;
    const region = runRegion(run);
    const types = region.pool.map((p) => p.enemy);
    let spawned = 0;
    if (champion) {
      const c = spawnEnemy(run, region, 'titan', run.wave, 500, 0, { elite: { aura: null, champion: true } });
      c.hp = c.maxHp = 1e12;
    }
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
      // Keep a third of the field sliding, round and round the tower.
      if (sliding) {
        for (const e of run.enemies) {
          if (!e.alive || e.boss || e.id % 3 !== 0 || e.slideX !== 0 || e.slideY !== 0) continue;
          const d = Math.hypot(e.x, e.y) || 1;
          e.slideX = (-e.y / d) * 300;
          e.slideY = (e.x / d) * 300;
        }
      }
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
