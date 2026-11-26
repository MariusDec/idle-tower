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
 *   npm run inspect -- --seeds 50 --forge ring5 --region 4 --recipes act1 --form
 *                                          Final Form (plans/late-game/07 §8): the wave
 *                                          each run formed, the reach rate, the median
 *                                          wave and how many weapons were evolved at the end;
 *                                          --recipes act1|all marks recipes found (act1: those
 *                                          the Forge's pool can draw), --frame artificer picks a frame
 *   npm run inspect -- --seeds 20 --forge all --floor 7
 *                                          the Abyss from waypoint floor 7 (plans/late-game/08 §9):
 *                                          the deepest floor reached, Lurkers fled and healed,
 *                                          bodies that escaped (the Inversion), Keepers that held
 *   npm run inspect -- --seeds 6 --frontier --fixture act1 --region 9 --stop-boss
 *                                          the Wake harness (plans/late-game/12a W3): run k plays
 *                                          `frontierProfile(region, k)` (tools/frontier.ts), or with
 *                                          --fixture act1 the Blight-fall profiles of frontiers.json
 *                                          with the Wake opened up to the region; --arrival plays
 *                                          arrivals only (even k); --stop-boss ends a run when the
 *                                          boss falls (or wave 21 begins). Reads the fells, boss HP ÷
 *                                          DPS at arrival, the boss's seconds, what hurt the tower and
 *                                          the Conductors' lives
 *
 * Headless: it drives the real sim, not a model of it.
 */
import { RIFT_BY_ID } from '../src/content/rifts';
import { BALANCE } from '../src/content/balance';
import { SECRETS } from '../src/content/secrets';
import { EVOLUTIONS } from '../src/content/evolutions';
import type { SecretConfig } from '../src/sim/state';
import type { EvolutionId } from '../src/content/types';
import { formCount } from '../src/sim/systems/form';
import { frameById } from '../src/content/frames';
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile, type Profile } from '../src/meta/profile';
import { FORGE } from '../src/content/forge';
import { SIM_DT } from '../src/app/loop';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { regionAt, waveHp } from '../src/sim/systems/waves';
import { ABYSS_INDEX } from '../src/content/abyss';
import { buildDps } from '../src/sim/suggest';
import type { DamageBy, HurtBy, RunState } from '../src/sim/state';
import { PACTS } from '../src/content/pacts';
import { WAKE_REGIONS, regionByIndex } from '../src/content/regions';
import { selectedRegion } from '../src/meta/collection';
import { setPactRank } from '../src/meta/pacts';
import { migrate } from '../src/meta/save/migrate';
import { botInput, type Policy } from './bot';
import { frontierProfile, savesAt } from './frontier';

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
  /** The strata (`--floor`): Lurkers met, fled and healed; bodies that escaped; Keepers met and slain. */
  strata: { lurkers: number; fled: number; healed: number; escapes: number; keepers: number };
  firstKill: number | null;
  /** Run time of each level-up. */
  levelUps: number[];
  ultCasts: number;
  /** The boss's max HP ÷ the build's DPS at its arrival; null if it never arrived. */
  bossHpPerDps: number | null;
  /** Each Conductor's seconds from first entering the tower's range to its death (plans/late-game/12a W3). */
  conductLife: number[];
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

/** `--recipes` (plans/late-game/07 §8): none found (a fresh `veteran`), those the pool can draw, or every one. */
export type RecipePreset = 'none' | 'act1' | 'all';

/** What else a probe sets on its veteran: recipes found and the frame (Final Form's readings). */
export interface ProbeOptions {
  readonly recipes?: RecipePreset;
  readonly frame?: string;
  /** The Abyss from this waypoint floor (plans/late-game/08 §4.4), in place of `regionIndex`. */
  readonly startFloor?: number;
  /** Play this profile (`--frontier`) in place of a Forge preset's veteran. */
  readonly profile?: Profile;
  /** `--stop-boss`: end the run when the boss falls, or when wave 21 begins with it standing. */
  readonly stopBoss?: boolean;
}

/** `--fixture`: where `--frontier` takes a Wake region's profiles from (plans/late-game/12a W3). */
export type FrontierFixture = 'frontier' | 'act1';

/**
 * The `k`th profile `--frontier` plays in `region`. `act1` takes a Wake
 * region from the Blight-fall saves of `frontiers.json` (in turn by seed,
 * as `frontierProfile` takes its own), with every earlier Wake boss felled
 * once so the region is open; any other region, or `frontier`, is
 * `frontierProfile(region, k)`. Pacts are cleared: a boss fight at heat 0.
 */
export function frontierRunProfile(region: number, k: number, fixture: FrontierFixture = 'frontier'): Profile {
  const wake = WAKE_REGIONS.findIndex((r) => r.index === region);
  let profile: Profile;
  if (fixture === 'act1' && wake >= 0) {
    const saves = savesAt(regionByIndex(WAKE_REGIONS[0].after!).boss);
    profile = migrate(structuredClone(saves[(k >> 1) % saves.length].profile)) as unknown as Profile;
    for (const r of WAKE_REGIONS.slice(0, wake)) profile.bosses[r.boss] = { kills: 1, fastest: null };
    profile.tutorial.firstDraft = true;
    profile.region = region;
    profile.trial = null;
    profile.contracts.taken = null;
  } else {
    profile = frontierProfile(region, k);
  }
  for (const p of PACTS) setPactRank(profile, p.id, 0);
  // Without the region open, `selectedRegion` silently falls back to Region 1.
  const at = selectedRegion(profile).index;
  if (at !== region) throw new Error(`frontier profile ${k} for region ${region} would play region ${at}`);
  return profile;
}

/** The recipes a preset marks found, against the run's pool. */
function presetRecipes(preset: RecipePreset, pool: readonly string[]): EvolutionId[] {
  if (preset === 'all') return EVOLUTIONS.map((e) => e.id);
  if (preset === 'act1') return EVOLUTIONS.filter((e) => pool.includes(e.weapon)).map((e) => e.id);
  return [];
}

export function simulate(
  seed: number, maxSeconds: number, policy: Policy, preset: ForgePreset = 'none', regionIndex = 1, rifts = false, secrets = false,
  probe: ProbeOptions = {},
): RunReport {
  const vet = probe.profile ?? veteran(preset);
  if (probe.frame) {
    // A probe's frame is owned: a feat's frame (the Artificer's Tinkerer) counts as earned. Boss and star frames need their own preset.
    const unlock = frameById(probe.frame).unlock;
    if (unlock.kind === 'feat') vet.feats[unlock.feat] = 'claimed';
    vet.frame = probe.frame;
  }
  const base = buildRunConfig(vet);
  const recipes = probe.recipes && probe.recipes !== 'none' ? presetRecipes(probe.recipes, base.pool) : null;
  const run = createRun({
    ...base, regionId: probe.startFloor ? ABYSS_INDEX : regionIndex, rifts: rifts ? RIFTS_ON : null,
    ...(probe.startFloor ? { startFloor: probe.startFloor } : {}),
    ...(recipes ? { recipes } : {}),
    // A late-Act-1 player knows every recipe, so the suggestion steers toward evolutions (frost needs Absolute Zero).
    ...(secrets ? { secrets: SECRETS_ON, firstKill: false, recipes: EVOLUTIONS.map((e) => e.id) } : {}),
  }, seed);
  const rows: WaveRow[] = [];
  const lurkers = new Set<number>();
  const fled = new Set<number>();
  const healed = new Set<number>();
  const strata = { lurkers: 0, fled: 0, healed: 0, escapes: 0, keepers: 0 };
  const levelUps: number[] = [];
  let row: WaveRow | null = null;
  let firstKill: number | null = null;
  let ultCasts = 0;
  let bossHpPerDps: number | null = null;
  /** Conductors seen in range: id → run time each first entered it. */
  const conducting = new Map<number, number>();
  const conductLife: number[] = [];
  const maxTicks = Math.round(maxSeconds / SIM_DT);
  while (!run.outcome && run.tick < maxTicks) {
    step(run, SIM_DT, botInput(run, policy));
    if (run.regionId === ABYSS_INDEX) {
      for (const e of run.enemies) {
        if (e.type !== 'lurker') continue;
        lurkers.add(e.id);
        if (e.heading < 0) fled.add(e.id);
        if (e.fled) healed.add(e.id);
      }
    }
    if (conducting.size > 0) {
      // A Conductor gone from the field since the last step has died (they never walk to the wall).
      for (const [id, at] of conducting) {
        const e = run.enemies.find((x) => x.id === id);
        if (!e || !e.alive) {
          conductLife.push(run.time - at);
          conducting.delete(id);
        }
      }
    }
    const r2 = run.stats.range * run.stats.range;
    for (const e of run.enemies) {
      if (!e.alive || conducting.has(e.id) || ENEMY_BY_ID[e.type]?.verb.kind !== 'conduct') continue;
      if (e.x * e.x + e.y * e.y <= r2) conducting.set(e.id, run.time);
    }
    let stop = false;
    for (const ev of run.events) {
      if (ev.kind === 'bossArrive' && run.boss) {
        const body = run.enemies.find((e) => e.id === run.boss!.enemy);
        if (body) bossHpPerDps = body.maxHp / buildDps(run.weapons, run.stats);
      }
      if (probe.stopBoss && ev.kind === 'waveStart' && ev.wave > 20) stop = true;
      if (ev.kind === 'escape') strata.escapes++;
      if (ev.kind === 'eliteSpawn' && ev.keeper !== undefined) strata.keepers++;
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
          hpPool: cur.spawns.reduce((sum, sp) => sum + ENEMY_BY_ID[sp.enemy].hp * waveHp(regionAt(run.regionId, ev.wave), ev.wave), 0),
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
    if (probe.stopBoss && (stop || run.boss?.killedIn != null)) break;
  }
  if (row) {
    row.duration = run.time - row.start;
    row.hpAtEnd = Math.max(0, run.tower.hp);
  }
  Object.assign(strata, { lurkers: lurkers.size, fled: fled.size, healed: healed.size });
  return { rows, strata, firstKill, levelUps, ultCasts, bossHpPerDps, conductLife, run };
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

/** Each key's median share over runs (a run without it counts 0), largest first: "slams 75% · contact 20%". */
function medianShares<K extends string>(runs: readonly Partial<Record<K, number>>[]): string {
  const shares = runs.map((by) => {
    const total = Object.values<number | undefined>(by).reduce<number>((a, b) => a + (b ?? 0), 0) || 1;
    return Object.fromEntries(Object.entries<number | undefined>(by).map(([k, v]) => [k, (v ?? 0) / total])) as Partial<Record<K, number>>;
  });
  const keys = [...new Set(runs.flatMap((by) => Object.keys(by)))] as K[];
  return keys
    .map((k) => [k, median(shares.map((s) => s[k] ?? 0))] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
    .join(' · ') || '—';
}

/** "R9 carillon": the region and its boss, for the harness's line. */
function regionLabel(region: number): string {
  return `R${region} ${regionByIndex(region).boss}`;
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
  const form = flag('form');
  const ri = process.argv.indexOf('--recipes');
  const fr = process.argv.indexOf('--frame');
  const probe: ProbeOptions = {
    recipes: (ri >= 0 ? process.argv[ri + 1] : 'none') as RecipePreset,
    frame: fr >= 0 ? process.argv[fr + 1] : undefined,
    startFloor: arg('floor', 0) || undefined,
    stopBoss: flag('stop-boss'),
  };
  // `--frontier` (plans/late-game/12a W3): run k plays the region's kth frontier profile; `--arrival`, even k only.
  const frontier = flag('frontier');
  const fx = process.argv.indexOf('--fixture');
  const fixture = (fx >= 0 ? process.argv[fx + 1] : 'frontier') as FrontierFixture;
  if (fixture !== 'frontier' && fixture !== 'act1') throw new Error(`--fixture ${fixture}: want act1`);
  const probeFor = (s: number): ProbeOptions => {
    if (!frontier) return probe;
    const k = flag('arrival') ? 2 * (s - 1) : s - 1;
    return { ...probe, profile: frontierRunProfile(region, k, fixture) };
  };
  const forgeName = frontier ? `frontier${fixture === 'act1' ? ' (act1 fixture)' : ''}${flag('arrival') ? ' arrivals' : ''}` : preset;
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
    /** Final Form (`--form`): the wave each formed run formed at, runs that could, and evolved weapons at each run's end. */
    const formWaves: number[] = [];
    let formable = 0;
    const evolvedAtEnd = new Map<number, number>();
    const deep: number[] = [];
    const strata = { lurkers: 0, fled: 0, healed: 0, escapes: 0, keepers: 0 };
    /** The Wake harness's readings (`--frontier`), one entry a run. */
    const fight = { fells: 0, hpPerDps: [] as number[], bossSecs: [] as number[], hurt: [] as Partial<Record<HurtBy, number>>[], conduct: [] as number[], kills: [] as RunState['killsBy'][], elites: [] as number[] };
    for (let s = 1; s <= seeds; s++) {
      const r = simulate(s, maxSeconds, policy, preset, region, rifts, secrets, probeFor(s));
      if (frontier) {
        const killedIn = r.run.boss?.killedIn;
        if (killedIn != null) {
          fight.fells++;
          fight.bossSecs.push(killedIn);
        }
        if (r.bossHpPerDps !== null) fight.hpPerDps.push(r.bossHpPerDps);
        fight.hurt.push(r.run.takenBy);
        fight.conduct.push(...r.conductLife);
        fight.kills.push(r.run.killsBy);
        fight.elites.push(r.run.elitesKilled);
      }
      deep.push(r.run.floors);
      for (const k of Object.keys(strata) as (keyof typeof strata)[]) strata[k] += r.strata[k];
      if (r.run.form.need > 0) formable++;
      if (r.run.form.wave !== null) formWaves.push(r.run.form.wave);
      const ev = formCount(r.run);
      evolvedAtEnd.set(ev, (evolvedAtEnd.get(ev) ?? 0) + 1);
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
    console.log(`${seeds} runs, policy ${policy}, forge ${forgeName}, region ${region}${probe.stopBoss ? ', to the boss' : ''}`);
    console.log(`first kill: median ${median(firsts).toFixed(2)}s, worst ${Math.max(...firsts).toFixed(2)}s`);
    console.log(`death wave: median ${median(waves)} · ` + [...deaths.entries()].sort((a, b) => a[0] - b[0]).map(([w, n]) => `w${w}×${n}`).join('  '));
    console.log(`run length: median ${median(lengths).toFixed(0)}s`);
    if (firstLevel.length > 0) {
      console.log(`level-ups: first median ${median(firstLevel).toFixed(1)}s · gap before 1:30 median ${median(early).toFixed(1)}s · after ${median(late).toFixed(1)}s`);
    }
    console.log('loadouts: ' + [...loadouts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join('  ·  '));
    if (flag('by-weapon') || frontier) console.log(`damage by: ${describeDamage(dealt)}`);
    if (frontier) {
      // The Wake harness (plans/late-game/12a §1.3, W3): one line a region.
      const f = fight;
      const med1 = (xs: number[]): string => (xs.length > 0 ? median(xs).toFixed(1) : '—');
      const name = regionLabel(region);
      console.log(`${name}: fells ${f.fells}/${seeds} · HP÷DPS ${med1(f.hpPerDps)} s · boss ${med1(f.bossSecs)} s · hurt by ${medianShares(f.hurt)}`
        + ` · Conductor life ${med1(f.conduct)} s (${f.conduct.length})`);
      const types = [...new Set(f.kills.flatMap((k) => Object.keys(k)))] as (keyof RunState['killsBy'])[];
      const kills = types.map((t) => [t, median(f.kills.map((k) => k[t] ?? 0))] as const).sort((a, b) => b[1] - a[1]);
      console.log(`kills (median a run): ${kills.map(([t, n]) => `${t} ${n}`).join(' · ')} · elites ${median(f.elites)}`);
    }
    if (probe.startFloor) {
      // Targets (plans/late-game/08 §9): a waypoint run reaches two floors on as often as a top start; Lurkers heal < 25% with Forge `all`.
      const from = probe.startFloor;
      const on = deep.filter((f) => f >= from + 1).length;
      console.log(`the Abyss from floor ${from}: deepest cleared median ${median(deep)} · cleared floor ${from + 1} in ${on}/${seeds} runs · ${(strata.keepers / seeds).toFixed(1)} Keepers a run`);
      console.log(`lurkers: ${strata.lurkers} met · ${strata.fled} fled (${(100 * strata.fled / Math.max(1, strata.lurkers)).toFixed(0)}%) · ${strata.healed} healed in the dark (${(100 * strata.healed / Math.max(1, strata.lurkers)).toFixed(0)}%)`
        + ` · escapes ${(strata.escapes / seeds).toFixed(1)} a run`);
    }
    if (form) {
      // Targets (plans/late-game/07 §8): R2 ≤ 5%, R4 15–35% with median ≤ 20, R5 20–40% with median 15–19.
      const rate = (100 * formWaves.length) / seeds;
      console.log(`final form (recipes ${probe.recipes}${probe.frame ? `, ${probe.frame}` : ''}): ${formWaves.length}/${seeds} runs (${rate.toFixed(0)}%)`
        + ` · ${formable}/${seeds} could · median wave ${formWaves.length > 0 ? median(formWaves) : '—'}`
        + ` · waves ${[...formWaves].sort((a, b) => a - b).join(' ') || '—'}`);
      console.log('evolved at the end: ' + [...evolvedAtEnd.entries()].sort((a, b) => a[0] - b[0]).map(([n, k]) => `${n}×${k}`).join('  '));
    }
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
  const r = simulate(seed, maxSeconds, policy, preset, region, rifts, false, probeFor(seed));
  console.log(`seed ${seed} · policy ${policy} · forge ${forgeName} · region ${region} · first kill ${r.firstKill?.toFixed(2) ?? '—'}s · ${r.levelUps.length} level-ups · ${r.ultCasts} novas`);
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
  if (frontier) {
    console.log(`HP÷DPS at arrival ${r.bossHpPerDps?.toFixed(1) ?? '—'} s · hurt by ${medianShares([r.run.takenBy])} · Conductor lives ${r.conductLife.map((t) => t.toFixed(1)).join(' ') || '—'}`);
  }
  if (form) console.log(`final form: ${r.run.form.wave !== null ? `wave ${r.run.form.wave}` : r.run.form.need > 0 ? 'not reached' : 'out of reach'} · ${formCount(r.run)} evolved`);
  const o = r.run.outcome;
  console.log(o ? `${o.kind} at wave ${o.wave}, ${o.time.toFixed(1)}s` : `still standing at ${r.run.time.toFixed(0)}s`);
}

// Only when run as the script, so tests can import `simulate`.
if (process.argv[1]?.includes('inspect')) main();
