import type { EnemyType } from '../types';
import { bossEncounterWeight, enemyCountForWave, isBossWave } from './formulas';

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

/**
 * What one kill of `type` is worth in *bodies*, at depth `wave`.
 *
 * Always 1 except for a boss, which is worth the whole encounter: a boss wave
 * used to spawn `bossEncounterWeight` bosses and now spawns one, so the single
 * kill has to pay what the pack paid or a boss wave becomes the worst XP in the
 * game. Shared by tower XP and passive XP so the two cannot drift.
 */
function killWeight(type: EnemyType, wave: number): number {
  return type === 'boss' && isBossWave(wave) ? bossEncounterWeight(wave) : 1;
}

export function xpPerKill(type: EnemyType, wave: number): number {
  return Math.max(
    1,
    Math.round(KILL_XP_WEIGHT[type] * killXpWaveScale(wave) * killWeight(type, wave)),
  );
}

// ── Passive-ability XP (passives redesign §3) ───────────────────────────────
//
// The requirement curve is anchored to the *unlock wave's own faucet*, which is
// the whole fix: before this, every passive shared one flat requirement table
// while the faucet grew with the live wave, so a passive that unlocked at wave
// 65 finished ten levels inside its first wave. `passiveWaveXpRef` is the XP one
// ordinary wave at depth `w` pays out, and `def.xpBase` is six of those — so
// level 1 of every passive costs six waves of play at the depth it unlocks.

/** Per-kill scale factor. Kept at 1 so the numbers in the tables read directly. */
export const PASSIVE_KILL_XP_FACTOR = 1;

/** A wave clear is worth this many kills' worth of passive XP. */
export const PASSIVE_WAVE_CLEAR_XP_MULTIPLIER = 12;

/** Passive XP a single kill of `type` at depth `wave` pays. */
export function passiveXpPerKill(type: EnemyType, wave: number): number {
  return KILL_XP_WEIGHT[type] * killXpWaveScale(wave) * PASSIVE_KILL_XP_FACTOR
    * killWeight(type, wave);
}

/** Passive XP clearing wave `wave` pays, on top of the kills in it. */
export function passiveXpPerWaveClear(wave: number): number {
  return killXpWaveScale(wave) * PASSIVE_KILL_XP_FACTOR * PASSIVE_WAVE_CLEAR_XP_MULTIPLIER;
}

/**
 * Passive XP one ordinary (non-boss) wave at depth `w` is expected to pay.
 *
 * Reference quantity only — nothing awards it. It exists so `xpBase` in the
 * passive table can be quoted in *waves of play* rather than as a magic number,
 * and so a test can assert the two have not drifted apart.
 */
export function passiveWaveXpRef(wave: number): number {
  return (enemyCountForWave(wave) + PASSIVE_WAVE_CLEAR_XP_MULTIPLIER)
    * killXpWaveScale(wave)
    * PASSIVE_KILL_XP_FACTOR;
}

/** Waves of play at the unlock wave that level 1 of a passive is priced at. */
export const PASSIVE_XP_LEVEL_WAVES = 6;

/** Requirement curve exponents. Polynomial for shape, geometric for the tail. */
export const PASSIVE_XP_POLY = 1.5;
export const PASSIVE_XP_GEO = 1.10;

/**
 * XP to go from `level - 1` to `level`, for a passive with the given `xpBase`.
 *
 *   xpBase * level^1.5 * 1.10^(level-1)
 *
 * `xpBase` is `round2sig(PASSIVE_XP_LEVEL_WAVES * passiveWaveXpRef(unlockWave))`
 * and is a literal in the passive table.
 */
export function passiveXpForLevel(def: { xpBase: number }, level: number): number {
  if (level <= 0) return 0;
  return Math.round(
    def.xpBase * Math.pow(level, PASSIVE_XP_POLY) * Math.pow(PASSIVE_XP_GEO, level - 1),
  );
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
 * @deprecated Used by AbilityManager, AbilityPanel.
 * Will be updated in a future step.
 */
export function abilityXpForLevel(level: number): number {
  return Math.floor(50 * Math.pow(level, 1.5));
}
