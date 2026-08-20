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
