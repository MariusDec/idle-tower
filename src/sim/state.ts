import type { RngState } from '../core/rng';
import type { EnemyId, WeaponId } from '../content/types';

/**
 * Everything a run is (§12.3). Plain data, so it can be hashed for the
 * determinism test and written as the run snapshot (§12.4).
 *
 * `render/` reads this and never writes it; `sim/` is the only writer. The one
 * exception is `events`, which the app drains after each frame.
 */

/**
 * The frozen input to a run (§12.3). `meta/runConfig.ts` builds it from the
 * profile, resolving every Forge, relic and frame effect once, so the sim
 * never sees the profile.
 */
export interface RunConfig {
  readonly frameId: string;
  readonly regionId: number;
  readonly stats: Readonly<TowerStats>;
}

/** The tower's resolved stats for this run. Frozen at `createRun`. */
export interface TowerStats {
  maxHp: number;
  regen: number;
  armor: number;
  radius: number;
  range: number;
  critChance: number;
  critMult: number;
  damageMult: number;
  fireRateMult: number;
}

export interface TowerState {
  hp: number;
  /** Angle of the last shot, for the turret. */
  aim: number;
  /** Tick of the last contact hit taken, for the hurt flash. */
  hurtTick: number;
}

export interface Enemy {
  id: number;
  type: EnemyId;
  /** The wave that spawned it, for the overlap rule. */
  wave: number;
  alive: boolean;
  x: number;
  y: number;
  /** Position at the previous step, for render interpolation. */
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  armor: number;
  speed: number;
  radius: number;
  damage: number;
  attackInterval: number;
  /** Seconds until the next contact hit; counts only while in contact. */
  attackTimer: number;
  inContact: boolean;
  /** Tick it was last hit, for the hit flash. */
  hitTick: number;
}

export interface Projectile {
  alive: boolean;
  weapon: WeaponId;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  speed: number;
  damage: number;
  crit: boolean;
  /** Enemy id it homes on; retargets when that one dies. 0 = none. */
  target: number;
  life: number;
}

export interface WeaponState {
  id: WeaponId;
  level: number;
  /** Seconds until it may fire again. */
  cooldown: number;
}

/** One entry in a wave's pre-rolled spawn list. */
export interface SpawnEntry {
  /** Seconds after the wave starts. */
  at: number;
  enemy: EnemyId;
  angle: number;
}

export interface WaveState {
  n: number;
  /** Run time the wave started. */
  startedAt: number;
  spawns: SpawnEntry[];
  /** Index of the next entry in `spawns` to place. */
  next: number;
  /** Run time the last spawn was placed; null while still spawning. */
  doneAt: number | null;
  /** Bodies this wave has placed that are still alive. */
  alive: number;
}

/**
 * What happened this step, for presentation. Not part of the run's identity:
 * excluded from the determinism hash and never read back by the sim.
 */
export type SimEvent =
  | { kind: 'fire'; weapon: WeaponId; angle: number }
  | { kind: 'hit'; x: number; y: number; amount: number; crit: boolean }
  | { kind: 'kill'; x: number; y: number; enemy: EnemyId; radius: number }
  | { kind: 'towerHit'; amount: number; x: number; y: number }
  | { kind: 'waveStart'; wave: number }
  | { kind: 'firstSight'; enemy: EnemyId }
  | { kind: 'fell' };

export interface RunState {
  seed: number;
  regionId: number;
  /** Sim steps taken. `time` is derived from it so it never drifts. */
  tick: number;
  time: number;
  /** The highest wave started. */
  wave: number;
  stats: TowerStats;
  tower: TowerState;
  weapons: WeaponState[];
  enemies: Enemy[];
  projectiles: Projectile[];
  /** The wave currently spawning or most recently spawned; null before wave 1. */
  current: WaveState | null;
  nextEnemyId: number;
  /** Enemy types seen this run, for first-sight bestiary cards. */
  seen: EnemyId[];
  kills: number;
  rng: RngState;
  /** Named child-stream states, so each system's draws stay independent. */
  streams: Record<string, RngState>;
  outcome: null | { kind: 'fell' | 'retreat'; wave: number; time: number };
  events: SimEvent[];
}

/** What the player can do to a run between steps. */
export interface RunInput {
  retreat?: boolean;
}
