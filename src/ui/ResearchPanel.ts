import type { GameState } from '../types';
import {
  RESEARCH_NODES,
  type ResearchDef,
  type ResearchCategory,
  type ResearchEffectType,
  getResearchCost,
  getResearchTime,
  getResearchEffectAtLevel,
} from '../data/research';
import { formatNumber } from '../utils/bigNumber';
import { setDisabled, setStyle, setText, toggleClass, setDisplay } from '../utils/dom';

export interface ResearchPanelHandlers {
  onStartResearch: (id: string) => void;
  onCancelResearch: () => void;
  rp: number;
  levels: Readonly<Record<string, number>>;
  unlocked: ReadonlySet<string>;
  reasonBlocked: (id: string) => string | null;
  inProgress: { id: string; elapsed: number; total: number; targetLevel: number } | null;
  researchSpeedMultiplier: number;
}

const CATEGORY_ORDER: ResearchCategory[] = ['combat', 'economy', 'arcane', 'scouting', 'research'];
const CATEGORY_LABELS: Record<ResearchCategory, string> = {
  combat: 'Combat',
  economy: 'Economy',
  arcane: 'Arcane',
  scouting: 'Scouting',
  research: 'Research',
};

function formatTime(seconds: number): string {
  if (seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatPercent(v: number, digits: number = 0): string {
  const pct = v * 100;
  if (digits === 0 && Math.abs(pct - Math.round(pct)) < 1e-6) {
    return `${Math.round(pct)}%`;
  }
  return `${pct.toFixed(digits)}%`;
}

function formatEffectValue(effectType: ResearchEffectType, value: number): string {
  switch (effectType) {
    case 'pierce':
      return `Pierce +${value}`;
    case 'gold_multi':
      return `+${formatPercent(value)} gold`;
    case 'gold_luck':
      return `${formatPercent(value, 1)} chance 3× gold`;
    case 'mana_regen':
      return `+${formatPercent(value)} mana regen`;
    case 'ability_cost':
      return `−${formatPercent(value)} ability cost`;
    case 'start_wave':
      return `Start at wave ${value}`;
    case 'tower_defense':
      return `${formatPercent(value)} damage reduction`;
    case 'chain_kill_aoe':
      return `${formatPercent(value)} AoE on kill`;
    case 'crit_mana':
      return `Crits +${formatNumber(value)} mana`;
    case 'ability_power':
      return `+${formatPercent(value)} ability damage`;
    case 'intermission_speed':
      return `−${formatPercent(value)} intermission`;
    case 'enemy_hp_reduce':
      return `−${formatPercent(value)} enemy HP`;
    case 'rp_gain':
      return `+${formatPercent(value)} RP gain`;
    case 'rp_drop_chance':
      return `+${formatPercent(value, 1)} drop chance`;
    default:
      return formatNumber(value);
  }
}

function formatResearchEffect(def: ResearchDef, current: number, next: number | null): string {
  if (current <= 0 && next === null) return '';
  const currentText = current > 0 ? formatEffectValue(def.effectType, current) : '';
  if (next === null) return currentText;
  const nextText = formatEffectValue(def.effectType, next);
  if (!currentText) return nextText;
  return `${currentText} (next: ${nextText})`;
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
  private levelById = new Map<string, HTMLElement>();
  private effectById = new Map<string, HTMLElement>();

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
    this.levelById.clear();
    this.effectById.clear();
    this.renderInto(parent);
  }

  update(state: GameState): void {
    if (!this.root) return;
    setText(this.rpEl, formatNumber(this.handlers.rp));
    setText(this.ascensionsEl, formatNumber(state.stats.ascensions));
    const spent = this.computeSpent();
    setText(this.spentEl, formatNumber(spent));
    const speedPct = Math.round((1 - this.handlers.researchSpeedMultiplier) * 100);
    setText(this.speedEl, speedPct > 0 ? `-${speedPct}%` : '—');

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
      const levelEl = this.levelById.get(node.id);
      const effectEl = this.effectById.get(node.id);
      if (!row || !stateEl || !reasonEl || !costEl || !btn || !progressWrap || !progressBar || !progressText || !timeEst || !levelEl || !effectEl) continue;

      const level = this.handlers.levels[node.id] ?? 0;
      const maxLevel = node.maxLevel;
      const isMaxed = level >= maxLevel;
      const isResearching = ip?.id === node.id;
      const reason = isResearching ? null : this.handlers.reasonBlocked(node.id);
      const currentEffect = level > 0 ? getResearchEffectAtLevel(node, level) : 0;
      const nextEffect = !isMaxed ? getResearchEffectAtLevel(node, Math.min(level + 1, maxLevel)) : currentEffect;
      const cost = isMaxed ? 0 : getResearchCost(node, Math.min(level + 1, maxLevel));
      const totalTime = isMaxed ? 0 : getResearchTime(node, Math.min(level + 1, maxLevel)) * this.handlers.researchSpeedMultiplier;

      setText(levelEl, level > 0 ? `Level ${level} / ${maxLevel}` : '');
      setText(effectEl, formatResearchEffect(node, currentEffect, isMaxed ? null : nextEffect));

      const unlocked = level > 0;
      toggleClass(row, 'is-unlocked', unlocked && !isResearching);
      toggleClass(row, 'is-researching', isResearching);
      toggleClass(row, 'is-locked', !unlocked && !isResearching && reason !== null);
      toggleClass(row, 'is-available', !unlocked && !isResearching && reason === null);
      toggleClass(row, 'is-maxed', isMaxed && !isResearching);

      if (isResearching && ip) {
        const pct = Math.min(100, (ip.elapsed / Math.max(0.0001, ip.total)) * 100);
        const remaining = Math.max(0, ip.total - ip.elapsed);
        setText(stateEl, 'Researching…');
        toggleClass(stateEl, 'research-state-researching', true);
        toggleClass(stateEl, 'research-state-unlocked', false);
        toggleClass(stateEl, 'research-state-blocked', false);
        toggleClass(stateEl, 'research-state-available', false);
        setDisplay(progressWrap, '');
        setStyle(progressBar, 'width', `${pct}%`);
        setText(progressText, `${formatTime(remaining)} remaining`);
        setText(btn, 'Cancel');
        setDisabled(btn, false);
        toggleClass(btn, 'can-afford', false);
        toggleClass(btn, 'btn-cancel', true);
        setDisplay(timeEst, 'none');
        setText(reasonEl, '');
        setDisplay(reasonEl, 'none');
        setText(costEl, formatNumber(cost));
      } else {
        setDisplay(progressWrap, 'none');
        toggleClass(btn, 'btn-cancel', false);
        toggleClass(stateEl, 'research-state-researching', false);
        if (isMaxed) {
          setText(stateEl, 'Maxed');
          toggleClass(stateEl, 'research-state-unlocked', true);
          toggleClass(stateEl, 'research-state-blocked', false);
          toggleClass(stateEl, 'research-state-available', false);
          setText(costEl, '—');
          setDisabled(btn, true);
          toggleClass(btn, 'can-afford', false);
          setText(btn, 'Done');
          setDisplay(timeEst, 'none');
        } else {
          setText(stateEl, '');
          toggleClass(stateEl, 'research-state-unlocked', false);
          toggleClass(stateEl, 'research-state-blocked', false);
          toggleClass(stateEl, 'research-state-available', false);
          setText(costEl, formatNumber(cost));
          const canStart = reason === null;
          setDisabled(btn, !canStart);
          toggleClass(btn, 'can-afford', canStart);
          setText(btn, level > 0 ? 'Upgrade' : 'Start');
          setText(timeEst, formatTime(totalTime));
          setDisplay(timeEst, '');
        }
        const reasonIsPrereq = reason !== null && reason.startsWith('Requires ') && node.prerequisites.length > 0;
        if (reason && !isMaxed && !reasonIsPrereq) {
          setText(reasonEl, reason);
          setDisplay(reasonEl, '');
        } else {
          setText(reasonEl, '');
          setDisplay(reasonEl, 'none');
        }
      }
    }
  }

  private computeSpent(): number {
    let total = 0;
    for (const node of RESEARCH_NODES) {
      const level = this.handlers.levels[node.id] ?? 0;
      for (let lv = 1; lv <= level; lv++) total += getResearchCost(node, lv);
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
      'Earn Research Points (RP) passively over time and from enemy drops. Start research to unlock permanent upgrades — each takes time to complete. Invest in Scholarly Focus (Prestige tab) to speed up research.';
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
    const levelEl = document.createElement('div');
    levelEl.className = 'research-level';
    levelEl.textContent = '';
    const effectEl = document.createElement('div');
    effectEl.className = 'research-effect';
    effectEl.textContent = '';
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
    info.appendChild(levelEl);
    info.appendChild(effectEl);
    info.appendChild(meta);

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
    timeEst.textContent = formatTime(0);
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
    this.levelById.set(n.id, levelEl);
    this.effectById.set(n.id, effectEl);
    return row;
  }
}
