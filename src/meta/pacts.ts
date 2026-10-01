import { abyssStarlight } from '../content/abyss';
import { BALANCE } from '../content/balance';
import { heatShardMult } from '../sim/pacts';
import { PACTS, PACT_BY_ID } from '../content/pacts';
import type { PactId } from '../content/types';
import { act2Open, inAbyss } from './collection';
import type { Profile } from './profile';
import { payStarlight } from './stars';

/**
 * Pacts, heat and Starlight's income (§9). The player sets each pact's rank
 * between runs; heat is their sum. A region's boss felled at a new heat
 * record pays Starlight for every heat level the record passes, once; a
 * new deepest floor of the Abyss pays on its log curve. Pure functions over
 * the profile; the UI, `bankRun` and the pacing bot all go through here.
 */

export function pactRank(profile: Profile, id: PactId): number {
  return Math.max(0, Math.min(PACT_BY_ID[id].ranks, profile.pacts.ranks[id] ?? 0));
}

/** The heat the next region run is under: every rank of every pact. */
export function heat(profile: Profile): number {
  return PACTS.reduce((s, p) => s + pactRank(profile, p.id), 0);
}

/** Set a pact's rank. False, and nothing changes, before Act 2 or out of range. */
export function setPactRank(profile: Profile, id: PactId, rank: number): boolean {
  const def = PACT_BY_ID[id];
  if (!act2Open(profile) || !def || !Number.isInteger(rank) || rank < 0 || rank > def.ranks) return false;
  if (rank === 0) delete profile.pacts.ranks[id];
  else profile.pacts.ranks[id] = rank;
  return true;
}

/** The ranks the next run is under, for `RunConfig.pacts`: none in the Abyss or before Act 2. */
export function runPacts(profile: Profile): Partial<Record<PactId, number>> {
  if (!act2Open(profile) || inAbyss(profile)) return {};
  const out: Partial<Record<PactId, number>> = {};
  for (const p of PACTS) {
    const r = pactRank(profile, p.id);
    if (r > 0) out[p.id] = r;
  }
  return out;
}

/** The shard multiplier heat brings (§9: × (1 + 0.1 × heat)); the run applies it (`sim/pacts.ts`). */
export const heatShards = heatShardMult;

/** The highest heat a region's boss has fallen at; 0 before any. */
export function bestHeat(profile: Profile, region: number): number {
  return profile.pacts.best[region] ?? 0;
}

/** Starlight a record of `h` in `region` pays before the Stargazers: each level past the old record, once. */
export function recordStarlight(profile: Profile, region: number, h: number): number {
  const per = BALANCE.starlight.perHeat[region - 1] ?? 0;
  return Math.max(0, h - bestHeat(profile, region)) * per;
}

/** A record broken, and the Starlight it paid. */
export interface StarRecord {
  old: number;
  now: number;
  starlight: number;
}

/**
 * A region's boss fell at heat `h`: a new record pays (§9). Returns the
 * record and its Starlight, or null when it broke none.
 */
export function recordHeat(profile: Profile, region: number, h: number): StarRecord | null {
  const old = bestHeat(profile, region);
  if (!act2Open(profile) || h <= old) return null;
  const starlight = payStarlight(profile, recordStarlight(profile, region, h));
  profile.pacts.best[region] = h;
  return { old, now: h, starlight };
}

/** A run cleared `floors` floors of the Abyss: a new deepest floor pays on the log curve (§9). */
export function recordFloor(profile: Profile, floors: number): StarRecord | null {
  const old = profile.abyss.best;
  if (floors <= old) return null;
  const starlight = payStarlight(profile, abyssStarlight(floors) - abyssStarlight(old));
  profile.abyss.best = floors;
  return { old, now: floors, starlight };
}
