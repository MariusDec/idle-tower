import type { GameState } from '../types';
import {
  PASSIVE_ABILITIES,
  PASSIVE_FAMILIES,
  PASSIVE_MAX_LEVEL,
  PASSIVE_MILESTONE_LEVELS,
  describePassiveEffects,
  nextPassiveMilestone,
  type PassiveAbilityDef,
} from '../data/passiveAbilities';
import { formatInt } from '../utils/bigNumber';
import { setText, toggleClass, setStyle, setDisplay, setDisabled, setAriaLabel } from '../utils/dom';
import { renderIcon } from './Icon';

export interface PassiveAPIDeps {
  getLevel: (id: string) => number;
  getXp: (id: string) => number;
  getXpForNextLevel: (id: string) => number;
  /** Lifetime highest wave. A getter — the old snapshot never updated. */
  highestWave: () => number;
  unlockedCount: () => number;
  totalLevels: () => number;
  isUnlocked: (id: string) => boolean;
  isMaxed: (id: string) => boolean;
  canUnlock: (id: string) => boolean;
  getUnlockCost: (id: string) => number;
  onUnlock: (id: string) => void;
  getFullUpgradeCost: (id: string) => number;
  getUpgradeCost: (id: string) => number;
  getXpDiscount: (id: string) => number;
  canUpgrade: (id: string) => boolean;
  onUpgrade: (id: string) => void;
}

export class PassivePanel {
  private deps: PassiveAPIDeps;
  private root: HTMLElement | null = null;
  private headerCountEl: HTMLElement | null = null;
  private headerLevelsEl: HTMLElement | null = null;
  private cardEls = new Map<string, HTMLElement>();
  private levelEls = new Map<string, HTMLElement>();
  private effectEls = new Map<string, HTMLElement>();
  private xpFillEls = new Map<string, HTMLElement>();
  private xpTextEls = new Map<string, HTMLElement>();
  private xpRowEls = new Map<string, HTMLElement>();
  private milestoneRowEls = new Map<string, HTMLElement>();
  private pipEls = new Map<string, HTMLElement[]>();
  private nextEls = new Map<string, HTMLElement>();
  private actionRowEls = new Map<string, HTMLElement>();
  private actionBtnEls = new Map<string, HTMLButtonElement>();
  private discountEls = new Map<string, HTMLElement>();
  private lastEffectLevel = new Map<string, number>();
  private lastUnlocked = new Map<string, boolean>();

  constructor(deps: PassiveAPIDeps) {
    this.deps = deps;
  }

  setDeps(deps: PassiveAPIDeps): void {
    this.deps = deps;
  }

  mount(parent: HTMLElement): void {
    this.cardEls.clear();
    this.levelEls.clear();
    this.effectEls.clear();
    this.xpFillEls.clear();
    this.xpTextEls.clear();
    this.xpRowEls.clear();
    this.milestoneRowEls.clear();
    this.pipEls.clear();
    this.nextEls.clear();
    this.actionRowEls.clear();
    this.actionBtnEls.clear();
    this.discountEls.clear();
    this.lastEffectLevel.clear();
    this.lastUnlocked.clear();

    parent.innerHTML = '';
    parent.className = 'passive-panel';
    this.root = parent;

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Passive Abilities';
    parent.appendChild(title);

    const note = document.createElement('p');
    note.className = 'panel-note';
    note.textContent = 'Passives are permanent. XP from kills and wave clears fills the bar and levels them for free; gold buys whatever the bar has not filled yet, at a matching discount. Every fifth level grants a milestone rank. Passives survive Ascension and are reset by Transcendence.';
    parent.appendChild(note);

    // Summary row
    const summary = document.createElement('div');
    summary.className = 'passive-summary';
    const countBox = document.createElement('div');
    countBox.className = 'passive-summary-stat';
    this.headerCountEl = document.createElement('b');
    this.headerCountEl.textContent = `0 / ${PASSIVE_ABILITIES.length}`;
    countBox.appendChild(this.headerCountEl);
    const countLabel = document.createElement('span');
    countLabel.textContent = 'Unlocked';
    countBox.appendChild(countLabel);
    summary.appendChild(countBox);
    const levelsBox = document.createElement('div');
    levelsBox.className = 'passive-summary-stat';
    this.headerLevelsEl = document.createElement('b');
    this.headerLevelsEl.textContent = `0 / ${PASSIVE_ABILITIES.length * PASSIVE_MAX_LEVEL}`;
    levelsBox.appendChild(this.headerLevelsEl);
    const levelsLabel = document.createElement('span');
    levelsLabel.textContent = 'Total levels';
    levelsBox.appendChild(levelsLabel);
    summary.appendChild(levelsBox);
    parent.appendChild(summary);

    // Family groups
    for (const family of PASSIVE_FAMILIES) {
      const familyEl = document.createElement('div');
      familyEl.className = 'passive-family';
      familyEl.style.setProperty('--family-color', family.color);

      const head = document.createElement('div');
      head.className = 'passive-family-head';
      const dot = document.createElement('span');
      dot.className = 'passive-family-dot';
      head.appendChild(dot);
      head.appendChild(document.createTextNode(family.label));
      familyEl.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'passive-grid';

      const defs = PASSIVE_ABILITIES.filter(p => p.family === family.id);
      for (const def of defs) {
        grid.appendChild(this.renderCard(def));
      }

      familyEl.appendChild(grid);
      parent.appendChild(familyEl);
    }
  }

  private renderCard(def: PassiveAbilityDef): HTMLElement {
    const card = document.createElement('div');
    card.className = 'passive-card';
    card.style.setProperty('--passive-color', def.color);
    this.cardEls.set(def.id, card);

    // Head
    const head = document.createElement('div');
    head.className = 'passive-card-head';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'passive-icon';
    const iconInner = document.createElement('span');
    iconInner.className = 'passive-icon-inner';
    renderIcon(iconInner, def.icon, { size: 28 });
    iconWrap.appendChild(iconInner);
    head.appendChild(iconWrap);

    const titleWrap = document.createElement('div');
    titleWrap.className = 'passive-title';
    const nameRow = document.createElement('div');
    nameRow.className = 'passive-name-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'passive-name';
    nameEl.textContent = def.name;
    nameRow.appendChild(nameEl);
    const levelEl = document.createElement('span');
    levelEl.className = 'passive-level';
    levelEl.textContent = '—';
    this.levelEls.set(def.id, levelEl);
    nameRow.appendChild(levelEl);
    titleWrap.appendChild(nameRow);
    const tagline = document.createElement('div');
    tagline.className = 'passive-tagline';
    tagline.textContent = def.tagline;
    titleWrap.appendChild(tagline);
    head.appendChild(titleWrap);
    card.appendChild(head);

    // Effects list
    const effectsEl = document.createElement('ul');
    effectsEl.className = 'passive-effects';
    this.effectEls.set(def.id, effectsEl);
    card.appendChild(effectsEl);

    // XP track
    const track = document.createElement('div');
    track.className = 'passive-track';
    this.xpRowEls.set(def.id, track);
    const bar = document.createElement('div');
    bar.className = 'passive-xp-bar';
    const fill = document.createElement('div');
    fill.className = 'passive-xp-fill';
    bar.appendChild(fill);
    this.xpFillEls.set(def.id, fill);
    track.appendChild(bar);
    const xpText = document.createElement('div');
    xpText.className = 'passive-xp-text';
    this.xpTextEls.set(def.id, xpText);
    track.appendChild(xpText);
    card.appendChild(track);

    // Milestone pips
    const milestones = document.createElement('div');
    milestones.className = 'passive-milestones';
    this.milestoneRowEls.set(def.id, milestones);
    const pips: HTMLElement[] = [];
    for (const m of def.milestones) {
      const pip = document.createElement('span');
      pip.className = 'passive-pip';
      pip.dataset.at = String(m.at);
      pip.title = m.label;
      setAriaLabel(pip, `Level ${m.at}: ${m.label}`);
      milestones.appendChild(pip);
      pips.push(pip);
    }
    this.pipEls.set(def.id, pips);
    card.appendChild(milestones);

    // Next milestone
    const nextEl = document.createElement('div');
    nextEl.className = 'passive-next';
    this.nextEls.set(def.id, nextEl);
    card.appendChild(nextEl);

    // Action row
    const actionRow = document.createElement('div');
    actionRow.className = 'passive-action';
    this.actionRowEls.set(def.id, actionRow);
    const btn = document.createElement('button');
    btn.className = 'passive-action-btn';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.deps.isUnlocked(def.id)) this.deps.onUpgrade(def.id);
      else if (this.deps.canUnlock(def.id)) this.deps.onUnlock(def.id);
    });
    actionRow.appendChild(btn);
    this.actionBtnEls.set(def.id, btn);
    const discountEl = document.createElement('span');
    discountEl.className = 'passive-discount';
    this.discountEls.set(def.id, discountEl);
    actionRow.appendChild(discountEl);
    card.appendChild(actionRow);

    return card;
  }

  update(state: GameState): void {
    if (!this.root) return;
    const wave = this.deps.highestWave();
    const gold = state.resources.gold;
    if (this.headerCountEl) setText(this.headerCountEl, `${this.deps.unlockedCount()} / ${PASSIVE_ABILITIES.length}`);
    if (this.headerLevelsEl) setText(this.headerLevelsEl, `${this.deps.totalLevels()} / ${PASSIVE_ABILITIES.length * PASSIVE_MAX_LEVEL}`);

    for (const def of PASSIVE_ABILITIES) {
      const card = this.cardEls.get(def.id);
      const levelEl = this.levelEls.get(def.id);
      const effectsEl = this.effectEls.get(def.id);
      const xpFill = this.xpFillEls.get(def.id);
      const xpText = this.xpTextEls.get(def.id);
      const trackEl = this.xpRowEls.get(def.id);
      const pips = this.pipEls.get(def.id);
      const nextEl = this.nextEls.get(def.id);
      const btn = this.actionBtnEls.get(def.id);
      const discountEl = this.discountEls.get(def.id);
      const actionRow = this.actionRowEls.get(def.id);
      if (!card || !levelEl || !effectsEl || !xpFill || !xpText || !trackEl || !pips || !nextEl || !btn || !discountEl || !actionRow) continue;

      const gated = wave < def.unlockWave;
      const unlocked = this.deps.isUnlocked(def.id);
      const level = unlocked ? this.deps.getLevel(def.id) : 0;
      const maxed = level >= PASSIVE_MAX_LEVEL;

      toggleClass(card, 'is-gated', gated);
      toggleClass(card, 'is-locked', !unlocked && !gated);
      toggleClass(card, 'is-owned', unlocked);
      toggleClass(card, 'is-maxed', maxed);

      setText(levelEl, unlocked ? (maxed ? `Lv.${level} MAX` : `Lv.${level}`) : '—');

      // Effect lines — rebuilt only when level changed
      if (this.lastEffectLevel.get(def.id) !== level || this.lastUnlocked.get(def.id) !== unlocked) {
        this.lastEffectLevel.set(def.id, level);
        this.lastUnlocked.set(def.id, unlocked);
        effectsEl.innerHTML = '';
        const lines = unlocked ? describePassiveEffects(def, level) : describePassiveEffects(def, 0);
        for (const line of lines) {
          const li = document.createElement('li');
          li.textContent = line;
          effectsEl.appendChild(li);
        }
        toggleClass(effectsEl, 'is-preview', !unlocked);
      }

      // Milestone pips
      for (let i = 0; i < PASSIVE_MILESTONE_LEVELS.length; i++) {
        toggleClass(pips[i], 'is-earned', unlocked && level >= PASSIVE_MILESTONE_LEVELS[i]);
      }

      // XP track
      if (!unlocked || maxed) {
        setDisplay(trackEl, 'none');
        setText(nextEl, maxed ? 'Fully mastered.' : `Unlocks at wave ${def.unlockWave}`);
      } else {
        setDisplay(trackEl, 'flex');
        const xp = this.deps.getXp(def.id);
        const needed = this.deps.getXpForNextLevel(def.id);
        const pct = needed > 0 ? Math.min(100, (xp / needed) * 100) : 0;
        setStyle(xpFill, 'width', `${pct.toFixed(1)}%`);
        setText(xpText, `${formatInt(xp)} / ${formatInt(needed)} XP`);
        const next = nextPassiveMilestone(def, level);
        setText(nextEl, next ? `Lv.${next.at}: ${next.label}` : 'All ranks earned.');
      }

      // Action row
      if (gated) {
        setDisplay(actionRow, 'none');
      } else if (!unlocked) {
        setDisplay(actionRow, 'flex');
        const cost = this.deps.getUnlockCost(def.id);
        const afford = gold >= cost;
        setText(btn, `Unlock · ${formatInt(cost)}g`);
        setDisabled(btn, !afford);
        toggleClass(btn, 'can-afford', afford);
        toggleClass(btn, 'cannot-afford', !afford);
        setText(discountEl, '');
      } else if (maxed) {
        setDisplay(actionRow, 'none');
      } else {
        setDisplay(actionRow, 'flex');
        const cost = this.deps.getUpgradeCost(def.id);
        const full = this.deps.getFullUpgradeCost(def.id);
        const afford = gold >= cost;
        setText(btn, `Upgrade · ${formatInt(cost)}g`);
        setDisabled(btn, !afford);
        toggleClass(btn, 'can-afford', afford);
        toggleClass(btn, 'cannot-afford', !afford);
        const saved = full > 0 ? Math.round((1 - cost / full) * 100) : 0;
        setText(discountEl, saved > 0 ? `−${saved}% from banked XP` : '');
      }
    }
  }

  flashLevelUp(id: string): void {
    const card = this.cardEls.get(id);
    if (!card) return;
    card.classList.remove('is-levelup');
    void card.offsetWidth;          // restart the animation
    card.classList.add('is-levelup');
    setTimeout(() => card.classList.remove('is-levelup'), 620);
  }
}
