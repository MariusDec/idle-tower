/**
 * Every tunable number that is not per-item data (§13). Nothing tunable lives
 * in `sim/` code.
 */
export const BALANCE = {
  tower: {
    maxHp: 100,
    /** HP per second. */
    regen: 0.5,
    /** Flat reduction on each contact hit. */
    armor: 0,
    /** Enemies stop at `radius + their radius` and attack from there. */
    radius: 46,
    range: 380,
    critChance: 0.05,
    critMult: 2,
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
