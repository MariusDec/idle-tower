import { PACTS } from '../../content/pacts';
import type { PactId } from '../../content/types';
import { formatNumber } from '../../core/format';
import { inAbyss, inRush, selectedRegion } from '../../meta/collection';
import { bestHeat, heat, heatShards, pactRank, recordStarlight } from '../../meta/pacts';
import type { Profile } from '../../meta/profile';
import { starGifts } from '../../meta/stars';
import { icon } from '../icon';

export interface PactActions {
  /** Set a pact's rank for the next run. */
  setPact(id: PactId, rank: number): boolean;
  /** Leave for the home view. */
  done(): void;
}

/**
 * The Pacts (§9): difficulty the player opts into, rank by rank. Heat is the
 * sum; shards rise with it; and a region cleared at a new heat record pays
 * Starlight, once per heat level. The view says what the next run's region
 * would pay, and what Blight Surge does there.
 */
export class PactsView {
  readonly root: HTMLElement;
  private readonly heatN: HTMLElement;
  private readonly note: HTMLElement;
  private readonly list: HTMLElement;
  private profile: Profile | null = null;

  constructor(host: HTMLElement, private readonly actions: PactActions) {
    this.root = document.createElement('div');
    this.root.className = 'pacts';
    this.root.innerHTML = `
      <header class="view-head">
        <h2 class="view-title">Pacts</h2>
        <span class="pacts-heat"></span>
      </header>
      <p class="collection-note pacts-note"></p>
      <ul class="entry-list pacts-list"></ul>
      <button type="button" class="btn tactics-done">Done</button>`;
    this.heatN = this.root.querySelector('.pacts-heat')!;
    this.note = this.root.querySelector('.pacts-note')!;
    this.list = this.root.querySelector('.pacts-list')!;
    this.root.querySelector('.tactics-done')!.addEventListener('click', () => actions.done());
    host.appendChild(this.root);
  }

  show(profile: Profile): void {
    this.profile = profile;
    this.render();
  }

  private render(): void {
    const p = this.profile;
    if (!p) return;
    const h = heat(p);
    this.heatN.textContent = `Heat ${h} · shards ×${heatShards(h).toFixed(1)}`;
    const region = selectedRegion(p);
    if (inAbyss(p)) {
      this.note.textContent = 'The Abyss has its own depth: pacts hold only in the regions.';
    } else if (inRush(p)) {
      this.note.textContent = 'Boss Rush races the clock: pacts hold only in the regions.';
    } else {
      const best = bestHeat(p, region.index);
      const pay = Math.round(recordStarlight(p, region.index, h) * starGifts(p).starlight);
      const record = h > best
        ? `Clear it at heat ${h} for ${formatNumber(pay)} Starlight.`
        : `Its record is heat ${best}: raise the heat for Starlight.`;
      this.note.textContent = `Next run: ${region.name}. ${record} Its surge: ${region.surge.text}`;
    }
    this.list.replaceChildren(...PACTS.map((def) => {
      const rank = pactRank(p, def.id);
      const li = document.createElement('li');
      li.className = `entry pacts-row${rank > 0 ? ' is-worn' : ''}`;
      const head = document.createElement('div');
      head.className = 'entry-head';
      const name = document.createElement('span');
      name.className = 'entry-name';
      name.textContent = def.name;
      const pips = document.createElement('span');
      pips.className = 'entry-count pacts-pips';
      pips.textContent = Array.from({ length: def.ranks }, (_, i) => (i < rank ? '◆' : '◇')).join('');
      pips.setAttribute('aria-label', `Rank ${rank} of ${def.ranks}`);
      const step = (label: string, aria: string, to: number, disabled: boolean): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tactics-btn';
        b.textContent = label;
        b.setAttribute('aria-label', `${aria} ${def.name}`);
        b.disabled = disabled;
        b.addEventListener('click', () => {
          if (this.actions.setPact(def.id, to)) this.render();
        });
        return b;
      };
      head.append(icon(def.icon), name, pips,
        step('−', 'Lower', rank - 1, rank === 0),
        step('+', 'Raise', rank + 1, rank >= def.ranks));
      const t = document.createElement('p');
      t.className = 'entry-text';
      t.textContent = `Each rank: ${def.text}`;
      li.append(head, t);
      return li;
    }));
  }
}
