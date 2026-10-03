import type { Profile } from '../../meta/profile';
import { formatDuration, formatNumber } from '../../core/format';
import { act2Open, hubUnlocks, inAbyss, inRush, selectedFrame, selectedRegion, type HubUnlocks } from '../../meta/collection';
import { RUSH_STAGES } from '../../content/rush';
import { hubGoal } from '../../meta/goals';
import { heat } from '../../meta/pacts';
import type { PactId, RelicId, TrimId } from '../../content/types';
import { setStyle, setText, toggleClass } from '../dom';
import { icon, iconMarkup } from '../icon';
import { CollectionView } from './collection';
import { FeatsView, featsBadge } from './feats';
import { ForgeView, StarsView, forgeBadge, starsBadge } from './forge';
import { MapView } from './map';
import { PactsView } from './pacts';
import { TacticsView } from './tactics';
import { automations, tacticsKey } from '../../meta/automation';
import { explainersFor } from '../../meta/explainers';

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
  /** Pin a Forge node to the Foreman's wishlist, or unpin it (N7). */
  pin(id: string): boolean;
  /** The first time the Forge opens (§7.1): the app records the lesson. */
  forgeOpened(): boolean;
  selectRegion(index: number): void;
  /** Begin a Trial (N5): the next run, at once. */
  trial(id: string): void;
  toggleRelic(id: RelicId): boolean;
  selectFrame(id: string): void;
  toggleTrim(trim: TrimId): void;
  claim(id: string): number;
  claimAll(): number;
  /** The Tactician's lists under a key (§6.2, U7); null drops the key's own. */
  setTactics(key: string, lists: { order: readonly string[]; never: readonly string[] } | null): void;
  /** Light a Constellation node (§9). */
  buyStar(id: string): boolean;
  /** Set a pact's rank for the next run (§9). */
  setPact(id: PactId, rank: number): boolean;
  /** Open the settings (§10.1: behind the gear). */
  settings(): void;
  /**
   * A view opened, or its "?" was pressed (§7.1): the app tells its
   * explainers, unread ones only unless `asked`, after `wait` ms.
   */
  explain(view: HubView, asked: boolean, wait: number): void;
}

/**
 * How long an explainer waits on the Map's light spreading (§7.3, 1.6 s);
 * past the Act 1 ending's card (`App#ending`, 2.4 s), which then goes first.
 */
const SPREAD_MS = 2600;

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
  private readonly bestLabel: HTMLElement;
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
      <button type="button" class="hub-gear" aria-label="Settings">${iconMarkup('cog')}</button>
      <button type="button" class="help-btn hub-help" data-view="home" aria-label="How this works" hidden>?</button>
      <div class="hub-home">
        <div class="hub-group">
          <h1 class="hub-title">The Tower</h1>
          <p class="hub-sub">The Blight is closing in. Hold the light.</p>
        </div>
        <div class="hub-group">
          <dl class="hub-stats">
            <div><dt>Shards</dt><dd class="hub-shards">0</dd></div>
            <div><dt class="hub-best-label">Best wave</dt><dd class="hub-best">—</dd></div>
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
    this.bestLabel = q('.hub-best-label');
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
    // The views pad by the dock's height; tabs wrapping to two rows grows it.
    // Only the part above the hub's own bottom padding, which the views already sit inside.
    const fitDock = new ResizeObserver(() => {
      const contentBottom = this.root.getBoundingClientRect().bottom - parseFloat(getComputedStyle(this.root).paddingBottom);
      const h = Math.max(0, contentBottom - dock.getBoundingClientRect().top);
      this.root.style.setProperty('--dock-h', `${Math.ceil(h)}px`);
    });
    fitDock.observe(dock);
    fitDock.observe(this.root);
    const refreshing = <T>(fn: () => T): T => {
      const out = fn();
      this.refresh();
      return out;
    };
    this.forge = new ForgeView(this.root, {
      buy: (id) => refreshing(() => actions.buy(id)),
      refund: (id) => refreshing(() => actions.refund(id)),
      pin: (id) => actions.pin(id),
      pinned: (p) => (automations(p).has('foreman') ? p.wishlist : null),
    });
    this.map = new MapView(this.root, (index) => {
      actions.selectRegion(index);
      if (this.profile) this.map.show(this.profile);
      this.refresh();
    }, (id) => actions.trial(id));
    this.collection = new CollectionView(this.root, {
      toggleRelic: (id) => refreshing(() => actions.toggleRelic(id)),
      selectFrame: (id) => refreshing(() => actions.selectFrame(id)),
      toggleTrim: (trim) => refreshing(() => actions.toggleTrim(trim)),
    });
    this.feats = new FeatsView(this.root, {
      claim: (id) => refreshing(() => actions.claim(id)),
      claimAll: () => refreshing(() => actions.claimAll()),
    });
    this.tactics = new TacticsView(this.root, {
      setTactics: (key, lists) => actions.setTactics(key, lists),
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
    const views: [HubView, HTMLElement][] = [
      ['forge', this.forge.root], ['map', this.map.root], ['collection', this.collection.root], ['feats', this.feats.root],
      ['stars', this.stars.root], ['tactics', this.tactics.root], ['pacts', this.pacts.root],
    ];
    for (const [view, v] of views) {
      this.root.insertBefore(v, dock);
      // Each view's "?" (§7.1) sits in its title.
      const help = document.createElement('button');
      help.type = 'button';
      help.className = 'help-btn';
      help.dataset.view = view;
      help.setAttribute('aria-label', 'How this works');
      help.textContent = '?';
      help.hidden = true;
      v.querySelector('h2')?.append(help);
    }
    this.root.addEventListener('click', (e) => {
      const help = (e.target as HTMLElement).closest<HTMLElement>('.help-btn');
      if (help) actions.explain(help.dataset.view as HubView, true, 0);
    });
    this.tabs.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('.hub-tab');
      if (tab) this.setView(tab.dataset.view as HubView);
    });
    q('.hub-start').addEventListener('click', () => actions.start());
    q('.hub-gear').addEventListener('click', () => actions.settings());
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
    if (this.profile && !this.root.hidden) this.setView(this.view, false, false);
  }

  /** The view on screen, or null while the hub is hidden. */
  get current(): HubView | null {
    return this.root.hidden ? null : this.view;
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

  /** `tell`: tell the view's unread explainers (§7.1), after the light spreads when it does. */
  private setView(view: HubView, spread = false, tell = true): void {
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
    if (tell) this.actions.explain(view, false, spread ? SPREAD_MS : 0);
  }

  /** Numbers that move when shards are spent, and the tabs' dots. */
  private refresh(): void {
    const p = this.profile;
    if (!p) return;
    setText(this.shards, formatNumber(p.shards));
    // The selected region's own best (§7.3), the deepest floor in the Abyss, or Boss Rush's record (N8).
    const abyss = inAbyss(p);
    const rush = inRush(p);
    const best = abyss ? p.abyss.best : rush ? p.rush.best : (p.regions[selectedRegion(p).index]?.bestWave ?? 0);
    setText(this.bestLabel, abyss ? 'Deepest floor' : rush ? 'Record' : 'Best wave');
    const record = rush && p.rush.time !== null ? formatDuration(p.rush.time) : rush && best > 0 ? `${best}/${RUSH_STAGES}` : null;
    setText(this.best, record ?? (best > 0 ? String(best) : '—'));
    const where = abyss ? 'The Abyss' : rush ? 'Boss Rush' : selectedRegion(p).name;
    setText(this.loadout, `${selectedFrame(p).name} · ${where}`);
    for (const help of this.root.querySelectorAll<HTMLElement>('.help-btn')) {
      help.hidden = explainersFor(p, help.dataset.view as HubView).length === 0;
    }
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
