import type { PrestigeLayer } from '../types';
import { evalFormula } from './formulas';

export type PrestigePerkEffect =
  | 'extra_shots'
  | 'scatter_shots'
  | 'back_shots'
  | 'auto_buy'
  | 'wave_skip'
  | 'damage_mult'
  | 'resource_mult'
  | 'automation'
  | 'fire_rate_mult'
  | 'crit_damage_mult'
  | 'pierce'
  | 'aoe_splash'
  | 'execute_damage'
  | 'treasure_chance'
  | 'mana_regen_mult'
  | 'start_gold'
  | 'gold_on_hit'
  | 'ability_cdr'
  | 'wave_start'
  | 'auto_buy_speed'
  | 'research_speed'
  | 'game_speed';

export type AutomationKey = 'autoBuy' | 'autoAbilities' | 'autoAscend' | 'autoTranscend';

export type TPBranch = 'wrath' | 'fortune' | 'dominion';

export interface PerkPrerequisite {
  perkId: string;
  minLevel: number;
}

export interface PrestigePerkDef {
  id: string;
  layer: PrestigeLayer;
  name: string;
  description: string;
  costPerLevel: number;
  costScaling: number | string;
  maxLevel: number;
  effectType: PrestigePerkEffect;
  effectPerLevel: number | string;
  baseEffect?: number;
  glyph: string;
  color: string;
  automationKey?: AutomationKey;
  branch?: TPBranch;
  tier?: number;
  prerequisites?: PerkPrerequisite[];
  exclusive?: string[];
}

export function perkCost(def: PrestigePerkDef, level: number): number {
  const s = typeof def.costScaling === 'string' ? evalFormula(def.costScaling, level) : def.costScaling;
  return Math.floor(def.costPerLevel * Math.pow(s, level));
}

const perkEffectCache = new Map<string, number>();

export function computePerkEffect(def: PrestigePerkDef, level: number): number {
  if (level <= 0) return 0;
  const cacheKey = `${def.id}:${level}`;
  const cached = perkEffectCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let v: number;
  if (def.baseEffect && level == 1) {
    v = def.baseEffect;
  } else if (typeof def.effectPerLevel === 'string') {
    v = def.baseEffect ?? 0;
    for (let i = 2; i <= level; i++) {
      v += evalFormula(def.effectPerLevel, i);
    }
  } else if (def.baseEffect !== undefined) {
    v = def.baseEffect + def.effectPerLevel * (level - 1);
  } else {
    v = def.effectPerLevel * level;
  }

  perkEffectCache.set(cacheKey, v);
  return v;
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
    costScaling: 2.5,
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
    costPerLevel: 2,
    costScaling: 2.5,
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
    costPerLevel: 3,
    costScaling: 2.5,
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
    costScaling: 1,
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
    costScaling: 1.5,
    maxLevel: 25,
    effectType: 'wave_skip',
    effectPerLevel: 0.03,
    glyph: '⏭',
    color: '#3ec46d',
  },
  {
    id: 'ap_research_speed',
    layer: 'ascension',
    name: 'Scholarly Focus',
    description: '-15% research time per level',
    costPerLevel: 2,
    costScaling: 1.8,
    maxLevel: 5,
    effectType: 'research_speed',
    effectPerLevel: 0.15,
    glyph: '📚',
    color: '#9b59ff',
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
  return Math.max(0, 20 + Math.floor(Math.pow(1.13, waveNumber - ASCENSION_UNLOCK_WAVE) * Math.sqrt(waveNumber - ASCENSION_UNLOCK_WAVE)));
}

export const TP_PERKS: PrestigePerkDef[] = [
  // ── Wrath Branch (Offensive) ──────────────────────────────────
  {
    id: 'tp_damage',
    layer: 'transcendence',
    name: 'Cosmic Power',
    description: '+50% all damage per level (multiplicative with AP)',
    costPerLevel: 1,
    costScaling: 1.12,
    maxLevel: 999,
    effectType: 'damage_mult',
    effectPerLevel: 0.5,
    glyph: '⚔',
    color: '#9b59ff',
    branch: 'wrath',
    tier: 1,
  },
  {
    id: 'tp_fire_rate',
    layer: 'transcendence',
    name: 'Rapid Assault',
    description: '+8% fire rate per level',
    costPerLevel: 2,
    costScaling: 1.5,
    maxLevel: 15,
    effectType: 'fire_rate_mult',
    effectPerLevel: 0.08,
    glyph: '⚡',
    color: '#d04848',
    branch: 'wrath',
    tier: 2,
    prerequisites: [{ perkId: 'tp_damage', minLevel: 3 }],
  },
  {
    id: 'tp_crit',
    layer: 'transcendence',
    name: 'Lethal Precision',
    description: '+5% crit damage per level',
    costPerLevel: 2,
    costScaling: 1.5,
    maxLevel: 20,
    effectType: 'crit_damage_mult',
    effectPerLevel: 0.05,
    glyph: '◎',
    color: '#ff7a3a',
    branch: 'wrath',
    tier: 2,
    prerequisites: [{ perkId: 'tp_damage', minLevel: 3 }],
  },
  {
    id: 'tp_pierce',
    layer: 'transcendence',
    name: 'Piercing Fury',
    description: '+1 pierce per 2 levels',
    costPerLevel: 4,
    costScaling: 1.8,
    maxLevel: 6,
    effectType: 'pierce',
    effectPerLevel: 0.5,
    glyph: '➤',
    color: '#d04848',
    branch: 'wrath',
    tier: 3,
    prerequisites: [
      { perkId: 'tp_fire_rate', minLevel: 3 },
      { perkId: 'tp_crit', minLevel: 3 },
    ],
  },
  {
    id: 'tp_aoe',
    layer: 'transcendence',
    name: 'Annihilation',
    description: 'Projectiles deal 25% AoE splash damage on impact',
    costPerLevel: 12,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'aoe_splash',
    effectPerLevel: 0.25,
    glyph: '💥',
    color: '#d04848',
    branch: 'wrath',
    tier: 4,
    prerequisites: [{ perkId: 'tp_pierce', minLevel: 2 }],
    exclusive: ['tp_execute'],
  },
  {
    id: 'tp_execute',
    layer: 'transcendence',
    name: 'Executioner',
    description: '+200% damage to enemies below 25% HP',
    costPerLevel: 12,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'execute_damage',
    effectPerLevel: 2.0,
    glyph: '☠',
    color: '#9b59ff',
    branch: 'wrath',
    tier: 4,
    prerequisites: [{ perkId: 'tp_pierce', minLevel: 2 }],
    exclusive: ['tp_aoe'],
  },

  // ── Fortune Branch (Economic) ─────────────────────────────────
  {
    id: 'tp_resource',
    layer: 'transcendence',
    name: 'Astral Harvest',
    description: '+25% all resource gain per level (multiplicative with AP)',
    costPerLevel: 1,
    costScaling: 1.12,
    maxLevel: 999,
    effectType: 'resource_mult',
    effectPerLevel: 0.25,
    glyph: '✦',
    color: '#3ec46d',
    branch: 'fortune',
    tier: 1,
  },
  {
    id: 'tp_treasure',
    layer: 'transcendence',
    name: 'Treasure Hunter',
    description: '+3% chance for 3× gold drop per level',
    costPerLevel: 2,
    costScaling: 1.5,
    maxLevel: 10,
    effectType: 'treasure_chance',
    effectPerLevel: 0.03,
    glyph: '💰',
    color: '#e8a93b',
    branch: 'fortune',
    tier: 2,
    prerequisites: [{ perkId: 'tp_resource', minLevel: 3 }],
  },
  {
    id: 'tp_mana',
    layer: 'transcendence',
    name: 'Mana Well',
    description: '+15% mana regen per level',
    costPerLevel: 2,
    costScaling: 1.5,
    maxLevel: 10,
    effectType: 'mana_regen_mult',
    effectPerLevel: 0.15,
    glyph: '🔮',
    color: '#5b8def',
    branch: 'fortune',
    tier: 2,
    prerequisites: [{ perkId: 'tp_resource', minLevel: 3 }],
  },
  {
    id: 'tp_head_start',
    layer: 'transcendence',
    name: 'Head Start',
    description: 'Start each ascension with level × 500 gold',
    costPerLevel: 3,
    costScaling: 1.6,
    maxLevel: 20,
    effectType: 'start_gold',
    effectPerLevel: 500,
    glyph: '🏁',
    color: '#e8a93b',
    branch: 'fortune',
    tier: 3,
    prerequisites: [
      { perkId: 'tp_treasure', minLevel: 2 },
      { perkId: 'tp_mana', minLevel: 2 },
    ],
  },
  {
    id: 'tp_midas',
    layer: 'transcendence',
    name: 'Midas Touch',
    description: 'Enemies drop 10% of kill gold on every projectile hit',
    costPerLevel: 12,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'gold_on_hit',
    effectPerLevel: 0.10,
    glyph: '👑',
    color: '#e8a93b',
    branch: 'fortune',
    tier: 4,
    prerequisites: [{ perkId: 'tp_head_start', minLevel: 5 }],
    exclusive: ['tp_arcane'],
  },
  {
    id: 'tp_arcane',
    layer: 'transcendence',
    name: 'Arcane Abundance',
    description: '-30% ability cooldowns, -40% ability mana costs',
    costPerLevel: 12,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'ability_cdr',
    effectPerLevel: 0.30,
    glyph: '✧',
    color: '#5b8def',
    branch: 'fortune',
    tier: 4,
    prerequisites: [{ perkId: 'tp_head_start', minLevel: 5 }],
    exclusive: ['tp_midas'],
  },

  // ── Dominion Branch (Utility/Automation) ──────────────────────
  {
    id: 'tp_auto_cast',
    layer: 'transcendence',
    name: 'Auto-Caster',
    description: 'Unlocks automation: auto-casts abilities when off cooldown and mana is sufficient',
    costPerLevel: 6,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'automation',
    effectPerLevel: 0,
    glyph: 'C',
    color: '#5b8def',
    automationKey: 'autoAbilities',
    branch: 'dominion',
    tier: 2,
  },
  {
    id: 'tp_wave_start',
    layer: 'transcendence',
    name: 'Wave Commander',
    description: 'Start each ascension at wave 3 × level',
    costPerLevel: 2,
    costScaling: 1.5,
    maxLevel: 10,
    effectType: 'wave_start',
    effectPerLevel: 3,
    glyph: '⏩',
    color: '#3ec46d',
    branch: 'dominion',
    tier: 2,
  },
  {
    id: 'tp_efficiency',
    layer: 'transcendence',
    name: 'Efficiency',
    description: 'Auto-buy interval -1s per level (min 3s)',
    costPerLevel: 2,
    costScaling: 1.5,
    maxLevel: 7,
    effectType: 'auto_buy_speed',
    effectPerLevel: 1,
    glyph: '⏱',
    color: '#e8a93b',
    branch: 'dominion',
    tier: 2,
  },
  {
    id: 'tp_game_speed',
    layer: 'transcendence',
    name: 'Accelerator',
    description: 'Each level adds +0.5× to max game speed',
    costPerLevel: 3,
    costScaling: 2.4,
    maxLevel: 10,
    effectType: 'game_speed',
    effectPerLevel: 1,
    glyph: '⚡',
    color: '#a855f7',
    branch: 'dominion',
    tier: 2,
  },
  {
    id: 'tp_auto_ascend',
    layer: 'transcendence',
    name: 'Auto-Ascender',
    description: 'Unlocks automation: auto-Ascends when you reach the target wave',
    costPerLevel: 12,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'automation',
    effectPerLevel: 0,
    glyph: '↑',
    color: '#d04848',
    automationKey: 'autoAscend',
    branch: 'dominion',
    tier: 3,
    prerequisites: [
      { perkId: 'tp_auto_cast', minLevel: 1 },
      { perkId: 'tp_wave_start', minLevel: 3 },
    ],
  },
  {
    id: 'tp_auto_transcend',
    layer: 'transcendence',
    name: 'Auto-Transcender',
    description: 'Unlocks automation: auto-Transcends when at least 100 AP is reached',
    costPerLevel: 25,
    costScaling: 1,
    maxLevel: 1,
    effectType: 'automation',
    effectPerLevel: 0,
    glyph: '∞',
    color: '#9b59ff',
    automationKey: 'autoTranscend',
    branch: 'dominion',
    tier: 4,
    prerequisites: [{ perkId: 'tp_auto_ascend', minLevel: 1 }],
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
  return Math.max(0, Math.floor(Math.pow(Math.log2(ap + 1), 2)));
}

export function canTranscend(ap: number): boolean {
  return ap >= TRANSCENDENCE_UNLOCK_AP;
}
