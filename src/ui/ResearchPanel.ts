import type { GameState } from '../types';
import {
  RESEARCH_NODES,
  type ResearchDef,
  type ResearchCategory,
} from '../data/research';
import { formatNumber } from '../utils/bigNumber';

export interface ResearchPanelHandlers {
  onStartResearch: (id: string) => void;
  onCancelResearch: () => void;
  rp: number;
  unlocked: ReadonlySet<string>;
  reasonBlocked: (id: string) => string | null;
  inProgress: { id: string; elapsed: number; total: number } | null;
  researchSpeedMultiplier: number;
}

const CATEGORY_ORDER: ResearchCategory[] = ['combat', 'economy', 'arcane', 'scouting'];
const CATEGORY_LABELS: Record<ResearchCategory, string> = {
  combat: 'Combat',
  economy: 'Economy',
  arcane: 'Arcane',
  scouting: 'Scouting',
};

function formatTime(seconds: number): string {
  if (seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export class ResearchPanel {
  private readonly handlers: ResearchPanelHandlers;
  private root: HTMLElement | null = null;
  private rpEl!: HTMLElement;
  private ascensionsEl!: HTMLElement;
  private spentEl!: HTMLElement;
  private speedEl!: HTMLElement;
  private rowById = new Map<string, HTMLElement>();
  private stateById = new Map<string, HTMLElement>();
  private reasonById = new Map<string, HTMLElement>();
  private costById = new Map<string, HTMLElement>();
  private btnById = new Map<string, HTMLButtonElement>();
  private progressWrapById = new Map<string, HTMLElement>();
  private progressBarById = new Map<string, HTMLElement>();
  private progressTextById = new Map<string, HTMLElement>();
  private timeEstById = new Map<string, HTMLElement>();

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
    this.progressWrapById.clear();
    this.progressBarById.clear();
    this.progressTextById.clear();
    this.timeEstById.clear();
    this.renderInto(parent);
  }

  update(state: GameState): void {
    if (!this.root) return;
    this.rpEl.textContent = formatNumber(state.resources.ascensionPoints);
    this.ascensionsEl.textContent = formatNumber(state.stats.ascensions);
    const spent = this.computeSpent();
    this.spentEl.textContent = formatNumber(spent);
    const speedPct = Math.round((1 - this.handlers.researchSpeedMultiplier) * 100);
    this.speedEl.textContent = speedPct > 0 ? `-${speedPct}%` : '—';

    const ip = this.handlers.inProgress;

    for (const node of RESEARCH_NODES) {
      const row = this.rowById.get(node.id);
      const stateEl = this.stateById.get(node.id);
      const reasonEl = this.reasonById.get(node.id);
      const costEl = this.costById.get(node.id);
      const btn = this.btnById.get(node.id);
      const progressWrap = this.progressWrapById.get(node.id);
      const progressBar = this.progressBarById.get(node.id);
      const progressText = this.progressTextById.get(node.id);
      const timeEst = this.timeEstById.get(node.id);
      if (!row || !stateEl || !reasonEl || !costEl || !btn || !progressWrap || !progressBar || !progressText || !timeEst) continue;

      const unlocked = state.research.includes(node.id);
      const isResearching = ip?.id === node.id;
      const reason = this.handlers.reasonBlocked(node.id);

      row.classList.toggle('is-unlocked', unlocked);
      row.classList.toggle('is-researching', isResearching);
      row.classList.toggle('is-locked', !unlocked && !isResearching && reason !== null);
      row.classList.toggle('is-available', !unlocked && !isResearching && reason === null);

      if (isResearching && ip) {
        const pct = Math.min(100, (ip.elapsed / ip.total) * 100);
        const remaining = Math.max(0, ip.total - ip.elapsed);
        stateEl.textContent = 'Researching…';
        stateEl.className = 'research-state research-state-researching';
        progressWrap.style.display = '';
        progressBar.style.width = `${pct}%`;
        progressText.textContent = `${formatTime(remaining)} remaining`;
        btn.textContent = 'Cancel';
        btn.disabled = false;
        btn.classList.remove('can-afford');
        btn.classList.add('btn-cancel');
        timeEst.style.display = 'none';
        reasonEl.textContent = '';
        reasonEl.style.display = 'none';
        costEl.textContent = formatNumber(node.cost);
      } else {
        progressWrap.style.display = 'none';
        btn.classList.remove('btn-cancel');
        if (unlocked) {
          stateEl.textContent = 'Completed';
          stateEl.className = 'research-state research-state-unlocked';
          costEl.textContent = '—';
          btn.disabled = true;
          btn.classList.remove('can-afford');
          btn.textContent = 'Done';
          timeEst.style.display = 'none';
        } else {
          const effectiveTime = node.researchTime * this.handlers.researchSpeedMultiplier;
          stateEl.textContent = reason ?? 'Available';
          stateEl.className = `research-state ${reason !== null ? 'research-state-blocked' : 'research-state-available'}`;
          costEl.textContent = formatNumber(node.cost);
          const canStart = reason === null;
          btn.disabled = !canStart;
          btn.classList.toggle('can-afford', canStart);
          btn.textContent = 'Start';
          timeEst.textContent = formatTime(effectiveTime);
          timeEst.style.display = '';
        }
        if (reason && !unlocked && !isResearching) {
          reasonEl.textContent = reason;
          reasonEl.style.display = '';
        } else {
          reasonEl.textContent = '';
          reasonEl.style.display = 'none';
        }
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
    const speedRef: { el: HTMLElement | null } = { el: null };
    wrap.appendChild(make('Available RP', '0', rpRef));
    wrap.appendChild(make('Ascensions', '0', ascRef));
    wrap.appendChild(make('RP Spent', '0', spentRef));
    wrap.appendChild(make('Speed Bonus', '—', speedRef));
    this.rpEl = rpRef.el!;
    this.ascensionsEl = ascRef.el!;
    this.spentEl = spentRef.el!;
    this.speedEl = speedRef.el!;
    return wrap;
  }

  private renderIntro(): HTMLElement {
    const p = document.createElement('p');
    p.className = 'panel-note';
    p.textContent =
      'Earn Research Points (RP) by Ascending. Start research to unlock permanent upgrades — each takes time to complete. Invest in Scholarly Focus (Prestige tab) to speed up research.';
    return p;
  }

  private renderFooter(): HTMLElement {
    const p = document.createElement('p');
    p.className = 'panel-note';
    p.textContent =
      'Tip: you can only research one item at a time. Prioritize economy (Alchemy → Prosperity) for gold snowballing, or combat (Piercing Shots → Chain Reaction) for wave pushing.';
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

    // Progress bar (hidden by default)
    const progressWrap = document.createElement('div');
    progressWrap.className = 'research-progress';
    progressWrap.style.display = 'none';
    const progressTrack = document.createElement('div');
    progressTrack.className = 'research-progress-track';
    const progressBar = document.createElement('div');
    progressBar.className = 'research-progress-bar';
    progressBar.style.width = '0%';
    progressTrack.appendChild(progressBar);
    const progressText = document.createElement('div');
    progressText.className = 'research-progress-text';
    progressText.textContent = '';
    progressWrap.appendChild(progressTrack);
    progressWrap.appendChild(progressText);
    info.appendChild(progressWrap);

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
    const timeEst = document.createElement('div');
    timeEst.className = 'research-time';
    timeEst.textContent = formatTime(n.researchTime);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-research';
    btn.textContent = 'Start';
    btn.disabled = true;
    btn.addEventListener('click', () => {
      if (btn.classList.contains('btn-cancel')) {
        this.handlers.onCancelResearch();
      } else {
        this.handlers.onStartResearch(n.id);
      }
    });
    action.appendChild(cost);
    action.appendChild(timeEst);
    action.appendChild(btn);
    row.appendChild(action);

    this.stateById.set(n.id, stateEl);
    this.reasonById.set(n.id, reasonEl);
    this.costById.set(n.id, cost);
    this.btnById.set(n.id, btn);
    this.progressWrapById.set(n.id, progressWrap);
    this.progressBarById.set(n.id, progressBar);
    this.progressTextById.set(n.id, progressText);
    this.timeEstById.set(n.id, timeEst);
    return row;
  }
}
