import type { EnemyDef, EnemyId } from './types';

/**
 * The enemy roster (§4.3, §11.1). Region 1 only at P1. Body colours are
 * content data, carried over from the legacy grunt/fast/tank.
 */
export const ENEMIES: readonly EnemyDef[] = [
  {
    id: 'grunt',
    name: 'Grunt',
    icon: 'orc-head',
    text: 'Walks in and hits the wall. The baseline.',
    hp: 1,
    speed: 75,
    radius: 21,
    damage: 1,
    attackInterval: 1,
    armor: 0,
    pack: [1, 1],
    shape: 'circle',
    color: '#d04848',
    borderColor: '#ffffff',
  },
  {
    id: 'runner',
    name: 'Runner',
    icon: 'running-ninja',
    text: 'Fast, and comes in packs. Rate or area beats it.',
    hp: 0.45,
    speed: 135,
    radius: 16,
    damage: 0.6,
    attackInterval: 0.8,
    armor: 0,
    pack: [4, 6],
    shape: 'diamond',
    color: '#f1c40f',
    borderColor: '#7a6500',
  },
  {
    id: 'brute',
    name: 'Brute',
    icon: 'rock-golem',
    text: 'Armoured. Big hits beat many small ones.',
    hp: 4,
    speed: 42,
    radius: 31,
    damage: 3,
    attackInterval: 1.4,
    armor: 0.35,
    pack: [1, 1],
    shape: 'plated',
    color: '#2c5b8f',
    borderColor: '#9aa7b5',
  },
];

export const ENEMY_BY_ID: Readonly<Record<EnemyId, EnemyDef>> = Object.fromEntries(
  ENEMIES.map((e) => [e.id, e]),
) as Record<EnemyId, EnemyDef>;
