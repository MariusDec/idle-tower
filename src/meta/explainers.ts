import { EXPLAINERS, type ExplainerDef, type ExplainerId, type ExplainerView } from '../content/explainers';
import { REGIONS } from '../content/regions';
import { tacticsKey } from './automation';
import { act2Open, collectionPages, hubUnlocks, rushOpen, trophyCount } from './collection';
import { towerTier } from './forge';
import type { Profile } from './profile';
import { trims, trialsOpen } from './trials';

/** True once the player can meet the mechanic an explainer tells of (§7.1). */
export function explainerOpen(profile: Profile, id: ExplainerId): boolean {
  switch (id) {
    case 'tower':
      return towerTier(profile) > 1 || trophyCount(profile) > 0 || trims(profile).length > 0;
    case 'forge':
      return hubUnlocks(profile).forge;
    case 'map':
      return hubUnlocks(profile).map;
    case 'trials':
      return REGIONS.some((r) => trialsOpen(profile, r.index));
    case 'abyss':
      return act2Open(profile);
    case 'rush':
      return rushOpen(profile);
    case 'bestiary':
      return collectionPages(profile).bestiary;
    case 'relics':
      return collectionPages(profile).relics;
    case 'recipes':
      return collectionPages(profile).recipes;
    case 'frames':
      return collectionPages(profile).frames;
    case 'feats':
      return hubUnlocks(profile).feats;
    case 'stars':
      return hubUnlocks(profile).stars;
    case 'tactics':
      return tacticsKey(profile) !== null;
    case 'pacts':
      return act2Open(profile);
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

/** A view's explainers the player can meet, in order: what its "?" tells. */
export function explainersFor(profile: Profile, view: ExplainerView): ExplainerDef[] {
  return EXPLAINERS.filter((e) => e.view === view && explainerOpen(profile, e.id));
}

/** A view's explainers not yet read: what opening it tells unasked. */
export function unreadExplainers(profile: Profile, view: ExplainerView): ExplainerDef[] {
  const seen = new Set(profile.tutorial.explained);
  return explainersFor(profile, view).filter((e) => !seen.has(e.id));
}

/** Mark explainers read, once the player has dismissed them. */
export function markExplained(profile: Profile, ids: readonly ExplainerId[]): void {
  const seen = new Set(profile.tutorial.explained);
  for (const id of ids) seen.add(id);
  profile.tutorial.explained = [...seen];
}
