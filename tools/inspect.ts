/**
 * Inspect (§13): one seeded run → a per-wave table.
 *
 *   npm run inspect -- --seed 7            one run, per-wave table
 *   npm run inspect -- --seeds 50          many runs, death-wave distribution
 *   npm run inspect -- --seed 7 --max 600  cap the run at 600 s
 *
 * Headless: it drives the real sim, not a model of it.
 */
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { WEAPON_BY_ID } from '../src/content/weapons';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { regionByIndex } from '../src/content/regions';
import { waveHp } from '../src/sim/systems/waves';
import type { RunState } from '../src/sim/state';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

interface WaveRow {
  wave: number;
  start: number;
  bodies: number;
  hpPool: number;
  /** Bodies from earlier waves still alive when this wave started. */
  carried: number;
  damageTaken: number;
  kills: number;
  hpAtEnd: number;
  duration: number;
}

/** Theoretical sustained DPS of the build, crits included. */
function buildDps(run: RunState): number {
  const s = run.stats;
  let dps = 0;
  for (const w of run.weapons) {
    const d = WEAPON_BY_ID[w.id];
    dps += d.damage * s.damageMult * d.fireRate * s.fireRateMult;
  }
  return dps * (1 + s.critChance * (s.critMult - 1));
}

export interface RunReport {
  rows: WaveRow[];
  firstKill: number | null;
  run: RunState;
}

export function simulate(seed: number, maxSeconds: number): RunReport {
  const run = createRun(buildRunConfig(newProfile(0)), seed);
  const region = regionByIndex(run.regionId);
  const rows: WaveRow[] = [];
  let row: WaveRow | null = null;
  let firstKill: number | null = null;
  const maxTicks = Math.round(maxSeconds / SIM_DT);
  while (!run.outcome && run.tick < maxTicks) {
    step(run, SIM_DT);
    for (const ev of run.events) {
      if (ev.kind === 'waveStart') {
        if (row) {
          row.duration = run.time - row.start;
          row.hpAtEnd = run.tower.hp;
        }
        const cur = run.current!;
        row = {
          wave: ev.wave,
          start: run.time,
          bodies: cur.spawns.length,
          hpPool: cur.spawns.reduce((sum, sp) => sum + ENEMY_BY_ID[sp.enemy].hp * waveHp(region, ev.wave), 0),
          carried: run.enemies.filter((e) => e.alive).length,
          damageTaken: 0,
          kills: 0,
          hpAtEnd: 0,
          duration: 0,
        };
        rows.push(row);
      } else if (ev.kind === 'towerHit' && row) {
        row.damageTaken += ev.amount;
      } else if (ev.kind === 'kill') {
        if (row) row.kills++;
        if (firstKill === null) firstKill = run.time;
      }
    }
    run.events.length = 0;
  }
  if (row) {
    row.duration = run.time - row.start;
    row.hpAtEnd = Math.max(0, run.tower.hp);
  }
  return { rows, firstKill, run };
}

function pad(v: string | number, n: number): string {
  return String(v).padStart(n);
}

function main(): void {
  const maxSeconds = arg('max', 1800);
  const seeds = arg('seeds', 0);
  if (seeds > 0) {
    const deaths = new Map<number, number>();
    const firsts: number[] = [];
    for (let s = 1; s <= seeds; s++) {
      const r = simulate(s, maxSeconds);
      deaths.set(r.run.wave, (deaths.get(r.run.wave) ?? 0) + 1);
      if (r.firstKill !== null) firsts.push(r.firstKill);
    }
    firsts.sort((a, b) => a - b);
    console.log(`${seeds} runs, no upgrades`);
    console.log(`first kill: median ${firsts[firsts.length >> 1]?.toFixed(2)}s, worst ${firsts[firsts.length - 1]?.toFixed(2)}s`);
    console.log('death wave: ' + [...deaths.entries()].sort((a, b) => a[0] - b[0]).map(([w, n]) => `w${w}×${n}`).join('  '));
    return;
  }
  const seed = arg('seed', 1);
  const r = simulate(seed, maxSeconds);
  const dps = buildDps(r.run);
  console.log(`seed ${seed} · build DPS ${dps.toFixed(1)} · first kill ${r.firstKill?.toFixed(2) ?? '—'}s`);
  console.log('wave  start  dur  bodies  pool   clear  carried  taken  kills  hp');
  for (const w of r.rows) {
    const clear = w.hpPool / dps;
    console.log(
      `${pad(w.wave, 4)} ${pad(w.start.toFixed(1), 6)} ${pad(w.duration.toFixed(1), 4)} ${pad(w.bodies, 7)}`
      + ` ${pad(Math.round(w.hpPool), 5)} ${pad(clear.toFixed(1), 6)} ${pad(w.carried, 8)}`
      + ` ${pad(Math.round(w.damageTaken), 6)} ${pad(w.kills, 6)} ${pad(Math.round(w.hpAtEnd), 4)}`,
    );
  }
  const o = r.run.outcome;
  console.log(o ? `${o.kind} at wave ${o.wave}, ${o.time.toFixed(1)}s` : `still standing at ${r.run.time.toFixed(0)}s`);
}

main();
