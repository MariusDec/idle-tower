import { BOSS_BY_ID } from '../content/bosses';
import { FEATS } from '../content/feats';
import { REGIONS } from '../content/regions';
import type { IconId } from '../content/icons';
import { bossDown, frontier, regionRelics, relicRank } from './collection';
import { featProgress, featVisible } from './feats';
import { nextGoal } from './forge';
import type { Profile } from './profile';

/** The hub's one Next goal line (§7.4). */
export interface HubGoal {
  icon: IconId;
  text: string;
  /** 0–1 when the goal has a measure, else null. */
  progress: number | null;
}

/**
 * Chosen in this order (§7.4): an affordable Forge node; the frontier's boss
 * while it stands; the closest unfinished feat; a relic still to find in a
 * region already cleared.
 */
export function hubGoal(profile: Profile): HubGoal | null {
  const node = nextGoal(profile);
  if (node && node.progress >= 1) return { icon: node.node.icon, text: `Forge: ${node.node.name} is ready`, progress: 1 };
  const region = frontier(profile);
  if (!bossDown(profile, region.boss)) {
    const boss = BOSS_BY_ID[region.boss];
    const best = profile.regions[region.index]?.bestWave ?? 0;
    return { icon: boss.icon, text: `Defeat ${boss.name} at wave 20`, progress: Math.min(1, best / 20) };
  }
  let feat: { icon: IconId; text: string; progress: number } | null = null;
  for (const f of FEATS) {
    if (profile.feats[f.id] || f.riddle || !featVisible(profile, f)) continue;
    const p = featProgress(profile, f);
    if (!feat || p > feat.progress) feat = { icon: f.icon, text: `Feat: ${f.text}`, progress: p };
  }
  if (feat) return feat;
  for (const r of REGIONS) {
    if (!bossDown(profile, r.boss)) continue;
    const missing = regionRelics(r.index).find((x) => relicRank(profile, x.id) === 0);
    if (missing) return { icon: 'locked-chest', text: `Find a relic in the ${r.name}`, progress: null };
  }
  return node ? { icon: node.node.icon, text: `Forge: ${node.node.name}`, progress: node.progress } : null;
}
