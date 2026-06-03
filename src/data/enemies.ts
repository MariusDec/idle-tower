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
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  normal: {
    type: 'normal',
    baseHP: 10,
    baseSpeed: 60,
    armor: 0,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 0.7,
    baseGold: 10,
    unlockWave: 1,
    radius: 12,
    color: '#d04848',
    borderColor: '#ffffff',
    shape: 'circle',
  },
  fast: {
    type: 'fast',
    baseHP: 7,
    baseSpeed: 120,
    armor: 0,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 1.2,
    baseGold: 8,
    unlockWave: 3,
    radius: 10,
    color: '#f1c40f',
    borderColor: '#7a6500',
    shape: 'diamond',
  },
  tank: {
    type: 'tank',
    baseHP: 30,
    baseSpeed: 30,
    armor: 5,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 0.85,
    baseGold: 20,
    unlockWave: 5,
    radius: 18,
    color: '#2c5b8f',
    borderColor: '#9aa7b5',
    shape: 'circle',
  },
  flying: {
    type: 'flying',
    baseHP: 12,
    baseSpeed: 90,
    armor: 0,
    magicResist: 0,
    baseDamage: 2,
    fireRate: 1.5,
    baseGold: 15,
    unlockWave: 8,
    radius: 11,
    color: '#ecf0f1',
    borderColor: '#2c3e50',
    shape: 'winged',
  },
  healer: {
    type: 'healer',
    baseHP: 15,
    baseSpeed: 50,
    armor: 0,
    magicResist: 0,
    baseDamage: 2,
    fireRate: 1.1,
    baseGold: 25,
    unlockWave: 15,
    radius: 14,
    color: '#27ae60',
    borderColor: '#0e3a1d',
    shape: 'circle',
    glyph: '+',
  },
  boss: {
    type: 'boss',
    baseHP: 100,
    baseSpeed: 40,
    armor: 10,
    magicResist: 0.2,
    baseDamage: 5,
    fireRate: 0.8,
    baseGold: 200,
    unlockWave: 10,
    radius: 30,
    color: '#7b1f1f',
    borderColor: '#ff5050',
    shape: 'circle',
  },
};
