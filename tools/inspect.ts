/**
 * Inspect (§13): one seeded run → a per-wave table.
 *
 *   npm run inspect -- --seed 7            one bot-drafted run, per-wave table
 *   npm run inspect -- --seeds 50          many runs: death waves, level-up pace, builds
 *   npm run inspect -- --seed 7 --bare     a level-1 tower that never drafts
 *   npm run inspect -- --seed 7 --max 600  cap the run at 600 s
 *   npm run inspect -- --forge ring1       a Forge preset: none (default), arsenal
 *                                          (P2's loadout), ring1–ring6 (every ring up
 *                                          to it) or all, bought out, keystones aside
 *   npm run inspect -- --region 2          a region other than the first (its rule applies)
 *   npm run inspect -- --seeds 20 --by-weapon
 *                                          the share of damage landed by each weapon (T1)
 *   npm run inspect -- --seeds 200 --forge ring4 --region 3 --secrets
 *                                          every secret live (plans/late-game/05 §8):
 *                                          how often each is stirred and found;
 *                                          add --uncapped for each tally's raw spread
 *
 * Headless: it drives the real sim, not a model of it.
 */
import { RIFT_BY_ID } from '../src/content/rifts';
import { BALANCE } from '../src/content/balance';
import { SECRETS } from '../src/content/secrets';
import { EVOLUTIONS } from '../src/content/evolutions';
import type { SecretConfig } from '../src/sim/state';
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile, type Profile } from '../src/meta/profile';
import { FORGE } from '../src/content/forge';
import { SIM_DT } from '../src/app/loop';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { regionByIndex } from '../src/content/regions';
import { waveHp } from '../src/sim/systems/waves';
import { buildDps } from '../src/sim/suggest';
import type { DamageBy, RunState } from '../src/sim/state';
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
  /** The rift met in this wave (`--rifts`): taken (#choice), left or shut. */
  rift: string;
}

export interface RunReport {
  rows: WaveRow[];
  firstKill: number | null;
  /** Run time of each level-up. */
  levelUps: number[];
  ultCasts: number;
  run: RunState;
}

export type ForgePreset = 'none' | 'arsenal' | `ring${1 | 2 | 3 | 4 | 5 | 6}` | 'all';

/**
 * A profile past the first-draft lesson, so every run rolls its drafts, with
 * a Forge preset bought out: `arsenal` is the loadout P2's gate was measured
 * on (weapon slot 2, Scattershot, Chain Lightning).
 */
export function veteran(preset: ForgePreset = 'none'): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  if (preset === 'arsenal') p.forge = { 'might-damage': 1, scattershot: 1, 'chain-lightning': 1 };
  // `ringN` buys out every ring up to N; `all`, the whole web. Keystones are
  // builds, chosen on purpose (§5.1), so a preset leaves them alone; a
  // mastery (§9) has no last level to buy out, and is Act 2's.
  const upTo = preset === 'all' ? Infinity : preset.startsWith('ring') ? Number(preset.slice(4)) : 0;
  if (upTo > 0) {
    for (const n of FORGE) if (n.type !== 'keystone' && n.type !== 'mastery' && n.ring <= upTo) p.forge[n.id] = n.maxLevel;
  }
  return p;
}

/**
 * `--rifts` (plans/late-game/02 §8): the run rolls rifts as a profile past
 * the First Tear would, and the active bot opens them.
 */
const RIFTS_ON = { first: false, known: [], act2: false } as const;

/** `--secrets` (plans/late-game/05 §8): every secret live, none heard, and no boss's first kill (so forms may come). */
const SECRETS_ON: SecretConfig = { live: SECRETS.map((x) => x.id), heard: [], found: [], tally: {} };

export function simulate(
  seed: number, maxSeconds: number, policy: Policy, preset: ForgePreset = 'none', regionIndex = 1, rifts = false, secrets = false,
): RunReport {
  const base = buildRunConfig(veteran(preset));
  const run = createRun({
    ...base, regionId: regionIndex, rifts: rifts ? RIFTS_ON : null,
    // A late-Act-1 player knows every recipe, so the suggestion steers toward evolutions (frost needs Absolute Zero).
    ...(secrets ? { secrets: SECRETS_ON, firstKill: false, recipes: EVOLUTIONS.map((e) => e.id) } : {}),
  }, seed);
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
          rift: '',
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
      } else if (ev.kind === 'riftTaken' && row) {
        row.rift = `${ev.id}${ev.choice === null ? '·left' : `#${ev.choice + 1}`}`;
      } else if (ev.kind === 'riftShut' && row) {
        row.rift = `${ev.id}·shut`;
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

/** Damage landed by each source, largest first, as shares: "arcane-bolt 62% · mortar 30% · ult 8%". */
export function describeDamage(by: Partial<Record<DamageBy, number>>): string {
  const total = Object.values(by).reduce((a, b) => a + (b ?? 0), 0) || 1;
  return (Object.entries(by) as [DamageBy, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`)
    .join(' · ');
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
  const rifts = flag('rifts');
  const secrets = flag('secrets');
  // `--uncapped`: lift every tally's goal, so the counts show each run's raw spread (a tool's view only).
  if (secrets && flag('uncapped')) for (const def of SECRETS) if (def.trigger.kind === 'tally') (def.trigger as { n: number }).n = 1e9;
  if (seeds > 0) {
    /** Per secret: runs whose tally reached its stir share, and runs that found it. */
    const met = new Map<string, { stir: number; found: number }>(SECRETS.map((x) => [x.id, { stir: 0, found: 0 }]));
    /** Per tally secret: each run's count, to pick a goal from (plans/late-game/05 §8). */
    const counts = new Map<string, number[]>(SECRETS.map((x) => [x.id, []]));
    const riftCounts: number[] = [];
    let past12 = 0;
    let past12Rift = 0;
    let onBoss = 0;
    const legend = { runs: 0, fell: 0 };
    const deaths = new Map<number, number>();
    const firsts: number[] = [];
    const firstLevel: number[] = [];
    const early: number[] = [];
    const late: number[] = [];
    const loadouts = new Map<string, number>();
    const waves: number[] = [];
    const lengths: number[] = [];
    const dealt: Partial<Record<DamageBy, number>> = {};
    for (let s = 1; s <= seeds; s++) {
      const r = simulate(s, maxSeconds, policy, preset, region, rifts, secrets);
      if (secrets && r.run.secrets) {
        const S = r.run.secrets;
        for (const def of SECRETS) {
          counts.get(def.id)!.push(S.counts[def.id] ?? 0);
          const m = met.get(def.id)!;
          const t = def.trigger;
          const reached = t.kind === 'tally' ? (S.counts[def.id] ?? 0) >= Math.ceil(t.n * BALANCE.secrets.stirAt) : S.stirred === def.id || S.sighted.includes(def.id);
          if (reached || S.fresh.includes(def.id)) m.stir++;
          if (S.fresh.includes(def.id)) m.found++;
        }
      }
      if (rifts) {
        const log = r.run.riftLog;
        riftCounts.push(log.filter((e) => e.wave <= 20).length);
        if (r.run.wave > 12) {
          past12++;
          if (log.some((e) => e.wave <= 12)) past12Rift++;
        }
        onBoss += log.filter((e) => e.wave === 20).length;
        if (log.some((e) => e.choice !== null && RIFT_BY_ID[e.id].rarity === 'legendary')) {
          legend.runs++;
          if (r.run.outcome?.kind === 'fell' && r.run.wave <= 20) legend.fell++;
        }
      }
      deaths.set(r.run.wave, (deaths.get(r.run.wave) ?? 0) + 1);
      waves.push(r.run.wave);
      lengths.push(r.run.time);
      // Each run counts once, whatever its length: its shares, not its totals.
      const total = Object.values(r.run.damageBy).reduce((a, b) => a + (b ?? 0), 0) || 1;
      for (const [k, v] of Object.entries(r.run.damageBy) as [DamageBy, number][]) dealt[k] = (dealt[k] ?? 0) + v / total;
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
    if (flag('by-weapon')) console.log(`damage by: ${describeDamage(dealt)}`);
    if (secrets) {
      // Targets (plans/late-game/05 §8): a bot-reachable secret found in 2–8% of eligible runs, stirred in ≥ 25%.
      console.log('secrets (stirred or sighted / found, of runs): ' + [...met.entries()]
        .map(([id, m]) => `${id} ${(100 * m.stir / seeds).toFixed(0)}%/${(100 * m.found / seeds).toFixed(1)}%`).join('  ·  '));
      const pct = (xs: number[], q: number): number => [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;
      console.log('tallies (runs counting / p50 / p90 / max): ' + [...counts.entries()]
        .filter(([, xs]) => xs.some((x) => x > 0))
        .map(([id, xs]) => { const on = xs.filter((x) => x > 0); return `${id} ${on.length} / ${pct(on, 0.5)} / ${pct(on, 0.9)} / ${Math.max(...on)}`; })
        .join('  ·  '));
    }
    if (rifts) {
      const mean = riftCounts.reduce((a, b) => a + b, 0) / Math.max(1, riftCounts.length);
      const fell = [...deaths.entries()].filter(([w]) => w <= 20).reduce((a, [, n]) => a + n, 0);
      console.log(`rifts: ${mean.toFixed(2)} a run to wave 20 (want 1.5–2.5) · ${past12Rift}/${past12} runs past wave 12 saw one by then (want ≥ 90%)`
        + ` · ${onBoss} on boss waves (want 0)`);
      console.log(`rifts: a taken legendary in ${legend.runs} runs, ${legend.fell} fell by wave 20 · all runs: ${fell}/${seeds} fell by wave 20`);
    }
    return;
  }
  const seed = arg('seed', 1);
  const r = simulate(seed, maxSeconds, policy, preset, region, rifts);
  console.log(`seed ${seed} · policy ${policy} · forge ${preset} · region ${region} · first kill ${r.firstKill?.toFixed(2) ?? '—'}s · ${r.levelUps.length} level-ups · ${r.ultCasts} novas`);
  console.log(`wave  start  dur  lvl    dps  bodies   pool   clear  carried  taken  kills  hp${rifts ? '  rift' : ''}`);
  for (const w of r.rows) {
    const clear = w.hpPool / w.dps;
    console.log(
      `${pad(w.wave, 4)} ${pad(w.start.toFixed(1), 6)} ${pad(w.duration.toFixed(1), 4)} ${pad(w.level, 4)} ${pad(w.dps.toFixed(0), 6)}`
      + ` ${pad(w.bodies, 7)} ${pad(Math.round(w.hpPool), 6)} ${pad(clear.toFixed(1), 7)} ${pad(w.carried, 8)}`
      + ` ${pad(Math.round(w.damageTaken), 6)} ${pad(w.kills, 6)} ${pad(Math.round(w.hpAtEnd), 4)}${rifts && w.rift ? `  ${w.rift}` : ''}`,
    );
  }
  console.log(`build: ${describeBuild(r.run)}`);
  console.log(`damage by: ${describeDamage(r.run.damageBy)}`);
  const b = r.run.boss;
  if (b) console.log(`boss ${b.id}: ${b.killedIn === null ? 'stood' : `fell in ${b.killedIn.toFixed(1)}s`}${b.enraged ? ' (enraged)' : ''}`);
  const o = r.run.outcome;
  console.log(o ? `${o.kind} at wave ${o.wave}, ${o.time.toFixed(1)}s` : `still standing at ${r.run.time.toFixed(0)}s`);
}

// Only when run as the script, so tests can import `simulate`.
if (process.argv[1]?.includes('inspect')) main();
