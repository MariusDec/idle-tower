import { REGIONS, regionByIndex } from '../content/regions';
import { RELIC_BY_ID } from '../content/relics';
import { TRIALS, TRIAL_BY_ID } from '../content/trials';
import type { Effect, TrialDef, TrimId } from '../content/types';
import { bossDown, gainRelic, regionUnlocked } from './collection';
import type { Profile } from './profile';

/**
 * Trials (N5): authored runs, three per region, opened by its boss. Pure
 * functions over the profile; the Map, `buildRunConfig` (the rules) and
 * `bankRun` (the reward) all ask here.
 */

/** True once a region's boss has fallen: its trials are open. */
export function trialsOpen(profile: Profile, region: number): boolean {
  return REGIONS.some((r) => r.index === region) && bossDown(profile, regionByIndex(region).boss);
}

/** A region's trials, in order. */
export function regionTrials(region: number): TrialDef[] {
  return TRIALS.filter((t) => t.region === region);
}

export function trialWon(profile: Profile, id: string): boolean {
  return profile.trials[id] === true;
}

/**
 * The trial the next run is, if one is chosen, still open, and in the
 * region the next run goes to; null for an ordinary run. A trial left
 * chosen (its run's snapshot lost) never follows the player elsewhere.
 */
export function selectedTrial(profile: Profile): TrialDef | null {
  const t = profile.trial ? TRIAL_BY_ID[profile.trial] : undefined;
  return t && profile.region === t.region && trialsOpen(profile, t.region) && regionUnlocked(profile, t.region) ? t : null;
}

/**
 * Make the next run trial `id` (its region with it), or an ordinary run
 * again with null. False, and nothing changes, for a trial not yet open.
 */
export function chooseTrial(profile: Profile, id: string | null): boolean {
  if (id === null) {
    profile.trial = null;
    return true;
  }
  const t = TRIAL_BY_ID[id];
  if (!t || !trialsOpen(profile, t.region)) return false;
  profile.trial = id;
  profile.region = t.region;
  return true;
}

/** The trims Trials have paid (N2), for the tower's look. */
export function trims(profile: Profile): TrimId[] {
  return TRIALS.flatMap((t) => (trialWon(profile, t.id) && t.reward.kind === 'trim' ? [t.reward.trim] : []));
}

/** The effects of every notable Trials have paid: they apply to every run, like a Forge node's (N5). */
export function trialEffects(profile: Profile): Effect[] {
  return TRIALS.flatMap((t) => (trialWon(profile, t.id) && t.reward.kind === 'notable' ? [...t.reward.effects] : []));
}

/** What a won trial paid, in words for the results screen. */
export interface TrialPaid {
  id: string;
  /** "Gatekeeper's Seal · rank II", "Tower trim: Ivy (cosmetic)", "Deep Arc: …". */
  line: string;
}

/**
 * A trial won (N5): marked, and its reward paid, once. A relic at its peak
 * already pays as a duplicate does, through `bankRun`'s melt; here it is
 * simply named. Null when it was already won.
 */
export function winTrial(profile: Profile, id: string): TrialPaid | null {
  const t = TRIAL_BY_ID[id];
  if (!t || trialWon(profile, id)) return null;
  profile.trials[id] = true;
  const r = t.reward;
  switch (r.kind) {
    case 'relic': {
      const rank = gainRelic(profile, r.relic);
      const name = RELIC_BY_ID[r.relic].name;
      return { id, line: rank === 0 ? `${name} · already at its peak` : `${name} · ${rank === 1 ? 'new relic' : `rank ${'I'.repeat(rank)}`}` };
    }
    case 'trim':
      return { id, line: `Tower trim: ${r.name} (cosmetic)` };
    case 'notable':
      return { id, line: `${r.name}: ${r.text}` };
    default: {
      const exhaustive: never = r;
      return exhaustive;
    }
  }
}

/** Trials won of all, for the Collection's count and the feats' eye. */
export function trialsWon(profile: Profile): number {
  return TRIALS.filter((t) => trialWon(profile, t.id)).length;
}
