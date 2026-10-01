import { BALANCE } from '../content/balance';
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
export function offlineTier(profile: Profile): { efficiency: number; capHours: number } | null {
  const owned = automations(profile);
  for (let i = TIERS.length - 1; i >= 0; i--) if (owned.has(TIERS[i])) return BALANCE.offline.tiers[i];
  return null;
}

export interface OfflineEarnings {
  /** Seconds away, as measured. */
  away: number;
  /** Seconds that paid: capped. */
  paid: number;
  shards: number;
}

/** What an absence of `awaySeconds` pays, or null when it pays nothing. */
export function offlineEarnings(profile: Profile, awaySeconds: number): OfflineEarnings | null {
  const tier = offlineTier(profile);
  if (!tier || awaySeconds < BALANCE.offline.minSeconds) return null;
  const paid = Math.min(awaySeconds, tier.capHours * 3600);
  const shards = Math.floor(farmRate(profile) * (paid / 60) * tier.efficiency);
  if (shards <= 0) return null;
  return { away: awaySeconds, paid, shards };
}
