/**
 * The arsenal report (§8.4's I4): the active bot drafts with every weapon in
 * its pool, in each region, over many seeds, and counts which weapons it
 * takes. No weapon may take more than 40% of the new-weapon picks, and every
 * weapon must be taken somewhere.
 *
 *   npm run arsenal                     Regions 1–6, 16 seeds each
 *   npm run arsenal -- --seeds 40
 *   npm run arsenal -- --keystones      T4: each keystone against none, Regions 3–6
 *                                       (the frontier profiles), 8 seeds each: median
 *                                       wave, shards and boss time. A keystone that only
 *                                       gains is free; one that only loses is a trap
 *   npm run arsenal -- --capstones      either report with every mastery capstone at
 *                                       rank 3 (plans/mastery-capstones.md): Overlevels
 *                                       in the draft, the bank, the shield, the echo
 *
 * The loadout is each region's frontier one (`tools/frontier.ts`, R4): the
 * profile the pacing bot first enters the region with, its Forge as it
 * shopped it (tempering and Twin Mount included) and the recipes it has
 * found, taken in turn from three pacing seeds. On it, every Act 1 weapon
 * and passive is in the pool, and at least three weapon slots (Region 3's,
 * §11.1; four with Twin Mount, whose pick isn't the bot's) so each run makes
 * two or more weapon picks of its own. The pacing bot never
 * buys a keystone, and the profiles end before Act 2 (§9): no masteries, and
 * none of the cards the Constellations light.
 */
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { SIM_DT } from '../src/app/loop';
import { FORGE } from '../src/content/forge';
import { isCapstone } from '../src/meta/forge';
import type { Profile } from '../src/meta/profile';
import { PASSIVES } from '../src/content/passives';
import { WEAPONS } from '../src/content/weapons';
import { ACT1_REGIONS, WAKE_REGIONS, regionByIndex } from '../src/content/regions';
import { runRegion } from '../src/sim/systems/waves';
import { migrate } from '../src/meta/save/migrate';
import { STAR_CARDS } from '../src/content/stars';
import type { WeaponId } from '../src/content/types';
import type { RunConfig } from '../src/sim/state';
import { botInput } from './bot';
import { frontierProfile, savesAt } from './frontier';
import { IN_WORKER, parallel, workerJobs } from './parallel';

/** Most of a run's drafts happen before this; the overtime tail adds no new weapons. */
const RUN_SECONDS = 600;
/** I4's ceiling on one weapon's share of the picks. */
export const I4_MAX_SHARE = 0.4;
/** Every Act 1 region (§11.1): the frontier fixtures' own. */
export const ALL_REGIONS: readonly number[] = ACT1_REGIONS.map((r) => r.index);
/** `--wake`: the Wake's regions, on `tools/fixtures/wake-frontiers.json` (plans/late-game/12 §10.3). */
export const WAKE_INDICES: readonly number[] = WAKE_REGIONS.map((r) => r.index);
/** `--wake`'s reference row: the Blight Heart, the last Act 1 region, which the Wake's shares are read against. */
export const WAKE_REFERENCE = 6;
/** Act 1's weapons and passives: none a Constellation lights (§9). */
const ACT1_WEAPONS = WEAPONS.filter((w) => !STAR_CARDS.has(w.id));
const ACT1_PASSIVES = PASSIVES.filter((p) => !STAR_CARDS.has(p.id));

export interface ArsenalReport {
  /** New-weapon picks by weapon, per region: the bot's own, Twin Mount's sure offer left out. */
  picks: Record<number, Partial<Record<WeaponId, number>>>;
  /**
   * Twin Mount's picks by weapon, per region: the first draft is sure to offer
   * a weapon that answers the region's opening (`twinSpares`), and the bot
   * takes it. That is the region's authored answer, not the bot's choice
   * among equals, so I4 doesn't count it.
   */
  twin: Record<number, Partial<Record<WeaponId, number>>>;
  /** Evolutions taken, per region. */
  evolutions: Record<number, number>;
  /** The largest share any one weapon took, and which. */
  worst: { weapon: WeaponId; share: number; region: number };
  /** Weapons the bot never took anywhere. */
  unpicked: WeaponId[];
  /** Overlevels taken (Arsenal Mastery, `--capstones`), by weapon, all regions. */
  overlevels: Partial<Record<WeaponId, number>>;
}

/** `--capstones`: every mastery capstone at its last rank, on top of the frontier Forge. */
const CAPSTONES = process.argv.includes('--capstones');

function withCapstones(profile: Profile, on: boolean): Profile {
  if (on) for (const n of FORGE) if (isCapstone(n)) profile.forge[n.id] = n.maxLevel;
  return profile;
}

/** Picks a region's `k`th profile for a report. */
export type ProfileOf = (region: number, k: number) => Profile;

/**
 * `--wake`'s profiles: the Wake fixture's, and for the Blight Heart's reference
 * row that fixture's own profiles at the Blight's fall (every `k`), the towers
 * Region 9 is entered with. The Act 1 fixture's Blight Heart towers come from
 * another pacing run, and its arrival half is a Hollow King tower, so a shift
 * against them would read the tower as much as the region.
 */
export const wakeProfileOf: ProfileOf = (region, k) => {
  if (region !== WAKE_REFERENCE) return frontierProfile(region, k);
  const saves = savesAt(regionByIndex(WAKE_REFERENCE).boss, true);
  const profile = migrate(structuredClone(saves[k % saves.length].profile)) as unknown as Profile;
  // As `frontierProfile` sets any frontier profile to play its region.
  profile.tutorial.firstDraft = true;
  profile.region = region;
  profile.trial = null;
  profile.contracts.taken = null;
  return profile;
};

/** A region's frontier loadout (`tools/frontier.ts`), its `k`th profile: the tower a player first pushing it owns. */
function frontierConfig(region: number, k = 0, profileOf: ProfileOf = frontierProfile) {
  const base = buildRunConfig(withCapstones(profileOf(region, k), CAPSTONES));
  return {
    ...base,
    regionId: region,
    pool: [...ACT1_WEAPONS.map((w) => w.id), ...ACT1_PASSIVES.map((p) => p.id)],
    // Two picks of the bot's own a run: Twin Mount's sure offer fills a slot without being one.
    weaponSlots: Math.max(base.weaponSlots, base.behaviours['twin-mount'] ? 4 : 3),
  };
}

export interface ArsenalOptions {
  /** Picks the profiles: the stored frontier ones by default. */
  profileOf?: ProfileOf;
  /**
   * Every run must play the region asked for, under that region's own rule: a
   * profile whose region isn't unlocked would otherwise fall back to Region 1
   * somewhere on the way and the report would read the wrong place.
   */
  strict?: boolean;
  /** A region played only to be read against: left out of I4's worst and unpicked. */
  reference?: number;
}

export function arsenalReport(regions: readonly number[] = ALL_REGIONS, seeds = 16, opts: ArsenalOptions = {}): ArsenalReport {
  const { profileOf = frontierProfile, strict = false, reference } = opts;
  const picks: ArsenalReport['picks'] = {};
  const twin: ArsenalReport['twin'] = {};
  const evolutions: ArsenalReport['evolutions'] = {};
  const overlevels: ArsenalReport['overlevels'] = {};
  for (const region of regions) {
    const tally: Partial<Record<WeaponId, number>> = (picks[region] = {});
    const twins: Partial<Record<WeaponId, number>> = (twin[region] = {});
    evolutions[region] = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const run = createRun(frontierConfig(region, seed - 1, profileOf), seed * 7919 + region);
      if (strict) {
        const want = regionByIndex(region).rule?.effect.kind ?? null;
        const got = runRegion(run).rule?.effect.kind ?? null;
        if (run.regionId !== region || got !== want) {
          throw new Error(`Region ${region} seed ${seed}: the run plays Region ${run.regionId} under ${got ?? 'no rule'}, not ${want ?? 'no rule'}`);
        }
      }
      let offer = run.twinOffer;
      for (let i = 0; i < RUN_SECONDS / SIM_DT && !run.outcome; i++) {
        step(run, SIM_DT, botInput(run, 'active'));
        for (const ev of run.events) {
          if (ev.kind !== 'picked') continue;
          if (ev.card.kind === 'weapon' && ev.card.level === 1) {
            const into = ev.card.id === offer ? twins : tally;
            into[ev.card.id] = (into[ev.card.id] ?? 0) + 1;
            offer = null;
          }
          if (ev.card.kind === 'evolution') evolutions[region]++;
          if (ev.card.kind === 'overlevel') overlevels[ev.card.id] = (overlevels[ev.card.id] ?? 0) + 1;
        }
        run.events.length = 0;
      }
    }
  }
  const judged = regions.filter((r) => r !== reference);
  let worst: ArsenalReport['worst'] = { weapon: ACT1_WEAPONS[0].id, share: 0, region: judged[0] };
  const taken = new Set<WeaponId>();
  for (const region of judged) {
    const tally = picks[region];
    const total = Object.values(tally).reduce((a, b) => a + (b ?? 0), 0);
    for (const [id, n] of Object.entries(tally) as [WeaponId, number][]) {
      taken.add(id);
      const share = n / Math.max(1, total);
      if (share > worst.share) worst = { weapon: id, share, region };
    }
  }
  // The starting weapon is mounted, never picked: it counts as taken.
  taken.add(frontierConfig(judged[0], 0, profileOf).pool[0] as WeaponId);
  return { picks, twin, evolutions, worst, unpicked: ACT1_WEAPONS.map((w) => w.id).filter((id) => !taken.has(id)), overlevels };
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

/** One region and one keystone (or none), on the region's frontier profiles (taken in turn), over `seeds` runs of the active bot. */
export function sweepCell(region: number, keystone: string | null, seeds: number, capstones = false): SweepCell {
  const config = (k: number): RunConfig => {
    const profile = withCapstones(frontierProfile(region, k), capstones);
    if (keystone) profile.forge[keystone] = 1;
    return { ...buildRunConfig(profile), regionId: region };
  };
  const out: SweepCell = { region, keystone, waves: [], shards: [], boss: [] };
  for (let seed = 1; seed <= seeds; seed++) {
    const run = createRun(config(seed - 1), seed * 7919 + region);
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
  const jobs = KEYSTONE_REGIONS.flatMap((r) => [null, ...KEYSTONES].map((k) => [r, k, seeds, CAPSTONES]));
  const cells = await parallel<SweepCell>(process.argv[1], 'sweep', jobs);
  const at = (r: number, k: string | null): SweepCell => cells.find((c) => c.region === r && c.keystone === k)!;
  const fmtBoss = (c: SweepCell): string => c.boss.map((b) => (b === null ? '—' : Math.round(b))).join(' ');
  console.log(`keystones · Regions ${KEYSTONE_REGIONS.join(', ')} · frontier profiles${CAPSTONES ? ' + every capstone' : ''} · ${seeds} seeds`);
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
  const wake = args.includes('--wake');
  const r = wake ? arsenalReport([WAKE_REFERENCE, ...WAKE_INDICES], seeds, { profileOf: wakeProfileOf, strict: true, reference: WAKE_REFERENCE }) : arsenalReport(ALL_REGIONS, seeds);
  if (wake) console.log(`Every run played its own region under its own rule (Region ${WAKE_REFERENCE}, the reference, and ${WAKE_INDICES.join(', ')}).`);
  const shares = (tally: Partial<Record<WeaponId, number>>): Map<WeaponId, number> => {
    const total = Object.values(tally).reduce((a, b) => a + (b ?? 0), 0);
    return new Map(ACT1_WEAPONS.map((w) => [w.id, (tally[w.id] ?? 0) / Math.max(1, total)]));
  };
  const reference = wake ? shares(r.picks[WAKE_REFERENCE]) : null;
  for (const [region, tally] of Object.entries(r.picks)) {
    const total = Object.values(tally).reduce((a, b) => a + (b ?? 0), 0);
    const twins = r.twin[Number(region)];
    console.log(`Region ${region}: ${total} new-weapon picks, ${r.evolutions[Number(region)]} evolutions`
      + ` (Twin Mount's offer, not counted: ${Object.entries(twins).map(([id, n]) => `${id} ${n}`).join(', ') || 'none'})`);
    for (const w of ACT1_WEAPONS) {
      const n = tally[w.id] ?? 0;
      console.log(`  ${w.name.padEnd(16)} ${String(n).padStart(4)}  ${((n / Math.max(1, total)) * 100).toFixed(0).padStart(3)}%`);
    }
    if (reference && Number(region) !== WAKE_REFERENCE) {
      let max = { id: ACT1_WEAPONS[0].id, shift: 0 };
      for (const [id, share] of shares(tally)) {
        const shift = share - reference.get(id)!;
        if (Math.abs(shift) > Math.abs(max.shift)) max = { id, shift };
      }
      const name = ACT1_WEAPONS.find((w) => w.id === max.id)!.name;
      const pts = Math.round(max.shift * 100);
      console.log(`  vs ${regionByIndex(WAKE_REFERENCE).name}: max shift ${pts >= 0 ? '+' : ''}${pts} ${name}`);
    }
  }
  if (CAPSTONES) console.log(`Overlevels taken: ${Object.entries(r.overlevels).map(([id, n]) => `${id} ${n}`).join(', ') || 'none'}`);
  const ok = r.worst.share <= I4_MAX_SHARE && r.unpicked.length === 0;
  console.log(`I4 ${ok ? 'PASS' : 'FAIL'}: worst ${r.worst.weapon} at ${(r.worst.share * 100).toFixed(0)}% in Region ${r.worst.region}`
    + (r.unpicked.length > 0 ? `; never taken: ${r.unpicked.join(', ')}` : ''));
}

if (IN_WORKER) workerJobs({ sweep: sweepCell });
else if (import.meta.url === `file://${process.argv[1]}`) void main();
