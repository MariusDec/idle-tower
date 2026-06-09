import type { EnemyType } from '../types';

export interface EnemyDef {
  type: EnemyType;
  baseHP: number;
  baseSpeed: number;
  armor: number;
  magicResist: number;
  baseDamage: number;
  fireRate: number;
  baseGold: number;
  unlockWave: number;
  radius: number;
  color: string;
  borderColor: string;
  shape: 'circle' | 'diamond' | 'winged';
  glyph?: string;
  shieldCharges?: number;     // Shielded
  healRange?: number;         // Healer
  healFraction?: number;      // Healer: % of maxHP healed
  healCooldown?: number;      // Healer: seconds between heals
  splitChildren?: number;     // Splitter: children spawned on death
  splitHpFraction?: number;   // Splitter child HP fraction
  splitSpeedMultiplier?: number;
  rpChance?: number;          // 0-1, chance to drop 1 RP on kill
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  normal: {
    type: 'normal',
    baseHP: 6,
    baseSpeed: 60,
    armor: 0,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 0.7,
    baseGold: 1,
    unlockWave: 1,
    radius: 12,
    color: '#d04848',
    borderColor: '#ffffff',
    shape: 'circle',
    rpChance: 0.01,
  },
  fast: {
    type: 'fast',
    baseHP: 4,
    baseSpeed: 120,
    armor: 0,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 1.2,
    baseGold: 2,
    unlockWave: 3,
    radius: 10,
    color: '#f1c40f',
    borderColor: '#7a6500',
    shape: 'diamond',
    rpChance: 0.02,
  },
  tank: {
    type: 'tank',
    baseHP: 20,
    baseSpeed: 30,
    armor: 3,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 0.85,
    baseGold: 3,
    unlockWave: 5,
    radius: 18,
    color: '#2c5b8f',
    borderColor: '#9aa7b5',
    shape: 'circle',
    rpChance: 0.03,
  },
  flying: {
    type: 'flying',
    baseHP: 7,
    baseSpeed: 90,
    armor: 0,
    magicResist: 0,
    baseDamage: 2,
    fireRate: 1.5,
    baseGold: 3,
    unlockWave: 8,
    radius: 11,
    color: '#ecf0f1',
    borderColor: '#2c3e50',
    shape: 'winged',
    rpChance: 0.04,
  },
  healer: {
    type: 'healer',
    baseHP: 12,
    baseSpeed: 50,
    armor: 0,
    magicResist: 0,
    baseDamage: 2,
    fireRate: 1.1,
    baseGold: 4,
    unlockWave: 15,
    radius: 14,
    color: '#27ae60',
    borderColor: '#0e3a1d',
    shape: 'circle',
    glyph: '+',
    healRange: 150,
    healFraction: 0.15,
    healCooldown: 2.5,
    rpChance: 0.05,
  },
  boss: {
    type: 'boss',
    baseHP: 120,
    baseSpeed: 40,
    armor: 6,
    magicResist: 0.15,
    baseDamage: 5,
    fireRate: 0.8,
    baseGold: 10,
    unlockWave: 10,
    radius: 30,
    color: '#7b1f1f',
    borderColor: '#ff5050',
    shape: 'circle',
    rpChance: 0.15,
  },
  splitter: {
    type: 'splitter',
    baseHP: 16,
    baseSpeed: 55,
    armor: 0,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 0.9,
    baseGold: 3,
    unlockWave: 12,
    radius: 16,
    color: '#9b59ff',
    borderColor: '#d3b3ff',
    shape: 'diamond',
    splitChildren: 2,
    splitHpFraction: 0.5,
    splitSpeedMultiplier: 1.4,
    rpChance: 0.03,
  },
  shielded: {
    type: 'shielded',
    baseHP: 10,
    baseSpeed: 40,
    armor: 0,
    magicResist: 0.3,
    baseDamage: 1,
    fireRate: 1.0,
    baseGold: 5,
    unlockWave: 20,
    radius: 14,
    color: '#5dade2',
    borderColor: '#1a5276',
    shape: 'circle',
    shieldCharges: 3,
    rpChance: 0.05,
  },
};
