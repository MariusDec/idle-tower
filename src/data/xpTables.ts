import type { EnemyType } from '../types';
import { enemyHPForWave, bossHPForWave } from './formulas';
import { ENEMY_DEFS } from './enemies';

/**
 * Cumulative XP required to reach each level (plan §2.4).
 *
 * Was `120 * lv^2.35`, which put level 20 at ~147 K cumulative XP against a
 * kill worth 2 XP — tower level froze in the teens, so the 37-node talent tree
 * (~90 points to fill) could never show the player anything past tier 2. At
 * 1.8 the curve still slows down with depth, but a long-running save can
 * actually reach the bottom of the tree.
 */
export const TOWER_XP_CURVE_EXPONENT = 1.8;

export const TOWER_XP_TABLE: number[] = (() => {
  const table: number[] = [0];
  for (let lv = 1; lv <= 1999; lv++) {
    const needed = Math.floor(120 * Math.pow(lv, TOWER_XP_CURVE_EXPONENT));
    table.push(needed);
  }
  return table;
})();

/**
 * Returns the current level for a given total XP amount.
 *
 * The table is 2 000 entries and strictly ascending, and this is called on
 * every XP gain (i.e. every kill), so it binary-searches for the last entry at
 * or below `xp` rather than walking the table from level 1 (plan §5.6).
 */
export function xpToLevel(xp: number): number {
  if (xp < TOWER_XP_TABLE[1]) return 0;
  let lo = 1;
  let hi = TOWER_XP_TABLE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xp >= TOWER_XP_TABLE[mid]) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Returns XP needed to go from `level` to `level + 1`. */
export function xpForNextLevel(level: number): number {
  if (level < 0) return TOWER_XP_TABLE[1];
  if (level >= TOWER_XP_TABLE.length - 1) return Infinity;
  return TOWER_XP_TABLE[level + 1] - TOWER_XP_TABLE[level];
}

const BASE_XP_PER_KILL: Record<EnemyType, number> = {
  normal: 1,
  fast: 1,
  tank: 2,
  flying: 1,
  healer: 2,
  boss: 10,
  splitter: 1,
  shielded: 2,
  // Behavioural types (gameplay plan §2.1): the multiplier tracks how much of
  // the player's attention the type costs, not its HP bar — a warden or a
  // thief is worth going out of your way for, a blinker is a nuisance.
  siege: 2,
  thief: 3,
  blinker: 2,
  warden: 3,
  burrower: 2,
};

/**
 * XP earned from killing one enemy of a given type at a given wave (plan §2.4).
 *
 * Was a flat `1 + 0.02 * wave`, which meant a wave-50 kill was worth 2 XP no
 * matter that the enemy had 1 000x the HP of a wave-1 kill. XP now tracks the
 * enemy's actual wave-scaled HP through `log2`, so deeper waves pay
 * meaningfully more without the reward itself going exponential.
 */
export function xpPerKill(type: EnemyType, wave: number): number {
  return Math.max(1, Math.floor(BASE_XP_PER_KILL[type] * enemyXpWeight(type, wave)));
}

/**
 * How much an enemy of this type is "worth" in XP terms at this wave, as a
 * multiple of its wave-1 self. Shared by the tower and passive XP tracks so
 * both keep pace with the HP curve instead of drifting apart.
 */
export function enemyXpWeight(type: EnemyType, wave: number): number {
  const def = ENEMY_DEFS[type];
  const hp = type === 'boss'
    ? bossHPForWave(def.baseHP, wave)
    : enemyHPForWave(def.baseHP, wave);
  return Math.max(1, Math.log2(Math.max(2, hp)));
}

/** XP earned from clearing a wave. */
export function xpPerWaveClear(wave: number): number {
  return Math.floor(5 + wave * 0.5);
}

/** Bonus talent points granted on every Nth level, on top of the per-level one. */
export const TALENT_BONUS_LEVEL_INTERVAL = 5;

/**
 * XP required for a passive ability to reach the next level (plan §2.5).
 *
 * At the old `75 * level^2.2` — against a flat 1 XP per kill scaled by 0.07 —
 * Marksmanship's level 50 needed roughly six million kills, so the XP bar was
 * decoration and passives were a pure gold sink. Flattened here, and paired
 * with wave-scaled XP gain, so the idle track actually resolves.
 */
export function passiveXpForLevel(level: number): number {
  return Math.floor(75 * Math.pow(level, 1.9));
}

/** XP required for an active ability to reach the next level. */
export function abilityXpForLevel(level: number): number {
  return Math.floor(50 * Math.pow(level, 1.5));
}

/**
 * Total talent points granted by the time the tower reaches `level`
 * (plan §2.4): one per level, plus a bonus point every fifth level.
 */
export function talentPointsAtLevel(level: number): number {
  if (level <= 0) return 0;
  return level + Math.floor(level / TALENT_BONUS_LEVEL_INTERVAL);
}
