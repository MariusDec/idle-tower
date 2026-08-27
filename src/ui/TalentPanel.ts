import type { GameState, TalentBranch } from '../types';
import {
  TALENTS_BY_BRANCH,
  TALENT_BY_ID,
  TALENT_GRID,
  TALENT_ENDLESS,
  type TalentDef,
  type TalentId,
} from '../data/talentTree';
import {
  setText,
  toggleClass,
  setStyle,
  setDisplay,
  setDisabled,
  setTitle,
} from '../utils/dom';
import { formatNumber } from '../utils/bigNumber';
import { FX } from '../data/palette';
import { renderIcon } from './Icon';
import { bindLongPress } from '../utils/longPress';

// ── Public API ───────────────────────────────────────────────────────────────

export interface TalentAPIDeps {
  allocated: Record<string, number>;
  unspentPoints: () => number;
  level: () => number;
  xpProgress: () => number;
  atLevelCap: () => boolean;
  canAllocate: (id: string) => boolean;
  blockedReason: (id: string) => 'maxed' | 'no_points' | 'prereq' | 'gate' | 'exclusive' | null;
  allocate: (id: string) => boolean;
  pointsInBranch: (branch: TalentBranch) => number;
  refundBranch: (branch: TalentBranch) => boolean;
  refundAll: () => boolean;
  branchRespecCost: (branch: TalentBranch) => number;
  fullRespecCost: () => number;
  gold: () => number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const BRANCH_DISPLAY: { id: TalentBranch; label: string; color: string }[] = [
  { id: 'offense', label: 'Wrath', color: FX.blood },
  { id: 'defense', label: 'Bulwark', color: FX.nature },
  { id: 'utility', label: 'Fortune', color: FX.gold },
  { id: 'magic', label: 'Arcana', color: FX.arcane },
];

const BRANCH_LABEL: Record<TalentBranch, string> =
  Object.fromEntries(BRANCH_DISPLAY.map(b => [b.id, b.label])) as Record<TalentBranch, string>;

const ROW_GATES: Record<number, number> = { 2: 4, 3: 12, 4: 22, 5: 32 };

/**
 * Reachable points per branch: every non-keystone rank in rows 1–4, plus the
 * single keystone the player may take. The endless node is deliberately absent
 * — it has no ceiling, so it cannot be the denominator of a progress readout.
 * Total = 160 across the four branches.
 */
const BRANCH_CAPACITY: Record<TalentBranch, number> = (() => {
  const out = {} as Record<TalentBranch, number>;
  for (const branch of BRANCH_DISPLAY) {
    const nodes = TALENT_GRID[branch.id];
    out[branch.id] = nodes
      .filter(n => !n.exclusiveGroup)
      .reduce((s, n) => s + n.maxPoints, 0) + 1;
  }
  return out;
})();

/** Longest `effects` array in the tree; the detail card's delta row pools this many spans. */
const DETAIL_DELTA_SLOTS = 4;

type NodeState = 'maxed' | 'spent' | 'available' | 'gated' | 'locked';

const SVG_NS = 'http://www.w3.org/2000/svg';

const STATE_GLYPH: Record<NodeState, string> = {
  maxed: '\u2605',
  spent: '\u2713',
  available: '\u25CB',
  gated: '',
  locked: '\u{1F512}',
};

const STATE_LABEL: Record<NodeState, string> = {
  maxed: 'Maxed',
  spent: 'Points spent',
  available: 'Available',
  gated: 'Gated',
  locked: 'Locked',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatEffectValue(stat: string, value: number): string {
  const isPercent = stat.endsWith('_pct')
    || stat.includes('chance')
    || stat.includes('fraction')
    || stat === 'mana_cost_reduction'
    || stat === 'upgrade_cost_reduction';

  let display: number;
  let suffix: string;
  if (isPercent) {
    display = Math.abs(value) < 1 ? value * 100 : value;
    suffix = '%';
  } else {
    display = value;
    suffix = '';
  }

  const sign = display > 0 ? '+' : display < 0 ? '\u2212' : '';
  const abs = Math.abs(display);
  const formatted = abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1);
  return sign + formatted + suffix;
}

function pathFor(a: DOMRect, b: DOMRect, host: DOMRect): string {
  const x0 = a.left - host.left + a.width / 2;
  const y0 = a.bottom - host.top;
  const x1 = b.left - host.left + b.width / 2;
  const y1 = b.top - host.top;
  if (Math.abs(x1 - x0) < 1) return 'M ' + x0 + ' ' + y0 + ' L ' + x1 + ' ' + y1;
  const midY = y0 + (y1 - y0) / 2;
  const dir = Math.sign(x1 - x0);
  const r = Math.min(8, Math.abs(x1 - x0) / 2, Math.abs(midY - y0), Math.abs(y1 - midY));
  return 'M ' + x0 + ' ' + y0
    + ' L ' + x0 + ' ' + (midY - r)
    + ' Q ' + x0 + ' ' + midY + ' ' + (x0 + dir * r) + ' ' + midY
    + ' L ' + (x1 - dir * r) + ' ' + midY
    + ' Q ' + x1 + ' ' + midY + ' ' + x1 + ' ' + (midY + r)
    + ' L ' + x1 + ' ' + y1;
}

// ── Link geometry ────────────────────────────────────────────────────────────

interface BranchLinks {
  grid: HTMLElement;
  svg: SVGSVGElement;
  edges: { parent: TalentId; child: TalentId; path: SVGPathElement }[];
}

// ── Panel ────────────────────────────────────────────────────────────────────

export class TalentPanel {
  private deps: TalentAPIDeps;
  private root: HTMLElement | null = null;

  private levelEl!: HTMLElement;
  private xpBarFill!: HTMLElement;
  private xpLabelEl!: HTMLElement;
  private pointsEl!: HTMLElement;

  private tabBtns = new Map<TalentBranch, HTMLButtonElement>();
  private tabSubLabels = new Map<TalentBranch, HTMLElement>();

  private stages = new Map<TalentBranch, HTMLElement>();
  private branchBarFills = new Map<TalentBranch, HTMLElement>();
  private branchBarLabels = new Map<TalentBranch, HTMLElement>();
  private grids = new Map<TalentBranch, HTMLElement>();
  private nodeBtns = new Map<TalentId, HTMLButtonElement>();
  private nodeRanks = new Map<TalentId, HTMLElement>();
  private nodeGlyphs = new Map<TalentId, HTMLElement>();
  private nodeSrLabels = new Map<TalentId, HTMLElement>();
  private branchLinks = new Map<TalentBranch, BranchLinks>();

  // Detail card skeleton (built once, mutated in place).
  private detailCard!: HTMLElement;
  private detailIconEl!: HTMLElement;
  private detailNameEl!: HTMLElement;
  private detailMetaEl!: HTMLElement;
  private detailRankEl!: HTMLElement;
  private detailDescEl!: HTMLElement;
  private detailDeltaWrap!: HTMLElement;
  private detailDeltaSlots: HTMLElement[] = [];
  private detailReasonEl!: HTMLElement;
  private detailLearnBtn!: HTMLButtonElement;
  /** Which talent the card currently shows. Drives the icon swap and Learn. */
  private detailCardId: TalentId | null = null;

  private respecBtns = new Map<TalentBranch, HTMLButtonElement>();
  private respecAllBtn: HTMLButtonElement | null = null;

  private activeTab: TalentBranch = 'offense';
  private selectedNode: TalentId | null = null;
  private hoveredNode: TalentId | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // ── Cache / dirty-tracking (19.4) ──
  /** Node state per talent, recomputed once per refresh and shared. */
  private stateCache = new Map<TalentId, NodeState>();
  /** Branches whose node/link/bar state may be stale since the last paint. */
  private dirtyBranches = new Set<TalentBranch>();
  /** Last `unspentPoints|allocatedSum` signature; structure change → repaint. */
  private lastStructureSignature = '';
  /** Change signature for the visible respec labels. */
  private respecSignature = '';

  /** Teardown for the §9.C hold-to-preview bindings, one per branch scroller. */
  private longPressUnbinds: (() => void)[] = [];

  /** Whether the runtime supports hover at all (mouseenter/mouseleave is reliable). */
  private readonly canHover: boolean;

  constructor(deps: TalentAPIDeps) {
    this.deps = deps;
    this.canHover = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: hover)').matches;
  }

  setDeps(deps: TalentAPIDeps): void {
    this.deps = deps;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.tabBtns.clear();
    this.tabSubLabels.clear();
    this.stages.clear();
    this.branchBarFills.clear();
    this.branchBarLabels.clear();
    this.grids.clear();
    this.nodeBtns.clear();
    this.nodeRanks.clear();
    this.nodeGlyphs.clear();
    this.nodeSrLabels.clear();
    this.branchLinks.clear();
    this.respecBtns.clear();
    this.respecAllBtn = null;
    this.detailDeltaSlots = [];
    this.selectedNode = null;
    this.hoveredNode = null;
    this.detailCardId = null;
    this.activeTab = 'offense';
    this.stateCache.clear();
    this.dirtyBranches.clear();
    this.lastStructureSignature = '';
    this.respecSignature = '';
    this.renderInto(parent);

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.layoutLinks(this.activeTab));
      const links = this.branchLinks.get(this.activeTab);
      if (links) this.resizeObserver.observe(links.grid);
    }
    this.markAllBranchesDirty();
    this.layoutLinks(this.activeTab);
  }

  private unmount(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const unbind of this.longPressUnbinds) unbind();
    this.longPressUnbinds.length = 0;
    this.branchLinks.clear();
    this.root = null;
  }

  update(_state: GameState): void {
    if (!this.root) return;

    // ── Header (always on; tiny) ──
    const level = this.deps.level();
    const progress = this.deps.xpProgress();
    const atCap = this.deps.atLevelCap();
    setText(this.levelEl, 'Lv. ' + level);
    setStyle(this.xpBarFill, 'width', Math.round(progress * 100) + '%');
    if (atCap) {
      setText(this.xpLabelEl, 'Level cap reached');
    } else {
      setText(this.xpLabelEl, Math.round(progress * 100) + '% to Lv. ' + (level + 1));
    }
    const unspent = this.deps.unspentPoints();
    setText(this.pointsEl, unspent + ' unspent');
    toggleClass(this.pointsEl, 'is-pulsing', unspent > 0);

    // ── Tab sub-labels (always on; cached setText per tab) ──
    for (const branch of BRANCH_DISPLAY) {
      const sub = this.tabSubLabels.get(branch.id);
      if (!sub) continue;
      let invested = 0;
      for (const t of TALENT_GRID[branch.id]) invested += this.deps.allocated[t.id] ?? 0;
      const overflow = this.deps.allocated[TALENT_ENDLESS[branch.id].id] ?? 0;
      const suffix = overflow > 0 ? ' +' + overflow : '';
      setText(sub, invested + '/' + BRANCH_CAPACITY[branch.id] + suffix);
    }

    // ── Structure change → invalidate caches ──
    const sig = this.structureSignature();
    if (sig !== this.lastStructureSignature) {
      this.lastStructureSignature = sig;
      this.stateCache.clear();
      this.markAllBranchesDirty();
    }

    // ── Refresh the visible branch only ──
    if (this.dirtyBranches.has(this.activeTab)) {
      this.dirtyBranches.delete(this.activeTab);
      this.refreshBranch(this.activeTab);
    }

    // ── Respec labels (gated on a cost/affordability signature) ──
    this.refreshRespec();

    // ── Detail card (cheap after 19.3; runs unconditionally so live state is current) ──
    this.updateDetailCard();
  }

  private refreshRespec(): void {
    const cost = this.deps.branchRespecCost(this.activeTab);
    const allCost = this.deps.fullRespecCost();
    const gold = this.deps.gold();
    const sig = cost + '|' + (gold >= cost ? 1 : 0) + '|' + allCost + '|' + (gold >= allCost ? 1 : 0);
    if (sig === this.respecSignature) return;
    this.respecSignature = sig;

    const branchLabel = BRANCH_LABEL[this.activeTab];
    const branchBtn = this.respecBtns.get(this.activeTab);
    if (branchBtn) {
      setText(branchBtn, 'Reset ' + branchLabel + ' (' + formatNumber(cost) + 'g)');
      setDisabled(branchBtn, cost <= 0 || gold < cost);
      setTitle(branchBtn, cost <= 0
        ? 'No points invested in ' + branchLabel + '.'
        : gold < cost
          ? 'Costs ' + formatNumber(cost) + ' gold \u2014 not enough.'
          : 'Refunds every ' + branchLabel + ' point for ' + formatNumber(cost) + ' gold.');
    }
    if (this.respecAllBtn) {
      setText(this.respecAllBtn, 'Reset all talents (' + formatNumber(allCost) + 'g)');
      setDisabled(this.respecAllBtn, allCost <= 0 || gold < allCost);
      setTitle(this.respecAllBtn, allCost <= 0
        ? 'No talent points invested.'
        : gold < allCost
          ? 'Costs ' + formatNumber(allCost) + ' gold \u2014 not enough.'
          : 'Refunds every allocated talent point for ' + formatNumber(allCost) + ' gold.');
    }
  }

  private markAllBranchesDirty(): void {
    for (const b of BRANCH_DISPLAY) this.dirtyBranches.add(b.id);
  }

  private structureSignature(): string {
    let allocated = 0;
    for (const v of Object.values(this.deps.allocated)) allocated += v;
    return this.deps.unspentPoints() + '|' + allocated;
  }

  private stateFor(id: TalentId): NodeState {
    const cached = this.stateCache.get(id);
    if (cached !== undefined) return cached;
    const state = this.computeState(id);
    this.stateCache.set(id, state);
    return state;
  }

  private computeState(id: TalentId): NodeState {
    const def = TALENT_BY_ID[id];
    if (!def) return 'locked';
    const n = this.deps.allocated[id] ?? 0;
    if (n >= def.maxPoints) return 'maxed';
    if (this.deps.canAllocate(id)) return 'available';
    if (n > 0) return 'spent';
    const reason = this.deps.blockedReason(id);
    return reason === 'gate' ? 'gated' : 'locked';
  }

  /** Paint everything for one branch: nodes, links, progress bar. */
  private refreshBranch(branch: TalentBranch): void {
    const nodes = [...TALENT_GRID[branch], TALENT_ENDLESS[branch]];
    for (const talent of nodes) this.refreshNode(talent);

    const links = this.branchLinks.get(branch);
    if (links) {
      for (const edge of links.edges) {
        const parentRank = this.deps.allocated[edge.parent] ?? 0;
        const childRank = this.deps.allocated[edge.child] ?? 0;
        const childState = this.stateFor(edge.child);
        let cls = 'talent-link';
        if (parentRank >= 1 && childRank >= 1) cls += ' is-spent';
        else if (parentRank >= 1 && childState === 'available') cls += ' is-open';
        if (edge.path.getAttribute('class') !== cls) edge.path.setAttribute('class', cls);
      }
    }

    const fill = this.branchBarFills.get(branch);
    const label = this.branchBarLabels.get(branch);
    if (fill && label) {
      const pts = this.deps.pointsInBranch(branch);
      const keystoneGate = 32;
      const fraction = Math.min(1, pts / keystoneGate);
      setStyle(fill, 'width', Math.round(fraction * 100) + '%');
      let nextGate = keystoneGate;
      for (const threshold of [4, 12, 22, 32]) {
        if (pts < threshold) { nextGate = threshold; break; }
      }
      const isKeystone = nextGate === 32;
      setText(label, 'next gate: ' + nextGate + ' pts' + (isKeystone ? ' (keystones)' : ''));
    }
  }

  private refreshNode(talent: TalentDef): void {
    const btn = this.nodeBtns.get(talent.id);
    const glyph = this.nodeGlyphs.get(talent.id);
    const sr = this.nodeSrLabels.get(talent.id);
    const rank = this.nodeRanks.get(talent.id);
    if (!btn || !glyph || !sr || !rank) return;

    const state = this.stateFor(talent.id);
    const current = this.deps.allocated[talent.id] ?? 0;

    toggleClass(btn, 'is-maxed', state === 'maxed');
    toggleClass(btn, 'is-spent', state === 'spent');
    toggleClass(btn, 'is-available', state === 'available');
    toggleClass(btn, 'is-gated', state === 'gated');
    toggleClass(btn, 'is-locked', state === 'locked');
    toggleClass(btn, 'is-selected', this.selectedNode === talent.id);

    setText(rank, current + '/' + talent.maxPoints);

    const glyphChar = state === 'gated' ? String(talent.requiresBranchPoints) : STATE_GLYPH[state];
    if (glyph.textContent !== glyphChar) {
      glyph.textContent = glyphChar;
      setTitle(glyph, STATE_LABEL[state]);
    }
    if (sr.textContent !== STATE_LABEL[state]) setText(sr, STATE_LABEL[state]);
  }

  private layoutLinks(branch: TalentBranch): void {
    const links = this.branchLinks.get(branch);
    if (!links) return;
    const host = links.grid.getBoundingClientRect();
    if (host.width === 0 || host.height === 0) return;
    links.svg.setAttribute('viewBox', '0 0 ' + host.width + ' ' + host.height);

    const geometry: { path: SVGPathElement; d: string }[] = [];
    for (const edge of links.edges) {
      const parentEl = this.nodeBtns.get(edge.parent);
      const childEl = this.nodeBtns.get(edge.child);
      if (!parentEl || !childEl) continue;
      const a = parentEl.getBoundingClientRect();
      const b = childEl.getBoundingClientRect();
      geometry.push({ path: edge.path, d: pathFor(a, b, host) });
    }
    for (const g of geometry) g.path.setAttribute('d', g.d);
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'talent-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Talents';
    parent.appendChild(title);

    const header = document.createElement('div');
    header.className = 'talent-header';

    this.levelEl = document.createElement('span');
    this.levelEl.className = 'talent-level';
    header.appendChild(this.levelEl);

    const xpWrap = document.createElement('div');
    xpWrap.className = 'talent-xp';
    const xpBar = document.createElement('div');
    xpBar.className = 'talent-xp-bar';
    this.xpBarFill = document.createElement('div');
    this.xpBarFill.className = 'talent-xp-fill';
    xpBar.appendChild(this.xpBarFill);
    xpWrap.appendChild(xpBar);
    this.xpLabelEl = document.createElement('span');
    this.xpLabelEl.className = 'talent-xp-label';
    xpWrap.appendChild(this.xpLabelEl);
    header.appendChild(xpWrap);

    this.pointsEl = document.createElement('span');
    this.pointsEl.className = 'talent-points';
    header.appendChild(this.pointsEl);

    parent.appendChild(header);

    const tabs = document.createElement('div');
    tabs.className = 'talent-tabs';
    for (const branch of BRANCH_DISPLAY) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      btn.dataset.talentTab = branch.id;
      setStyle(btn, '--branch-color', branch.color);

      const label = document.createElement('span');
      label.className = 'tab-btn-label';
      label.textContent = branch.label;
      btn.appendChild(label);

      const sub = document.createElement('span');
      sub.className = 'tab-btn-sub';
      this.tabSubLabels.set(branch.id, sub);
      btn.appendChild(sub);

      btn.addEventListener('click', () => this.showTab(branch.id));
      tabs.appendChild(btn);
      this.tabBtns.set(branch.id, btn);
    }
    parent.appendChild(tabs);

    for (const branch of BRANCH_DISPLAY) {
      parent.appendChild(this.renderStage(branch));
    }

    this.renderDetailSkeleton(parent);

    const respecRow = document.createElement('div');
    respecRow.className = 'talent-respec-row';

    for (const branch of BRANCH_DISPLAY) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-respec is-hidden';
      btn.disabled = true;
      btn.addEventListener('click', () => this.deps.refundBranch(branch.id));
      this.respecBtns.set(branch.id, btn);
      respecRow.appendChild(btn);
    }

    this.respecAllBtn = document.createElement('button');
    this.respecAllBtn.type = 'button';
    this.respecAllBtn.className = 'btn btn-respec talent-respec-all';
    this.respecAllBtn.disabled = true;
    this.respecAllBtn.addEventListener('click', () => this.deps.refundAll());
    respecRow.appendChild(this.respecAllBtn);

    parent.appendChild(respecRow);

    parent.addEventListener('keydown', (e) => this.handleKeydown(e));

    this.showTab(this.activeTab);
  }

  private renderDetailSkeleton(parent: HTMLElement): void {
    const card = document.createElement('div');
    card.className = 'talent-detail is-empty';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    parent.appendChild(card);
    this.detailCard = card;

    const headerRow = document.createElement('div');
    headerRow.className = 'talent-detail-header';
    card.appendChild(headerRow);

    this.detailIconEl = document.createElement('span');
    this.detailIconEl.className = 'talent-detail-icon';
    headerRow.appendChild(this.detailIconEl);

    const info = document.createElement('div');
    info.className = 'talent-detail-info';
    headerRow.appendChild(info);
    this.detailNameEl = document.createElement('strong');
    this.detailNameEl.className = 'talent-detail-name';
    info.appendChild(this.detailNameEl);
    this.detailMetaEl = document.createElement('span');
    this.detailMetaEl.className = 'talent-detail-meta';
    info.appendChild(this.detailMetaEl);

    this.detailRankEl = document.createElement('span');
    this.detailRankEl.className = 'talent-detail-rank';
    headerRow.appendChild(this.detailRankEl);

    this.detailDescEl = document.createElement('p');
    this.detailDescEl.className = 'talent-detail-desc';
    card.appendChild(this.detailDescEl);

    this.detailDeltaWrap = document.createElement('div');
    this.detailDeltaWrap.className = 'talent-detail-delta';
    card.appendChild(this.detailDeltaWrap);
    for (let i = 0; i < DETAIL_DELTA_SLOTS; i++) {
      const slot = document.createElement('span');
      slot.className = 'talent-detail-delta-line';
      this.detailDeltaWrap.appendChild(slot);
      this.detailDeltaSlots.push(slot);
    }

    this.detailReasonEl = document.createElement('p');
    this.detailReasonEl.className = 'talent-detail-reason';
    card.appendChild(this.detailReasonEl);

    this.detailLearnBtn = document.createElement('button');
    this.detailLearnBtn.type = 'button';
    this.detailLearnBtn.className = 'btn btn-learn';
    this.detailLearnBtn.textContent = 'Learn (1 point)';
    this.detailLearnBtn.disabled = true;
    this.detailLearnBtn.addEventListener('click', () => {
      const id = this.detailCardId;
      if (!id || !this.deps.canAllocate(id)) return;
      this.deps.allocate(id);
      this.selectedNode = id;
      this.markAllBranchesDirty();
    });
    card.appendChild(this.detailLearnBtn);
  }

  private renderStage(branch: { id: TalentBranch; label: string; color: string }): HTMLElement {
    const stage = document.createElement('div');
    stage.className = 'talent-stage';
    stage.dataset.branch = branch.id;
    stage.dataset.talentTabPanel = branch.id;
    setStyle(stage, '--branch-color', branch.color);
    this.stages.set(branch.id, stage);

    const bar = document.createElement('div');
    bar.className = 'talent-branch-bar';
    const barTrack = document.createElement('div');
    barTrack.className = 'talent-branch-bar-track';
    const barFill = document.createElement('div');
    barFill.className = 'talent-branch-bar-fill';
    setStyle(barFill, '--branch-color', branch.color);
    barTrack.appendChild(barFill);
    bar.appendChild(barTrack);
    const barLabel = document.createElement('span');
    barLabel.className = 'talent-branch-bar-label';
    bar.appendChild(barLabel);
    stage.appendChild(bar);
    this.branchBarFills.set(branch.id, barFill);
    this.branchBarLabels.set(branch.id, barLabel);

    const grid = document.createElement('div');
    grid.className = 'talent-grid';
    setStyle(grid, '--branch-color', branch.color);
    this.grids.set(branch.id, grid);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'talent-link-layer');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('preserveAspectRatio', 'none');
    grid.appendChild(svg);

    for (const row of [2, 3, 4, 5]) {
      const gate = document.createElement('div');
      gate.className = 'talent-gate';
      gate.dataset.row = String(row);
      gate.style.setProperty('--row', String(row));
      gate.textContent = String(ROW_GATES[row]);
      setTitle(gate, 'Requires ' + ROW_GATES[row] + ' points in ' + branch.label);
      grid.appendChild(gate);
    }

    const talents = TALENT_GRID[branch.id];
    const edges: BranchLinks['edges'] = [];
    for (const talent of talents) {
      const btn = this.renderNode(talent);
      grid.appendChild(btn);
      for (const prereq of talent.prerequisites) {
        if (!TALENTS_BY_BRANCH[branch.id].some(t => t.id === prereq)) continue;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'talent-link');
        svg.appendChild(path);
        edges.push({ parent: prereq as TalentId, child: talent.id, path });
      }
    }

    const keystoneLabel = document.createElement('div');
    keystoneLabel.className = 'talent-keystone-label';
    keystoneLabel.style.setProperty('--row', '5');
    keystoneLabel.textContent = 'Choose one';
    grid.appendChild(keystoneLabel);

    this.branchLinks.set(branch.id, { grid, svg, edges });

    const scroll = document.createElement('div');
    scroll.className = 'talent-scroll';
    scroll.appendChild(grid);

    // §9.C: the node preview is a hover affordance, and `canHover` deliberately
    // leaves the hover handlers unbound on touch — which left a phone with no
    // way to read a node without also selecting it. A hold previews it and the
    // shared helper swallows the trailing click, so the hold never allocates.
    this.longPressUnbinds.push(bindLongPress(scroll, {
      selector: '.talent-node',
      onLongPress: (node) => {
        const id = node.dataset.talentId as TalentId | undefined;
        if (id) this.onNodeHover(id);
      },
      onRelease: () => this.onNodeLeave(),
    }));

    const divider = document.createElement('div');
    divider.className = 'talent-overflow-divider';
    divider.textContent = 'Overflow \u2014 no limit';
    scroll.appendChild(divider);

    const overflow = document.createElement('div');
    overflow.className = 'talent-overflow';
    const endless = TALENT_ENDLESS[branch.id];
    const endlessBtn = this.renderNode(endless, true);
    overflow.appendChild(endlessBtn);
    scroll.appendChild(overflow);

    stage.appendChild(scroll);

    return stage;
  }

  private renderNode(talent: TalentDef, isEndless = false): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'talent-node';
    if (isEndless) btn.classList.add('is-endless');
    if (talent.exclusiveGroup) btn.classList.add('is-keystone');
    btn.dataset.talentId = talent.id;
    btn.style.setProperty('--row', String(talent.row));
    btn.style.setProperty('--col', String(talent.col));
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', talent.name);

    const iconWrap = document.createElement('span');
    iconWrap.className = 'talent-node-icon';
    setStyle(iconWrap, '--talent-color', talent.color);
    renderIcon(iconWrap, talent.icon);
    btn.appendChild(iconWrap);

    const glyph = document.createElement('span');
    glyph.className = 'talent-node-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = STATE_GLYPH.locked;
    btn.appendChild(glyph);
    this.nodeGlyphs.set(talent.id, glyph);

    const rank = document.createElement('span');
    rank.className = 'talent-node-rank';
    rank.textContent = '0/' + talent.maxPoints;
    btn.appendChild(rank);
    this.nodeRanks.set(talent.id, rank);

    const name = document.createElement('span');
    name.className = 'talent-node-name';
    name.textContent = talent.name;
    btn.appendChild(name);

    const sr = document.createElement('span');
    sr.className = 'talent-node-sr sr-only';
    sr.textContent = STATE_LABEL.locked;
    btn.appendChild(sr);
    this.nodeSrLabels.set(talent.id, sr);

    this.nodeBtns.set(talent.id, btn);

    btn.addEventListener('click', () => this.onNodeClick(talent.id));
    // Hover handlers are unreliable on touch — a tap fires a synthetic
    // mouseenter with no matching mouseleave, leaving the card stuck in
    // preview. Bind only when the runtime actually supports hover.
    if (this.canHover) {
      btn.addEventListener('mouseenter', () => this.onNodeHover(talent.id));
      btn.addEventListener('mouseleave', () => this.onNodeLeave());
    }

    return btn;
  }

  private onNodeClick(id: TalentId): void {
    if (this.selectedNode === id) {
      if (this.deps.canAllocate(id)) {
        this.deps.allocate(id);
      }
    } else {
      this.selectedNode = id;
      for (const [nodeId, btn] of this.nodeBtns) {
        toggleClass(btn, 'is-selected', nodeId === id);
      }
      this.updateDetailCard();
    }
  }

  private onNodeHover(id: TalentId): void {
    this.hoveredNode = id;
    this.updateDetailCard();
  }

  private onNodeLeave(): void {
    this.hoveredNode = null;
    this.updateDetailCard();
  }

  private handleKeydown(e: Event): void {
    const ke = e as KeyboardEvent;
    // Keyboard navigation moves the selection; clear any stale hover so the
    // detail card follows the keyboard, not the pointer.
    this.hoveredNode = null;

    if (ke.key === 'Escape') {
      this.selectedNode = null;
      this.updateDetailCard();
      for (const btn of this.nodeBtns.values()) toggleClass(btn, 'is-selected', false);
      return;
    }

    const target = ke.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest<HTMLButtonElement>('.talent-node');
    if (!btn) return;
    const id = btn.dataset.talentId as TalentId | undefined;
    if (!id) return;

    if (ke.key === 'Enter' || ke.key === ' ') {
      ke.preventDefault();
      this.onNodeClick(id);
      return;
    }

    const def = TALENT_BY_ID[id];
    if (!def) return;

    let dir: 'up' | 'down' | 'left' | 'right' | null = null;
    if (ke.key === 'ArrowUp') dir = 'up';
    else if (ke.key === 'ArrowDown') dir = 'down';
    else if (ke.key === 'ArrowLeft') dir = 'left';
    else if (ke.key === 'ArrowRight') dir = 'right';
    if (!dir) return;

    ke.preventDefault();

    const branch = def.branch;
    const candidates: TalentDef[] = [
      ...TALENT_GRID[branch],
      TALENT_ENDLESS[branch],
    ];

    let best: TalentDef | null = null;
    let bestDist = Infinity;

    for (const c of candidates) {
      if (c.id === id) continue;
      const dr = c.row - def.row;
      const dc = c.col - def.col;

      let valid = false;
      switch (dir) {
        case 'up': valid = dr < 0; break;
        case 'down': valid = dr > 0; break;
        case 'left': valid = dc < 0; break;
        case 'right': valid = dc > 0; break;
      }
      if (!valid) continue;

      const dist = Math.abs(dr) + Math.abs(dc);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }

    if (best) {
      const targetBtn = this.nodeBtns.get(best.id);
      if (targetBtn) {
        targetBtn.focus();
        this.selectedNode = best.id;
        for (const [nodeId, b] of this.nodeBtns) {
          toggleClass(b, 'is-selected', nodeId === best.id);
        }
        this.updateDetailCard();
      }
    }
  }

  private showTab(id: TalentBranch): void {
    this.activeTab = id;
    // Switching tabs hides the node the pointer was over; clear hover so the
    // detail card does not stay pinned to a hidden node.
    this.hoveredNode = null;
    if (!this.root) return;
    for (const el of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.talent-tabs .tab-btn'))) {
      toggleClass(el, 'active', el.dataset.talentTab === id);
    }
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('.talent-stage'))) {
      toggleClass(el, 'active', el.dataset.talentTabPanel === id);
    }
    // 19.1: show only the active branch's reset button alongside the global one.
    for (const [branch, btn] of this.respecBtns) {
      toggleClass(btn, 'is-hidden', branch !== id);
    }
    // The active tab changed; respec labels must be rebuilt next update.
    this.respecSignature = '';
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      const links = this.branchLinks.get(id);
      if (links) this.resizeObserver.observe(links.grid);
    }
    if (this.dirtyBranches.has(id)) {
      this.dirtyBranches.delete(id);
      this.refreshBranch(id);
    }
    this.layoutLinks(id);
  }

  private updateDetailCard(): void {
    // 19.5: hover wins over selection. `isPreview` = "this is not the pinned
    // node", which drives the dashed border + "Preview" badge.
    const id = this.hoveredNode ?? this.selectedNode;
    if (id) {
      this.renderDetailContent(id, id !== this.selectedNode);
    } else {
      this.detailCardId = null;
      toggleClass(this.detailCard, 'is-empty', true);
      toggleClass(this.detailCard, 'is-preview', false);
    }
  }

  private renderDetailContent(id: TalentId, isPreview: boolean): void {
    const def = TALENT_BY_ID[id];
    if (!def) return;

    toggleClass(this.detailCard, 'is-empty', false);
    toggleClass(this.detailCard, 'is-preview', isPreview);

    // The icon is the only child that needs real DOM work, so it is the only
    // one guarded on the id rather than on its own value.
    if (this.detailCardId !== id) {
      this.detailCardId = id;
      setStyle(this.detailIconEl, '--talent-color', def.color);
      renderIcon(this.detailIconEl, def.icon);
    }

    const current = this.deps.allocated[id] ?? 0;
    const branchLabel = BRANCH_LABEL[def.branch];

    setText(this.detailNameEl, def.name);
    setText(this.detailMetaEl,
      'Row ' + def.row + ' \u00B7 ' + branchLabel
      + (def.requiresBranchPoints > 0 ? ' \u00B7 needs ' + def.requiresBranchPoints + ' pts in branch' : ''));
    setText(this.detailRankEl, current + ' / ' + def.maxPoints);
    setText(this.detailDescEl, def.description);

    const showDelta = def.effects.length > 0 && current < def.maxPoints;
    setDisplay(this.detailDeltaWrap, showDelta ? '' : 'none');
    for (let i = 0; i < DETAIL_DELTA_SLOTS; i++) {
      const slot = this.detailDeltaSlots[i];
      const eff = showDelta ? def.effects[i] : undefined;
      if (!eff) { setDisplay(slot, 'none'); continue; }
      setDisplay(slot, '');
      setText(slot,
        'Now ' + formatEffectValue(eff.stat, eff.perPoint * current)
        + ' \u2192 Next ' + formatEffectValue(eff.stat, eff.perPoint * (current + 1)));
    }

    const reason = this.deps.blockedReason(id);
    const showReason = reason !== null && reason !== 'maxed';
    setDisplay(this.detailReasonEl, showReason ? '' : 'none');
    if (showReason) setText(this.detailReasonEl, this.formatBlockedReason(reason!, def));

    const state = this.stateFor(id);
    setDisplay(this.detailLearnBtn, state === 'maxed' ? 'none' : '');
    setDisabled(this.detailLearnBtn, !this.deps.canAllocate(id));
  }

  private formatBlockedReason(
    reason: 'no_points' | 'prereq' | 'gate' | 'exclusive',
    def: TalentDef,
  ): string {
    switch (reason) {
      case 'no_points':
        return 'No unspent talent points.';
      case 'prereq': {
        const names = def.prerequisites
          .map(pid => TALENT_BY_ID[pid]?.name ?? pid)
          .join(' or ');
        return 'Requires 1 point in ' + names + '.';
      }
      case 'gate': {
        const have = this.deps.pointsInBranch(def.branch);
        return 'Requires ' + def.requiresBranchPoints + ' points in branch (you have ' + have + ').';
      }
      case 'exclusive': {
        for (const t of TALENTS_BY_BRANCH[def.branch]) {
          if (
            t.id !== def.id &&
            t.exclusiveGroup === def.exclusiveGroup &&
            (this.deps.allocated[t.id] ?? 0) > 0
          ) {
            return 'You have already chosen ' + t.name + '.';
          }
        }
        return 'Another choice in this group is already taken.';
      }
    }
  }
}
