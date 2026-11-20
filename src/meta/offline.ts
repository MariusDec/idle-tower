import { BALANCE, type OfflineTier, type StoredTier } from '../content/balance';
import { automations } from './automation';
import type { Profile } from './profile';

/**
 * Offline progress (§6.3): recent farm rate × time away × efficiency, up to
 * the cap. Shards only: no simulated combat, no bosses, relics or feats.
 */

/** Note a finished run's shards per wall-clock minute, if it ran long enough to count. */
export function recordFarm(profile: Profile, shards: number, wallSeconds: number): void {
  const O = BALANCE.offline;
  if (wallSeconds < O.minRunSeconds) return;
  profile.farm.push(shards / (wallSeconds / 60));
  if (profile.farm.length > O.runs) profile.farm.splice(0, profile.farm.length - O.runs);
}

/** The median of the recent runs' shards per minute; 0 before any run counts. */
export function farmRate(profile: Profile): number {
  const s = [...profile.farm].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Night Watch I–IV, in tier order (§6.2). */
const TIERS = ['offline', 'offline-2', 'offline-3', 'offline-4'] as const;

/** The highest owned offline tier, or null before Night Watch (§6.2). */
export function offlineTier(profile: Profile): OfflineTier | null {
  const owned = automations(profile);
  for (let i = TIERS.length - 1; i >= 0; i--) if (owned.has(TIERS[i])) return BALANCE.offline.tiers[i];
  return null;
}

/**
 * The burn rates Stored Light runs at (plans/late-game/01 §3.2): the highest
 * owned tier's with a store. With a pool but no such tier (Night Watch III
 * refunded), tier III's; null when there is nothing to burn.
 */
export function storedRates(profile: Profile): StoredTier | null {
  const owned = offlineTier(profile)?.stored;
  if (owned) return owned;
  if (profile.storedLight <= 0) return null;
  return BALANCE.offline.tiers.find((t) => t.stored !== null)?.stored ?? null;
}

/**
 * The tier an absence is paid at: the highest owned Night Watch, or the
 * built-in Night Watch 0 before any (R8 §1). `offlineTier` stays "owned
 * only", so Stored Light and the Forge's text read as before.
 */
export function paidTier(profile: Profile): OfflineTier {
  return offlineTier(profile) ?? BALANCE.offline.base;
}

export interface OfflineEarnings {
  /** Seconds away, as measured. */
  away: number;
  /** Seconds the instant part paid for: capped. */
  paid: number;
  /** Shards paid at once. */
  shards: number;
  /** Shards stored as Stored Light (from Night Watch III); 0 before it. */
  stored: number;
}

/**
 * What an absence of `awaySeconds` pays, or null when it pays nothing. The
 * instant part and the stored part come from the same farm rate and time
 * away, each with its own efficiency and cap (plans/late-game/01 §3.1).
 */
export function offlineEarnings(profile: Profile, awaySeconds: number): OfflineEarnings | null {
  const tier = paidTier(profile);
  if (awaySeconds < BALANCE.offline.minSeconds) return null;
  const rate = farmRate(profile);
  const paid = Math.min(awaySeconds, tier.capHours * 3600);
  const shards = Math.floor(rate * (paid / 60) * tier.efficiency);
  const s = tier.stored;
  const stored = s ? Math.floor(rate * (Math.min(awaySeconds, s.capHours * 3600) / 60) * s.efficiency) : 0;
  if (shards <= 0 && stored <= 0) return null;
  return { away: awaySeconds, paid, shards: Math.max(0, shards), stored: Math.max(0, stored) };
}
