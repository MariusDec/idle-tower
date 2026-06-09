export type WaveModifierId =
  | 'glass_cannon'
  | 'heavy_hitters'
  | 'swarm'
  | 'golden'
  | 'glass_tower'
  | 'fortress'
  | 'cursed_ground'
  | 'ironclad'
  | 'famine';

export interface WaveModifierReward {
  /** Bonus AP awarded when the modifier's wave is cleared. */
  ap: number;
  /** Bonus gold awarded when the modifier's wave is cleared. */
  gold: number;
  /** Bonus TP awarded when the modifier's wave is cleared. */
  tp: number;
}

export interface WaveModifierDef {
  id: WaveModifierId;
  name: string;
  description: string;
  detail: string;
  glyph: string;
  color: string;
  reward: WaveModifierReward;
  effects: {
    /** Multiplier applied to enemy HP. 1 = no change. */
    hpMult: number;
    /** Multiplier applied to enemy speed. 1 = no change. */
    speedMult: number;
    /** Multiplier applied to enemy damage to tower. 1 = no change. */
    damageToTowerMult: number;
    /** Multiplier applied to the number of enemies spawned. 1 = no change. */
    countMult: number;
    /** Additive bonus to gold multiplier (added on top of base). */
    goldAdditive: number;
    /** Multiplicative bonus to player damage. 1 = no change. */
    playerDamageMult: number;
  };
}

export const WAVE_MODIFIERS: WaveModifierDef[] = [
  {
    id: 'glass_cannon',
    name: 'Glass Cannon',
    description: 'Enemies are fragile and blindingly fast.',
    detail: 'Enemies: HP ×0.5, Speed ×2.0 · Gold: +25% · Bonus: 1 AP on clear',
    glyph: '◇',
    color: '#5b8def',
    reward: { ap: 1, gold: 0, tp: 0 },
    effects: {
      hpMult: 0.5,
      speedMult: 2.0,
      damageToTowerMult: 1,
      countMult: 1,
      goldAdditive: 0.25,
      playerDamageMult: 1,
    },
  },
  {
    id: 'heavy_hitters',
    name: 'Heavy Hitters',
    description: 'Tougher enemies that hit the tower harder.',
    detail: 'Enemies: HP ×1.5, Damage to tower ×1.3 · Bonus: ×2 gold, 1 AP on clear',
    glyph: '⛨',
    color: '#a85a2c',
    reward: { ap: 1, gold: 2, tp: 0 },
    effects: {
      hpMult: 1.5,
      speedMult: 1,
      damageToTowerMult: 1.3,
      countMult: 1,
      goldAdditive: 0,
      playerDamageMult: 1,
    },
  },
  {
    id: 'swarm',
    name: 'Swarm',
    description: 'The horde is overwhelming.',
    detail: 'Enemies: Count ×3.0 · Bonus: ×2 gold on clear',
    glyph: '⋙',
    color: '#9b59ff',
    reward: { ap: 0, gold: 2, tp: 0 },
    effects: {
      hpMult: 1,
      speedMult: 1,
      damageToTowerMult: 1,
      countMult: 3.0,
      goldAdditive: 0,
      playerDamageMult: 1,
    },
  },
  {
    id: 'golden',
    name: 'Golden Tide',
    description: 'Everything glitters — gold rains from every corpse.',
    detail: 'Gold: ×5.0',
    glyph: '✦',
    color: '#e8a93b',
    reward: { ap: 0, gold: 0, tp: 0 },
    effects: {
      hpMult: 1,
      speedMult: 1,
      damageToTowerMult: 1,
      countMult: 1,
      goldAdditive: 4.0,
      playerDamageMult: 1,
    },
  },
  {
    id: 'glass_tower',
    name: 'Glass Tower',
    description: 'High risk, high reward. Your tower is fragile but lethal.',
    detail: 'Tower takes 3× damage · Your damage ×10',
    glyph: '☠',
    color: '#d04848',
    reward: { ap: 0, gold: 0, tp: 0 },
    effects: {
      hpMult: 1,
      speedMult: 1,
      damageToTowerMult: 3.0,
      countMult: 1,
      goldAdditive: 0,
      playerDamageMult: 10,
    },
  },
  {
    id: 'fortress',
    name: 'Fortress',
    description: 'Slow but nearly indestructible.',
    detail: 'Enemies: HP ×3.0, Speed ×0.5 · Bonus: 1 AP on clear',
    glyph: '🏰',
    color: '#6b7280',
    reward: { ap: 1, gold: 0, tp: 0 },
    effects: {
      hpMult: 3.0,
      speedMult: 0.5,
      damageToTowerMult: 1,
      countMult: 1,
      goldAdditive: 0,
      playerDamageMult: 1,
    },
  },
  {
    id: 'cursed_ground',
    name: 'Cursed Ground',
    description: 'Dark energy weakens your tower, but riches abound.',
    detail: 'Your damage ×0.5 · Gold: ×3, 1 AP on clear',
    glyph: '🜏',
    color: '#7c3aed',
    reward: { ap: 1, gold: 3, tp: 0 },
    effects: {
      hpMult: 1,
      speedMult: 1,
      damageToTowerMult: 1,
      countMult: 1,
      goldAdditive: 0,
      playerDamageMult: 0.5,
    },
  },
  {
    id: 'ironclad',
    name: 'Ironclad',
    description: 'Armored horde. Tough shells, rich spoils.',
    detail: 'Enemies: HP ×2.0, Count ×2.0 · Bonus: ×4 gold, 1 AP on clear',
    glyph: '🛡️',
    color: '#9ca3af',
    reward: { ap: 1, gold: 4, tp: 0 },
    effects: {
      hpMult: 2.0,
      speedMult: 1,
      damageToTowerMult: 1,
      countMult: 2.0,
      goldAdditive: 0,
      playerDamageMult: 1,
    },
  },
  {
    id: 'famine',
    name: 'Famine',
    description: 'Resources are scarce. Endure for knowledge.',
    detail: 'Enemies: HP ×1.2 · Gold: −50% · Bonus: 2 AP on clear',
    glyph: '🌑',
    color: '#4b5563',
    reward: { ap: 2, gold: 0, tp: 0 },
    effects: {
      hpMult: 1.2,
      speedMult: 1,
      damageToTowerMult: 1,
      countMult: 1,
      goldAdditive: -0.5,
      playerDamageMult: 1,
    },
  },
];

export const WAVE_MODIFIER_BY_ID: Record<WaveModifierId, WaveModifierDef> = WAVE_MODIFIERS.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<WaveModifierId, WaveModifierDef>,
);

/**
 * Pick `count` random unique modifiers (default 3). Never returns duplicates.
 * For pools smaller than `count`, returns all available.
 */
export function pickRandomModifiers(count = 3, rng: () => number = Math.random): WaveModifierDef[] {
  const pool = [...WAVE_MODIFIERS];
  const out: WaveModifierDef[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

import type { WaveModifierSnapshot } from '../types';

export function snapshotFromDef(def: WaveModifierDef): WaveModifierSnapshot {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    detail: def.detail,
    glyph: def.glyph,
    color: def.color,
    reward: { ...def.reward },
    effects: { ...def.effects },
  };
}
