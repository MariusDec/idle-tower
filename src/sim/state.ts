import type { RngState } from '../core/rng';
import type {
  AuraId, BehaviourId, BossId, CardItemId, EnemyId, EvolutionId, FallbackId, PassiveId, RelicId, StatMod, WeaponId,
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
  /** Forge behaviours owned, by how many levels (§11.4), and relics by rank. Absent means 0. */
  readonly behaviours: Readonly<Partial<Record<BehaviourId, number>>>;
  /** True while this region's boss has never fallen: its kill pays ×5 (§8.1). */
  readonly firstKill: boolean;
  /** True once a relic slot is open: until then, elites drop no relics (§5.3). */
  readonly relicDrops: boolean;
  /**
   * Recipes found (§5.3). The suggestion steers only toward these: an
   * unknown recipe is found by chance, never hunted.
   */
  readonly recipes: readonly EvolutionId[];
  /**
   * The Tactician's list (§6.2), best first: the suggestion takes the
   * highest-ranked item on offer. Null: the scorer decides alone.
   */
  readonly priority: readonly CardItemId[] | null;
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
  /** Radius multiplier on blasts, pulses, blades and burning ground. */
  areaMult: number;
  /** Multiplier on slows, stuns, freezes and burns, and on a beam's ramp. */
  durationMult: number;
  projectileSpeedMult: number;
  /** Extra bodies every shot passes through. */
  pierce: number;
}

export interface TowerState {
  hp: number;
  /** Tick of the last contact hit taken, for the hurt flash. */
  hurtTick: number;
  /** Run time until which the tower takes no damage (Aegis). */
  invulnUntil: number;
}

export interface Enemy {
  id: number;
  /** The enemy type; for a boss, the type its kills and summons are read as. */
  type: EnemyId;
  /** Set on the one body that is a region's boss (§4.3). */
  boss: BossId | null;
  /** An elite (§4.3): ×8 HP, and from Region 2 on, an aura. */
  elite: boolean;
  aura: AuraId | null;
  /** 0 for a spawned body; 1 for a Splitter's fragment, which never splits again. */
  gen: number;
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
  /** Fraction of speed lost to frost, until `slowUntil`. */
  slow: number;
  slowUntil: number;
  /** Run time until which it can't be targeted or hit (a boss under the water). */
  hiddenUntil: number;
  /** Seconds until its verb acts again: a Spitter's shot, a Mender's pulse. */
  actTimer: number;
  /** True if it moved this step; Stillwater Charm reads it. */
  moving: boolean;
  /** Elite auras on it this step: speed multiplier and damage taken (§4.3). */
  buffSpeed: number;
  buffShield: number;
  /** Enraged by a Vengeful elite's death: a lasting speed and damage multiplier. */
  fury: number;
  /** Seconds until the next contact hit; counts only while in contact. */
  attackTimer: number;
  inContact: boolean;
  /** Tick it was last hit, for the hit flash. */
  hitTick: number;
  /** Burning (Dragonbreath, Meteorfall's ground): damage per second until `burnUntil`. */
  burn: number;
  burnUntil: number;
  /** Seconds until the burn next bites. */
  burnTimer: number;
  /** Frozen by Absolute Zero until then: slain while frozen, it shatters. */
  frozenUntil: number;
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
  /**
   * A lobbed shell (Mortar) or a meteor: it flies over everything to
   * (tx, ty) and bursts there, `blast` wide. 0 for a shot that hits bodies.
   */
  blast: number;
  tx: number;
  ty: number;
  /** Where a shell left from, for the painter's arc. */
  sx: number;
  sy: number;
  /** Bomblets a shell scatters as it bursts. */
  bomblets: number;
  /** A meteor: its burst leaves burning ground. */
  meteor: boolean;
  /** A Seeker Swarm seeker: never splits again. */
  seeker: boolean;
}

/** Burning ground (Meteorfall): bodies standing in it catch fire. */
export interface FirePatch {
  x: number;
  y: number;
  radius: number;
  /** Burn per second it sets on a body inside. */
  dps: number;
  until: number;
}

/** A Sentinel Drone in flight. */
export interface Drone {
  x: number;
  y: number;
  px: number;
  py: number;
  cooldown: number;
  /** Run time a Hive drone fades; null for a drone the weapon owns. */
  until: number | null;
}

/** A hostile shot (a Spitter's): flies straight at the tower and lands for `damage`. */
export interface HostileShot {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  damage: number;
  life: number;
}

/** A boss's shockwave: a ring rolling out from where it slammed. */
export interface SlamRing {
  x: number;
  y: number;
  radius: number;
  speed: number;
  damage: number;
  /** True once it has reached the tower. */
  hit: boolean;
}

/** The region's boss, from its arrival at wave 20 (§4.3). */
export interface BossState {
  id: BossId;
  /** Its body's enemy id. */
  enemy: number;
  phase: number;
  /** Run time it arrived. */
  arrivedAt: number;
  /** Seconds until each of the phase's patterns fires next, by index. */
  timers: number[];
  /** Seconds left of a slam's wind-up; 0 when not winding up. */
  windup: number;
  /** True while it is under the water (Submerge); it rises somewhere else. */
  submerged: boolean;
  /** True once it has outlasted `BALANCE.boss.enrageAfter` and walks to the wall. */
  enraged: boolean;
  /** The pattern index of the slam being wound up. */
  windupPattern: number;
  /** Run time until which it is staggered (a Nova broke its wind-up). */
  staggeredUntil: number;
  /** The tower's lowest HP fraction since it arrived (the Steady Hand feat). */
  minHp: number;
  /** Seconds from arrival to its fall; null while it stands. */
  killedIn: number | null;
}

export interface WeaponState {
  id: WeaponId;
  level: number;
  /** Seconds until it may fire again. */
  cooldown: number;
  /** Angle of its last shot, for its mount on the tower. */
  aim: number;
  /** True once evolved (§4.4): a new pattern on top of its last level. */
  evolved: boolean;
  /** Orbit (Glaives) and storm (Storm Crown) angle, radians. */
  spin: number;
  /** Sunlance: the body the beam holds (0 = none), and how hot it has run on it. */
  beamTarget: number;
  heat: number;
  /** Meteorfall: seconds until the next meteor. */
  meteor: number;
  /** Sentinel Drones in the air; empty for every other weapon. */
  drones: Drone[];
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
  /** A weapon's evolution (§4.4): offered once its recipe is complete. */
  | { readonly kind: 'evolution'; readonly id: EvolutionId }
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
  /** An elite (§4.3), with its aura, or null for a plain elite. Absent for a plain body. */
  elite?: { aura: AuraId | null };
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
  /** Judgment's forks: flat x1, y1, x2, y2 quads. */
  | { kind: 'lance'; points: number[] }
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
  /** A Frost Ring pulse. */
  | { kind: 'pulse'; radius: number }
  /** A Mender's heal. */
  | { kind: 'mend'; x: number; y: number; radius: number }
  /** A Splitter, or a Split elite, came apart. */
  | { kind: 'split'; x: number; y: number; n: number }
  | { kind: 'eliteSpawn'; x: number; y: number; aura: AuraId | null }
  | { kind: 'eliteKill'; x: number; y: number }
  /** A Vengeful elite's death enraged its neighbours. */
  | { kind: 'fury'; x: number; y: number; radius: number }
  | { kind: 'relicDrop'; relic: RelicId; x: number; y: number }
  | { kind: 'shot'; x: number; y: number }
  | { kind: 'bossArrive'; boss: BossId }
  | { kind: 'bossPhase'; boss: BossId; phase: number }
  | { kind: 'windup'; x: number; y: number; seconds: number }
  | { kind: 'slam'; x: number; y: number }
  | { kind: 'stagger'; x: number; y: number }
  | { kind: 'submerge'; x: number; y: number }
  | { kind: 'emerge'; x: number; y: number }
  | { kind: 'enrage' }
  | { kind: 'bossKill'; boss: BossId; first: boolean; x: number; y: number }
  | { kind: 'aegis'; seconds: number }
  /** Aegis turned a hit away. */
  | { kind: 'blocked'; x: number; y: number }
  | { kind: 'fell' }
  /** A shell, bomblet or meteor burst; or a frozen body shattered. */
  | { kind: 'blast'; x: number; y: number; radius: number; weapon: WeaponId; style: 'shell' | 'bomblet' | 'meteor' | 'shatter' }
  /** A weapon evolved (§10.3: the tower's spotlight). */
  | { kind: 'evolve'; weapon: WeaponId; evolution: EvolutionId }
  /** A body caught fire. */
  | { kind: 'ignite'; x: number; y: number };

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
  shardsFrom: { kills: number; waves: number; cards: number; elites: number; boss: number };
  /** True while this region's boss has never fallen (from the config). */
  firstKill: boolean;
  /** True when elites may drop relics (from the config). */
  relicDrops: boolean;
  /** The boss, from its arrival; it stays after its fall for the results. */
  boss: BossState | null;
  /** Relics dropped this run, in order (banked at the run's end). */
  relics: RelicId[];
  elitesKilled: number;
  /** The wave the tower first took damage in; null if it never has (the Unbroken feat). */
  firstHurtWave: number | null;
  /** The highest wave reached while holding a single weapon (the Lone Tower feat). */
  loneWave: number;
  shots: HostileShot[];
  rings: SlamRing[];
  /** Burning ground (Meteorfall). */
  fires: FirePatch[];
  /** Weapons evolved this run, in order, for the Recipe Book (§5.3). */
  evolved: EvolutionId[];
  /** Recipes known going in (from the config): what the suggestion steers toward. */
  recipes: EvolutionId[];
  /** The Tactician's list (from the config), or null. */
  priority: CardItemId[] | null;
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
  /** Kills by type this run, for the Bestiary's counts (§5.3). Bosses aren't counted here. */
  killsBy: Partial<Record<EnemyId, number>>;
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
