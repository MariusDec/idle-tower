import { BALANCE } from '../content/balance';
import type { AutomationId, CardItemId } from '../content/types';
import { frontier, selectedFrame } from './collection';
import { FORGE_BY_ID } from '../content/forge';
import { buyNode, isBuyable, levelOf, ownedNodes } from './forge';
import type { Profile } from './profile';
import type { RunSummary } from './results';

/**
 * The Engineering branch's automation (§6.2). These are the app's, not the
 * run's: `buildRunConfig` skips them, and this is their one consumer.
 */
export function automations(profile: Profile): ReadonlySet<AutomationId> {
  const out = new Set<AutomationId>();
  for (const { node } of ownedNodes(profile)) {
    for (const e of node.effects) {
      switch (e.kind) {
        case 'automation':
          out.add(e.id);
          break;
        case 'stat':
        case 'unlockCard':
        case 'slot':
        case 'behaviour':
        case 'frame':
        case 'mastery':
        case 'relics':
        case 'starlight':
          break;
        default: {
          const exhaustive: never = e;
          return exhaustive;
        }
      }
    }
  }
  return out;
}

/** The fastest game speed the player has unlocked (§6.2). */
export function maxSpeed(profile: Profile): 1 | 2 | 3 {
  const owned = automations(profile);
  return owned.has('speed-3') ? 3 : owned.has('speed-2') ? 2 : 1;
}

/** The speed a run plays at: the player's choice, within what is unlocked. */
export function runSpeed(profile: Profile): 1 | 2 | 3 {
  return Math.min(profile.settings.speed, maxSpeed(profile)) as 1 | 2 | 3;
}

/** Autocaster (§6.2): owned, and not switched off on the HUD. */
export function autoUlt(profile: Profile): boolean {
  return profile.settings.autoUlt && automations(profile).has('auto-ult');
}

/** The list Tactician II keeps for each frame; Tactician I's one list is `TACTICS_ALL`. */
export const TACTICS_ALL = 'all';

/** Tactician II's key for a frame's lists in one region (U7). */
export function regionScope(frame: string, region: number): string {
  return `${frame}@${region}`;
}

/**
 * Which list the Tactician editor writes by default (§6.2): the shared one,
 * or with Tactician II the selected frame's. Null before Tactician is owned.
 */
export function tacticsKey(profile: Profile): string | null {
  const owned = automations(profile);
  if (!owned.has('tactician')) return null;
  return owned.has('tactician-2') ? selectedFrame(profile).id : TACTICS_ALL;
}

/**
 * Every key whose lists the next run may follow, most specific first (U7):
 * with Tactician II, the selected frame in the selected region, then the
 * frame, then the shared lists; with Tactician I, the shared ones. Empty
 * before the Tactician.
 */
export function tacticsScopes(profile: Profile): string[] {
  const owned = automations(profile);
  if (!owned.has('tactician')) return [];
  if (!owned.has('tactician-2')) return [TACTICS_ALL];
  const frame = selectedFrame(profile).id;
  return [regionScope(frame, profile.region), frame, TACTICS_ALL];
}

/** True when a key holds lists of its own, even empty ones: the player has written it. */
export function hasOwnTactics(profile: Profile, key: string): boolean {
  return key in profile.tactics || key in profile.tacticsNever;
}

/**
 * The lists `key` stands for: its own, or where it has none, the next less
 * specific key's (a frame's lists start as a copy of the shared ones, a
 * region's as the frame's). Empty when nothing is listed anywhere.
 */
export function tacticsFor(profile: Profile, key: string): { order: string[]; never: string[] } {
  const scopes = tacticsScopes(profile);
  const from = scopes.indexOf(key);
  const k = (from < 0 ? [key] : scopes.slice(from)).find((s) => hasOwnTactics(profile, s));
  return k === undefined ? { order: [], never: [] } : { order: [...(profile.tactics[k] ?? [])], never: [...(profile.tacticsNever[k] ?? [])] };
}

/**
 * The next run's priority list, for `RunConfig.priority`: null when there
 * is no Tactician or nothing is listed, and the scorer decides alone.
 */
export function priorityList(profile: Profile): CardItemId[] | null {
  const scopes = tacticsScopes(profile);
  if (scopes.length === 0) return null;
  const list = tacticsFor(profile, scopes[0]).order;
  return list.length > 0 ? list as CardItemId[] : null;
}

/** The next run's Never list (U7), for `RunConfig.never`; null when it is empty. */
export function neverList(profile: Profile): CardItemId[] | null {
  const scopes = tacticsScopes(profile);
  if (scopes.length === 0) return null;
  const list = tacticsFor(profile, scopes[0]).never;
  return list.length > 0 ? list as CardItemId[] : null;
}

/**
 * Frontier March (§6.2): after a boss's first fall, the next run goes to the
 * new frontier. Called once a run is banked; true when it moved.
 */
export function marchOn(profile: Profile, summary: RunSummary): boolean {
  if (!summary.boss?.first || !automations(profile).has('frontier-march')) return false;
  const to = frontier(profile).index;
  if (to === profile.region) return false;
  profile.region = to;
  return true;
}

/**
 * Wall seconds the Opening waits before taking every banked draft's
 * suggestion at once (U2); null before the Tactician, when each draft
 * runs its own timer.
 */
export function openingSeconds(profile: Profile): number | null {
  return automations(profile).has('tactician') ? BALANCE.automation.openingSeconds : null;
}

/** Wall seconds a draft waits before taking the suggestion (§4.5): shorter once the Tactician writes it. */
export function draftSeconds(profile: Profile): number {
  return automations(profile).has('tactician') ? BALANCE.automation.tacticianSeconds : BALANCE.draft.seconds;
}

/** How many Forge nodes the Foreman's wishlist holds (N7). */
export const WISHLIST_MAX = 5;

/** Pin a node to the Foreman's wishlist, or unpin it (N7). False, and nothing changes, when it can't be. */
export function togglePin(profile: Profile, id: string): boolean {
  const node = FORGE_BY_ID[id];
  if (!node || !automations(profile).has('foreman')) return false;
  const i = profile.wishlist.indexOf(id);
  if (i >= 0) {
    profile.wishlist.splice(i, 1);
    return true;
  }
  if (profile.wishlist.length >= WISHLIST_MAX || levelOf(profile, id) >= node.maxLevel) return false;
  profile.wishlist.push(id);
  return true;
}

/**
 * The Foreman (N7): between runs, and as offline shards land, buy the
 * wishlist in order. A pinned node that can't be bought yet (sealed, or not
 * reached) waits its turn; the first one that can be bought but not afforded
 * stops the buying, so the shards are saved for it. A node bought to its last
 * level comes off the list. Returns the ids bought, one per level.
 */
export function foremanBuy(profile: Profile): string[] {
  if (profile.wishlist.length === 0 || !automations(profile).has('foreman')) return [];
  const bought: string[] = [];
  for (;;) {
    profile.wishlist = profile.wishlist.filter((id) => FORGE_BY_ID[id] && levelOf(profile, id) < FORGE_BY_ID[id].maxLevel);
    const next = profile.wishlist.find((id) => isBuyable(profile, id));
    if (next === undefined || !buyNode(profile, next)) return bought;
    bought.push(next);
  }
}
