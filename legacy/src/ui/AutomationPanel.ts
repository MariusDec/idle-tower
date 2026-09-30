import type { AutoBuyStrategy, GameState } from '../types';
import { AUTO_BUY_STRATEGIES } from '../types';
import type { AutomationKey } from '../data/prestige';
import { ASCENSION_UNLOCK_WAVE } from '../data/prestige';
import { setText, toggleClass, setDisplay } from '../utils/dom';

export interface AutomationPanelHandlers {
  onToggleAutomation: (key: AutomationKey, enabled: boolean) => void;
  isAutomationUnlocked: (key: AutomationKey) => boolean;
  isAutomationEnabled: (key: AutomationKey) => boolean;
  onTargetWaveChange: (wave: number) => void;
  targetAscendWave: number;
  getAutoBuyStrategy: () => AutoBuyStrategy;
  onAutoBuyStrategyChange: (strategy: AutoBuyStrategy) => void;
  getAutoBuyReserve: () => number;
  onAutoBuyReserveChange: (fraction: number) => void;
  /** Auto-Upgrader level, for the "buys N per tick" readout (plan §3.3). */
  getAutoBuyCount: () => number;
}

const STRATEGY_LABELS: Record<AutoBuyStrategy, string> = {
  cheapest: 'Cheapest',
  balanced: 'Balanced',
  damage: 'Damage first',
};

const STRATEGY_HINTS: Record<AutoBuyStrategy, string> = {
  cheapest: 'Always buys the cheapest affordable upgrade. Fastest level count, weakest tower.',
  balanced: 'Levels every upgrade evenly, cheapest first among the least-levelled.',
  damage: 'Buys tower upgrades first, then economy, defense and utility.',
};

export class AutomationPanel {
  private readonly handlers: AutomationPanelHandlers;
  private root: HTMLElement | null = null;

  private autoBuyConfig!: HTMLElement;
  private autoBuyCount!: HTMLElement;
  private strategyBtns = new Map<AutoBuyStrategy, HTMLButtonElement>();
  private strategyHint!: HTMLElement;
  private reserveInput!: HTMLInputElement;
  private reserveLabel!: HTMLElement;

  private autoSwitches: Partial<Record<AutomationKey, HTMLInputElement>> = {};
  private autoRows: Partial<Record<AutomationKey, HTMLElement>> = {};
  private autoStatusEls: Partial<Record<AutomationKey, HTMLElement>> = {};

  constructor(handlers: AutomationPanelHandlers) {
    this.handlers = handlers;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.clearMaps();
    this.renderInto(parent);
  }

  update(_state: GameState): void {
    if (!this.root) return;
    const autoKeys: AutomationKey[] = ['autoBuy', 'autoAbilities', 'autoAscend', 'autoTranscend'];
    for (const key of autoKeys) this.updateAutomationRow(key);
    this.updateAutoBuyConfig();
  }

  /** Plan §3.6: strategy + reserve controls, only meaningful once auto-buy exists. */
  private updateAutoBuyConfig(): void {
    const unlocked = this.handlers.isAutomationUnlocked('autoBuy');
    setDisplay(this.autoBuyConfig, unlocked ? '' : 'none');
    if (!unlocked) return;
    const strategy = this.handlers.getAutoBuyStrategy();
    for (const [id, btn] of this.strategyBtns) {
      toggleClass(btn, 'is-selected', id === strategy);
    }
    setText(this.strategyHint, STRATEGY_HINTS[strategy]);
    const count = this.handlers.getAutoBuyCount();
    setText(this.autoBuyCount, `Buys ${count} upgrade${count === 1 ? '' : 's'} every tick.`);
    const reserve = Math.round(this.handlers.getAutoBuyReserve() * 100);
    if (this.reserveInput.value !== String(reserve)) this.reserveInput.value = String(reserve);
    setText(this.reserveLabel, reserve > 0
      ? `Keep ${reserve}% of gold banked`
      : 'Spend all available gold');
  }

  private updateAutomationRow(key: AutomationKey): void {
    const row = this.autoRows[key];
    const sw = this.autoSwitches[key];
    const status = this.autoStatusEls[key];
    if (!row || !sw || !status) return;
    const unlocked = this.handlers.isAutomationUnlocked(key);
    const enabled = this.handlers.isAutomationEnabled(key);
    toggleClass(row, 'is-locked', !unlocked);
    toggleClass(row, 'is-unlocked', unlocked);
    sw.disabled = !unlocked;
    sw.checked = unlocked && enabled;
    setText(status, !unlocked
      ? 'Locked — purchase the matching perk to unlock'
      : enabled
      ? 'Active'
      : 'Inactive');
    toggleClass(status, 'automation-status-on', unlocked && enabled);
    toggleClass(status, 'automation-status-off', unlocked && !enabled);
  }

  private clearMaps(): void {
    this.strategyBtns.clear();
    this.autoSwitches = {};
    this.autoRows = {};
    this.autoStatusEls = {};
  }

  private unmount(): void {
    this.root = null;
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'automation-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Automation';
    parent.appendChild(title);

    parent.appendChild(this.renderAutomationSection());
  }

  private renderAutomationSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'automation-section';
    const header = document.createElement('h3');
    header.className = 'perk-section-title';
    header.textContent = 'Automation';
    section.appendChild(header);

    const intro = document.createElement('p');
    intro.className = 'panel-note';
    intro.textContent = 'Each automation requires the matching perk (AP or TP). Toggle them on once unlocked.';
    section.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'automation-list';
    const entries: Array<[AutomationKey, string, string, string]> = [
      ['autoBuy', 'Auto-Upgrade',
        'Buys upgrades on a timer using the strategy below. One purchase per tick per Auto-Upgrader level.',
        'Unlock: Prestige → Auto-Upgrader (12 AP, tier 1). Levels 2–3 (24 / 48 AP) each add one purchase per tick. Faster ticks: Transcendence → Dominion → Efficiency (−1s per level, floor 3s), or free from the Journal\'s Overseer unlock (chapter 7).'],
      ['autoAbilities', 'Auto-Cast',
        'Casts every ready ability once a second, in priority order, whenever mana and the ability\u2019s own conditions allow.',
        'Unlock: Transcendence → Dominion → Auto-Caster (8 TP). Per-ability opt-outs live on the Abilities tab.'],
      ['autoAscend', 'Auto-Ascend',
        'Ascends the moment your highest wave reaches the target below.',
        'Unlock: Transcendence → Dominion → Auto-Ascender (20 TP, tier 3; needs Auto-Caster and Wave Commander L3).'],
      ['autoTranscend', 'Auto-Transcend',
        'Transcends as soon as this cycle has banked enough AP.',
        'Unlock: Transcendence → Dominion → Auto-Transcender (40 TP, tier 4; needs Auto-Ascender).'],
    ];
    for (const [key, name, desc, sourceText] of entries) {
      list.appendChild(this.renderAutomationRow(key, name, desc, sourceText));
    }
    section.appendChild(list);
    section.appendChild(this.renderTargetWaveCard());
    section.appendChild(this.renderAutoBuyConfig());
    return section;
  }

  private renderTargetWaveCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'transcend-target-card';

    const targetLine = document.createElement('div');
    targetLine.className = 'transcend-target-line';
    targetLine.textContent = `Auto-Ascend target wave: ${this.handlers.targetAscendWave}`;
    card.appendChild(targetLine);

    const targetRow = document.createElement('div');
    targetRow.className = 'transcend-target-row';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(ASCENSION_UNLOCK_WAVE);
    input.max = '10000';
    input.step = '5';
    input.value = String(this.handlers.targetAscendWave);
    input.className = 'transcend-target-input';
    input.addEventListener('change', () => {
      const next = Math.max(ASCENSION_UNLOCK_WAVE, Math.floor(Number(input.value) || ASCENSION_UNLOCK_WAVE));
      input.value = String(next);
      this.handlers.onTargetWaveChange(next);
    });
    const inputNote = document.createElement('span');
    inputNote.className = 'transcend-target-note';
    inputNote.textContent = 'Used by auto-Ascend (requires matching perk).';
    targetRow.appendChild(input);
    targetRow.appendChild(inputNote);
    card.appendChild(targetRow);

    return card;
  }

  /**
   * Plan §3.6: auto-buy used one fixed rule (cheapest affordable, one purchase
   * per interval). These two controls are the whole configuration surface —
   * what it reaches for, and how much gold it refuses to touch.
   */
  private renderAutoBuyConfig(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'autobuy-config';
    this.autoBuyConfig = wrap;
    wrap.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'autobuy-config-title';
    title.textContent = 'Auto-Upgrade strategy';
    wrap.appendChild(title);

    const count = document.createElement('div');
    count.className = 'autobuy-config-count';
    this.autoBuyCount = count;
    count.textContent = '';
    wrap.appendChild(count);

    const row = document.createElement('div');
    row.className = 'autobuy-strategy-row';
    for (const id of AUTO_BUY_STRATEGIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn autobuy-strategy-btn';
      btn.textContent = STRATEGY_LABELS[id];
      btn.addEventListener('click', () => this.handlers.onAutoBuyStrategyChange(id));
      row.appendChild(btn);
      this.strategyBtns.set(id, btn);
    }
    wrap.appendChild(row);

    const hint = document.createElement('div');
    hint.className = 'autobuy-config-hint';
    this.strategyHint = hint;
    wrap.appendChild(hint);

    const reserveRow = document.createElement('div');
    reserveRow.className = 'autobuy-reserve-row';
    const reserveLabel = document.createElement('div');
    reserveLabel.className = 'autobuy-reserve-label';
    this.reserveLabel = reserveLabel;
    reserveRow.appendChild(reserveLabel);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '90';
    slider.step = '10';
    slider.value = '0';
    slider.className = 'autobuy-reserve-slider';
    slider.addEventListener('input', () => {
      this.handlers.onAutoBuyReserveChange(Number(slider.value) / 100);
    });
    this.reserveInput = slider;
    reserveRow.appendChild(slider);
    wrap.appendChild(reserveRow);

    return wrap;
  }

  private renderAutomationRow(key: AutomationKey, name: string, desc: string, sourceText: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'automation-row is-locked';
    this.autoRows[key] = row;

    const info = document.createElement('div');
    info.className = 'automation-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'automation-name';
    nameEl.textContent = name;
    const descEl = document.createElement('div');
    descEl.className = 'automation-desc';
    descEl.textContent = desc;
    const sourceEl = document.createElement('div');
    sourceEl.className = 'automation-source';
    sourceEl.textContent = sourceText;
    const status = document.createElement('div');
    status.className = 'automation-status';
    status.textContent = 'Locked';
    this.autoStatusEls[key] = status;
    info.appendChild(nameEl);
    info.appendChild(descEl);
    info.appendChild(sourceEl);
    info.appendChild(status);
    row.appendChild(info);

    const switchWrap = document.createElement('label');
    switchWrap.className = 'automation-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.disabled = true;
    input.addEventListener('change', () => this.handlers.onToggleAutomation(key, input.checked));
    const slider = document.createElement('span');
    slider.className = 'automation-switch-slider';
    switchWrap.appendChild(input);
    switchWrap.appendChild(slider);
    row.appendChild(switchWrap);

    this.autoSwitches[key] = input;
    return row;
  }
}