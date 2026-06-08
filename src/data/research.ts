export type ResearchEffectType =
  | 'pierce'
  | 'gold_multi'
  | 'gold_luck'
  | 'mana_regen'
  | 'ability_cost'
  | 'start_wave'
  | 'tower_defense'
  | 'chain_kill_aoe'
  | 'crit_mana'
  | 'ability_power'
  | 'intermission_speed'
  | 'enemy_hp_reduce'
  | 'rp_gain'
  | 'rp_drop_chance';

export type ResearchCategory = 'combat' | 'economy' | 'arcane' | 'scouting' | 'research';

export interface ResearchLevelOverride {
  effectValue?: number;
  researchTime?: number;
  cost?: number;
}

export interface ResearchDef {
  id: string;
  name: string;
  description: string;
  cost: number | number[];
  researchTime: number | number[];
  category: ResearchCategory;
  effectType: ResearchEffectType;
  effectPerLevel: number;
  maxLevel: number;
  prerequisites: string[];
  glyph: string;
  color: string;
  effectDefinitions?: Record<number, ResearchLevelOverride>;
}

export const RESEARCH_NODES: ResearchDef[] = [
  // ── Combat ────────────────────────────────────────────────────
  {
    id: 'piercing_shots',
    name: 'Piercing Shots',
    description: 'Arrows pierce through 1 additional enemy',
    cost: 50,
    researchTime: 300,
    category: 'combat',
    effectType: 'pierce',
    effectPerLevel: 1,
    maxLevel: 1,
    prerequisites: [],
    glyph: 'P',
    color: '#d04848',
  },
  {
    id: 'improved_pierce',
    name: 'Splintering Volley',
    description: 'Arrows pierce through 1 more enemy (stacks with Piercing Shots)',
    cost: 200,
    researchTime: 1800,
    category: 'combat',
    effectType: 'pierce',
    effectPerLevel: 1,
    maxLevel: 1,
    prerequisites: ['piercing_shots'],
    glyph: 'P',
    color: '#ff7070',
  },
  {
    id: 'reinforced_structure',
    name: 'Reinforced Structure',
    description: 'Tower takes 20% less damage from all sources',
    cost: 40,
    researchTime: 300,
    category: 'combat',
    effectType: 'tower_defense',
    effectPerLevel: 0.2,
    maxLevel: 1,
    prerequisites: [],
    glyph: '🛡',
    color: '#6ba3d6',
  },
  {
    id: 'chain_reaction',
    name: 'Chain Reaction',
    description: 'Killing an enemy deals 25% of its max HP as AoE to nearby enemies',
    cost: 1000,
    researchTime: 14400,
    category: 'combat',
    effectType: 'chain_kill_aoe',
    effectPerLevel: 0.25,
    maxLevel: 1,
    prerequisites: ['improved_pierce'],
    glyph: '💥',
    color: '#ff4040',
  },

  // ── Economy ───────────────────────────────────────────────────
  {
    id: 'alchemy',
    name: 'Alchemy',
    description: '+25% gold from all sources (multiplicative)',
    cost: 25,
    researchTime: 300,
    category: 'economy',
    effectType: 'gold_multi',
    effectPerLevel: 0.25,
    maxLevel: 1,
    prerequisites: [],
    glyph: '$',
    color: '#f1c40f',
  },
  {
    id: 'transmutation',
    name: 'Transmutation',
    description: 'Enemies have a 5% chance to drop 3× gold',
    cost: 150,
    researchTime: 1800,
    category: 'economy',
    effectType: 'gold_luck',
    effectPerLevel: 0.05,
    maxLevel: 1,
    prerequisites: ['alchemy'],
    glyph: 'T',
    color: '#ffd24a',
  },
  {
    id: 'prosperity',
    name: 'Prosperity',
    description: '+50% gold from all sources (multiplicative, stacks with Alchemy)',
    cost: 100,
    researchTime: 900,
    category: 'economy',
    effectType: 'gold_multi',
    effectPerLevel: 0.5,
    maxLevel: 1,
    prerequisites: ['alchemy'],
    glyph: '✦',
    color: '#e8a93b',
  },
  {
    id: 'golden_age',
    name: 'Golden Age',
    description: '+100% gold from all sources (multiplicative)',
    cost: 750,
    researchTime: 7200,
    category: 'economy',
    effectType: 'gold_multi',
    effectPerLevel: 1.0,
    maxLevel: 1,
    prerequisites: ['transmutation', 'prosperity'],
    glyph: '👑',
    color: '#ffc107',
  },

  // ── Arcane ────────────────────────────────────────────────────
  {
    id: 'mana_font',
    name: 'Mana Font',
    description: '+50% mana regeneration (multiplicative)',
    cost: 50,
    researchTime: 600,
    category: 'arcane',
    effectType: 'mana_regen',
    effectPerLevel: 0.5,
    maxLevel: 1,
    prerequisites: [],
    glyph: 'M',
    color: '#5b8def',
  },
  {
    id: 'arcane_mastery',
    name: 'Arcane Mastery',
    description: 'Abilities cost -30% mana',
    cost: 300,
    researchTime: 3600,
    category: 'arcane',
    effectType: 'ability_cost',
    effectPerLevel: 0.3,
    maxLevel: 1,
    prerequisites: ['mana_font'],
    glyph: 'A',
    color: '#9b59ff',
  },
  {
    id: 'arcane_recovery',
    name: 'Arcane Recovery',
    description: 'Critical hits restore 3 mana',
    cost: 150,
    researchTime: 1200,
    category: 'arcane',
    effectType: 'crit_mana',
    effectPerLevel: 3,
    maxLevel: 1,
    prerequisites: ['mana_font'],
    glyph: '⚡',
    color: '#7b68ee',
  },
  {
    id: 'elemental_fury',
    name: 'Elemental Fury',
    description: 'Abilities deal 30% more damage',
    cost: 1200,
    researchTime: 21600,
    category: 'arcane',
    effectType: 'ability_power',
    effectPerLevel: 0.3,
    maxLevel: 1,
    prerequisites: ['arcane_mastery', 'arcane_recovery'],
    glyph: '🔥',
    color: '#e040fb',
  },

  // ── Scouting ──────────────────────────────────────────────────
  {
    id: 'swift_prep',
    name: 'Swift Preparation',
    description: 'Wave intermission time reduced by 50%',
    cost: 75,
    researchTime: 1200,
    category: 'scouting',
    effectType: 'intermission_speed',
    effectPerLevel: 0.5,
    maxLevel: 1,
    prerequisites: [],
    glyph: '⏩',
    color: '#2ecc71',
  },
  {
    id: 'battle_intel',
    name: 'Battle Intel',
    description: 'Enemies spawn with 10% less HP',
    cost: 400,
    researchTime: 7200,
    category: 'scouting',
    effectType: 'enemy_hp_reduce',
    effectPerLevel: 0.1,
    maxLevel: 1,
    prerequisites: ['swift_prep'],
    glyph: '🎯',
    color: '#1abc9c',
  },

  // ── Research ──────────────────────────────────────────────────
  {
    id: 'rp_gain',
    name: 'Increased Focus',
    description: 'Multiplies passive RP gain',
    cost: [50, 100, 200, 400, 700, 1100, 1600, 3000, 6000, 12000],
    researchTime: [600, 1200, 1800, 3600, 5400, 7200, 10800, 14400, 21600, 28800],
    category: 'research',
    effectType: 'rp_gain',
    effectPerLevel: 0.25,
    maxLevel: 10,
    prerequisites: [],
    glyph: '🎯',
    color: '#ff8c42',
    effectDefinitions: { 10: { effectValue: 5.0 } },
  },
  {
    id: 'rp_drop_chance',
    name: 'Loot Insights',
    description: 'Increases enemy RP drop chance',
    cost: [75, 150, 300, 500, 800, 1200, 1800, 3600, 7000, 15000],
    researchTime: [1200, 1800, 3600, 5400, 7200, 10800, 14400, 21600, 28800, 43200],
    category: 'research',
    effectType: 'rp_drop_chance',
    effectPerLevel: 0.005,
    maxLevel: 10,
    prerequisites: ['rp_gain'],
    glyph: '🔍',
    color: '#ffb347',
    effectDefinitions: { 10: { effectValue: 0.1 } },
  },
];

export const RESEARCH_BY_ID: Record<string, ResearchDef> = RESEARCH_NODES.reduce(
  (acc, n) => {
    acc[n.id] = n;
    return acc;
  },
  {} as Record<string, ResearchDef>,
);

export function getResearchCost(def: ResearchDef, level: number): number {
  if (level <= 0) return 0;
  const override = def.effectDefinitions?.[level]?.cost;
  if (override !== undefined) return override;
  if (typeof def.cost === 'number') return def.cost;
  if (def.cost.length === 0) return 0;
  return def.cost[Math.min(level - 1, def.cost.length - 1)];
}

export function getResearchTime(def: ResearchDef, level: number): number {
  if (level <= 0) return 0;
  const override = def.effectDefinitions?.[level]?.researchTime;
  if (override !== undefined) return override;
  if (typeof def.researchTime === 'number') return def.researchTime;
  if (def.researchTime.length === 0) return 0;
  return def.researchTime[Math.min(level - 1, def.researchTime.length - 1)];
}

export function getResearchEffectAtLevel(def: ResearchDef, level: number): number {
  if (level <= 0) return 0;
  const exact = def.effectDefinitions?.[level]?.effectValue;
  if (exact !== undefined) return exact;
  let baseLevel = 0;
  let baseValue = 0;
  if (def.effectDefinitions) {
    for (const kStr of Object.keys(def.effectDefinitions)) {
      const k = Number(kStr);
      if (k < level && k > baseLevel && def.effectDefinitions[k]?.effectValue !== undefined) {
        baseLevel = k;
        baseValue = def.effectDefinitions[k]!.effectValue!;
      }
    }
  }
  return baseValue + (level - baseLevel) * def.effectPerLevel;
}

export function researchPrereqSatisfied(
  id: string,
  levels: Readonly<Record<string, number>>,
): boolean {
  const def = RESEARCH_BY_ID[id];
  if (!def) return false;
  for (const pre of def.prerequisites) {
    if (!(levels[pre] ?? 0)) return false;
  }
  return true;
}
