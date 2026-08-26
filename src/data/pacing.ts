import type { EnemyType } from '../types';

/**
 * Pacing constants (gameplay plan §7).
 *
 * Part 7 is four small mechanics that share one job: remove the dead air
 * between waves and make the second-to-second reward for paying attention
 * visible. Their numbers live together here because they are balanced
 * together — the early-call bonus, the combo meter and the risk dial are all
 * gold faucets pointed at the same curve, and `sim/balance.ts` measures the
 * three of them against one table.
 *
 * ## Why every bonus here is a *percentage of gold*, never a payload
 *
 * The follow-up to Part 4 recorded the lesson twice over: a bonus denominated
 * in "one shot" or "one kill" is not a constant, because it is silently
 * divided by every fire-rate purchase the player will ever make. Part 6 found
 * the mirror image — a per-shot payload can be far *too* strong at low fire
 * rate. Nothing in this file is denominated in shots or kills:
 *
 *   - the early-call bonus is `%/second of intermission skipped`, and seconds
 *     of intermission are the same length at every tower size;
 *   - the combo meter's tiers are counted in *kills within a window*, which is
 *     a throughput-proportional quantity by construction: a tower with twice
 *     the fire rate reaches tier 3 twice as fast and holds it just as long, so
 *     the tier is a function of how well the wave is going rather than of how
 *     many upgrades are bought;
 *   - the risk dial and the combo both pay as multipliers on gold, which
 *     scales with the curve rather than against it;
 *   - overkill carry is a fraction of damage *already dealt*, so it is
 *     proportional to the tower's own output at every depth.
 */

// ── §7.1 Call the wave early ──────────────────────────────────────────────

/**
 * Gold bonus earned per second of intermission the player skips.
 *
 * §7.1 says +3%/second capped at +40%. **Both numbers measured about four
 * times too strong** and are cut proportionally, which is the only way to cut
 * them: the cap has to sit a few calls above one call's worth, or momentum
 * stops being a streak and becomes a button that is either pressed or not.
 *
 * The measurement, from `npm run sim`'s §4.5 table: momentum is a flat
 * multiplier on an active run's gold, and §4.5's budget was already spent
 * before Part 7 opened (+35.5…+19.0% across the tiers, against a +50% hard
 * gate). At +40% the active advantage measured **+60…+69% at every tier** —
 * comfortably past the gate. At +6% every tier lands inside the preferred
 * +25-40% band, which no shipped configuration had managed since Part 4.
 *
 * There is also a reward here the §4.5 metric cannot see, and it argues for
 * the smaller number rather than against it: calling a wave early *is* a
 * throughput gain — five seconds off a forty-second cycle is ~12% more waves
 * per hour — and the model measures composed DPS at a matched wave, which
 * credits none of that. The gold bonus is a garnish on a reward the player has
 * already collected.
 *
 * At 1%/second one call is worth +5% at wave 20 or shallower, +3% to wave 50
 * and +2% past it, so the cap takes two to three consecutive calls at every
 * depth — the streak shape §7.1 describes, at a size the curve can pay for.
 */
export const EARLY_CALL_GOLD_PER_SECOND = 0.01;

/**
 * Hard ceiling on accumulated momentum, as a gold fraction.
 *
 * The cap binds on the *momentum counter*, not on a single call — see
 * `EARLY_CALL_GOLD_PER_SECOND` for why it is +6% rather than §7.1's +40%.
 */
export const MOMENTUM_CAP = 0.06;

// ── §7.2 Combo meter ──────────────────────────────────────────────────────

/**
 * Seconds of **simulation** time a combo survives without a kill.
 *
 * Simulation, not wall clock: kills are simulation events, so the interval
 * between two of them is a simulation-time quantity. On the wall clock a 2 s
 * window would be 0.3 s at 6.5x speed and no combo would ever chain, so the
 * same play would pay differently depending on a speed setting that is
 * supposed to cost nothing. Contrast the two timers that deliberately run on
 * `realDt` — Part 1's draft countdown and Part 4's charge hold — both of which
 * measure *a person*, not the field.
 */
export const COMBO_WINDOW_SECONDS = 2;

export interface ComboTier {
  /** Kills required to reach this tier. */
  kills: number;
  /** Gold bonus, as a multiplicative fraction. */
  gold: number;
  /** Tower-XP bonus, as a multiplicative fraction. */
  xp: number;
  label: string;
}

/**
 * The four combo tiers (plan §7.2).
 *
 * Ordered ascending and read by index: `comboTierIndex` returns 0 for "no
 * combo" and 1-4 for the tiers, so the index doubles as the meter's pip count.
 *
 * **About half §7.2's stated 5/12/25/40.** The combo is not an active-play
 * reward — nothing the player *does* builds it, the tower builds it by killing
 * things — so it is a **baseline income faucet**, and §7.2's only stated
 * compensation (cutting `kill_streak_gold`) cannot pay for it: that evolution
 * is a level-25 unlock on one economy upgrade, while the combo pays from wave 1
 * on every run.
 *
 * Measured with `npm run sim`. Integrated over a 50-enemy wave — the depth the
 * 0-AP wall sits at — the plan's values are worth **+8.0% of that wave's entire
 * income**, and six of eight draft seeds then moved the 0-AP idle wall a full
 * boss decade (39 → 49). These values are worth +4.1% and move one seed of
 * eight. The remaining seed is not this mechanic's doing: the 0-AP tier sits
 * within 5% of a boss-wave boundary, and one seed already reports 49 with
 * Part 7 switched off entirely.
 *
 * The tiers keep the plan's shape — roughly doubling per tier, topping out
 * below the point where a combo would outweigh the upgrades that earned it.
 */
export const COMBO_TIERS: readonly ComboTier[] = [
  { kills: 10, gold: 0.1, xp: 0.1, label: 'Chain' },
  { kills: 25, gold: 0.2, xp: 0.2, label: 'Streak' },
  { kills: 50, gold: 0.5, xp: 0.5, label: 'Rampage' },
  { kills: 100, gold: 1, xp: 1, label: 'Massacre' },
] as const;

/** Tier index for a kill count: 0 when below the first threshold. */
export function comboTierIndex(kills: number): number {
  let tier = 0;
  for (let i = 0; i < COMBO_TIERS.length; i++) {
    if (kills >= COMBO_TIERS[i].kills) tier = i + 1;
  }
  return tier;
}

/** Gold/XP bonus for a tier index, both 0 at tier 0. */
export function comboBonus(tier: number): { gold: number; xp: number } {
  const t = COMBO_TIERS[tier - 1];
  return t ? { gold: t.gold, xp: t.xp } : { gold: 0, xp: 0 };
}

/** Name of a tier index, or null at tier 0. */
export function comboTierLabel(tier: number): string | null {
  return COMBO_TIERS[tier - 1]?.label ?? null;
}

/**
 * Kills needed for the next tier, or null at the top.
 *
 * Drives the meter's "12 → 25" readout, which is the whole reason the meter is
 * worth screen space: a number with no target is a number nobody plays toward.
 */
export function comboNextThreshold(kills: number): number | null {
  for (const t of COMBO_TIERS) {
    if (kills < t.kills) return t.kills;
  }
  return null;
}

// ── §7.4 Risk dial ────────────────────────────────────────────────────────

/** Highest risk step. The dial is `0..MAX_RISK` inclusive. */
export const MAX_RISK = 5;

/**
 * What one step of the dial costs and pays.
 *
 * Additive per step rather than compounding, matching the only other stacking
 * difficulty channel in the game (`ENRAGE_DAMAGE_PER_STACK`). At risk 5 that
 * is x1.90 enemy HP and x1.40 enemy speed for x2.25 gold and x1.50 AP — a
 * trade that is clearly worth taking if you can hold the line and clearly
 * fatal if you cannot, which is the only shape that makes a dial a decision.
 */
export const RISK_HP_PER_STEP = 0.18;
export const RISK_SPEED_PER_STEP = 0.08;
export const RISK_GOLD_PER_STEP = 0.25;
export const RISK_AP_PER_STEP = 0.10;

export function clampRisk(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(MAX_RISK, Math.floor(level)));
}

export function riskHpMult(risk: number): number {
  return 1 + RISK_HP_PER_STEP * clampRisk(risk);
}

export function riskSpeedMult(risk: number): number {
  return 1 + RISK_SPEED_PER_STEP * clampRisk(risk);
}

export function riskGoldMult(risk: number): number {
  return 1 + RISK_GOLD_PER_STEP * clampRisk(risk);
}

/** AP bonus fraction from the dial — `previewAP` multiplies by `1 + this`. */
export function riskApBonus(risk: number): number {
  return RISK_AP_PER_STEP * clampRisk(risk);
}

// ── §7.5 Overkill carry ───────────────────────────────────────────────────

/**
 * Baseline share of a killing blow's excess damage that carries to the nearest
 * other enemy. The `overkill_carry` blessing (plan §1.3) raises it to
 * `BLESSING_TUNING.overkillCarry`; there is one mechanism, not two.
 */
export const OVERKILL_CARRY_BASE = 0.10;

// ── §7.6 Intermission length ──────────────────────────────────────────────

/** Intermission at wave 1. Every other length is a multiple of this. */
export const BASE_INTERMISSION_SECONDS = 5;

/** Seconds of intermission a wave earns: 5 s, then 3 s past 20, 2 s past 50. */
export function intermissionSecondsForWave(wave: number): number {
  if (wave > 50) return 2;
  if (wave > 20) return 3;
  return BASE_INTERMISSION_SECONDS;
}

/**
 * The same thing as a multiplier on `intermissionMultiplier`.
 *
 * Routed through the existing stat rather than a new mechanism (§7.6's own
 * instruction), so it composes with the Efficient Deployment research node
 * instead of one of them silently winning.
 */
export function intermissionFactorForWave(wave: number): number {
  return intermissionSecondsForWave(wave) / BASE_INTERMISSION_SECONDS;
}

// ── §7.3 Threat preview ───────────────────────────────────────────────────

/**
 * How loudly a type should be named in the next-wave readout.
 *
 * A `Record` over `EnemyType` rather than a list of "interesting" types, for
 * the reason cross-cutting rule 3 exists: a type added to the roster without
 * a threat classification does not compile, so a new enemy cannot ship as one
 * the preview quietly folds into "12 enemies".
 *
 * `trash` types are counted and not named; `threat` types are named because
 * each is a question with a specific answer (§2.1) and the preview is the
 * window in which the player can still change the answer — the targeting
 * selector, a saved cooldown, a placed mine.
 */
export type ThreatClass = 'trash' | 'threat' | 'boss';

export const ENEMY_THREAT_CLASS: Record<EnemyType, ThreatClass> = {
  normal: 'trash',
  fast: 'trash',
  splitter: 'trash',
  tank: 'threat',
  flying: 'threat',
  healer: 'threat',
  shielded: 'threat',
  siege: 'threat',
  thief: 'threat',
  blinker: 'threat',
  warden: 'threat',
  burrower: 'threat',
  boss: 'boss',
};
