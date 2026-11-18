/**
 * The frontier profiles (R4): what a real player owns while pushing each
 * region, taken from the pacing bot's own play (`tools/pacing.ts`), so the
 * arsenal report (I4) and the keystone sweep measure the tower a player at
 * that frontier has: its Forge as the bot shopped it, tempering, Twin Mount,
 * relics, trims, the Trials' notables and the recipes it has found.
 *
 * A region's stay has two ends, and the fixture takes both in turn:
 *   arrival  the profile the bot first enters the region with: its
 *            checkpoint at the boss before's first fall, the Forge shopped
 *            (Region 1's is a fresh profile). In Regions 4–6 it dies at
 *            waves 7–13: a player creeps on from there for about an hour.
 *   cleared  the profile it leaves with: its checkpoint at the region's own
 *            boss's first fall, the Forge shopped. It reaches waves 14–22.
 * Either end alone misreads the region: the arrival's runs are too short to
 * evolve anything, and the clearing tower's are past the struggle.
 *
 * The profiles are stored, since reaching the Blight takes minutes of play
 * per seed, and CI reads them in a second. They are only as current as Act
 * 1: after a change to its balance, regenerate them and re-read the arsenal:
 *
 *   npm run pacing -- --frontiers        FRONTIER_SEEDS' profiles, in parallel
 *   npm run arsenal && npm run arsenal -- --keystones
 *
 * A stored profile is walked up the save ladder (`migrate`) like any save,
 * so a new save version doesn't make the file stale on its own.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { newProfile, type Profile } from '../src/meta/profile';
import { migrate, type RawProfile } from '../src/meta/save/migrate';
import { REGIONS, regionByIndex } from '../src/content/regions';

/** The stored profiles: every seed's, at every Act 1 boss's first fall. */
export const FRONTIER_FILE = 'tools/fixtures/frontiers.json';
/** The pacing profiles kept. A report's seeds take them in turn, so one profile's luck doesn't decide a region. */
export const FRONTIER_SEEDS: readonly number[] = [1, 2, 3];
/** Hours of pacing play given to reach the Blight's fall (~4–5 h on these seeds). */
export const FRONTIER_HOURS = 6;

/** One stored profile: the pacing seed it came from, the boss whose first fall it follows, and the wall second. */
export interface FrontierSave {
  seed: number;
  boss: string;
  at: number;
  profile: RawProfile;
}

/** Write the profiles, one per line so a regeneration's diff reads boss by boss. */
export function saveFrontiers(saves: readonly FrontierSave[]): void {
  mkdirSync(dirname(FRONTIER_FILE), { recursive: true });
  const order = (s: FrontierSave): number => REGIONS.findIndex((r) => r.boss === s.boss);
  const sorted = [...saves].sort((a, b) => order(a) - order(b) || a.seed - b.seed);
  writeFileSync(FRONTIER_FILE, `[\n${sorted.map((s) => JSON.stringify(s)).join(',\n')}\n]\n`);
}

let cache: readonly FrontierSave[] | null = null;

function stored(): readonly FrontierSave[] {
  if (cache) return cache;
  if (!existsSync(FRONTIER_FILE)) throw new Error(`${FRONTIER_FILE} is missing: npm run pacing -- --frontiers`);
  const saves = JSON.parse(readFileSync(FRONTIER_FILE, 'utf8')) as FrontierSave[];
  for (const r of REGIONS) {
    if (!saves.some((s) => s.boss === r.boss)) throw new Error(`${FRONTIER_FILE} has no profile at ${r.boss}'s fall: npm run pacing -- --frontiers`);
  }
  return (cache = saves);
}

/** The stored profiles at `boss`'s first fall, by seed. */
export function savesAt(boss: string): readonly FrontierSave[] {
  return stored().filter((s) => s.boss === boss);
}

/**
 * The `k`th frontier profile of `region`, a fresh copy: even `k` an arrival,
 * odd `k` a cleared one, each kind through the seeds in turn. It is set to
 * play the region as an ordinary run: no Trial or contract the bot had
 * chosen for its next run.
 */
export function frontierProfile(region: number, k = 0): Profile {
  const arrival = k % 2 === 0;
  const boss = arrival ? (region > 1 ? regionByIndex(region - 1).boss : null) : regionByIndex(region).boss;
  let profile: Profile;
  if (boss === null) {
    profile = newProfile(0);
  } else {
    const saves = savesAt(boss);
    profile = migrate(structuredClone(saves[(k >> 1) % saves.length].profile)) as unknown as Profile;
  }
  // The first draft's tutorial pauses for a tap: past it, as the bots' later runs are.
  profile.tutorial.firstDraft = true;
  profile.region = region;
  profile.trial = null;
  profile.contracts.taken = null;
  return profile;
}
