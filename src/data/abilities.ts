import type { AbilityId } from '../types';

export type AbilityEffectType = 'aoe_damage' | 'slow' | 'fire_rate_buff' | 'gold_buff';

export interface AbilityDef {
  id: AbilityId;
  name: string;
  description: string;
  manaCost: number;
  cooldown: number;
  duration: number;
  effectType: AbilityEffectType;
  effectValue: number;
  glyph: string;
  color: string;
  hotkey: string;
}

export const ABILITIES: AbilityDef[] = [
  {
    id: 'rain_of_arrows',
    name: 'Rain of Arrows',
    description: 'Deal 5× tower damage to every enemy on screen.',
    manaCost: 30,
    cooldown: 15,
    duration: 0,
    effectType: 'aoe_damage',
    effectValue: 5,
    glyph: 'R',
    color: '#f1c40f',
    hotkey: '1',
  },
  {
    id: 'frost_nova',
    name: 'Frost Nova',
    description: 'Slow all enemies by 50% for 5 seconds.',
    manaCost: 25,
    cooldown: 20,
    duration: 5,
    effectType: 'slow',
    effectValue: 0.5,
    glyph: 'F',
    color: '#5b8def',
    hotkey: '2',
  },
  {
    id: 'berserk',
    name: 'Berserk',
    description: 'Double the tower fire rate for 8 seconds.',
    manaCost: 40,
    cooldown: 30,
    duration: 8,
    effectType: 'fire_rate_buff',
    effectValue: 2,
    glyph: 'B',
    color: '#d04848',
    hotkey: '3',
  },
  {
    id: 'gold_rush',
    name: 'Gold Rush',
    description: 'Triple gold drops for 15 seconds.',
    manaCost: 50,
    cooldown: 60,
    duration: 15,
    effectType: 'gold_buff',
    effectValue: 3,
    glyph: 'G',
    color: '#f1c40f',
    hotkey: '4',
  },
];

export const ABILITY_BY_ID: Record<AbilityId, AbilityDef> = ABILITIES.reduce(
  (acc, a) => {
    acc[a.id] = a;
    return acc;
  },
  {} as Record<AbilityId, AbilityDef>,
);
