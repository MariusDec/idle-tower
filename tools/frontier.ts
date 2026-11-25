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
import { ACT1_REGIONS, WAKE_REGIONS, regionByIndex } from '../src/content/regions';

/** The stored profiles: every seed's, at every Act 1 boss's first fall. */
export const FRONTIER_FILE = 'tools/fixtures/frontiers.json';
/**
 * The Wake's (plans/late-game/12 §10.3): every `--act2` seed's profile at the
 * Blight's fall and at each Wake boss's first fall.
 *
 *   npm run pacing -- --act2 --wake-frontiers --hours 12 --seeds 3
 *   npm run arsenal -- --wake
 */
export const WAKE_FRONTIER_FILE = 'tools/fixtures/wake-frontiers.json';
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
export function saveFrontiers(saves: readonly FrontierSave[], wake = false): void {
  const file = wake ? WAKE_FRONTIER_FILE : FRONTIER_FILE;
  mkdirSync(dirname(file), { recursive: true });
  const bosses = [regionByIndex(6).boss, ...(wake ? WAKE_REGIONS : ACT1_REGIONS).map((r) => r.boss)];
  const order = (s: FrontierSave): number => (bosses as readonly string[]).indexOf(s.boss);
  const sorted = [...saves].sort((a, b) => order(a) - order(b) || a.seed - b.seed);
  writeFileSync(file, `[\n${sorted.map((s) => JSON.stringify(s)).join(',\n')}\n]\n`);
}

const cache = new Map<string, readonly FrontierSave[]>();

function stored(wake: boolean): readonly FrontierSave[] {
  const file = wake ? WAKE_FRONTIER_FILE : FRONTIER_FILE;
  const hit = cache.get(file);
  if (hit) return hit;
  const how = wake ? 'npm run pacing -- --act2 --wake-frontiers' : 'npm run pacing -- --frontiers';
  if (!existsSync(file)) throw new Error(`${file} is missing: ${how}`);
  const saves = JSON.parse(readFileSync(file, 'utf8')) as FrontierSave[];
  for (const r of wake ? WAKE_REGIONS : ACT1_REGIONS) {
    if (!saves.some((s) => s.boss === r.boss)) throw new Error(`${file} has no profile at ${r.boss}'s fall: ${how}`);
  }
  cache.set(file, saves);
  return saves;
}

/** The stored profiles at `boss`'s first fall, by seed: the Wake's fixture for a Wake region's `wake`. */
export function savesAt(boss: string, wake = false): readonly FrontierSave[] {
  return stored(wake).filter((s) => s.boss === boss);
}

/**
 * The `k`th frontier profile of `region`, a fresh copy: even `k` an arrival,
 * odd `k` a cleared one, each kind through the seeds in turn. It is set to
 * play the region as an ordinary run: no Trial or contract the bot had
 * chosen for its next run.
 */
export function frontierProfile(region: number, k = 0): Profile {
  const arrival = k % 2 === 0;
  const def = regionByIndex(region);
  const wake = WAKE_REGIONS.some((r) => r.index === region);
  const boss = arrival ? (def.after !== null ? regionByIndex(def.after).boss : null) : def.boss;
  let profile: Profile;
  if (boss === null) {
    profile = newProfile(0);
  } else {
    const saves = savesAt(boss, wake);
    profile = migrate(structuredClone(saves[(k >> 1) % saves.length].profile)) as unknown as Profile;
  }
  // The first draft's tutorial pauses for a tap: past it, as the bots' later runs are.
  profile.tutorial.firstDraft = true;
  profile.region = region;
  profile.trial = null;
  profile.contracts.taken = null;
  return profile;
}
