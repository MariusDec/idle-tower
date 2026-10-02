import { abyssStarlight } from '../content/abyss';
import { RUSH_STAGES, rushStarlight } from '../content/rush';
import { BALANCE } from '../content/balance';
import { heatShardMult } from '../sim/pacts';
import { PACTS, PACT_BY_ID } from '../content/pacts';
import type { PactId } from '../content/types';
import { act2Open, pastRegions } from './collection';
import type { Profile } from './profile';
import { payStarlight } from './stars';

/**
 * Pacts, heat and Starlight's income (§9). The player sets each pact's rank
 * between runs; heat is their sum. A region's boss felled at a new heat
 * record pays Starlight for every heat level the record passes, once, more
 * for the higher levels; a new deepest floor of the Abyss pays per floor,
 * and a Boss Rush record on its curve. Pure functions over
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

/** The ranks the next run is under, for `RunConfig.pacts`: none in the Abyss, Boss Rush or before Act 2. */
export function runPacts(profile: Profile): Partial<Record<PactId, number>> {
  if (!act2Open(profile) || pastRegions(profile)) return {};
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

/** Starlight heat level `h` pays, once per region (S7, D-8): `1 + floor(h / 5)`, the same everywhere. */
export function heatStarlight(h: number): number {
  return h <= 0 ? 0 : 1 + Math.floor(h / BALANCE.starlight.every);
}

/** Starlight a record of `h` in `region` pays before the Stargazers: each level past the old record, once. */
export function recordStarlight(profile: Profile, region: number, h: number): number {
  let sum = 0;
  for (let l = bestHeat(profile, region) + 1; l <= h; l++) sum += heatStarlight(l);
  return sum;
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

/** A run cleared `floors` floors of the Abyss: a new deepest floor pays for each floor it passes (§9, S7). */
export function recordFloor(profile: Profile, floors: number): StarRecord | null {
  const old = profile.abyss.best;
  if (floors <= old) return null;
  const starlight = payStarlight(profile, abyssStarlight(floors) - abyssStarlight(old));
  profile.abyss.best = floors;
  return { old, now: floors, starlight };
}

/** A Boss Rush record (N8): stages cleared, the full clear's time, and the Starlight the record paid. */
export interface RushRecord {
  old: { stages: number; time: number | null };
  now: { stages: number; time: number | null };
  starlight: number;
}

/**
 * A Boss Rush run cleared `stages` stages, the last falling at `seconds`:
 * more stages, or a faster full clear, is a record, and pays the difference
 * on `rushStarlight`'s curve.
 */
export function recordRush(profile: Profile, stages: number, seconds: number): RushRecord | null {
  const old = { ...profile.rush };
  const time = stages >= RUSH_STAGES ? seconds : null;
  const better = stages > old.best || (time !== null && (old.time === null || time < old.time));
  if (!better) return null;
  const now = { best: Math.max(old.best, stages), time: time !== null && (old.time === null || time < old.time) ? time : old.time };
  const starlight = payStarlight(profile, rushStarlight(now.best, now.time) - rushStarlight(old.best, old.time));
  profile.rush = now;
  return { old: { stages: old.best, time: old.time }, now: { stages: now.best, time: now.time }, starlight };
}
