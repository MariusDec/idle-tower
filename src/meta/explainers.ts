import { EXPLAINERS, type ExplainerDef, type ExplainerId, type ExplainerView } from '../content/explainers';
import { REGIONS } from '../content/regions';
import { tacticsKey } from './automation';
import { boardOpen } from './contracts';
import { collectionPages, hubUnlocks, ownedCursed, rushOpen, trophyCount } from './collection';
import { abyssPlayable, act2Playable, hubUnlocksFor, sealedRegion, type Plan } from './plan';
import { towerTier } from './forge';
import type { Profile } from './profile';
import { margin } from './secrets';
import { omenOpen } from './omen';
import { trims, trialsOpen } from './trials';

/**
 * True once the player can meet the mechanic an explainer tells of (§7.1).
 * On the free plan, Act 2's wait behind the purchase (plans/monetization.md).
 */
export function explainerOpen(profile: Profile, id: ExplainerId, plan: Plan = 'full'): boolean {
  switch (id) {
    case 'tower':
      return towerTier(profile) > 1 || trophyCount(profile) > 0 || trims(profile).length > 0;
    case 'stored':
      return profile.storedLight > 0 || profile.records.storedBurned > 0;
    case 'forge':
      return hubUnlocks(profile).forge;
    case 'map':
      return hubUnlocks(profile).map;
    case 'trials':
      return REGIONS.some((r) => trialsOpen(profile, r.index));
    case 'sealed':
      return sealedRegion(profile, plan) !== null;
    case 'wake':
      return act2Playable(profile, plan);
    case 'abyss':
      return abyssPlayable(profile, plan);
    case 'waypoints':
      return profile.abyss.felled >= 1;
    case 'rush':
      return rushOpen(profile) && plan === 'full';
    case 'bestiary':
      return collectionPages(profile).bestiary;
    case 'relics':
      return collectionPages(profile).relics;
    case 'recipes':
      return collectionPages(profile).recipes;
    case 'frames':
      return collectionPages(profile).frames;
    case 'rifts':
      return collectionPages(profile).rifts;
    case 'cursed':
      return ownedCursed(profile).length > 0;
    case 'whispers':
      return margin(profile).length > 0;
    case 'forms':
      // One evolution done: Alchemy is owned, and Scattershot's second slot too (plans/late-game/07 §2).
      return profile.recipes.found.length >= 1;
    case 'anomalies':
      return profile.anomalies.found.length + profile.anomalies.glimpsed.length > 0;
    case 'feats':
      return hubUnlocks(profile).feats;
    case 'stars':
      return hubUnlocksFor(profile, plan).stars;
    case 'tactics':
      return tacticsKey(profile) !== null;
    case 'pacts':
      return act2Playable(profile, plan);
    case 'contracts':
      return boardOpen(profile);
    case 'omen':
      return omenOpen(profile) && plan === 'full';
    // Told mid-run, on the event itself (R1 §4): open once told.
    case 'tear':
    case 'champion':
    case 'aura':
      return profile.tutorial.explained.includes(id);
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

/** A view's explainers the player can meet, in order: what its "?" tells. */
export function explainersFor(profile: Profile, view: ExplainerView, plan: Plan = 'full'): ExplainerDef[] {
  return EXPLAINERS.filter((e) => e.view === view && explainerOpen(profile, e.id, plan));
}

/** A view's explainers not yet read: what opening it tells unasked. */
export function unreadExplainers(profile: Profile, view: ExplainerView, plan: Plan = 'full'): ExplainerDef[] {
  const seen = new Set(profile.tutorial.explained);
  return explainersFor(profile, view, plan).filter((e) => !seen.has(e.id));
}

/** Mark explainers read, once the player has dismissed them. */
export function markExplained(profile: Profile, ids: readonly ExplainerId[]): void {
  const seen = new Set(profile.tutorial.explained);
  for (const id of ids) seen.add(id);
  profile.tutorial.explained = [...seen];
}
