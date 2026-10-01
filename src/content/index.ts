import { BOSSES } from './bosses';
import { AURAS, ENEMIES } from './enemies';
import { FEATS } from './feats';
import { FORGE } from './forge';
import { FRAMES } from './frames';
import { FALLBACKS, PASSIVES } from './passives';
import { REGIONS } from './regions';
import { RELICS } from './relics';
import { WEAPONS } from './weapons';
import type { ContentEntry } from './types';

/**
 * Every content table, by name. The lint (`content/lint.ts`) walks this, so a
 * new table is linted the moment it is registered here.
 */
export const CONTENT: Readonly<Record<string, readonly ContentEntry[]>> = {
  frames: FRAMES,
  enemies: ENEMIES,
  auras: AURAS,
  bosses: BOSSES,
  regions: REGIONS,
  weapons: WEAPONS,
  passives: PASSIVES,
  fallbacks: FALLBACKS,
  forge: FORGE,
  relics: RELICS,
  feats: FEATS,
};
