/**
 * Inspect (§13): one seeded run → a per-wave table.
 *
 *   npm run inspect -- --seed 7            one bot-drafted run, per-wave table
 *   npm run inspect -- --seeds 50          many runs: death waves, level-up pace, builds
 *   npm run inspect -- --seed 7 --bare     a level-1 tower that never drafts
 *   npm run inspect -- --seed 7 --max 600  cap the run at 600 s
 *   npm run inspect -- --forge ring1       a Forge preset: none (default), arsenal
 *                                          (P2's loadout), ring1 or all, bought out
 *   npm run inspect -- --region 2          a region other than the first (its rule applies)
 *
 * Headless: it drives the real sim, not a model of it.
 */
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile, type Profile } from '../src/meta/profile';
import { FORGE } from '../src/content/forge';
import { SIM_DT } from '../src/app/loop';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { regionByIndex } from '../src/content/regions';
import { waveHp } from '../src/sim/systems/waves';
import { buildDps } from '../src/sim/suggest';
import type { RunState } from '../src/sim/state';
import { botInput, type Policy } from './bot';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

interface WaveRow {
  wave: number;
  start: number;
  level: number;
  dps: number;
  bodies: number;
  hpPool: number;
  /** Bodies from earlier waves still alive when this wave started. */
  carried: number;
  damageTaken: number;
  kills: number;
  hpAtEnd: number;
  duration: number;
}

export interface RunReport {
  rows: WaveRow[];
  firstKill: number | null;
  /** Run time of each level-up. */
  levelUps: number[];
  ultCasts: number;
  run: RunState;
}

export type ForgePreset = 'none' | 'arsenal' | 'ring1' | 'all';

/**
 * A profile past the first-draft lesson, so every run rolls its drafts, with
 * a Forge preset bought out: `arsenal` is the loadout P2's gate was measured
 * on (weapon slot 2, Scattershot, Chain Lightning).
 */
export function veteran(preset: ForgePreset = 'none'): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  if (preset === 'arsenal') p.forge = { 'might-damage': 1, scattershot: 1, 'chain-lightning': 1 };
  if (preset === 'ring1' || preset === 'all') {
    for (const n of FORGE) if (preset === 'all' || n.ring === 1) p.forge[n.id] = n.maxLevel;
  }
  return p;
}

export function simulate(seed: number, maxSeconds: number, policy: Policy, preset: ForgePreset = 'none', regionIndex = 1): RunReport {
  const run = createRun({ ...buildRunConfig(veteran(preset)), regionId: regionIndex }, seed);
  const region = regionByIndex(run.regionId);
  const rows: WaveRow[] = [];
  const levelUps: number[] = [];
  let row: WaveRow | null = null;
  let firstKill: number | null = null;
  let ultCasts = 0;
  const maxTicks = Math.round(maxSeconds / SIM_DT);
  while (!run.outcome && run.tick < maxTicks) {
    step(run, SIM_DT, botInput(run, policy));
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
          level: run.level,
          dps: buildDps(run.weapons, run.stats),
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
      } else if (ev.kind === 'levelUp') {
        levelUps.push(run.time);
      } else if (ev.kind === 'nova') {
        ultCasts++;
      }
    }
    run.events.length = 0;
  }
  if (row) {
    row.duration = run.time - row.start;
    row.hpAtEnd = Math.max(0, run.tower.hp);
  }
  return { rows, firstKill, levelUps, ultCasts, run };
}

/** The build, e.g. "arcane-bolt 5 · scattershot 3 | power 4 · fortify 2". */
export function describeBuild(run: RunState): string {
  const w = run.weapons.map((x) => `${x.id} ${x.level}`).join(' · ');
  const p = run.passives.map((x) => `${x.id} ${x.level}`).join(' · ');
  return p ? `${w} | ${p}` : w;
}

function pad(v: string | number, n: number): string {
  return String(v).padStart(n);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] ?? NaN;
}

function main(): void {
  const maxSeconds = arg('max', 1800);
  const seeds = arg('seeds', 0);
  const policy: Policy = flag('bare') ? 'bare' : 'active';
  const fi = process.argv.indexOf('--forge');
  const preset = (fi >= 0 ? process.argv[fi + 1] : 'none') as ForgePreset;
  const region = arg('region', 1);
  if (seeds > 0) {
    const deaths = new Map<number, number>();
    const firsts: number[] = [];
    const firstLevel: number[] = [];
    const early: number[] = [];
    const late: number[] = [];
    const loadouts = new Map<string, number>();
    const waves: number[] = [];
    const lengths: number[] = [];
    for (let s = 1; s <= seeds; s++) {
      const r = simulate(s, maxSeconds, policy, preset, region);
      deaths.set(r.run.wave, (deaths.get(r.run.wave) ?? 0) + 1);
      waves.push(r.run.wave);
      lengths.push(r.run.time);
      if (r.firstKill !== null) firsts.push(r.firstKill);
      if (r.levelUps.length > 0) firstLevel.push(r.levelUps[0]);
      r.levelUps.forEach((t, i) => {
        if (i === 0) return;
        const gap = t - r.levelUps[i - 1];
        (t < 90 ? early : late).push(gap);
      });
      const key = r.run.weapons.map((w) => w.id).sort().join(' + ');
      loadouts.set(key, (loadouts.get(key) ?? 0) + 1);
    }
    console.log(`${seeds} runs, policy ${policy}, forge ${preset}, region ${region}`);
    console.log(`first kill: median ${median(firsts).toFixed(2)}s, worst ${Math.max(...firsts).toFixed(2)}s`);
    console.log(`death wave: median ${median(waves)} · ` + [...deaths.entries()].sort((a, b) => a[0] - b[0]).map(([w, n]) => `w${w}×${n}`).join('  '));
    console.log(`run length: median ${median(lengths).toFixed(0)}s`);
    if (firstLevel.length > 0) {
      console.log(`level-ups: first median ${median(firstLevel).toFixed(1)}s · gap before 1:30 median ${median(early).toFixed(1)}s · after ${median(late).toFixed(1)}s`);
    }
    console.log('loadouts: ' + [...loadouts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join('  ·  '));
    return;
  }
  const seed = arg('seed', 1);
  const r = simulate(seed, maxSeconds, policy, preset, region);
  console.log(`seed ${seed} · policy ${policy} · forge ${preset} · region ${region} · first kill ${r.firstKill?.toFixed(2) ?? '—'}s · ${r.levelUps.length} level-ups · ${r.ultCasts} novas`);
  console.log('wave  start  dur  lvl    dps  bodies   pool   clear  carried  taken  kills  hp');
  for (const w of r.rows) {
    const clear = w.hpPool / w.dps;
    console.log(
      `${pad(w.wave, 4)} ${pad(w.start.toFixed(1), 6)} ${pad(w.duration.toFixed(1), 4)} ${pad(w.level, 4)} ${pad(w.dps.toFixed(0), 6)}`
      + ` ${pad(w.bodies, 7)} ${pad(Math.round(w.hpPool), 6)} ${pad(clear.toFixed(1), 7)} ${pad(w.carried, 8)}`
      + ` ${pad(Math.round(w.damageTaken), 6)} ${pad(w.kills, 6)} ${pad(Math.round(w.hpAtEnd), 4)}`,
    );
  }
  console.log(`build: ${describeBuild(r.run)}`);
  const b = r.run.boss;
  if (b) console.log(`boss ${b.id}: ${b.killedIn === null ? 'stood' : `fell in ${b.killedIn.toFixed(1)}s`}${b.enraged ? ' (enraged)' : ''}`);
  const o = r.run.outcome;
  console.log(o ? `${o.kind} at wave ${o.wave}, ${o.time.toFixed(1)}s` : `still standing at ${r.run.time.toFixed(0)}s`);
}

// Only when run as the script, so tests can import `simulate`.
if (process.argv[1]?.includes('inspect')) main();
