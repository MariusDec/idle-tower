import type { TargetingMode, TowerState } from '../types';

export const TOWER_BASE: Omit<TowerState, 'cooldown'> = {
  x: 0,
  y: 0,
  baseDamage: 0,
  fireRate: 1.0,
  range: 300,
  critChance: 0.05,
  critMultiplier: 2,
  doubleShotChance: 0,
  quickShotChance: 0,
  quickShotTime: 0,
  damageType: 'physical',
  targetingMode: 'priority',
  hp: 0,
  maxHp: 0,
  healthRegen: 0,
  defense: 0,
  armor: 0,
  knockbackForce: 0,
  shockwaveSize: 0,
  shockwaveCooldown: 0,
  shockwaveTimer: 0,
  lifesteal: 0,
  thorns: 0,
  landMineDamage: 0,
  landMineFrequency: 0,
  landMineTimer: 0,
  wallHp: 0,
  wallMaxHp: 0,
  shieldMaxCharges: 0,
  shieldCurrentCharges: 0,
  shieldRechargeTimer: 0,
  shieldRechargeTime: 0,
};

export const PROJECTILE_SPEED = 720;

export const TOWER_VISUAL = {
  bodyRadius: 28,
  bodyColor: '#5b6b7a',
  bodyStroke: '#2a2f38',
  roofColor: '#7a4a2a',
  flagColor: '#c0392b',
  accentColor: '#8a99a8',
};

export const TOWER_HIT_RADIUS = TOWER_VISUAL.bodyRadius + 4;

/**
 * Targeting modes, in the order they are offered (gameplay plan §2.3).
 *
 * Shared by the HUD dropdown and the Settings panel so the two cannot drift.
 * `priority` leads because it is the default and, with the behavioural roster
 * on the field, the correct answer most of the time.
 */
export const TARGETING_MODES: ReadonlyArray<{ id: TargetingMode; label: string; hint: string }> = [
  { id: 'priority', label: 'Priority', hint: 'Warden → Healer → Thief → Siege, then nearest' },
  { id: 'nearest', label: 'Nearest', hint: 'Closest enemy to the tower' },
  { id: 'lowest_hp', label: 'Lowest HP', hint: 'Finish wounded enemies first' },
  { id: 'strongest', label: 'Strongest', hint: 'Highest max HP in range' },
  { id: 'boss', label: 'Boss first', hint: 'Bosses before anything else' },
  { id: 'flying', label: 'Flying first', hint: 'Flying enemies before anything else' },
  { id: 'last', label: 'Furthest', hint: 'Backline first — hits them for longer' },
];

/**
 * Manual aim and the charged shot (gameplay plan §4.2).
 *
 * One table, read by `Game` *and* by `sim/model.ts`, because the idle-parity
 * check in §4.5 is only meaningful if the number the sim measures is the
 * number the game ships. It lived in two places for exactly as long as it took
 * to notice that a cut to the multiplier would have to be made twice.
 *
 * The two timers are **wall-clock** by design. A 1.2 s hold that becomes
 * 0.18 s at 6.5x speed is not "hold still", and a 4 s cooldown that becomes
 * 0.6 s would make the charged shot six times stronger the moment the
 * Accelerator perk is bought — which is the opposite of what an idle game
 * should reward.
 */
export const MANUAL_AIM = {
  /** Fire-rate multiplier while the player holds the mouse. Pre-dates Part 4. */
  fireRateMult: 1.3,
  /** Seconds the cursor must be held still to arm the shot. */
  chargeSeconds: 1.2,
  /** Seconds before another charge can be armed. */
  chargeCooldown: 4,
  /**
   * Damage multiple of an ordinary shot, **per target hit**.
   *
   * §4.2 specifies 6x. The §4.5 idle-parity measurement is the gate, and 6x
   * measured **+127%** at 0 lifetime AP — two and a half times the +50% line
   * the plan itself names as the point to cut. The cut is steep because the
   * charged shot is a flat multiple of *one shot* on a cycle of wall-clock
   * seconds, so its worth scales inversely with fire rate: the same 6x is
   * +93% of a fresh tower's DPS at 1.8 shots/s and +8% of a late one's at 20.
   *
   * What survives is the plan's *shape*, not its number: with `+3` pierce and
   * the 90 px splash intact, a charged shot into a lane still delivers four
   * full hits plus the blast — around 6x an ordinary shot's total output,
   * which is what §4.2 was reaching for. It just is not 6x on one body.
   *
   * Measured active advantage at this value: +45.2% / +35.4% / +34.7% /
   * +34.8% / +33.9% across the five prestige tiers (`npm run sim`).
   */
  chargeDamageMult: 1,
  /** Extra targets the charged shot pierces. */
  chargeExtraPierce: 3,
  /** Splash radius on impact, and what everything else in it takes. */
  chargeSplashRadius: 90,
  chargeSplashFraction: 0.6,
  /**
   * How far the cursor may wander and still count as held still.
   *
   * Generous on purpose: the touch pipeline feeds the same path, and a
   * fingertip on a canvas scaled down to phone width jitters several canvas
   * units without the player intending to move at all.
   */
  chargeMoveTolerance: 18,
} as const;
