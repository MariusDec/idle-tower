import { STAT_ROW_BY_KEY } from '../data/statDisplay';
import type { StatKey } from '../stats/keys';

/**
 * Player-facing name for an internal identifier.
 *
 * Codex prose and the `stats` lists are authored against the engine's own key
 * names (`focusStackBonus`), but those names appear nowhere else in the UI —
 * the stats panel calls that row "Focus Bonus". Preferring the stat table's
 * label keeps the codex speaking the same language as the rest of the game;
 * anything the table does not know falls back to a de-camel-cased form so a
 * new key reads as words rather than as source code.
 */
export function friendlyTermName(raw: string): string {
  const row = STAT_ROW_BY_KEY[raw as StatKey];
  if (row) return row.label;
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    // De-camel-casing turns "maxHp" into "Max Hp"; the game writes these as
    // acronyms everywhere else.
    .replace(/\b(Hp|Xp|Rp|Dps|Aoe)\b/g, (w) => w.toUpperCase());
}

/**
 * camelCase identifiers embedded in prose. Deliberately narrow: it needs a
 * lowercase start and an interior capital, so ordinary words and sentence-
 * initial capitals never match.
 */
const IDENTIFIER_RE = /\b[a-z][a-z0-9]*(?:[A-Z][a-zA-Z0-9]*)+\b/g;

/**
 * Write `text` into `host`, swapping every internal identifier for its
 * player-facing name and tagging it so the styling marks it as a named game
 * term rather than leaving it looking like a variable.
 */
export function setProse(host: HTMLElement, text: string): void {
  host.replaceChildren();
  let last = 0;
  for (const match of text.matchAll(IDENTIFIER_RE)) {
    const at = match.index ?? 0;
    if (at > last) host.appendChild(document.createTextNode(text.slice(last, at)));
    const span = document.createElement('span');
    span.className = 'codex-term';
    span.textContent = friendlyTermName(match[0]);
    span.title = match[0];
    host.appendChild(span);
    last = at + match[0].length;
  }
  if (last < text.length) host.appendChild(document.createTextNode(text.slice(last)));
}