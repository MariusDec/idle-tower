import type { UpgradeCategory, UpgradeDef, UpgradeEvolution, GameState } from '../types';
import { computeUpgradeValue } from '../types';
import { UPGRADES } from '../data/upgrades';
import { upgradeCost } from '../data/formulas';
import { formatNumber } from '../utils/bigNumber';
import { setText, toggleClass, setDisplay } from '../utils/dom';

type UpgradeTabId = 'attack' | 'defense' | 'utility';

/** How many levels one click buys. `'max'` means "as many as gold allows". */
export type BuyAmount = 1 | 10 | 'max';

/** What a given buy amount would actually purchase, resolved by the host. */
export interface UpgradePlan {
  levels: number;
  cost: number;
}

const BUY_AMOUNTS: { value: BuyAmount; label: string; title: string }[] = [
  { value: 1, label: '×1', title: 'Buy a single level' },
  { value: 10, label: '×10', title: 'Buy up to the next multiple of 10 (from level 18, that is 2 levels)' },
  { value: 'max', label: '×Max', title: 'Buy as many levels as your gold allows' },
];

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
  private readonly onBuy: (id: string, amount: BuyAmount) => void;
  private getPlanFn: ((id: string, amount: BuyAmount) => UpgradePlan) | null = null;
  private root: HTMLElement | null = null;
  private costById = new Map<string, HTMLElement>();
  private levelById = new Map<string, HTMLElement>();
  private bonusById = new Map<string, HTMLElement>();
  private buttonById = new Map<string, HTMLButtonElement>();
  private nameById = new Map<string, HTMLElement>();
  private evoInfoById = new Map<string, HTMLElement>();
  private rowById = new Map<string, HTMLElement>();
  private evoInfoLastLevel = new Map<string, number>();
  private levelsById = new Map<string, HTMLElement>();
  private amountBtns = new Map<BuyAmount, HTMLButtonElement>();
  private activeTab: UpgradeTabId = 'attack';
  private buyAmount: BuyAmount = 1;
  /**
   * Amount implied by a held modifier key (shift = ×10, ctrl/cmd = ×Max),
   * which temporarily overrides the selector without changing it.
   */
  private modifierAmount: BuyAmount | null = null;
  private boundModifierChange: ((ev: KeyboardEvent) => void) | null = null;
  private boundBlur: (() => void) | null = null;

  constructor(onBuy: (id: string, amount: BuyAmount) => void) {
    this.onBuy = onBuy;
  }

  setPlanGetter(fn: (id: string, amount: BuyAmount) => UpgradePlan): void {
    this.getPlanFn = fn;
  }

  /** The amount a click buys right now: a held modifier beats the selector. */
  private effectiveAmount(): BuyAmount {
    return this.modifierAmount ?? this.buyAmount;
  }

  private planFor(id: string, level: number, amount: BuyAmount): UpgradePlan {
    if (this.getPlanFn) return this.getPlanFn(id, amount);
    // Fallback for a panel mounted before the host wired its getter: price a
    // single level off the raw curve.
    const def = UPGRADES.find(u => u.id === id);
    if (!def) return { levels: 0, cost: 0 };
    return { levels: 1, cost: upgradeCost(def.baseCost, def.costGrowth, level) };
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
    this.levelsById.clear();
    this.amountBtns.clear();
    this.activeTab = 'attack';
    this.bindModifierKeys();
    this.renderInto(parent);
  }

  /**
   * Shift/ctrl held anywhere in the document temporarily promotes the buy
   * amount, so a player can grab ten levels without leaving ×1 selected.
   * The window blur reset stops a modifier from sticking when focus leaves
   * mid-hold (the keyup never arrives in that case).
   */
  private bindModifierKeys(): void {
    if (this.boundModifierChange) return;
    const onChange = (ev: KeyboardEvent) => {
      const next: BuyAmount | null = (ev.ctrlKey || ev.metaKey) ? 'max' : ev.shiftKey ? 10 : null;
      if (next === this.modifierAmount) return;
      this.modifierAmount = next;
      this.refreshAmountButtons();
    };
    this.boundModifierChange = onChange;
    this.boundBlur = () => {
      if (this.modifierAmount === null) return;
      this.modifierAmount = null;
      this.refreshAmountButtons();
    };
    window.addEventListener('keydown', onChange);
    window.addEventListener('keyup', onChange);
    window.addEventListener('blur', this.boundBlur);
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
      const amount = this.effectiveAmount();
      let plan = atMax ? { levels: 0, cost: 0 } : this.planFor(u.id, level, amount);
      // At ×Max with nothing affordable there is no plan to price, but the
      // player still needs to know what they are saving for — fall back to
      // the next single level.
      const emptyMax = !atMax && amount === 'max' && plan.levels === 0;
      if (emptyMax) plan = this.planFor(u.id, level, 1);
      const cost = atMax ? Infinity : plan.cost;
      const levelsEl = this.levelsById.get(u.id);
      if (levelsEl) {
        const showLevels = !atMax && !emptyMax && plan.levels > 1;
        setText(levelsEl, showLevels ? `+${plan.levels} lv` : '');
        setDisplay(levelsEl, showLevels ? '' : 'none');
      }
      if (isTotalEffectUpgrade(u)) {
        setText(levelEl, atMax ? formatNumberValue(computeUpgradeValue(u, level), 1) : '');
        setDisplay(levelEl, atMax ? '' : 'none');
      } else {
        setText(levelEl, atMax ? `Level ${level} (max)` : `Level ${level}`);
      }
      setText(costEl, atMax ? '—' : formatNumber(cost));
      setText(bonusEl, isTotalEffectUpgrade(u) ? formatEffectBonus(u, level, false, 0) : formatEffectBonus(u, level));
      const affordable = !atMax && !emptyMax && plan.levels > 0 && gold >= cost;
      btn.disabled = !affordable;
      toggleClass(btn, 'can-afford', affordable);
      setText(btn, atMax ? 'Maxed' : plan.levels > 1 ? `Buy ×${plan.levels}` : 'Buy');

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
    if (this.boundModifierChange) {
      window.removeEventListener('keydown', this.boundModifierChange);
      window.removeEventListener('keyup', this.boundModifierChange);
      this.boundModifierChange = null;
    }
    if (this.boundBlur) {
      window.removeEventListener('blur', this.boundBlur);
      this.boundBlur = null;
    }
    this.modifierAmount = null;
    this.root = null;
  }

  /**
   * Briefly flash a button white + spawn a floating "+N" to indicate purchase.
   */
  flashButton(id: string, levels = 1): void {
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
      plus.textContent = `+${levels}`;
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

    parent.appendChild(this.renderAmountSelector());

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
    note.textContent = 'Spending gold accelerates your tower. Costs grow exponentially per level. '
      + 'The cost shown is the total for the selected buy amount.';
    parent.appendChild(note);
  }

  private renderAmountSelector(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'upgrade-amount-row';

    const label = document.createElement('span');
    label.className = 'upgrade-amount-label';
    label.textContent = 'Buy';
    row.appendChild(label);

    const group = document.createElement('div');
    group.className = 'upgrade-amount-group';
    for (const a of BUY_AMOUNTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'upgrade-amount-btn';
      btn.textContent = a.label;
      btn.title = a.title;
      btn.addEventListener('click', () => {
        this.buyAmount = a.value;
        this.refreshAmountButtons();
      });
      this.amountBtns.set(a.value, btn);
      group.appendChild(btn);
    }
    row.appendChild(group);

    const hint = document.createElement('span');
    hint.className = 'upgrade-amount-hint';
    hint.textContent = 'hold shift ×10 · ctrl ×Max';
    row.appendChild(hint);

    this.refreshAmountButtons();
    return row;
  }

  private refreshAmountButtons(): void {
    const active = this.effectiveAmount();
    for (const [value, btn] of this.amountBtns) {
      toggleClass(btn, 'active', value === active);
      // A modifier-driven selection is styled apart from a clicked one so it
      // is obvious the state is transient.
      toggleClass(btn, 'is-modifier', this.modifierAmount !== null && value === active);
    }
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
    const levels = document.createElement('div');
    levels.className = 'upgrade-cost-levels';
    levels.style.display = 'none';
    const btn = document.createElement('button');
    btn.className = 'btn btn-buy';
    btn.type = 'button';
    btn.textContent = 'Buy';
    btn.disabled = true;
    btn.addEventListener('click', () => this.onBuy(u.id, this.effectiveAmount()));
    action.appendChild(cost);
    action.appendChild(levels);
    action.appendChild(btn);
    row.appendChild(action);

    this.levelsById.set(u.id, levels);
    this.costById.set(u.id, cost);
    this.levelById.set(u.id, level);
    this.bonusById.set(u.id, bonus);
    this.buttonById.set(u.id, btn);
    return row;
  }
}
