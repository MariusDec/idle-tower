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
  // Mastery capstones (plans/mastery-capstones.md): the count is the rank, 0–3.
  | 'might-capstone'
  | 'bulwark-capstone'
  | 'arsenal-capstone'
  | 'engineering-capstone'
  | 'head-start'
  | 'overkill'
  | 'executioner'
  | 'second-wind'
  /** Glass Crown's curse (plans/late-game/03): the tower never rises again. */
  | 'unrisen'
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
  // The Wake's relics (plans/late-game/12 §8.9).
  /** Carillon's Clapper: every few seconds a toll stuns every enemy in range. */
  | 'clapper'
  /** Tuning Fork: stunned and frozen bodies take more. */
  | 'tuning-fork'
  /** Metronome: more damage for every stretch the tower goes unhurt. */
  | 'metronome'
  /** Astrolabe Ring: Glaives and drones circle faster. */
  | 'astrolabe'
  /** Star Chart: homing bolts turn more sharply. */
  | 'star-chart'
  /** Tidal Lock: bodies within half the range move slower. */
  | 'tidal-lock'
  /** Comet Tail: Glaive kills leave burning ground. */
  | 'comet-tail'
  /** Leviathan Scale: knockback pushes farther, and heavy bodies as if light. */
  | 'leviathan'
  /** Skate Blade: a body knocked back takes more for a while. */
  | 'skate-blade'
  /** Floe Shard: a body slain while slowed chills those near it. */
  | 'floe-shard'
  /** Colossus Heart: more damage against bodies above half their health. */
  | 'colossus'
  /** Tick Bite: a crit marks its body, and marked bodies take more. */
  | 'tick-bite'
  /** Herd Bell: large bodies pay more shards. */
  | 'herd-bell'
  /** Giant's Toe: Sunlance keeps part of its heat-up on a new target. */
  | 'giants-toe'
  /** Thunderhead Core: lightning strikes the toughest non-boss body on a clock. */
  | 'thunder-core'
  /** Lightning Rod: Chain Lightning leaps to more bodies (the rank is the count). */
  | 'extra-leap'
  /** Grounding Wire: the tower takes less from lightning and hostile shots. */
  | 'grounding'
  /** Static Charge: crits charge the ultimate. */
  | 'static'
  // Secrets (plans/late-game/05): each switched on by its find, never bought.
  /** In the Glass Wastes, a frozen Shardling bursts at its kin. */
  | 'glassfrost'
  /** A Mortar shell landing on a frozen body shatters it. */
  | 'shatterfall'
  /** In the Drowned Mire, Sunlance reaches farther. */
  | 'beacon-road'
  /** In the Ember Rift, pellets spread a burning body's fire. */
  | 'bellows'
  /** Lens Shard (a secret relic): beams and chains hit bosses harder. */
  | 'lens-shard'
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
  | { readonly kind: 'starlight'; readonly pct: number }
  /** A fusion (N9) may be drafted: its two evolved weapons become one. */
  | { readonly kind: 'fusion'; readonly id: FusionId };

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
  /** Levels it may be bought to; Infinity for Fortune's mastery, 3 for a capstone. */
  readonly maxLevel: number;
  /** Level 1's price; each further level costs `growth` (or the web's default) more. */
  readonly cost: number;
  /** Cost growth per level, when not the web's default (a mastery's ×1.2, §9; a two-level late minor's ×3, S1). */
  readonly growth?: number;
  readonly effects: readonly Effect[];
  /** A capstone's rules, one a rank (plans/mastery-capstones.md): the Forge shows the next. */
  readonly ranks?: readonly string[];
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
  /** Its Final Form (plans/late-game/07): ≤ 3 words, and a line of ≤ 15. */
  readonly form: { readonly name: string; readonly text: string };
}

export type EnemyId =
  | 'grunt' | 'runner' | 'brute'
  | 'splitter' | 'spitter' | 'mender'
  | 'shieldbearer' | 'burrower' | 'shardling'
  | 'bomber' | 'blinker' | 'siege-engine'
  | 'phantom' | 'leech' | 'summoner' | 'imp'
  | 'harbinger' | 'chorus'
  // The Abyss's own (§9).
  | 'husk' | 'ram' | 'wardstone' | 'maw'
  // The strata's (plans/late-game/08): the Gate's Lurker, the Inversion's Tidecaller.
  | 'lurker' | 'tidecaller'
  // The Wake's (plans/late-game/12 §2): three natives per region.
  | 'ringer' | 'sleepwalker' | 'straggler'
  | 'satellite' | 'comet' | 'moon'
  | 'skater' | 'floe' | 'sledge'
  | 'titan' | 'tick' | 'herdkeeper'
  | 'groundling' | 'conductor' | 'squallcaller';

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
  | { readonly kind: 'devour'; readonly radius: number; readonly heal: number; readonly grow: number; readonly feeds: number }
  /**
   * Below `below` of its Max HP it turns and walks back out at `pace` times
   * its speed; fully dark, it heals whole and comes back, once (the Lurker).
   */
  | { readonly kind: 'retreat'; readonly below: number; readonly pace: number }
  /** Stops at `standoff`; every `interval` s, turns round each walking body within `radius` (the Tidecaller). */
  | { readonly kind: 'tide'; readonly standoff: number; readonly interval: number; readonly radius: number }
  // The Wake's (plans/late-game/12 §3.1).
  /** Each alive multiplies the toll's interval by `hasten` (the Ringer). */
  | { readonly kind: 'ring'; readonly hasten: number }
  /** Ignores the Toll and walks at `pace` × its speed (the Sleepwalker). */
  | { readonly kind: 'sleepwalk'; readonly pace: number }
  /** Its own toll, half an interval after the bell's (the Straggler). */
  | { readonly kind: 'offbeat' }
  /** Ignores the Orbit (the Comet). */
  | { readonly kind: 'streak' }
  /** Circles at `radius` for `sweep` radians first (the Moon). */
  | { readonly kind: 'lane'; readonly radius: number; readonly sweep: number }
  /** A body slid into it takes `shatter` × the impact; it never slides (the Floe). */
  | { readonly kind: 'slab'; readonly shatter: number }
  /** Latches the body within `reach` ahead and pushes it as one (the Sledge). */
  | { readonly kind: 'sledge'; readonly reach: number }
  /** Swallows bodies under `smaller` × its radius that it overlaps (the Titan). */
  | { readonly kind: 'trample'; readonly smaller: number }
  /** Rides a host within `reach`, untargetable, until the host falls (the Tick). */
  | { readonly kind: 'ride'; readonly reach: number }
  /** A walking ward: every other body within `radius` takes only `shield` of its damage (the Herdkeeper). */
  | { readonly kind: 'herd'; readonly radius: number; readonly shield: number }
  /** The storm never strikes it (the Groundling). */
  | { readonly kind: 'grounded' }
  /** Stops at `standoff`; while it lives, the storm's strikes hit the tower (the Conductor). */
  | { readonly kind: 'conduct'; readonly standoff: number }
  /** Stops at `standoff`, lobs a shot every `interval` s at `shotSpeed`; each alive quickens the storm by `hasten` (the Squallcaller). */
  | { readonly kind: 'squall'; readonly standoff: number; readonly interval: number; readonly shotSpeed: number; readonly hasten: number };

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
  | 'fog' | 'mirrored' | 'molten' | 'wraith' | 'hungering'
  // The Wake's own (plans/late-game/12 §6).
  | 'resonant' | 'tidal' | 'anchored' | 'towering' | 'charged';

export interface AuraDef extends ContentEntry {
  readonly id: AuraId;
  /** How far it reaches, world units; 0 for an aura that acts only on death. Its strength is in `BALANCE.elites`. */
  readonly radius: number;
}

export type BossId = 'gatekeeper' | 'bog-mother' | 'prism' | 'forgeheart' | 'hollow-king' | 'blight'
  // The Abyss's own (§9): its strata's guardians (plans/late-game/08).
  | 'deepwarden' | 'hunger' | 'undertow'
  // The Wake's (plans/late-game/12 §2).
  | 'carillon' | 'astrolabe' | 'leviathan' | 'colossus' | 'thunderhead';

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
  | { readonly kind: 'court'; readonly shades: number; readonly every: number; readonly share: number }
  /** While its phase lasts, a stratum's rule holds (plans/late-game/08 §4.5): on its summons, and on the field. */
  | { readonly kind: 'rule'; readonly rule: StratumRule }
  // The Wake's (plans/late-game/12 §7.1).
  /** Always on: each toll rolls a ring from the boss at `speed`, for `damage` × the wave's contact damage. */
  | { readonly kind: 'peal'; readonly speed: number; readonly damage: number }
  /** Every `every` s, the toll's interval × `factor`. */
  | { readonly kind: 'quicken'; readonly every: number; readonly factor: number }
  /** Every `every` s, the Orbit's spin flips. */
  | { readonly kind: 'reverse'; readonly every: number }
  /** Cracks `count` stationary Floes loose (in a ring, with `ring`). `every` 0: once, on entering the phase. */
  | { readonly kind: 'floes'; readonly count: number; readonly every: number; readonly ring: boolean }
  /** Always on: a weak point `arc` wide turns at `spin` rad/s; hits while it faces the tower land × `mult`. */
  | { readonly kind: 'weakpoint'; readonly arc: number; readonly spin: number; readonly mult: number }
  /** Every `every` s, eats a Titan within `radius` and heals `heal` × its HP. */
  | { readonly kind: 'feast'; readonly every: number; readonly radius: number; readonly heal: number }
  /** Winds up for `windup` s, then a strike on the tower for `damage` × the wave's contact damage. */
  | { readonly kind: 'bolt'; readonly every: number; readonly windup: number; readonly damage: number }
  /** Always on: the storm's clock × `pace`, and each strike forks to `forks` more. */
  | { readonly kind: 'tempest'; readonly pace: number; readonly forks: number };

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
  /** Rad/s the plates circle the boss at, evenly spaced, in place of a fan toward the tower (plans/late-game/12 §7.2). */
  readonly orbit?: number;
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
  /** An Abyss boss (§9): no region of its own; it guards a stratum's last floor. */
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

/**
 * An anomaly (plans/late-game/04): a rare card that breaks one weapon's rule
 * for the rest of the run. Never suggested, never taken for the player. It
 * forbids the weapon's evolution, so its fusions too. What each one does is
 * `sim/systems/combat.ts`'s; its numbers, `BALANCE.anomalies`.
 */
export type AnomalyId = 'whiteout' | 'gyre' | 'lighthouse' | 'creeping-barrage';

export interface AnomalyDef extends ContentEntry {
  readonly id: AnomalyId;
  readonly weapon: WeaponId;
  /** The rule it breaks, for the long-press details: "pulses round the tower → a moving storm". */
  readonly rule: string;
  /** Level lines that would be false for it (levels 2–5, in order); null keeps the weapon's own. */
  readonly steps?: readonly (string | null)[];
}

export type FusionId = 'blizzard' | 'firestorm' | 'dawnstar' | 'sky-hive';

/**
 * A fusion (N9, Act 2): two evolved weapons, once a Constellation star has
 * lit it, become one card. Both keep firing from one mount, a slot is freed,
 * both hit harder, and they work together in one way of their own. What
 * that is is `sim/systems/combat.ts`'s; its numbers, `BALANCE.fusions`.
 */
export interface FusionDef extends ContentEntry {
  readonly id: FusionId;
  /** The two weapons, each evolved. The first is the mount the pair shares. */
  readonly weapons: readonly [WeaponId, WeaponId];
  /** The Recipe Book's nudge once both halves have been evolved (§5.3). */
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
  | { readonly kind: 'blight' }
  // The Wake's (plans/late-game/12 §3.1): read where they act, as Cinders and Echoes are.
  /** Toll: bodies move only in the `window` s after each toll, every `every` s. */
  | { readonly kind: 'toll'; readonly every: number; readonly window: number }
  /** Orbit: a body's step turns sideways by `tangent` of its inward part. */
  | { readonly kind: 'orbit'; readonly tangent: number }
  /** Glide: a push becomes a slide of `carry` × the push, decaying at `friction` per s; touching bodies take `impact`. */
  | { readonly kind: 'glide'; readonly carry: number; readonly friction: number; readonly impact: number }
  /** Giants: `count` × the bodies, each `size` × the radius, `hp` × the HP and `reward` × the pay. */
  | { readonly kind: 'giants'; readonly count: number; readonly size: number; readonly hp: number; readonly reward: number }
  /** Storm: every `every` s a strike takes `damage` of the toughest body's Max HP; with a Conductor up, `wall` × the wave's hit lands on the tower. */
  | { readonly kind: 'storm'; readonly every: number; readonly damage: number; readonly wall: number };

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
  /** 1–6 Act 1's, 9–13 the Wake's; the Map's order comes from `after` (plans/late-game/12 §8.1). */
  readonly index: number;
  /** 1: Act 1's six. 2: the Wake (plans/late-game/12). The Abyss and Boss Rush build their own and set 1. */
  readonly act: 1 | 2;
  /** The region whose boss's first fall opens this one; null for the first (plans/late-game/12 §8.1). */
  readonly after: number | null;
  /** The Map's silhouette line before it opens (≤ 15 words); Act 1's silhouettes use their boss instead. */
  readonly veil?: string;
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
  /** Set on a floor of the Abyss (§9, plans/late-game/08): its stratum, its curve's start, its Keeper, rules and gates. */
  readonly abyss?: AbyssFloor;
  /** Set on a stage of Boss Rush (N8): a boss's home region, sized like an Abyss guardian. */
  readonly rush?: { readonly stage: number };
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
  | 'executioners-coin' | 'phoenix-feather' | 'whetstone'
  // Cursed relics (plans/late-game/03): a boon and a curse, worn in the Abyss only.
  | 'glass-crown'
  // Secrets (plans/late-game/05): a boss's other form drops it, and nothing lists it until owned.
  | 'lens-shard'
  // The Wake (plans/late-game/12 §8.9): four per region, a boss's and three elites'.
  | 'carillons-clapper' | 'tuning-fork' | 'muffled-bell' | 'metronome'
  | 'astrolabe-ring' | 'star-chart' | 'tidal-lock' | 'comet-tail'
  | 'leviathan-scale' | 'skate-blade' | 'floe-shard' | 'anchor-chain'
  | 'colossus-heart' | 'tick-bite' | 'herd-bell' | 'giants-toe'
  | 'thunderhead-core' | 'lightning-rod' | 'grounding-wire' | 'static-charge';

/**
 * The Abyss's strata (plans/late-game/08): six floors each, each with its
 * own rule, natives and guardian. Cursed relics name where they drop.
 */
export type StratumId = 'gate' | 'inversion' | 'narrowing' | 'lightless' | 'root';

/**
 * A stratum's rule (plans/late-game/08 §4.2). A closed union with one switch,
 * `sim/strata.ts#ruleLoad`; the systems read the load it folds.
 */
export type StratumRule =
  /** Waves come only through the floor's gates; `count` throws that many open, evenly round the rim. */
  | { readonly kind: 'gates'; readonly count?: number }
  /**
   * `share` of a wave's walking bodies start at the wall and walk out; one
   * that reaches the dark escapes, draining `drain` of the ultimate.
   */
  | { readonly kind: 'inversion'; readonly share: number; readonly drain: number };

/** The colours a stratum's rim may wear: the canvas's semantic ones, so the safe palette swaps them. */
export type RimColor = 'gold' | 'ember' | 'mana' | 'arcane' | 'blood' | 'frost' | 'nature' | 'critical';

/** A floor of the Abyss as the sim runs it (`RegionDef.abyss`). */
export interface AbyssFloor {
  readonly floor: number;
  /** Its stratum; null past the authored strata (today's cycle, behind the shim). */
  readonly stratum: StratumId | null;
  /** The global wave its HP curve starts at: wave n is `hpBase × hpGrowth^(n − from)`. */
  readonly from: number;
  /** The Champion that ends floors 1–5 of a stratum; null where a boss ends it. */
  readonly keeper: EnemyId | null;
  readonly rules: readonly StratumRule[];
  /** Its gates' angles (0 right, π/2 down) and their turn a wave; null without the Gates. */
  readonly gates: { readonly angles: readonly number[]; readonly turn: number } | null;
}

/**
 * Where a relic drops (§5.3): its boss's first kill, that region's elites,
 * or the Abyss's elites once its set is lit in the Constellations (§9).
 */
export type RelicSource =
  | { readonly kind: 'boss'; readonly boss: BossId }
  | { readonly kind: 'elite'; readonly region: number }
  | { readonly kind: 'abyss'; readonly set: number }
  /** A cursed relic (plans/late-game/03 §3.1): a stratum's elites, or its guardian (`boss`). */
  | { readonly kind: 'cursed'; readonly stratum: StratumId | 'below'; readonly boss: BossId | null }
  /** A secret's (plans/late-game/05): a boss's other form, felled. No silhouette until owned. */
  | { readonly kind: 'secret' };

/**
 * A cursed relic's curse (plans/late-game/03): its line, drawn after a ☾,
 * and what it does. Applied once, whatever the rank; it never lifts.
 */
export interface CurseDef {
  readonly text: string;
  readonly effects: readonly Effect[];
}

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
  /** A cursed relic's curse (plans/late-game/03): present exactly when `source.kind` is 'cursed'. */
  readonly curse?: CurseDef;
  /** The weapon a cursed relic leans on, if one (plans/late-game/03 §4). */
  readonly leans?: WeaponId;
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
  /** Reach any frame's Final Form (plans/late-game/07). */
  | { readonly kind: 'finalForm' }
  /** Reach n frames' Final Forms. */
  | { readonly kind: 'forms'; readonly n: number }
  /** Take n anomalies in all (plans/late-game/04): only a watching player can. */
  | { readonly kind: 'anomalies'; readonly n: number }
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
  /** Open a rift of this rarity (plans/late-game/02). */
  | { readonly kind: 'riftOpened'; readonly rarity: 'legendary' }
  /** Take n rifts' offers, in all. */
  | { readonly kind: 'riftsTaken'; readonly n: number }
  // Act 2 (§9).
  /** Clear any region at heat n or more. */
  | { readonly kind: 'heat'; readonly heat: number }
  /** Clear a region at heat n or more in every region. */
  | { readonly kind: 'heatAll'; readonly heat: number }
  /** Clear floor n of the Abyss. */
  | { readonly kind: 'abyss'; readonly floor: number }
  /** Own n Constellation nodes. */
  | { readonly kind: 'stars'; readonly n: number }
  /** Own n capstone ranks in all (Fortune's levels don't count). */
  | { readonly kind: 'capstones'; readonly ranks: number };

/** A feat (§5.4): one finite list, each paying shards once. */
export interface FeatDef extends ContentEntry {
  readonly goal: FeatGoal;
  /** Shards, paid when claimed… */
  readonly reward: number;
  /** …and Starlight on top (S7.2): Act 2's feats only. */
  readonly starlight?: number;
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
export type TrimId = 'ivy' | 'pennants' | 'runes' | 'gilt' | 'embers' | 'starlit'
  // Secrets' (plans/late-game/05): found, never listed before.
  | 'rime' | 'kintsugi' | 'wayward'
  // The Contract board's milestones (plans/late-game/10 §4.4).
  | 'seals' | 'lanterns'
  // The Daily Omen's (plans/late-game/11 §5): seven scored Omens, and the first band III.
  | 'veil' | 'starfall'
  // The Wake's Trials (plans/late-game/12 §8.8).
  | 'bells' | 'orrery' | 'icicles' | 'ribs' | 'rods';

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

/** The Contract board's three slots (plans/late-game/10 §3), easiest first. */
export type ContractSlot = 'quick' | 'steady' | 'hard';

/**
 * What a contract asks for (plans/late-game/10 §3): where, and how far. A
 * closed union; `meta/contracts.ts#contractMet` is its exhaustive consumer.
 */
export type ContractTarget =
  /** Fell a region's boss (already felled once). */
  | { readonly kind: 'boss'; readonly region: number }
  /** Reach wave `wave` (≤ 20) in a region. */
  | { readonly kind: 'wave'; readonly region: number; readonly wave: number }
  /** Hold a region to wave 20 + `k`. */
  | { readonly kind: 'overtime'; readonly region: number; readonly k: number }
  /** Any run in a region: the tally condition beside it is the ask. */
  | { readonly kind: 'run'; readonly region: number }
  /** Clear Abyss floor `floor`. */
  | { readonly kind: 'floor'; readonly floor: number }
  /** Fell an Abyss guardian again. */
  | { readonly kind: 'guardian'; readonly boss: BossId }
  /** Clear `stages` Boss Rush stages; with `within`, all of them under that many seconds. */
  | { readonly kind: 'rush'; readonly stages: number; readonly within: number | null };

/**
 * A contract's modifier (plans/late-game/10 §3): a condition checked on the
 * finished run, or a Trial's rule the run's config enforces.
 */
export type ContractMod =
  | { readonly kind: 'heat'; readonly heat: number }
  | { readonly kind: 'within'; readonly seconds: number }
  | { readonly kind: 'healthy'; readonly pct: number }
  | { readonly kind: 'noUlt' }
  | { readonly kind: 'untouched'; readonly wave: number }
  | { readonly kind: 'carry'; readonly weapon: WeaponId }
  | { readonly kind: 'evolve'; readonly weapon: WeaponId }
  | { readonly kind: 'fuse'; readonly fusion: FusionId }
  /** Slay `n` of an enemy type, or `n` elites, in the one run. */
  | { readonly kind: 'slay'; readonly enemy: EnemyId | 'elite'; readonly n: number }
  /** One of a Trial's rules (frame, weapons, slots, omen). */
  | { readonly kind: 'rule'; readonly rule: TrialRule };

/** One card on the board, stored concretely on the profile so a reload shows the same three. */
export interface ContractSpec {
  readonly id: string;
  readonly slot: ContractSlot;
  readonly target: ContractTarget;
  readonly mods: readonly ContractMod[];
  /** The Hard slot's rider (§4.4): a rank of this relic on top of the pay; fixed to the slot until done. */
  readonly rider: RelicId | null;
}

// ── The Daily Omen (plans/late-game/11) ───────────────────────────────

/** Where a day's modifier sits (§4.1): one boon, one twist, then banes until the points fit. */
export type OmenSlot = 'boon' | 'twist' | 'bane';

/**
 * One of an Omen modifier's rules (§6): a Trial's, or one only the Omen
 * sets. A closed union; `meta/omen.ts#omenConfig` is its one consumer.
 */
export type OmenRule =
  | TrialRule
  /** A keystone is set, owned or not. */
  | { readonly kind: 'keystone'; readonly id: string }
  /** A fusion is lit: the draft may offer it. */
  | { readonly kind: 'fusion'; readonly id: FusionId }
  /** A relic rides with the tower at this rank (a cursed one with its curse). */
  | { readonly kind: 'relic'; readonly relic: RelicId; readonly rank: number }
  /** The tower starts this many levels higher, the drafts banked. */
  | { readonly kind: 'level'; readonly n: number }
  /** Rifts (plans/late-game/02) open this many times as often. */
  | { readonly kind: 'rifts'; readonly rate: number }
  /** An anomaly (plans/late-game/04) is dealt with this chance. */
  | { readonly kind: 'anomaly'; readonly chance: number };

/** A Daily Omen modifier (§5): its line is ≤ 15 words (R4); a bane is a pact, ranked by the day. */
export interface OmenModDef extends ContentEntry {
  readonly slot: OmenSlot;
  /** A boon's or twist's rules; a bane's is its pact (`pact`), at the day's rank. */
  readonly rules: readonly OmenRule[];
  /** The pact a bane ranks up. */
  readonly pact?: PactId;
  /** A bane's highest rank in an Omen (under `BALANCE.omen.maxRank`). */
  readonly maxRank?: number;
  /** Difficulty: a boon's are negative; a bane's is per rank. */
  readonly points: number;
  /** How often it is drawn within its slot. */
  readonly weight: number;
  /** Modifiers it never shares a day with. */
  readonly clashes?: readonly string[];
}

/** A rift (plans/late-game/02): a tear that opens mid-wave, for a watching player to tap. */
export type RiftId =
  | 'first-tear'
  | 'wager'
  | 'glimmer-cache'
  | 'stillness'
  | 'old-coin'
  | 'ashfall'
  | 'loaded-dice'
  | 'drowned-bell'
  | 'marsh-wisp'
  | 'blood-price'
  | 'hungry-dark'
  | 'cracked-mirror'
  | 'shatterglass'
  | 'split-sky'
  | 'open-flame'
  | 'cinder-oath'
  | 'whispering-shade'
  | 'blight-bloom'
  | 'heart-vein'
  // A region's held beat (R2 §2–3): one each, Regions 2–6.
  | 'sunken-shrine'
  | 'glass-oracle'
  | 'ashen-anvil'
  | 'hollow-choir'
  | 'last-lantern';

/** How long a rift's effect lasts: the rest of this wave and n more, until the region's boss falls, or the run. */
export type RiftSpan = { readonly waves: number } | 'boss' | 'run';

/**
 * What a rift's choice does (plans/late-game/02 §3). A closed union;
 * `sim/systems/rifts.ts#applyRiftEffect` is its one consumer.
 */
export type RiftEffect =
  /** `waves` × this wave's wave pay; with `atWave`, paid on reaching that wave. */
  | { readonly kind: 'shards'; readonly waves: number; readonly atWave?: number }
  /** A share of Max HP lost (never below `BALANCE.rifts.hurtFloor`) or mended. */
  | { readonly kind: 'hurt' | 'heal'; readonly fraction: number }
  /** A stat contribution for a span (a true `mult`). */
  | { readonly kind: 'stat'; readonly mod: StatMod; readonly span: RiftSpan }
  /** The next `waves` waves bring `count` times the bodies. */
  | { readonly kind: 'horde'; readonly count: number; readonly waves: number }
  /** Kills (or only elites) pay `mult` times for a span. */
  | { readonly kind: 'bounty'; readonly mult: number; readonly span: RiftSpan; readonly on?: 'elites' }
  /** The next `n` bodies are crowned, or with `perWave` n more each wave of the span; a Champion optionally. */
  | { readonly kind: 'elites'; readonly n: number; readonly perWave?: boolean; readonly champion?: boolean; readonly span?: RiftSpan }
  /** `n` drafts banked; `forged`: the next offers the evolution of any carried weapon at `forgedFrom`. */
  | { readonly kind: 'draft'; readonly n: number; readonly hand?: 'forged' }
  /** ±1 level on unevolved weapons. */
  | { readonly kind: 'levels'; readonly target: 'all' | 'others' | 'weakest' | 'strongest'; readonly delta: 1 | -1 }
  | { readonly kind: 'charges'; readonly rerolls?: number; readonly banishes?: number; readonly revives?: number }
  /** The ultimate's charge, set. */
  | { readonly kind: 'ult'; readonly charge: number }
  /** Every body on the field stops for `seconds`. */
  | { readonly kind: 'stun'; readonly seconds: number }
  /** The region's boss arrives with `hp` times its HP. */
  | { readonly kind: 'boss'; readonly hp: number };

export interface RiftChoice {
  /** ≤ 15 words (R4). */
  readonly text: string;
  /** Costs first, then rewards. */
  readonly effects: readonly RiftEffect[];
}

export type RiftRarity = 'common' | 'rare' | 'legendary';

/** Where a rift may open. No `regions`, `from`, `act2` or `abyss`: anywhere. */
export interface RiftWhere {
  /** Only in these regions (by index). */
  readonly regions?: readonly number[];
  /** Only from this region index on (the Abyss and Act 2 count as past every region). */
  readonly from?: number;
  /** Only once Act 2 is open. */
  readonly act2?: boolean;
  /** Only in the Abyss. */
  readonly abyss?: boolean;
  /** Only with Alchemy owned, or a relic slot open. */
  readonly needs?: 'alchemy' | 'relics';
  /** Never rolled: the First Tear is placed, not drawn. */
  readonly placed?: boolean;
  /**
   * A region's beat (R2 §2–3): held back until that region's run number
   * `held`, placed on it (and each run after until met), then rolled like
   * any other. Names exactly one region.
   */
  readonly held?: number;
}

/** A rift (plans/late-game/02 §4). `text` is its whisper, ≤ 8 words. */
export interface RiftDef extends ContentEntry {
  readonly id: RiftId;
  readonly rarity: RiftRarity;
  readonly where: RiftWhere;
  /** One or two; "Leave it" is always there and is not one of them. */
  readonly choices: readonly RiftChoice[];
}

// ── Secrets (plans/late-game/05) ───────────────────────────────────────

/**
 * A secret: a combination, a boss's other form or a cosmetic that no star,
 * shop or list reveals. Found by playing; the Recipe Book's margin writes a
 * riddle when one stirs, and never says how many there are.
 */
export type SecretId =
  | 'shatterfall' | 'beacon-road' | 'glassfrost' | 'bellows'
  | 'the-lens' | 'banked-forge' | 'kintsugi' | 'wayward';

/** A mark a body wears at its death, read off fields the sim already keeps. */
export type BodyMark = 'frozen' | 'burning' | 'gilded' | 'tethered' | 'elite' | 'shade' | 'inContact';

/** What the run must hold for a tally or a form to count. */
export interface SecretNeeds {
  readonly carried?: readonly WeaponId[];
  readonly evolved?: readonly EvolutionId[];
  readonly frame?: FrameId;
}

/**
 * How a secret is found. A closed union: `sim/systems/secrets.ts` switches on
 * it. A tally counts kills (`by` a weapon, `on` a marked body, of an `enemy`
 * type, in a `region`); `lifetime` adds up across runs.
 */
export type SecretTrigger =
  | {
    readonly kind: 'tally'; readonly by?: WeaponId; readonly on?: BodyMark; readonly enemy?: EnemyId; readonly region?: number;
    readonly needs?: SecretNeeds; readonly n: number; readonly lifetime?: boolean;
  }
  /** A boss arrives in another form when the run meets `when`; felling it is the find. */
  | { readonly kind: 'form'; readonly boss: BossId; readonly when: FormCondition }
  /** A boss felled after the tower fell below `hp` of its max (`BossState.minHp`); it stirs below `stir`. */
  | { readonly kind: 'brink'; readonly hp: number; readonly stir: number }
  /** A boss felled with no suggested card taken in at least `drafts` drafts; it stirs at `stir` off picks. */
  | { readonly kind: 'wayward'; readonly drafts: number; readonly stir: number };

/** What brings a boss's other form. */
export type FormCondition =
  /** No weapon carried whose shots its mirror turns back. */
  | { readonly kind: 'unturned' }
  | { readonly kind: 'needs'; readonly needs: SecretNeeds };

/** A boss's other form: its name and banner line, a look, and its own phases (existing patterns only). */
export interface BossFormDef {
  readonly name: string;
  readonly line: string;
  /** Multiplier on the boss's HP. */
  readonly hp: number;
  /** The body's tint, and its border's. */
  readonly color: string;
  readonly borderColor: string;
  readonly phases: readonly BossPhase[];
}

/** What a find pays, besides its one-off shards. */
export type SecretReward =
  /** Effects every run from then on, as a Trial notable's. */
  | { readonly kind: 'effects'; readonly effects: readonly Effect[] }
  | { readonly kind: 'relic'; readonly relic: RelicId }
  | { readonly kind: 'trim'; readonly trim: TrimId; readonly name: string };

export interface SecretDef extends ContentEntry {
  readonly id: SecretId;
  /** The riddle the margin writes when it stirs, or the Bestiary's lore line for a form. ≤ 15 words. */
  readonly hint: string;
  /** Before this boss first falls, the secret isn't checked. */
  readonly after: BossId;
  readonly trigger: SecretTrigger;
  readonly reward: SecretReward;
  /** One-off pay at the find, outside the run's shards. */
  readonly shards?: number;
  readonly starlight?: number;
  /** A form secret's form. */
  readonly form?: BossFormDef;
}
