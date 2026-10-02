import type { FrameDef, FrameId } from './types';

/** Frames (§4.4, §11.6): the tower's chassis, chosen before a run. Four in Act 1; Act 2's two come from the Constellations (§9). */
export const FRAMES: readonly FrameDef[] = [
  {
    id: 'arcanist',
    name: 'Arcanist',
    icon: 'crystal-ball',
    text: 'The first frame. +10% XP; its ultimate is Nova.',
    startingWeapon: 'arcane-bolt',
    effects: [{ kind: 'stat', mod: { key: 'xpGain', pct: 0.1 } }],
    ultimate: {
      id: 'nova',
      auto: { kind: 'windup', crowd: 8 },
      name: 'Nova',
      text: '600% damage, at least 40% of their health, to all in range; throws them back.',
      damage: 6,
      floor: 0.4,
      knockback: 160,
    },
    unlock: { kind: 'start' },
  },
  {
    id: 'bastion',
    name: 'Bastion',
    icon: 'stone-wall',
    text: 'Starts with Frost Ring. +50% Max HP, −15% attack speed.',
    startingWeapon: 'frost-ring',
    effects: [
      { kind: 'stat', mod: { key: 'maxHp', pct: 0.5 } },
      { kind: 'stat', mod: { key: 'attackSpeed', pct: -0.15 } },
    ],
    ultimate: {
      id: 'aegis',
      auto: { kind: 'wall', within: 0.6, hp: 0.4, contact: 3 },
      name: 'Aegis',
      text: 'Five seconds of invulnerability; blocked contact hits are reflected.',
      seconds: 5,
      reflect: 1,
    },
    unlock: { kind: 'boss', boss: 'bog-mother' },
  },
  {
    id: 'stormcaller',
    name: 'Stormcaller',
    icon: 'lightning-storm',
    text: 'Starts with Chain Lightning. Every crit leaps to one more enemy.',
    startingWeapon: 'chain-lightning',
    effects: [{ kind: 'behaviour', id: 'stormcaller' }],
    ultimate: {
      id: 'tempest',
      auto: { kind: 'crowd', crowd: 8 },
      name: 'Tempest',
      text: 'A six-second storm strikes random enemies in range, each for at least 15% health.',
      seconds: 6,
      rate: 8,
      damage: 3,
      floor: 0.15,
    },
    unlock: { kind: 'boss', boss: 'forgeheart' },
  },
  {
    id: 'artificer',
    name: 'Artificer',
    icon: 'vintage-robot',
    text: 'Starts with Sentinel Drones. +1 weapon slot, −1 passive slot.',
    startingWeapon: 'sentinel-drones',
    effects: [
      { kind: 'slot', slot: 'weapon', n: 1 },
      { kind: 'slot', slot: 'passive', n: -1 },
    ],
    ultimate: {
      id: 'overclock',
      auto: { kind: 'crowd', crowd: 8 },
      name: 'Overclock',
      text: 'For six seconds, every weapon fires twice as fast.',
      seconds: 6,
      speed: 2,
    },
    unlock: { kind: 'feat', feat: 'tinkerer' },
  },
  {
    id: 'lamplighter',
    name: 'Lamplighter',
    icon: 'lantern-flame',
    text: 'Starts with Moonblade. +20% area, +10% range.',
    startingWeapon: 'moonblade',
    effects: [
      { kind: 'stat', mod: { key: 'area', pct: 0.2 } },
      { kind: 'stat', mod: { key: 'range', pct: 0.1 } },
    ],
    ultimate: {
      id: 'daybreak',
      auto: { kind: 'crowd', crowd: 8 },
      name: 'Daybreak',
      text: 'For six seconds, everything in range is slowed and takes double damage.',
      seconds: 6,
      slow: 0.5,
      vulnerable: 2,
    },
    unlock: { kind: 'star' },
  },
  {
    id: 'gravekeeper',
    name: 'Gravekeeper',
    icon: 'reaper-scythe',
    text: 'Starts with Soul Tether. Every kill mends the tower a little.',
    startingWeapon: 'soul-tether',
    effects: [{ kind: 'behaviour', id: 'siphon' }],
    ultimate: {
      id: 'eclipse',
      auto: { kind: 'pool', bodies: 6 },
      name: 'Eclipse',
      text: 'Everything in range loses a quarter of its health; a boss, a twentieth.',
      fraction: 0.25,
      bossFraction: 0.05,
    },
    unlock: { kind: 'star' },
  },
];

export const FRAME_BY_ID: Readonly<Record<FrameId, FrameDef>> = Object.fromEntries(
  FRAMES.map((f) => [f.id, f]),
) as Record<FrameId, FrameDef>;

/** A frame by id, falling back to the first for an id no longer shipped. */
export function frameById(id: string): FrameDef {
  return FRAME_BY_ID[id as FrameId] ?? FRAMES[0];
}
