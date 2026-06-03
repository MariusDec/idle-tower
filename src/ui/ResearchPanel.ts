import type { GameState } from '../types';
import {
  RESEARCH_NODES,
  type ResearchDef,
  type ResearchCategory,
} from '../data/research';
import { formatNumber } from '../utils/bigNumber';

export interface ResearchPanelHandlers {
  onUnlock: (id: string) => void;
  rp: number;
  unlocked: ReadonlySet<string>;
  reasonBlocked: (id: string) => string | null;
}

const CATEGORY_ORDER: ResearchCategory[] = ['combat', 'economy', 'arcane', 'scouting'];
const CATEGORY_LABELS: Record<ResearchCategory, string> = {
  combat: 'Combat',
  economy: 'Economy',
  arcane: 'Arcane',
  scouting: 'Scouting',
};

export class ResearchPanel {
  private readonly handlers: ResearchPanelHandlers;
  private root: HTMLElement | null = null;
  private rpEl!: HTMLElement;
  private ascensionsEl!: HTMLElement;
  private spentEl!: HTMLElement;
  private rowById = new Map<string, HTMLElement>();
  private stateById = new Map<string, HTMLElement>();
  private reasonById = new Map<string, HTMLElement>();
  private costById = new Map<string, HTMLElement>();
  private btnById = new Map<string, HTMLButtonElement>();

  constructor(handlers: ResearchPanelHandlers) {
    this.handlers = handlers;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.rowById.clear();
    this.stateById.clear();
    this.reasonById.clear();
    this.costById.clear();
    this.btnById.clear();
    this.renderInto(parent);
  }

  update(state: GameState): void {
    if (!this.root) return;
    this.rpEl.textContent = formatNumber(state.resources.ascensionPoints);
    this.ascensionsEl.textContent = formatNumber(state.stats.ascensions);
    const spent = this.computeSpent();
    this.spentEl.textContent = formatNumber(spent);

    for (const node of RESEARCH_NODES) {
      const row = this.rowById.get(node.id);
      const stateEl = this.stateById.get(node.id);
      const reasonEl = this.reasonById.get(node.id);
      const costEl = this.costById.get(node.id);
      const btn = this.btnById.get(node.id);
      if (!row || !stateEl || !reasonEl || !costEl || !btn) continue;
      const unlocked = state.research.includes(node.id);
      const reason = this.handlers.reasonBlocked(node.id);
      row.classList.toggle('is-unlocked', unlocked);
      row.classList.toggle('is-locked', !unlocked && reason !== null);
      row.classList.toggle('is-available', !unlocked && reason === null);
      stateEl.textContent = unlocked ? 'Unlocked' : (reason ?? 'Available');
      stateEl.classList.toggle('research-state-unlocked', unlocked);
      stateEl.classList.toggle('research-state-blocked', !unlocked && reason !== null);
      stateEl.classList.toggle('research-state-available', !unlocked && reason === null);
      costEl.textContent = unlocked ? '—' : formatNumber(node.cost);
      btn.disabled = unlocked || reason !== null;
      btn.classList.toggle('can-afford', !unlocked && reason === null);
      btn.textContent = unlocked ? 'Done' : 'Research';
      if (reason && !unlocked) {
        reasonEl.textContent = reason;
        reasonEl.style.display = '';
      } else {
        reasonEl.textContent = '';
        reasonEl.style.display = 'none';
      }
    }
  }

  private computeSpent(): number {
    let total = 0;
    for (const node of RESEARCH_NODES) {
      if (this.handlers.unlocked.has(node.id)) total += node.cost;
    }
    return total;
  }

  private unmount(): void {
    this.root = null;
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'research-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Research';
    parent.appendChild(title);

    parent.appendChild(this.renderSummary());
    parent.appendChild(this.renderIntro());
    parent.appendChild(this.renderList());
    parent.appendChild(this.renderFooter());
  }

  private renderSummary(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'research-summary';
    const make = (label: string, initial: string, out: { el: HTMLElement | null }): HTMLElement => {
      const stat = document.createElement('div');
      stat.className = 'research-summary-stat';
      const l = document.createElement('div');
      l.className = 'research-summary-label';
      l.textContent = label;
      const v = document.createElement('div');
      v.className = 'research-summary-value';
      v.textContent = initial;
      stat.appendChild(l);
      stat.appendChild(v);
      out.el = v;
      return stat;
    };
    const rpRef: { el: HTMLElement | null } = { el: null };
    const ascRef: { el: HTMLElement | null } = { el: null };
    const spentRef: { el: HTMLElement | null } = { el: null };
    wrap.appendChild(make('Available RP', '0', rpRef));
    wrap.appendChild(make('Ascensions', '0', ascRef));
    wrap.appendChild(make('RP Spent', '0', spentRef));
    this.rpEl = rpRef.el!;
    this.ascensionsEl = ascRef.el!;
    this.spentEl = spentRef.el!;
    return wrap;
  }

  private renderIntro(): HTMLElement {
    const p = document.createElement('p');
    p.className = 'panel-note';
    p.textContent =
      'Earn Research Points (RP) by Ascending. Spend RP to unlock permanent upgrades that persist across Ascensions but reset on Transcendence. Prerequisites must be unlocked first.';
    return p;
  }

  private renderFooter(): HTMLElement {
    const p = document.createElement('p');
    p.className = 'panel-note';
    p.textContent =
      'Tip: prioritize economy (Alchemy → Transmutation) and combat (Piercing Shots) for steady early progress. Auto-Upgrader pairs well with TP automation perks.';
    return p;
  }

  private renderList(): HTMLElement {
    const list = document.createElement('div');
    list.className = 'research-list';
    for (const cat of CATEGORY_ORDER) {
      const items = RESEARCH_NODES.filter(n => n.category === cat);
      if (items.length === 0) continue;
      const header = document.createElement('div');
      header.className = 'research-category';
      header.textContent = CATEGORY_LABELS[cat];
      list.appendChild(header);
      for (const n of items) {
        list.appendChild(this.renderRow(n));
      }
    }
    return list;
  }

  private renderRow(n: ResearchDef): HTMLElement {
    const row = document.createElement('div');
    row.className = 'research-row is-locked';
    row.dataset.researchId = n.id;
    this.rowById.set(n.id, row);

    const icon = document.createElement('div');
    icon.className = 'research-icon';
    icon.style.setProperty('--research-color', n.color);
    icon.textContent = n.glyph;
    row.appendChild(icon);

    const info = document.createElement('div');
    info.className = 'research-info';
    const name = document.createElement('div');
    name.className = 'research-name';
    name.textContent = n.name;
    const desc = document.createElement('div');
    desc.className = 'research-desc';
    desc.textContent = n.description;
    const meta = document.createElement('div');
    meta.className = 'research-meta';
    const stateEl = document.createElement('span');
    stateEl.className = 'research-state';
    stateEl.textContent = '';
    const reasonEl = document.createElement('span');
    reasonEl.className = 'research-reason';
    reasonEl.textContent = '';
    meta.appendChild(stateEl);
    meta.appendChild(reasonEl);
    info.appendChild(name);
    info.appendChild(desc);
    info.appendChild(meta);
    if (n.prerequisites.length > 0) {
      const pre = document.createElement('div');
      pre.className = 'research-prereq';
      const names = n.prerequisites
        .map(p => RESEARCH_NODES.find(x => x.id === p)?.name ?? p)
        .join(', ');
      pre.textContent = `Requires: ${names}`;
      info.appendChild(pre);
    }
    row.appendChild(info);

    const action = document.createElement('div');
    action.className = 'research-action';
    const cost = document.createElement('div');
    cost.className = 'research-cost';
    cost.textContent = '0';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-research';
    btn.textContent = 'Research';
    btn.disabled = true;
    btn.addEventListener('click', () => this.handlers.onUnlock(n.id));
    action.appendChild(cost);
    action.appendChild(btn);
    row.appendChild(action);

    this.stateById.set(n.id, stateEl);
    this.reasonById.set(n.id, reasonEl);
    this.costById.set(n.id, cost);
    this.btnById.set(n.id, btn);
    return row;
  }
}
