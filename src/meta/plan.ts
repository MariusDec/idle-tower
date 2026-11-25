import { REGIONS, regionByIndex } from '../content/regions';
import type { RegionDef } from '../content/types';
import { abyssOpen, act2Open, hubUnlocks, regionUnlocked, type HubUnlocks } from './collection';
import type { Profile } from './profile';

/**
 * What the free plan plays, and what the one purchase opens
 * (plans/monetization.md). Pure: no I/O, no DOM, no billing.
 *
 * **Earned ≠ playable.** `regionUnlocked` keeps meaning "earned by play" and
 * never sees a plan; the sim, `buildRunConfig` and the pacing bot read it as
 * before. The plan is applied at the *doors*: the places that choose or start
 * a run, and the hub's tabs. Every function here that a door asks takes the
 * plan as an argument, never from a global, so the doors stay testable.
 *
 * Which plan the player is on is `app/entitlement.ts`'s business; this module
 * only says what each plan means.
 */

/** Which plan the player is on. Two, and no trial state. */
export type Plan = 'free' | 'full';

/** The last region the free plan plays: the Ashen Fields, the Drowned Mire, the Glass Wastes. */
export const FREE_REGIONS = 3;

/**
 * True for a place the free plan doesn't play: Regions 4–6, the Abyss (7)
 * and Boss Rush (8). The Abyss and Boss Rush sit past `FREE_REGIONS` by
 * index, so they need no case of their own (a test pins it).
 */
export function regionPaid(index: number): boolean {
  return index > FREE_REGIONS;
}

/** True when `plan` plays the place at `index`, earned or not. */
export function planAllows(plan: Plan, index: number): boolean {
  return plan === 'full' || !regionPaid(index);
}

/** Earned *and* allowed by the plan: the one predicate the doors ask. */
export function regionPlayable(profile: Profile, index: number, plan: Plan): boolean {
  return regionUnlocked(profile, index) && planAllows(plan, index);
}

/** Act 2 (pacts, the Constellations, the Abyss, Boss Rush, the Omen) on this plan. */
export function act2Playable(profile: Profile, plan: Plan): boolean {
  return act2Open(profile) && plan === 'full';
}

/** The Abyss (and Boss Rush) on this plan (plans/late-game/12 §8.2). */
export function abyssPlayable(profile: Profile, plan: Plan): boolean {
  return abyssOpen(profile) && plan === 'full';
}

/** The furthest region this plan plays: `frontier`, stopped at the gate. */
export function playableFrontier(profile: Profile, plan: Plan): RegionDef {
  let best = REGIONS[0];
  for (const r of REGIONS) if (regionPlayable(profile, r.index, plan) && r.index > best.index) best = r;
  return best;
}

/**
 * The region the purchase would open next, once it is earned: the first
 * paid region, while the free plan holds it shut. Null on the full plan, and
 * before the Prism falls. The Map's locked card, the results' prompt and the
 * explainer all ask this.
 */
export function sealedRegion(profile: Profile, plan: Plan): RegionDef | null {
  const gate = FREE_REGIONS + 1;
  return plan === 'free' && regionUnlocked(profile, gate) ? regionByIndex(gate) : null;
}

/** The hub's tabs on this plan: the Constellations are Act 2's. */
export function hubUnlocksFor(profile: Profile, plan: Plan): HubUnlocks {
  const hub = hubUnlocks(profile);
  return { ...hub, stars: hub.stars && plan === 'full' };
}

/**
 * Bring the next run back inside the plan: at boot, and on a downgrade (a
 * refund, or the dev switch). A chosen region, Trial or taken contract past
 * the gate goes back to the furthest playable region. True when anything
 * moved. The full plan changes nothing.
 */
export function clampToPlan(profile: Profile, plan: Plan): boolean {
  if (plan === 'full') return false;
  let moved = false;
  if (regionPaid(profile.region)) {
    profile.region = playableFrontier(profile, plan).index;
    moved = true;
  }
  // A taken card's detour home must not lead past the gate either.
  const back = profile.contracts.back;
  if (back && regionPaid(back.region)) {
    profile.contracts.back = { ...back, region: profile.region };
    moved = true;
  }
  return moved;
}
