import type { Profile } from '../../meta/profile';
import { formatNumber } from '../../core/format';
import { act2Open, hubUnlocks, inAbyss, selectedFrame, selectedRegion, type HubUnlocks } from '../../meta/collection';
import { hubGoal } from '../../meta/goals';
import { heat } from '../../meta/pacts';
import type { PactId, RelicId } from '../../content/types';
import { setStyle, setText, toggleClass } from '../dom';
import { icon } from '../icon';
import { CollectionView } from './collection';
import { FeatsView, featsBadge } from './feats';
import { ForgeView, StarsView, forgeBadge, starsBadge } from './forge';
import { MapView } from './map';
import { PactsView } from './pacts';
import { TacticsView } from './tactics';
import { tacticsKey } from '../../meta/automation';

/**
 * The hub's views. A tab exists only once its view is unlocked (R3);
 * Tactics and Pacts have no tab: they open from the home view once the
 * Tactician is owned, and once Act 2 opens (§9).
 */
export type HubView = 'home' | 'forge' | 'map' | 'collection' | 'feats' | 'stars' | 'tactics' | 'pacts';

/** Everything the hub can ask the app to do. */
export interface HubActions {
  start(): void;
  buy(id: string): boolean;
  refund(id: string): boolean;
  /** The first time the Forge opens (§7.1): the app records the lesson. */
  forgeOpened(): boolean;
  selectRegion(index: number): void;
  toggleRelic(id: RelicId): boolean;
  selectFrame(id: string): void;
  claim(id: string): number;
  claimAll(): number;
  /** The Tactician's list for the next run (§6.2). */
  setTactics(list: readonly string[]): void;
  /** Light a Constellation node (§9). */
  buyStar(id: string): boolean;
  /** Set a pact's rank for the next run (§9). */
  setPact(id: PactId, rank: number): boolean;
}

/** Tabs in the order they unlock and sit (§10.1). */
const TABS: readonly { view: Exclude<HubView, 'home' | 'tactics' | 'pacts'>; label: string }[] = [
  { view: 'forge', label: 'Forge' },
  { view: 'map', label: 'Map' },
  { view: 'collection', label: 'Collection' },
  { view: 'feats', label: 'Feats' },
  { view: 'stars', label: 'Stars' },
];

/**
 * The hub (§10.1): the home view (title, shards, best wave, the next run's
 * frame and region, and one Next goal line) and, as they unlock, the
 * Forge, Map, Collection and Feats behind bottom tabs. The Run button is
 * always on screen.
 */
export class HubScreen {
  private readonly root: HTMLElement;
  private readonly home: HTMLElement;
  private readonly shards: HTMLElement;
  private readonly best: HTMLElement;
  private readonly loadout: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly goalIcon: HTMLElement;
  private readonly goalText: HTMLElement;
  private readonly goalFill: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly forge: ForgeView;
  private readonly map: MapView;
  private readonly collection: CollectionView;
  private readonly feats: FeatsView;
  private readonly tactics: TacticsView;
  private readonly tacticsBtn: HTMLButtonElement;
  private readonly stars: StarsView;
  private readonly pacts: PactsView;
  private readonly pactsBtn: HTMLButtonElement;
  private readonly starlightStat: HTMLElement;
  private readonly starlightN: HTMLElement;
  private profile: Profile | null = null;
  private view: HubView = 'home';

  constructor(host: HTMLElement, private readonly actions: HubActions) {
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
            <div class="hub-starlight" hidden><dt>Starlight</dt><dd class="hub-starlight-n">0</dd></div>
          </dl>
          <p class="hub-loadout"></p>
          <div class="hub-actions">
            <button type="button" class="btn hub-tactics" hidden>Tactics</button>
            <button type="button" class="btn hub-pacts" hidden>Pacts</button>
          </div>
          <div class="hub-goal" hidden>
            <span class="hub-goal-label">Next</span>
            <span class="hub-goal-icon"></span>
            <span class="hub-goal-text"></span>
            <div class="hub-goal-bar"><div class="hub-goal-fill"></div></div>
          </div>
        </div>
      </div>
      <nav class="hub-dock">
        <div class="hub-tabs" role="tablist" hidden></div>
        <button type="button" class="btn btn-primary btn-big hub-start">Begin run</button>
      </nav>`;
    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector<T>(sel)!;
    this.home = q('.hub-home');
    this.shards = q('.hub-shards');
    this.best = q('.hub-best');
    this.loadout = q('.hub-loadout');
    this.goal = q('.hub-goal');
    this.goalIcon = q('.hub-goal-icon');
    this.goalText = q('.hub-goal-text');
    this.goalFill = q('.hub-goal-fill');
    this.tabs = q('.hub-tabs');
    this.tacticsBtn = q('.hub-tactics');
    this.tacticsBtn.addEventListener('click', () => this.setView('tactics'));
    this.pactsBtn = q('.hub-pacts');
    this.pactsBtn.addEventListener('click', () => this.setView('pacts'));
    this.starlightStat = q('.hub-starlight');
    this.starlightN = q('.hub-starlight-n');
    const dock = q('.hub-dock');
    const refreshing = <T>(fn: () => T): T => {
      const out = fn();
      this.refresh();
      return out;
    };
    this.forge = new ForgeView(this.root, {
      buy: (id) => refreshing(() => actions.buy(id)),
      refund: (id) => refreshing(() => actions.refund(id)),
    });
    this.map = new MapView(this.root, (index) => {
      actions.selectRegion(index);
      if (this.profile) this.map.show(this.profile);
      this.refresh();
    });
    this.collection = new CollectionView(this.root, {
      toggleRelic: (id) => refreshing(() => actions.toggleRelic(id)),
      selectFrame: (id) => refreshing(() => actions.selectFrame(id)),
    });
    this.feats = new FeatsView(this.root, {
      claim: (id) => refreshing(() => actions.claim(id)),
      claimAll: () => refreshing(() => actions.claimAll()),
    });
    this.tactics = new TacticsView(this.root, {
      setTactics: (list) => actions.setTactics(list),
      done: () => this.setView('home'),
    });
    this.stars = new StarsView(this.root, {
      buy: (id) => refreshing(() => actions.buyStar(id)),
      refund: () => false,
    });
    this.pacts = new PactsView(this.root, {
      setPact: (id, rank) => refreshing(() => actions.setPact(id, rank)),
      done: () => this.setView('home'),
    });
    const views = [this.forge.root, this.map.root, this.collection.root, this.feats.root, this.stars.root, this.tactics.root, this.pacts.root];
    for (const v of views) this.root.insertBefore(v, dock);
    this.tabs.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('.hub-tab');
      if (tab) this.setView(tab.dataset.view as HubView);
    });
    q('.hub-start').addEventListener('click', () => actions.start());
    host.appendChild(this.root);
    this.hide();
  }

  /** Open the hub on `view`. `spread` plays the map's light spreading (§7.3). */
  show(profile: Profile, view: HubView = 'home', spread = false): void {
    this.profile = profile;
    this.root.hidden = false;
    this.renderTabs(hubUnlocks(profile));
    const open = view === 'home'
      || (view === 'tactics' ? tacticsKey(profile) !== null : view === 'pacts' ? act2Open(profile) : hubUnlocks(profile)[view]);
    this.setView(open ? view : 'home', spread);
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Redraw the open view after the profile changed underneath it (offline shards, say). */
  update(): void {
    if (this.profile && !this.root.hidden) this.setView(this.view);
  }

  private renderTabs(unlocks: HubUnlocks): void {
    const shown = TABS.filter((t) => unlocks[t.view]);
    this.tabs.hidden = shown.length === 0;
    toggleClass(this.tabs, 'is-crowded', shown.length >= TABS.length);
    const home = document.createElement('button');
    home.type = 'button';
    home.className = 'hub-tab';
    home.setAttribute('role', 'tab');
    home.dataset.view = 'home';
    home.textContent = 'Tower';
    this.tabs.replaceChildren(home, ...shown.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hub-tab';
      b.setAttribute('role', 'tab');
      b.dataset.view = t.view;
      b.textContent = t.label;
      return b;
    }));
  }

  private setView(view: HubView, spread = false): void {
    const p = this.profile;
    if (!p) return;
    this.view = view;
    this.root.dataset.view = view;
    this.home.hidden = view !== 'home';
    this.forge.root.hidden = view !== 'forge';
    this.map.root.hidden = view !== 'map';
    this.collection.root.hidden = view !== 'collection';
    this.feats.root.hidden = view !== 'feats';
    this.stars.root.hidden = view !== 'stars';
    this.tactics.root.hidden = view !== 'tactics';
    this.pacts.root.hidden = view !== 'pacts';
    for (const t of this.tabs.querySelectorAll<HTMLElement>('.hub-tab')) {
      const on = t.dataset.view === view;
      toggleClass(t, 'is-active', on);
      t.setAttribute('aria-selected', String(on));
    }
    if (view === 'forge') this.forge.show(p, this.actions.forgeOpened());
    if (view === 'map') this.map.show(p, spread);
    if (view === 'collection') this.collection.show(p);
    if (view === 'feats') this.feats.show(p);
    if (view === 'tactics') this.tactics.show(p);
    if (view === 'stars') this.stars.show(p, false);
    if (view === 'pacts') this.pacts.show(p);
    this.refresh();
  }

  /** Numbers that move when shards are spent, and the tabs' dots. */
  private refresh(): void {
    const p = this.profile;
    if (!p) return;
    setText(this.shards, formatNumber(p.shards));
    setText(this.best, p.records.bestWave > 0 ? String(p.records.bestWave) : '—');
    setText(this.loadout, `${selectedFrame(p).name} · ${inAbyss(p) ? 'The Abyss' : selectedRegion(p).name}`);
    this.tacticsBtn.hidden = tacticsKey(p) === null;
    const act2 = act2Open(p);
    this.pactsBtn.hidden = !act2;
    this.starlightStat.hidden = !act2;
    setText(this.starlightN, formatNumber(p.starlight));
    setText(this.pactsBtn, `Pacts · Heat ${heat(p)}`);
    const goal = p.records.runs > 0 ? hubGoal(p) : null;
    this.goal.hidden = goal === null;
    if (goal) {
      this.goalIcon.replaceChildren(icon(goal.icon));
      setText(this.goalText, goal.text);
      this.goalFill.parentElement!.hidden = goal.progress === null;
      setStyle(this.goalFill, 'transform', `scaleX(${(goal.progress ?? 0).toFixed(3)})`);
    }
    for (const t of this.tabs.querySelectorAll<HTMLElement>('.hub-tab')) {
      const v = t.dataset.view;
      const dot = v !== this.view && ((v === 'forge' && forgeBadge(p)) || (v === 'feats' && featsBadge(p)) || (v === 'stars' && starsBadge(p)));
      toggleClass(t, 'has-badge', dot);
    }
  }
}
