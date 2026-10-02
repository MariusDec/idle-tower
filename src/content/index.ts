import { BOSSES } from './bosses';
import { AURAS, ENEMIES } from './enemies';
import { EVOLUTIONS } from './evolutions';
import { FEATS } from './feats';
import { FUSIONS } from './fusions';
import { FORGE } from './forge';
import { FRAMES } from './frames';
import { PACTS } from './pacts';
import { FALLBACKS, PASSIVES } from './passives';
import { REGIONS } from './regions';
import { RELICS, RELIC_SETS } from './relics';
import { STARS } from './stars';
import { TRIALS } from './trials';
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
  evolutions: EVOLUTIONS,
  fusions: FUSIONS,
  fallbacks: FALLBACKS,
  forge: FORGE,
  relics: RELICS,
  sets: RELIC_SETS,
  feats: FEATS,
  pacts: PACTS,
  stars: STARS,
  trials: TRIALS,
};
