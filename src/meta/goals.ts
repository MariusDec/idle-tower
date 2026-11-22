import { BOSS_BY_ID } from '../content/bosses';
import { FEATS } from '../content/feats';
import { REGIONS } from '../content/regions';
import type { IconId } from '../content/icons';
import { bossDown, hubUnlocks, regionRelics, relicRank } from './collection';
import { act2Playable, playableFrontier, type Plan } from './plan';
import { contractText } from '../content/contracts';
import { boardOpen, contractById } from './contracts';
import { featProgress, featVisible } from './feats';
import { nextGoal } from './forge';
import { bestHeat } from './pacts';
import type { Profile } from './profile';
import { STAR_WEB } from './stars';

/** The hub's one Next goal line (§7.4). */
export interface HubGoal {
  icon: IconId;
  text: string;
  /** 0–1 when the goal has a measure, else null. */
  progress: number | null;
  /** The hub view a tap on the line opens (plans/late-game/10 §4.6); absent: the line is no link. */
  open?: 'contracts';
}

/** A contract as the Next line reads it. */
function contractGoal(text: string): HubGoal {
  return { icon: 'wanted-reward', text: `Contract: ${text}`, progress: null, open: 'contracts' };
}

/**
 * Chosen in this order (§7.4): an affordable Forge node; the pinned
 * contract (plans/late-game/10 §4.6: the player's own choice); the
 * frontier's boss while it stands; in Act 2 (§9), a star that can be lit;
 * the closest unfinished feat; once the board is open, its Quick card (so
 * the line never runs dry); a relic still to find in a region already
 * cleared; and in Act 2, the frontier's next heat record. On the free plan
 * the frontier stops at the gate, and Act 2 is not named (plans/monetization.md).
 */
export function hubGoal(profile: Profile, plan: Plan = 'full'): HubGoal | null {
  const node = nextGoal(profile);
  if (node && node.progress >= 1) return { icon: node.node.icon, text: `Forge: ${node.node.name} is ready`, progress: 1 };
  const pinned = contractById(profile, profile.contracts.pinned);
  if (pinned) return contractGoal(contractText(pinned));
  const region = playableFrontier(profile, plan);
  if (!bossDown(profile, region.boss)) {
    const boss = BOSS_BY_ID[region.boss];
    const best = profile.regions[region.index]?.bestWave ?? 0;
    return { icon: boss.icon, text: `Defeat ${boss.name} at wave 20`, progress: Math.min(1, best / 20) };
  }
  const act2 = act2Playable(profile, plan);
  if (act2) {
    const star = STAR_WEB.nextGoal(profile);
    if (star && star.progress >= 1) return { icon: star.node.icon, text: `Stars: ${star.node.name} is ready`, progress: 1 };
  }
  let feat: { icon: IconId; text: string; progress: number } | null = null;
  // Not before the Feats tab opens (R1 §2): a goal shouldn't name a screen the player can't see yet.
  for (const f of hubUnlocks(profile).feats ? FEATS : []) {
    if (profile.feats[f.id] || f.riddle || !featVisible(profile, f)) continue;
    const p = featProgress(profile, f);
    if (!feat || p > feat.progress) feat = { icon: f.icon, text: `Feat: ${f.text}`, progress: p };
  }
  if (feat) return feat;
  const quick = boardOpen(profile) ? profile.contracts.board.find((c) => c.slot === 'quick') : undefined;
  if (quick) return contractGoal(contractText(quick));
  for (const r of REGIONS) {
    if (!bossDown(profile, r.boss)) continue;
    const missing = regionRelics(r.index).find((x) => relicRank(profile, x.id) === 0);
    if (missing) return { icon: 'locked-chest', text: `Find a relic in the ${r.name}`, progress: null };
  }
  if (act2) {
    return { icon: 'fire-bowl', text: `Clear the ${region.name} at heat ${bestHeat(profile, region.index) + 1}`, progress: null };
  }
  return node ? { icon: node.node.icon, text: `Forge: ${node.node.name}`, progress: node.progress } : null;
}
