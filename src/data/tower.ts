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
  /*
   * There is deliberately no `fireRateMult` here any more.
   *
   * Holding used to be worth a flat x1.3 fire rate, which the gameplay plan's
   * §0.1 named as the game's first design problem: holding was strictly better
   * than not holding, so it was a tax on attention rather than a choice. The
   * §4.5 measurement made the cost concrete — manual aim alone filled the
   * entire active-play budget (+33.9…+38.9%) before the charged shot added
   * anything, which is why §4.2 specified replacing it rather than stacking on
   * top of it.
   *
   * What holding buys now is the charge below, and it is a genuine trade: while
   * the button is down the tower fires at the cursor instead of auto-acquiring,
   * so a player who holds and never releases is *worse* off than one who never
   * touches the mouse. That is the shape a choice has.
   */
  /** Seconds the cursor must be held still to arm the shot. */
  chargeSeconds: 1.2,
  /** Seconds before another charge can be armed. */
  chargeCooldown: 4,
  /**
   * The charged shot's payload, denominated in **seconds of the tower's own
   * sustained fire**: damage = one shot x current fire rate x this.
   *
   * §4.2 specifies a flat 6x one shot, and Part 4 measured that at +127% and
   * cut it to 1x. Both numbers are answers to the wrong question. A flat
   * multiple of *one shot* is worth `1/fireRate` of the tower's output, so the
   * same constant measured +57% at a fresh tower's 1.8 shots/s and +10% at a
   * late one's 6.1 — the verb decayed into irrelevance exactly where the
   * player has the most fire rate to give up by holding still.
   *
   * Pricing the charge in seconds-of-DPS holds its worth flat across every
   * prestige tier, and it reads as what it is: holding still surrenders ~1.2 s
   * of tracked fire, and the charge pays that back with interest.
   *
   * Because it multiplies the *composed* fire rate, it also scales with
   * Berserk and quick-shot rather than being diluted by them.
   */
  chargeDpsSeconds: 0.9,
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
