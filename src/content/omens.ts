import type { OmenModDef } from './types';

/**
 * The Daily Omen's modifiers (plans/late-game/11 §5). A day draws one boon,
 * one twist, then banes (pacts as omens) until its points lie in
 * `BALANCE.omen.points`. Each line is ≤ 15 words (R4, linted with the
 * other tables); `meta/omen.ts` rolls and applies them.
 *
 * Gates, Narrowing, Hollow Bell and Early Bloom (§5's later table) wait on
 * seams their siblings have not built yet: strata rules read from the
 * config, the Hollow Bell itself, and an evolve-level hook.
 */
export const OMEN_MODS: readonly OmenModDef[] = [
  // Boons.
  {
    id: 'blizzard-lit', name: 'Blizzard', icon: 'frozen-orb', slot: 'boon', points: -2, weight: 1,
    text: 'Blizzard is lit: Chain Lightning and Frost Ring can fuse.',
    rules: [{ kind: 'fusion', id: 'blizzard' }], clashes: ['lone-light', 'bare-stone'],
  },
  {
    id: 'firestorm-lit', name: 'Firestorm', icon: 'fragmented-meteor', slot: 'boon', points: -2, weight: 1,
    text: 'Firestorm is lit: Mortar and Scattershot can fuse.',
    rules: [{ kind: 'fusion', id: 'firestorm' }], clashes: ['lone-light', 'bare-stone'],
  },
  {
    id: 'dawnstar-lit', name: 'Dawnstar', icon: 'sunbeams', slot: 'boon', points: -2, weight: 1,
    text: 'Dawnstar is lit: Sunlance and Arcane Bolt can fuse.',
    rules: [{ kind: 'fusion', id: 'dawnstar' }], clashes: ['lone-light', 'bare-stone'],
  },
  {
    id: 'sky-hive-lit', name: 'Sky Hive', icon: 'delivery-drone', slot: 'boon', points: -2, weight: 1,
    text: 'Sky Hive is lit: Glaives and Sentinel Drones can fuse.',
    rules: [{ kind: 'fusion', id: 'sky-hive' }], clashes: ['lone-light', 'bare-stone'],
  },
  {
    id: 'mothers-tear', name: 'Mother’s Tear', icon: 'chalice-drops', slot: 'boon', points: -1, weight: 1,
    text: 'Mother’s Tear rides with you, at rank III.',
    rules: [{ kind: 'relic', relic: 'mothers-tear', rank: 3 }],
  },
  {
    id: 'phoenix', name: 'Phoenix Feather', icon: 'arrow-flights', slot: 'boon', points: -1, weight: 1,
    text: 'Phoenix Feather: once, rise again at half health.',
    rules: [{ kind: 'relic', relic: 'phoenix-feather', rank: 1 }], clashes: ['lent-glass-crown'],
  },
  {
    id: 'early-light', name: 'Early Light', icon: 'upgrade', slot: 'boon', points: -1, weight: 1,
    text: 'Start four levels higher, the drafts banked.',
    rules: [{ kind: 'level', n: 4 }],
  },
  // From the siblings (§5's later table): Rifts (02) and anomalies (04).
  {
    id: 'rift-touched', name: 'Rift-touched', icon: 'star-gate', slot: 'boon', points: -1, weight: 1,
    text: 'Rift-touched: rifts open twice as often.',
    rules: [{ kind: 'rifts', rate: 2 }],
  },
  {
    id: 'strange-stars', name: 'Strange Stars', icon: 'star-swirl', slot: 'boon', points: -1, weight: 1,
    text: 'Strange stars: an anomaly will be dealt.',
    rules: [{ kind: 'anomaly', chance: 1 }],
  },
  // Twists.
  {
    id: 'lone-light', name: 'Lone Light', icon: 'eye-target', slot: 'twist', points: 3, weight: 1,
    text: 'One weapon slot.',
    rules: [{ kind: 'slots', weapon: 1 }],
  },
  {
    id: 'two-hands', name: 'Two Hands', icon: 'crossed-swords', slot: 'twist', points: 2, weight: 2,
    text: 'Two weapon slots at most.',
    rules: [{ kind: 'slots', weapon: 2 }],
  },
  {
    id: 'bare-stone', name: 'Bare Stone', icon: 'stone-block', slot: 'twist', points: 3, weight: 1,
    text: 'No passives.',
    rules: [{ kind: 'slots', passive: 0 }],
  },
  {
    id: 'glass', name: 'Glass Cannon', icon: 'cannon', slot: 'twist', points: 1, weight: 2,
    text: 'Glass Cannon is set: damage ×1.8, Max HP and regen halved.',
    rules: [{ kind: 'keystone', id: 'glass-cannon' }],
  },
  {
    id: 'specialist', name: 'Specialist', icon: 'bullseye', slot: 'twist', points: 1, weight: 2,
    text: 'Specialist is set: your first weapon ×2.5, all else −25%.',
    rules: [{ kind: 'keystone', id: 'specialist' }],
  },
  {
    id: 'fortress', name: 'Fortress', icon: 'castle', slot: 'twist', points: 1, weight: 2,
    text: 'Fortress is set: slower attacks, double Max HP, fiercer Thorns.',
    rules: [{ kind: 'keystone', id: 'fortress' }],
  },
  // From Cursed relics (03): lent for the day, its boon and its curse.
  {
    id: 'lent-glass-crown', name: 'Lent: Glass Crown', icon: 'crowned-skull', slot: 'twist', points: 1, weight: 1,
    text: 'Lent: Glass Crown. Damage ×1.5; the tower never rises again.',
    rules: [{ kind: 'relic', relic: 'glass-crown', rank: 1 }],
  },
  // Banes: pacts as omens, at the day's rank.
  {
    id: 'hordes', name: 'Hordes', icon: 'crossed-bones', slot: 'bane', points: 1, weight: 1, pact: 'hordes', maxRank: 2,
    text: 'Waves bring 30% more enemies, per rank.', rules: [],
  },
  {
    id: 'vigour', name: 'Vigour', icon: 'heart-plus', slot: 'bane', points: 1, weight: 1, pact: 'vigour', maxRank: 2,
    text: 'Enemies have 25% more health, per rank.', rules: [],
  },
  {
    id: 'haste', name: 'Quickening', icon: 'fast-arrow', slot: 'bane', points: 1, weight: 1, pact: 'haste', maxRank: 2,
    text: 'Enemies move 15% faster, per rank.', rules: [],
  },
  {
    id: 'elites', name: 'Elites', icon: 'crowned-skull', slot: 'bane', points: 1, weight: 1, pact: 'elites', maxRank: 2,
    text: 'Each elite wave brings one more elite, per rank.', rules: [],
  },
  {
    id: 'scarcity', name: 'Scarcity', icon: 'two-coins', slot: 'bane', points: 1, weight: 0.5, pact: 'scarcity', maxRank: 1,
    text: 'One fewer card in every draft.', rules: [],
  },
];

export const OMEN_MOD_BY_ID: Readonly<Record<string, OmenModDef>> = Object.fromEntries(OMEN_MODS.map((m) => [m.id, m]));

/**
 * Bumped by hand whenever the sim's code changes how a run plays
 * (plans/late-game/11 §4.6): it joins the rules tag, so a code from
 * another build says so.
 */
export const OMEN_SIM = 2;

/** The Omen's trims (§5): cosmetic, earned once. */
export const OMEN_TRIMS = [
  { trim: 'veil', name: 'Augur’s Veil' },
  { trim: 'starfall', name: 'Starfall' },
] as const;
