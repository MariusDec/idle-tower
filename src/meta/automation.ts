import type { AutomationId } from '../content/types';
import { ownedNodes } from './forge';
import type { Profile } from './profile';

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
  return automations(profile).has('speed-2') ? 2 : 1;
}

/** The speed a run plays at: the player's choice, within what is unlocked. */
export function runSpeed(profile: Profile): 1 | 2 | 3 {
  return Math.min(profile.settings.speed, maxSpeed(profile)) as 1 | 2 | 3;
}
