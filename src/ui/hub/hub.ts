import type { Profile } from '../../meta/profile';
import { formatNumber } from '../../core/format';
import { setText, toggleClass } from '../dom';
import { ForgeView, forgeBadge, type ForgeActions } from './forge';

/** The hub's views. A tab exists only once its view is unlocked (R3). */
export type HubView = 'home' | 'forge';

/**
 * The hub (§10.1): the home view (title, shards, best wave) and, from the
 * first run's end, the Forge behind a bottom tab. The Run button is always
 * on screen. Map, Collection and Feats join the tabs in P4.
 */
export class HubScreen {
  private readonly root: HTMLElement;
  private readonly home: HTMLElement;
  private readonly shards: HTMLElement;
  private readonly best: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly forgeTab: HTMLButtonElement;
  private readonly forge: ForgeView;
  private profile: Profile | null = null;
  private view: HubView = 'home';

  constructor(
    host: HTMLElement,
    onStart: () => void,
    actions: ForgeActions,
    /** The first time the Forge opens (§7.1): the app records the lesson. */
    private readonly onForgeOpened: () => boolean,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'screen hub';
    // Two groups, above and below the centre, so the backdrop tower the
    // renderer draws there stays in the clear between them.
    this.root.innerHTML = `
      <div class="hub-home">
        <div class="hub-group">
          <h1 class="hub-title">The Tower</h1>
          <p class="hub-sub">The Blight is closing in. Hold the light.</p>
        </div>
        <div class="hub-group">
          <dl class="hub-stats">
            <div><dt>Shards</dt><dd class="hub-shards">0</dd></div>
            <div><dt>Best wave</dt><dd class="hub-best">—</dd></div>
          </dl>
        </div>
      </div>
      <nav class="hub-dock">
        <div class="hub-tabs" role="tablist" hidden>
          <button type="button" class="hub-tab" role="tab" data-view="home">Tower</button>
          <button type="button" class="hub-tab" role="tab" data-view="forge">Forge</button>
        </div>
        <button type="button" class="btn btn-primary btn-big hub-start">Begin run</button>
      </nav>`;
    this.home = this.root.querySelector('.hub-home')!;
    this.shards = this.root.querySelector('.hub-shards')!;
    this.best = this.root.querySelector('.hub-best')!;
    this.tabs = this.root.querySelector('.hub-tabs')!;
    this.forgeTab = this.root.querySelector('.hub-tab[data-view="forge"]')!;
    this.forge = new ForgeView(this.root, {
      buy: (id) => {
        const ok = actions.buy(id);
        if (ok) this.refresh();
        return ok;
      },
      refund: (id) => {
        const ok = actions.refund(id);
        if (ok) this.refresh();
        return ok;
      },
    });
    this.root.insertBefore(this.forge.root, this.root.querySelector('.hub-dock'));
    this.tabs.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('.hub-tab');
      if (tab) this.setView(tab.dataset.view as HubView);
    });
    this.root.querySelector('.hub-start')!.addEventListener('click', onStart);
    host.appendChild(this.root);
    this.hide();
  }

  show(profile: Profile, view: HubView = 'home'): void {
    this.profile = profile;
    // The Forge is revealed by the first run's end (§7.1).
    this.tabs.hidden = profile.records.runs === 0;
    this.root.hidden = false;
    this.setView(this.tabs.hidden ? 'home' : view);
  }

  hide(): void {
    this.root.hidden = true;
  }

  private setView(view: HubView): void {
    const p = this.profile;
    if (!p) return;
    this.view = view;
    this.root.dataset.view = view;
    this.home.hidden = view !== 'home';
    this.forge.root.hidden = view !== 'forge';
    for (const t of this.tabs.querySelectorAll<HTMLElement>('.hub-tab')) {
      const on = t.dataset.view === view;
      toggleClass(t, 'is-active', on);
      t.setAttribute('aria-selected', String(on));
    }
    if (view === 'forge') this.forge.show(p, this.onForgeOpened());
    this.refresh();
  }

  /** Numbers that move when shards are spent. */
  private refresh(): void {
    const p = this.profile;
    if (!p) return;
    setText(this.shards, formatNumber(p.shards));
    setText(this.best, p.records.bestWave > 0 ? String(p.records.bestWave) : '—');
    toggleClass(this.forgeTab, 'has-badge', this.view !== 'forge' && forgeBadge(p));
  }
}
