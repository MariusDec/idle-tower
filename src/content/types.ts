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

/**
 * The stat keys the resolver knows (§12.3). A key arrives with the first
 * content that moves it; a key nothing moves is dead weight.
 *
 * `regen` is a fraction of Max HP per second, so a Forge "+0.5%/s" and a
 * Max HP boost compose the way a player expects.
 */
export type StatKey =
  | 'damage'
  | 'attackSpeed'
  | 'critChance'
  | 'critDamage'
  | 'range'
  | 'maxHp'
  | 'regen'
  | 'armor'
  | 'xpGain'
  | 'shardGain';

/**
 * One contribution to a stat. Resolved as
 * `(base + Σadd) × (1 + Σpct) × Πmult`: flat first, then the additive
 * percentages every "+15%" line sums into, then true multipliers (keystones).
 */
export interface StatMod {
  readonly key: StatKey;
  readonly add?: number;
  readonly pct?: number;
  readonly mult?: number;
}

/** Anything that can enter the draft's card pool. */
export type CardItemId = WeaponId | PassiveId;

/**
 * Effects are data (§12.3, R8). Every kind has one exhaustive consumer, in
 * `meta/runConfig.ts`, that ends in `never`.
 */
export type Effect =
  | { readonly kind: 'stat'; readonly mod: StatMod }
  | { readonly kind: 'unlockCard'; readonly id: CardItemId }
  | { readonly kind: 'slot'; readonly slot: 'weapon' | 'passive'; readonly n: number };

export type UltimateId = 'nova';

/** A frame's ultimate (§4.4): charged by kills, the only active button in a run. */
export interface UltimateDef {
  readonly id: UltimateId;
  readonly name: string;
  readonly text: string;
  /** Multiple of the starting weapon's current hit damage. */
  readonly damage: number;
  /** World units a weight-1 body is thrown outward. */
  readonly knockback: number;
}

/** A frame: the tower's chassis, chosen before a run (§4.4). */
export interface FrameDef extends ContentEntry {
  readonly startingWeapon: WeaponId;
  /** The frame's quirk. */
  readonly effects: readonly Effect[];
  readonly ultimate: UltimateDef;
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
  /** XP a kill drops, and the ultimate charge it gives (§4.5). */
  readonly xp: number;
  /** Resistance to knockback: a push moves the body `push / mass`. */
  readonly mass: number;
  readonly shape: EnemyShape;
  readonly color: string;
  readonly borderColor: string;
}

export type WeaponId = 'arcane-bolt' | 'scattershot' | 'chain-lightning';

/**
 * How a weapon attacks (§4.4). A closed union: `sim/systems/combat.ts`
 * switches on it exhaustively, and the tower painter draws one mount per kind.
 */
export type WeaponPattern = 'homing' | 'cone' | 'chain';

/**
 * A weapon's numbers at one level. Every pattern reads the fields it needs;
 * the rest stay at zero.
 */
export interface WeaponParams {
  /** Damage per hit, before the tower's multipliers. */
  readonly damage: number;
  /** Attacks per second. */
  readonly fireRate: number;
  /** Bolts per volley (homing) or pellets per blast (cone). */
  readonly count: number;
  /** Extra bodies a projectile passes through. */
  readonly pierce: number;
  /** Cone width, radians. */
  readonly spread: number;
  /** World units a weight-1 body is pushed per hit. */
  readonly knockback: number;
  /** Bodies a chain strikes, the first included. */
  readonly jumps: number;
  /** How far a chain may leap between bodies. */
  readonly jumpRange: number;
  /** Seconds each struck body is stunned. */
  readonly stun: number;
  /** World units per second; 0 for instant weapons. */
  readonly projectileSpeed: number;
}

/**
 * One level step (§4.4): a visible change or at least +25% damage. `text` is
 * the card line for that level, highlighted number first.
 */
export interface WeaponStep {
  readonly text: string;
  /** Multiplies damage. */
  readonly damageMult?: number;
  /** Added to the previous level's numbers. */
  readonly add?: Partial<Omit<WeaponParams, 'damage'>>;
}

/** A weapon (§4.4, §11.2). */
export interface WeaponDef extends ContentEntry {
  readonly id: WeaponId;
  readonly pattern: WeaponPattern;
  /** Level 1. */
  readonly base: WeaponParams;
  /** Levels 2–5, in order. */
  readonly steps: readonly WeaponStep[];
}

export type PassiveId = 'power' | 'haste' | 'precision' | 'fortify' | 'mending' | 'insight';

/** A passive (§4.4, §11.3). Each level adds `perLevel` again. */
export interface PassiveDef extends ContentEntry {
  readonly id: PassiveId;
  readonly perLevel: readonly StatMod[];
}

export type FallbackId = 'heal' | 'shards';

/** What the draft offers once every slot is full and maxed (§4.5). */
export interface FallbackDef extends ContentEntry {
  readonly id: FallbackId;
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
