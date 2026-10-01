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
  | 'shardGain'
  | 'ultCharge'
  /** Every blast, pulse, blade and burning patch: a multiplier on its radius. */
  | 'area'
  /** Slows, stuns, freezes, burns and burning ground last longer; a beam ramps faster. */
  | 'duration'
  | 'projectileSpeed'
  /** Extra bodies a shot passes through. */
  | 'pierce';

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
 * Run behaviours a Forge notable switches on (§11.4). Each is a count: how
 * many owned levels grant it. Its numbers live in `BALANCE.behaviours`.
 */
export type BehaviourId =
  | 'opening-salvo'
  | 'head-start'
  | 'overkill'
  | 'executioner'
  | 'second-wind'
  | 'last-stand'
  | 'thorns'
  | 'extra-choice'
  | 'reroll'
  | 'bounty'
  | 'twin-mount'
  /** Evolutions are offered at all (§4.4): sealed by the Bog Mother, so the first lands near 1.5–2 h (§7.1). */
  | 'alchemy'
  // Keystones (§11.4): each defines a build, with a trade-off.
  | 'fortress'
  | 'hoarder'
  | 'specialist'
  // Relics (§11.5): the count is the relic's rank.
  | 'extra-level'
  | 'quick-start'
  | 'tally'
  | 'still-regen'
  | 'storm-xp'
  | 'frail-splits'
  | 'still-target';

/**
 * What the Engineering branch automates (§6.2). The app reads these, never
 * the sim; `tactician` reaches the sim only as `RunConfig.priority`.
 */
export type AutomationId =
  | 'speed-2' | 'speed-3' | 'auto-restart' | 'frontier-march' | 'auto-ult'
  | 'tactician' | 'tactician-2'
  /** Offline tiers I–III (§6.3); the highest owned applies. Tier IV waits for P7's regions. */
  | 'offline' | 'offline-2' | 'offline-3';

/**
 * Effects are data (§12.3, R8). Every kind has one exhaustive consumer, in
 * `meta/runConfig.ts`, that ends in `never`; `automation` is the app's, and
 * `meta/automation.ts` is its consumer.
 */
export type Effect =
  | { readonly kind: 'stat'; readonly mod: StatMod }
  | { readonly kind: 'unlockCard'; readonly id: CardItemId }
  | { readonly kind: 'slot'; readonly slot: 'weapon' | 'passive'; readonly n: number }
  | { readonly kind: 'behaviour'; readonly id: BehaviourId }
  | { readonly kind: 'automation'; readonly id: AutomationId };

/** The Forge's five branches (§5.1). */
export type BranchId = 'might' | 'bulwark' | 'fortune' | 'arsenal' | 'engineering';

/** §5.1: a minor is a stat with levels, a notable a qualitative change, a keystone a build. */
export type NodeType = 'minor' | 'notable' | 'keystone';

/**
 * One Forge node (§5.1, §11.4). Its effects apply once per owned level. A
 * node can be bought when any of its `links` is owned, or when it links to
 * the root (`links` empty).
 */
export interface ForgeNodeDef extends ContentEntry {
  readonly branch: BranchId;
  readonly type: NodeType;
  /** Distance from the root; sets the base cost (§5.1) and the web radius. */
  readonly ring: number;
  /** Where it sits on the web, degrees clockwise from straight up. */
  readonly angle: number;
  /** Nodes it hangs from, toward the root. Empty: it hangs from the root. */
  readonly links: readonly string[];
  readonly maxLevel: number;
  /** Shards for level 1; each further level costs `BALANCE.forge.levelGrowth` more. */
  readonly cost: number;
  readonly effects: readonly Effect[];
  /**
   * Sealed until this boss first falls (§5.1): "Sealed — defeat the
   * Gatekeeper". A sealed node shows, but cannot be bought.
   */
  readonly sealed?: BossId;
}

/**
 * A frame's ultimate (§4.4): charged by kills, the only active button in a
 * run. A closed union: `sim/systems/ultimate.ts` switches on `id`.
 */
export type UltimateDef =
  | {
    readonly id: 'nova';
    readonly name: string;
    readonly text: string;
    /** Multiple of the starting weapon's current hit damage. */
    readonly damage: number;
    /** World units a weight-1 body is thrown outward. */
    readonly knockback: number;
  }
  | {
    readonly id: 'aegis';
    readonly name: string;
    readonly text: string;
    /** Seconds the tower takes no damage. */
    readonly seconds: number;
    /** Fraction of a blocked contact hit dealt back to its attacker. */
    readonly reflect: number;
  };

export type UltimateId = UltimateDef['id'];

export type FrameId = 'arcanist' | 'bastion';

/** How a frame is earned (§11.6). */
export type FrameUnlock = { readonly kind: 'start' } | { readonly kind: 'boss'; readonly boss: BossId };

/** A frame: the tower's chassis, chosen before a run (§4.4). */
export interface FrameDef extends ContentEntry {
  readonly id: FrameId;
  readonly startingWeapon: WeaponId;
  /** The frame's quirk. */
  readonly effects: readonly Effect[];
  readonly ultimate: UltimateDef;
  readonly unlock: FrameUnlock;
}

export type EnemyId = 'grunt' | 'runner' | 'brute' | 'splitter' | 'spitter' | 'mender';

/** Silhouettes the enemy painter knows. A closed union: a new one must be drawn first. */
export type EnemyShape = 'circle' | 'diamond' | 'plated' | 'hexagon';

/**
 * An enemy's verb in the sim (§4.3): what it does besides walking in. A
 * closed union; `sim/systems/enemies.ts` and `combat.ts` switch on it.
 */
export type EnemyVerb =
  /** Walks to the wall and hits it. */
  | { readonly kind: 'walker' }
  /**
   * On death, bursts into `count` copies at `scale` size, each with `hp` × its
   * Max HP and `reward` × its XP and shards; they never split again.
   */
  | { readonly kind: 'split'; readonly count: number; readonly hp: number; readonly scale: number; readonly reward: number }
  /** Stops `standoff` from the tower and lobs a shot every `interval` s at `shotSpeed`. */
  | { readonly kind: 'ranged'; readonly standoff: number; readonly interval: number; readonly shotSpeed: number }
  /** Every `interval` s, heals each other enemy within `radius` by `fraction` of its Max HP. */
  | { readonly kind: 'heal'; readonly radius: number; readonly interval: number; readonly fraction: number };

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
  readonly verb: EnemyVerb;
  /** The Bestiary's line of lore (§5.3). Not a card, so not held to R4. */
  readonly lore: string;
}

/** An elite's aura (§4.3): one per elite, from Region 2 on. */
export type AuraId = 'haste' | 'regen' | 'shield' | 'split' | 'vengeful';

export interface AuraDef extends ContentEntry {
  readonly id: AuraId;
  /** How far it reaches, world units; 0 for an aura that acts only on death. Its strength is in `BALANCE.elites`. */
  readonly radius: number;
}

export type BossId = 'gatekeeper' | 'bog-mother';

/**
 * One thing a boss does (§4.3: one readable pattern per phase). A closed
 * union; `sim/systems/boss.ts` switches on it.
 */
export type BossPattern =
  /**
   * Winds up for `windup` s, then a shockwave ring rolls out from the boss at
   * `speed`; it hits the tower for `damage` × the wave's contact damage.
   */
  | { readonly kind: 'slam'; readonly every: number; readonly windup: number; readonly speed: number; readonly damage: number }
  /** Calls `packs` packs of `enemy` from the rim. `every` 0: once, on entering the phase. */
  | { readonly kind: 'summon'; readonly enemy: EnemyId; readonly packs: number; readonly every: number }
  /** Sinks for `seconds` (untargetable), then rises somewhere else on its ring. */
  | { readonly kind: 'submerge'; readonly every: number; readonly seconds: number };

export interface BossPhase {
  /** The phase begins once the boss is at or below this fraction of its HP. */
  readonly below: number;
  /** What the phase does, in one line: shown when it begins (§4.3). */
  readonly line: string;
  readonly patterns: readonly BossPattern[];
}

/** A region's boss (§4.3, §11.1): wave 20. */
export interface BossDef extends ContentEntry {
  readonly id: BossId;
  /** Multiple of the region's wave-20 HP for a weight-1 enemy (§8.2). */
  readonly hp: number;
  /** Flat armour, as a multiple of the region's wave-20 HP. */
  readonly armor: number;
  readonly speed: number;
  readonly radius: number;
  /** Where it stops walking, as a distance from the tower; it never reaches the wall. */
  readonly standoff: number;
  /** Multiple of the wave's contact damage, per hit, once enraged and at the wall. */
  readonly damage: number;
  /** XP and ultimate charge the kill gives. */
  readonly xp: number;
  /** Shards, as a multiple of the region's per-kill base (§8.3); ×5 on the first kill. */
  readonly shards: number;
  /** Knockback resistance. */
  readonly mass: number;
  /** Phases in order; the first has `below: 1`. */
  readonly phases: readonly BossPhase[];
  /** Its first kill opens a relic slot (§11.1). */
  readonly relicSlot: boolean;
  readonly color: string;
  readonly borderColor: string;
  /** The Bestiary's line of lore. */
  readonly lore: string;
}

export type WeaponId =
  | 'arcane-bolt' | 'scattershot' | 'chain-lightning' | 'frost-ring'
  | 'mortar' | 'sunlance' | 'glaives' | 'sentinel-drones';

/**
 * How a weapon attacks (§4.4). A closed union: `sim/systems/combat.ts`
 * switches on it exhaustively, and the tower painter draws one mount per kind.
 *
 *   homing  bolts that steer       lob    shells at the densest cluster
 *   cone    a fan of pellets       beam   a lance that ramps on one target
 *   chain   lightning that leaps   orbit  blades circling the tower
 *   pulse   a ring round the tower drone  drones that hunt and fire
 */
export type WeaponPattern = 'homing' | 'cone' | 'chain' | 'pulse' | 'lob' | 'beam' | 'orbit' | 'drone';

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
  /**
   * World units: a pulse's reach from the tower's centre, a shell's blast,
   * or the blades' orbit.
   */
  readonly radius: number;
  /** Fraction of speed a struck body loses… */
  readonly slow: number;
  /** …for this many seconds. */
  readonly slowSeconds: number;
  /** Small shells a landing shell scatters, each a share of its damage (Mortar). */
  readonly bomblets: number;
  /** A beam's damage multiplier gained per second on one target… */
  readonly ramp: number;
  /** …up to this. */
  readonly rampCap: number;
  /** An orbit's turn, radians per second; attack speed turns it faster. An orbit has no `fireRate`: a blade cuts as it passes. */
  readonly spin: number;
  /** A blade's reach around its centre, world units. */
  readonly blade: number;
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
  /** What it is strong against (§11.2): the draft scorer leans toward it where these walk. */
  readonly counters: readonly EnemyId[];
  /** Level 1. */
  readonly base: WeaponParams;
  /** Levels 2–5, in order. */
  readonly steps: readonly WeaponStep[];
}

export type PassiveId =
  | 'power' | 'haste' | 'precision' | 'fortify' | 'mending' | 'insight'
  | 'area' | 'reach' | 'focus' | 'bulwark' | 'velocity' | 'greed';

/** A passive (§4.4, §11.3). Each level adds `perLevel` again. */
export interface PassiveDef extends ContentEntry {
  readonly id: PassiveId;
  readonly perLevel: readonly StatMod[];
  /** Added once more at the last level (Velocity's pierce). */
  readonly atMax?: readonly StatMod[];
  /**
   * The pool grows with unlocks (§4.5): a passive with this joins the draft
   * once that weapon is in it. Without it, the passive is there from the start.
   */
  readonly joinsWith?: WeaponId;
}

export type EvolutionId =
  | 'seeker-swarm' | 'dragonbreath' | 'storm-crown' | 'absolute-zero'
  | 'meteorfall' | 'judgment' | 'halo' | 'hive';

/**
 * An evolution (§4.4, §11.2): a maxed weapon and its partner passive make a
 * new pattern. Hidden until found, then kept in the Recipe Book. What each
 * one does is `sim/systems/combat.ts`'s; its numbers, `BALANCE.evolutions`.
 */
export interface EvolutionDef extends ContentEntry {
  readonly id: EvolutionId;
  readonly weapon: WeaponId;
  readonly passive: PassiveId;
  /** The Recipe Book's nudge once the weapon has been maxed a few times (§5.3). */
  readonly hint: string;
}

export type FallbackId = 'heal' | 'shards';

/** What the draft offers once every slot is full and maxed (§4.5). */
export interface FallbackDef extends ContentEntry {
  readonly id: FallbackId;
}

/**
 * A region's rule (§11.1). A closed union with one consumer
 * (`sim/run.ts#regionMods`); P7's rules extend it.
 */
export type RegionRule = { readonly kind: 'stat'; readonly mod: StatMod };

/** A wave beat (§4.2): the moment that gives a region its rhythm. */
export type WaveBeat =
  | { readonly kind: 'introduce'; readonly enemy: EnemyId; readonly packs: number }
  | { readonly kind: 'swarm'; readonly countMult: number };

export interface RegionDef extends ContentEntry {
  /** 1–6, the order on the map. */
  readonly index: number;
  /** Shards a weight-1 kill drops (§8.3); an enemy's weight is its `xp`. */
  readonly shardBase: number;
  /** Shards for reaching wave n + 1: `waveShards × n` (§8.3). */
  readonly waveShards: number;
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
  /** The region's rule, named and in one line, or null for none. */
  readonly rule: { readonly name: string; readonly text: string; readonly effect: RegionRule } | null;
  /** Wave 20 (§4.2). */
  readonly boss: BossId;
  /** The ground's tint (§10.5), mixed into the lit field. Null keeps the plain stone. */
  readonly tint: string | null;
  /**
   * Elites (§4.3): one on wave `from`, then every `every` waves. Each wears
   * one of `auras`; an empty list means plain elites (Region 1).
   */
  readonly elites: { readonly from: number; readonly every: number; readonly auras: readonly AuraId[] };
}

export type RelicId =
  | 'gatekeepers-seal' | 'tallow-candle' | 'cracked-lens' | 'hunters-tally'
  | 'mothers-tear' | 'bog-lantern' | 'mire-lily' | 'stillwater-charm';

/** Where a relic drops (§5.3): its boss's first kill, or that region's elites. */
export type RelicSource = { readonly kind: 'boss'; readonly boss: BossId } | { readonly kind: 'elite'; readonly region: number };

/**
 * A relic (§5.3, §11.5): qualitative, equipped between runs. `effects` apply
 * at rank I; `perRank` once more for each rank past I (duplicates rank it
 * up to III).
 */
export interface RelicDef extends ContentEntry {
  readonly id: RelicId;
  readonly source: RelicSource;
  readonly effects: readonly Effect[];
  readonly perRank: readonly Effect[];
}

/**
 * What a feat asks for (§5.4). A closed union; `meta/feats.ts` is its one
 * consumer. "In a run" goals read the finished run; the rest read the profile.
 */
export type FeatGoal =
  /** Reach wave n in a run. */
  | { readonly kind: 'wave'; readonly wave: number }
  /** Defeat this boss. */
  | { readonly kind: 'boss'; readonly boss: BossId }
  /** Defeat a boss within n seconds of its arrival. */
  | { readonly kind: 'bossFast'; readonly seconds: number }
  /** Defeat a boss without the tower dropping below this fraction of Max HP during the fight. */
  | { readonly kind: 'bossHealthy'; readonly hp: number }
  /** Take no damage before wave n. */
  | { readonly kind: 'untouched'; readonly wave: number }
  /** Reach level n in a run. */
  | { readonly kind: 'level'; readonly level: number }
  /** Take a weapon to its last level. */
  | { readonly kind: 'maxWeapon' }
  /** Lifetime kills. */
  | { readonly kind: 'kills'; readonly n: number }
  /** Lifetime elite kills. */
  | { readonly kind: 'elites'; readonly n: number }
  /** Every enemy type of a region seen. */
  | { readonly kind: 'bestiary'; readonly region: number }
  /** Different relics found. */
  | { readonly kind: 'relics'; readonly n: number }
  /** Reach wave n with a single weapon. */
  | { readonly kind: 'lone'; readonly wave: number }
  /** Evolve any weapon. */
  | { readonly kind: 'evolve' };

/** A feat (§5.4): one finite list, each paying shards once. */
export interface FeatDef extends ContentEntry {
  readonly goal: FeatGoal;
  readonly reward: number;
}
