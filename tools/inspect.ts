/**
 * Inspect (§13): one seeded run → a per-wave table.
 *
 * P0 stub: proves the sim runs headless. P1 fills in the per-wave table.
 */
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';

const seed = Number(process.argv[process.argv.indexOf('--seed') + 1]) || 1;
const run = createRun(buildRunConfig(newProfile(0)), seed);
for (let i = 0; i < 60 * 10; i++) step(run, SIM_DT);
console.log(`seed ${seed}: t=${run.time.toFixed(2)}s wave=${run.wave} hp=${run.tower.hp}`);
