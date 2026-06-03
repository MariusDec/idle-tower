export type ResearchEffectType =
  | 'pierce'
  | 'gold_multi'
  | 'gold_luck'
  | 'mana_regen'
  | 'ability_cost'
  | 'start_wave';

export type ResearchCategory = 'combat' | 'economy' | 'arcane' | 'scouting';

export interface ResearchDef {
  id: string;
  name: string;
  description: string;
  cost: number;
  category: ResearchCategory;
  effectType: ResearchEffectType;
  effectValue: number;
  prerequisites: string[];
  glyph: string;
  color: string;
}

export const RESEARCH_NODES: ResearchDef[] = [
  {
    id: 'piercing_shots',
    name: 'Piercing Shots',
    description: 'Arrows pierce through 1 additional enemy',
    cost: 5,
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
    category: 'combat',
    effectType: 'pierce',
    effectValue: 1,
    prerequisites: ['piercing_shots'],
    glyph: 'P',
    color: '#ff7070',
  },
  {
    id: 'alchemy',
    name: 'Alchemy',
    description: '+25% gold from all sources (multiplicative)',
    cost: 3,
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
    category: 'economy',
    effectType: 'gold_luck',
    effectValue: 0.05,
    prerequisites: ['alchemy'],
    glyph: 'T',
    color: '#ffd24a',
  },
  {
    id: 'mana_font',
    name: 'Mana Font',
    description: '+50% mana regeneration (multiplicative)',
    cost: 5,
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
    category: 'arcane',
    effectType: 'ability_cost',
    effectValue: 0.3,
    prerequisites: ['mana_font'],
    glyph: 'A',
    color: '#9b59ff',
  },
  {
    id: 'veteran_scouts',
    name: 'Veteran Scouts',
    description: 'Start each Ascension at wave 5',
    cost: 3,
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
    category: 'scouting',
    effectType: 'start_wave',
    effectValue: 15,
    prerequisites: ['veteran_scouts'],
    glyph: 'E',
    color: '#27ae60',
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
