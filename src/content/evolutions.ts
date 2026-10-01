import type { EvolutionDef, EvolutionId, WeaponId } from './types';

/**
 * Evolutions (§4.4, §11.2): a weapon at its last level and its partner
 * passive make a new pattern and a power spike. Twelve recipes (Act 2 adds
 * four, §9), hidden until
 * found and then kept in the Recipe Book (§5.3). `hint` is the nudge the
 * Book shows once the weapon has been maxed a few times.
 */
export const EVOLUTIONS: readonly EvolutionDef[] = [
  {
    id: 'seeker-swarm', name: 'Seeker Swarm', icon: 'missile-swarm',
    text: 'Critical bolts burst into two seekers that hunt fresh targets.',
    weapon: 'arcane-bolt', passive: 'precision',
    hint: 'The bolts want a keener eye.',
  },
  {
    id: 'dragonbreath', name: 'Dragonbreath', icon: 'dragon-breath',
    text: 'Pellets set enemies alight; the fire spreads when they fall.',
    weapon: 'scattershot', passive: 'power',
    hint: 'The pellets want more force behind them.',
  },
  {
    id: 'storm-crown', name: 'Storm Crown', icon: 'lightning-storm',
    text: 'Three storms circle the tower, each casting its own lightning.',
    weapon: 'chain-lightning', passive: 'haste',
    hint: 'The lightning wants to strike faster.',
  },
  {
    id: 'absolute-zero', name: 'Absolute Zero', icon: 'snowflake-2',
    text: 'Pulses freeze enemies solid; frozen enemies shatter when slain.',
    weapon: 'frost-ring', passive: 'bulwark',
    hint: 'The frost wants walls to hold behind.',
  },
  {
    id: 'meteorfall', name: 'Meteorfall', icon: 'burning-meteor',
    text: 'A meteor falls every 3 s, leaving the ground ablaze.',
    weapon: 'mortar', passive: 'area',
    hint: 'The shells want a wider sky.',
  },
  {
    id: 'judgment', name: 'Judgment', icon: 'sun',
    text: 'At full heat the beam splits across three targets.',
    weapon: 'sunlance', passive: 'focus',
    hint: 'The beam wants a steadier mind.',
  },
  {
    id: 'halo', name: 'Halo', icon: 'spiked-halo',
    text: 'The blades sweep out to the edge of range and back.',
    weapon: 'glaives', passive: 'reach',
    hint: 'The blades want to fly farther.',
  },
  {
    id: 'hive', name: 'Hive', icon: 'beehive',
    text: 'Drone kills call more drones for a few seconds.',
    weapon: 'sentinel-drones', passive: 'insight',
    hint: 'The drones want to learn from each kill.',
  },
  // Act 2 (§9): partnered with the four Act 1 passives that had none.
  {
    id: 'crescent-storm', name: 'Crescent Storm', icon: 'spinning-blades',
    text: 'Every throw also looses a ring of crescents in all directions.',
    weapon: 'moonblade', passive: 'velocity',
    hint: 'The crescents want to fly faster.',
  },
  {
    id: 'bulwark-runes', name: 'Bulwark Runes', icon: 'pentagram-rose',
    text: 'Anything that strikes the wall sets off a rune where it stands.',
    weapon: 'rune-traps', passive: 'fortify',
    hint: 'The runes want stronger walls to guard.',
  },
  {
    id: 'lifebloom', name: 'Lifebloom', icon: 'heart-plus',
    text: 'Each tether mends the tower; a kill passes its thread on at once.',
    weapon: 'soul-tether', passive: 'mending',
    hint: 'The threads want to carry life back.',
  },
  {
    id: 'midas-lance', name: 'Midas Lance', icon: 'gold-bar',
    text: 'What the slug pierces turns to gold: it takes more and pays double.',
    weapon: 'gilded-rail', passive: 'greed',
    hint: 'The slug wants a greedier hand.',
  },
];

export const EVOLUTION_BY_ID: Readonly<Record<EvolutionId, EvolutionDef>> = Object.fromEntries(
  EVOLUTIONS.map((e) => [e.id, e]),
) as Record<EvolutionId, EvolutionDef>;

/** A weapon's evolution: every weapon has exactly one (the lint checks). */
export const EVOLUTION_OF: Readonly<Record<WeaponId, EvolutionDef>> = Object.fromEntries(
  EVOLUTIONS.map((e) => [e.weapon, e]),
) as Record<WeaponId, EvolutionDef>;
