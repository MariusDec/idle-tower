import { STARS } from '../content/stars';
import type { BranchId, Effect, FrameId, StarNodeDef } from '../content/types';
import type { Profile } from './profile';
import { Web, type NodeState, type WebGoal } from './web';

/**
 * The Constellations (§9): Act 2's tree, a web like the Forge's, paid in
 * Starlight. Its stat, card, slot and behaviour effects reach runs through
 * `buildRunConfig`; the rest are the profile's, read here: frames, the
 * Forge's masteries, the Abyss's relic sets, a relic slot, and how much a
 * Starlight payout is worth.
 *
 * Nothing in the Constellations refunds: a frame or a relic set taken back
 * would strand what the player already wears.
 */
export const STAR_WEB = new Web<StarNodeDef>({
  nodes: STARS,
  growth: 1.5,
  owned: (p) => p.stars,
  wallet: (p) => p.starlight,
  pay: (p, n) => { p.starlight -= n; },
  sealed: () => false,
  refundable: () => false,
});

export type StarState = NodeState;
export type StarGoal = WebGoal<StarNodeDef>;

/** Every effect the owned stars carry, once per owned level. */
function starEffects(profile: Profile): Effect[] {
  const out: Effect[] = [];
  for (const { node, level } of STAR_WEB.ownedNodes(profile)) {
    for (let i = 0; i < level; i++) out.push(...node.effects);
  }
  return out;
}

/**
 * The profile-side effects of the owned stars, resolved: the one consumer of
 * the `frame`, `mastery`, `relics` and `starlight` kinds (and of a relic
 * slot). Every other kind is the run's, and `buildRunConfig` takes it.
 */
export interface StarGifts {
  frames: FrameId[];
  masteries: BranchId[];
  relicSets: number[];
  relicSlots: number;
  /** Starlight payouts multiply by this. */
  starlight: number;
}

export function starGifts(profile: Profile): StarGifts {
  const out: StarGifts = { frames: [], masteries: [], relicSets: [], relicSlots: 0, starlight: 1 };
  for (const e of starEffects(profile)) {
    switch (e.kind) {
      case 'frame':
        out.frames.push(e.id);
        break;
      case 'mastery':
        out.masteries.push(e.branch);
        break;
      case 'relics':
        out.relicSets.push(e.set);
        break;
      case 'starlight':
        out.starlight += e.pct;
        break;
      case 'slot':
        if (e.slot === 'relic') out.relicSlots += e.n;
        break;
      case 'stat':
      case 'unlockCard':
      case 'behaviour':
      case 'automation':
        // The run's (or the app's): `buildRunConfig` and `automations` take these.
        break;
      default: {
        const exhaustive: never = e;
        return exhaustive;
      }
    }
  }
  return out;
}

/** Stars lit, counting levels: what the Firmament feats count. */
export function starsLit(profile: Profile): number {
  return STAR_WEB.ownedNodes(profile).length;
}

/** Pay `amount` Starlight, grown by the Deep's Stargazers. Returns what was paid, whole. */
export function payStarlight(profile: Profile, amount: number): number {
  if (amount <= 0) return 0;
  const paid = Math.round(amount * starGifts(profile).starlight);
  profile.starlight += paid;
  return paid;
}
