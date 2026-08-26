/**
 * Growth rate of trash-mob HP per wave. Paired with `GOLD_GROWTH` below: the
 * gap between the two is the rate at which the economy falls behind the
 * difficulty, and it is the single most important number in the game.
 * At 1.11 vs 1.08 gold-per-HP decays ~1.028^wave — a factor of 10 every
 * ~85 waves, instead of every ~21.
 */
export const ENEMY_HP_GROWTH = 1.11;

/** Growth rate of an enemy's gold drop per wave. See `ENEMY_HP_GROWTH`. */
export const GOLD_GROWTH = 1.08;

export function enemyHPForWave(baseHP: number, wave: number): number {
  return baseHP * Math.pow(ENEMY_HP_GROWTH, Math.max(0, wave - 1));
}

export function enemyDamageForWave(baseDamage: number, wave: number): number {
  return baseDamage * Math.pow(1.1, Math.max(0, wave));
}

/**
 * Per-tier bump applied to bosses on top of the shared HP curve.
 *
 * Bosses used to grow on their own exponent (`1.12^wave * 1.35^tier`), which
 * ran away from the trash curve — a wave-100 boss was 724x a wave-100 trash
 * mob and the boss wave carried 42x the HP of the wave before it. Anchoring
 * bosses to `ENEMY_HP_GROWTH` and bumping only per tier keeps a boss wave a
 * ~2-3x spike over its neighbours at every depth, which is what makes it an
 * event rather than a wall.
 */
export const BOSS_TIER_GROWTH = 1.07;

export function bossHPForWave(baseHP: number, wave: number): number {
  const waveIndex = Math.max(0, wave - 1);
  const tier = Math.floor(waveIndex / 10);
  return baseHP * Math.pow(ENEMY_HP_GROWTH, waveIndex) * Math.pow(BOSS_TIER_GROWTH, tier);
}

export function enemySpeedForWave(baseSpeed: number, wave: number): number {
  const mult = 1 + 0.03 * Math.max(0, wave - 1);
  return baseSpeed * Math.min(3, mult);
}

export function goldDropForWave(baseGold: number, wave: number): number {
  return baseGold * Math.pow(GOLD_GROWTH, Math.max(0, wave - 1));
}

export function enemyCountForWave(wave: number): number {
  return 5 + Math.floor((wave - 1) * 1.2);
}

export function bossCountForWave(wave: number): number {
  const tier = Math.max(1, Math.floor(wave / 10));
  return 2 + Math.max(0, tier - 1);
}

export function spawnCountForWave(wave: number): number {
  if (isBossWave(wave)) return bossCountForWave(wave);
  return enemyCountForWave(wave);
}

export function spawnIntervalForWave(wave: number): number {
  return Math.max(0.4, 2.0 - wave * 0.04);
}

export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % 10 === 0;
}

export function evalFormula(formula: string, level: number): number {
  const expr = formula.replace(/\{level\}/g, String(level));
  return Function('"use strict"; return (' + expr + ')')();
}

export function upgradeCost(base: number, growth: number | string, level: number): number {
  const g = typeof growth === 'string' ? evalFormula(growth, level) : growth;
  return Math.floor(base * Math.pow(g, level));
}

/**
 * Cost of upgrading an ability from its current level to the next.
 * Mirrors the tower-upgrade cost shape but takes a plain numeric growth.
 *   cost(level) = floor(baseCost * growth^level)
 */
export function abilityUpgradeCost(baseCost: number, growth: number, level: number): number {
  if (level <= 0) return Math.floor(baseCost);
  return Math.floor(baseCost * Math.pow(growth, level));
}

// ── Lifetime ascension bonus (plan §2.3.5) ────────────────────────────────
//
// This used to be a flat linear `0.02 * lifetimeAP` — +2% damage for every AP
// ever earned. Linear in a currency that itself grows exponentially with wave
// depth means it eventually dwarfs every perk, talent and piece of gear in the
// game, and it does so without the player making a single decision. It is now
// a sub-linear power law: still the reason a veteran opens faster than a new
// player, but no longer the only thing that matters. Deliberate progression —
// AP perks, talents, research — is what carries the late curve.

const LIFETIME_AP_COEFFICIENT = 0.02;
const LIFETIME_AP_EXPONENT = 0.7;

/** Permanent damage bonus from lifetime ascension points (0.5 = +50%). */
export function lifetimeAPDamageBonus(lifetimeAP: number): number {
  const ap = Math.max(0, lifetimeAP);
  if (ap <= 0) return 0;
  return LIFETIME_AP_COEFFICIENT * Math.pow(ap, LIFETIME_AP_EXPONENT);
}

/** Permanent gold bonus from lifetime ascension points. */
export function lifetimeAPGoldBonus(lifetimeAP: number): number {
  return lifetimeAPDamageBonus(lifetimeAP);
}

// ── Wave pacing / enrage (plan §2.3.3) ────────────────────────────────────
//
// A wave should take roughly a constant amount of time at the player's
// comfortable depth and only blow out at the wall. Without a fail state the
// tower simply stops killing fast enough while enemies trickle in too slowly
// to finish it — the run neither ends nor progresses. Enrage is that fail
// state: once a wave overruns, enemies get stronger every few seconds until
// they take the tower down, turning an endless stall into a run-over moment.

/** Seconds a wave is *expected* to take beyond its own spawn cadence. */
export const TARGET_WAVE_KILL_SECONDS = 20;

/** Kill budget a *single* boss is expected to need. Boss waves get one each. */
export const TARGET_BOSS_KILL_SECONDS = 28;

/** A wave running longer than `expectedWaveSeconds * this` starts enraging. */
export const ENRAGE_THRESHOLD_MULTIPLIER = 2;

/** Seconds between enrage stacks once a wave has overrun. */
export const ENRAGE_STACK_INTERVAL = 8;

/** Extra damage-to-tower per enrage stack (additive: +40% per stack). */
export const ENRAGE_DAMAGE_PER_STACK = 0.4;

/** Extra movement speed per enrage stack (additive: +15% per stack). */
export const ENRAGE_SPEED_PER_STACK = 0.15;

/**
 * How long a wave ought to take: the time its enemies need just to finish
 * spawning, plus a flat window to kill them in.
 *
 * `enemyCount` defaults to the wave's natural size but must be passed when a
 * mutator has changed it — a Swarm wave spawns 3x the enemies and legitimately
 * takes 3x as long to spawn them, and must not be punished for that.
 *
 * A boss wave's kill window is per *boss*, not flat: a boss is several times
 * the effective HP of the trash it replaces, so a flat window made every boss
 * wave the only real gate in the game (revamp §10).
 */
export function expectedWaveSeconds(wave: number, enemyCount = spawnCountForWave(wave)): number {
  const kill = isBossWave(wave)
    ? TARGET_BOSS_KILL_SECONDS * enemyCount
    : TARGET_WAVE_KILL_SECONDS;
  return spawnIntervalForWave(wave) * Math.max(0, enemyCount - 1) + kill;
}

/** Seconds into a wave at which enrage begins. */
export function enrageThresholdSeconds(wave: number, enemyCount?: number): number {
  return expectedWaveSeconds(wave, enemyCount) * ENRAGE_THRESHOLD_MULTIPLIER;
}

/** Number of enrage stacks for a wave that has been running `elapsed` seconds. */
export function enrageStacksFor(wave: number, elapsed: number, enemyCount?: number): number {
  const over = elapsed - enrageThresholdSeconds(wave, enemyCount);
  if (over < 0) return 0;
  return 1 + Math.floor(over / ENRAGE_STACK_INTERVAL);
}

// ── Economy ceilings (revamp §6.2) ────────────────────────────────────────
//
// Every purchased gold multiplier used to compound without a ceiling, so run
// income grew 1.185x per wave against a 1.08 cost ruler and one wave of income
// bought one damage level at *every* depth. These three caps are the ones that
// need code rather than a data-table field; they live here so the clamp and
// the number a doc quotes are the same constant.

/** Avarice: hardest gold bonus a kill streak can reach (+75%). */
export const AVARICE_STREAK_GOLD_CAP = 0.75;

/**
 * Avarice's gold bonus for a streak of `streak` kills at `perKill` each.
 *
 * A deep wave can sustain a streak as long as its own enemy count (~50 near
 * the wall), so uncapped this was worth over +200% gold from one purchase.
 */
export function avariceStreakGoldBonus(streak: number, perKill: number): number {
  const raw = Math.max(0, streak - 1) * Math.max(0, perKill);
  return Math.min(AVARICE_STREAK_GOLD_CAP, raw);
}

/** Dragon's Hoard: hardest gold bonus waves-survived can reach (+50%). */
export const DRAGON_HOARD_GOLD_CAP = 0.50;

/** Wave Mastery chain: bonus per wave cleared, and the waves it counts. */
export const WAVE_MASTERY_CHAIN_PER_WAVE = 0.1;
export const WAVE_MASTERY_CHAIN_MAX_WAVES = 20;

/**
 * Wave Mastery's chain multiplier on the flat wave-clear payout.
 *
 * Was `1 + cleared * 0.5` with no ceiling — x21 by wave 40, on a line whose
 * own level is already an economy purchase. Capped at x3 (revamp §6.2.3);
 * Golden Tide multiplies on top of this, not into it.
 */
export function waveMasteryChainMultiplier(cleared: number): number {
  return 1 + Math.min(Math.max(0, cleared), WAVE_MASTERY_CHAIN_MAX_WAVES)
    * WAVE_MASTERY_CHAIN_PER_WAVE;
}
