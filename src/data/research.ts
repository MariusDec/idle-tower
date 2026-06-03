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
  | 'enemy_hp_reduce';

export type ResearchCategory = 'combat' | 'economy' | 'arcane' | 'scouting';

export interface ResearchDef {
  id: string;
  name: string;
  description: string;
  cost: number;
  /** Base time in seconds to research this node */
  researchTime: number;
  category: ResearchCategory;
  effectType: ResearchEffectType;
  effectValue: number;
  prerequisites: string[];
  glyph: string;
  color: string;
}

export const RESEARCH_NODES: ResearchDef[] = [
  // ── Combat ────────────────────────────────────────────────────
  {
    id: 'piercing_shots',
    name: 'Piercing Shots',
    description: 'Arrows pierce through 1 additional enemy',
    cost: 5,
    researchTime: 30,
    category: 'combat',
    effectType: 'pierce',
    effectValue: 1,
    prerequisites: [],
    glyph: 'P',
    color: '#d04848',
  },
  {
    id: 'improved_pierce',
    name: 'Splintering Volley',
    description: 'Arrows pierce through 1 more enemy (stacks with Piercing Shots)',
    cost: 12,
    researchTime: 90,
    category: 'combat',
    effectType: 'pierce',
    effectValue: 1,
    prerequisites: ['piercing_shots'],
    glyph: 'P',
    color: '#ff7070',
  },
  {
    id: 'reinforced_structure',
    name: 'Reinforced Structure',
    description: 'Tower takes 20% less damage from all sources',
    cost: 4,
    researchTime: 25,
    category: 'combat',
    effectType: 'tower_defense',
    effectValue: 0.2,
    prerequisites: [],
    glyph: '🛡',
    color: '#6ba3d6',
  },
  {
    id: 'chain_reaction',
    name: 'Chain Reaction',
    description: 'Killing an enemy deals 25% of its max HP as AoE to nearby enemies',
    cost: 18,
    researchTime: 150,
    category: 'combat',
    effectType: 'chain_kill_aoe',
    effectValue: 0.25,
    prerequisites: ['improved_pierce'],
    glyph: '💥',
    color: '#ff4040',
  },

  // ── Economy ───────────────────────────────────────────────────
  {
    id: 'alchemy',
    name: 'Alchemy',
    description: '+25% gold from all sources (multiplicative)',
    cost: 3,
    researchTime: 20,
    category: 'economy',
    effectType: 'gold_multi',
    effectValue: 0.25,
    prerequisites: [],
    glyph: '$',
    color: '#f1c40f',
  },
  {
    id: 'transmutation',
    name: 'Transmutation',
    description: 'Enemies have a 5% chance to drop 3× gold',
    cost: 10,
    researchTime: 75,
    category: 'economy',
    effectType: 'gold_luck',
    effectValue: 0.05,
    prerequisites: ['alchemy'],
    glyph: 'T',
    color: '#ffd24a',
  },
  {
    id: 'prosperity',
    name: 'Prosperity',
    description: '+50% gold from all sources (multiplicative, stacks with Alchemy)',
    cost: 6,
    researchTime: 40,
    category: 'economy',
    effectType: 'gold_multi',
    effectValue: 0.5,
    prerequisites: ['alchemy'],
    glyph: '✦',
    color: '#e8a93b',
  },
  {
    id: 'golden_age',
    name: 'Golden Age',
    description: '+100% gold from all sources (multiplicative)',
    cost: 15,
    researchTime: 120,
    category: 'economy',
    effectType: 'gold_multi',
    effectValue: 1.0,
    prerequisites: ['transmutation', 'prosperity'],
    glyph: '👑',
    color: '#ffc107',
  },

  // ── Arcane ────────────────────────────────────────────────────
  {
    id: 'mana_font',
    name: 'Mana Font',
    description: '+50% mana regeneration (multiplicative)',
    cost: 5,
    researchTime: 30,
    category: 'arcane',
    effectType: 'mana_regen',
    effectValue: 0.5,
    prerequisites: [],
    glyph: 'M',
    color: '#5b8def',
  },
  {
    id: 'arcane_mastery',
    name: 'Arcane Mastery',
    description: 'Abilities cost -30% mana',
    cost: 15,
    researchTime: 120,
    category: 'arcane',
    effectType: 'ability_cost',
    effectValue: 0.3,
    prerequisites: ['mana_font'],
    glyph: 'A',
    color: '#9b59ff',
  },
  {
    id: 'arcane_recovery',
    name: 'Arcane Recovery',
    description: 'Critical hits restore 3 mana',
    cost: 8,
    researchTime: 50,
    category: 'arcane',
    effectType: 'crit_mana',
    effectValue: 3,
    prerequisites: ['mana_font'],
    glyph: '⚡',
    color: '#7b68ee',
  },
  {
    id: 'elemental_fury',
    name: 'Elemental Fury',
    description: 'Abilities deal 30% more damage',
    cost: 20,
    researchTime: 180,
    category: 'arcane',
    effectType: 'ability_power',
    effectValue: 0.3,
    prerequisites: ['arcane_mastery', 'arcane_recovery'],
    glyph: '🔥',
    color: '#e040fb',
  },

  // ── Scouting ──────────────────────────────────────────────────
  {
    id: 'veteran_scouts',
    name: 'Veteran Scouts',
    description: 'Start each Ascension at wave 5',
    cost: 3,
    researchTime: 20,
    category: 'scouting',
    effectType: 'start_wave',
    effectValue: 5,
    prerequisites: [],
    glyph: 'V',
    color: '#3ec46d',
  },
  {
    id: 'elite_scouts',
    name: 'Elite Scouts',
    description: 'Start each Ascension at wave 15 (replaces Veteran Scouts)',
    cost: 10,
    researchTime: 75,
    category: 'scouting',
    effectType: 'start_wave',
    effectValue: 15,
    prerequisites: ['veteran_scouts'],
    glyph: 'E',
    color: '#27ae60',
  },
  {
    id: 'swift_prep',
    name: 'Swift Preparation',
    description: 'Wave intermission time reduced by 50%',
    cost: 5,
    researchTime: 30,
    category: 'scouting',
    effectType: 'intermission_speed',
    effectValue: 0.5,
    prerequisites: ['veteran_scouts'],
    glyph: '⏩',
    color: '#2ecc71',
  },
  {
    id: 'battle_intel',
    name: 'Battle Intel',
    description: 'Enemies spawn with 10% less HP',
    cost: 12,
    researchTime: 90,
    category: 'scouting',
    effectType: 'enemy_hp_reduce',
    effectValue: 0.1,
    prerequisites: ['elite_scouts', 'swift_prep'],
    glyph: '🎯',
    color: '#1abc9c',
  },
];

export const RESEARCH_BY_ID: Record<string, ResearchDef> = RESEARCH_NODES.reduce(
  (acc, n) => {
    acc[n.id] = n;
    return acc;
  },
  {} as Record<string, ResearchDef>,
);

export function researchPrereqSatisfied(
  id: string,
  unlocked: ReadonlySet<string>,
): boolean {
  const def = RESEARCH_BY_ID[id];
  if (!def) return false;
  for (const pre of def.prerequisites) {
    if (!unlocked.has(pre)) return false;
  }
  return true;
}
