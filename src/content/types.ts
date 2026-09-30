import type { IconId } from './icons';

/**
 * What every player-facing content entry carries (§12.6): an id, a name, an
 * icon and one line of text of 15 words or fewer (§2.2).
 */
export interface ContentEntry {
  readonly id: string;
  readonly name: string;
  readonly icon: IconId;
  readonly text: string;
}

/** A frame: the tower's chassis, chosen before a run (§4.4). */
export interface FrameDef extends ContentEntry {
  readonly startingWeapon: WeaponId;
}

export type EnemyId = 'grunt' | 'runner' | 'brute';

/** Silhouettes the enemy painter knows. A closed union: a new one must be drawn first. */
export type EnemyShape = 'circle' | 'diamond' | 'plated';

/**
 * An enemy type (§4.3). Each has one verb that makes one answer right.
 *
 * `hp`, `damage` and `armor` are multiples of the region's per-wave base, so
 * a type means the same thing in every region; the region supplies the size.
 */
export interface EnemyDef extends ContentEntry {
  readonly id: EnemyId;
  /** Multiple of the region's wave HP. */
  readonly hp: number;
  /** World units per second. */
  readonly speed: number;
  /** Body radius, world units. */
  readonly radius: number;
  /** Multiple of the region's wave contact damage, per hit. */
  readonly damage: number;
  /** Seconds between contact hits. */
  readonly attackInterval: number;
  /**
   * Flat damage reduction, as a multiple of the region's wave HP. Scales with
   * HP so a Brute's armour means the same thing at wave 3 and wave 19.
   */
  readonly armor: number;
  /** Bodies that spawn together from one point. */
  readonly pack: readonly [number, number];
  readonly shape: EnemyShape;
  readonly color: string;
  readonly borderColor: string;
}

export type WeaponId = 'arcane-bolt';

/** A weapon (§4.4). Levels arrive with the draft (P2). */
export interface WeaponDef extends ContentEntry {
  readonly id: WeaponId;
  /** Damage per hit at level 1, before the tower's multipliers. */
  readonly damage: number;
  /** Attacks per second. */
  readonly fireRate: number;
  /** World units per second. */
  readonly projectileSpeed: number;
  /** Seconds a projectile lives before fizzling. */
  readonly projectileLife: number;
}

/** A wave beat (§4.2): the moment that gives a region its rhythm. */
export type WaveBeat =
  | { readonly kind: 'introduce'; readonly enemy: EnemyId; readonly packs: number }
  | { readonly kind: 'swarm'; readonly countMult: number };

export interface RegionDef extends ContentEntry {
  /** 1–6, the order on the map. */
  readonly index: number;
  /** Wave-1 HP of a weight-1 enemy (§8.2). */
  readonly hpBase: number;
  /** Per-wave HP growth (§8.2: ~×1.17). */
  readonly hpGrowth: number;
  /** Wave-1 contact damage of a weight-1 enemy. */
  readonly damageBase: number;
  readonly damageGrowth: number;
  /** Enemies in wave n: `base + perWave × (n − 1)`, before beats. */
  readonly count: { readonly base: number; readonly perWave: number };
  /** Which types spawn, from which wave, how often. */
  readonly pool: readonly { readonly enemy: EnemyId; readonly from: number; readonly weight: number }[];
  /** Beats at waves 5, 10 and 15. */
  readonly beats: Readonly<Record<number, WaveBeat>>;
}
