import type { UpgradeCategory, UpgradeDef, UpgradeEvolution, GameState } from '../types';
import { computeUpgradeValue } from '../types';
import { UPGRADES } from '../data/upgrades';
import { upgradeCost } from '../data/formulas';
import { formatNumber } from '../utils/bigNumber';
import { setText, toggleClass, setDisplay } from '../utils/dom';

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

const PERCENT_UPGRADES = new Set(['critChance', 'critDamage', 'goldMulti', 'xpGain', 'upgradeDiscount', 'abilityCostReduction', 'critGold', 'doubleShotChance', 'quickShotChance']);

function getHighestEvolution(def: UpgradeDef, level: number): UpgradeEvolution | null {
  if (!def.evolutions) return null;
  let best: UpgradeEvolution | null = null;
  for (const evo of def.evolutions) {
    if (level >= evo.level) best = evo;
  }
  return best;
}

function getNextEvolution(def: UpgradeDef, level: number): UpgradeEvolution | null {
  if (!def.evolutions) return null;
  for (const evo of def.evolutions) {
    if (level < evo.level) return evo;
  }
  return null;
}

function isPercent(def: UpgradeDef): boolean {
  if (def.scaling) return def.scaling.effectType === 'mult';
  return PERCENT_UPGRADES.has(def.id);
}

function isTotalEffectUpgrade(def: UpgradeDef): boolean {
  return def.id === 'damage' || def.id === 'health';
}

function formatNumberValue(v: number, decimalCount = 0): string {
  const abs = Math.abs(v);
  if (abs !== 0 && abs < 1) return v.toFixed(2);
  if (abs < 10) return v.toFixed(1);

  const decimalFactor = Math.pow(10, decimalCount);
  if (abs < 1000) return (Math.floor(abs * decimalFactor) / decimalFactor).toLocaleString();

  return v.toFixed(0);
}

function formatPercentValue(v: number): string {
  const pct = v * 100;
  const decimals = Math.abs(pct) < 10 && pct % 1 !== 0 ? 1 : 0;
  return `${pct.toFixed(decimals)}%`;
}

function formatEffectBonus(def: UpgradeDef, level: number, showSign: boolean = true, decimalCount = 1): string {
  const total = computeUpgradeValue(def, level);
  if (total === 0) return '';
  const unit = def.scaling?.unit ?? '';
  if (isPercent(def)) {
    const sign = showSign ? (total > 0 ? '+' : '') : '';
    return `${sign}${formatPercentValue(total)}`;
  }
  const sign = showSign ? (total > 0 ? '+' : '') : '';
  return `${sign}${formatNumberValue(total, decimalCount)}${unit}`;
}

function formatNextDelta(def: UpgradeDef): string {
  if (def.hideUpgradeScale) return '';

  if (def.scaling?.step) {
    const step = def.scaling.step;
    const inc = formatNumberValue(Math.abs(def.scaling.perLevel), 1);
    return `+${inc} per ${step} levels`;
  }
  if (def.scaling) {
    const v = def.scaling.perLevel;
    const sign = v >= 0 ? '+' : '−';
    const abs = Math.abs(v);
    const unit = def.scaling.unit ?? '';
    if (isPercent(def)) {
      const pct = abs * 100;
      const decimals = pct < 10 && pct % 1 !== 0 ? 1 : 0;
      return `${sign}${pct.toFixed(decimals)}% per level`;
    }
    if (abs !== 0 && abs < 1) return `${sign}${abs.toFixed(2)}${unit} per level`;
    if (abs < 10) return `${sign}${abs.toFixed(1)}${unit} per level`;
    return `${sign}${abs.toFixed(0)}${unit} per level`;
  }
  if (typeof def.effectPerLevel === 'string') return '';
  const v = def.effectPerLevel;
  const sign = v >= 0 ? '+' : '−';
  const abs = Math.abs(v);
  if (isPercent(def)) {
    const pct = abs * 100;
    const decimals = pct < 10 && pct % 1 !== 0 ? 1 : 0;
    return `${sign}${pct.toFixed(decimals)}% per level`;
  }
  if (abs !== 0 && abs < 1) return `${sign}${abs.toFixed(2)} per level`;
  if (abs < 10) return `${sign}${abs.toFixed(1)} per level`;
  return `${sign}${abs.toFixed(0)} per level`;
}

export class UpgradePanel {
  private readonly onBuy: (id: string) => void;
  private getCostFn: ((id: string) => number) | null = null;
  private root: HTMLElement | null = null;
  private costById = new Map<string, HTMLElement>();
  private levelById = new Map<string, HTMLElement>();
  private bonusById = new Map<string, HTMLElement>();
  private buttonById = new Map<string, HTMLButtonElement>();
  private nameById = new Map<string, HTMLElement>();
  private evoInfoById = new Map<string, HTMLElement>();
  private rowById = new Map<string, HTMLElement>();
  private evoInfoLastLevel = new Map<string, number>();
  private activeTab: UpgradeTabId = 'attack';

  constructor(onBuy: (id: string) => void) {
    this.onBuy = onBuy;
  }

  setCostGetter(fn: (id: string) => number): void {
    this.getCostFn = fn;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.costById.clear();
    this.levelById.clear();
    this.bonusById.clear();
    this.buttonById.clear();
    this.nameById.clear();
    this.evoInfoById.clear();
    this.rowById.clear();
    this.evoInfoLastLevel.clear();
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
      const nameEl = this.nameById.get(u.id);
      const evoEl = this.evoInfoById.get(u.id);
      const rowEl = this.rowById.get(u.id);
      if (!btn || !costEl || !levelEl || !bonusEl) continue;
      const level = state.upgrades[u.id] ?? 0;
      const atMax = u.maxLevel > 0 && level >= u.maxLevel;
      const cost = atMax ? Infinity : (this.getCostFn ? this.getCostFn(u.id) : upgradeCost(u.baseCost, u.costGrowth, level));
      if (isTotalEffectUpgrade(u)) {
        setText(levelEl, atMax ? formatNumberValue(computeUpgradeValue(u, level), 1) : '');
        setDisplay(levelEl, atMax ? '' : 'none');
      } else {
        setText(levelEl, atMax ? `Level ${level} (max)` : `Level ${level}`);
      }
      setText(costEl, atMax ? '—' : formatNumber(cost));
      setText(bonusEl, isTotalEffectUpgrade(u) ? formatEffectBonus(u, level, false, 0) : formatEffectBonus(u, level));
      btn.disabled = atMax || gold < cost;
      toggleClass(btn, 'can-afford', !atMax && gold >= cost);
      setText(btn, atMax ? 'Maxed' : 'Buy');

      // Evolution display
      if (nameEl && u.evolutions) {
        const highestEvo = getHighestEvolution(u, level);
        if (highestEvo) {
          setText(nameEl, highestEvo.name);
          if (rowEl) toggleClass(rowEl, 'upgrade-evolved', true);
        } else {
          setText(nameEl, u.name);
          if (rowEl) toggleClass(rowEl, 'upgrade-evolved', false);
        }
      }
      if (evoEl && u.evolutions) {
        // The evo lines only depend on `level`. Skip the full innerHTML
        // rebuild unless the level has changed since the last render, so
        // selecting the description text isn't broken every UI tick.
        if (this.evoInfoLastLevel.get(u.id) !== level) {
          this.evoInfoLastLevel.set(u.id, level);
          evoEl.innerHTML = '';
          let hasContent = false;
          // Show unlocked evolution effects
          for (const evo of u.evolutions) {
            if (level >= evo.level) {
              const line = document.createElement('div');
              line.className = 'evo-line evo-unlocked';
              line.textContent = `★ ${evo.name}: ${evo.description}`;
              evoEl.appendChild(line);
              hasContent = true;
            }
          }
          // Show next evolution hint (purple, name only)
          const nextEvo = getNextEvolution(u, level);
          if (nextEvo) {
            const line = document.createElement('div');
            line.className = 'evo-line evo-next';
            line.textContent = `Evolves at Lv${nextEvo.level}: ${nextEvo.name}`;
            evoEl.appendChild(line);
            hasContent = true;
          }
          setDisplay(evoEl, hasContent ? '' : 'none');
        }
      }
    }
  }

  private   unmount(): void {
    this.root = null;
  }

  /**
   * Briefly flash a button white + spawn a floating "+1" to indicate purchase.
   */
  flashButton(id: string): void {
    const btn = this.buttonById.get(id);
    if (!btn) return;
    // Animation restart: always remove + force reflow + add, regardless of
    // cached class state — toggleClass would short-circuit and break the
    // CSS animation.
    btn.classList.remove('is-flash');
    // Force reflow so animation restarts
    void btn.offsetWidth;
    btn.classList.add('is-flash');
    setTimeout(() => btn.classList.remove('is-flash'), 220);

    // Floating "+1"
    const action = btn.parentElement;
    if (action) {
      const plus = document.createElement('span');
      plus.className = 'upgrade-plus-one';
      plus.textContent = '+1';
      action.appendChild(plus);
      setTimeout(() => {
        if (plus.parentElement) plus.parentElement.removeChild(plus);
      }, 700);
    }
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
      toggleClass(el, 'active', el.dataset.upgradeTab === id);
    }
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('.upgrade-tab-panel'))) {
      toggleClass(el, 'active', el.dataset.upgradeTabPanel === id);
    }
  }

  private renderRow(u: UpgradeDef): HTMLElement {
    const row = document.createElement('div');
    row.className = 'upgrade-row';
    row.dataset.upgradeId = u.id;
    this.rowById.set(u.id, row);

    const info = document.createElement('div');
    info.className = 'upgrade-info';
    const name = document.createElement('div');
    name.className = 'upgrade-name';
    name.textContent = u.name;
    this.nameById.set(u.id, name);
    const desc = document.createElement('div');
    desc.className = 'upgrade-desc';
    desc.textContent = u.description;

    const evoInfo = document.createElement('div');
    evoInfo.className = 'upgrade-evo-info';
    evoInfo.style.display = 'none';
    this.evoInfoById.set(u.id, evoInfo);

    const meta = document.createElement('div');
    meta.className = 'upgrade-meta';
    const level = document.createElement('span');
    level.className = 'upgrade-level';
    level.textContent = isTotalEffectUpgrade(u) ? '' : 'Level 0';
    const bonus = document.createElement('span');
    bonus.className = 'upgrade-bonus';
    bonus.textContent = formatEffectBonus(u, 0);
    const delta = document.createElement('span');
    delta.className = 'upgrade-delta';
    delta.textContent = formatNextDelta(u);
    meta.appendChild(level);
    meta.appendChild(bonus);
    meta.appendChild(delta);
    info.appendChild(name);
    info.appendChild(desc);
    info.appendChild(evoInfo);
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
