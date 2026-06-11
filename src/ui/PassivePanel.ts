import type { GameState } from '../types';
import { PASSIVE_ABILITIES, passiveEffectValue } from '../data/passiveAbilities';
import { passiveXpForLevel } from '../data/xpTables';
import { setText, toggleClass, setStyle } from '../utils/dom';

export interface PassiveAPIDeps {
  getLevel: (id: string) => number;
  getXp: (id: string) => number;
  highestWave: number;
}

export class PassivePanel {
  private readonly deps: PassiveAPIDeps;
  private root: HTMLElement | null = null;
  private passiveRoots = new Map<string, HTMLElement>();
  private levelEls = new Map<string, HTMLElement>();
  private valueEls = new Map<string, HTMLElement>();
  private xpBarFillEls = new Map<string, HTMLElement>();
  private xpTextEls = new Map<string, HTMLElement>();
  private statusEls = new Map<string, HTMLElement>();

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

    for (const def of PASSIVE_ABILITIES) {
      const root = this.passiveRoots.get(def.id);
      const levelEl = this.levelEls.get(def.id);
      const valueEl = this.valueEls.get(def.id);
      const xpFill = this.xpBarFillEls.get(def.id);
      const xpText = this.xpTextEls.get(def.id);
      const statusEl = this.statusEls.get(def.id);
      if (!root || !levelEl || !valueEl || !xpFill || !xpText || !statusEl) continue;

      const unlocked = wave >= def.unlockWave;
      const level = unlocked ? this.deps.getLevel(def.id) : 0;
      const xp = unlocked ? this.deps.getXp(def.id) : 0;
      const atMax = level >= def.maxLevel;

      setText(levelEl, atMax ? ` Lv.${level} (MAX)` : ` Lv.${level}`);
      setText(valueEl, `${passiveEffectValue(def, level).toFixed(1)}%`);

      if (!unlocked) {
        toggleClass(root, 'passive-locked', true);
        setText(statusEl, ` Unlocks at wave ${def.unlockWave}`);
        setStyle(xpFill, 'width', '0%');
        setText(xpText, '');
      } else if (atMax) {
        toggleClass(root, 'passive-locked', false);
        setText(statusEl, ' Max level');
        setStyle(xpFill, 'width', '100%');
        setText(xpText, 'MAX');
      } else {
        toggleClass(root, 'passive-locked', false);
        const needed = passiveXpForLevel(level + 1);
        const pct = needed > 0 ? Math.min(100, (xp / needed) * 100) : 0;
        setStyle(xpFill, 'width', `${pct}%`);
        setText(xpText, `${Math.floor(xp)} / ${needed} XP`);
        setText(statusEl, '');
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
    icon.textContent = def.glyph;
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

    const valueEl = document.createElement('span');
    valueEl.className = 'passive-value';
    valueEl.textContent = '0.0%';
    this.valueEls.set(def.id, valueEl);
    info.appendChild(valueEl);

    const statusEl = document.createElement('span');
    statusEl.className = 'passive-status';
    statusEl.textContent = `Unlocks at wave ${def.unlockWave}`;
    this.statusEls.set(def.id, statusEl);
    info.appendChild(statusEl);

    const xpBar = document.createElement('div');
    xpBar.className = 'passive-xp-bar';
    const xpFill = document.createElement('div');
    xpFill.className = 'passive-xp-fill';
    this.xpBarFillEls.set(def.id, xpFill);
    xpBar.appendChild(xpFill);
    info.appendChild(xpBar);

    const xpText = document.createElement('div');
    xpText.className = 'passive-xp-text';
    xpText.textContent = '';
    this.xpTextEls.set(def.id, xpText);
    info.appendChild(xpText);

    row.appendChild(info);
    return row;
  }
}
