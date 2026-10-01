import type { RegionDef } from './types';

/**
 * Regions (§4.2, §11.1). Each is 20 waves; wave 20 is the boss, and overtime
 * follows. Region k's wave-1 bodies have about ×4 the HP of region k − 1's,
 * and pay about ×3.5 the shards (§8.2, §8.3). P4 ships Regions 1–2.
 */
export const REGIONS: readonly RegionDef[] = [
  {
    id: 'ashen-fields',
    index: 1,
    name: 'Ashen Fields',
    icon: 'level-end-flag',
    text: 'Where the Blight first broke through. No rule.',
    shardBase: 0.2,
    waveShards: 0.4,
    hpBase: 10,
    hpGrowth: 1.17,
    damageBase: 3.2,
    damageGrowth: 1.06,
    count: { base: 6, perWave: 2.2 },
    pool: [
      { enemy: 'grunt', from: 1, weight: 1 },
      { enemy: 'runner', from: 5, weight: 0.35 },
      { enemy: 'brute', from: 10, weight: 0.12 },
    ],
    beats: {
      5: { kind: 'introduce', enemy: 'runner', packs: 2 },
      10: { kind: 'introduce', enemy: 'brute', packs: 2 },
      15: { kind: 'swarm', countMult: 1.6 },
    },
    rule: null,
    boss: 'gatekeeper',
    tint: null,
    elites: { from: 10, every: 5, auras: [] },
  },
  {
    id: 'drowned-mire',
    index: 2,
    name: 'Drowned Mire',
    icon: 'droplets',
    text: 'A drowned valley under a mist that never lifts.',
    shardBase: 0.7,
    waveShards: 1.4,
    hpBase: 30,
    hpGrowth: 1.17,
    damageBase: 6.5,
    damageGrowth: 1.06,
    count: { base: 6, perWave: 2 },
    pool: [
      { enemy: 'splitter', from: 1, weight: 1 },
      { enemy: 'spitter', from: 5, weight: 0.3 },
      { enemy: 'mender', from: 10, weight: 0.14 },
    ],
    beats: {
      5: { kind: 'introduce', enemy: 'spitter', packs: 2 },
      10: { kind: 'introduce', enemy: 'mender', packs: 2 },
      15: { kind: 'swarm', countMult: 1.5 },
    },
    rule: { name: 'Mist', text: 'The tower sees 15% less far.', effect: { kind: 'stat', mod: { key: 'range', pct: -0.15 } } },
    boss: 'bog-mother',
    tint: '#1d4a3c',
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'split', 'vengeful'] },
  },
];

export function regionByIndex(index: number): RegionDef {
  const r = REGIONS.find((x) => x.index === index);
  if (!r) throw new Error(`no region ${index}`);
  return r;
}

/** The region whose boss this is. */
export function regionOfBoss(boss: string): RegionDef | undefined {
  return REGIONS.find((r) => r.boss === boss);
}
