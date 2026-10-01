import type { BossDef, BossId } from './types';

/**
 * Bosses (§4.3, §11.1): wave 20 of each region. 2–3 phases, one readable
 * pattern each. A boss stops at its standoff and works from there; one that
 * outlasts `BALANCE.boss.enrageAfter` walks to the wall instead.
 *
 * HP is a multiple of the region's wave-20 HP (§8.2: about 25–35 s of the
 * DPS expected there); `npm run inspect -- --forge all --region 2` reads the fight.
 */
export const BOSSES: readonly BossDef[] = [
  {
    id: 'gatekeeper',
    name: 'The Gatekeeper',
    icon: 'locked-fortress',
    text: 'Slams the ground; the shockwave hits the tower. Calls Grunts when hurt.',
    hp: 65,
    armor: 0.04,
    speed: 32,
    radius: 60,
    standoff: 190,
    damage: 4,
    xp: 30,
    shards: 400,
    mass: 12,
    relicSlot: true,
    phases: [
      {
        below: 1,
        line: 'It slams the ground. A Nova in the wind-up staggers it.',
        patterns: [{ kind: 'slam', every: 6, windup: 1.3, speed: 420, damage: 4 }],
      },
      {
        below: 0.66,
        line: 'It calls the Grunts of the Fields to the gate.',
        patterns: [
          { kind: 'summon', enemy: 'grunt', packs: 6, every: 0 },
          { kind: 'summon', enemy: 'grunt', packs: 3, every: 11 },
          { kind: 'slam', every: 5, windup: 1.2, speed: 440, damage: 4 },
        ],
      },
      {
        below: 0.33,
        line: 'Cornered, it slams without pause.',
        patterns: [
          { kind: 'summon', enemy: 'runner', packs: 2, every: 0 },
          { kind: 'slam', every: 3.2, windup: 1, speed: 480, damage: 4 },
        ],
      },
    ],
    color: '#7b1f1f',
    borderColor: '#ff5050',
    lore: 'It held the gate of the Fields for the old kings. Now it holds it for the Blight.',
  },
  {
    id: 'bog-mother',
    name: 'The Bog Mother',
    icon: 'well',
    text: 'Births Splitters, sinks out of reach, and is healed by Menders.',
    hp: 60,
    armor: 0,
    speed: 26,
    radius: 64,
    standoff: 230,
    damage: 4,
    xp: 40,
    shards: 400,
    mass: 14,
    relicSlot: true,
    phases: [
      {
        below: 1,
        line: 'She births clutches of Splitters. Area clears them.',
        patterns: [{ kind: 'summon', enemy: 'splitter', packs: 2, every: 6 }],
      },
      {
        below: 0.66,
        line: 'She sinks out of reach, and rises somewhere else.',
        patterns: [
          { kind: 'submerge', every: 9, seconds: 3 },
          { kind: 'summon', enemy: 'mender', packs: 1, every: 0 },
          { kind: 'summon', enemy: 'splitter', packs: 2, every: 9 },
        ],
      },
      {
        below: 0.33,
        line: 'Her Menders gather to her. Kill them, or she mends.',
        patterns: [
          { kind: 'summon', enemy: 'mender', packs: 2, every: 0 },
          { kind: 'submerge', every: 7, seconds: 3 },
          { kind: 'summon', enemy: 'splitter', packs: 3, every: 7 },
        ],
      },
    ],
    color: '#2e5d4b',
    borderColor: '#9be3c3',
    lore: 'Every Splitter in the Mire is one of her children. She has not forgotten a single one.',
  },
];

export const BOSS_BY_ID: Readonly<Record<BossId, BossDef>> = Object.fromEntries(
  BOSSES.map((b) => [b.id, b]),
) as Record<BossId, BossDef>;
