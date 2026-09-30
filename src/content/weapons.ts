import type { WeaponDef, WeaponId } from './types';

/** Weapons (§4.4, §11.2). Arcane Bolt only at P1. */
export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'arcane-bolt',
    name: 'Arcane Bolt',
    icon: 'bolt-spell-cast',
    text: 'A homing bolt at the nearest enemy.',
    damage: 12,
    fireRate: 1.3,
    projectileSpeed: 720,
    projectileLife: 2,
  },
];

export const WEAPON_BY_ID: Readonly<Record<WeaponId, WeaponDef>> = Object.fromEntries(
  WEAPONS.map((w) => [w.id, w]),
) as Record<WeaponId, WeaponDef>;
