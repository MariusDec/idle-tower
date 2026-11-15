import { BALANCE } from './balance';
import type { BossId, RelicDef, RelicId, StratumId } from './types';

/**
 * Cursed relics (plans/late-game/03): found only by playing the Abyss, each
 * with one boon and one curse that changes how you build. A reliquary drops
 * where an elite, Keeper or guardian fell, and only a tap claims it. Worn in
 * their own slot, in the Abyss only; duplicates rank the boon up to III, the
 * curse never changes, and past III they bind (§3.3).
 *
 * The text is boon then curse, sharing R4's fifteen words with "Curse:"
 * counted, which the UI draws as ☾ (the lint checks it). Damage boons are
 * `mult`, never `pct`: the meta bucket already holds the Forge's and the
 * sky's hundreds of percent (§3.5).
 *
 * Phase 1–2 ship Glass Crown alone, from today's Deepwarden; the strata's
 * twenty follow plan 08 (§8).
 */
const C = BALANCE.cursed;

export const CURSED_RELICS: readonly RelicDef[] = [
  {
    id: 'glass-crown', name: 'Glass Crown', icon: 'crowned-skull',
    text: 'Damage ×1.5.',
    source: { kind: 'cursed', stratum: 'gate', boss: 'deepwarden' },
    effects: [{ kind: 'stat', mod: { key: 'damage', mult: C.glassCrown.mult } }],
    perRank: [{ kind: 'stat', mod: { key: 'damage', mult: C.glassCrown.perRank } }],
    curse: {
      text: 'Curse: the tower never rises again.',
      effects: [{ kind: 'behaviour', id: 'unrisen' }],
    },
  },
];

/** True for a cursed relic (plans/late-game/03). */
export function isCursed(relic: RelicDef): boolean {
  return relic.source.kind === 'cursed';
}

/** The curse line as drawn: "Curse:" becomes the ☾ glyph, so it never reads by colour alone. */
export function curseLine(relic: RelicDef): string {
  return relic.curse ? relic.curse.text.replace(/^Curse:\s*/, '☾ ') : '';
}

/**
 * What a stratum drops (§3.1): its elites' relics, and each guardian's. Only
 * the Gate's ship so far, whose elites drop nothing cursed: the Deepwarden
 * is the lesson.
 */
export function cursedTable(stratum: StratumId | 'below'): { elite: RelicId[]; boss: Partial<Record<BossId, RelicId>> } {
  const elite: RelicId[] = [];
  const boss: Partial<Record<BossId, RelicId>> = {};
  for (const r of CURSED_RELICS) {
    const s = r.source;
    if (s.kind !== 'cursed' || s.stratum !== stratum) continue;
    if (s.boss) boss[s.boss] = r.id;
    else elite.push(r.id);
  }
  return { elite, boss };
}
