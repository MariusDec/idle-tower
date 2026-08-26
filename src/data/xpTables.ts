import type { EnemyType } from '../types';

/**
 * Per-kill XP weight by type. Tracks how much of the player's *attention* a
 * type costs, not its HP bar — the wave scale below carries depth.
 */
export const KILL_XP_WEIGHT: Record<EnemyType, number> = {
  normal: 1,
  fast: 1,
  splitter: 0.8,
  flying: 1.1,
  tank: 1.8,
  healer: 1.6,
  shielded: 1.6,
  siege: 1.8,
  blinker: 1.5,
  burrower: 1.6,
  thief: 2.4,
  warden: 2.4,
  boss: 12,
};

/** Per-kill XP is linear in wave: a wave-200 kill is 41x a wave-1 kill. */
export const KILL_XP_WAVE_SLOPE = 0.20;

/** Wave-clear XP is superlinear: clearing deep waves is the real faucet. */
export const WAVE_CLEAR_XP_BASE = 1.5;
export const WAVE_CLEAR_XP_EXPONENT = 1.5;

/**
 * Extra multiple of the clear payout for a wave deeper than any ever cleared.
 * Total for a record wave is therefore (1 + this) x the normal clear XP.
 */
export const PIONEER_CLEAR_MULTIPLIER = 2.0;

/** Hard ceiling. Levels past this earn nothing; the HUD bar reads MAX. */
export const TOWER_LEVEL_CAP = 200;

/**
 * The requirement curve: `XP_CURVE_BASE * (L-1)^XP_CURVE_POLY * XP_CURVE_GEO^(L-2)`
 * XP to go from level L-1 to level L.
 *
 * Polynomial early (so the first twenty levels land inside the first hour) and
 * geometric late (so the cap is a horizon rather than a milestone). The old
 * curve was polynomial all the way, which is why XP gain — itself ~w^2 per
 * wave — outran it and the tree filled in one run.
 */
export const XP_CURVE_BASE = 25;
export const XP_CURVE_POLY = 1.6;
export const XP_CURVE_GEO = 1.028;

/** Cumulative XP required to *be* each level. Index 0 unused, index 1 is 0. */
export const TOWER_XP_TABLE: number[] = (() => {
  const table: number[] = [0, 0];
  for (let lv = 2; lv <= TOWER_LEVEL_CAP; lv++) {
    const needed = Math.floor(
      XP_CURVE_BASE * Math.pow(lv - 1, XP_CURVE_POLY) * Math.pow(XP_CURVE_GEO, lv - 2),
    );
    table.push(table[lv - 1] + needed);
  }
  return table;
})();

/** Per-kill wave scale. Linear, so the enemy roster's weights stay legible. */
export function killXpWaveScale(wave: number): number {
  return 1 + KILL_XP_WAVE_SLOPE * Math.max(1, wave);
}

export function xpPerKill(type: EnemyType, wave: number): number {
  return Math.max(1, Math.round(KILL_XP_WEIGHT[type] * killXpWaveScale(wave)));
}

/**
 * Passive-ability XP earned per kill. Uses the passive def's own `xpPerKill`
 * weight scaled by the same wave curve as tower kill XP, with a 0.25 factor
 * that keeps the passive track's pace where it is today.
 */
export function passiveXpPerKill(def: { xpPerKill: number }, wave: number): number {
  return Math.max(1, Math.round(def.xpPerKill * killXpWaveScale(wave) * 0.25));
}

export function xpPerWaveClear(wave: number): number {
  return Math.max(1, Math.round(
    WAVE_CLEAR_XP_BASE * Math.pow(Math.max(1, wave), WAVE_CLEAR_XP_EXPONENT),
  ));
}

/** Clearing deeper than you ever have pays the clear XP again, doubled. */
export function pioneerBonusXp(wave: number, lifetimeHighestWave: number): number {
  if (wave <= lifetimeHighestWave) return 0;
  return Math.round(xpPerWaveClear(wave) * PIONEER_CLEAR_MULTIPLIER);
}

export function xpToLevel(xp: number): number {
  if (xp < TOWER_XP_TABLE[2]) return 1;
  let lo = 1;
  let hi = TOWER_LEVEL_CAP;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xp >= TOWER_XP_TABLE[mid]) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** XP needed to go from `level` to `level + 1`; Infinity at the cap. */
export function xpForNextLevel(level: number): number {
  if (level < 1) return TOWER_XP_TABLE[2];
  if (level >= TOWER_LEVEL_CAP) return Infinity;
  return TOWER_XP_TABLE[level + 1] - TOWER_XP_TABLE[level];
}

export function talentPointsAtLevel(level: number): number {
  return Math.max(0, Math.min(TOWER_LEVEL_CAP, Math.floor(level)));
}

// ── Legacy exports (kept for downstream consumers) ──────────────────────────

/**
 * @deprecated Used by SaveManager, AbilityPanel, PassivePanel.
 * Will be updated in a future step.
 */
export function passiveXpForLevel(level: number): number {
  return Math.floor(75 * Math.pow(level, 1.9));
}

/**
 * @deprecated Used by AbilityManager, AbilityPanel.
 * Will be updated in a future step.
 */
export function abilityXpForLevel(level: number): number {
  return Math.floor(50 * Math.pow(level, 1.5));
}
