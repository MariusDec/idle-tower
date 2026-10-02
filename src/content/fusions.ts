import type { FusionDef, FusionId } from './types';

/**
 * Fusions (N9): Act 2's discovery hook. Two evolved weapons and a
 * Constellation star make a fusion card; taken, the two share one mount,
 * which frees a slot, both hit harder (`BALANCE.fusions.damage`), and they
 * work together in one way of their own. Hidden until found, then kept on
 * the Recipe Book's second page.
 */
export const FUSIONS: readonly FusionDef[] = [
  {
    id: 'blizzard', name: 'Blizzard', icon: 'frozen-orb',
    text: 'Lightning strikes frozen bodies for double, and freezes what it strikes.',
    weapons: ['chain-lightning', 'frost-ring'],
    hint: 'The storms want something cold to strike.',
  },
  {
    id: 'firestorm', name: 'Firestorm', icon: 'fragmented-meteor',
    text: 'Shells and meteors set alight what they hit; burning bodies take 50% more.',
    weapons: ['mortar', 'scattershot'],
    hint: 'The sky wants the dragon’s fire.',
  },
  {
    id: 'dawnstar', name: 'Dawnstar', icon: 'sunbeams',
    text: 'Bolts strike whatever the beam holds for 75% more.',
    weapons: ['sunlance', 'arcane-bolt'],
    hint: 'The beam wants the seekers to follow it.',
  },
  {
    id: 'sky-hive', name: 'Sky Hive', icon: 'delivery-drone',
    text: 'Every blade kill calls a drone from the hive.',
    weapons: ['glaives', 'sentinel-drones'],
    hint: 'The hive wants the blades to feed it.',
  },
];

export const FUSION_BY_ID: Readonly<Record<FusionId, FusionDef>> = Object.fromEntries(
  FUSIONS.map((f) => [f.id, f]),
) as Record<FusionId, FusionDef>;
