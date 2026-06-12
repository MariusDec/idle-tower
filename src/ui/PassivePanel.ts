import type { GameState } from '../types';
import { PASSIVE_ABILITIES, passiveEffectValue } from '../data/passiveAbilities';
import { passiveXpForLevel } from '../data/xpTables';
import { setText, toggleClass, setStyle, setDisplay, setDisabled } from '../utils/dom';

export interface PassiveAPIDeps {
  getLevel: (id: string) => number;
  getXp: (id: string) => number;
  highestWave: number;
  isUnlocked: (id: string) => boolean;
  isMaxed: (id: string) => boolean;
  canUnlock: (id: string) => boolean;
  getUnlockCost: (id: string) => number;
  onUnlock: (id: string) => void;
  getUpgradeCost: (id: string) => number;
  canUpgrade: (id: string) => boolean;
  onUpgrade: (id: string) => void;
}

export class PassivePanel {
  private readonly deps: PassiveAPIDeps;
  private root: HTMLElement | null = null;
  private passiveRoots = new Map<string, HTMLElement>();
  private levelEls = new Map<string, HTMLElement>();
  private descEls = new Map<string, HTMLElement>();
  private xpBarFillEls = new Map<string, HTMLElement>();
  private xpTextEls = new Map<string, HTMLElement>();
  private xpBarEls = new Map<string, HTMLElement>();
  private actionBtnEls = new Map<string, HTMLButtonElement>();

  constructor(deps: PassiveAPIDeps) {
    this.deps = deps;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.renderInto(parent);
  }

  private unmount(): void {
    this.root = null;
  }

  update(_state: GameState): void {
    if (!this.root) return;
    const wave = this.deps.highestWave;
    const gold = _state.resources.gold;

    for (const def of PASSIVE_ABILITIES) {
      const root = this.passiveRoots.get(def.id);
      const levelEl = this.levelEls.get(def.id);
      const descEl = this.descEls.get(def.id);
      const xpBar = this.xpBarEls.get(def.id);
      const xpFill = this.xpBarFillEls.get(def.id);
      const xpText = this.xpTextEls.get(def.id);
      const actionBtn = this.actionBtnEls.get(def.id);
      if (!root || !levelEl || !descEl || !xpBar || !xpFill || !xpText || !actionBtn) continue;

      const waveReached = wave >= def.unlockWave;
      const unlocked = waveReached && this.deps.isUnlocked(def.id);
      const level = unlocked ? this.deps.getLevel(def.id) : 0;
      const xp = unlocked ? this.deps.getXp(def.id) : 0;
      const atMax = level >= def.maxLevel;

      setText(levelEl, atMax ? ` Lv.${level} (MAX)` : ` Lv.${level}`);

      if (!waveReached) {
        toggleClass(root, 'passive-locked', true);
        setText(descEl, `Unlocks at wave ${def.unlockWave}`);
        setDisplay(xpBar, 'none');
        setDisplay(xpText, 'none');
        setDisplay(actionBtn, 'none');
      } else if (!unlocked) {
        toggleClass(root, 'passive-locked', false);
        setText(descEl, `Unlocks at wave ${def.unlockWave}`);
        setDisplay(xpBar, 'none');
        setDisplay(xpText, 'none');
        setDisplay(actionBtn, 'inline-flex');
        const cost = this.deps.getUnlockCost(def.id);
        const canAfford = gold >= cost;
        setText(actionBtn, `Unlock \u00B7 ${Math.floor(cost)}g`);
        setDisabled(actionBtn, !canAfford);
        toggleClass(actionBtn, 'can-afford', canAfford);
        toggleClass(actionBtn, 'cannot-afford', !canAfford);
      } else if (atMax) {
        toggleClass(root, 'passive-locked', false);
        setText(descEl, def.description.replace('{value}', passiveEffectValue(def, level).toFixed(1)));
        setDisplay(xpBar, 'block');
        setStyle(xpFill, 'width', '100%');
        setDisplay(xpText, 'block');
        setText(xpText, 'MAX');
        setDisplay(actionBtn, 'none');
      } else {
        toggleClass(root, 'passive-locked', false);
        setText(descEl, def.description.replace('{value}', passiveEffectValue(def, level).toFixed(1)));
        const needed = passiveXpForLevel(level + 1);
        const pct = needed > 0 ? Math.min(100, (xp / needed) * 100) : 0;
        setDisplay(xpBar, 'block');
        setStyle(xpFill, 'width', `${pct}%`);
        setDisplay(xpText, 'block');
        setText(xpText, `${Math.floor(xp)} / ${needed} XP`);
        const cost = this.deps.getUpgradeCost(def.id);
        const canAfford = gold >= cost;
        setDisplay(actionBtn, cost > 0 ? 'inline-flex' : 'none');
        if (cost > 0) {
          setText(actionBtn, `Upgrade \u00B7 ${Math.floor(cost)}g`);
          setDisabled(actionBtn, !canAfford);
          toggleClass(actionBtn, 'can-afford', canAfford);
          toggleClass(actionBtn, 'cannot-afford', !canAfford);
        }
      }
    }
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'passive-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Passive Abilities';
    parent.appendChild(title);

    const note = document.createElement('p');
    note.className = 'panel-note';
    note.textContent = 'Passives gain XP from kills and wave clears. They auto-level when enough XP is accumulated. Reset on Ascension/Transcendence.';
    parent.appendChild(note);

    const list = document.createElement('div');
    list.className = 'passive-list';
    for (const def of PASSIVE_ABILITIES) {
      list.appendChild(this.renderPassiveRow(def));
    }
    parent.appendChild(list);
  }

  private renderPassiveRow(def: typeof PASSIVE_ABILITIES[number]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'passive-row passive-locked';
    this.passiveRoots.set(def.id, row);

    const icon = document.createElement('div');
    icon.className = 'passive-icon';
    setStyle(icon, '--passive-color', def.color);
    const iconInner = document.createElement('span');
    iconInner.className = 'passive-icon-inner';
    iconInner.textContent = def.glyph;
    icon.appendChild(iconInner);
    row.appendChild(icon);

    const info = document.createElement('div');
    info.className = 'passive-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'passive-name-row';
    const name = document.createElement('span');
    name.className = 'passive-name';
    name.textContent = def.name;
    nameRow.appendChild(name);

    const levelEl = document.createElement('span');
    levelEl.className = 'passive-level';
    levelEl.textContent = 'Lv.0';
    this.levelEls.set(def.id, levelEl);
    nameRow.appendChild(levelEl);
    info.appendChild(nameRow);

    const descEl = document.createElement('div');
    descEl.className = 'passive-desc';
    descEl.textContent = def.description.replace('{value}', passiveEffectValue(def, 0).toFixed(1));
    this.descEls.set(def.id, descEl);
    info.appendChild(descEl);

    const xpRow = document.createElement('div');
    xpRow.className = 'passive-xp-row';

    const xpBar = document.createElement('div');
    xpBar.className = 'passive-xp-bar';
    this.xpBarEls.set(def.id, xpBar);
    const xpFill = document.createElement('div');
    xpFill.className = 'passive-xp-fill';
    this.xpBarFillEls.set(def.id, xpFill);
    xpBar.appendChild(xpFill);
    xpRow.appendChild(xpBar);

    const xpText = document.createElement('div');
    xpText.className = 'passive-xp-text';
    xpText.textContent = '';
    this.xpTextEls.set(def.id, xpText);
    xpRow.appendChild(xpText);

    info.appendChild(xpRow);

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'passive-action-btn';
    actionBtn.style.display = 'none';
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.deps.isUnlocked(def.id)) {
        this.deps.onUpgrade(def.id);
      } else if (this.deps.canUnlock(def.id)) {
        this.deps.onUnlock(def.id);
      }
    });
    this.actionBtnEls.set(def.id, actionBtn);
    info.appendChild(actionBtn);

    row.appendChild(info);
    return row;
  }
}
