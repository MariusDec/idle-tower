import type { RngState } from '../core/rng';
import type {
  BehaviourId, CardItemId, EnemyId, FallbackId, PassiveId, StatMod, WeaponId,
} from '../content/types';

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
  /** Every stat contribution from outside the run: frame quirk, Forge, relics. */
  readonly mods: readonly StatMod[];
  readonly weaponSlots: number;
  readonly passiveSlots: number;
  /** Weapons and passives the draft may offer (§4.5: the pool grows with unlocks). */
  readonly pool: readonly CardItemId[];
  /**
   * The very first draft of the game is authored (§7.1), not rolled. Null
   * on every other run.
   */
  readonly firstDraft: readonly Card[] | null;
  /** Forge behaviours owned, by how many levels (§11.4). Absent means 0. */
  readonly behaviours: Readonly<Partial<Record<BehaviourId, number>>>;
}

/**
 * The tower's resolved stats (§12.3). Re-resolved whenever a passive
 * changes; `sim/stats.ts` is the only writer.
 */
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
  xpMult: number;
  shardMult: number;
  ultChargeMult: number;
}

export interface TowerState {
  hp: number;
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
  /** XP (and ultimate charge) the kill drops. */
  xp: number;
  /** Shards the kill drops, before the tower's shard gain (§8.3). */
  shards: number;
  mass: number;
  /** Run time until which it neither walks nor hits. */
  stunnedUntil: number;
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
  /** Homing bolts steer; straight shots fly on and hit whatever they cross. */
  homing: boolean;
  /** Enemy id it homes on; retargets when that one dies. 0 = none. */
  target: number;
  /** Bodies it may still pass through. */
  pierce: number;
  /** The body it last hit, so a piercing shot doesn't hit it twice in a row. */
  ignore: number;
  knockback: number;
  life: number;
}

export interface WeaponState {
  id: WeaponId;
  level: number;
  /** Seconds until it may fire again. */
  cooldown: number;
  /** Angle of its last shot, for its mount on the tower. */
  aim: number;
}

export interface PassiveState {
  id: PassiveId;
  level: number;
}

/**
 * A draft card (§4.5). `level` is the level the pick leads to: 1 for a new
 * weapon or passive.
 */
export type Card =
  | { readonly kind: 'weapon'; readonly id: WeaponId; readonly level: number }
  | { readonly kind: 'passive'; readonly id: PassiveId; readonly level: number }
  | { readonly kind: 'fallback'; readonly id: FallbackId };

export interface DraftOffer {
  cards: Card[];
  /** The scorer's pick (§4.5): highlighted, and taken when the timer runs out. */
  suggested: number;
  /** The level this draft was earned at. */
  level: number;
}

export interface UltimateState {
  /** 0–1. */
  charge: number;
  /** Kill XP the current charge needs. */
  need: number;
  casts: number;
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
  /** A chain strike's path: tower, then each body, as flat x, y pairs. */
  | { kind: 'chain'; points: number[] }
  | { kind: 'levelUp'; level: number }
  | { kind: 'draftOpen' }
  | { kind: 'picked'; card: Card }
  | { kind: 'ultReady' }
  | { kind: 'nova'; radius: number }
  | { kind: 'kill'; x: number; y: number; enemy: EnemyId; radius: number }
  | { kind: 'towerHit'; amount: number; x: number; y: number }
  | { kind: 'waveStart'; wave: number }
  | { kind: 'firstSight'; enemy: EnemyId }
  /** Second Wind: the tower rose again instead of falling. */
  | { kind: 'revive' }
  | { kind: 'fell' };

export interface RunState {
  seed: number;
  regionId: number;
  /** Sim steps taken. `time` is derived from it so it never drifts. */
  tick: number;
  time: number;
  /** The highest wave started. */
  wave: number;
  frameId: string;
  /** Stat contributions from outside the run; passives are added on top. */
  mods: StatMod[];
  stats: TowerStats;
  tower: TowerState;
  weaponSlots: number;
  passiveSlots: number;
  pool: CardItemId[];
  weapons: WeaponState[];
  passives: PassiveState[];
  level: number;
  /** XP toward the next level. */
  xp: number;
  xpNext: number;
  /** Levels earned whose drafts are still to come. */
  pendingDrafts: number;
  draft: DraftOffer | null;
  draftsOpened: number;
  firstDraft: Card[] | null;
  ult: UltimateState;
  /** Shards earned this run (§8.3), unrounded; banked at the run's end. */
  shards: number;
  /** Where `shards` came from, for the results breakdown (§4.6). */
  shardsFrom: { kills: number; waves: number; cards: number };
  /** Forge behaviours owned, by level count. */
  behaviours: Partial<Record<BehaviourId, number>>;
  /** Draft rerolls left this run (Fortune's Reroll). */
  rerolls: number;
  /** Second Winds left this run. */
  revives: number;
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
  /** Take card `pick` of the open draft. */
  pick?: number;
  /** Spend a reroll on the open draft. */
  reroll?: boolean;
  /** Fire the ultimate, if charged. */
  ult?: boolean;
}
