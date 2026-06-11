import type { EnemyType } from '../types';

/**
 * Cumulative XP required to reach each level.
 * Formula: floor(100 * lv^1.5)
 */
export const TOWER_XP_TABLE: number[] = (() => {
  const table: number[] = [0];
  for (let lv = 1; lv <= 2000; lv++) {
    const needed = Math.floor(100 * Math.pow(lv, 1.5));
    table.push(needed);
  }
  return table;
})();

/** Returns the current level for a given total XP amount. */
export function xpToLevel(xp: number): number {
  let level = 0;
  for (let i = 1; i < TOWER_XP_TABLE.length; i++) {
    if (xp >= TOWER_XP_TABLE[i]) level = i;
    else break;
  }
  return level;
}

/** Returns XP needed to go from `level` to `level + 1`. */
export function xpForNextLevel(level: number): number {
  if (level < 0) return TOWER_XP_TABLE[1];
  if (level >= TOWER_XP_TABLE.length - 1) return Infinity;
  return TOWER_XP_TABLE[level + 1] - TOWER_XP_TABLE[level];
}

/** XP earned from killing one enemy of a given type at a given wave. */
export function xpPerKill(type: EnemyType, wave: number): number {
  const baseXp: Record<EnemyType, number> = {
    normal: 1,
    fast: 1,
    tank: 2,
    flying: 1,
    healer: 2,
    boss: 10,
    splitter: 1,
    shielded: 2,
  };
  return Math.floor(baseXp[type] * (1 + wave * 0.02));
}

/** XP earned from clearing a wave. */
export function xpPerWaveClear(wave: number): number {
  return Math.floor(5 + wave * 0.5);
}

/** XP required for a passive ability to reach the next level. */
export function passiveXpForLevel(level: number): number {
  return Math.floor(50 * Math.pow(level, 1.4));
}

/** Talent points granted at a given tower level (1 per level). */
export function talentPointsAtLevel(level: number): number {
  return level;
}
