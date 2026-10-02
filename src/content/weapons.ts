import type { WeaponDef, WeaponId, WeaponParams } from './types';

const ZERO: WeaponParams = {
  damage: 0, fireRate: 0, count: 0, pierce: 0, spread: 0,
  knockback: 0, jumps: 0, jumpRange: 0, stun: 0, projectileSpeed: 0,
  radius: 0, slow: 0, slowSeconds: 0, bomblets: 0, ramp: 0, rampCap: 0, spin: 0, blade: 0, fuse: 0,
};

/**
 * Weapons (§4.4, §11.2): Act 1's eight and Act 2's four (§9), each with its
 * own pattern. Each
 * level step is a visible change or at least +25% damage; the step's `text`
 * is its card line. `counters` are the enemies it answers (§4.3) and
 * `weakAgainst` the ones that blunt it (a Shieldbearer's front against
 * frontal shots; Shardlings and Bombers that die at the blades); the draft
 * scorer reads both.
 */
export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'arcane-bolt',
    name: 'Arcane Bolt',
    icon: 'bolt-spell-cast',
    text: 'A homing bolt at the nearest enemy.',
    pattern: 'homing',
    targeting: 'nearest',
    counters: ['spitter', 'phantom', 'shardling'],
    weakAgainst: ['shieldbearer'],
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
    text: 'A 5-pellet cone that knocks enemies back; ×1.5 damage up close.',
    pattern: 'cone',
    targeting: 'nearest',
    counters: ['grunt', 'runner', 'blinker', 'imp', 'bomber'],
    weakAgainst: ['shieldbearer'],
    pointBlank: 1.5,
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
    targeting: 'nearest',
    counters: ['runner', 'splitter', 'chorus', 'imp'],
    base: { ...ZERO, damage: 9, fireRate: 0.9, jumps: 3, jumpRange: 160 },
    steps: [
      { text: 'Arcs to +1 enemy.', add: { jumps: 1 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: 'Arcs to +1 enemy.', add: { jumps: 1 } },
      { text: 'Stuns each enemy struck for 0.2 s.', add: { stun: 0.2 } },
    ],
  },
  {
    id: 'frost-ring',
    name: 'Frost Ring',
    icon: 'frozen-orb',
    text: 'Pulses frost around the tower, slowing everything it touches.',
    pattern: 'pulse',
    targeting: 'nearest',
    counters: ['runner', 'blinker', 'burrower', 'leech'],
    base: { ...ZERO, damage: 7, fireRate: 0.75, radius: 160, slow: 0.3, slowSeconds: 1.5 },
    steps: [
      { text: 'Pulses reach 25% farther.', add: { radius: 40 } },
      { text: 'Slows 15% more.', add: { slow: 0.15 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: 'Pulses 30% faster.', add: { fireRate: 0.225 } },
    ],
  },
  {
    id: 'mortar',
    name: 'Mortar',
    icon: 'mortar',
    text: 'Lobs shells at the densest crowd; each bursts in an area.',
    pattern: 'lob',
    targeting: 'densest',
    counters: ['splitter', 'grunt', 'shieldbearer', 'chorus', 'summoner'],
    base: { ...ZERO, damage: 18, fireRate: 0.55, count: 1, radius: 55, projectileSpeed: 480 },
    steps: [
      { text: 'Blasts reach 35% wider.', add: { radius: 19 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: '+1 shell per salvo.', add: { count: 1 } },
      { text: 'Shells scatter 3 bomblets as they burst.', add: { bomblets: 3 } },
    ],
  },
  {
    id: 'sunlance',
    name: 'Sunlance',
    icon: 'sunbeams',
    text: 'A beam that burns hotter the longer it holds one target.',
    pattern: 'beam',
    targeting: 'toughest',
    counters: ['brute', 'mender', 'harbinger', 'summoner'],
    base: { ...ZERO, damage: 2.5, fireRate: 4, ramp: 0.5, rampCap: 3 },
    steps: [
      { text: 'Heats up ×2 as fast.', add: { ramp: 0.5 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: 'The beam burns through everything in its path.', add: { pierce: 1 } },
      { text: 'Burns up to ×5 hot.', add: { rampCap: 2 } },
    ],
  },
  {
    id: 'glaives',
    name: 'Glaives',
    icon: 'spinning-blades',
    text: 'Blades circle the tower, cutting whatever comes close.',
    pattern: 'orbit',
    targeting: 'nearest',
    counters: ['grunt', 'runner', 'burrower', 'leech', 'imp'],
    weakAgainst: ['shardling', 'bomber'],
    base: { ...ZERO, damage: 9, count: 2, radius: 82, spin: 3.5, blade: 16 },
    steps: [
      { text: '+1 blade.', add: { count: 1 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: 'Blades orbit 30% wider, and are bigger.', add: { radius: 25, blade: 6 } },
      { text: '+1 blade.', add: { count: 1 } },
    ],
  },
  {
    id: 'sentinel-drones',
    name: 'Sentinel Drones',
    icon: 'delivery-drone',
    text: 'Drones that fly out, hunt and fire on their own.',
    pattern: 'drone',
    targeting: 'standoff',
    counters: ['spitter', 'mender', 'siege-engine', 'shieldbearer', 'phantom', 'harbinger', 'summoner'],
    base: { ...ZERO, damage: 6, fireRate: 1.1, count: 2, projectileSpeed: 560 },
    steps: [
      { text: '+1 drone.', add: { count: 1 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: 'Drones fire 35% faster.', add: { fireRate: 0.4 } },
      { text: '+1 drone.', add: { count: 1 } },
    ],
  },
  // ── Act 2 (§9): lit in the Constellations ─────────────────────────────
  {
    id: 'moonblade',
    name: 'Moonblade',
    icon: 'armored-boomerang',
    text: 'A crescent thrown out and back, cutting everything both ways.',
    pattern: 'boomerang',
    targeting: 'nearest',
    counters: ['shieldbearer', 'chorus', 'grunt'],
    base: { ...ZERO, damage: 11, fireRate: 0.75, count: 1, spread: 0.5, projectileSpeed: 620 },
    steps: [
      { text: '+1 crescent per throw.', add: { count: 1 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: 'Crescents fly 30% faster.', add: { projectileSpeed: 190 } },
      { text: '+1 crescent per throw.', add: { count: 1 } },
    ],
  },
  {
    id: 'rune-traps',
    name: 'Rune Traps',
    icon: 'land-mine',
    text: 'Lays runes in the path; each bursts under whatever steps on it.',
    pattern: 'mine',
    targeting: 'nearest',
    counters: ['runner', 'blinker', 'ram', 'burrower'],
    base: { ...ZERO, damage: 26, fireRate: 0.9, count: 3, radius: 60, fuse: 8 },
    steps: [
      { text: '+2 runes on the field.', add: { count: 2 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: 'Bursts reach 30% wider.', add: { radius: 18 } },
      { text: 'Each burst stuns for 0.5 s.', add: { stun: 0.5 } },
    ],
  },
  {
    id: 'soul-tether',
    name: 'Soul Tether',
    icon: 'magic-swirl',
    text: 'Threads of light hold two enemies, draining them without pause.',
    pattern: 'tether',
    targeting: 'nearest',
    counters: ['husk', 'leech', 'summoner'],
    base: { ...ZERO, damage: 2.4, fireRate: 5, count: 2 },
    steps: [
      { text: '+1 tether.', add: { count: 1 } },
      { text: '+30% damage.', damageMult: 1.3 },
      { text: 'Tethers drain 30% faster.', add: { fireRate: 1.5 } },
      { text: '+1 tether.', add: { count: 1 } },
    ],
  },
  {
    id: 'gilded-rail',
    name: 'Gilded Rail',
    icon: 'target-laser',
    text: 'A slow, heavy slug that passes through everything in its line.',
    pattern: 'rail',
    targeting: 'line',
    counters: ['brute', 'shieldbearer', 'wardstone', 'siege-engine'],
    base: { ...ZERO, damage: 70, fireRate: 0.32, count: 1, radius: 14 },
    steps: [
      { text: '+40% damage.', damageMult: 1.4 },
      { text: 'The slug cuts a line twice as wide.', add: { radius: 14 } },
      { text: 'Charges 30% faster.', add: { fireRate: 0.1 } },
      { text: 'Fires a second slug at another target.', add: { count: 1 } },
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
