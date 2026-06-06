import type { AbilityId, EnemyType } from '../types';
import { ABILITIES } from './abilities';
import { ASCENSION_UNLOCK_WAVE, TRANSCENDENCE_UNLOCK_AP } from './prestige';

export type MilestoneKind =
  | 'ability'
  | 'enemy'
  | 'mana'
  | 'ascension'
  | 'transcendence'
  | 'research';

export interface MilestoneDef {
  /** Unique id, e.g. "ability:frost_nova" or "ascension:unlock". */
  id: string;
  kind: MilestoneKind;
  /** Wave the milestone triggers on. For non-wave milestones (transcendence) this is 0. */
  wave: number;
  /** Short display label (e.g. "Frost Nova unlocked"). */
  label: string;
  /** Secondary description (e.g. "Slows all enemies by 50%"). */
  detail: string;
  /** Optional glyph shown in the milestone strip. */
  glyph: string;
  /** Optional accent color for the strip entry. */
  color: string;
  /** Optional target id for click/highlight integration. */
  refId?: string;
}

function abilityMilestones(): MilestoneDef[] {
  return ABILITIES.map(a => ({
    id: `ability:${a.id}`,
    kind: 'ability',
    wave: a.unlockWave,
    label: `${a.name} unlocked`,
    detail: `New ability at wave ${a.unlockWave}.`,
    glyph: a.glyph,
    color: a.color,
    refId: a.id satisfies AbilityId,
  }));
}

const ENEMY_INTRO_MILESTONES: Array<{ type: EnemyType; name: string; glyph: string; color: string }> = [
  { type: 'fast', name: 'Fast enemies', glyph: 'F', color: '#f1c40f' },
  { type: 'tank', name: 'Tank enemies', glyph: 'T', color: '#2c5b8f' },
  { type: 'flying', name: 'Flying enemies', glyph: '✈', color: '#ecf0f1' },
  { type: 'splitter', name: 'Splitter enemies', glyph: '⋔', color: '#9b59ff' },
  { type: 'healer', name: 'Healer enemies', glyph: '+', color: '#27ae60' },
  { type: 'shielded', name: 'Shielded enemies', glyph: '◎', color: '#5dade2' },
];

function enemyMilestones(): MilestoneDef[] {
  return ENEMY_INTRO_MILESTONES.map(e => ({
    id: `enemy:${e.type}`,
    kind: 'enemy',
    wave: e.type === 'fast' ? 3
      : e.type === 'tank' ? 5
      : e.type === 'flying' ? 8
      : e.type === 'splitter' ? 12
      : e.type === 'healer' ? 15
      : 20,
    label: `${e.name} arrive`,
    detail: `New enemy type joins the horde.`,
    glyph: e.glyph,
    color: e.color,
    refId: e.type,
  }));
}

const FIXED_MILESTONES: MilestoneDef[] = [
  {
    id: 'mana:unlock',
    kind: 'mana',
    wave: 10,
    label: 'Mana system unlocked',
    detail: 'Abilities become available — spend mana to cast powerful effects.',
    glyph: 'M',
    color: '#5b8def',
  },
  {
    id: 'ascension:unlock',
    kind: 'ascension',
    wave: ASCENSION_UNLOCK_WAVE,
    label: 'Ascension available',
    detail: `Reset your run for Ascension Points (AP). Earn more AP the deeper you go.`,
    glyph: 'A',
    color: '#e8a93b',
  },
];

const TRANSCENDENCE_MILESTONE: MilestoneDef = {
  id: 'transcendence:unlock',
  kind: 'transcendence',
  wave: 0,
  label: 'Transcendence available',
  detail: `After earning ${TRANSCENDENCE_UNLOCK_AP} AP in a single Transcendence cycle, you can reset everything for Transcendence Points.`,
  glyph: '∞',
  color: '#9b59ff',
};

export const MILESTONES: MilestoneDef[] = [
  ...FIXED_MILESTONES,
  ...abilityMilestones(),
  ...enemyMilestones(),
].sort((a, b) => a.wave - b.wave);

/**
 * Returns the next `count` milestones strictly after the given wave.
 * Includes the transcendence milestone only when the player has reached
 * `TRANSCENDENCE_UNLOCK_AP` ascension points this cycle.
 */
export function upcomingMilestones(currentWave: number, apThisCycle: number, count = 3): MilestoneDef[] {
  const out: MilestoneDef[] = [];
  for (const m of MILESTONES) {
    if (m.wave > currentWave) {
      out.push(m);
      if (out.length >= count) break;
    }
  }
  if (apThisCycle >= TRANSCENDENCE_UNLOCK_AP) {
    const already = out.some(m => m.id === TRANSCENDENCE_MILESTONE.id);
    if (!already) {
      out.push(TRANSCENDENCE_MILESTONE);
    }
  }
  return out.slice(0, count);
}

export function milestoneAtWave(wave: number): MilestoneDef[] {
  return MILESTONES.filter(m => m.wave === wave);
}

export { TRANSCENDENCE_MILESTONE };
