import { BALANCE } from '../content/balance';
import { BOSS_BY_ID } from '../content/bosses';
import { curseLine } from '../content/cursed';
import { WEAPON_BY_ID } from '../content/weapons';
import type { RelicDef } from '../content/types';
import { isBound, relicRank } from '../meta/collection';
import type { Profile } from '../meta/profile';
import { icon } from './icon';

/**
 * A cursed relic's card (plans/late-game/03 §2): name, rank, the boon, the
 * curse in its own token after a ☾ (never by colour alone), and what it leans
 * on with the deepest floor it was worn to. The Collection's rows and the
 * compare sheet share it.
 */
export function cursedCard(p: Profile, r: RelicDef, opts: { worn: boolean; tag?: string }): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cursed-card';
  const rank = relicRank(p, r.id);
  const h = document.createElement('div');
  h.className = 'entry-head';
  const n = document.createElement('span');
  n.className = 'entry-name';
  n.textContent = r.name;
  const pips = document.createElement('span');
  pips.className = 'entry-count';
  const bound = isBound(p, r.id);
  const points = p.bound[r.id] ?? 0;
  const binding = rank >= BALANCE.relics.maxRank && !bound ? ` · binding ${points}/${BALANCE.cursed.bindAt}` : '';
  pips.textContent = `${opts.tag ? `${opts.tag} · ` : ''}${'I'.repeat(rank)}${bound ? ' · Bound' : binding}${opts.worn ? ' · worn' : ''}`;
  h.append(icon(r.icon), n, pips);
  const boon = document.createElement('p');
  boon.className = 'entry-text';
  boon.textContent = r.text;
  const curse = document.createElement('p');
  curse.className = 'entry-curse';
  curse.textContent = curseLine(r);
  wrap.append(h, boon, curse);
  const leans = r.leans ? WEAPON_BY_ID[r.leans].name : null;
  const best = p.cursedBest[r.id];
  if (leans || best) {
    const meta = document.createElement('p');
    meta.className = 'entry-lore';
    meta.textContent = [leans, best ? `deepest worn: floor ${best}` : null].filter(Boolean).join(' · ');
    wrap.append(meta);
  }
  return wrap;
}

/** Where a cursed relic drops, in words, for its silhouette (§2). */
export function cursedWhere(r: RelicDef): string {
  const s = r.source;
  if (s.kind !== 'cursed') return '';
  if (s.boss) return `Drops from ${BOSS_BY_ID[s.boss].name}, in the Abyss.`;
  return s.stratum === 'below' ? 'Drops deeper.' : 'Drops from the Abyss’s elites.';
}
