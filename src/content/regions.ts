import type { RegionDef } from './types';

/**
 * Regions (§4.2, §11.1). Each is 20 waves; wave 20 is the boss, and overtime
 * follows. Region k's wave-1 bodies have about ×4 the HP of region k − 1's,
 * and pay about ×3.5 the shards (§8.2, §8.3). `surge` is what the Blight
 * Surge pact does there (§9): the rule made harsher where it is a hazard,
 * a toll on the tower where it favours the tower or there is none.
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
    surge: { text: 'Ash falls: the tower sees 10% less far.', effect: { kind: 'stat', mod: { key: 'range', pct: -0.1 } } },
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
    surge: { text: 'The mist thickens: 15% less range again.', effect: { kind: 'rule' } },
    boss: 'bog-mother',
    tint: '#1d4a3c',
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'split', 'vengeful'] },
  },
  {
    id: 'glass-wastes',
    index: 3,
    name: 'Glass Wastes',
    icon: 'crystal-shine',
    text: 'A desert fired to glass. Everything here cracks.',
    shardBase: 2.4,
    waveShards: 4.8,
    hpBase: 95,
    hpGrowth: 1.17,
    damageBase: 12,
    damageGrowth: 1.06,
    count: { base: 6, perWave: 2 },
    pool: [
      { enemy: 'shieldbearer', from: 1, weight: 1 },
      { enemy: 'burrower', from: 5, weight: 0.35 },
      { enemy: 'shardling', from: 10, weight: 0.3 },
    ],
    beats: {
      5: { kind: 'introduce', enemy: 'burrower', packs: 2 },
      10: { kind: 'introduce', enemy: 'shardling', packs: 2 },
      15: { kind: 'swarm', countMult: 1.5 },
    },
    rule: { name: 'Brittle', text: 'Blasts, pulses, burns and the ultimate hit 25% harder.', effect: { kind: 'areaDamage', mult: 1.25 } },
    surge: { text: 'Glare off the glass: the tower attacks 10% slower.', effect: { kind: 'stat', mod: { key: 'attackSpeed', pct: -0.1 } } },
    boss: 'prism',
    tint: '#4a5a66',
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'split', 'vengeful'] },
  },
  {
    id: 'ember-rift',
    index: 4,
    name: 'Ember Rift',
    icon: 'fire-bowl',
    text: 'A wound in the world that never stopped burning.',
    shardBase: 8.4,
    waveShards: 16.8,
    hpBase: 290,
    hpGrowth: 1.17,
    damageBase: 22,
    damageGrowth: 1.06,
    count: { base: 6, perWave: 2 },
    pool: [
      { enemy: 'bomber', from: 1, weight: 1 },
      { enemy: 'blinker', from: 5, weight: 0.4 },
      { enemy: 'siege-engine', from: 10, weight: 0.1 },
    ],
    beats: {
      5: { kind: 'introduce', enemy: 'blinker', packs: 2 },
      10: { kind: 'introduce', enemy: 'siege-engine', packs: 1 },
      15: { kind: 'swarm', countMult: 1.5 },
    },
    rule: { name: 'Cinders', text: 'Every kill leaves burning ground that sets the next walker alight.', effect: { kind: 'cinders', radius: 45, seconds: 3, burn: 0.15 } },
    surge: { text: 'The heat rises: the tower has 10% less Max HP.', effect: { kind: 'stat', mod: { key: 'maxHp', pct: -0.1 } } },
    boss: 'forgeheart',
    tint: '#4a2416',
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'split', 'vengeful'] },
  },
  {
    id: 'the-hollow',
    index: 5,
    name: 'The Hollow',
    icon: 'eclipse',
    text: 'The dark at the bottom of the world, where the dead keep house.',
    shardBase: 29,
    waveShards: 58,
    hpBase: 1450,
    hpGrowth: 1.17,
    damageBase: 38,
    damageGrowth: 1.06,
    count: { base: 6, perWave: 2 },
    pool: [
      { enemy: 'phantom', from: 1, weight: 1 },
      { enemy: 'leech', from: 5, weight: 0.4 },
      { enemy: 'summoner', from: 10, weight: 0.1 },
    ],
    beats: {
      5: { kind: 'introduce', enemy: 'leech', packs: 2 },
      10: { kind: 'introduce', enemy: 'summoner', packs: 1 },
      15: { kind: 'swarm', countMult: 1.5 },
    },
    rule: { name: 'Echoes', text: 'One kill in ten rises once more as a shade.', effect: { kind: 'echoes', chance: 0.1, hp: 0.5, reward: 0.5 } },
    surge: { text: 'One more in ten of the slain rises as a shade.', effect: { kind: 'rule' } },
    boss: 'hollow-king',
    tint: '#1e1a33',
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'split', 'vengeful'] },
  },
  {
    id: 'blight-heart',
    index: 6,
    name: 'Blight Heart',
    icon: 'glass-heart',
    text: 'Where the Blight began. It is listening.',
    shardBase: 100,
    waveShards: 200,
    hpBase: 1300,
    hpGrowth: 1.17,
    damageBase: 45,
    damageGrowth: 1.06,
    count: { base: 6, perWave: 2 },
    pool: [
      { enemy: 'chorus', from: 1, weight: 1 },
      { enemy: 'harbinger', from: 5, weight: 0.12 },
      { enemy: 'phantom', from: 10, weight: 0.25 },
    ],
    beats: {
      5: { kind: 'introduce', enemy: 'harbinger', packs: 1 },
      10: { kind: 'swarm', countMult: 1.3 },
      // Softer than the other regions' 1.5: with an elite on every wave, the
      // full swarm carried 100+ bodies into the Blight's wave (P9).
      15: { kind: 'swarm', countMult: 1.25 },
    },
    rule: { name: 'Blight', text: 'Every wave brings an elite: old enemies, crowned.', effect: { kind: 'blight' } },
    surge: { text: 'Every wave brings one more elite.', effect: { kind: 'rule' } },
    boss: 'blight',
    tint: '#3a0f1a',
    elites: {
      from: 1, every: 1, auras: ['haste', 'regen', 'shield', 'split', 'vengeful'],
      types: ['spitter', 'mender', 'shieldbearer', 'blinker', 'leech'],
    },
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
