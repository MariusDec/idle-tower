/**
 * The one navigation table (UI plan §8.A).
 *
 * Before this file the app had two information architectures for one set of
 * panels: an 11-entry flat tab strip on desktop and an unrelated 4-entry
 * bottom nav with a `'more'` bucket on mobile. Both now read this table, so a
 * tab can only ever live in one place and adding one is a single edit.
 */

import type { PanelTab } from '../types';
import type { IconId } from '../data/icons';

export type NavGroupId = 'build' | 'research' | 'prestige' | 'progress' | 'system';

export interface NavGroup {
  id: NavGroupId;
  label: string;
  icon: IconId;
  tabs: readonly { id: PanelTab; label: string }[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'build',
    label: 'Build',
    icon: 'hammer-nails',
    tabs: [
      { id: 'upgrades', label: 'Upgrades' },
      { id: 'abilities', label: 'Abilities' },
      { id: 'equipment', label: 'Equipment' },
    ],
  },
  {
    id: 'research',
    label: 'Research',
    icon: 'bubbling-flask',
    tabs: [
      { id: 'research', label: 'Research' },
      { id: 'talents', label: 'Talents' },
    ],
  },
  {
    id: 'prestige',
    label: 'Prestige',
    icon: 'star-gate',
    tabs: [
      { id: 'prestige', label: 'Prestige' },
      { id: 'transcendence', label: 'Transcendence' },
    ],
  },
  {
    id: 'progress',
    label: 'Progress',
    icon: 'progression',
    tabs: [
      { id: 'progression', label: 'Progression' },
      { id: 'achievements', label: 'Achievements' },
      { id: 'stats', label: 'Stats' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: 'cog',
    tabs: [{ id: 'settings', label: 'Settings' }],
  },
];

/** Reverse index, built once at module load. */
export const GROUP_OF: Readonly<Record<PanelTab, NavGroupId>> = (() => {
  const out = {} as Record<PanelTab, NavGroupId>;
  for (const group of NAV_GROUPS) {
    for (const tab of group.tabs) out[tab.id] = group.id;
  }
  return out;
})();

export function groupById(id: NavGroupId): NavGroup {
  const found = NAV_GROUPS.find(g => g.id === id);
  if (!found) throw new Error(`unknown nav group: ${id}`);
  return found;
}

/** The tab a group opens on when it has no remembered selection. */
export function firstTabOf(id: NavGroupId): PanelTab {
  return groupById(id).tabs[0].id;
}

/** Narrowing helper for values coming back out of `localStorage`. */
export function isPanelTab(value: unknown): value is PanelTab {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GROUP_OF, value);
}
