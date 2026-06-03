import type { PrestigeLayer } from '../types';

export type PrestigePerkEffect =
  | 'extra_shots'
  | 'scatter_shots'
  | 'back_shots'
  | 'auto_buy'
  | 'wave_skip'
  | 'damage_mult'
  | 'resource_mult'
  | 'automation';

export type AutomationKey = 'autoBuy' | 'autoAbilities' | 'autoAscend' | 'autoTranscend';

export interface PrestigePerkDef {
  id: string;
  layer: PrestigeLayer;
  name: string;
  description: string;
  costPerLevel: number;
  maxLevel: number;
  effectType: PrestigePerkEffect;
  effectPerLevel: number;
  glyph: string;
  color: string;
  automationKey?: AutomationKey;
}

export const ASCENSION_UNLOCK_WAVE = 20;
export const TRANSCENDENCE_UNLOCK_AP = 100;

export const AP_PERKS: PrestigePerkDef[] = [
  {
    id: 'ap_extra_shots',
    layer: 'ascension',
    name: 'Twin Arrows',
    description: '+1 front projectile',
    costPerLevel: 2,
    maxLevel: 10,
    effectType: 'extra_shots',
    effectPerLevel: 1,
    glyph: '⇆',
    color: '#d04848',
  },
  {
    id: 'ap_scatter_shots',
    layer: 'ascension',
    name: 'Scatter Shot',
    description: '+1 scatter projectile',
    costPerLevel: 3,
    maxLevel: 5,
    effectType: 'scatter_shots',
    effectPerLevel: 1,
    glyph: '⋔',
    color: '#ff7a3a',
  },
  {
    id: 'ap_back_shots',
    layer: 'ascension',
    name: 'Rear Volley',
    description: '+1 rear projectile',
    costPerLevel: 5,
    maxLevel: 3,
    effectType: 'back_shots',
    effectPerLevel: 1,
    glyph: '↶',
    color: '#5b8def',
  },
  {
    id: 'ap_auto_upgrader',
    layer: 'ascension',
    name: 'Auto-Upgrader',
    description: 'Auto-buys the cheapest available upgrade every 10s',
    costPerLevel: 15,
    maxLevel: 1,
    effectType: 'auto_buy',
    effectPerLevel: 0,
    glyph: 'U',
    color: '#e8a93b',
    automationKey: 'autoBuy',
  },
  {
    id: 'ap_wave_skipper',
    layer: 'ascension',
    name: 'Wave Skipper',
    description: '+3% chance per level to completely skip a wave and instantly collect its rewards',
    costPerLevel: 3,
    maxLevel: 25,
    effectType: 'wave_skip',
    effectPerLevel: 0.03,
    glyph: '⏭',
    color: '#3ec46d',
  },
];

export const AP_PERK_BY_ID: Record<string, PrestigePerkDef> = AP_PERKS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<string, PrestigePerkDef>,
);

export function apForWave(waveNumber: number): number {
  if (waveNumber < ASCENSION_UNLOCK_WAVE) return 0;
  return Math.max(0, Math.floor(Math.sqrt(waveNumber * 5)));
}

export const TP_PERKS: PrestigePerkDef[] = [
  {
    id: 'tp_damage',
    layer: 'transcendence',
    name: 'Cosmic Power',
    description: '+50% all damage per level (multiplicative with AP)',
    costPerLevel: 1,
    maxLevel: 999,
    effectType: 'damage_mult',
    effectPerLevel: 0.5,
    glyph: 'X',
    color: '#9b59ff',
  },
  {
    id: 'tp_resource',
    layer: 'transcendence',
    name: 'Astral Harvest',
    description: '+25% all resource gain per level (multiplicative with AP)',
    costPerLevel: 1,
    maxLevel: 999,
    effectType: 'resource_mult',
    effectPerLevel: 0.25,
    glyph: 'R',
    color: '#3ec46d',
  },
  {
    id: 'tp_auto_buy',
    layer: 'transcendence',
    name: 'Auto-Purchaser',
    description: 'Unlocks automation: auto-buys the cheapest available upgrade every 10 seconds',
    costPerLevel: 5,
    maxLevel: 1,
    effectType: 'automation',
    effectPerLevel: 0,
    glyph: 'A',
    color: '#e8a93b',
    automationKey: 'autoBuy',
  },
  {
    id: 'tp_auto_cast',
    layer: 'transcendence',
    name: 'Auto-Caster',
    description: 'Unlocks automation: auto-casts abilities when off cooldown and mana is full',
    costPerLevel: 10,
    maxLevel: 1,
    effectType: 'automation',
    effectPerLevel: 0,
    glyph: 'C',
    color: '#5b8def',
    automationKey: 'autoAbilities',
  },
  {
    id: 'tp_auto_ascend',
    layer: 'transcendence',
    name: 'Auto-Ascender',
    description: 'Unlocks automation: auto-Ascends when you reach the target wave',
    costPerLevel: 20,
    maxLevel: 1,
    effectType: 'automation',
    effectPerLevel: 0,
    glyph: '↑',
    color: '#d04848',
    automationKey: 'autoAscend',
  },
  {
    id: 'tp_auto_transcend',
    layer: 'transcendence',
    name: 'Auto-Transcender',
    description: 'Unlocks automation: auto-Transcends when at least 100 AP is reached',
    costPerLevel: 50,
    maxLevel: 1,
    effectType: 'automation',
    effectPerLevel: 0,
    glyph: '∞',
    color: '#9b59ff',
    automationKey: 'autoTranscend',
  },
];

export const TP_PERK_BY_ID: Record<string, PrestigePerkDef> = TP_PERKS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<string, PrestigePerkDef>,
);

export function tpForAP(ap: number): number {
  if (ap < TRANSCENDENCE_UNLOCK_AP) return 0;
  return Math.max(0, Math.floor(Math.log10(ap + 1) * 3));
}

export function canTranscend(ap: number): boolean {
  return ap >= TRANSCENDENCE_UNLOCK_AP;
}
