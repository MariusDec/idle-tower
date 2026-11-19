import type { StoredTier } from '../content/balance';
import { formatNumber } from '../core/format';
import { iconMarkup } from './icon';

/**
 * The welcome-back card (§6.3, R8 §2): a headline number, then one line each
 * for what else the absence did. A line with nothing to say is left out.
 * `welcomeCard` is pure, for the tests; `welcomeBody` draws it.
 */

/** What an absence did, as the app measured it after paying it. */
export interface WelcomeFacts {
  /** Seconds away. */
  away: number;
  /** Shards paid at once. */
  shards: number;
  /** Shards stored as Stored Light by this absence. */
  stored: number;
  /** The whole Stored Light pool once this absence landed. */
  pool: number;
  /** The farm rate (base shards per wall minute), to say how long the pool lasts. */
  farm: number;
  /** The burn rates, or null with no pool. */
  rates: StoredTier | null;
  /** The longest cap that applied, in hours. */
  capHours: number;
  /** True once any Night Watch is owned; before it, the pay is Night Watch 0's. */
  nightWatch: boolean;
  /** What the Foreman bought, as one line of names; empty when nothing. */
  bought: string;
  /** How many buys `bought` names. */
  boughtCount: number;
  /** The Foreman's next pin's price, when Stored Light covers its gap; else null. */
  held: number | null;
  /** Forge nodes the absence made affordable, by name. */
  fresh: readonly string[];
}

export interface WelcomeLine {
  label: string;
  value: string;
  note?: string;
  /** Stored Light's line wears its own colour. */
  stored?: boolean;
}

export interface WelcomeCard {
  headline: string;
  caption: string;
  lines: WelcomeLine[];
  /** A pointer to Night Watch while the free tier is all there is; else null. */
  hint: string | null;
}

/** "7 h 12 min", or "14 min". */
export function awayText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Roughly how long the pool matches played waves: "~25 min", "~1.5 h". Null when it can't be said. */
export function poolPlayText(pool: number, farm: number, engaged: number): string | null {
  if (pool <= 0 || farm <= 0 || engaged <= 1) return null;
  const minutes = pool / (farm * (engaged - 1));
  if (minutes < 60) return `~${Math.max(5, Math.round(minutes / 5) * 5)} min`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `~${hours} h`;
}

export function welcomeCard(f: WelcomeFacts): WelcomeCard {
  const capped = f.away > f.capHours * 3600;
  const caption = `Gathered in ${awayText(f.away)} away`
    + (capped ? ` · Night Watch holds ${f.capHours} h at most` : '');
  const lines: WelcomeLine[] = [];
  if (f.stored > 0 && f.rates) {
    const span = poolPlayText(f.pool, f.farm, f.rates.engaged);
    lines.push({
      label: 'Stored Light',
      stored: true,
      value: `+${formatNumber(f.stored)}`,
      note: (span ? `Next ${span} of play: ×${f.rates.engaged}.` : `Play spends it at ×${f.rates.engaged}.`)
        + ` Left alone: ×${f.rates.handsOff}.`,
    });
  }
  if (f.boughtCount > 0 || f.held !== null) {
    const notes = [
      f.boughtCount > 0 ? f.bought : '',
      f.held !== null ? `Next pin needs ${formatNumber(f.held)}: Stored Light holds it.` : '',
    ].filter(Boolean);
    lines.push({
      label: 'Foreman',
      value: f.boughtCount > 0 ? `${f.boughtCount} bought` : 'Waiting',
      note: notes.join(' · '),
    });
  }
  if (f.fresh.length > 0) {
    const shown = f.fresh.slice(0, 4).join(', ');
    const more = f.fresh.length > 4 ? ` and ${f.fresh.length - 4} more` : '';
    lines.push({ label: 'Now affordable', value: String(f.fresh.length), note: shown + more });
  }
  return {
    headline: `+${formatNumber(f.shards)}`,
    caption,
    lines,
    hint: f.nightWatch ? null : 'Night Watch (in the Forge) makes this bigger.',
  };
}

/** The card's modal body. */
export function welcomeBody(card: WelcomeCard): HTMLElement {
  const body = document.createElement('div');
  body.className = 'welcome';
  const head = document.createElement('p');
  head.className = 'welcome-head';
  head.innerHTML = iconMarkup('io-diamond');
  const n = document.createElement('span');
  n.className = 'welcome-n';
  n.textContent = card.headline;
  const unit = document.createElement('span');
  unit.className = 'welcome-unit';
  unit.textContent = 'shards';
  head.append(n, unit);
  const caption = document.createElement('p');
  caption.className = 'welcome-caption';
  caption.textContent = card.caption;
  body.append(head, caption);
  if (card.lines.length > 0) {
    const dl = document.createElement('dl');
    dl.className = 'welcome-lines inset';
    for (const line of card.lines) {
      const row = document.createElement('div');
      if (line.stored) row.className = 'is-stored';
      const dt = document.createElement('dt');
      dt.textContent = line.label;
      const dd = document.createElement('dd');
      dd.className = 'welcome-value';
      dd.textContent = line.value;
      row.append(dt, dd);
      if (line.note) {
        const note = document.createElement('dd');
        note.className = 'welcome-note';
        note.textContent = line.note;
        row.append(note);
      }
      dl.append(row);
    }
    body.append(dl);
  }
  if (card.hint) {
    const hint = document.createElement('p');
    hint.className = 'welcome-hint';
    hint.textContent = card.hint;
    body.append(hint);
  }
  return body;
}
