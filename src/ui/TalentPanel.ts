import type { GameState, TalentBranch, TalentId } from '../types';
import { TALENTS, TALENTS_BY_BRANCH, TALENT_BY_ID } from '../data/talentTree';
import type { TalentDef } from '../data/talentTree';
import { setText, toggleClass, setStyle } from '../utils/dom';

export interface TalentAPIDeps {
  allocated: Record<string, number>;
  unspentPoints: () => number;
  canAllocate: (id: string) => boolean;
  allocate: (id: string) => boolean;
  refundBranch: (branch: TalentBranch) => void;
}

const BRANCH_DISPLAY: { id: TalentBranch; label: string; color: string }[] = [
  { id: 'offense', label: 'Offense', color: '#e74c3c' },
  { id: 'defense', label: 'Defense', color: '#2ecc71' },
  { id: 'utility', label: 'Utility', color: '#f1c40f' },
  { id: 'magic', label: 'Magic', color: '#9b59b6' },
];

const RESPEK_COST_GOLD = 500;

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
  private branchSummaryEls = new Map<TalentBranch, HTMLElement>();
  private activeTab: TalentBranch = 'offense';

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
    this.branchSummaryEls.clear();
    this.activeTab = 'offense';
    this.renderInto(parent);
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
    }

    for (const branch of BRANCH_DISPLAY) {
      const btn = this.respecBtns.get(branch.id);
      if (!btn) continue;
      const hasPoints = TALENTS_BY_BRANCH[branch.id].some(t => (this.deps.allocated[t.id] ?? 0) > 0);
      btn.disabled = !hasPoints;
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
    this.root = null;
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

    for (const talent of sorted) {
      const depth = depths.get(talent.id) ?? 0;
      tree.appendChild(this.renderTalentCard(talent, depth));
    }

    panel.appendChild(tree);

    const respecRow = document.createElement('div');
    respecRow.className = 'talent-respec-row';
    const respecBtn = document.createElement('button');
    respecBtn.type = 'button';
    respecBtn.className = 'btn btn-respec';
    respecBtn.textContent = `Reset ${branch.label} (${RESPEK_COST_GOLD}g)`;
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
    this.talentCards.set(talent.id, card);

    const glyph = document.createElement('div');
    glyph.className = 'talent-card-glyph';
    setStyle(glyph, '--talent-color', talent.color);
    glyph.textContent = talent.glyph;
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
  }
}
