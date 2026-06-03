import type { UpgradeCategory, UpgradeDef, GameState } from '../types';
import { computeUpgradeValue } from '../types';
import { UPGRADES } from '../data/upgrades';
import { upgradeCost } from '../data/formulas';
import { formatNumber } from '../utils/bigNumber';

type UpgradeTabId = 'attack' | 'defense' | 'utility';

interface UpgradeTabDef {
  id: UpgradeTabId;
  label: string;
  categories: UpgradeCategory[];
}

const TAB_DEFS: UpgradeTabDef[] = [
  { id: 'attack', label: 'Attack', categories: ['tower'] },
  { id: 'defense', label: 'Defense', categories: ['defense'] },
  { id: 'utility', label: 'Utility', categories: ['economy', 'utility'] },
];

const PERCENT_UPGRADES = new Set(['critChance', 'critDamage', 'goldMulti']);

function isPercent(def: UpgradeDef): boolean {
  if (def.scaling) return def.scaling.effectType === 'mult';
  return PERCENT_UPGRADES.has(def.id);
}

function formatNumberValue(v: number): string {
  const abs = Math.abs(v);
  if (abs !== 0 && abs < 1) return v.toFixed(2);
  if (abs < 10) return v.toFixed(1);
  return v.toFixed(0);
}

function formatPercentValue(v: number): string {
  const pct = v * 100;
  const decimals = Math.abs(pct) < 10 && pct % 1 !== 0 ? 1 : 0;
  return `${pct.toFixed(decimals)}%`;
}

function formatEffectBonus(def: UpgradeDef, level: number): string {
  const total = computeUpgradeValue(def, level);
  if (total === 0) return '';
  const unit = def.scaling?.unit ?? '';
  if (isPercent(def)) {
    return `+${formatPercentValue(total)}`;
  }
  return `+${formatNumberValue(total)}${unit}`;
}

function formatNextDelta(def: UpgradeDef): string {
  if (def.hideUpgradeScale) return '';

  if (def.scaling?.step) {
    const step = def.scaling.step;
    const inc = formatNumberValue(Math.abs(def.scaling.perLevel));
    return `+${inc} per ${step} levels`;
  }
  const v = def.scaling ? def.scaling.perLevel : def.effectPerLevel;
  const sign = v >= 0 ? '+' : '−';
  const abs = Math.abs(v);
  const unit = def.scaling?.unit ?? '';
  if (isPercent(def)) {
    const pct = abs * 100;
    const decimals = pct < 10 && pct % 1 !== 0 ? 1 : 0;
    return `${sign}${pct.toFixed(decimals)}% per level`;
  }
  if (abs !== 0 && abs < 1) return `${sign}${abs.toFixed(2)}${unit} per level`;
  if (abs < 10) return `${sign}${abs.toFixed(1)}${unit} per level`;
  return `${sign}${abs.toFixed(0)}${unit} per level`;
}

export class UpgradePanel {
  private readonly onBuy: (id: string) => void;
  private root: HTMLElement | null = null;
  private costById = new Map<string, HTMLElement>();
  private levelById = new Map<string, HTMLElement>();
  private bonusById = new Map<string, HTMLElement>();
  private buttonById = new Map<string, HTMLButtonElement>();
  private activeTab: UpgradeTabId = 'attack';

  constructor(onBuy: (id: string) => void) {
    this.onBuy = onBuy;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.costById.clear();
    this.levelById.clear();
    this.bonusById.clear();
    this.buttonById.clear();
    this.activeTab = 'attack';
    this.renderInto(parent);
  }

  update(state: GameState): void {
    if (!this.root) return;
    const gold = state.resources.gold;
    for (const u of UPGRADES) {
      const btn = this.buttonById.get(u.id);
      const costEl = this.costById.get(u.id);
      const levelEl = this.levelById.get(u.id);
      const bonusEl = this.bonusById.get(u.id);
      if (!btn || !costEl || !levelEl || !bonusEl) continue;
      const level = state.upgrades[u.id] ?? 0;
      const atMax = u.maxLevel > 0 && level >= u.maxLevel;
      const cost = atMax ? Infinity : upgradeCost(u.baseCost, u.costGrowth, level);
      levelEl.textContent = atMax ? `Level ${level} (max)` : `Level ${level}`;
      costEl.textContent = atMax ? '—' : formatNumber(cost);
      bonusEl.textContent = formatEffectBonus(u, level);
      btn.disabled = atMax || gold < cost;
      btn.classList.toggle('can-afford', !atMax && gold >= cost);
      btn.textContent = atMax ? 'Maxed' : 'Buy';
    }
  }

  private unmount(): void {
    this.root = null;
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'upgrade-panel';
    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Upgrades';
    parent.appendChild(title);

    const tabs = document.createElement('div');
    tabs.className = 'upgrade-tabs';
    for (const t of TAB_DEFS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      btn.textContent = t.label;
      btn.dataset.upgradeTab = t.id;
      btn.addEventListener('click', () => this.showInnerTab(t.id));
      tabs.appendChild(btn);
    }
    parent.appendChild(tabs);

    const byTab = new Map<UpgradeTabId, UpgradeDef[]>();
    for (const t of TAB_DEFS) byTab.set(t.id, []);
    for (const u of UPGRADES) {
      for (const t of TAB_DEFS) {
        if (t.categories.includes(u.category)) {
          byTab.get(t.id)!.push(u);
          break;
        }
      }
    }

    for (const t of TAB_DEFS) {
      const panel = document.createElement('div');
      panel.className = 'upgrade-tab-panel';
      panel.dataset.upgradeTabPanel = t.id;
      const items = byTab.get(t.id) ?? [];
      if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'panel-note';
        empty.textContent = 'No upgrades available in this section yet.';
        panel.appendChild(empty);
      } else {
        const list = document.createElement('div');
        list.className = 'upgrade-list';
        for (const u of items) {
          list.appendChild(this.renderRow(u));
        }
        panel.appendChild(list);
      }
      parent.appendChild(panel);
    }

    this.showInnerTab(this.activeTab);

    const note = document.createElement('p');
    note.className = 'panel-note';
    note.textContent = 'Spending gold accelerates your tower. Costs grow exponentially per level.';
    parent.appendChild(note);
  }

  private showInnerTab(id: UpgradeTabId): void {
    this.activeTab = id;
    if (!this.root) return;
    for (const el of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.upgrade-tabs .tab-btn'))) {
      el.classList.toggle('active', el.dataset.upgradeTab === id);
    }
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('.upgrade-tab-panel'))) {
      el.classList.toggle('active', el.dataset.upgradeTabPanel === id);
    }
  }

  private renderRow(u: UpgradeDef): HTMLElement {
    const row = document.createElement('div');
    row.className = 'upgrade-row';
    row.dataset.upgradeId = u.id;

    const info = document.createElement('div');
    info.className = 'upgrade-info';
    const name = document.createElement('div');
    name.className = 'upgrade-name';
    name.textContent = u.name;
    const desc = document.createElement('div');
    desc.className = 'upgrade-desc';
    desc.textContent = u.description;
    const meta = document.createElement('div');
    meta.className = 'upgrade-meta';
    const level = document.createElement('span');
    level.className = 'upgrade-level';
    level.textContent = 'Level 0';
    const bonus = document.createElement('span');
    bonus.className = 'upgrade-bonus';
    bonus.textContent = '';
    const delta = document.createElement('span');
    delta.className = 'upgrade-delta';
    delta.textContent = formatNextDelta(u);
    meta.appendChild(level);
    meta.appendChild(bonus);
    meta.appendChild(delta);
    info.appendChild(name);
    info.appendChild(desc);
    info.appendChild(meta);
    row.appendChild(info);

    const action = document.createElement('div');
    action.className = 'upgrade-action';
    const cost = document.createElement('div');
    cost.className = 'upgrade-cost';
    cost.textContent = '0';
    const btn = document.createElement('button');
    btn.className = 'btn btn-buy';
    btn.type = 'button';
    btn.textContent = 'Buy';
    btn.disabled = true;
    btn.addEventListener('click', () => this.onBuy(u.id));
    action.appendChild(cost);
    action.appendChild(btn);
    row.appendChild(action);

    this.costById.set(u.id, cost);
    this.levelById.set(u.id, level);
    this.bonusById.set(u.id, bonus);
    this.buttonById.set(u.id, btn);
    return row;
  }
}
