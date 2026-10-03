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
    /** Specialist (keystone): the starting weapon evolves at this level instead. */
    specialistEvolveAt: 3,
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
    /** Starlight (S7, D-6): each new deepest floor pays `perFloor`, and each guardian's (every fifth) `perGuardian` more. */
    starlight: { perFloor: 2, perGuardian: 10 },
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
  /** Offline (§6.3). Efficiency and cap per tier, I–IV; P6 ships I–III, P7's regions bring IV. */
  offline: {
    tiers: [
      { efficiency: 0.25, capHours: 2 },
      { efficiency: 0.25, capHours: 4 },
      { efficiency: 0.4, capHours: 8 },
      { efficiency: 0.6, capHours: 12 },
    ],
    /** Absences shorter than this pay nothing. */
    minSeconds: 60,
    /** Runs shorter than this don't count toward the farm rate. */
    minRunSeconds: 60,
    /** The farm rate is the median of this many recent runs. */
    runs: 5,
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
   * How hard overlapping bodies push apart per step, as a fraction of their
   * radius per unit of overlap. Presentation-driven, but it moves bodies, so
   * it lives in the sim and is deterministic.
   */
  separation: 0.25,
  /** Live-enemy ceiling (§12.5). Spawns wait while the field is full. */
  maxEnemies: 300,
} as const;
