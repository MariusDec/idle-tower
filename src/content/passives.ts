import type { FallbackDef, PassiveDef, PassiveId } from './types';

/**
 * Passives (§4.4, §11.3): Act 1's twelve, and Act 2's two (§9), which join
 * from the Constellations. Twelve are each a weapon's evolution partner
 * (`content/evolutions.ts`): Act 1's eight, and Velocity, Fortify, Mending
 * and Greed for Act 2's weapons. The first six are in the
 * draft from the start; the rest join it with a weapon (`joinsWith`), so the
 * opening draft stays small and the pool grows with the Forge (§4.5). All but
 * Bulwark join with weapons sealed by the Gatekeeper, so Region 1's hands are
 * the six it was tuned on.
 */
export const PASSIVES: readonly PassiveDef[] = [
  {
    id: 'power',
    name: 'Power',
    icon: 'mighty-force',
    text: '+15% damage.',
    perLevel: [{ key: 'damage', pct: 0.15 }],
  },
  {
    id: 'haste',
    name: 'Haste',
    icon: 'wingfoot',
    text: '+12% attack speed.',
    perLevel: [{ key: 'attackSpeed', pct: 0.12 }],
  },
  {
    id: 'precision',
    name: 'Precision',
    icon: 'crosshair',
    text: '+5% crit chance, +20% crit damage.',
    perLevel: [{ key: 'critChance', add: 0.05 }, { key: 'critDamage', add: 0.2 }],
  },
  {
    id: 'fortify',
    name: 'Fortify',
    icon: 'heart-tower',
    text: '+20% Max HP.',
    perLevel: [{ key: 'maxHp', pct: 0.2 }],
  },
  {
    id: 'mending',
    name: 'Mending',
    icon: 'regeneration',
    text: 'Regenerate 1% of Max HP per second.',
    perLevel: [{ key: 'regen', add: 0.01 }],
  },
  {
    id: 'insight',
    name: 'Insight',
    icon: 'wisdom',
    text: '+15% XP.',
    perLevel: [{ key: 'xpGain', pct: 0.15 }],
  },
  {
    id: 'velocity',
    name: 'Velocity',
    icon: 'supersonic-arrow',
    text: '+20% projectile speed; at level 5, shots pierce +1.',
    perLevel: [{ key: 'projectileSpeed', pct: 0.2 }],
    atMax: [{ key: 'pierce', add: 1 }],
    joinsWith: 'sentinel-drones',
  },
  {
    id: 'greed',
    name: 'Greed',
    icon: 'shiny-purse',
    text: '+15% shards.',
    perLevel: [{ key: 'shardGain', pct: 0.15 }],
    joinsWith: 'mortar',
  },
  {
    id: 'bulwark',
    name: 'Bulwark',
    icon: 'shield',
    text: '+2 armour: every hit on the tower is 2 weaker.',
    perLevel: [{ key: 'armor', add: 2 }],
    joinsWith: 'frost-ring',
  },
  {
    id: 'area',
    name: 'Area',
    icon: 'explosion-rays',
    text: '+15% area: blasts, pulses and blades reach wider.',
    perLevel: [{ key: 'area', pct: 0.15 }],
    joinsWith: 'mortar',
  },
  {
    id: 'focus',
    name: 'Focus',
    icon: 'concentration-orb',
    text: '+20% duration: slows and burns last longer, beams heat faster.',
    perLevel: [{ key: 'duration', pct: 0.2 }],
    joinsWith: 'sunlance',
  },
  {
    id: 'reach',
    name: 'Reach',
    icon: 'arrow-scope',
    text: '+10% range.',
    perLevel: [{ key: 'range', pct: 0.1 }],
    joinsWith: 'glaives',
  },
  // Act 2 (§9): they join the draft from the Constellations, not with a weapon.
  {
    id: 'zeal',
    name: 'Zeal',
    icon: 'attack-gauge',
    text: '+8% damage and +8% attack speed.',
    perLevel: [{ key: 'damage', pct: 0.08 }, { key: 'attackSpeed', pct: 0.08 }],
    starred: true,
  },
  {
    id: 'conduit',
    name: 'Conduit',
    icon: 'energy-tank',
    text: 'The ultimate charges 15% faster.',
    perLevel: [{ key: 'ultCharge', pct: 0.15 }],
    starred: true,
  },
];

export const PASSIVE_BY_ID: Readonly<Record<PassiveId, PassiveDef>> = Object.fromEntries(
  PASSIVES.map((p) => [p.id, p]),
) as Record<PassiveId, PassiveDef>;

/** Fallback cards (§4.5): offered only when nothing else fills the hand. */
export const FALLBACKS: readonly FallbackDef[] = [
  { id: 'heal', name: 'Mend', icon: 'healing', text: 'Restore 30% of Max HP.' },
  { id: 'shards', name: 'Windfall', icon: 'crystal-cluster', text: 'Shards worth three waves.' },
];
