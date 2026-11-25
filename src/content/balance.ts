/**
 * Every tunable number that is not per-item data (§13). Nothing tunable lives
 * in `sim/` code.
 */
/** Stored Light's part of a Night Watch tier (plans/late-game/01 §3). */
export interface StoredTier {
  readonly efficiency: number;
  readonly capHours: number;
  /** The burn multiple on a played wave's base shards. */
  readonly engaged: number;
  /** The burn multiple on a wave left alone. */
  readonly handsOff: number;
}

/** One Night Watch tier: the instant part, and the stored part from tier III. */
export interface OfflineTier {
  readonly efficiency: number;
  readonly capHours: number;
  readonly stored: StoredTier | null;
}

export const BALANCE = {
  tower: {
    maxHp: 100,
    /** Fraction of Max HP per second. */
    regen: 0.005,
    /** Flat reduction on each contact hit. */
    armor: 0,
    /** Enemies stop at `radius + their radius` and attack from there. */
    radius: 46,
    range: 380,
    critChance: 0.05,
    critMult: 2,
  },
  /** Slots at the start of a run, before the Forge (§4.4). */
  slots: { weapon: 1, passive: 2 },
  /** Weapons and passives top out here (§4.4). */
  maxLevel: 5,
  xp: {
    /** XP from level 1 to 2. Tuned so the first draft lands near 0:15 (§7.1). */
    first: 8,
    /** Each level needs this much more than the last, added… */
    perLevel: 4,
    /** …and then multiplied, so late levels stretch out (§4.5: 15–25 s early, 30–40 s later). */
    growth: 1.1,
  },
  draft: {
    /** Cards per draft (§4.5). */
    choices: 3,
    /** Never fewer than this, whatever takes cards away (Hoarder, Scarcity)… */
    minChoices: 2,
    /** …and never more than this: two rows of three is all a phone's arena can spare (§9). */
    maxChoices: 6,
    /** Wall-clock seconds before the suggested card is taken. */
    seconds: 10,
    /** Arena speed while a draft is open. */
    slowMotion: 0.15,
    /** Fallback cards. */
    healFraction: 0.3,
    /** Windfall: the least it pays, and how many of this wave's wave pays it is worth (§8.3). */
    shardBonus: 10,
    shardWaves: 3,
  },
  ultimate: {
    /** Kill XP (before XP gain) that fills the first charge: ~30–45 s of killing (§4.4). */
    charge: 40,
    /** Each cast makes the next charge this much longer, so later waves' kill rate doesn't spam it. */
    growth: 1.2,
  },
  /** The Forge's costs (§5.1). Base costs are per-node data. */
  forge: {
    /** Each further level of a multi-level node costs this much more than the last. */
    levelGrowth: 1.7,
    /**
     * Tempering: once the Gatekeeper falls, a minor whose stat is a
     * percentage goes on past its last level, the Act 1 sink past the ring
     * (offline pay used to fill a ring in one check-in, then had nothing to
     * buy). Each such level costs `cost` times the curve's next and
     * multiplies the stat by `1 + share × its percentage`, compounding.
     * At share 0.5 it outran the regions: some twenty minors, each on its
     * own cheap curve, grew DPS about as fast as the pay, and the Blight
     * fell at ~2 h even with shard and XP gain left out (8 profiles,
     * 2:04–2:33). At 0.2 it is a slope: each region from the Prism takes
     * ~1 h, the Blight ~5 h (docs/balancing.md, "Tempering").
     *
     * `easedGrowth`: past the Blight, each tempered level costs ×1.2 the one
     * before (the old endless masteries' curve), not the node's ×1.7. Act 1
     * is untouched; Act 2 keeps an endless combat sink once the capstones
     * are full (plans/mastery-capstones.md, docs/balancing.md).
     */
    temper: { cost: 2, share: 0.2, easedGrowth: 1.2 },
  },
  /**
   * The mastery capstones (plans/mastery-capstones.md): each rank a rule that
   * turns what the game throws away into power. Placeholders for the pacing pass.
   */
  capstones: {
    /** Might 1: the bank holds at most this many times the tower's last weapon hit. */
    bankCap: 2,
    /** Might 2: leaps an overkill may make in all. */
    chainLeaps: 3,
    /** Might 3, without Executioner: the bank's cap multiplies by this. */
    bankCapNoExecute: 2,
    /** Bulwark 1: the shield's cap, a fraction of Max HP, and the share of itself it loses a second. */
    shieldCap: 0.3,
    shieldDecay: 0.05,
    /** Bulwark 3: Second Wind recharges every this many waves, or Abyss floors. */
    windWaves: 10,
    windFloors: 3,
    /** Arsenal 1: damage each Overlevel adds to its weapon. */
    overlevelDamage: 0.25,
    /** Arsenal 2: area each Overlevel adds to a weapon without a count. */
    overlevelArea: 0.1,
    /** Arsenal 3: the partner passive's level an evolution needs. */
    passiveAt: 3,
    /** Engineering 1: the echo's delay, and its share of the cast's strength (Aegis and the lasting ones: of its time). */
    echoDelay: 3,
    echoShare: 0.4,
    /** Engineering 2: the share of a kill's charge refunded during an ultimate. */
    refund: 0.25,
    /** Engineering 3: charge banked while full, at most this share of a charge. */
    chargeBank: 0.5,
  },
  /** Numbers behind the Forge's behaviour notables (§11.4). */
  behaviours: {
    /** Opening Salvo: levels the starting weapon begins above 1. */
    openingSalvo: 1,
    /** Head Start: levels the tower starts above 1, each a banked draft. */
    headStart: 2,
    /** Overkill: how far excess damage may leap to the nearest enemy. */
    overkillRange: 180,
    /** Executioner: below this fraction of its Max HP, any hit kills. */
    executeBelow: 0.1,
    /** Executioner sources that count (Executioner or the Coin, and Annihilator): the line stops at 20%. */
    executeMax: 2,
    /** Second Wind: HP restored, as a fraction of Max HP. */
    secondWindHp: 0.5,
    /** Thorns: fraction of a contact hit dealt back to its attacker. */
    thorns: 0.5,
    /** Last Stand: below this HP fraction, attack speed rises by `lastStandSpeed`. */
    lastStandBelow: 0.3,
    lastStandSpeed: 0.4,
    /** Choice: cards added per owned level. */
    extraChoice: 1,
    /** Bounty: elites drop this many times their shards. */
    bounty: 3,
    /** Fortress (keystone): Thorns bite this many times harder, owned or not. */
    fortressThorns: 3,
    /** Hoarder (keystone, B2): every enemy's HP multiplies by this; a personal heat. */
    hoarderHp: 1.5,
    /** Twin Mount: its draw avoids weapons the region's first this-many waves' enemy types blunt (Q1, I3). */
    twinMountOpening: 4,
    /** Specialist (keystone): the starting weapon's damage, all told; the node's own stat lowers every other source. */
    specialistDamage: 2.5,
    /** Specialist (keystone): the node's damage multiplier on every source; its stat in `forge.ts` must match. */
    specialistOthers: 0.75,
    /** Rampart: a contact hit takes at most this fraction of Max HP. */
    rampartCap: 0.08,
    /** Oath: regen multiplier while a boss stands. */
    oathRegen: 3,
    /** Treasure Hunter: an elite's relic chance multiplies by this. */
    relicLuck: 2,
    /** Stormcaller's quirk: a crit leaps to the nearest other body within this, for this share of the hit. */
    stormLeap: 200,
    stormShare: 0.6,
    /** Gravekeeper's quirk: Max HP each kill restores. */
    siphon: 0.002,
    /** Heavy Shells (a Trial's notable, N5): bomblets a shell scatters beyond its own. */
    heavyShells: 2,
  },
  /**
   * Evolutions (§4.4, §11.2): drawable once a weapon reaches `evolveAt` with
   * its partner passive at `passiveAt`. `damage` is each one's spike on top of its
   * weapon's last level; the rest are its own numbers.
   */
  evolutions: {
    evolveAt: 5,
    passiveAt: 5,
    'seeker-swarm': { damage: 1.25, seekers: 2, seekerDamage: 0.6 },
    /** Burn: damage per second as a share of the pellet's hit, for `burnSeconds`; spreads `spread` far on death. */
    dragonbreath: { damage: 1.25, burn: 0.6, burnSeconds: 3, spread: 90 },
    /** Storms orbit at `orbit` × range, each casting a chain from where it is. */
    'storm-crown': { damage: 1.2, storms: 3, orbit: 0.55, spin: 0.5 },
    /** Freeze seconds (not bosses), and a slain frozen body's burst: × the pulse's hit, `shatterRadius` wide. */
    'absolute-zero': { damage: 1.3, freeze: 1, shatter: 2.5, shatterRadius: 70 },
    /** A meteor every `every` s: × the shell's hit, `radius` wide, leaving burning ground. */
    meteorfall: { damage: 1.25, every: 3, meteor: 4, radius: 100, groundRadius: 85, groundSeconds: 4, burn: 0.35 },
    /** At full heat, the beam also strikes `splits` more targets near the first. */
    judgment: { damage: 1.2, splits: 2, splitRange: 220 },
    /** The orbit sweeps from the wall to the edge of range and back every `period` s. */
    halo: { damage: 1.4, period: 3 },
    /** Each drone kill calls a drone that lasts `seconds`. */
    hive: { damage: 1.25, seconds: 5 },
    /** Every throw also looses `ring` crescents evenly around the tower. */
    'crescent-storm': { damage: 1.25, ring: 6 },
    /** A body striking the wall sets off a rune where it stands, at most once per `every` s. */
    'bulwark-runes': { damage: 1.25, every: 0.25 },
    /** Each tether mends the tower by `heal` of Max HP a second. */
    lifebloom: { damage: 1.2, heal: 0.0025 },
    /** What the slug pierces is gilded for `seconds`: it takes `vulnerable` more, and pays `shards` times if slain so. */
    'midas-lance': { damage: 1.25, seconds: 4, vulnerable: 0.3, shards: 2 },
  },
  /**
   * Anomalies (plans/late-game/04 §3): a rare card that breaks a weapon's
   * rule. One roll a run on the `anomaly` stream, once the gate is open (the
   * first recipe found). `damage` is a spike on the weapon's hit, as an
   * evolution's is; the rest is each one's shape.
   */
  /**
   * Secrets (plans/late-game/05). Tally goals `n` live in `content/secrets.ts`.
   * A stir writes the riddle at `stirAt` of the goal, at most `stirsPerRun`
   * a run; a boss's lore line shows after `loreKills` kills of it.
   */
  secrets: {
    stirAt: 0.25,
    stirsPerRun: 1,
    loreKills: 3,
    /** Highest relic rank a form's repeat falls pay; past it, the duplicate melts. */
    formRelicMax: 3,
    /** Shatterfall: a shell finishes a frozen body at or below this share of its max HP. */
    shatterfall: { share: 0.5 },
    /** Beacon Road: Sunlance's reach in the Mire, as a multiplier on range. */
    beaconRoad: { range: 1.25 },
    /** Glassfrost: a frozen Shardling's shards hit this many of its kin, each for this share of its max HP, within `reach`. */
    glassfrost: { share: 1, reach: 120 },
    /** Bellows: a pellet on a burning body sets bodies this close alight with its fire. */
    bellows: { radius: 40 },
    /** Lens Shard, by rank: extra damage beams and chains deal bosses. */
    lensShard: [0.15, 0.22, 0.3],
  },
  /**
   * Final Form (plans/late-game/07): evolve `need` weapons in one run (an
   * anomaly counts) and the tower takes its frame's form until the run ends.
   * Only with Alchemy, `minSlots` weapon slots and `need` passive slots.
   * `ultCharge` (0: cosmetic) is the ult's extra charge rate once formed;
   * `chase` (1: off) the suggestion's second-recipe bonus.
   */
  finalForm: { need: 2, minSlots: 2, ultCharge: 0, chase: 1 },
  anomalies: {
    /** A weapon is eligible from this level: before `evolveAt`, so the fork comes early. */
    minLevel: 3,
    /** The first run after the gate that reaches `minLevel` deals one for certain. */
    first: 1,
    /** The chance a run holds one, +`dryStep` per run since the last offer, capped at `dryCap`. */
    chance: 0.05,
    dryStep: 0.01,
    dryCap: 0.25,
    /** The Abyss: twice as likely. */
    abyss: 2,
    /** Eligible drafts the offer may wait, rolled 0…delay. */
    delay: 2,
    /** The draft timer's floor, wall seconds, while an anomaly is in the hand (the Tactician's 6 s too). */
    seconds: 10,
    /** Frost Ring's: a storm that drifts `drift` u/s toward the thickest crowd, no farther than `reach` × range, pulsing `radius` × the ring's. */
    whiteout: { damage: 1.3, drift: 80, reach: 0.6, radius: 0.8 },
    /**
     * Glaives': blades circle the toughest body `orbit` past its edge (inside
     * a blade's reach, so they cut it), `widen` of a level's wider orbit on
     * top, and fly `travel` u/s to the next.
     */
    gyre: { damage: 1.35, orbit: 6, widen: 0.3, travel: 700 },
    /** Sunlance's: the beam turns `turn` rad/s (× attack speed, ×`turnStep` at level 4), `width` wide, out to range. */
    lighthouse: { damage: 1.45, turn: 1.2, turnStep: 1.15, width: 18 },
    /** Mortar's: each shell is a line of `blasts` walking in from range to the wall, `stagger` s apart, each `damage` × the shell. */
    'creeping-barrage': { damage: 1.1, blasts: 5, stagger: 0.12 },
  },
  /**
   * Hard caps on what a weapon puts on screen (§12.5). Anything past a cap
   * becomes damage instead, so a late build keeps its frame rate.
   */
  caps: {
    bolts: 6,
    blades: 8,
    drones: 8,
    crescents: 6,
    runes: 8,
    tethers: 6,
    slugs: 4,
  },
  /** Weapon feel that isn't per level. */
  weapons: {
    /** Mortar bomblets: each a share of the shell's hit, this fraction of its blast, scattered this far. */
    bombletDamage: 0.4,
    bombletRadius: 0.5,
    bombletScatter: 55,
    /** A piercing beam's half-width, world units. */
    beamWidth: 12,
    /** Drones: flight speed, how far from their quarry they hover, and how far past range they may roam. */
    droneSpeed: 300,
    droneHover: 140,
    droneLeash: 1.1,
    /** Seconds between a burn's bites. */
    burnTick: 0.5,
    /** A meteor's fall speed, and where it falls from, relative to where it lands. */
    meteorSpeed: 900,
    meteorFrom: { x: -170, y: -480 },
    /** Moonblade: how far a crescent flies out, as a multiple of range, and how much faster it comes home. */
    crescentReach: 1,
    crescentReturn: 1.3,
    /** A crescent's cutting reach beyond a body's radius. */
    crescentWidth: 14,
    /** A weapon's point-blank bonus (S5) holds inside this share of the tower's range. */
    pointBlankReach: 1 / 3,
    /** Rune Traps: seconds before a laid rune arms; how close a body must come; where it is laid, as a share of its mark's distance. */
    runeArm: 0.35,
    runeTrigger: 22,
    runeLay: 0.7,
    /** Gilded Rail: a slug's flash on screen, seconds (the painter's). */
    railFlash: 0.18,
  },
  /** The Recipe Book's hints (§5.3): runs carrying a weapon before its half shows, maxed runs before the riddle. */
  recipes: {
    weaponRuns: 3,
    riddleRuns: 2,
  },
  /**
   * Relic numbers (§11.5), indexed by rank − 1. A relic's behaviour count is
   * its rank, so rank II reads `[1]`.
   */
  relics: {
    /** Tallow Candle: waves 1–5 spawn and chain this much faster. */
    quickStart: [1.5, 1.75, 2],
    quickStartWaves: 5,
    /** Hunter's Tally: damage per 100 kills this run. */
    tally: [0.05, 0.075, 0.1],
    /** Mother's Tear: regen multiplier while no enemy is within half range. */
    stillRegen: [2, 2.5, 3],
    /** Bog Lantern: XP multiplier for lightning, frost and Nova kills. */
    stormXp: [2, 2.5, 3],
    /** Mire Lily: Splitter fragments' HP multiplier. */
    frailSplits: [0.5, 0.4, 0.3],
    /** Stillwater Charm: damage taken by bodies that are not moving. */
    stillTarget: [0.25, 0.35, 0.45],
    /** Prism Heart: chance a shot refracts into a second target. */
    refract: [0.2, 0.3, 0.4],
    /** Frost Brand: damage taken by slowed bodies. */
    frostBrand: [0.25, 0.35, 0.45],
    /** Hourglass Sand: damage taken by bodies within a third of range. */
    closeQuarters: [0.3, 0.4, 0.5],
    /** Forgeheart Core: every `surgeEvery` s, weapons hit this hard for `surgeSeconds`. */
    surge: [3, 3.5, 4],
    surgeEvery: 10,
    surgeSeconds: 1,
    /** Ember Ward: damage taken by burning bodies. */
    kindling: [0.3, 0.4, 0.5],
    /** Blast Shield: what's left of a Bomber's or Shardling's blast at the wall. */
    blastShield: [0.5, 0.35, 0.2],
    /** Hollow Crown: Max HP restored by each ultimate cast. */
    ultHeal: [0.25, 0.35, 0.45],
    /** Soul Jar: every `soulKills` kills restore this much Max HP. */
    soulJar: [0.05, 0.07, 0.1],
    soulKills: 50,
    /** Warding Salt: a body that hits the wall is slowed this much, for `saltSeconds`. */
    salt: [0.3, 0.4, 0.5],
    saltSeconds: 2,
    /** Last Light: ultimate charge multiplier below half HP. */
    lastLight: [2, 2.5, 3],
    /** Blight Thorn: damage taken by elites. */
    eliteBane: [0.5, 0.7, 0.9],
    /** Pale Lantern: damage taken by bosses. */
    bossBane: [0.2, 0.3, 0.4],
    /** Starseed: Max HP restored on each level-up. */
    levelHeal: [0.1, 0.15, 0.2],
    /** Moonstone: how much faster crescents come home. */
    swiftReturn: [2, 2.5, 3],
    /** Rune Chalk: the echo rune's share of the burst. */
    echoRune: [0.5, 0.65, 0.8],
    /** Husk Splinter: hits a Husk's shell swallows fewer. */
    brittleShell: [2, 3, 4],
    /** Gilt Edge: a slug's kill bursts this wide, for this share of the hit. */
    railBurst: [0.5, 0.7, 0.9],
    railBurstRadius: 90,
    /** Ward Breaker: the share of a ward's or Shield aura's protection taken away. */
    wardbreak: [0.5, 0.75, 1],
    /** Abyssal Pearl: Max HP restored as a floor's boss falls. */
    floorHeal: [0.25, 0.35, 0.5],
    // The Wake's (plans/late-game/12 §8.9).
    /** Carillon's Clapper: every `clapperEvery` s, every body in range is stunned this long. */
    clapper: [0.5, 0.65, 0.8],
    clapperEvery: 8,
    /** Tuning Fork: damage taken by stunned and frozen bodies. */
    tuningFork: [0.3, 0.4, 0.5],
    /** Metronome: damage per `metronomeEvery` s the tower goes unhurt, up to `metronomeSteps` steps. */
    metronome: [0.02, 0.025, 0.03],
    metronomeEvery: 10,
    metronomeSteps: 10,
    /** Colossus Heart: damage against bodies above half their health. */
    colossus: [0.3, 0.4, 0.5],
    /** Tick Bite: damage taken by a body a crit has marked. */
    tickBite: [0.15, 0.2, 0.25],
    /** Herd Bell: extra shards from a body at least `herdBellRadius` across (a giant). */
    herdBell: [0.3, 0.45, 0.6],
    herdBellRadius: 30,
    /** Giant's Toe: the share of Sunlance's heat-up kept when it turns to a new target. */
    giantsToe: [0.5, 0.7, 0.9],
    // The Orrery's.
    /** Astrolabe Ring: how much faster Glaives turn and drones fly. */
    astrolabe: [0.3, 0.45, 0.6],
    /** Star Chart: how much farther a homing bolt that lost its mark looks for another. */
    starChart: [2, 2.5, 3],
    /** Tidal Lock: how much slower bodies within half the range walk. */
    tidalLock: [0.15, 0.2, 0.25],
    /** Comet Tail: a Glaive kill's burning ground, its DPS as a share of the body's Max HP, for `cometTailSeconds` s, `cometTailRadius` wide. */
    cometTail: [0.1, 0.15, 0.2],
    cometTailSeconds: 2,
    cometTailRadius: 40,
    // The Frozen Sea's.
    /** Leviathan Scale: how much farther knockback pushes, and the most mass a pushed (non-boss) body counts. */
    leviathan: [0.5, 0.75, 1],
    leviathanMass: 2,
    /** Skate Blade: damage taken by a body knocked back within the last `skateSeconds` s. */
    skateBlade: [0.25, 0.35, 0.45],
    skateSeconds: 2,
    /** Floe Shard: a body slain while slowed slows those within `floeShardRadius` by this, for `floeShardSeconds` s. */
    floeShard: [0.3, 0.4, 0.5],
    floeShardRadius: 80,
    floeShardSeconds: 2,
    // Stormcrown's.
    /** Thunderhead Core: every `thunderCoreEvery` s, a strike takes this share of the toughest non-boss body's Max HP. */
    thunderCore: [0.05, 0.07, 0.1],
    thunderCoreEvery: 10,
    /** Grounding Wire: the share of lightning and hostile shots the tower turns aside. */
    grounding: [0.3, 0.4, 0.5],
    /** Static Charge: ultimate charge (a share of full) each crit adds. */
    static: [0.0005, 0.00075, 0.001],
    /** Chance an elite kill drops one of its region's relics (§4.3). */
    eliteDrop: 0.3,
    /** Ranks top out here (§5.3: I → III). */
    maxRank: 3,
    /** A duplicate past the last rank pays this many waves' pay where it fell. Late elites drop many: 5 took ~2.7 h off Act 1. */
    peakWaves: 1,
  },
  /** Relic sets (N6): rank I, then a rank per `perRank` duplicates past a relic's rank III, to `maxRank`. */
  sets: {
    perRank: 5,
    maxRank: 3,
    /** Field Kit: how far a crit shoves a weight-1 body. */
    fieldsPush: 40,
    /** Glasswright: Burrowers surface this many times as far out. */
    wastesSurface: 2,
    /** Rift Warden: a Bomber's fire, a share of its Max HP a second, for `riftSeconds`. */
    riftBurn: 0.25,
    riftSeconds: 3,
    /** Blightbane: Max HP each elite kill restores. */
    blightHeal: 0.05,
  },
  /** Elites (§4.3). */
  elites: {
    /** HP multiple over a plain body of the same type. */
    hp: 8,
    /** Body radius multiple. */
    scale: 1.3,
    /** Shards multiple over the same body (§8.3). */
    shards: 10,
    /** XP multiple. */
    xp: 5,
    /** Haste: speed multiplier for it and its neighbours. */
    haste: 1.4,
    /** Regen: fraction of Max HP per second for it and its neighbours. */
    regen: 0.03,
    /** Shield: damage its neighbours take (not itself). */
    shield: 0.5,
    /** Split: copies it bursts into, each a plain body of its type. */
    split: 3,
    /** Vengeful: speed and damage multiplier its death gives nearby bodies. */
    vengeful: 1.5,
    // The regions' own auras (N3).
    /** Fog-caller: the tower's range is cut by this share while one lives (they don't stack). */
    fog: 0.1,
    /** Molten: slain within `reach` × range of the wall, a pool opens there, burning `dps` × its contact hit a second. */
    molten: { reach: 0.5, dps: 0.4, seconds: 4, radius: 50 },
    /** Wraith: out for `hidden` s of every `cycle`. */
    wraith: { cycle: 4, hidden: 1.5 },
    /** Hungering: Max HP it heals for each body that falls near it. */
    hunger: 0.08,
    // The Wake's own (plans/late-game/12 §6).
    /** Resonant: its neighbours' speed multiplier, at least (under Toll, a longer lurch). */
    resonant: 1.8,
    /** Tidal: its neighbours' Orbit tangent multiplier, at least (before the cap). */
    tidal: 2,
    /** Towering: a non-crit hit on it lands at this share. */
    towering: 0.6,
  },
  /**
   * Overtime Champions (N4): every `every`th wave past the boss brings one, an
   * elite this many times an elite's HP and shards, sure to drop a relic.
   */
  champions: {
    every: 5,
    hp: 2.5,
    shards: 4,
  },
  /**
   * Overtime trophies (N4): reaching these waves past a region's boss earns a
   * mark on the Map and a light on the hub tower, once, paying `pay` times
   * that wave's wave pay.
   */
  /**
   * The Contract board (plans/late-game/10 §4.4). Opens at `opensAfter`'s
   * fall. A contract's score is its target's base, its stretch against the
   * player's own records, and its modifiers' points; `tiers` are the score
   * ceilings of T1–T3 (T4 above), and `bands` the tiers each slot (Quick,
   * Steady, Hard) may hold. Pay is `minutes` of the farm rate in shards, and
   * in Act 2 `starlight` too, by tier, read at payout.
   */
  contracts: {
    opensAfter: 'forgeheart',
    attempts: 24,
    bands: [[1, 2], [2, 3], [3, 4]],
    tiers: [2.5, 4, 5.5],
    /**
     * Farm minutes a met card pays, by tier. A card's run is about three wall
     * minutes at 3×, not the fifteen the plan sized these on: at 6/10/15/22 a
     * card hour earned 2–4.4× the frontier's farm (docs/contracts.md), against
     * the plan's ceiling of 1.5×.
     */
    minutes: [2.5, 3.5, 5, 8],
    starlight: [4, 8, 13, 20],
    minWithin: 20,
    /** A boss felled fewer times than this is not yet a kill to count on: it scores as a stretch, and never rides the Quick slot. */
    freshKills: 3,
    milestones: { trims: [10, 30], relicEvery: 10 },
    weights: { boss: 3, floor: 2, overtime: 1.5, guardian: 1, wave: 1, run: 1, rush: 1 },
  },
  trophies: {
    overtime: [5, 10, 15],
    pay: 10,
  },
  /** Bosses (§4.3, §8.2). */
  boss: {
    /** Shards for a boss kill multiply this on the first kill (§8.1). */
    firstKill: 5,
    /**
     * A boss that outlasts this many seconds enrages: its slams hit
     * `enrageGrowth` harder for every further `enrageEvery` s, so a fight
     * the tower can't win ends instead of stalling.
     */
    enrageAfter: 90,
    enrageEvery: 10,
    enrageGrowth: 1.25,
    /** A Nova that lands during a slam's wind-up staggers the boss: the slam is lost. */
    staggerSeconds: 1.5,
    /** Seconds between an enraged boss's hits at the wall. */
    attackInterval: 1.4,
    /** A submerged boss rises this far round its ring, radians, either way. */
    emergeArc: [0.9, 1.8],
    /** How fast a shot the Prism's mirror throws back flies at the tower. */
    reflectSpeed: 360,
  },
  /** Enemy verbs that need a number not in the type's data (§4.3). */
  foes: {
    /** A Shardling's shards: how fast they fly at the tower. */
    shardSpeed: 420,
    /** A Blinker never lands closer than this to the wall. */
    blinkMargin: 20,
  },
  /** Overtime (§8.2): waves past the boss. */
  overtime: {
    hpGrowth: 1.25,
    shardGrowth: 1.12,
    /**
     * A wave the full field holds back (`maxEnemies`) can stall a run for
     * good: nothing more spawns, so overtime stops growing, and a tower that
     * neither kills nor falls would wait forever. Held this many seconds,
     * the horde enrages: its hits on the tower grow `stallGrowth` for every
     * further `stallEvery` s, as a boss's slams do, so the run ends.
     */
    stallAfter: 30,
    stallEvery: 5,
    stallGrowth: 1.25,
  },
  /** Pacts (§9): heat, and what it pays. */
  pacts: {
    /** Shards rise by this share for each point of heat (§9: × (1 + 0.1 × heat)). */
    shardsPerHeat: 0.1,
  },
  /**
   * Starlight (§9, S7). A new heat record in a region pays, for each heat
   * level h it passes, `1 + floor(h / every)`, the same in every region
   * (D-8): the hard part is the high heat, not the late region.
   */
  starlight: {
    every: 5,
  },
  /**
   * The Abyss (§9): sized by depth. HP, damage and shards grow per wave with
   * no cap; wave numbers run on across floors, so these are per global wave.
   */
  abyss: {
    /** About the Blight Heart's middle waves at floor 1; ×2.2 a floor after. */
    hpBase: 4000,
    hpGrowth: 1.08,
    /** Damage grows slower than HP: deeper floors are lost to the crowd, not to one blow. */
    damageBase: 50,
    damageGrowth: 1.025,
    /** Shards a weight-1 kill pays at wave 1, and the growth per wave: below HP's, so depth pays, but less per blow. */
    shardBase: 150,
    shardGrowth: 1.05,
    /** Shards for holding a wave, before its growth. */
    waveShards: 300,
    /** Bodies on a floor's wave n: `base + perWave × (n − 1)`. */
    count: { base: 10, perWave: 2.5 },
    /** How often each native walks, against a template type's weight of about 1. */
    nativeWeight: 0.3,
    /** Elites on a floor's waves 3, 6 and 9. */
    elites: { from: 3, every: 3 },
    /** A floor's boss: its HP multiple of the floor's last wave, times this… */
    bossHp: 0.35,
    /** …and the Abyss's own guardians, every fifth floor, times this instead (S7.5: the first is passable). */
    guardianHp: 0.25,
  },
  /**
   * The Abyss's strata (plans/late-game/08): five authored strata of six
   * floors, each with its own curve (`content/strata.ts`), down to a bottom
   * at floor 30; past it, the Below.
   */
  strata: {
    /**
     * Starlight: each new deepest floor pays `perFloor` down to the bottom
     * and `below` past it; each guardian's first fall in the strata pays its
     * stratum's `lump`, in order.
     */
    starlight: { perFloor: 2, below: 1, lump: [20, 25, 30, 35, 60] },
    /**
     * A Keeper (§4.3): a Champion of a native, `hp` times a Champion's, that
     * ends floors 1–5 of a stratum. Wave 10 holds the next floor until it
     * falls, or `hold` s after its spawns finish.
     */
    keeper: { hp: 1.5, hold: 45, at: 0.3 },
    /** Gates: a body comes through within `arc` rad either side of a gate. */
    gates: { arc: 0.2 },
    /**
     * Inversion: an inverted body starts `gap` outside the wall. A body a
     * Tidecaller turned out that escapes drains `drain` of the ultimate
     * where no Inversion rule says otherwise.
     */
    inversion: { gap: 12, drain: 0.05 },
    /** How often a native walks against a guest's 1. */
    nativeWeight: 0.45,
    /** How far a guest's colours lean to the stratum's ground: the deep has changed them. */
    guestMix: 0.3,
    /**
     * Waypoints (§4.4): the level a run started at a stratum's foot begins
     * at, by stratum (I, II, …, then the Below). II's 30 is the act2 bot's
     * median level entering floor 7 from the top (12 h, 4 seeds); the rest
     * are placeholders, kept rising, until III–V are built and read.
     */
    waypoint: { level: [1, 30, 33, 36, 39, 42] },
  },
  /**
   * Boss Rush (N8): the six Act 1 bosses, then the Abyss's two, back to
   * back. Each is sized like the guardian of an Abyss floor
   * (`BALANCE.abyss.guardianHp` of that floor's last wave): `floors[i]` is
   * the floor stage i + 1 is sized for.
   */
  rush: {
    floors: [2, 2, 3, 3, 4, 4, 5, 6],
    /** The tower starts at this level: there are no waves to grow on, so the drafts come first. */
    level: 16,
    /**
     * Starlight (N8): each stage first cleared pays `perStage`; a full clear
     * pays `clear × log2(1 + par / seconds)` in all, so a faster record pays
     * the difference, on a curve.
     */
    starlight: { perStage: 4, clear: 20, par: 600 },
  },
  /**
   * Fusions (N9): both halves of a fusion hit `damage` times harder, on top
   * of their evolutions, and each pair's own interaction has its numbers here.
   */
  fusions: {
    damage: 1.25,
    /** Blizzard: lightning on a frozen body hits `frozen` times as hard, and freezes what it strikes for `freeze` s. */
    blizzard: { frozen: 2, freeze: 0.6 },
    /** Firestorm: shells and meteors set alight for `burn` of the hit a second, `seconds` long; a burning body takes `burning` times as much from them. */
    firestorm: { burning: 1.5, burn: 0.2, seconds: 3 },
    /** Dawnstar: bolts hit the beam's body `marked` times as hard. */
    dawnstar: { marked: 1.75 },
  },
  /**
   * Ascension (N10): once every star is lit, a Constellation minor whose
   * stat is a percentage goes on past its last level. Each such level costs
   * `cost` times the curve's next, and multiplies the stat by
   * `1 + share × its percentage`, compounding: felt, and without end.
   */
  ascend: { cost: 2, share: 0.5 },
  /** Hostile shots (Spitters). */
  shots: {
    /** A shot that lives this long without landing fizzles. */
    life: 6,
  },
  /**
   * Offline (§6.3). Each Night Watch tier pays an instant part (efficiency
   * and cap) and, from tier III, a stored part (plans/late-game/01): Stored
   * Light, which only runs burn, at `engaged`× a played wave's base shards
   * and `handsOff`× a wave left alone. The instant part is frozen at tier
   * II's: buying III or IV adds a store, it never shrinks the first number.
   * `base` is Night Watch 0 (R8 §1): built in, paid before any tier is owned,
   * so a first session closed before the Gatekeeper still comes back to
   * something.
   */
  offline: {
    base: { efficiency: 0.1, capHours: 1, stored: null } as OfflineTier,
    tiers: [
      { efficiency: 0.15, capHours: 2, stored: null },
      { efficiency: 0.15, capHours: 4, stored: null },
      { efficiency: 0.15, capHours: 4, stored: { efficiency: 0.2, capHours: 8, engaged: 5, handsOff: 2 } },
      { efficiency: 0.15, capHours: 4, stored: { efficiency: 0.25, capHours: 12, engaged: 8, handsOff: 2.5 } },
    ] as readonly OfflineTier[],
    /** Absences shorter than this pay nothing. */
    minSeconds: 60,
    /** Runs shorter than this don't count toward the farm rate. */
    minRunSeconds: 60,
    /** The farm rate is the median of this many recent runs. */
    runs: 5,
    /** A wave counts as played after a touch this recent, in wall seconds. */
    engagedSeconds: 30,
  },
  /** Engineering's automation (§6.2). */
  automation: {
    /** Seconds after the results before auto-restart starts the next run. */
    restartSeconds: 5,
    /**
     * Wall seconds a draft waits once the Tactician writes the suggestion: the
     * player's own plan needs no ten seconds of thought (§6.2, §6.4).
     */
    tacticianSeconds: 6,
    /**
     * Wall seconds the Opening (a run that starts with drafts banked) waits,
     * once the Tactician is owned, before it takes every one's suggestion
     * at once (U2). A tap on it stops the count, to review.
     */
    openingSeconds: 2,
  },
  projectiles: {
    /** Seconds a homing bolt lives before fizzling. */
    homingLife: 2,
    /** A straight shot flies this multiple of the tower's range. */
    reach: 1.15,
  },
  damage: {
    /**
     * The least of a hit that armour lets through: a backstop under the
     * curve (S2), which only reaches it at armour ~19× the hit.
     */
    minFraction: 0.05,
  },
  waves: {
    /** Seconds before wave 1 starts spawning. */
    firstWaveDelay: 0.25,
    /** A wave spawns over this many seconds, growing per wave up to the max (§4.2). */
    spawnSeconds: { base: 6, perWave: 0.2, max: 10 },
    /**
     * The next wave starts once the current one has finished spawning *and*
     * either this fraction or less of its bodies is alive, or `overlapSeconds`
     * have passed since it finished spawning (§4.2).
     */
    clearFraction: 0.25,
    overlapSeconds: 10,
    /** Seconds between a boss's fall and the first overtime wave (§4.2). */
    afterBoss: 3,
    /**
     * Wave 1 comes in from the flanks (within this many radians of
     * horizontal), level with the tower where a phone's stage is narrowest,
     * so the opening has action at once and the first kill lands inside 3 s
     * (P1 gate).
     */
    openingArc: 0.6,
    /** Spread of a pack around its shared spawn point, radians and seconds. */
    packSpread: 0.08,
    packStagger: 0.12,
  },
  /**
   * Cursed relics (plans/late-game/03 §3.5): a reliquary drops where an
   * elite, Keeper or guardian fell in the Abyss, and only a tap claims it.
   * One roll each on the `curse` stream; Treasure Hunter's `relicLuck`
   * multiplies the elites'. A guardian's first fall is sure.
   */
  cursed: {
    eliteDrop: 0.04,
    /** Plan 08's Keepers (the beat that ends floors 1–5): likelier than an elite. */
    keeperDrop: 0.12,
    /** A guardian's later falls: waypoint farming can't buy its relic's ranks in an evening. */
    bossDrop: 0.35,
    /** Sim seconds a reliquary waits for its tap: about a wave. */
    claimSeconds: 40,
    /** A profile's first reliquary is a lesson: twice as long. */
    firstClaimSeconds: 80,
    /** Duplicates past rank III that bind a cursed relic: a set rank's count. */
    bindAt: 5,
    /** Curses worn at once, in any slots: two cursed slots and one Bound. */
    maxWorn: 3,
    /** Glass Crown: damage ×mult at rank I, ×perRank more for each rank past it. */
    glassCrown: { mult: 1.5, perRank: 1.1 },
  },
  /**
   * Rifts (plans/late-game/02 §3): a tear opens mid-wave; a watching player
   * taps it for an authored offer. One roll per eligible wave on the `rifts`
   * stream, at `chance + ramp × (eligible waves since the last rift)`.
   */
  rifts: {
    /** No rift before this wave (a floor's own wave in the Abyss). */
    from: 4,
    /** Sim seconds into the wave it appears. */
    delay: [3, 7] as readonly [number, number],
    /** Sim seconds it waits for a tap. */
    openSeconds: 8,
    /** The First Tear's wait, and the wave it opens at. */
    firstOpenSeconds: 20,
    firstWave: 4,
    /** Waves between two rifts. */
    gap: { act1: 4, act2: 3 },
    chance: { act1: 0.12, act2: 0.15, abyss: 0.25 },
    ramp: { act1: 0.06, act2: 0.06, abyss: 0.1 },
    /** Rifts a run may see; overtime adds one more. */
    perRun: { act1: 2, overtime: 1, act2: 3 },
    /** In the Abyss: one a floor, on its waves `from`…`floorLast`. */
    perFloor: 1,
    floorFrom: 2,
    floorLast: 9,
    /** Rarity weights; rares from this region index on, legendaries from that. */
    rarity: { common: 70, rare: 25, legendary: 5 },
    rareFrom: 2,
    legendaryFrom: 3,
    /** A rift not yet in the journal is this much likelier, within its rarity. */
    unseenWeight: 2,
    /** Where it opens, × the light's radius, in the upper 240° of the light. */
    radius: [0.45, 0.7] as readonly [number, number],
    /** A cost leaves at least this share of Max HP. */
    hurtFloor: 0.1,
    /** A forged hand offers the evolution of any carried weapon at this level or more. */
    forgedFrom: 3,
    /** The app: arena speed while a rift waits, for an engaged player only. */
    engagedCap: 1,
  },
  /**
   * The Daily Omen (plans/late-game/11 §4.3): one profile-free run a day.
   * Tuned with `npm run omen`.
   */
  omen: {
    /** Weapons in the day's pool, the frame's included. */
    pool: 5,
    /**
     * Forge rings bought out for the Omen's tower, by region index (0 unused).
     * The plan's start ([0, 1, 2, 3, 4, 5, 6]) fell near wave 13 on the median
     * day; every ring to 6 meets the median targets (`npm run omen`, 28 days).
     */
    ring: [0, 6, 6, 6, 6, 6, 6, 0, 0, 7, 7, 7, 7, 7] as readonly number[],
    /** Star node ids lit at max level on the Omen's tower, by region (Wake days, if `npm run omen` says they fall short). */
    stars: {} as Partial<Record<number, readonly string[]>>,
    /**
     * The first Omen day (days since 1970-01-01 UTC) that draws the Wake's
     * regions: 2026-12-01 (plans/late-game/12 §8.10). Days before it keep
     * the Act 1 six-day cycle unchanged.
     */
    wakeFrom: 20788,
    /** The day's difficulty: banes + twist + boon (a boon's are negative). */
    points: [6, 8] as readonly [number, number],
    /** No pact past this rank in an Omen. */
    maxRank: 2,
    /** Band I: the boss felled (wave 20 held); II, III: this many overtime waves held. */
    bands: [0, 5, 10] as readonly number[],
    /** Starlight for the scored try: the base, plus each band's; × the Stargazers (`payStarlight`). */
    starlight: { base: 2, band: [1, 2, 3] as readonly number[] },
    /** The Augur's Veil: this many scored Omens, on any days. */
    trims: { played: 7 },
    /** Days of history kept. */
    keep: 60,
    /** Redraws before the twist is dropped (§4.1). */
    redraws: 8,
  },
  /** The Wake (plans/late-game/12): its rules' per-rank surges and limits, its Starlight. */
  wake: {
    /** D-5: a Wake region's heat record pays this share of Starlight. */
    heatStarlight: 0.5,
    /** D-5: Starlight for each Wake boss's first fall. */
    lump: 25,
    toll: {
      /** The lurch keeps a tolled body's average speed at this share of its own. */
      average: 0.9,
      /** Blight Surge: the lurch carries this much further per rank. */
      surge: 1.25,
      /** Each Ringer alive multiplies the interval by its `hasten`, down to this share. */
      floor: 0.6,
      /** The Carillon's quickening never takes the interval below the window × this. */
      minInterval: 1.2,
    },
    orbit: {
      /** Blight Surge: the tangent's multiplier per rank, and its ceiling (below 1: a spiral, never a ring). */
      surge: 1.3,
      max: 0.95,
    },
    glide: {
      /** Below this speed (units/s) a slide ends and the body walks again. */
      min: 12,
      /** Seconds between one body's impacts. */
      cooldown: 0.3,
      /** The share of a slider's velocity passed to what it hits. */
      transfer: 0.5,
      /** Impact damage reads speed up to this (units/s), as a share of it. */
      cap: 600,
      /** Under Glide, a blast (Mortar, a rune, a shatter) pushes what it hits this far out from its centre… */
      blastPush: 24,
      /** …and a Frost Ring pulse pushes this far out from the tower. */
      pulsePush: 10,
    },
    /** The Leviathan's `floes` (§7.1): loose ones land between the wall + `near` and its standoff − `far`; a ring sits at the wall + `ring`. */
    floes: { near: 80, far: 40, ring: 70 },
    giants: {
      /** Blight Surge: size and HP multiply by this per rank. */
      surge: 1.25,
      /** A Tick rides only a body at least this wide (a giant, §4.4)… */
      host: 30,
      /** …sitting this share of its host's radius toward the tower. */
      seat: 0.4,
    },
    storm: {
      /** Blight Surge: the interval multiplies by this per rank. */
      surge: 0.8,
    },
  },
  /**
   * How hard overlapping bodies push apart per step, as a fraction of their
   * radius per unit of overlap. Presentation-driven, but it moves bodies, so
   * it lives in the sim and is deterministic.
   */
  separation: 0.25,
  /** Live-enemy ceiling (§12.5). Spawns wait while the field is full. */
  maxEnemies: 300,
} as const;
