import type { FallbackDef, PassiveDef, PassiveId } from './types';

/**
 * Passives (§4.4, §11.3). Six at P2: the three evolution partners of the P2
 * weapons (Power, Haste, Precision) and three that keep the tower standing.
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
];

export const PASSIVE_BY_ID: Readonly<Record<PassiveId, PassiveDef>> = Object.fromEntries(
  PASSIVES.map((p) => [p.id, p]),
) as Record<PassiveId, PassiveDef>;

/** Fallback cards (§4.5): offered only when nothing else fills the hand. */
export const FALLBACKS: readonly FallbackDef[] = [
  { id: 'heal', name: 'Mend', icon: 'healing', text: 'Restore 30% of Max HP.' },
  { id: 'shards', name: 'Windfall', icon: 'crystal-cluster', text: '+10 shards.' },
];
