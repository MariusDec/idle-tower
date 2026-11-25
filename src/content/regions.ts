import type { BossId, RegionDef } from './types';

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
    act: 1,
    after: null,
    name: 'Ashen Fields',
    icon: 'level-end-flag',
    text: 'Where the Blight first broke through. No rule.',
    shardBase: 0.2,
    waveShards: 0.4,
    hpBase: 12,
    hpGrowth: 1.18,
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
    act: 1,
    after: 1,
    name: 'Drowned Mire',
    icon: 'droplets',
    text: 'A drowned valley under a mist that never lifts.',
    shardBase: 0.7,
    waveShards: 1.4,
    hpBase: 42,
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
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'fog', 'vengeful'] },
  },
  {
    id: 'glass-wastes',
    index: 3,
    act: 1,
    after: 2,
    name: 'Glass Wastes',
    icon: 'crystal-shine',
    text: 'A desert fired to glass. Everything here cracks.',
    shardBase: 2.4,
    waveShards: 4.8,
    hpBase: 88,
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
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'mirrored', 'split', 'vengeful'] },
  },
  {
    id: 'ember-rift',
    index: 4,
    act: 1,
    after: 3,
    name: 'Ember Rift',
    icon: 'fire-bowl',
    text: 'A wound in the world that never stopped burning.',
    shardBase: 8.4,
    waveShards: 16.8,
    // Q1: 460 → 580. Twin Mount's smarter draw (I3) brought the Prism ~30 min
    // sooner; this puts Forgeheart back mid-gate (132–198) and every Blight
    // past 7 h.
    hpBase: 580,
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
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'molten', 'vengeful'] },
  },
  {
    id: 'the-hollow',
    index: 5,
    act: 1,
    after: 4,
    name: 'The Hollow',
    icon: 'eclipse',
    text: 'The dark at the bottom of the world, where the dead keep house.',
    // Q1: shards 29/58 → 20/40, HP 1600 → 2200. The late game ran ~3.5 h short
    // (I1b); the HP is held where the idle bot's full ring 5 still fells the
    // Hollow King, so the rest of the time is in the pay.
    shardBase: 20,
    waveShards: 40,
    hpBase: 2200,
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
    elites: { from: 5, every: 4, auras: ['haste', 'wraith', 'shield', 'split', 'vengeful'] },
  },
  {
    id: 'blight-heart',
    index: 6,
    act: 1,
    after: 5,
    name: 'Blight Heart',
    icon: 'glass-heart',
    text: 'Where the Blight began. It is listening.',
    // Q1: shards 100/200 → 60/120, HP 2000 → 2300. Past ~2300 the idle bot's
    // full Forge can't fell the Blight (2800: never in 12 days, I2), so the
    // active bot's hours here come from the pay, not the HP.
    shardBase: 60,
    waveShards: 120,
    hpBase: 2300,
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
      from: 1, every: 1, auras: ['haste', 'hungering', 'shield', 'split', 'vengeful'],
      types: ['spitter', 'mender', 'shieldbearer', 'blinker', 'leech'],
    },
  },
  // ── The Wake (plans/late-game/12): the lands the Blight held ──────────
  {
    id: 'bell-marches',
    index: 9,
    act: 2,
    after: 6,
    veil: 'A bell still rings past the Blight Heart.',
    name: 'The Bell Marches',
    icon: 'ringing-bell',
    text: 'Where the Blight’s bell still rings.',
    // D-6: flat, like the Blight Heart; the difficulty is the rule (§14 tunes).
    shardBase: 66,
    waveShards: 132,
    hpBase: 2400,
    hpGrowth: 1.17,
    damageBase: 46,
    damageGrowth: 1.06,
    count: { base: 6, perWave: 2 },
    pool: [
      { enemy: 'ringer', from: 1, weight: 1 },
      { enemy: 'sleepwalker', from: 5, weight: 0.3 },
      { enemy: 'straggler', from: 10, weight: 0.35 },
    ],
    beats: {
      5: { kind: 'introduce', enemy: 'sleepwalker', packs: 2 },
      10: { kind: 'introduce', enemy: 'straggler', packs: 2 },
      15: { kind: 'swarm', countMult: 1.5 },
    },
    rule: { name: 'Toll', text: 'Bodies move only when the bell tolls.', effect: { kind: 'toll', every: 3, window: 0.6 } },
    surge: { text: 'The lurch carries further: a quarter more each toll.', effect: { kind: 'rule' } },
    boss: 'carillon',
    tint: '#4a3a22',
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'resonant', 'vengeful'] },
  },
  {
    id: 'orrery',
    index: 10,
    act: 2,
    after: 9,
    veil: 'Beyond the bell, the ground turns like a wheel.',
    name: 'The Orrery',
    icon: 'ringed-planet',
    text: 'A field that turns like a wheel.',
    shardBase: 66,
    waveShards: 132,
    hpBase: 2400,
    hpGrowth: 1.17,
    damageBase: 46,
    damageGrowth: 1.06,
    count: { base: 6, perWave: 2 },
    pool: [
      { enemy: 'satellite', from: 1, weight: 1 },
      { enemy: 'comet', from: 5, weight: 0.35 },
      { enemy: 'moon', from: 10, weight: 0.12 },
    ],
    beats: {
      5: { kind: 'introduce', enemy: 'comet', packs: 2 },
      10: { kind: 'introduce', enemy: 'moon', packs: 1 },
      15: { kind: 'swarm', countMult: 1.5 },
    },
    rule: { name: 'Orbit', text: 'Nothing walks straight here; everything spirals in.', effect: { kind: 'orbit', tangent: 0.6 } },
    surge: { text: 'The spiral tightens: bodies swing wider as they close.', effect: { kind: 'rule' } },
    boss: 'astrolabe',
    tint: '#1e2a4a',
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'tidal', 'vengeful'] },
  },
  {
    id: 'frozen-sea',
    index: 11,
    act: 2,
    after: 10,
    veil: 'Past the turning field, the Mire lies frozen.',
    name: 'The Frozen Sea',
    icon: 'iceberg',
    text: 'The Mire, frozen hard. Nothing stops where it is pushed.',
    shardBase: 66,
    waveShards: 132,
    hpBase: 2400,
    hpGrowth: 1.17,
    damageBase: 46,
    damageGrowth: 1.06,
    count: { base: 6, perWave: 2 },
    pool: [
      { enemy: 'skater', from: 1, weight: 1 },
      { enemy: 'floe', from: 5, weight: 0.15 },
      { enemy: 'sledge', from: 10, weight: 0.12 },
    ],
    beats: {
      5: { kind: 'introduce', enemy: 'floe', packs: 2 },
      10: { kind: 'introduce', enemy: 'sledge', packs: 1 },
      15: { kind: 'swarm', countMult: 1.5 },
    },
    rule: {
      name: 'Glide',
      text: 'Pushed bodies slide on the ice and bowl over others.',
      effect: { kind: 'glide', carry: 3, friction: 4, impact: 0.25 },
    },
    surge: { text: 'The cold bites: the tower attacks 10% slower.', effect: { kind: 'stat', mod: { key: 'attackSpeed', pct: -0.1 } } },
    boss: 'leviathan',
    tint: '#2e4a5a',
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'anchored', 'vengeful'] },
  },
  {
    id: 'giants-rest',
    index: 12,
    act: 2,
    after: 11,
    veil: 'Beyond the ice, the great dead stir.',
    name: 'Giants’ Rest',
    icon: 'giant',
    text: 'Where the Blight laid its largest dead.',
    shardBase: 66,
    waveShards: 132,
    hpBase: 2400,
    hpGrowth: 1.17,
    damageBase: 46,
    damageGrowth: 1.06,
    count: { base: 6, perWave: 2 },
    pool: [
      { enemy: 'titan', from: 1, weight: 1 },
      { enemy: 'tick', from: 5, weight: 0.3 },
      { enemy: 'herdkeeper', from: 10, weight: 0.12 },
    ],
    beats: {
      5: { kind: 'introduce', enemy: 'tick', packs: 2 },
      10: { kind: 'introduce', enemy: 'herdkeeper', packs: 1 },
      15: { kind: 'swarm', countMult: 1.4 },
    },
    rule: { name: 'Giants', text: 'Half the bodies, each three times as tough.', effect: { kind: 'giants', count: 0.5, size: 1.6, hp: 3, reward: 2 } },
    surge: { text: 'The giants grow: a quarter larger, a quarter tougher.', effect: { kind: 'rule' } },
    boss: 'colossus',
    tint: '#4a4236',
    elites: { from: 5, every: 4, auras: ['haste', 'towering', 'shield', 'split', 'vengeful'] },
  },
  {
    id: 'stormcrown',
    index: 13,
    act: 2,
    // The Wake's finale (plans/late-game/12 §2.5): its boss opens the Abyss.
    after: 12,
    veil: 'A storm sits on the high ground. It never breaks.',
    name: 'Stormcrown',
    icon: 'lightning-tear',
    text: 'The Blight’s last breath, raging over the high ground.',
    shardBase: 66,
    waveShards: 132,
    hpBase: 2400,
    hpGrowth: 1.17,
    damageBase: 46,
    damageGrowth: 1.06,
    count: { base: 6, perWave: 2 },
    pool: [
      { enemy: 'groundling', from: 1, weight: 1 },
      { enemy: 'conductor', from: 5, weight: 0.1 },
      { enemy: 'squallcaller', from: 10, weight: 0.25 },
    ],
    beats: {
      5: { kind: 'introduce', enemy: 'conductor', packs: 1 },
      10: { kind: 'introduce', enemy: 'squallcaller', packs: 2 },
      15: { kind: 'swarm', countMult: 1.5 },
    },
    rule: {
      name: 'Storm',
      text: 'Lightning strikes the toughest body, unless a Conductor stands.',
      effect: { kind: 'storm', every: 5, damage: 0.1, wall: 3 },
    },
    surge: { text: 'The storm quickens: strikes come a fifth sooner.', effect: { kind: 'rule' } },
    boss: 'thunderhead',
    tint: '#26303a',
    elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'charged', 'vengeful'] },
  },
];

/**
 * Follow the `after` links (plans/late-game/12 §8.1): start at the region
 * whose `after` is outside `list` (an Act 1 index), then each region whose
 * `after` is the one before. A region off the chain is left out (the lint
 * fails it).
 */
function chainOrder(list: readonly RegionDef[]): RegionDef[] {
  const inList = new Set(list.map((r) => r.index));
  const out: RegionDef[] = [];
  let next = list.find((r) => r.after !== null && !inList.has(r.after));
  while (next && !out.includes(next)) {
    out.push(next);
    const at = next.index;
    next = list.find((r) => r.after === at);
  }
  return out;
}

/** Act 1's regions, in order (the Map's light, the Act 1 feats and lines). */
export const ACT1_REGIONS: readonly RegionDef[] = REGIONS.filter((r) => r.act === 1);
/** The Wake's regions, in the order their chain opens them (plans/late-game/12). */
export const WAKE_REGIONS: readonly RegionDef[] = chainOrder(REGIONS.filter((r) => r.act === 2));
/** The Wake's last boss: its first fall opens the Abyss (plans/late-game/12 D-1). */
export const WAKE_FINALE: BossId = 'thunderhead';

/**
 * Each region's last light (plans/visual-identity.md §2.2): the fourth stop of
 * the page's ground, the horizon the hub and a run sit under. Each is the
 * region's `tint` mixed 60% into the ember dusk, then darkened until every text
 * token clears 5:1 on it; `tests/contrast.test.ts` holds them there. Presentation
 * only, so it lives beside the regions rather than on them: the sim never reads it.
 */
export const LAST_LIGHT: Readonly<Record<string, string>> = {
  'ashen-fields': '#3b2422',
  'drowned-mire': '#24312f',
  'glass-wastes': '#2f2c39',
  'ember-rift': '#44241b',
  'the-hollow': '#2a1e2c',
  'blight-heart': '#3a171d',
  // The Wake's (plans/late-game/12 §2.0).
  'bell-marches': '#3c2b1e',
  'orrery': '#262a3a',
  'frozen-sea': '#24323a',
  'giants-rest': '#3a3128',
  'stormcrown': '#262b33',
};

export function regionByIndex(index: number): RegionDef {
  const r = REGIONS.find((x) => x.index === index);
  if (!r) throw new Error(`no region ${index}`);
  return r;
}

/** The region whose boss this is. */
export function regionOfBoss(boss: string): RegionDef | undefined {
  return REGIONS.find((r) => r.boss === boss);
}
