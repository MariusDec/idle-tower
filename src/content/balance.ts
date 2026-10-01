/**
 * Every tunable number that is not per-item data (§13). Nothing tunable lives
 * in `sim/` code.
 */
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
    /** Never fewer than this, whatever takes cards away (Hoarder). */
    minChoices: 2,
    /** Wall-clock seconds before the suggested card is taken. */
    seconds: 10,
    /** Arena speed while a draft is open. */
    slowMotion: 0.15,
    /** Fallback cards. */
    healFraction: 0.3,
    shardBonus: 10,
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
    /** Hoarder (keystone): cards taken from every draft. */
    hoarderChoices: 1,
    /** Specialist (keystone): the one weapon evolves at this level instead. */
    specialistEvolveAt: 3,
  },
  /**
   * Evolutions (§4.4, §11.2): offered once a weapon reaches `evolveAt` with
   * its partner passive owned. `damage` is each one's spike on top of its
   * weapon's last level; the rest are its own numbers.
   */
  evolutions: {
    evolveAt: 5,
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
  },
  /**
   * Hard caps on what a weapon puts on screen (§12.5). Anything past a cap
   * becomes damage instead, so a late build keeps its frame rate.
   */
  caps: {
    bolts: 6,
    blades: 8,
    drones: 8,
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
    /** Chance an elite kill drops one of its region's relics (§4.3). */
    eliteDrop: 0.3,
    /** Ranks top out here (§5.3: I → III). */
    maxRank: 3,
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
  },
  /** Overtime (§8.2): waves past the boss. */
  overtime: {
    hpGrowth: 1.25,
    shardGrowth: 1.12,
  },
  /** Hostile shots (Spitters). */
  shots: {
    /** A shot that lives this long without landing fizzles. */
    life: 6,
  },
  /** Offline (§6.3). Efficiency and cap per tier; P4 ships tier I. */
  offline: {
    tiers: [{ efficiency: 0.25, capHours: 2 }],
    /** Absences shorter than this pay nothing. */
    minSeconds: 60,
    /** Runs shorter than this don't count toward the farm rate. */
    minRunSeconds: 60,
    /** The farm rate is the median of this many recent runs. */
    runs: 5,
  },
  projectiles: {
    /** Seconds a homing bolt lives before fizzling. */
    homingLife: 2,
    /** A straight shot flies this multiple of the tower's range. */
    reach: 1.15,
  },
  damage: {
    /**
     * The least of a hit that armour lets through. Without a floor, armour
     * past a weapon's damage makes an enemy immortal instead of merely costly.
     */
    minFraction: 0.15,
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
     * horizontal), the short walk on a portrait arena, so the opening has
     * action at once and the first kill lands inside 3 s (P1 gate).
     */
    openingArc: 0.6,
    /** Spread of a pack around its shared spawn point, radians and seconds. */
    packSpread: 0.08,
    packStagger: 0.12,
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
