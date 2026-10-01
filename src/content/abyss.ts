import { BALANCE } from './balance';
import { REGIONS } from './regions';
import type { BossId, EnemyId, RegionDef, WaveBeat } from './types';

/**
 * The Abyss (§9): Act 2's endless descent, and the only place big numbers
 * live. Each floor is ten waves on one region's template (its enemies, its
 * rule), with the Abyss's own four types mixed in, and the tenth is a boss:
 * the template region's, or on every fifth floor one of the Abyss's two.
 *
 * Depth, not the region, sets the size: HP, damage and shards grow per wave
 * (`BALANCE.abyss`) with no cap, and wave numbers run on across floors, so
 * floor 3's first wave is wave 21. Floor records pay Starlight on a log
 * curve. Pacts hold only in the regions.
 */

/** The Abyss's place on the Map and in a run's `regionId`: past the six regions. */
export const ABYSS_INDEX = 7;

/** Waves to a floor; the last is its boss. */
export const FLOOR_WAVES = 10;

/** The template each floor wears, in turn: a mix, so neighbouring floors ask different answers. */
const ORDER: readonly number[] = [1, 3, 2, 5, 4, 6];

/** The Abyss's own types (§9), and the floor each first walks on. */
export const NATIVES: readonly { readonly enemy: EnemyId; readonly from: number }[] = [
  { enemy: 'husk', from: 1 },
  { enemy: 'ram', from: 2 },
  { enemy: 'wardstone', from: 3 },
  { enemy: 'maw', from: 4 },
];

/** The Abyss's bosses, holding every fifth floor in turn. */
export const ABYSS_BOSSES: readonly BossId[] = ['deepwarden', 'hunger'];

/** The floor wave `wave` is on, from 1. */
export function floorOf(wave: number): number {
  return Math.floor((Math.max(1, wave) - 1) / FLOOR_WAVES) + 1;
}

/** Wave `wave`'s place on its floor, 1–10. */
export function floorWave(wave: number): number {
  return ((Math.max(1, wave) - 1) % FLOOR_WAVES) + 1;
}

/** The region whose template floor `floor` wears. */
export function floorTemplate(floor: number): RegionDef {
  const index = ORDER[(floor - 1) % ORDER.length];
  return REGIONS.find((r) => r.index === index) ?? REGIONS[0];
}

/** The boss at the bottom of floor `floor`. */
export function floorBoss(floor: number): BossId {
  if (floor % 5 === 0) return ABYSS_BOSSES[(floor / 5 - 1) % ABYSS_BOSSES.length];
  return floorTemplate(floor).boss;
}

const FLOORS = new Map<number, RegionDef>();

/**
 * Floor `floor` as a region the sim can run (§9): the template's enemies,
 * rule and look, the natives the floor has reached, its boss, and the depth's
 * numbers. `waves.ts` reads `abyss` and sizes every wave by its global number.
 * Built once per floor and kept: pure, so the same floor is the same region.
 */
export function abyssFloor(floor: number): RegionDef {
  const hit = FLOORS.get(floor);
  if (hit) return hit;
  const A = BALANCE.abyss;
  const base = floorTemplate(floor);
  const natives = NATIVES.filter((n) => floor >= n.from);
  // The newest native is introduced on the floor it arrives; later floors swarm.
  const fresh = NATIVES.find((n) => n.from === floor);
  const beats: Record<number, WaveBeat> = fresh
    ? { 5: { kind: 'introduce', enemy: fresh.enemy, packs: 2 }, 8: { kind: 'swarm', countMult: 1.4 } }
    : { 5: { kind: 'swarm', countMult: 1.3 }, 8: { kind: 'swarm', countMult: 1.5 } };
  const region: RegionDef = {
    ...base,
    id: `abyss-${floor}`,
    index: ABYSS_INDEX,
    name: `The Abyss · Floor ${floor}`,
    text: `Floor ${floor}, on the ${base.name}'s pattern.`,
    shardBase: A.shardBase,
    waveShards: A.waveShards,
    hpBase: A.hpBase,
    hpGrowth: A.hpGrowth,
    damageBase: A.damageBase,
    damageGrowth: A.damageGrowth,
    count: A.count,
    pool: [
      ...base.pool.map((p) => ({ enemy: p.enemy, from: 1, weight: p.weight })),
      ...natives.map((n) => ({ enemy: n.enemy, from: n.enemy === fresh?.enemy ? 6 : 1, weight: A.nativeWeight })),
    ],
    beats,
    boss: floorBoss(floor),
    elites: { ...base.elites, from: A.elites.from, every: A.elites.every },
    abyss: { floor },
  };
  FLOORS.set(floor, region);
  return region;
}

/** The Starlight a best floor of `floor` has paid in all: a log curve (§9). */
export function abyssStarlight(floor: number): number {
  return floor <= 0 ? 0 : Math.floor(BALANCE.abyss.starlight * Math.log2(1 + floor));
}
