import type { TowerState } from '../types';

export const TOWER_BASE: Omit<TowerState, 'cooldown'> = {
  x: 0,
  y: 0,
  baseDamage: 8,
  fireRate: 1.2,
  range: 300,
  critChance: 0.05,
  critMultiplier: 2,
  damageType: 'physical',
  targetingMode: 'nearest',
  hp: 10,
  maxHp: 10,
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
