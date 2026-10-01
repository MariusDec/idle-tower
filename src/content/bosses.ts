import type { BossDef, BossId } from './types';

/**
 * Bosses (§4.3, §11.1): wave 20 of each region. 2–3 phases, one readable
 * pattern each. A boss stops at its standoff and works from there; one that
 * outlasts `BALANCE.boss.enrageAfter` walks to the wall instead.
 *
 * HP is a multiple of the region's wave-20 HP (§8.2: about 25–35 s of the
 * DPS expected there); `npm run inspect -- --forge all --region 2` reads the fight.
 *
 * The last two are the Abyss's own (§9): they hold every fifth floor, where
 * the rest come back as the floors' guardians. In the Abyss a boss's HP is a
 * multiple of its floor's last wave, times `BALANCE.abyss.bossHp`.
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
  {
    id: 'prism',
    name: 'The Prism',
    icon: 'floating-crystal',
    text: 'Mirrored facets throw shots back at the tower. Beams and blasts get through.',
    hp: 50,
    armor: 0,
    speed: 28,
    radius: 62,
    standoff: 220,
    damage: 4,
    xp: 50,
    shards: 400,
    mass: 14,
    relicSlot: false,
    phases: [
      {
        below: 1,
        line: 'Its facets turn. Shots that strike glass come back.',
        patterns: [{ kind: 'mirror', facets: 2, arc: 0.9, spin: 0.6, damage: 0.4 }],
      },
      {
        below: 0.66,
        line: 'It calls the Shardlings out of the sand.',
        patterns: [
          { kind: 'mirror', facets: 3, arc: 0.9, spin: 0.8, damage: 0.4 },
          { kind: 'summon', enemy: 'shardling', packs: 2, every: 8 },
        ],
      },
      {
        below: 0.33,
        line: 'All glass now. Only beams and blasts get through.',
        patterns: [
          { kind: 'mirror', facets: 4, arc: 1, spin: 1.1, damage: 0.5 },
          { kind: 'summon', enemy: 'shieldbearer', packs: 2, every: 10 },
          { kind: 'slam', every: 6, windup: 1.2, speed: 460, damage: 3 },
        ],
      },
    ],
    color: '#5e7d8f',
    borderColor: '#d8f6ff',
    lore: 'The first thing the Blight burned into glass. It remembers being a mountain.',
  },
  {
    id: 'forgeheart',
    name: 'Forgeheart',
    icon: 'frostfire',
    text: 'Heavy plates break away each phase; molten pools burn the wall.',
    hp: 40,
    armor: 0.04,
    speed: 24,
    radius: 66,
    standoff: 230,
    damage: 4,
    xp: 60,
    shards: 400,
    mass: 18,
    relicSlot: true,
    phases: [
      {
        below: 1,
        line: 'Plated in iron. Big hits, or burn it out.',
        patterns: [
          { kind: 'pool', every: 9, seconds: 6, dps: 0.35, radius: 70 },
          { kind: 'summon', enemy: 'bomber', packs: 2, every: 10 },
        ],
      },
      {
        below: 0.66,
        line: 'A plate cracks away. It pours out more fire.',
        armor: 0.015,
        patterns: [
          { kind: 'pool', every: 7, seconds: 6, dps: 0.4, radius: 75 },
          { kind: 'slam', every: 6, windup: 1.3, speed: 420, damage: 3.5 },
          { kind: 'summon', enemy: 'blinker', packs: 2, every: 9 },
        ],
      },
      {
        below: 0.33,
        line: 'The last plate falls. The heart is bare.',
        armor: 0,
        patterns: [
          { kind: 'pool', every: 5, seconds: 6, dps: 0.45, radius: 80 },
          { kind: 'slam', every: 4, windup: 1.1, speed: 480, damage: 3.5 },
          { kind: 'summon', enemy: 'siege-engine', packs: 1, every: 0 },
        ],
      },
    ],
    color: '#7a2d12',
    borderColor: '#ffb066',
    lore: 'The Rift’s smithy, given legs. It forged the Blight’s armour, and wears the best of it.',
  },
  {
    id: 'hollow-king',
    name: 'The Hollow King',
    icon: 'crowned-skull',
    text: 'Splits into three shades with one life. Only the crowned one takes full damage.',
    hp: 55,
    armor: 0,
    speed: 26,
    radius: 58,
    standoff: 240,
    damage: 4,
    xp: 70,
    shards: 400,
    mass: 14,
    relicSlot: true,
    phases: [
      {
        below: 1,
        line: 'He calls his court of Phantoms.',
        patterns: [
          { kind: 'summon', enemy: 'phantom', packs: 2, every: 7 },
          { kind: 'slam', every: 7, windup: 1.3, speed: 420, damage: 3.5 },
        ],
      },
      {
        below: 0.66,
        line: 'He splits in three. Strike the one that wears the crown.',
        patterns: [
          { kind: 'court', shades: 3, every: 6, share: 0.25 },
          { kind: 'summon', enemy: 'leech', packs: 1, every: 8 },
        ],
      },
      {
        below: 0.33,
        line: 'The crown moves faster. His Summoners come.',
        patterns: [
          { kind: 'court', shades: 3, every: 4, share: 0.25 },
          { kind: 'summon', enemy: 'summoner', packs: 1, every: 0 },
          { kind: 'slam', every: 5, windup: 1.1, speed: 460, damage: 3.5 },
        ],
      },
    ],
    color: '#2a2440',
    borderColor: '#c9b8ff',
    lore: 'He ruled the Hollow before the Blight, and he rules it still. He never noticed the difference.',
  },
  {
    id: 'blight',
    name: 'The Blight',
    icon: 'glass-heart',
    text: 'It wears every boss you broke, one after another, then shows its heart.',
    hp: 70,
    armor: 0,
    speed: 22,
    radius: 76,
    standoff: 240,
    damage: 4,
    xp: 100,
    shards: 500,
    mass: 30,
    relicSlot: true,
    finale: true,
    phases: [
      {
        below: 1,
        line: 'It wears the Gatekeeper. It slams the ground.',
        patterns: [
          { kind: 'slam', every: 5, windup: 1.2, speed: 440, damage: 3.5 },
          { kind: 'summon', enemy: 'brute', packs: 2, every: 10 },
        ],
      },
      {
        below: 0.8,
        line: 'It wears the Bog Mother. It sinks, and its children come.',
        patterns: [
          { kind: 'submerge', every: 8, seconds: 3 },
          { kind: 'summon', enemy: 'splitter', packs: 3, every: 7 },
        ],
      },
      {
        below: 0.6,
        line: 'It wears the Prism. Shots that strike glass come back.',
        patterns: [
          { kind: 'mirror', facets: 3, arc: 0.9, spin: 0.9, damage: 0.4 },
          { kind: 'summon', enemy: 'shardling', packs: 2, every: 8 },
        ],
      },
      {
        below: 0.4,
        line: 'It wears Forgeheart. Iron plates, and fire at the wall.',
        armor: 0.04,
        patterns: [
          { kind: 'pool', every: 6, seconds: 6, dps: 0.4, radius: 80 },
          { kind: 'summon', enemy: 'bomber', packs: 2, every: 8 },
        ],
      },
      {
        below: 0.2,
        line: 'The masks are gone. Only the heart is left. End it.',
        armor: 0,
        patterns: [
          { kind: 'slam', every: 3.5, windup: 1, speed: 500, damage: 3.5 },
          { kind: 'summon', enemy: 'harbinger', packs: 1, every: 12 },
          { kind: 'summon', enemy: 'chorus', packs: 2, every: 9 },
        ],
      },
    ],
    color: '#4a0e1c',
    borderColor: '#ff6b8b',
    lore: 'Not a creature. A hunger that learned to wear faces. It has saved the best for last.',
  },
  // ── The Abyss (§9) ─────────────────────────────────────────────────────
  {
    id: 'deepwarden',
    name: 'The Deepwarden',
    icon: 'nested-hexagons',
    text: 'Raises Wardstones, sinks into the dark, and turns its mirror on you.',
    hp: 60,
    armor: 0.02,
    speed: 24,
    radius: 66,
    standoff: 230,
    damage: 4,
    xp: 80,
    shards: 400,
    mass: 16,
    relicSlot: false,
    abyss: true,
    phases: [
      {
        below: 1,
        line: 'It raises Wardstones around itself. Break them, then it.',
        patterns: [
          { kind: 'summon', enemy: 'wardstone', packs: 1, every: 9 },
          { kind: 'slam', every: 5.5, windup: 1.2, speed: 440, damage: 3.5 },
        ],
      },
      {
        below: 0.6,
        line: 'It sinks into the dark, and Husks crawl out.',
        patterns: [
          { kind: 'submerge', every: 8, seconds: 3 },
          { kind: 'summon', enemy: 'husk', packs: 2, every: 7 },
        ],
      },
      {
        below: 0.3,
        line: 'Its mirror turns. Shots that strike the glass come back.',
        patterns: [
          { kind: 'mirror', facets: 3, arc: 0.8, spin: 1, damage: 0.4 },
          { kind: 'slam', every: 4, windup: 1.1, speed: 480, damage: 3.5 },
        ],
      },
    ],
    color: '#1c2a3a',
    borderColor: '#8fd8ff',
    lore: 'Something has to keep the deep from rising. It decided, long ago, that it would be the deep.',
  },
  {
    id: 'hunger',
    name: 'The Hunger',
    icon: 'fangs-circle',
    text: 'Calls Maws to feed, splits into shades, and starves faster than you.',
    hp: 60,
    armor: 0,
    speed: 26,
    radius: 64,
    standoff: 240,
    damage: 4,
    xp: 80,
    shards: 400,
    mass: 16,
    relicSlot: false,
    abyss: true,
    phases: [
      {
        below: 1,
        line: 'It calls its Maws to feed, and fire to the wall.',
        patterns: [
          { kind: 'summon', enemy: 'maw', packs: 1, every: 8 },
          { kind: 'pool', every: 7, seconds: 5, dps: 0.4, radius: 80 },
        ],
      },
      {
        below: 0.66,
        line: 'It splits in three. Strike the one that wears the crown.',
        patterns: [
          { kind: 'court', shades: 3, every: 6, share: 0.25 },
          { kind: 'summon', enemy: 'ram', packs: 1, every: 9 },
        ],
      },
      {
        below: 0.33,
        line: 'Starving, it slams without pause.',
        patterns: [
          { kind: 'slam', every: 3.2, windup: 1, speed: 500, damage: 4 },
          { kind: 'summon', enemy: 'husk', packs: 2, every: 8 },
        ],
      },
    ],
    color: '#3a0f22',
    borderColor: '#ff8fb0',
    lore: 'The Blight was only its appetite. This is what was doing the eating.',
  },
];

export const BOSS_BY_ID: Readonly<Record<BossId, BossDef>> = Object.fromEntries(
  BOSSES.map((b) => [b.id, b]),
) as Record<BossId, BossDef>;
