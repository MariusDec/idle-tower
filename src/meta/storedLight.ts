import { BALANCE } from '../content/balance';
import { storedRates } from './offline';
import type { Profile } from './profile';

/**
 * Stored Light (plans/late-game/01): from Night Watch III, most of a night
 * away is kept as a pool that only runs burn. A run's base shards are
 * tallied per wave as played (`engaged`) or left alone (`handsOff`), and at
 * the bank the pool pays a bonus on each at its own rate.
 *
 * Pure, and app-side only: the sim never knows. Records, the farm rate and
 * feats read the run's own shards, never the bonus, so a burn can't raise
 * the next night's store.
 */

/** A run's base shards, split by whether the wave they came from was played. */
export interface BurnTally {
  engaged: number;
  handsOff: number;
}

export const emptyTally = (): BurnTally => ({ engaged: 0, handsOff: 0 });

/**
 * True when a wave from `start` to `end` (wall ms) counts as played: a touch
 * during it, or in the `engagedSeconds` before it ended.
 */
export function waveEngaged(lastTouch: number, start: number, end: number): boolean {
  return lastTouch >= Math.min(start, end - BALANCE.offline.engagedSeconds * 1000);
}

/** Add `shards` to the tally's bucket for a wave played or left alone. */
export function tallyWave(tally: BurnTally, shards: number, engaged: boolean): void {
  if (shards <= 0) return;
  if (engaged) tally.engaged += shards;
  else tally.handsOff += shards;
}

export interface BurnResult {
  /** Shards paid from the pool, whole. */
  bonus: number;
  /** The part of `bonus` that came from played waves: active-only (I9). */
  engagedBonus: number;
  /** The pool after the burn. */
  left: number;
  /** The multiple a played wave ran at. */
  rate: number;
}

/**
 * What the pool pays on `tally`, or null when it pays nothing. Pure: the
 * caller adds `bonus` to the shards and takes it off the pool. The engaged
 * part is reserved first, so a pool that runs short pays played waves first.
 */
export function burnBonus(profile: Profile, tally: BurnTally): BurnResult | null {
  const rates = storedRates(profile);
  const pool = Math.max(0, profile.storedLight);
  if (!rates || pool <= 0) return null;
  const engagedWant = Math.max(0, tally.engaged) * (rates.engaged - 1);
  const handsOffWant = Math.max(0, tally.handsOff) * (rates.handsOff - 1);
  const bonus = Math.floor(Math.min(pool, engagedWant + handsOffWant));
  if (bonus <= 0) return null;
  const engagedBonus = Math.min(bonus, Math.floor(engagedWant));
  return { bonus, engagedBonus, left: pool - bonus, rate: rates.engaged };
}

/**
 * How many shards the pool would still match a played run of `shards` with:
 * what the HUD's gauge drains by as a run goes on.
 */
export function storedWant(profile: Profile, tally: BurnTally): number {
  const rates = storedRates(profile);
  if (!rates) return 0;
  return tally.engaged * (rates.engaged - 1) + tally.handsOff * (rates.handsOff - 1);
}
