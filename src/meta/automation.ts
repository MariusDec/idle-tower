import { BALANCE } from '../content/balance';
import type { AutomationId, CardItemId } from '../content/types';
import { frontier, selectedFrame } from './collection';
import { ownedNodes } from './forge';
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

/**
 * Which list the Tactician editor writes and the next run follows (§6.2):
 * the shared one, or with Tactician II the selected frame's. Null before
 * Tactician is owned.
 */
export function tacticsKey(profile: Profile): string | null {
  const owned = automations(profile);
  if (!owned.has('tactician')) return null;
  return owned.has('tactician-2') ? selectedFrame(profile).id : TACTICS_ALL;
}

/**
 * The next run's priority list, for `RunConfig.priority`: null when there
 * is no Tactician or the list is empty, and the scorer decides alone. A
 * frame's list starts as a copy of the shared one.
 */
export function priorityList(profile: Profile): CardItemId[] | null {
  const key = tacticsKey(profile);
  if (key === null) return null;
  const list = profile.tactics[key] ?? profile.tactics[TACTICS_ALL] ?? [];
  return list.length > 0 ? [...list] as CardItemId[] : null;
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

/** Wall seconds a draft waits before taking the suggestion (§4.5): shorter once the Tactician writes it. */
export function draftSeconds(profile: Profile): number {
  return automations(profile).has('tactician') ? BALANCE.automation.tacticianSeconds : BALANCE.draft.seconds;
}
