import type { WeaponDef, WeaponId, WeaponParams } from './types';

const ZERO: WeaponParams = {
  damage: 0, fireRate: 0, count: 0, pierce: 0, spread: 0,
  knockback: 0, jumps: 0, jumpRange: 0, stun: 0, projectileSpeed: 0,
};

/**
 * Weapons (§4.4, §11.2). Three at P2. Each level step is a visible change or
 * at least +25% damage; the step's `text` is its card line.
 */
export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'arcane-bolt',
    name: 'Arcane Bolt',
    icon: 'bolt-spell-cast',
    text: 'A homing bolt at the nearest enemy.',
    pattern: 'homing',
    base: { ...ZERO, damage: 12, fireRate: 1.3, count: 1, projectileSpeed: 720 },
    steps: [
      { text: '+1 bolt per volley.', add: { count: 1 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: 'Bolts pierce +1 enemy.', add: { pierce: 1 } },
      { text: '+1 bolt per volley.', add: { count: 1 } },
    ],
  },
  {
    id: 'scattershot',
    name: 'Scattershot',
    icon: 'striking-arrows',
    text: 'A 5-pellet cone that knocks enemies back.',
    pattern: 'cone',
    base: { ...ZERO, damage: 5, fireRate: 0.8, count: 5, spread: 0.55, knockback: 16, projectileSpeed: 900 },
    steps: [
      { text: '+2 pellets per blast.', add: { count: 2, spread: 0.1 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: '×2 knockback.', add: { knockback: 16 } },
      { text: '+2 pellets per blast.', add: { count: 2, spread: 0.1 } },
    ],
  },
  {
    id: 'chain-lightning',
    name: 'Chain Lightning',
    icon: 'chain-lightning',
    text: 'Lightning that arcs across 3 enemies.',
    pattern: 'chain',
    base: { ...ZERO, damage: 9, fireRate: 0.9, jumps: 3, jumpRange: 160 },
    steps: [
      { text: 'Arcs to +1 enemy.', add: { jumps: 1 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: 'Arcs to +1 enemy.', add: { jumps: 1 } },
      { text: 'Stuns each enemy struck for 0.2 s.', add: { stun: 0.2 } },
    ],
  },
];

export const WEAPON_BY_ID: Readonly<Record<WeaponId, WeaponDef>> = Object.fromEntries(
  WEAPONS.map((w) => [w.id, w]),
) as Record<WeaponId, WeaponDef>;

/** Every level's numbers, level 1 first: the base, then each step applied in turn. */
export function weaponLevels(def: WeaponDef): WeaponParams[] {
  const out: WeaponParams[] = [def.base];
  for (const s of def.steps) {
    const prev = out[out.length - 1];
    const next: Record<string, number> = { ...prev };
    for (const [k, v] of Object.entries(s.add ?? {})) next[k] += v;
    next.damage = prev.damage * (s.damageMult ?? 1);
    out.push(next as unknown as WeaponParams);
  }
  return out;
}

const LEVELS: Readonly<Record<WeaponId, readonly WeaponParams[]>> = Object.fromEntries(
  WEAPONS.map((w) => [w.id, weaponLevels(w)]),
) as Record<WeaponId, WeaponParams[]>;

/** A weapon's numbers at `level` (1-based). */
export function weaponParams(id: WeaponId, level: number): WeaponParams {
  const table = LEVELS[id];
  return table[Math.min(table.length, Math.max(1, level)) - 1];
}
