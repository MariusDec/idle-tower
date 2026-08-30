import type { AbilityId, EnemyType } from '../types';
import type { IconId } from './icons';
import { ABILITIES } from './abilities';
import { ENEMY_CODEX, ENEMY_DEFS } from './enemies';
import { PASSIVE_ABILITIES } from './passiveAbilities';
import { ASCENSION_UNLOCK_WAVE, TRANSCENDENCE_UNLOCK_AP } from './prestige';
import { formatInt } from '../utils/bigNumber';

export type MilestoneKind =
  | 'ability'
  | 'enemy'
  | 'mana'
  | 'ascension'
  | 'transcendence'
  | 'research'
  | 'passive';

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
  /** Icon shown in the milestone strip. */
  icon: IconId;
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
    icon: a.icon,
    color: a.color,
    refId: a.id satisfies AbilityId,
  }));
}

/**
 * Every enemy type that gets an entry in the upcoming-events strip.
 *
 * `normal` and `boss` are excluded deliberately — one is the baseline the
 * player starts with and the other has its own boss-wave banner. Everything
 * else must appear, and `content-coverage.test.ts` fails if a type is added
 * without one: an enemy that changes how the game is played and arrives with no
 * warning is the worst version of a new mechanic.
 *
 * The wave comes from `ENEMY_DEFS[type].unlockWave`, so the strip cannot drift
 * away from what `WaveManager` actually spawns. The `detail` line is read from
 * `ENEMY_CODEX` so the strip and the bestiary cannot drift apart — and so
 * `content-coverage.test.ts` can hold both copies to the same string.
 */
const ENEMY_INTRO_MILESTONES: Array<{ type: EnemyType; name: string; color: string }> = [
  { type: 'fast', name: 'Fast enemies', color: '#f1c40f' },
  { type: 'tank', name: 'Tank enemies', color: '#2c5b8f' },
  { type: 'flying', name: 'Flying enemies', color: '#ecf0f1' },
  { type: 'splitter', name: 'Splitter enemies', color: '#9b59ff' },
  { type: 'healer', name: 'Healer enemies', color: '#27ae60' },
  { type: 'shielded', name: 'Shielded enemies', color: '#5dade2' },
  { type: 'siege', name: 'Siege engines', color: '#a9752f' },
  { type: 'thief', name: 'Thieves', color: '#d4af37' },
  { type: 'blinker', name: 'Blinkers', color: '#7f5af0' },
  { type: 'warden', name: 'Wardens', color: '#1f7a8c' },
  { type: 'burrower', name: 'Burrowers', color: '#7a5a30' },
];

function enemyMilestones(): MilestoneDef[] {
  return ENEMY_INTRO_MILESTONES.map(e => ({
    id: `enemy:${e.type}`,
    kind: 'enemy',
    wave: ENEMY_DEFS[e.type].unlockWave,
    label: `${e.name} arrive`,
    detail: ENEMY_CODEX[e.type].tagline,
    icon: ENEMY_DEFS[e.type].icon,
    color: e.color,
    refId: e.type,
  }));
}

/** The types the strip deliberately does not announce. */
export const MILESTONE_EXEMPT_ENEMIES: readonly EnemyType[] = ['normal', 'boss'];

/**
 * Wave the mana system opens on — the floor no ability unlock can go below,
 * because mana is what an ability spends. Mirrors `AbilityManager`'s own
 * constant; the two are asserted equal in `tests/content-coverage.test.ts`.
 */
export const MANA_MILESTONE_WAVE = 10;

const FIXED_MILESTONES: MilestoneDef[] = [
  {
    id: 'mana:unlock',
    kind: 'mana',
    wave: MANA_MILESTONE_WAVE,
    label: 'Mana system unlocked',
    detail: 'Abilities become available — spend mana to cast powerful effects.',
    icon: 'magic-swirl',
    color: '#5b8def',
  },
  {
    id: 'ascension:unlock',
    kind: 'ascension',
    wave: ASCENSION_UNLOCK_WAVE,
    label: 'Ascension available',
    detail: `Reset your run for Ascension Points (AP). Earn more AP the deeper you go.`,
    icon: 'upgrade',
    color: '#e8a93b',
  },
];

const TRANSCENDENCE_MILESTONE: MilestoneDef = {
  id: 'transcendence:unlock',
  kind: 'transcendence',
  wave: 0,
  label: 'Transcendence available',
  detail: `After earning ${TRANSCENDENCE_UNLOCK_AP} AP in a single Transcendence cycle, you can reset everything for Transcendence Points.`,
  icon: 'over-infinity',
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
export function upcomingMilestones(
  currentWave: number,
  apThisCycle: number,
  count = 3,
  abilityWaveOffset = 0,
): MilestoneDef[] {
  const out: MilestoneDef[] = [];
  for (const m of milestonesFor(abilityWaveOffset)) {
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

export function milestoneAtWave(wave: number, abilityWaveOffset = 0): MilestoneDef[] {
  return milestonesFor(abilityWaveOffset).filter(m => m.wave === wave);
}

/**
 * Attunement (prestige-abs §5) pulls ability unlocks forward, so the wave on a
 * milestone is a *derived* number, not a fixed one. Every reader goes through
 * here rather than through `MILESTONES` directly — an offset one of them did
 * not apply is a strip that advertises a wave the gate no longer uses.
 *
 * The offset-0 case returns the shared arrays untouched, which is the case
 * every caller hits until the perk is bought.
 */
export function applyAbilityWaveOffset(
  entries: readonly MilestoneDef[],
  abilityWaveOffset: number,
): MilestoneDef[] {
  const offset = Math.max(0, Math.floor(abilityWaveOffset));
  if (offset === 0) return entries as MilestoneDef[];
  return entries
    .map(m => {
      if (m.kind !== 'ability') return m;
      const wave = Math.max(MANA_MILESTONE_WAVE, m.wave - offset);
      // The detail line quotes the wave too, so it moves with it — half a
      // shifted milestone is worse than none.
      return { ...m, wave, detail: `New ability at wave ${wave}.` };
    })
    .sort((a, b) => a.wave - b.wave);
}

function milestonesFor(abilityWaveOffset: number): MilestoneDef[] {
  return applyAbilityWaveOffset(MILESTONES, abilityWaveOffset);
}

/** `PROGRESSION_ENTRIES` with Attunement's offset applied (§5). */
export function progressionEntries(abilityWaveOffset = 0): MilestoneDef[] {
  return applyAbilityWaveOffset(PROGRESSION_ENTRIES, abilityWaveOffset);
}

export { TRANSCENDENCE_MILESTONE };

// ── Progression view (plan §4.6) ──────────────────────────────────────────
//
// The milestone strip deliberately shows only the next few unlocks, which
// leaves the player with no way to answer "what am I working towards?".
// The progression tab answers that from the same definitions, plus the
// passive-ability gates the strip omits to keep itself short.

function passiveMilestones(): MilestoneDef[] {
  return PASSIVE_ABILITIES.map(p => ({
    id: `passive:${p.id}`,
    kind: 'passive' as const,
    wave: p.unlockWave,
    label: `${p.name} available`,
    detail: `${p.tagline} Unlockable for ${formatInt(p.unlockGoldCost)} gold.`,
    icon: p.icon,
    color: p.color,
    refId: p.id,
  }));
}

/**
 * Every wave-gated unlock in the game, ascending. Unlike `MILESTONES` this
 * includes passives, and unlike `upcomingMilestones` it is not truncated —
 * the progression tab shows what is already earned as well as what is next.
 */
export const PROGRESSION_ENTRIES: MilestoneDef[] = [
  ...MILESTONES,
  ...passiveMilestones(),
  TRANSCENDENCE_MILESTONE,
].sort((a, b) => a.wave - b.wave);

/** Human-readable group label for a milestone kind. */
export function milestoneKindLabel(kind: MilestoneKind): string {
  switch (kind) {
    case 'ability': return 'Ability';
    case 'passive': return 'Passive';
    case 'enemy': return 'Enemy';
    case 'mana': return 'System';
    case 'ascension': return 'Prestige';
    case 'transcendence': return 'Prestige';
    case 'research': return 'Research';
  }
}

/**
 * Accent colour for a kind's badge. Distinct from `MilestoneDef.color`, which
 * is per-entry (each ability has its own): this one groups, so the eye can
 * pick "all the abilities" out of the progression list at a glance.
 */
export function milestoneKindColor(kind: MilestoneKind): string {
  switch (kind) {
    case 'ability': return '#5b8def';
    case 'passive': return '#3ec46d';
    case 'enemy': return '#d04848';
    case 'mana': return '#4bc3d4';
    case 'ascension': return '#e8a93b';
    case 'transcendence': return '#9b59ff';
    case 'research': return '#c77dff';
  }
}
