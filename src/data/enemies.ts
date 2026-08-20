import type { Enemy, EnemyType } from '../types';

/**
 * Body shapes the renderer knows how to paint.
 *
 * A closed union on purpose: `Renderer.paintEnemyBody` switches over it with a
 * `never` default, so a new enemy given a shape nobody draws is a compile
 * error rather than an invisible enemy (gameplay plan §2.5).
 */
export type EnemyShape = 'circle' | 'diamond' | 'winged' | 'square' | 'hex' | 'mound';

export interface EnemyDef {
  type: EnemyType;
  baseHP: number;
  baseSpeed: number;
  armor: number;
  magicResist: number;
  baseDamage: number;
  fireRate: number;
  baseGold: number;
  unlockWave: number;
  radius: number;
  color: string;
  borderColor: string;
  shape: EnemyShape;
  glyph?: string;
  shieldCharges?: number;     // Shielded
  healRange?: number;         // Healer
  healFraction?: number;      // Healer: % of maxHP healed
  healCooldown?: number;      // Healer: seconds between heals
  splitChildren?: number;     // Splitter: children spawned on death
  splitHpFraction?: number;   // Splitter child HP fraction
  splitSpeedMultiplier?: number;
  rpChance?: number;          // 0-1, chance to drop 1 RP on kill
}

/**
 * Tuning for the behavioural roster (gameplay plan §2.1/§2.2).
 *
 * Every cadence here is measured in *simulation* seconds and consumed inside
 * `Game.simulate`'s fixed substeps, so a 3 s reload is 3 s of game time at
 * `dt = 1/120` and at 6.5x speed alike.
 */
export const ENEMY_BEHAVIOR = {
  /** Siege halts here and shells the tower from outside a short build's range. */
  siegeStandoff: 260,
  /** Seconds between siege lobs. */
  siegeReload: 3,
  /** Seconds a siege shell spends in the air (the telegraph). */
  siegeShellTravel: 1.2,
  /** Shell damage as a multiple of the siege enemy's melee damage. */
  siegeShellDamageMult: 3,

  /** Fraction of *current* gold a thief lifts on contact. */
  thiefStealFraction: 0.06,
  /** Hard ceiling on one theft, as a multiple of a normal enemy's wave drop. */
  thiefStealWaveGoldMult: 30,
  /** Ceiling on everything stolen during a single wave, as a fraction of current gold. */
  thiefWaveTheftCap: 0.15,
  /** Payout multiplier when a loaded thief is killed before it escapes. */
  thiefRecoveryMult: 2,
  /** Speed multiplier while a loaded thief is running for the edge. */
  thiefFleeSpeedMult: 1.35,

  /** Seconds between blinks. */
  blinkInterval: 3,
  /** Distance covered by one blink, in pixels. */
  blinkDistance: 140,
  /** Seconds of knockback/mine immunity a blink grants. */
  blinkImmunity: 0.3,

  /** Absorb pool a warden projects, as a fraction of its own max HP. */
  wardShieldFraction: 0.15,
  /** Allies a single warden can shield. */
  wardMaxTargets: 5,
  /** Radius the warden looks for allies in. */
  wardRange: 190,
  /** Seconds between shield refreshes. */
  wardRefresh: 4,

  /** Speed multiplier while burrowed. */
  burrowSpeedMult: 1.6,
  /** Distance from the tower at which a burrower breaks the surface. */
  burrowSurfaceDistance: 120,
  /** Seconds the surfacing telegraph lasts (the burrower cannot act during it). */
  burrowTelegraph: 1,

  /** HP fraction below which a healer turns and runs. */
  healerFleeThreshold: 0.4,
  /** Speed multiplier for a fleeing healer. */
  healerFleeSpeedMult: 1.15,

  /** Enemies in one `fast` spawn pack. */
  fastPackSize: 3,
  /** Radius the pack is scattered over at its shared spawn point. */
  fastPackSpread: 26,

  /** Seconds a splitter child is untargetable and immune after the split. */
  splitterSpawnProtection: 2,
  /** Seconds a splitter child spends scattering outwards before it turns in. */
  splitterScatterTime: 0.6,
  /** Speed multiplier applied to that scatter. */
  splitterScatterSpeedMult: 1.6,

  /** Seconds of taking no damage before a shielded enemy starts rebuilding. */
  shieldCalmBeforeRegen: 3,
  /** Seconds per restored shield charge, once calm. */
  shieldRegenInterval: 6,
} as const;

/**
 * Where each type's behaviour actually lives.
 *
 * A `Record` over the whole `EnemyType` union, exactly like
 * `ACHIEVEMENT_REWARD_CONSUMERS` and `BLESSING_BEHAVIOR_CONSUMERS`: a new enemy
 * type does not compile until someone has said what it *does*, and
 * `content-coverage.test.ts` rejects a placeholder. This is the mechanism that
 * stops the roster sliding back into thirteen stat blocks.
 */
export const ENEMY_BEHAVIOR_CONSUMERS: Record<EnemyType, string> = {
  normal: 'EnemyManager.tick — the baseline advance-and-melee branch, deliberately unchanged',
  fast: 'WaveManager.spawnOne — arrives in packs of three from one shared spawn point',
  tank: 'ProjectileManager.tick — body-blocks, so a shot never pierces past a tank',
  flying: 'EnemyManager.tick + Game mine loop — ignores the wall contact band and land mines',
  healer: 'EnemyManager.tick — heals allies, and flees while healing below 40% HP',
  boss: 'EnemyManager.damage — enrages at 50% HP; Part 3 owns the phase machine',
  splitter: 'Game enemy_killed + EnemyManager.spawnSplitterChild — children scatter under 2 s spawn protection',
  shielded: 'EnemyManager.tick — rebuilds a charge every 6 s after 3 s undamaged',
  siege: 'EnemyManager.tick — halts at 260 px and lobs hostile shells at the tower',
  thief: 'EnemyManager.tick — steals from current gold on contact, then runs for the arena edge',
  blinker: 'EnemyManager.tick — teleports 140 px every 3 s, ignoring knockback, mines and the wall',
  warden: 'EnemyManager.tick — projects a regenerating absorb shield onto up to five nearby allies',
  burrower: 'EnemyManager.tick — untargetable and invulnerable underground until it surfaces at 120 px',
};

/** Types the `priority` targeting mode reaches for, most urgent first. */
export const PRIORITY_TARGET_ORDER: readonly EnemyType[] = ['warden', 'healer', 'thief', 'siege'];

/**
 * Can the tower shoot this enemy at all?
 *
 * The single answer for every target-selection site in the game —
 * `Tower.acquireTarget`, the projectile sweep, and every picker in
 * `AbilityManager`. A burrower underground and a splitter child inside its
 * spawn protection are both *on the field* and both un-hittable; routing them
 * through one predicate is what stops a new target picker quietly being able to
 * shoot through the ground.
 */
export function isTargetable(enemy: Enemy): boolean {
  return enemy.alive && enemy.burrowed !== true && (enemy.spawnProtection ?? 0) <= 0;
}

/** True when land mines and knockback pass straight through this enemy. */
export function ignoresGroundEffects(enemy: Enemy): boolean {
  return enemy.type === 'flying' || (enemy.blinkImmunity ?? 0) > 0;
}

/** True when the enemy walks straight through the wall's extended contact band. */
export function ignoresWallBand(enemy: Enemy): boolean {
  return enemy.type === 'flying' || enemy.type === 'blinker';
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  normal: {
    type: 'normal',
    baseHP: 6,
    baseSpeed: 60,
    armor: 0,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 0.7,
    baseGold: 1,
    unlockWave: 1,
    radius: 12,
    color: '#d04848',
    borderColor: '#ffffff',
    shape: 'circle',
    rpChance: 0.01,
  },
  fast: {
    type: 'fast',
    baseHP: 4,
    baseSpeed: 120,
    armor: 0,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 1.2,
    baseGold: 2,
    unlockWave: 3,
    radius: 10,
    color: '#f1c40f',
    borderColor: '#7a6500',
    shape: 'diamond',
    rpChance: 0.02,
  },
  tank: {
    type: 'tank',
    baseHP: 20,
    baseSpeed: 30,
    armor: 3,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 0.85,
    baseGold: 3,
    unlockWave: 5,
    radius: 18,
    color: '#2c5b8f',
    borderColor: '#9aa7b5',
    shape: 'circle',
    rpChance: 0.03,
  },
  flying: {
    type: 'flying',
    baseHP: 7,
    baseSpeed: 90,
    armor: 0,
    magicResist: 0,
    baseDamage: 2,
    fireRate: 1.5,
    baseGold: 3,
    unlockWave: 8,
    radius: 11,
    color: '#ecf0f1',
    borderColor: '#2c3e50',
    shape: 'winged',
    rpChance: 0.04,
  },
  healer: {
    type: 'healer',
    baseHP: 12,
    baseSpeed: 50,
    armor: 0,
    magicResist: 0,
    baseDamage: 2,
    fireRate: 1.1,
    baseGold: 4,
    unlockWave: 15,
    radius: 14,
    color: '#27ae60',
    borderColor: '#0e3a1d',
    shape: 'circle',
    glyph: '+',
    healRange: 150,
    healFraction: 0.15,
    healCooldown: 2.5,
    rpChance: 0.05,
  },
  boss: {
    type: 'boss',
    baseHP: 120,
    baseSpeed: 40,
    armor: 6,
    magicResist: 0.15,
    baseDamage: 5,
    fireRate: 0.8,
    baseGold: 10,
    unlockWave: 10,
    radius: 30,
    color: '#7b1f1f',
    borderColor: '#ff5050',
    shape: 'circle',
    rpChance: 0.15,
  },
  splitter: {
    type: 'splitter',
    baseHP: 16,
    baseSpeed: 55,
    armor: 0,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 0.9,
    baseGold: 3,
    unlockWave: 12,
    radius: 16,
    color: '#9b59ff',
    borderColor: '#d3b3ff',
    shape: 'diamond',
    splitChildren: 2,
    splitHpFraction: 0.5,
    splitSpeedMultiplier: 1.4,
    rpChance: 0.03,
  },
  shielded: {
    type: 'shielded',
    baseHP: 10,
    baseSpeed: 40,
    armor: 0,
    magicResist: 0.3,
    baseDamage: 1,
    fireRate: 1.0,
    baseGold: 5,
    unlockWave: 20,
    radius: 14,
    color: '#5dade2',
    borderColor: '#1a5276',
    shape: 'circle',
    shieldCharges: 3,
    rpChance: 0.05,
  },
  // ── Behavioural roster (gameplay plan §2.1) ─────────────────────────────
  //
  // HP budgets are deliberately close to the existing mix's weighted mean: the
  // plan's §2.6 rule is that these types *replace* slots in the spawn table
  // rather than adding to `enemyCountForWave`, so total wave HP must not rise.
  // What each one costs the player is a wrong *build*, not a bigger bar.
  siege: {
    type: 'siege',
    baseHP: 12,
    baseSpeed: 42,
    armor: 2,
    magicResist: 0,
    baseDamage: 2,
    fireRate: 0.6,
    baseGold: 2,
    unlockWave: 25,
    radius: 15,
    color: '#a9752f',
    borderColor: '#f0d3a0',
    shape: 'square',
    rpChance: 0.05,
  },
  thief: {
    type: 'thief',
    baseHP: 7,
    baseSpeed: 135,
    armor: 0,
    magicResist: 0.1,
    baseDamage: 1,
    fireRate: 1.0,
    baseGold: 3,
    unlockWave: 30,
    radius: 11,
    color: '#d4af37',
    borderColor: '#3a2c00',
    shape: 'diamond',
    glyph: '$',
    rpChance: 0.06,
  },
  blinker: {
    type: 'blinker',
    baseHP: 9,
    baseSpeed: 28,
    armor: 0,
    magicResist: 0.25,
    baseDamage: 2,
    fireRate: 1.0,
    baseGold: 2,
    unlockWave: 35,
    radius: 12,
    color: '#7f5af0',
    borderColor: '#ded1ff',
    shape: 'circle',
    glyph: '✦',
    rpChance: 0.06,
  },
  warden: {
    type: 'warden',
    baseHP: 14,
    baseSpeed: 44,
    armor: 2,
    magicResist: 0.2,
    baseGold: 3,
    baseDamage: 2,
    fireRate: 0.8,
    unlockWave: 40,
    radius: 16,
    color: '#1f7a8c',
    borderColor: '#9fe8f5',
    shape: 'hex',
    rpChance: 0.07,
  },
  burrower: {
    type: 'burrower',
    baseHP: 9,
    baseSpeed: 52,
    armor: 1,
    magicResist: 0,
    baseDamage: 3,
    fireRate: 1.1,
    baseGold: 2,
    unlockWave: 45,
    radius: 13,
    color: '#7a5a30',
    borderColor: '#d8b578',
    shape: 'mound',
    rpChance: 0.06,
  },
};

/**
 * Draw weights for the non-boss spawn pool (gameplay plan §2.4).
 *
 * The single source of truth: `WaveManager.pickEnemyType`, the wave-average
 * estimates in `SaveManager` (offline progress) and `sim/model.ts` all read
 * this table. It used to be written out three times, which is exactly how a
 * balance change lands in the game and not in the model that is supposed to be
 * measuring it.
 *
 * The five behavioural types *replace* slots rather than adding them — `normal`
 * dropped 6→5 and `splitter` 2→1 to pay for them — because §2.6 requires total
 * wave HP not to rise. `boss` is 0: boss waves bypass the pool entirely.
 */
export const ENEMY_SPAWN_WEIGHTS: Record<EnemyType, number> = {
  normal: 5,
  fast: 3,
  tank: 2,
  flying: 2,
  splitter: 1,
  healer: 1,
  shielded: 1,
  siege: 2,
  thief: 1,
  blinker: 2,
  warden: 1,
  burrower: 2,
  boss: 0,
};

/** Types with a non-zero weight that have unlocked by `wave`, in table order. */
export function spawnPoolForWave(wave: number): Array<{ type: EnemyType; weight: number }> {
  const out: Array<{ type: EnemyType; weight: number }> = [];
  for (const type of Object.keys(ENEMY_SPAWN_WEIGHTS) as EnemyType[]) {
    const weight = ENEMY_SPAWN_WEIGHTS[type];
    if (weight <= 0) continue;
    if (wave < ENEMY_DEFS[type].unlockWave) continue;
    out.push({ type, weight });
  }
  return out;
}
