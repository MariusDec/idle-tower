/**
 * The arsenal report (§8.4's I4): the active bot drafts with every weapon in
 * its pool, in each region, over many seeds, and counts which weapons it
 * takes. No weapon may take more than 40% of the new-weapon picks, and every
 * weapon must be taken somewhere.
 *
 *   npm run arsenal                     Regions 1–6, 16 seeds each
 *   npm run arsenal -- --seeds 40
 *   npm run arsenal -- --keystones      T4: each keystone against none, Regions 3–6
 *                                       (the next ring bought out), 8 seeds each: median
 *                                       wave, shards and boss time. A keystone that only
 *                                       gains is free; one that only loses is a trap
 *
 * The loadout is each region's frontier one: every Forge node up to the
 * ring its boss unseals, half bought, with every Act 1 weapon and passive in
 * the pool and at least three weapon slots (Region 3's, §11.1) so each run
 * makes two or more weapon picks.
 * Twin Mount and the keystones are left out: they pick for the player. So
 * is Act 2 (§9): the masteries, and the cards the Constellations light.
 */
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { FORGE } from '../src/content/forge';
import { PASSIVES } from '../src/content/passives';
import { WEAPONS } from '../src/content/weapons';
import { REGIONS } from '../src/content/regions';
import { STAR_CARDS } from '../src/content/stars';
import type { WeaponId } from '../src/content/types';
import { botInput } from './bot';
import { veteran, type ForgePreset } from './inspect';
import { IN_WORKER, parallel, workerJobs } from './parallel';

/** Most of a run's drafts happen before this; the overtime tail adds no new weapons. */
const RUN_SECONDS = 600;
/** How much of each multi-level node the preset owns. */
const BOUGHT = 0.5;
/** I4's ceiling on one weapon's share of the picks. */
export const I4_MAX_SHARE = 0.4;
/** Every Act 1 region (§11.1). */
export const ALL_REGIONS: readonly number[] = REGIONS.map((r) => r.index);
/** Act 1's weapons and passives: none a Constellation lights (§9). */
const ACT1_WEAPONS = WEAPONS.filter((w) => !STAR_CARDS.has(w.id));
const ACT1_PASSIVES = PASSIVES.filter((p) => !STAR_CARDS.has(p.id));

export interface ArsenalReport {
  /** New-weapon picks by weapon, per region. */
  picks: Record<number, Partial<Record<WeaponId, number>>>;
  /** Evolutions taken, per region. */
  evolutions: Record<number, number>;
  /** The largest share any one weapon took, and which. */
  worst: { weapon: WeaponId; share: number; region: number };
  /** Weapons the bot never took anywhere. */
  unpicked: WeaponId[];
}

/** A region's frontier loadout: the Forge a player pushing it would own. */
function frontierConfig(region: number) {
  const profile = newProfile(0);
  profile.tutorial.firstDraft = true;
  for (const n of FORGE) {
    if (n.ring > region + 1 || n.type === 'keystone' || n.type === 'mastery' || n.id === 'twin-mount') continue;
    profile.forge[n.id] = Math.max(1, Math.round(n.maxLevel * BOUGHT));
  }
  const base = buildRunConfig(profile);
  return {
    ...base,
    regionId: region,
    pool: [...ACT1_WEAPONS.map((w) => w.id), ...ACT1_PASSIVES.map((p) => p.id)],
    weaponSlots: Math.max(base.weaponSlots, 3),
  };
}

export function arsenalReport(regions: readonly number[] = ALL_REGIONS, seeds = 16): ArsenalReport {
  const picks: ArsenalReport['picks'] = {};
  const evolutions: ArsenalReport['evolutions'] = {};
  for (const region of regions) {
    const tally: Partial<Record<WeaponId, number>> = (picks[region] = {});
    evolutions[region] = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const run = createRun(frontierConfig(region), seed * 7919 + region);
      for (let i = 0; i < RUN_SECONDS / SIM_DT && !run.outcome; i++) {
        step(run, SIM_DT, botInput(run, 'active'));
        for (const ev of run.events) {
          if (ev.kind !== 'picked') continue;
          if (ev.card.kind === 'weapon' && ev.card.level === 1) tally[ev.card.id] = (tally[ev.card.id] ?? 0) + 1;
          if (ev.card.kind === 'evolution') evolutions[region]++;
        }
        run.events.length = 0;
      }
    }
  }
  let worst: ArsenalReport['worst'] = { weapon: ACT1_WEAPONS[0].id, share: 0, region: regions[0] };
  const taken = new Set<WeaponId>();
  for (const region of regions) {
    const tally = picks[region];
    const total = Object.values(tally).reduce((a, b) => a + (b ?? 0), 0);
    for (const [id, n] of Object.entries(tally) as [WeaponId, number][]) {
      taken.add(id);
      const share = n / Math.max(1, total);
      if (share > worst.share) worst = { weapon: id, share, region };
    }
  }
  // The starting weapon is mounted, never picked: it counts as taken.
  taken.add(frontierConfig(regions[0]).pool[0] as WeaponId);
  return { picks, evolutions, worst, unpicked: ACT1_WEAPONS.map((w) => w.id).filter((id) => !taken.has(id)) };
}

/** The keystones (§11.4): builds a player picks on purpose, so the sweep measures what each trades. */
export const KEYSTONES: readonly string[] = FORGE.filter((n) => n.type === 'keystone').map((n) => n.id);
/** Regions a keystone can be worn in: they are sealed until the Bog Mother falls. */
export const KEYSTONE_REGIONS: readonly number[] = ALL_REGIONS.filter((r) => r >= 3);
/** A sweep's run is cut off here: overtime has ended every run long before. */
const SWEEP_SECONDS = 1800;

export interface SweepCell {
  region: number;
  /** The keystone worn, or null for none. */
  keystone: string | null;
  waves: number[];
  shards: number[];
  /** Seconds the boss took to fall, per seed; null where it stood. */
  boss: (number | null)[];
}

/** One region and one keystone (or none), the region's next ring bought out, over `seeds` runs of the active bot. */
export function sweepCell(region: number, keystone: string | null, seeds: number): SweepCell {
  const profile = veteran(`ring${Math.min(6, region + 1)}` as ForgePreset);
  if (keystone) profile.forge[keystone] = 1;
  const config = { ...buildRunConfig(profile), regionId: region };
  const out: SweepCell = { region, keystone, waves: [], shards: [], boss: [] };
  for (let seed = 1; seed <= seeds; seed++) {
    const run = createRun(config, seed * 7919 + region);
    for (let i = 0; i < SWEEP_SECONDS / SIM_DT && !run.outcome; i++) {
      step(run, SIM_DT, botInput(run, 'active'));
      run.events.length = 0;
    }
    out.waves.push(run.wave);
    out.shards.push(run.shards);
    out.boss.push(run.boss?.killedIn ?? null);
  }
  return out;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** What a keystone did against none in one region: each reading's direction. */
export interface SweepVerdict {
  shards: number;
  waves: number;
  kills: number;
  bossTime: number | null;
  gain: boolean;
  loss: boolean;
}

/** A gain or a loss is a step past the noise: 10% of shards or boss time, a wave, or a boss kill. */
export function judge(cell: SweepCell, base: SweepCell): SweepVerdict {
  const shards = median(cell.shards) / Math.max(1, median(base.shards));
  const waves = median(cell.waves) - median(base.waves);
  const kills = cell.boss.filter((b) => b !== null).length - base.boss.filter((b) => b !== null).length;
  const times = (c: SweepCell): number => median(c.boss.map((b) => b ?? Infinity));
  const t = times(cell);
  const t0 = times(base);
  const bossTime = Number.isFinite(t) && Number.isFinite(t0) ? t / t0 : null;
  const gain = shards >= 1.1 || waves >= 1 || kills > 0 || (bossTime !== null && bossTime <= 0.9);
  const loss = shards <= 0.9 || waves <= -1 || kills < 0 || (bossTime !== null && bossTime >= 1.1);
  return { shards, waves, kills, bossTime, gain, loss };
}

async function keystoneMain(seeds: number): Promise<void> {
  const jobs = KEYSTONE_REGIONS.flatMap((r) => [null, ...KEYSTONES].map((k) => [r, k, seeds]));
  const cells = await parallel<SweepCell>(process.argv[1], 'sweep', jobs);
  const at = (r: number, k: string | null): SweepCell => cells.find((c) => c.region === r && c.keystone === k)!;
  const fmtBoss = (c: SweepCell): string => c.boss.map((b) => (b === null ? '—' : Math.round(b))).join(' ');
  console.log(`keystones · Regions ${KEYSTONE_REGIONS.join(', ')} · next ring bought out · ${seeds} seeds`);
  console.log('region  keystone        wave   shards   ×shards  boss (s)');
  const gains = new Map<string, number>();
  const losses = new Map<string, number>();
  for (const r of KEYSTONE_REGIONS) {
    const base = at(r, null);
    for (const k of [null, ...KEYSTONES]) {
      const c = at(r, k);
      const v = k ? judge(c, base) : null;
      if (k && v) {
        if (v.gain) gains.set(k, (gains.get(k) ?? 0) + 1);
        if (v.loss) losses.set(k, (losses.get(k) ?? 0) + 1);
      }
      const mark = !v ? '' : v.gain && v.loss ? '  trade' : v.gain ? '  gain' : v.loss ? '  loss' : '  even';
      console.log(`${String(r).padStart(6)}  ${(k ?? 'none').padEnd(14)} ${String(median(c.waves)).padStart(5)} ${String(Math.round(median(c.shards))).padStart(8)}`
        + ` ${(v ? `×${v.shards.toFixed(2)}` : '').padStart(8)}  ${fmtBoss(c)}${mark}`);
    }
  }
  let ok = true;
  for (const k of KEYSTONES) {
    const g = gains.get(k) ?? 0;
    const l = losses.get(k) ?? 0;
    const verdict = g > 0 && l === 0 ? 'FAIL (free: gains, no cost)' : l > 0 && g === 0 ? 'FAIL (a trap: costs, no gain)' : 'PASS';
    if (verdict !== 'PASS') ok = false;
    console.log(`  ${verdict.startsWith('PASS') ? 'PASS' : 'FAIL'}  ${k}: gains in ${g} region(s), costs in ${l}${verdict === 'PASS' ? '' : ` — ${verdict.slice(5)}`}`);
  }
  console.log(`keystones ${ok ? 'PASS' : 'FAIL'}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--keystones')) {
    const at = args.indexOf('--seeds');
    await keystoneMain(at >= 0 ? Number(args[at + 1]) : 8);
    return;
  }
  const seedsAt = args.indexOf('--seeds');
  const seeds = seedsAt >= 0 ? Number(args[seedsAt + 1]) : 16;
  const r = arsenalReport(ALL_REGIONS, seeds);
  for (const [region, tally] of Object.entries(r.picks)) {
    const total = Object.values(tally).reduce((a, b) => a + (b ?? 0), 0);
    console.log(`Region ${region}: ${total} new-weapon picks, ${r.evolutions[Number(region)]} evolutions`);
    for (const w of ACT1_WEAPONS) {
      const n = tally[w.id] ?? 0;
      console.log(`  ${w.name.padEnd(16)} ${String(n).padStart(4)}  ${((n / Math.max(1, total)) * 100).toFixed(0).padStart(3)}%`);
    }
  }
  const ok = r.worst.share <= I4_MAX_SHARE && r.unpicked.length === 0;
  console.log(`I4 ${ok ? 'PASS' : 'FAIL'}: worst ${r.worst.weapon} at ${(r.worst.share * 100).toFixed(0)}% in Region ${r.worst.region}`
    + (r.unpicked.length > 0 ? `; never taken: ${r.unpicked.join(', ')}` : ''));
}

if (IN_WORKER) workerJobs({ sweep: sweepCell });
else if (import.meta.url === `file://${process.argv[1]}`) void main();
