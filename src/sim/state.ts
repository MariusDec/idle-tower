import type { RngState } from '../core/rng';
import type { Oval } from '../content/arena';
import type {
  AuraId, BehaviourId, BossId, CardItemId, EnemyId, EvolutionId, FallbackId, FusionId, PactId, PassiveId, RelicId, StatMod, WeaponId,
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
  /** The weapon mounted at the start: the frame's, or a Trial's first (N5). Absent: the frame's. */
  readonly startingWeapon?: WeaponId;
  /** The Trial this run is (N5), or null. Absent: none. */
  readonly trial?: string | null;
  /** Every stat contribution from outside the run: frame quirk, Forge, relics. */
  readonly mods: readonly StatMod[];
  readonly weaponSlots: number;
  readonly passiveSlots: number;
  /** Weapons and passives the draft may offer (§4.5: the pool grows with unlocks). */
  readonly pool: readonly CardItemId[];
  /**
   * The light's shape (plans/camera-and-fog.md): the stage's, taken when the
   * run starts. Absent: a phone's (`PHONE_OVAL`), as the headless tools play.
   */
  readonly arena?: Oval;
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
  /** Fusions a Constellation star has lit (N9): the draft may offer them. Absent: none. */
  readonly fusions?: readonly FusionId[];
  /**
   * The Tactician's list (§6.2), best first: the suggestion takes the
   * highest-ranked item on offer. Null: the scorer decides alone.
   */
  readonly priority: readonly CardItemId[] | null;
  /**
   * The Tactician's Never list (U7): these are never suggested while
   * anything else is offered. Null: nothing is ruled out.
   */
  readonly never: readonly CardItemId[] | null;
  /** The pacts this run is under (§9), by rank; absent is 0. Always empty in the Abyss. */
  readonly pacts: Readonly<Partial<Record<PactId, number>>>;
  /** What the Abyss's elites may drop (§9): the relics of the lit sets. */
  readonly abyssRelics: readonly RelicId[];
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
  /**
   * The light's short half-axis `L` (plans/camera-and-fog.md): always past
   * `range`, never less than `ARENA.lightBase`; `RunState.arena` stretches
   * it into an oval. Nothing outside it can be hit, and enemies spawn just
   * past its rim, in the dark.
   */
  light: number;
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
  /** An overtime Champion (N4): an elite in its region's boss colours, sure to drop a relic. */
  champion: boolean;
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
  /** A Burrower still under the ground: nothing can target or hit it. */
  under: boolean;
  /** A Chorus: the id its bodies share their HP under; 0 for anything else. */
  group: number;
  /** Risen once already (Echoes): it never rises again. */
  shade: boolean;
  /** One of the Hollow King's shades: the king's body id. Its hits land on him. */
  court: number;
  /** One of Forgeheart's plates (S2): the boss's body id; 0 for anything else. */
  plate: number;
  /** A plate's place on its boss: its angle off the boss's line to the tower. */
  slot: number;
  /** A Husk's shell: hits it still swallows whole (§9). */
  shell: number;
  /** Run time a Ram's charge ends; 0 when not charging. */
  dashUntil: number;
  /** Gilded by Midas Lance until then: it takes more, and pays double if slain so. */
  gildedUntil: number;
  /** Times a Maw has fed. */
  feeds: number;
  /** Seconds until a Wraith elite next phases out (N3). */
  auraTimer: number;
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
  /**
   * A Moonblade crescent (§9): it flies out `life` seconds, then comes home
   * to the tower, cutting every body it crosses once each way.
   */
  boomerang: boolean;
  /** True once a crescent has turned for home. */
  returning: boolean;
  /** Bodies this pass of a crescent has cut. */
  struck: number[];
}

/** A rune on the ground (Rune Traps, §9): armed after a beat, it bursts under the first body to step on it. */
export interface Rune {
  x: number;
  y: number;
  armAt: number;
  until: number;
  damage: number;
  crit: boolean;
  radius: number;
  stun: number;
  /** A fainter rune left by a burst (Rune Chalk): it leaves none of its own. */
  echo: boolean;
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

/** A molten pool at the wall (Forgeheart): it burns the tower while it lasts. */
export interface MoltenPool {
  x: number;
  y: number;
  radius: number;
  /** Damage to the tower per second. */
  dps: number;
  until: number;
  /** Seconds until it next bites. */
  timer: number;
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
  /** The mirrored facets' turn, radians (the Prism). */
  facet: number;
  /** The body wearing the crown (the Hollow King's court); 0 before he splits. */
  crown: number;
  /** Plates still standing on it (Forgeheart, S2): while any do, it takes its guard's share. */
  plates: number;
  /** The tower's lowest HP fraction since it arrived (the Steady Hand feat). */
  minHp: number;
  /** Seconds from arrival to its fall; null while it stands. */
  killedIn: number | null;
  /** The wave it holds: 20 in a region, a floor's tenth in the Abyss. */
  wave: number;
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
  /** The fusion it is half of (N9), or null. */
  fusion: FusionId | null;
  /** True for a fusion's second half: it fires from its partner's mount and takes no slot of its own. */
  joined: boolean;
  /** Specialist (§11.4): the starting weapon, which hits harder and evolves sooner. Absent on runs saved before it. */
  signature?: boolean;
  /** Orbit (Glaives) and storm (Storm Crown) angle, radians. */
  spin: number;
  /** Sunlance: the body the beam holds (0 = none), and how hot it has run on it. */
  beamTarget: number;
  heat: number;
  /** Meteorfall: seconds until the next meteor. */
  meteor: number;
  /** Sentinel Drones in the air; empty for every other weapon. */
  drones: Drone[];
  /** Run time until which it cannot fire: a Harbinger's gaze. */
  silencedUntil: number;
  /** Run time until which it fires at half rate: a Harbinger's gaze on a lone weapon. */
  dampedUntil: number;
  /** Soul Tether: the bodies its threads hold, by id. Empty for every other weapon. */
  tethers: number[];
}

export interface PassiveState {
  id: PassiveId;
  level: number;
  /** Waves reached while it was held, for a passive that grows with them (Greed, S5). */
  waves?: number;
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
  /** Two evolved weapons made one (N9): offered once both are evolved and its star is lit. */
  | { readonly kind: 'fusion'; readonly id: FusionId }
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
  /** Run time a lasting ultimate (Tempest, Overclock) ends; 0 when none is going. */
  until: number;
  /** Seconds until a Tempest's next strike. */
  timer: number;
}

/** One entry in a wave's pre-rolled spawn list. */
export interface SpawnEntry {
  /** Seconds after the wave starts. */
  at: number;
  enemy: EnemyId;
  angle: number;
  /** An elite (§4.3), with its aura, or null for a plain elite; a Champion (N4) is one too. Absent for a plain body. */
  elite?: { aura: AuraId | null; champion?: boolean };
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
 * Who a hit is credited to (T1): the weapon whose pattern dealt it, the
 * ultimate, the wall's own answer (Thorns, Aegis), a burn, or a rule's
 * extra (Overkill's carry, Stormcaller's leap, a shatter or a relic's burst).
 */
export type DamageBy = WeaponId | 'ult' | 'thorns' | 'burn' | 'rule';

/**
 * What hurt the tower (U5): a body at the wall, a hostile shot, a boss's
 * shockwave, a molten pool, or a blast (a Bomber).
 */
export type HurtBy = 'contact' | 'shots' | 'slams' | 'pools' | 'blasts';

/**
 * What happened this step, for presentation. Not part of the run's identity:
 * excluded from the determinism hash and never read back by the sim.
 */
export type SimEvent =
  | { kind: 'fire'; weapon: WeaponId; angle: number }
  | { kind: 'hit'; x: number; y: number; amount: number; crit: boolean; by: DamageBy }
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
  | { kind: 'eliteSpawn'; x: number; y: number; aura: AuraId | null; champion: boolean }
  | { kind: 'eliteKill'; x: number; y: number }
  /** A Vengeful elite's death enraged its neighbours. */
  | { kind: 'fury'; x: number; y: number; radius: number }
  | { kind: 'relicDrop'; relic: RelicId; x: number; y: number }
  | { kind: 'shot'; x: number; y: number }
  | { kind: 'bossArrive'; boss: BossId }
  | { kind: 'bossPhase'; boss: BossId; phase: number }
  /** A plate falls from the boss (S2): struck off, or cracked away by a phase. */
  | { kind: 'plateBreak'; x: number; y: number; radius: number }
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
  /** Boss Rush's last boss is down (N8): the run is won. */
  | { kind: 'cleared' }
  /** A shell, bomblet or meteor burst; or a frozen body shattered. */
  | { kind: 'blast'; x: number; y: number; radius: number; weapon: WeaponId; style: 'shell' | 'bomblet' | 'meteor' | 'shatter' }
  /** A weapon evolved (§10.3: the tower's spotlight). */
  | { kind: 'evolve'; weapon: WeaponId; evolution: EvolutionId }
  /** Two weapons fused (N9): the tower's spotlight, on the mount they share. */
  | { kind: 'fuse'; weapon: WeaponId; fusion: FusionId }
  /** A body caught fire. */
  | { kind: 'ignite'; x: number; y: number }
  /** A shield, or a boss's mirror, turned a shot away. */
  | { kind: 'deflect'; x: number; y: number }
  /** A Burrower broke the surface. */
  | { kind: 'surface'; x: number; y: number }
  /** A Blinker jumped. */
  | { kind: 'blink'; x: number; y: number; tx: number; ty: number }
  /** A Harbinger's gaze silenced a weapon. */
  | { kind: 'silence'; x: number; y: number; weapon: WeaponId }
  /** A Bomber blew, or a Shardling burst. */
  | { kind: 'explode'; x: number; y: number; radius: number }
  /** A molten pool opened at the wall. */
  | { kind: 'pool'; x: number; y: number; radius: number }
  /** The Hollow King's crown moved to another body. */
  | { kind: 'crown'; x: number; y: number }
  /** A slain body rose as a shade (Echoes), or a Summoner called. */
  | { kind: 'rise'; x: number; y: number }
  /** A Leech drained the ultimate. */
  | { kind: 'drain'; x: number; y: number }
  /** A lasting ultimate began (Tempest, Overclock, Daybreak). */
  | { kind: 'ultStart'; seconds: number }
  /** An Eclipse fell over the field. */
  | { kind: 'eclipse'; radius: number }
  /** A slug's line, tower to the edge of range (Gilded Rail). */
  | { kind: 'rail'; x1: number; y1: number; x2: number; y2: number; gilded: boolean }
  /** A rune was laid, or burst. */
  | { kind: 'rune'; x: number; y: number; burst: boolean; radius: number }
  /** A Husk's shell swallowed a hit. */
  | { kind: 'shell'; x: number; y: number }
  /** A Ram began its charge. */
  | { kind: 'charge'; x: number; y: number }
  /** A Maw fed on the fallen. */
  | { kind: 'feed'; x: number; y: number }
  /** A floor of the Abyss was cleared (§9). */
  | { kind: 'floor'; floor: number };

export interface RunState {
  seed: number;
  regionId: number;
  /** The light's shape for the whole run (`content/arena.ts`); its size is `stats.light`. */
  readonly arena: Oval;
  /** The Trial this run is (N5), or null (from the config). */
  trial: string | null;
  /** Sim steps taken. `time` is derived from it so it never drifts. */
  tick: number;
  time: number;
  /** The highest wave started. */
  wave: number;
  frameId: string;
  /** Stat contributions from outside the run and its region: frame, Forge, stars, relics, pacts. */
  outerMods: StatMod[];
  /** `outerMods` and the region rule's share (§11.1); passives are added on top. */
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
  /** The boss, from its arrival; it stays after its fall for the results. In the Abyss, the latest floor's. */
  boss: BossState | null;
  /** Bosses felled this run, in order: one in a region, a floor's each in the Abyss. */
  felled: BossId[];
  /** Floors of the Abyss cleared this run (§9); 0 in a region. */
  floors: number;
  /** The pacts this run is under (from the config). */
  pacts: Partial<Record<PactId, number>>;
  /** What the Abyss's elites may drop (from the config). */
  abyssRelics: RelicId[];
  /** Runes on the ground (Rune Traps). */
  runes: Rune[];
  /** Run time a Bulwark Rune last went off at the wall. */
  wallRuneAt: number;
  /** Relics dropped this run, in order (banked at the run's end). */
  relics: RelicId[];
  elitesKilled: number;
  /** The wave the tower first took damage in; null if it never has (the Unbroken feat). */
  firstHurtWave: number | null;
  /** The highest wave reached while holding a single weapon (the Lone Tower feat). */
  loneWave: number;
  shots: HostileShot[];
  rings: SlamRing[];
  /** Burning ground (Meteorfall, Cinders). */
  fires: FirePatch[];
  /** Molten pools at the wall (Forgeheart). */
  pools: MoltenPool[];
  /** Weapons evolved this run, in order, for the Recipe Book (§5.3). */
  evolved: EvolutionId[];
  /** Fusions lit going in (from the config), and those made this run, in order (N9). */
  fusions: FusionId[];
  fused: FusionId[];
  /** Recipes known going in (from the config): what the suggestion steers toward. */
  recipes: EvolutionId[];
  /** The Tactician's list (from the config), or null. */
  priority: CardItemId[] | null;
  /** The Tactician's Never list (from the config), or null. */
  never: CardItemId[] | null;
  /** Forge behaviours owned, by level count. */
  behaviours: Partial<Record<BehaviourId, number>>;
  /** Draft rerolls left this run (Fortune's Reroll). */
  rerolls: number;
  /** Banish charges left this run (N1). */
  banishes: number;
  /** Items banished this run (N1): never offered again. */
  banished: CardItemId[];
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
  /** Damage landed this run, after armour and short of overkill, by what dealt it (T1). */
  damageBy: Partial<Record<DamageBy, number>>;
  /** Damage the tower took this run, after armour, by what dealt it (U5). */
  takenBy: Partial<Record<HurtBy, number>>;
  rng: RngState;
  /** Named child-stream states, so each system's draws stay independent. */
  streams: Record<string, RngState>;
  /** How the run ended: the tower fell, withdrew, or (Boss Rush, N8) cleared every stage. */
  outcome: null | { kind: 'fell' | 'retreat' | 'cleared'; wave: number; time: number };
  events: SimEvent[];
}

/** What the player can do to a run between steps. */
export interface RunInput {
  retreat?: boolean;
  /** Take card `pick` of the open draft. */
  pick?: number;
  /** Spend a reroll on the open draft. */
  reroll?: boolean;
  /** Spend a Banish charge on card `banish` of the open draft (N1). */
  banish?: number;
  /** Take the suggestion on the open draft and every banked one after it (U2). */
  takeAll?: boolean;
  /** Fire the ultimate, if charged. */
  ult?: boolean;
}
