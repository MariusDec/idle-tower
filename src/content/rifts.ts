import type { RiftDef, RiftId, RiftRarity } from './types';

/**
 * Rifts (plans/late-game/02 §4): tears that open mid-wave for a watching
 * player to tap. Each has a whisper (`text`, ≤ 8 words), one or two choices
 * of ≤ 15 words (R4), and where it can open. "Leave it" is always there and
 * always free. About half are wagers: a cost and a reward.
 *
 * Value guide (for authoring and the lint's sanity table): a common is worth
 * about 5% of a typical run's shards (or the same in power), a rare about
 * 10%, a legendary about 20% or a run-changing swing. Wagers pay about 1.5×
 * that when they come off.
 *
 * Batch 2 (Act 2, the Abyss, plans 03/05/08: Far Glimpse, Hollow Echo,
 * Star-Tear, Deep Current, Cursed Gift, Whisper) waits for the systems it
 * hooks into.
 */
export const RIFTS: readonly RiftDef[] = [
  {
    id: 'first-tear', name: 'The First Tear', icon: 'star-gate', rarity: 'common', text: 'Something waits on the other side.',
    where: { placed: true },
    choices: [{ text: 'Reach in: a free level-up.', effects: [{ kind: 'draft', n: 1 }] }],
  },
  {
    id: 'wager', name: 'Wager', icon: 'rolling-dices', rarity: 'common', text: 'Double or nothing, it says.',
    where: {},
    choices: [{
      text: 'Double the next wave. Its kills pay double.',
      effects: [{ kind: 'horde', count: 2, waves: 1 }, { kind: 'bounty', mult: 2, span: { waves: 1 } }],
    }],
  },
  {
    id: 'glimmer-cache', name: 'Glimmering Cache', icon: 'gems', rarity: 'common', text: 'Light pooled where no one looked.',
    where: {},
    choices: [
      { text: 'Three waves’ pay in shards.', effects: [{ kind: 'shards', waves: 3 }] },
      { text: 'Mend: heal 40% of Max HP.', effects: [{ kind: 'heal', fraction: 0.4 }] },
    ],
  },
  {
    id: 'stillness', name: 'Stillness', icon: 'hourglass', rarity: 'common', text: 'Time holds its breath here.',
    where: {},
    choices: [
      { text: 'Everything on the field stops for 4 s.', effects: [{ kind: 'stun', seconds: 4 }] },
      {
        text: 'The ultimate fills now, then charges no more for two waves.',
        effects: [{ kind: 'stat', mod: { key: 'ultCharge', mult: 0 }, span: { waves: 2 } }, { kind: 'ult', charge: 1 }],
      },
    ],
  },
  {
    id: 'old-coin', name: 'Old Coin', icon: 'two-coins', rarity: 'common', text: 'Ash-worn, still warm.',
    where: { regions: [1] },
    choices: [
      { text: 'Spend it now: four waves’ pay.', effects: [{ kind: 'shards', waves: 4 }] },
      { text: 'Keep it: twelve waves’ pay if you reach wave 20.', effects: [{ kind: 'shards', waves: 12, atWave: 20 }] },
    ],
  },
  {
    id: 'ashfall', name: 'Ashfall', icon: 'fire-bowl', rarity: 'common', text: 'Grey snow, and something sharp in it.',
    where: { regions: [1] },
    choices: [{
      text: '−20% range for two waves; +10% damage for the rest of the run.',
      effects: [
        { kind: 'stat', mod: { key: 'range', mult: 0.8 }, span: { waves: 2 } },
        { kind: 'stat', mod: { key: 'damage', mult: 1.1 }, span: 'run' },
      ],
    }],
  },
  {
    id: 'loaded-dice', name: 'Loaded Dice', icon: 'coinflip', rarity: 'common', text: 'They always land your way.',
    where: { from: 2 },
    choices: [{ text: 'Two rerolls and one Banish, for this run.', effects: [{ kind: 'charges', rerolls: 2, banishes: 1 }] }],
  },
  {
    id: 'drowned-bell', name: 'Drowned Bell', icon: 'echo-ripples', rarity: 'common', text: 'It tolls under the water.',
    where: { regions: [2] },
    choices: [
      { text: 'Ring it: every body on the field sinks for 3 s.', effects: [{ kind: 'stun', seconds: 3 }] },
      { text: 'Or lift the mist: +15% range for the run.', effects: [{ kind: 'stat', mod: { key: 'range', mult: 1.15 }, span: 'run' }] },
    ],
  },
  {
    id: 'marsh-wisp', name: 'Marsh Wisp', icon: 'lantern-flame', rarity: 'common', text: 'A small light, beckoning.',
    where: { regions: [2] },
    choices: [{
      text: 'Follow it: the next three waves come thicker and pay double.',
      effects: [{ kind: 'horde', count: 1.5, waves: 3 }, { kind: 'bounty', mult: 2, span: { waves: 3 } }],
    }],
  },
  {
    id: 'blood-price', name: 'Blood Price', icon: 'heart-drop', rarity: 'rare', text: 'It wants a little of you.',
    where: { from: 2, needs: 'alchemy' },
    choices: [{
      text: 'Lose a fifth of your HP. Draft an evolution, ready or not.',
      effects: [{ kind: 'hurt', fraction: 0.2 }, { kind: 'draft', n: 1, hand: 'forged' }],
    }],
  },
  {
    id: 'hungry-dark', name: 'Hungry Dark', icon: 'fangs-circle', rarity: 'rare', text: 'Something in there is starving.',
    where: { from: 2, needs: 'relics' },
    choices: [{
      text: 'Feed it: the next elite is a Champion, sure to drop a relic.',
      effects: [{ kind: 'elites', n: 1, champion: true }],
    }],
  },
  {
    id: 'cracked-mirror', name: 'Cracked Mirror', icon: 'shatter', rarity: 'rare', text: 'Your tower, the wrong way round.',
    where: {},
    choices: [{
      text: 'Your strongest weapon loses a level. Every other weapon gains one.',
      effects: [{ kind: 'levels', target: 'strongest', delta: -1 }, { kind: 'levels', target: 'others', delta: 1 }],
    }],
  },
  {
    id: 'shatterglass', name: 'Shatterglass', icon: 'crystal-shine', rarity: 'common', text: 'Every shard a blade.',
    where: { regions: [3] },
    choices: [{
      text: 'Area +30% for the run. Max HP −15%.',
      effects: [
        { kind: 'stat', mod: { key: 'maxHp', mult: 0.85 }, span: 'run' },
        { kind: 'stat', mod: { key: 'area', mult: 1.3 }, span: 'run' },
      ],
    }],
  },
  {
    id: 'split-sky', name: 'Split Sky', icon: 'lightning-branches', rarity: 'legendary', text: 'The sky opens, and something answers.',
    where: { from: 3 },
    choices: [{
      text: 'Every weapon gains a level. The boss arrives with 50% more HP.',
      effects: [{ kind: 'boss', hp: 1.5 }, { kind: 'levels', target: 'all', delta: 1 }],
    }],
  },
  {
    id: 'open-flame', name: 'Open Flame', icon: 'life-tap', rarity: 'rare', text: 'It burns, and it teaches.',
    where: { regions: [4] },
    choices: [{
      text: 'Hold your hand in the flame: lose 30% HP, bank two level-ups.',
      effects: [{ kind: 'hurt', fraction: 0.3 }, { kind: 'draft', n: 2 }],
    }],
  },
  {
    id: 'cinder-oath', name: 'Cinder Oath', icon: 'frostfire', rarity: 'common', text: 'Swear by the embers.',
    where: { regions: [4] },
    choices: [{
      text: 'Damage ×1.3 for three waves, but no regen for the rest of the run.',
      effects: [
        { kind: 'stat', mod: { key: 'regen', mult: 0 }, span: 'run' },
        { kind: 'stat', mod: { key: 'damage', mult: 1.3 }, span: { waves: 3 } },
      ],
    }],
  },
  {
    id: 'whispering-shade', name: 'Whispering Shade', icon: 'wizard-face', rarity: 'rare', text: 'It knows your name.',
    where: { regions: [5] },
    choices: [
      { text: 'Bind it: one more Second Wind this run.', effects: [{ kind: 'charges', revives: 1 }] },
      { text: 'Let it feed: +50% XP for two waves.', effects: [{ kind: 'stat', mod: { key: 'xpGain', mult: 1.5 }, span: { waves: 2 } }] },
    ],
  },
  {
    id: 'blight-bloom', name: 'Blight Bloom', icon: 'pentagram-rose', rarity: 'rare', text: 'It flowers, and the dead crown.',
    where: { regions: [6] },
    choices: [{
      text: 'Until the boss, every wave brings two more elites. Elites pay double.',
      effects: [{ kind: 'elites', n: 2, perWave: true, span: 'boss' }, { kind: 'bounty', mult: 2, span: 'boss', on: 'elites' }],
    }],
  },
  {
    id: 'heart-vein', name: 'Heart Vein', icon: 'glass-heart', rarity: 'legendary', text: 'The Blight’s own pulse, laid bare.',
    where: { regions: [6] },
    choices: [{
      text: 'Drink: Max HP doubles until the boss falls. Regen stops for the run.',
      effects: [
        { kind: 'stat', mod: { key: 'regen', mult: 0 }, span: 'run' },
        { kind: 'stat', mod: { key: 'maxHp', mult: 2 }, span: 'boss' },
      ],
    }],
  },
];

export const RIFT_BY_ID: Readonly<Record<RiftId, RiftDef>> = Object.fromEntries(RIFTS.map((r) => [r.id, r])) as Record<RiftId, RiftDef>;

export const RIFT_RARITIES: readonly RiftRarity[] = ['common', 'rare', 'legendary'];
