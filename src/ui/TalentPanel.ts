import type { GameState, TalentBranch, TalentId } from '../types';
import { TALENTS, TALENTS_BY_BRANCH, TALENT_BY_ID } from '../data/talentTree';
import type { TalentDef } from '../data/talentTree';
import { setText, toggleClass, setStyle } from '../utils/dom';
import { formatNumber } from '../utils/bigNumber';
import { renderIcon } from './Icon';

export interface TalentAPIDeps {
  allocated: Record<string, number>;
  unspentPoints: () => number;
  canAllocate: (id: string) => boolean;
  allocate: (id: string) => boolean;
  refundBranch: (branch: TalentBranch) => boolean;
  /** Plan §4.7: refund every branch in one action. */
  refundAll: () => boolean;
  branchRespecCost: (branch: TalentBranch) => number;
  fullRespecCost: () => number;
  gold: () => number;
}

const BRANCH_DISPLAY: { id: TalentBranch; label: string; color: string }[] = [
  { id: 'offense', label: 'Offense', color: '#e74c3c' },
  { id: 'defense', label: 'Defense', color: '#2ecc71' },
  { id: 'utility', label: 'Utility', color: '#f1c40f' },
  { id: 'magic', label: 'Magic', color: '#9b59b6' },
];


/** Tri-state shared by a node and by the link that leads into it. */
type LinkState = 'spent' | 'available' | 'locked';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Shape, not hue: a checked node, an open ring, a padlock. */
const STATE_GLYPH: Record<LinkState, string> = {
  spent: '✓',
  available: '○',
  locked: '\u{1F512}',
};

const STATE_LABEL: Record<LinkState, string> = {
  spent: 'Points spent',
  available: 'Available',
  locked: 'Locked',
};

/**
 * §8.D: the parent plan asked for a canvas tree; there is no canvas here, and
 * rebuilding these nodes as one would cost the tree its keyboard access, its
 * screen-reader text and its free hit-testing to buy curved lines. So the DOM
 * nodes stay and an SVG link layer goes behind them. See `docs/xp-talent-system.md`.
 */
interface BranchLinks {
  /** The positioned box the links are measured against. */
  tree: HTMLElement;
  svg: SVGSVGElement;
  edges: { parent: TalentId; child: TalentId; path: SVGPathElement }[];
}

function computeDepths(branch: TalentBranch): Map<string, number> {
  const talents = TALENTS_BY_BRANCH[branch];
  const depths = new Map<string, number>();
  const queue: string[] = [];
  for (const t of talents) {
    if (t.prerequisites.length === 0) {
      depths.set(t.id, 0);
      queue.push(t.id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depths.get(id)!;
    for (const t of talents) {
      if (t.prerequisites.includes(id) && !depths.has(t.id)) {
        depths.set(t.id, d + 1);
        queue.push(t.id);
      }
    }
  }
  return depths;
}

export class TalentPanel {
  private deps: TalentAPIDeps;
  private root: HTMLElement | null = null;
  private unspentEl!: HTMLElement;
  private talentCards = new Map<TalentId, HTMLElement>();
  private talentPointsEls = new Map<TalentId, HTMLElement>();
  private talentBtnEls = new Map<TalentId, HTMLButtonElement>();
  private respecBtns = new Map<TalentBranch, HTMLButtonElement>();
  private respecAllBtn: HTMLButtonElement | null = null;
  private branchSummaryEls = new Map<TalentBranch, HTMLElement>();
  private activeTab: TalentBranch = 'offense';
  private branchLinks = new Map<TalentBranch, BranchLinks>();
  private resizeObserver: ResizeObserver | null = null;

  constructor(deps: TalentAPIDeps) {
    this.deps = deps;
  }

  setDeps(deps: TalentAPIDeps): void {
    this.deps = deps;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.talentCards.clear();
    this.talentPointsEls.clear();
    this.talentBtnEls.clear();
    this.respecBtns.clear();
    this.respecAllBtn = null;
    this.branchSummaryEls.clear();
    this.branchLinks.clear();
    this.activeTab = 'offense';
    this.renderInto(parent);

    // Geometry is recomputed on mount and on resize only — never per frame.
    // A hidden tab measures as zero, so `showTab` re-runs the pass too.
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.layoutLinks(this.activeTab));
      const links = this.branchLinks.get(this.activeTab);
      if (links) this.resizeObserver.observe(links.tree);
    }
    this.layoutLinks(this.activeTab);
  }

  update(_state: GameState): void {
    if (!this.root) return;
    setText(this.unspentEl, `${this.deps.unspentPoints()} unspent`);

    for (const talent of TALENTS) {
      const card = this.talentCards.get(talent.id);
      const ptsEl = this.talentPointsEls.get(talent.id);
      const btn = this.talentBtnEls.get(talent.id);
      if (!card || !ptsEl || !btn) continue;

      const current = this.deps.allocated[talent.id] ?? 0;
      setText(ptsEl, `${current} / ${talent.maxPoints}`);

      if (current >= talent.maxPoints) {
        toggleClass(card, 'talent-maxed', true);
        toggleClass(card, 'talent-available', false);
        toggleClass(card, 'talent-locked', false);
        btn.disabled = true;
        setText(btn, 'Maxed');
      } else if (this.deps.canAllocate(talent.id)) {
        toggleClass(card, 'talent-maxed', false);
        toggleClass(card, 'talent-available', true);
        toggleClass(card, 'talent-locked', false);
        btn.disabled = false;
        setText(btn, 'Buy');
      } else {
        toggleClass(card, 'talent-maxed', false);
        toggleClass(card, 'talent-available', false);
        toggleClass(card, 'talent-locked', true);
        btn.disabled = true;
        setText(btn, 'Locked');
      }

      // §8.D tri-state, carried without relying on colour: the glyph and the
      // screen-reader label say the same thing the tint does.
      const state = this.stateOf(talent.id);
      if (card.dataset.state !== state) {
        card.dataset.state = state;
        const glyph = card.querySelector<HTMLElement>('.talent-state-glyph');
        if (glyph) {
          glyph.textContent = STATE_GLYPH[state];
          glyph.title = STATE_LABEL[state];
        }
        const sr = card.querySelector<HTMLElement>('.talent-state-label');
        if (sr) setText(sr, STATE_LABEL[state]);
      }
    }

    for (const links of this.branchLinks.values()) {
      for (const edge of links.edges) {
        const state = this.stateOf(edge.child);
        const cls = `talent-link is-${state}`;
        if (edge.path.getAttribute('class') !== cls) edge.path.setAttribute('class', cls);
      }
    }

    const gold = this.deps.gold();
    for (const branch of BRANCH_DISPLAY) {
      const btn = this.respecBtns.get(branch.id);
      if (!btn) continue;
      const cost = this.deps.branchRespecCost(branch.id);
      setText(btn, `Reset ${branch.label} (${formatNumber(cost)}g)`);
      // Disabled either because there is nothing to refund or because the
      // refund is unaffordable — the title says which.
      btn.disabled = cost <= 0 || gold < cost;
      btn.title = cost <= 0
        ? `No points invested in ${branch.label}.`
        : gold < cost
          ? `Costs ${formatNumber(cost)} gold — you have ${formatNumber(gold)}.`
          : `Refunds every ${branch.label} point for ${formatNumber(cost)} gold.`;
    }
    if (this.respecAllBtn) {
      const allCost = this.deps.fullRespecCost();
      setText(this.respecAllBtn, `Reset all talents (${formatNumber(allCost)}g)`);
      this.respecAllBtn.disabled = allCost <= 0 || gold < allCost;
      this.respecAllBtn.title = allCost <= 0
        ? 'No talent points invested.'
        : gold < allCost
          ? `Costs ${formatNumber(allCost)} gold — you have ${formatNumber(gold)}.`
          : `Refunds every allocated talent point for ${formatNumber(allCost)} gold.`;
    }

    for (const branch of BRANCH_DISPLAY) {
      const summaryEl = this.branchSummaryEls.get(branch.id);
      if (!summaryEl) continue;
      const talents = TALENTS_BY_BRANCH[branch.id];
      let invested = 0;
      let total = 0;
      for (const t of talents) {
        invested += this.deps.allocated[t.id] ?? 0;
        total += t.maxPoints;
      }
      setText(summaryEl, `${invested} / ${total} points invested`);
    }
  }

  private unmount(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.branchLinks.clear();
    this.root = null;
  }

  /** spent | available | locked, for a node and for the link that leads into it. */
  private stateOf(id: TalentId): LinkState {
    if ((this.deps.allocated[id] ?? 0) > 0) return 'spent';
    return this.deps.canAllocate(id) ? 'available' : 'locked';
  }

  /**
   * Read every node rect, *then* write every path. Interleaving reads and
   * writes would force a layout per node.
   */
  private layoutLinks(branch: TalentBranch): void {
    const links = this.branchLinks.get(branch);
    if (!links) return;
    const host = links.tree.getBoundingClientRect();
    if (host.width === 0 || host.height === 0) return;
    links.svg.setAttribute('viewBox', `0 0 ${host.width} ${host.height}`);

    const geometry: { path: SVGPathElement; d: string }[] = [];
    for (const edge of links.edges) {
      const parentEl = this.talentCards.get(edge.parent);
      const childEl = this.talentCards.get(edge.child);
      if (!parentEl || !childEl) continue;
      const a = parentEl.getBoundingClientRect();
      const b = childEl.getBoundingClientRect();
      // Relative to the tree, not the viewport, so this survives the panel's
      // own scrolling and its resizable width.
      const x0 = a.left - host.left + a.width / 2;
      const y0 = a.bottom - host.top;
      const x1 = b.left - host.left + b.width / 2;
      const y1 = b.top - host.top;
      const dy = y1 - y0;
      geometry.push({
        path: edge.path,
        d: `M ${x0} ${y0} C ${x0} ${y0 + dy * 0.45}, ${x1} ${y1 - dy * 0.45}, ${x1} ${y1}`,
      });
    }
    for (const g of geometry) g.path.setAttribute('d', g.d);
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'talent-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Talent Tree';
    parent.appendChild(title);

    const unspentBar = document.createElement('div');
    unspentBar.className = 'talent-unspent-bar';
    const unspentLabel = document.createElement('span');
    unspentLabel.textContent = 'Talent Points: ';
    this.unspentEl = document.createElement('span');
    this.unspentEl.className = 'talent-unspent-value';
    this.unspentEl.textContent = '0 unspent';
    unspentBar.appendChild(unspentLabel);
    unspentBar.appendChild(this.unspentEl);
    parent.appendChild(unspentBar);

    const tabs = document.createElement('div');
    tabs.className = 'talent-tabs';
    for (const branch of BRANCH_DISPLAY) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      btn.textContent = branch.label;
      btn.dataset.talentTab = branch.id;
      setStyle(btn, '--branch-color', branch.color);
      btn.addEventListener('click', () => this.showTab(branch.id));
      tabs.appendChild(btn);
    }
    parent.appendChild(tabs);

    for (const branch of BRANCH_DISPLAY) {
      parent.appendChild(this.renderBranchPanel(branch));
    }

    // Full respec sits outside the per-branch panels: it applies to all of
    // them, and a player who wants to start over should not have to visit
    // four tabs to do it.
    const respecAllRow = document.createElement('div');
    respecAllRow.className = 'talent-respec-row talent-respec-all';
    const respecAllBtn = document.createElement('button');
    respecAllBtn.type = 'button';
    respecAllBtn.className = 'btn btn-respec';
    respecAllBtn.textContent = 'Reset all talents';
    respecAllBtn.disabled = true;
    respecAllBtn.addEventListener('click', () => this.deps.refundAll());
    this.respecAllBtn = respecAllBtn;
    respecAllRow.appendChild(respecAllBtn);
    parent.appendChild(respecAllRow);

    const note = document.createElement('p');
    note.className = 'panel-note';
    note.textContent = 'Resetting refunds every point spent, at a gold cost per point. '
      + 'Refunded points return to your unspent pool.';
    parent.appendChild(note);

    this.showTab(this.activeTab);
  }

  private renderBranchPanel(branch: { id: TalentBranch; label: string; color: string }): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'talent-tab-panel';
    panel.dataset.talentTabPanel = branch.id;

    const summary = document.createElement('div');
    summary.className = 'talent-branch-summary';
    setStyle(summary, '--branch-color', branch.color);
    this.branchSummaryEls.set(branch.id, summary);
    panel.appendChild(summary);

    const tree = document.createElement('div');
    tree.className = 'talent-tree';
    setStyle(tree, '--branch-color', branch.color);

    const talents = TALENTS_BY_BRANCH[branch.id];
    const depths = computeDepths(branch.id);

    const sorted = [...talents].sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0);
    });

    // The link layer sits behind the nodes: one <svg> per branch, absolutely
    // positioned over the tree, `pointer-events: none` so it never eats a tap.
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'talent-link-layer');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('preserveAspectRatio', 'none');
    tree.appendChild(svg);

    const edges: BranchLinks['edges'] = [];
    for (const talent of sorted) {
      const depth = depths.get(talent.id) ?? 0;
      tree.appendChild(this.renderTalentCard(talent, depth));
      for (const prereq of talent.prerequisites) {
        if (!talents.some(t => t.id === prereq)) continue;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'talent-link is-locked');
        svg.appendChild(path);
        edges.push({ parent: prereq as TalentId, child: talent.id, path });
      }
    }
    this.branchLinks.set(branch.id, { tree, svg, edges });

    panel.appendChild(tree);

    const respecRow = document.createElement('div');
    respecRow.className = 'talent-respec-row';
    const respecBtn = document.createElement('button');
    respecBtn.type = 'button';
    respecBtn.className = 'btn btn-respec';
    respecBtn.textContent = `Reset ${branch.label}`;
    respecBtn.disabled = true;
    respecBtn.addEventListener('click', () => this.deps.refundBranch(branch.id));
    this.respecBtns.set(branch.id, respecBtn);
    respecRow.appendChild(respecBtn);
    panel.appendChild(respecRow);

    return panel;
  }

  private renderTalentCard(talent: TalentDef, depth: number): HTMLElement {
    const card = document.createElement('div');
    card.className = 'talent-card talent-locked';
    card.dataset.talentId = talent.id;
    card.dataset.depth = String(depth);
    card.dataset.state = 'locked';
    this.talentCards.set(talent.id, card);

    const state = document.createElement('span');
    state.className = 'talent-state-glyph';
    state.setAttribute('aria-hidden', 'true');
    state.textContent = STATE_GLYPH.locked;
    state.title = STATE_LABEL.locked;
    card.appendChild(state);

    const srState = document.createElement('span');
    srState.className = 'talent-state-label sr-only';
    srState.textContent = STATE_LABEL.locked;
    card.appendChild(srState);

    const glyph = document.createElement('div');
    glyph.className = 'talent-card-glyph';
    setStyle(glyph, '--talent-color', talent.color);
    renderIcon(glyph, talent.icon);
    card.appendChild(glyph);

    const body = document.createElement('div');
    body.className = 'talent-card-body';

    const header = document.createElement('div');
    header.className = 'talent-card-header';
    const name = document.createElement('span');
    name.className = 'talent-name';
    name.textContent = talent.name;
    header.appendChild(name);

    const tierBadge = document.createElement('span');
    tierBadge.className = 'talent-tier-badge';
    tierBadge.textContent = `T${talent.tier}`;
    header.appendChild(tierBadge);

    const pts = document.createElement('span');
    pts.className = 'talent-points';
    this.talentPointsEls.set(talent.id, pts);
    header.appendChild(pts);

    if (talent.exclusive) {
      const excl = document.createElement('span');
      excl.className = 'talent-exclusive-badge';
      excl.textContent = 'Exclusive';
      header.appendChild(excl);
    }

    body.appendChild(header);

    const desc = document.createElement('div');
    desc.className = 'talent-card-desc';
    desc.textContent = talent.description;
    body.appendChild(desc);

    const footer = document.createElement('div');
    footer.className = 'talent-card-footer';
    if (talent.prerequisites.length > 0) {
      const prereq = document.createElement('span');
      prereq.className = 'talent-prereq';
      prereq.textContent = `Requires: ${talent.prerequisites.map(id => TALENT_BY_ID[id]?.name ?? id).join(', ')}`;
      footer.appendChild(prereq);
    }
    body.appendChild(footer);

    card.appendChild(body);

    const action = document.createElement('div');
    action.className = 'talent-card-action';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-buy';
    btn.textContent = 'Locked';
    btn.disabled = true;
    btn.addEventListener('click', () => this.deps.allocate(talent.id));
    this.talentBtnEls.set(talent.id, btn);
    action.appendChild(btn);
    card.appendChild(action);

    return card;
  }

  private showTab(id: TalentBranch): void {
    this.activeTab = id;
    if (!this.root) return;
    for (const el of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.talent-tabs .tab-btn'))) {
      toggleClass(el, 'active', el.dataset.talentTab === id);
    }
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('.talent-tab-panel'))) {
      toggleClass(el, 'active', el.dataset.talentTabPanel === id);
    }
    // A hidden panel measures as zero, so the links for the tab we just
    // revealed have to be laid out now (and are the only ones worth watching).
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      const links = this.branchLinks.get(id);
      if (links) this.resizeObserver.observe(links.tree);
    }
    this.layoutLinks(id);
  }
}
