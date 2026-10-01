import type { RegionDef } from './types';

/**
 * Regions (§4.2, §11.1). Each is 20 waves; wave 20 is the boss (P4). Region 1
 * only at P1.
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
  },
];

export function regionByIndex(index: number): RegionDef {
  const r = REGIONS.find((x) => x.index === index);
  if (!r) throw new Error(`no region ${index}`);
  return r;
}
