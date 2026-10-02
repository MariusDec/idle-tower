import type { TrialDef } from './types';

/**
 * Trials (N5): three authored runs per region, opened by its boss. Each is
 * an ordinary run in that region under fixed rules — one weapon, no
 * passives, a given frame, Act 2's pacts as Act 1 "omens" — won by felling
 * the region's boss. Each pays once: a rank of the region's boss relic, a
 * trim for the tower, or a notable no Forge node gives.
 */
export const TRIALS: readonly TrialDef[] = [
  // ── Ashen Fields ───────────────────────────────────────────────────────
  {
    id: 'lone-light', name: 'Lone Light', icon: 'checkered-flag', region: 1,
    text: 'One weapon slot, whatever the Forge gave.',
    rules: [{ kind: 'slots', weapon: 1 }],
    reward: { kind: 'relic', relic: 'gatekeepers-seal' },
  },
  {
    id: 'bare-stone', name: 'Bare Stone', icon: 'checkered-flag', region: 1,
    text: 'No passives.',
    rules: [{ kind: 'slots', passive: 0 }],
    reward: { kind: 'trim', trim: 'ivy', name: 'Ivy' },
  },
  {
    id: 'ash-omen', name: 'Omen of Ash', icon: 'checkered-flag', region: 1,
    text: 'Waves bring 60% more enemies.',
    rules: [{ kind: 'omen', pact: 'hordes', rank: 2 }],
    reward: {
      kind: 'notable', name: 'Drill Sergeant', text: 'Your starting weapon begins one level higher.',
      effects: [{ kind: 'behaviour', id: 'opening-salvo' }],
    },
  },
  // ── Drowned Mire ───────────────────────────────────────────────────────
  {
    id: 'still-water', name: 'Still Water', icon: 'checkered-flag', region: 2,
    text: 'The Bastion frame, and no other.',
    rules: [{ kind: 'frame', frame: 'bastion' }],
    reward: { kind: 'relic', relic: 'mothers-tear' },
  },
  {
    id: 'through-the-mist', name: 'Through the Mist', icon: 'checkered-flag', region: 2,
    text: 'Arcane Bolt and Scattershot only.',
    rules: [{ kind: 'weapons', ids: ['arcane-bolt', 'scattershot'] }],
    reward: { kind: 'trim', trim: 'pennants', name: 'Frost Pennants' },
  },
  {
    id: 'mire-omen', name: 'Omen of the Deep', icon: 'checkered-flag', region: 2,
    text: 'Enemies have half again as much health.',
    rules: [{ kind: 'omen', pact: 'vigour', rank: 2 }],
    reward: {
      kind: 'notable', name: 'Mire Sight', text: '+1 draft reroll per run.',
      effects: [{ kind: 'behaviour', id: 'reroll' }],
    },
  },
  // ── Glass Wastes ───────────────────────────────────────────────────────
  {
    id: 'glass-and-thunder', name: 'Glass and Thunder', icon: 'checkered-flag', region: 3,
    text: 'Chain Lightning, Frost Ring and Mortar only.',
    rules: [{ kind: 'weapons', ids: ['chain-lightning', 'frost-ring', 'mortar'] }],
    reward: { kind: 'relic', relic: 'prism-heart' },
  },
  {
    id: 'two-hands', name: 'Two Hands', icon: 'checkered-flag', region: 3,
    text: 'Two weapon slots at most.',
    rules: [{ kind: 'slots', weapon: 2 }],
    reward: { kind: 'trim', trim: 'runes', name: 'Runes' },
  },
  {
    id: 'glass-omen', name: 'Omen of Glare', icon: 'checkered-flag', region: 3,
    text: 'Enemies move 30% faster.',
    rules: [{ kind: 'omen', pact: 'haste', rank: 2 }],
    reward: {
      kind: 'notable', name: 'Deep Arc', text: 'Chain Lightning leaps to burrowed enemies first, and they surface.',
      effects: [{ kind: 'behaviour', id: 'deep-arc' }],
    },
  },
  // ── Ember Rift ─────────────────────────────────────────────────────────
  {
    id: 'storm-in-the-rift', name: 'Storm in the Rift', icon: 'checkered-flag', region: 4,
    text: 'The Stormcaller frame, and no other.',
    rules: [{ kind: 'frame', frame: 'stormcaller' }],
    reward: { kind: 'relic', relic: 'forgeheart-core' },
  },
  {
    id: 'shell-and-beam', name: 'Shell and Beam', icon: 'checkered-flag', region: 4,
    text: 'Mortar and Sunlance only.',
    rules: [{ kind: 'weapons', ids: ['mortar', 'sunlance'] }],
    reward: { kind: 'trim', trim: 'embers', name: 'Embers' },
  },
  {
    id: 'rift-omen', name: 'Omen of Embers', icon: 'checkered-flag', region: 4,
    text: 'Every elite wave brings two more elites.',
    rules: [{ kind: 'omen', pact: 'elites', rank: 2 }],
    reward: {
      kind: 'notable', name: 'Heavy Shells', text: 'Mortar shells scatter two more bomblets.',
      effects: [{ kind: 'behaviour', id: 'heavy-shells' }],
    },
  },
  // ── The Hollow ─────────────────────────────────────────────────────────
  {
    id: 'alone-in-the-dark', name: 'Alone in the Dark', icon: 'checkered-flag', region: 5,
    text: 'One weapon slot, whatever the Forge gave.',
    rules: [{ kind: 'slots', weapon: 1 }],
    reward: { kind: 'relic', relic: 'hollow-crown' },
  },
  {
    id: 'nothing-held', name: 'Nothing Held', icon: 'checkered-flag', region: 5,
    text: 'No passives.',
    rules: [{ kind: 'slots', passive: 0 }],
    reward: { kind: 'trim', trim: 'gilt', name: 'Gilt' },
  },
  {
    id: 'hollow-omen', name: 'Omen of Want', icon: 'checkered-flag', region: 5,
    text: 'One fewer card in every draft, and 30% more enemies.',
    rules: [{ kind: 'omen', pact: 'scarcity', rank: 1 }, { kind: 'omen', pact: 'hordes', rank: 1 }],
    reward: {
      kind: 'notable', name: 'Clear Mind', text: '+1 Banish per run.',
      effects: [{ kind: 'behaviour', id: 'banish' }],
    },
  },
  // ── Blight Heart ───────────────────────────────────────────────────────
  {
    id: 'last-wall', name: 'The Last Wall', icon: 'checkered-flag', region: 6,
    text: 'Two weapon slots and two passive slots at most.',
    rules: [{ kind: 'slots', weapon: 2, passive: 2 }],
    reward: { kind: 'relic', relic: 'heart-of-light' },
  },
  {
    id: 'blight-omen', name: 'Omen of the Crown', icon: 'checkered-flag', region: 6,
    text: 'The Blight rises once more, with 25% more health.',
    rules: [{ kind: 'omen', pact: 'tyranny', rank: 1 }],
    reward: { kind: 'trim', trim: 'starlit', name: 'Starlit Crystal' },
  },
  {
    id: 'pure-light', name: 'Pure Light', icon: 'checkered-flag', region: 6,
    text: 'Sunlance, Glaives and Chain Lightning only.',
    rules: [{ kind: 'weapons', ids: ['sunlance', 'glaives', 'chain-lightning'] }],
    reward: {
      kind: 'notable', name: 'Dawn Muster', text: 'Start runs two levels higher.',
      effects: [{ kind: 'behaviour', id: 'head-start' }],
    },
  },
];

export const TRIAL_BY_ID: Readonly<Record<string, TrialDef>> = Object.fromEntries(TRIALS.map((t) => [t.id, t]));
