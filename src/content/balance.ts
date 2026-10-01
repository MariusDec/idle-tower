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
