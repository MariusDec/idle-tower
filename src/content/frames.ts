import type { FrameDef } from './types';

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
      name: 'Nova',
      text: '600% damage to every enemy in range, and throws them back.',
      damage: 6,
      knockback: 160,
    },
  },
];
