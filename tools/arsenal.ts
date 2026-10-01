/**
 * The arsenal report (§8.4's I4): the active bot drafts with every weapon in
 * its pool, in each region, over many seeds, and counts which weapons it
 * takes. No weapon may take more than 40% of the new-weapon picks, and every
 * weapon must be taken somewhere.
 *
 *   npm run arsenal                     Regions 1–6, 16 seeds each
 *   npm run arsenal -- --seeds 40
 *
 * The loadout is each region's frontier one: every Forge node up to the
 * ring its boss unseals, half bought, with every weapon in the pool and at
 * least three weapon slots (Region 3's, §11.1) so each run makes two or more
 * weapon picks.
 * Twin Mount and the keystones are left out: they pick for the player.
 */
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { FORGE } from '../src/content/forge';
import { PASSIVES } from '../src/content/passives';
import { WEAPONS } from '../src/content/weapons';
import { REGIONS } from '../src/content/regions';
import type { WeaponId } from '../src/content/types';
import { botInput } from './bot';

/** Most of a run's drafts happen before this; the overtime tail adds no new weapons. */
const RUN_SECONDS = 600;
/** How much of each multi-level node the preset owns. */
const BOUGHT = 0.5;
/** I4's ceiling on one weapon's share of the picks. */
export const I4_MAX_SHARE = 0.4;
/** Every Act 1 region (§11.1). */
export const ALL_REGIONS: readonly number[] = REGIONS.map((r) => r.index);

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
    if (n.ring > region + 1 || n.type === 'keystone' || n.id === 'twin-mount') continue;
    profile.forge[n.id] = Math.max(1, Math.round(n.maxLevel * BOUGHT));
  }
  const base = buildRunConfig(profile);
  return {
    ...base,
    regionId: region,
    pool: [...WEAPONS.map((w) => w.id), ...PASSIVES.map((p) => p.id)],
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
  let worst: ArsenalReport['worst'] = { weapon: WEAPONS[0].id, share: 0, region: regions[0] };
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
  return { picks, evolutions, worst, unpicked: WEAPONS.map((w) => w.id).filter((id) => !taken.has(id)) };
}

function main(): void {
  const args = process.argv.slice(2);
  const seedsAt = args.indexOf('--seeds');
  const seeds = seedsAt >= 0 ? Number(args[seedsAt + 1]) : 16;
  const r = arsenalReport(ALL_REGIONS, seeds);
  for (const [region, tally] of Object.entries(r.picks)) {
    const total = Object.values(tally).reduce((a, b) => a + (b ?? 0), 0);
    console.log(`Region ${region}: ${total} new-weapon picks, ${r.evolutions[Number(region)]} evolutions`);
    for (const w of WEAPONS) {
      const n = tally[w.id] ?? 0;
      console.log(`  ${w.name.padEnd(16)} ${String(n).padStart(4)}  ${((n / Math.max(1, total)) * 100).toFixed(0).padStart(3)}%`);
    }
  }
  const ok = r.worst.share <= I4_MAX_SHARE && r.unpicked.length === 0;
  console.log(`I4 ${ok ? 'PASS' : 'FAIL'}: worst ${r.worst.weapon} at ${(r.worst.share * 100).toFixed(0)}% in Region ${r.worst.region}`
    + (r.unpicked.length > 0 ? `; never taken: ${r.unpicked.join(', ')}` : ''));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
