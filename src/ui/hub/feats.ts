import { FEATS } from '../../content/feats';
import { formatNumber } from '../../core/format';
import { claimable, featProgress, featVisible } from '../../meta/feats';
import type { Profile } from '../../meta/profile';
import { setStyle } from '../dom';
import { icon, iconMarkup } from '../icon';

export interface FeatActions {
  claim(id: string): number;
  claimAll(): number;
}

/**
 * Feats (§5.4): one finite list. An earned feat waits here with its reward
 * until claimed, so the tab opens on a batch of them after the first boss.
 */
export class FeatsView {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly all: HTMLButtonElement;
  private readonly count: HTMLElement;
  private profile: Profile | null = null;

  constructor(host: HTMLElement, private readonly actions: FeatActions) {
    this.root = document.createElement('div');
    this.root.className = 'feats';
    this.root.innerHTML = `
      <header class="view-head">
        <h2 class="view-title">Feats</h2>
        <span class="feats-count"></span>
      </header>
      <button type="button" class="btn btn-primary feats-all" hidden></button>
      <ul class="entry-list feats-list"></ul>`;
    this.list = this.root.querySelector('.feats-list')!;
    this.all = this.root.querySelector('.feats-all')!;
    this.count = this.root.querySelector('.feats-count')!;
    this.all.addEventListener('click', () => {
      if (this.actions.claimAll() > 0) this.render();
    });
    host.appendChild(this.root);
  }

  show(profile: Profile): void {
    this.profile = profile;
    this.render();
  }

  private render(): void {
    const p = this.profile;
    if (!p) return;
    const waiting = claimable(p);
    const total = waiting.reduce((s, f) => s + f.reward, 0);
    this.all.hidden = waiting.length < 2;
    this.all.innerHTML = `Claim all · ${iconMarkup('crystal-cluster')} ${formatNumber(total)}`;
    const shown = FEATS.filter((f) => featVisible(p, f));
    this.count.textContent = `${FEATS.filter((f) => p.feats[f.id]).length}/${shown.length}`;
    // Waiting first, then the rest in table order, the paid ones last.
    const rank = (id: string): number => (p.feats[id] === 'done' ? 0 : p.feats[id] === 'claimed' ? 2 : 1);
    const feats = [...shown].sort((a, b) => rank(a.id) - rank(b.id));
    this.list.replaceChildren(...feats.map((f) => {
      const state = p.feats[f.id];
      // A secret feat (§5.4) is "???" and its riddle until earned.
      const secret = !!f.riddle && !state;
      const li = document.createElement('li');
      li.className = `entry feat${state === 'done' ? ' is-ready' : state === 'claimed' ? ' is-claimed' : ''}${secret ? ' is-unknown' : ''}`;
      const head = document.createElement('div');
      head.className = 'entry-head';
      const name = document.createElement('span');
      name.className = 'entry-name';
      name.textContent = secret ? '???' : f.name;
      const reward = document.createElement('span');
      reward.className = 'entry-count';
      reward.innerHTML = `${iconMarkup('crystal-cluster')} ${formatNumber(f.reward)}`;
      head.append(icon(secret ? 'locked-chest' : f.icon), name, reward);
      const text = document.createElement('p');
      text.className = secret ? 'entry-lore' : 'entry-text';
      text.textContent = secret ? `“${f.riddle}”` : f.text;
      li.append(head, text);
      if (state === 'done') {
        const claim = document.createElement('button');
        claim.type = 'button';
        claim.className = 'btn btn-primary feat-claim';
        claim.textContent = 'Claim';
        claim.addEventListener('click', () => {
          if (this.actions.claim(f.id) > 0) this.render();
        });
        li.append(claim);
      } else if (!state && !secret) {
        const prog = featProgress(p, f);
        if (prog > 0) {
          const bar = document.createElement('div');
          bar.className = 'feat-bar';
          const fill = document.createElement('div');
          fill.className = 'feat-fill';
          setStyle(fill, 'transform', `scaleX(${prog.toFixed(3)})`);
          bar.append(fill);
          li.append(bar);
        }
      }
      return li;
    }));
  }
}

/** True when a feat waits to be claimed: the Feats tab shows a dot. */
export function featsBadge(profile: Profile): boolean {
  return claimable(profile).length > 0;
}
