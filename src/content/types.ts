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
 * `(base + Σadd) × (1 + Σpct_meta) × (1 + Σpct_run) × Πmult`: flat first,
 * then two buckets of additive percentages, then true multipliers
 * (keystones, masteries). The buckets (S1) keep a card's "+15%" worth the
 * same however much of the Forge is owned: the run's own passives write
 * `run`; the Forge, stars, relics, frames, rules and pacts are `meta`.
 */
export interface StatMod {
  readonly key: StatKey;
  readonly add?: number;
  readonly pct?: number;
  readonly mult?: number;
  /** Which percentage bucket `pct` sums into; absent is `meta`. */
  readonly bucket?: 'meta' | 'run';
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
  /** Banish (N1): a charge per owned level, to strike a new item from this run's draft. */
  | 'banish'
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
  | 'still-target'
  | 'refract'
  | 'frost-brand'
  | 'first-crit'
  | 'close-quarters'
  | 'surge'
  | 'kindling'
  | 'blast-shield'
  | 'ult-heal'
  | 'soul-jar'
  | 'salt'
  | 'last-light'
  | 'elite-bane'
  | 'boss-bane'
  | 'level-heal'
  // Later Forge notables (P7).
  | 'rampart'
  | 'oath'
  | 'relic-luck'
  | 'drilled'
  | 'charged-start'
  // Trial notables (N5): earned only by a Trial.
  /** Chain Lightning leaps to burrowed bodies first, and they surface. */
  | 'deep-arc'
  /** Mortar shells scatter more bomblets. */
  | 'heavy-shells'
  // Relic sets (N6): a region's three elite relics worn together. The count is the set's rank.
  | 'set-fields'
  | 'set-mire'
  | 'set-wastes'
  | 'set-rift'
  | 'set-hollow'
  | 'set-blight'
  // Frame quirks (§11.6).
  | 'stormcaller'
  /** The Gravekeeper's quirk: every kill mends the tower a little. */
  | 'siphon'
  // Act 2 relics (§9), lit in the Constellations and found in the Abyss.
  | 'swift-return'
  | 'echo-rune'
  | 'brittle-shell'
  | 'extra-tether'
  | 'rail-burst'
  | 'anchor'
  | 'wardbreak'
  | 'starve'
  | 'floor-heal';

/**
 * What the Engineering branch automates (§6.2). The app reads these, never
 * the sim; `tactician` reaches the sim only as `RunConfig.priority`.
 */
export type AutomationId =
  | 'speed-2' | 'speed-3' | 'auto-restart' | 'frontier-march' | 'auto-ult'
  | 'tactician' | 'tactician-2'
  /** Offline tiers I–IV (§6.3); the highest owned applies. */
  | 'offline' | 'offline-2' | 'offline-3' | 'offline-4'
  /** Evolution Insight (§11.4): every recipe's weapon half shows in the Recipe Book. */
  | 'insight'
  /** The Foreman (N7): pinned Forge nodes are bought as shards arrive. */
  | 'foreman';

/**
 * Effects are data (§12.3, R8). Every kind has one exhaustive consumer, in
 * `meta/runConfig.ts`, that ends in `never`; `automation` is the app's, and
 * `meta/automation.ts` is its consumer. The last four are the profile's,
 * between runs (Act 2, §9): `meta/stars.ts` reads them.
 */
export type Effect =
  | { readonly kind: 'stat'; readonly mod: StatMod }
  | { readonly kind: 'unlockCard'; readonly id: CardItemId }
  /** A relic slot is the profile's: `meta/collection.ts#relicSlots` counts it, the run never sees it. */
  | { readonly kind: 'slot'; readonly slot: 'weapon' | 'passive' | 'relic'; readonly n: number }
  | { readonly kind: 'behaviour'; readonly id: BehaviourId }
  | { readonly kind: 'automation'; readonly id: AutomationId }
  /** A frame joins the Collection (§9: two come from the Constellations). */
  | { readonly kind: 'frame'; readonly id: FrameId }
  /** A Forge branch's mastery node is unsealed (§9). */
  | { readonly kind: 'mastery'; readonly branch: BranchId }
  /** A set of Act 2 relics starts dropping in the Abyss (§9). */
  | { readonly kind: 'relics'; readonly set: number }
  /** Every Starlight payout is this much larger. */
  | { readonly kind: 'starlight'; readonly pct: number };

/** The Forge's five branches (§5.1). */
export type BranchId = 'might' | 'bulwark' | 'fortune' | 'arsenal' | 'engineering';

/**
 * §5.1: a minor is a stat with levels, a notable a qualitative change, a
 * keystone a build. A mastery (§9) is a branch's endless sink: unlimited
 * levels, unsealed by its constellation.
 */
export type NodeType = 'minor' | 'notable' | 'keystone' | 'mastery';

/** The Constellations' five figures (§9): the Starlight tree's branches. */
export type ConstellationId = 'smith' | 'warden' | 'lantern' | 'crown' | 'deep';

/**
 * One node of a web: the Forge (§5.1, §11.4) or the Constellations (§9).
 * Its effects apply once per owned level. A node can be bought when any of
 * its `links` is owned, or when it links to the root (`links` empty).
 */
export interface WebNodeDef<B extends string = string> extends ContentEntry {
  readonly branch: B;
  readonly type: NodeType;
  /** Distance from the root; sets the base cost (§5.1) and the web radius. */
  readonly ring: number;
  /** Where it sits on the web, degrees clockwise from straight up. */
  readonly angle: number;
  /** Nodes it hangs from, toward the root. Empty: it hangs from the root. */
  readonly links: readonly string[];
  /** Levels it may be bought to; Infinity for a mastery. */
  readonly maxLevel: number;
  /** Level 1's price; each further level costs `growth` (or the web's default) more. */
  readonly cost: number;
  /** Cost growth per level, when not the web's default (a mastery's ×1.2, §9; a two-level late minor's ×3, S1). */
  readonly growth?: number;
  readonly effects: readonly Effect[];
  /**
   * Sealed until this boss first falls (§5.1): "Sealed — defeat the
   * Gatekeeper". A sealed node shows, but cannot be bought.
   */
  readonly sealed?: BossId;
}

/** A Forge node, paid in shards. */
export type ForgeNodeDef = WebNodeDef<BranchId>;

/** A Constellation node (§9), paid in Starlight. */
export type StarNodeDef = WebNodeDef<ConstellationId>;

/**
 * A frame's ultimate (§4.4): charged by kills, the only active button in a
 * run. A closed union: `sim/systems/ultimate.ts` switches on `id`.
 */
/**
 * When the Autocaster fires an ultimate (U13), as data:
 * `sim/systems/ultimate.ts#autoUltWanted` reads it through an exhaustive
 * switch. The idle bot casts on the same rule.
 *   windup  into a boss's slam wind-up, which a Nova staggers (a boss with
 *           no slam in its phase: at once), or a crowd of `crowd` in range
 *   wall    a shockwave within `within` seconds of the wall, or HP under
 *           `hp` with `contact` bodies at the wall
 *   pool    the HP in range is worth `bodies` of the wave's bodies, or a boss
 *   crowd   a standing boss, or a crowd of `crowd` in range
 */
export type AutoRule =
  | { readonly kind: 'windup'; readonly crowd: number }
  | { readonly kind: 'wall'; readonly within: number; readonly hp: number; readonly contact: number }
  | { readonly kind: 'pool'; readonly bodies: number }
  | { readonly kind: 'crowd'; readonly crowd: number };

export type UltimateDef = UltimateKind & {
  /** When the Autocaster fires it (U13). */
  readonly auto: AutoRule;
};

type UltimateKind =
  | {
    readonly id: 'nova';
    readonly name: string;
    readonly text: string;
    /** Multiple of the starting weapon's current hit damage. */
    readonly damage: number;
    /** …or this share of a body's Max HP, if more (S3: it keeps pace with the region). Never a boss's. */
    readonly floor: number;
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
  }
  | {
    readonly id: 'tempest';
    readonly name: string;
    readonly text: string;
    readonly seconds: number;
    /** Strikes per second, each on a random body in range… */
    readonly rate: number;
    /** …for this multiple of the starting weapon's hit… */
    readonly damage: number;
    /** …or this share of the body's Max HP, if more (S3). Never a boss's. */
    readonly floor: number;
  }
  | {
    readonly id: 'overclock';
    readonly name: string;
    readonly text: string;
    readonly seconds: number;
    /** Attack speed multiplier while it lasts. */
    readonly speed: number;
  }
  | {
    readonly id: 'daybreak';
    readonly name: string;
    readonly text: string;
    readonly seconds: number;
    /** While it lasts, every body in range loses this share of its speed… */
    readonly slow: number;
    /** …and takes this many times the damage. */
    readonly vulnerable: number;
  }
  | {
    readonly id: 'eclipse';
    readonly name: string;
    readonly text: string;
    /** Every body in range loses this share of its current HP… */
    readonly fraction: number;
    /** …a boss only this much. */
    readonly bossFraction: number;
  };

export type UltimateId = UltimateDef['id'];

export type FrameId = 'arcanist' | 'bastion' | 'stormcaller' | 'artificer' | 'lamplighter' | 'gravekeeper';

/** How a frame is earned (§11.6). */
export type FrameUnlock =
  | { readonly kind: 'start' }
  | { readonly kind: 'boss'; readonly boss: BossId }
  /** A secret feat earns it (§5.4, §11.6). */
  | { readonly kind: 'feat'; readonly feat: string }
  /** A Constellation node with a `frame` effect for it lights it (§9). */
  | { readonly kind: 'star' };

/** A frame: the tower's chassis, chosen before a run (§4.4). */
export interface FrameDef extends ContentEntry {
  readonly id: FrameId;
  readonly startingWeapon: WeaponId;
  /** The frame's quirk. */
  readonly effects: readonly Effect[];
  readonly ultimate: UltimateDef;
  readonly unlock: FrameUnlock;
}

export type EnemyId =
  | 'grunt' | 'runner' | 'brute'
  | 'splitter' | 'spitter' | 'mender'
  | 'shieldbearer' | 'burrower' | 'shardling'
  | 'bomber' | 'blinker' | 'siege-engine'
  | 'phantom' | 'leech' | 'summoner' | 'imp'
  | 'harbinger' | 'chorus'
  // The Abyss's own (§9).
  | 'husk' | 'ram' | 'wardstone' | 'maw';

/** Silhouettes the enemy painter knows. A closed union: a new one must be drawn first. */
export type EnemyShape = 'circle' | 'diamond' | 'plated' | 'hexagon' | 'triangle' | 'square';

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
  | { readonly kind: 'heal'; readonly radius: number; readonly interval: number; readonly fraction: number }
  /** A frontal shield: shots flying within `arc` radians of head-on are turned away. Area, chains and blades pass. */
  | { readonly kind: 'shield'; readonly arc: number }
  /** Underground, untargetable, until it is within `surface` of the tower's centre. */
  | { readonly kind: 'burrow'; readonly surface: number }
  /** On death, `count` shards fly at the tower: they reach only `reach` units, for `damage` × its contact hit each. */
  | { readonly kind: 'shards'; readonly count: number; readonly reach: number; readonly damage: number }
  /** On death, a blast `radius` wide: if it reaches the wall, the tower takes `damage` × its contact hit. */
  | { readonly kind: 'explode'; readonly radius: number; readonly damage: number }
  /** Every `interval` s (slowed: longer), jumps `distance` straight in. */
  | { readonly kind: 'blink'; readonly interval: number; readonly distance: number }
  /** Phases out for `hidden` s of every `cycle`: untargetable, and it never hits while out. */
  | { readonly kind: 'phase'; readonly cycle: number; readonly hidden: number }
  /** Each contact hit also drains `drain` of the ultimate's charge. */
  | { readonly kind: 'leech'; readonly drain: number }
  /** Stops at `standoff` and calls `count` of `enemy` every `interval` s, until slain. */
  | { readonly kind: 'summon'; readonly enemy: EnemyId; readonly count: number; readonly interval: number; readonly standoff: number }
  /** Stops at `standoff`; every `interval` s, silences one weapon for `seconds`. */
  | { readonly kind: 'silence'; readonly standoff: number; readonly interval: number; readonly seconds: number }
  /** Arrives as `count` bodies sharing one pool of HP: a hit on one is a hit on all. */
  | { readonly kind: 'chorus'; readonly count: number }
  /** A shell that swallows its first `hits` hits whole, whatever their size. */
  | { readonly kind: 'carapace'; readonly hits: number }
  /** Every `interval` s, charges for `seconds` at `speed` times its pace; slowed, it charges less far. */
  | { readonly kind: 'charge'; readonly interval: number; readonly seconds: number; readonly speed: number }
  /** Stops at `standoff`; every other body within `radius` takes only `shield` of its damage. */
  | { readonly kind: 'ward'; readonly standoff: number; readonly radius: number; readonly shield: number }
  /**
   * Feeds on bodies that fall within `radius`: each heals it `heal` of its
   * Max HP and grows it by `grow`, up to `feeds` times.
   */
  | { readonly kind: 'devour'; readonly radius: number; readonly heal: number; readonly grow: number; readonly feeds: number };

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

/**
 * An elite's aura (§4.3): one per elite, from Region 2 on. The last five are
 * each one region's own (N3), in place of one of the first five there.
 */
export type AuraId = 'haste' | 'regen' | 'shield' | 'split' | 'vengeful'
  | 'fog' | 'mirrored' | 'molten' | 'wraith' | 'hungering';

export interface AuraDef extends ContentEntry {
  readonly id: AuraId;
  /** How far it reaches, world units; 0 for an aura that acts only on death. Its strength is in `BALANCE.elites`. */
  readonly radius: number;
}

export type BossId = 'gatekeeper' | 'bog-mother' | 'prism' | 'forgeheart' | 'hollow-king' | 'blight'
  // The Abyss's own (§9): they hold every fifth floor.
  | 'deepwarden' | 'hunger';

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
  | { readonly kind: 'submerge'; readonly every: number; readonly seconds: number }
  /**
   * Mirrored facets turn about it at `spin` rad/s: a shot that strikes one of
   * the `facets` (each `arc` wide) flies back at the tower for `damage` × the
   * wave's contact damage. Beams, chains and blasts pass.
   */
  | { readonly kind: 'mirror'; readonly facets: number; readonly arc: number; readonly spin: number; readonly damage: number }
  /** A molten pool opens at the wall: it burns the tower for `dps` × the wave's contact damage a second, for `seconds`. */
  | { readonly kind: 'pool'; readonly every: number; readonly seconds: number; readonly dps: number; readonly radius: number }
  /**
   * Splits into `shades` bodies (itself one) sharing its HP; one wears the
   * crown, moving every `every` s. Hits on the others land at `share`.
   */
  | { readonly kind: 'court'; readonly shades: number; readonly every: number; readonly share: number };

export interface BossPhase {
  /** The phase begins once the boss is at or below this fraction of its HP. */
  readonly below: number;
  /** What the phase does, in one line: shown when it begins (§4.3). */
  readonly line: string;
  readonly patterns: readonly BossPattern[];
  /** Armour from this phase on, as a multiple of the region's wave-20 HP. */
  readonly armor?: number;
  /** Plates it wears from this phase on (S2): the first phase hangs them, later ones crack the extra away. */
  readonly plates?: number;
}

/**
 * A boss's breakable plates (S2, Forgeheart): bodies hung before it, each
 * with its own share of HP and heavy armour, so big hits strip them. While
 * any stands, the boss takes only `guard` of a hit.
 */
export interface BossPlates {
  /** Each plate's HP, as a share of the boss's. */
  readonly hp: number;
  /** Each plate's armour, as a multiple of the region's wave-20 HP. */
  readonly armor: number;
  /** The share of a hit the boss takes while a plate stands. */
  readonly guard: number;
  /** Radius of a plate's body. */
  readonly radius: number;
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
  /** Breakable plates, if it wears any (a phase's `plates` says how many). */
  readonly plates?: BossPlates;
  /** Its first kill opens a relic slot (§11.1). */
  readonly relicSlot: boolean;
  /** Its first kill ends Act 1 (§7.1): the ending plays on the Map. */
  readonly finale?: boolean;
  /** An Abyss boss (§9): no region of its own; it holds the Abyss's fifth floors. */
  readonly abyss?: boolean;
  readonly color: string;
  readonly borderColor: string;
  /** The Bestiary's line of lore. */
  readonly lore: string;
}

export type WeaponId =
  | 'arcane-bolt' | 'scattershot' | 'chain-lightning' | 'frost-ring'
  | 'mortar' | 'sunlance' | 'glaives' | 'sentinel-drones'
  // Act 2's four (§9), lit in the Constellations.
  | 'moonblade' | 'rune-traps' | 'soul-tether' | 'gilded-rail';

/**
 * How a weapon attacks (§4.4). A closed union: `sim/systems/combat.ts`
 * switches on it exhaustively, and the tower painter draws one mount per kind.
 *
 *   homing  bolts that steer       lob    shells at the densest cluster
 *   cone    a fan of pellets       beam   a lance that ramps on one target
 *   chain   lightning that leaps   orbit  blades circling the tower
 *   pulse   a ring round the tower drone  drones that hunt and fire
 *
 * Act 2 (§9):
 *
 *   boomerang  a blade out and back   tether  draining threads held on several
 *   mine       runes laid in the path rail    a slug through everything in line
 */
export type WeaponPattern =
  | 'homing' | 'cone' | 'chain' | 'pulse' | 'lob' | 'beam' | 'orbit' | 'drone'
  | 'boomerang' | 'mine' | 'tether' | 'rail';

/**
 * Whom a weapon aims at (U14), read by `sim/systems/combat.ts#aim` through
 * an exhaustive switch:
 *   nearest   the closest body
 *   densest   the body with the most others within its blast (Mortar)
 *   toughest  a boss or an elite first, else the most HP in range; held
 *             until it falls or leaves range (Sunlance)
 *   line      the line from the tower through the most bodies (Gilded Rail)
 *   standoff  bodies that hold off and act from range first: a verb with a
 *             `standoff` (Drones); else the nearest
 */
export type Targeting = 'nearest' | 'densest' | 'toughest' | 'line' | 'standoff';

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
  /** Seconds a laid rune lasts before it fades (Rune Traps). */
  readonly fuse: number;
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
  /** Whom it aims at (U14). */
  readonly targeting: Targeting;
  /** What it is strong against (§11.2): the draft scorer leans toward it where these walk. */
  readonly counters: readonly EnemyId[];
  /** What blunts it: the scorer counts these against it where they walk. */
  readonly weakAgainst?: readonly EnemyId[];
  /** Its shots hit this many times harder on a body inside a third of range (Scattershot's point-blank, S5). */
  readonly pointBlank?: number;
  /** Level 1. */
  readonly base: WeaponParams;
  /** Levels 2–5, in order. */
  readonly steps: readonly WeaponStep[];
}

export type PassiveId =
  | 'power' | 'haste' | 'precision' | 'fortify' | 'mending' | 'insight'
  | 'area' | 'reach' | 'focus' | 'bulwark' | 'velocity' | 'greed'
  // Act 2's two (§9, §11.8).
  | 'zeal' | 'conduit';

/** A passive (§4.4, §11.3). Each level adds `perLevel` again. */
export interface PassiveDef extends ContentEntry {
  readonly id: PassiveId;
  readonly perLevel: readonly StatMod[];
  /** Added once on reaching each of these levels (Velocity's pierce at 3 and 5, S5). */
  readonly atLevels?: readonly { readonly level: number; readonly mods: readonly StatMod[] }[];
  /** Added once more for every wave reached while it is held, `level` times over (Greed's hoard, S5). */
  readonly perWave?: readonly StatMod[];
  /**
   * The pool grows with unlocks (§4.5): a passive with this joins the draft
   * once that weapon is in it. Without it, the passive is there from the start.
   */
  readonly joinsWith?: WeaponId;
  /** It joins only through a Constellation node's `unlockCard` (§9), never on its own. */
  readonly starred?: boolean;
}

export type EvolutionId =
  | 'seeker-swarm' | 'dragonbreath' | 'storm-crown' | 'absolute-zero'
  | 'meteorfall' | 'judgment' | 'halo' | 'hive'
  | 'crescent-storm' | 'bulwark-runes' | 'lifebloom' | 'midas-lance';

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
 * (`sim/systems/waves.ts#regionMods`); P7's rules extend it.
 */
export type RegionRule =
  | { readonly kind: 'stat'; readonly mod: StatMod }
  /** Brittle: blasts, pulses, burns, shatters and the ultimate hit this much harder. */
  | { readonly kind: 'areaDamage'; readonly mult: number }
  /**
   * Cinders: a kill leaves burning ground `radius` wide for `seconds`, setting
   * alight what walks in for `burn` × the slain body's Max HP a second.
   */
  | { readonly kind: 'cinders'; readonly radius: number; readonly seconds: number; readonly burn: number }
  /** Echoes: `chance` of a kill rises once as a shade with `hp` of its Max HP, paying `reward` of its worth. */
  | { readonly kind: 'echoes'; readonly chance: number; readonly hp: number; readonly reward: number }
  /** Blight: every wave brings an elite. */
  | { readonly kind: 'blight' };

/**
 * What the Blight Surge pact does in a region (§9), once per rank: the
 * region's own rule made harsher, or, where the rule favours the tower or
 * there is none, a toll on the tower. A closed union; `sim/run.ts` reads it.
 */
export type SurgeEffect =
  /** The rule's numbers, (1 + rank) times over: Mist, Echoes, the Blight. */
  | { readonly kind: 'rule' }
  /** A tower stat, once per rank. */
  | { readonly kind: 'stat'; readonly mod: StatMod };

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
  /** What the Blight Surge pact does here, per rank (§9), in one line. */
  readonly surge: { readonly text: string; readonly effect: SurgeEffect };
  /** Set on a floor of the Abyss (§9): a region's template, sized for that depth. */
  readonly abyss?: { readonly floor: number };
  /** Wave 20 (§4.2). */
  readonly boss: BossId;
  /** The ground's tint (§10.5), mixed into the lit field. Null keeps the plain stone. */
  readonly tint: string | null;
  /**
   * Elites (§4.3): one on wave `from`, then every `every` waves. Each wears
   * one of `auras`; an empty list means plain elites (Region 1).
   */
  readonly elites: {
    readonly from: number;
    readonly every: number;
    readonly auras: readonly AuraId[];
    /** The types an elite may be, when not the region's own (Blight Heart: earlier regions', crowned). */
    readonly types?: readonly EnemyId[];
  };
}

export type RelicId =
  | 'gatekeepers-seal' | 'tallow-candle' | 'cracked-lens' | 'hunters-tally'
  | 'mothers-tear' | 'bog-lantern' | 'mire-lily' | 'stillwater-charm'
  | 'prism-heart' | 'frost-brand' | 'mirror-shard' | 'hourglass-sand'
  | 'forgeheart-core' | 'ember-ward' | 'blast-shield' | 'spyglass'
  | 'hollow-crown' | 'soul-jar' | 'warding-salt' | 'last-light'
  | 'heart-of-light' | 'blight-thorn' | 'pale-lantern' | 'starseed'
  // Act 2 (§9): four sets of three, lit in the Constellations, found in the Abyss.
  | 'moonstone' | 'rune-chalk' | 'husk-splinter'
  | 'tether-knot' | 'gilt-edge' | 'anchor-stone'
  | 'ward-breaker' | 'maw-tooth' | 'abyssal-pearl'
  | 'executioners-coin' | 'phoenix-feather' | 'whetstone';

/**
 * Where a relic drops (§5.3): its boss's first kill, that region's elites,
 * or the Abyss's elites once its set is lit in the Constellations (§9).
 */
export type RelicSource =
  | { readonly kind: 'boss'; readonly boss: BossId }
  | { readonly kind: 'elite'; readonly region: number }
  | { readonly kind: 'abyss'; readonly set: number };

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
 * A relic set (N6): a region's three elite relics, worn together, give a
 * bonus that leans on its verb. `effects` apply at rank I, `perRank` once
 * more for each rank past it; duplicates past a relic's rank III are the
 * set's progress, and progress is its rank.
 */
export interface RelicSetDef extends ContentEntry {
  readonly region: number;
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
  | { readonly kind: 'evolve' }
  /** Find n different recipes. */
  | { readonly kind: 'recipes'; readonly n: number }
  /** Own n frames. */
  | { readonly kind: 'frames'; readonly n: number }
  /** Bank n shards from one run. */
  | { readonly kind: 'runShards'; readonly n: number }
  /** Own every notable of a Forge branch. */
  | { readonly kind: 'branch'; readonly branch: BranchId }
  /** Defeat a boss without casting the ultimate. */
  | { readonly kind: 'bossNoUlt' }
  /** Defeat a boss carrying `weapons` weapons, all at their last level, and no passives. */
  | { readonly kind: 'bareArsenal'; readonly weapons: number }
  // Act 2 (§9).
  /** Clear any region at heat n or more. */
  | { readonly kind: 'heat'; readonly heat: number }
  /** Clear a region at heat n or more in every region. */
  | { readonly kind: 'heatAll'; readonly heat: number }
  /** Clear floor n of the Abyss. */
  | { readonly kind: 'abyss'; readonly floor: number }
  /** Own n Constellation nodes. */
  | { readonly kind: 'stars'; readonly n: number }
  /** Own n mastery levels in all. */
  | { readonly kind: 'mastery'; readonly levels: number };

/** A feat (§5.4): one finite list, each paying shards once. */
export interface FeatDef extends ContentEntry {
  readonly goal: FeatGoal;
  readonly reward: number;
  /**
   * A secret feat (§5.4) shows as "???" with this riddle until earned. Its
   * `text` is what it asked, revealed once done.
   */
  readonly riddle?: string;
  /** Surfaces only once this boss has fallen (§7.1: secret feats surface in Region 5; Act 2's after the Blight). */
  readonly after?: BossId;
}

export type PactId = 'hordes' | 'vigour' | 'haste' | 'elites' | 'frailty' | 'scarcity' | 'tyranny' | 'surge';

/**
 * What one rank of a pact does (§9). A closed union; the run's numbers come
 * from `sim/pacts.ts`, its one consumer.
 */
export type PactEffect =
  /** Waves bring `pct` more bodies. */
  | { readonly kind: 'count'; readonly pct: number }
  /** Every body has `mult` times the HP, compounding. */
  | { readonly kind: 'hp'; readonly mult: number }
  /** Every body moves `pct` faster. */
  | { readonly kind: 'speed'; readonly pct: number }
  /** Every elite wave brings `n` more elites. */
  | { readonly kind: 'elites'; readonly n: number }
  /** A toll on the tower's stats. */
  | { readonly kind: 'stat'; readonly mod: StatMod }
  /** Cards per draft. */
  | { readonly kind: 'choices'; readonly n: number }
  /** The boss rises once more, with `hp` more HP. */
  | { readonly kind: 'tyranny'; readonly hp: number }
  /** The region's surge (`RegionDef.surge`). */
  | { readonly kind: 'surge' };

/** A pact (§9): difficulty the player opts into, rank by rank, for heat. */
export interface PactDef extends ContentEntry {
  readonly id: PactId;
  readonly ranks: number;
  readonly effect: PactEffect;
}

/**
 * A hub-tower trim (N2, N5): a decoration a Trial pays, worn by the tower in
 * the hub and in every run. A closed union; `render/painters/tower.ts` draws each.
 */
export type TrimId = 'ivy' | 'pennants' | 'runes' | 'gilt' | 'embers' | 'starlit';

/**
 * A Trial's constraint (N5), applied to the run's config. A closed union;
 * `meta/runConfig.ts` is its one consumer.
 */
export type TrialRule =
  /** The run is this frame's. */
  | { readonly kind: 'frame'; readonly frame: FrameId }
  /** Only these weapons: the first is mounted at the start, the rest are all the draft may offer. */
  | { readonly kind: 'weapons'; readonly ids: readonly WeaponId[] }
  /** Slots, whatever the Forge gave. */
  | { readonly kind: 'slots'; readonly weapon?: number; readonly passive?: number }
  /** An omen (§9's pacts, in Act 1): this pact at this rank. It pays no heat. */
  | { readonly kind: 'omen'; readonly pact: PactId; readonly rank: number };

/** What a Trial pays, once (N5). A closed union; `meta/trials.ts` is its one consumer. */
export type TrialReward =
  /** One rank of a relic (a new one at rank I). */
  | { readonly kind: 'relic'; readonly relic: RelicId }
  /** A trim for the tower. */
  | { readonly kind: 'trim'; readonly trim: TrimId; readonly name: string }
  /** A notable only a Trial earns: its effects apply to every run, like a Forge node's. */
  | { readonly kind: 'notable'; readonly name: string; readonly text: string; readonly effects: readonly Effect[] };

/**
 * A Trial (N5): an authored run in a region, opened by its boss. Won by
 * felling that boss under the trial's rules; it pays its reward once.
 */
export interface TrialDef extends ContentEntry {
  readonly region: number;
  readonly rules: readonly TrialRule[];
  readonly reward: TrialReward;
}
