import type { SecretDef, SecretId, WeaponPattern } from './types';

/**
 * Secrets (plans/late-game/05): combinations, boss forms and cosmetics that
 * no star, shop or list reveals. Each is checked only once its `after` boss
 * has fallen. A tally stirs at `BALANCE.secrets.stirAt` of its goal, writing
 * its riddle in the Recipe Book's margin, and is found at the goal; a form
 * arrives when the run meets its condition, and felling it is the find.
 *
 * The margin never says how many there are: nothing outside this file names
 * one (the `secrets` lint holds that), and the Book lists only what was heard.
 *
 * Act 1's eight surface after Forgeheart. Act 2's six (the plan's §4, rows
 * 9–14) are not built yet.
 */
export const SECRETS: readonly SecretDef[] = [
  {
    id: 'shatterfall', name: 'Shatterfall', icon: 'shatter',
    text: 'A shell landing on a frozen body shatters it.',
    hint: 'Ice breaks best when the sky falls on it.',
    after: 'forgeheart',
    trigger: { kind: 'tally', by: 'mortar', on: 'frozen', needs: { carried: ['frost-ring', 'mortar'] }, n: 60 },
    reward: { kind: 'effects', effects: [{ kind: 'behaviour', id: 'shatterfall' }] },
    shards: 8000,
  },
  {
    id: 'beacon-road', name: 'Beacon Road', icon: 'sunbeams',
    text: 'In the Drowned Mire, Sunlance reaches 25% farther.',
    hint: 'A steady beam could burn a road through the mist.',
    after: 'forgeheart',
    trigger: { kind: 'tally', by: 'sunlance', region: 2, n: 150 },
    reward: { kind: 'effects', effects: [{ kind: 'behaviour', id: 'beacon-road' }] },
    shards: 6000,
  },
  {
    id: 'glassfrost', name: 'Glassfrost', icon: 'frozen-orb',
    text: 'In the Glass Wastes, a frozen Shardling bursts at its kin, not the wall.',
    hint: 'Frozen glass breaks the other way.',
    after: 'forgeheart',
    trigger: { kind: 'tally', enemy: 'shardling', on: 'frozen', region: 3, n: 40 },
    reward: { kind: 'effects', effects: [{ kind: 'behaviour', id: 'glassfrost' }] },
    shards: 8000,
  },
  {
    id: 'bellows', name: 'Bellows', icon: 'fire-bowl',
    text: 'In the Ember Rift, pellets spread a burning body’s fire to its neighbours.',
    hint: 'Shot fired through embers comes out burning.',
    after: 'forgeheart',
    trigger: { kind: 'tally', by: 'scattershot', on: 'burning', region: 4, n: 200 },
    reward: { kind: 'effects', effects: [{ kind: 'behaviour', id: 'bellows' }] },
    shards: 10000,
  },
  {
    id: 'the-lens', name: 'The Lens', icon: 'crystal-ball',
    text: 'The Prism’s other face, felled. It drops a Lens Shard.',
    hint: 'It shows its true face only to light it cannot turn.',
    after: 'forgeheart',
    trigger: { kind: 'form', boss: 'prism', when: { kind: 'unturned' } },
    reward: { kind: 'relic', relic: 'lens-shard' },
    shards: 10000,
    form: {
      name: 'The Lens',
      line: 'No glass to turn. It calls its children out of the sand.',
      hp: 1.8,
      color: '#d9e6ee',
      borderColor: '#ffffff',
      phases: [
        { below: 1, line: 'No glass to turn. It calls its children out of the sand.', patterns: [{ kind: 'summon', enemy: 'shardling', packs: 2, every: 8 }] },
        {
          below: 0.5,
          line: 'The sand rises with it.',
          patterns: [
            { kind: 'summon', enemy: 'shardling', packs: 3, every: 8 },
            { kind: 'slam', every: 6, windup: 1.2, speed: 460, damage: 3 },
          ],
        },
      ],
    },
  },
  {
    id: 'banked-forge', name: 'The Banked Forge', icon: 'snowflake-1',
    text: 'Forgeheart, banked cold, felled. Its frost stays on your plinth.',
    hint: 'Bring winter to the forge, and it banks its fire.',
    after: 'forgeheart',
    trigger: { kind: 'form', boss: 'forgeheart', when: { kind: 'needs', needs: { evolved: ['absolute-zero'] } } },
    reward: { kind: 'trim', trim: 'rime', name: 'Rime' },
    shards: 12000,
    form: {
      name: 'The Banked Forge',
      line: 'Its fire banked, it hides behind more iron.',
      hp: 1.5,
      color: '#2c4f63',
      borderColor: '#bfe8ff',
      phases: [
        {
          below: 1, line: 'Its fire banked, it hides behind more iron.', plates: 4,
          patterns: [{ kind: 'summon', enemy: 'bomber', packs: 2, every: 10 }],
        },
        {
          below: 0.66, line: 'Two plates crack away.', plates: 2,
          patterns: [
            { kind: 'slam', every: 6, windup: 1.3, speed: 420, damage: 3.5 },
            { kind: 'summon', enemy: 'blinker', packs: 2, every: 9 },
          ],
        },
        {
          below: 0.33, line: 'The last plate falls. The heart is cold and bare.', armor: 0, plates: 0,
          patterns: [
            { kind: 'slam', every: 4, windup: 1.1, speed: 480, damage: 3.5 },
            { kind: 'summon', enemy: 'siege-engine', packs: 1, every: 0 },
          ],
        },
      ],
    },
  },
  {
    id: 'kintsugi', name: 'Kintsugi', icon: 'cracked-shield',
    text: 'A boss felled from the brink. Gold seams run through the stone.',
    hint: 'Broken stone mends best with gold.',
    after: 'forgeheart',
    trigger: { kind: 'brink', hp: 0.05, stir: 0.15 },
    reward: { kind: 'trim', trim: 'kintsugi', name: 'Kintsugi' },
  },
  {
    id: 'wayward', name: 'The Wayward Banner', icon: 'knight-banner',
    text: 'A boss felled down roads of your own choosing. A banner flies for it.',
    hint: 'The tower remembers every road you chose yourself.',
    after: 'forgeheart',
    trigger: { kind: 'wayward', drafts: 10, stir: 5 },
    reward: { kind: 'trim', trim: 'wayward', name: 'Wayward Banner' },
  },
];

export const SECRET_BY_ID: Readonly<Record<SecretId, SecretDef>> = Object.fromEntries(
  SECRETS.map((s) => [s.id, s]),
) as Record<SecretId, SecretDef>;

/** The patterns a boss's mirror turns back (`turnedAway`): shots in flight that strike bodies. Beams, chains and blasts pass. */
export const MIRRORED_PATTERNS: ReadonlySet<WeaponPattern> = new Set<WeaponPattern>(['homing', 'cone', 'drone', 'boomerang']);

/** The region a secret is bound to (its tally's), or null for one that works anywhere. */
export function secretRegion(def: SecretDef): number | null {
  return def.trigger.kind === 'tally' ? def.trigger.region ?? null : null;
}
