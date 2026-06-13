import type { AbilityId, GameState } from '../types';
import { ABILITIES, ABILITY_BY_ID, computeEffectiveStats, type AbilityDef } from '../data/abilities';
import { PASSIVE_ABILITIES, passiveEffectValue } from '../data/passiveAbilities';
import { passiveXpForLevel, abilityXpForLevel } from '../data/xpTables';
import { formatInt } from '../utils/bigNumber';
import { setAriaLabel, setDisabled, setInnerHTML, setStyle, setText, toggleClass, setDisplay } from '../utils/dom';
import { renderAbilityTooltip } from './abilityFormat';
import type { PassiveAPIDeps } from './PassivePanel';

export interface AbilityPanelHandlers {
  onCast: (id: AbilityId) => void;
  onUpgrade: (id: AbilityId) => void;
  canCast: (id: AbilityId, wave: number) => boolean;
  reasonBlocked: (id: AbilityId, wave: number) => string | null;
  canUpgrade: (id: AbilityId, wave: number) => boolean;
  isMaxed: (id: AbilityId) => boolean;
  getUpgradeCost: (id: AbilityId) => number;
  getEffectiveStats: (id: AbilityId) => ReturnType<typeof computeEffectiveStats>;
  getXp: (id: AbilityId) => number;
}

type SubTab = 'active' | 'passives';

export class AbilityPanel {
  private readonly handlers: AbilityPanelHandlers;
  private passiveDeps: PassiveAPIDeps;
  private root: HTMLElement | null = null;
  private subTab: SubTab = 'active';
  private activeContentRoot: HTMLElement | null = null;
  private passiveContentRoot: HTMLElement | null = null;
  private subTabActiveBtn: HTMLButtonElement | null = null;
  private subTabPassiveBtn: HTMLButtonElement | null = null;

  // Active ability maps
  private cardsById = new Map<AbilityId, HTMLElement>();
  private buttonsById = new Map<AbilityId, HTMLButtonElement>();
  private overlayById = new Map<AbilityId, HTMLElement>();
  private activeBadgeById = new Map<AbilityId, HTMLElement>();
  private labelById = new Map<AbilityId, HTMLElement>();
  private statusById = new Map<AbilityId, HTMLElement>();
  private descById = new Map<AbilityId, HTMLElement>();
  private levelBadgeById = new Map<AbilityId, HTMLElement>();
  private upgradeBtnById = new Map<AbilityId, HTMLButtonElement>();
  private upgradeTooltipById = new Map<AbilityId, HTMLElement>();
  private xpBarEls = new Map<AbilityId, HTMLElement>();
  private xpBarFillEls = new Map<AbilityId, HTMLElement>();
  private xpTextEls = new Map<AbilityId, HTMLElement>();

  // Passive maps
  private passiveRoots = new Map<string, HTMLElement>();
  private passiveLevelEls = new Map<string, HTMLElement>();
  private passiveDescEls = new Map<string, HTMLElement>();
  private passiveXpBarEls = new Map<string, HTMLElement>();
  private passiveXpBarFillEls = new Map<string, HTMLElement>();
  private passiveXpTextEls = new Map<string, HTMLElement>();
  private passiveActionBtnEls = new Map<string, HTMLButtonElement>();

  constructor(handlers: AbilityPanelHandlers, passiveDeps: PassiveAPIDeps) {
    this.handlers = handlers;
    this.passiveDeps = passiveDeps;
  }

  setPassiveDeps(deps: PassiveAPIDeps): void {
    this.passiveDeps = deps;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.cardsById.clear();
    this.buttonsById.clear();
    this.overlayById.clear();
    this.activeBadgeById.clear();
    this.labelById.clear();
    this.statusById.clear();
    this.descById.clear();
    this.levelBadgeById.clear();
    this.upgradeBtnById.clear();
    this.upgradeTooltipById.clear();
    this.xpBarEls.clear();
    this.xpBarFillEls.clear();
    this.xpTextEls.clear();
    this.passiveRoots.clear();
    this.passiveLevelEls.clear();
    this.passiveDescEls.clear();
    this.passiveXpBarEls.clear();
    this.passiveXpBarFillEls.clear();
    this.passiveXpTextEls.clear();
    this.passiveActionBtnEls.clear();
    this.subTab = 'active';
    this.renderInto(parent);
  }

  update(state: GameState): void {
    if (!this.root) return;
    if (this.subTab === 'active') {
      this.updateActive(state);
    } else {
      this.updatePassive(state);
    }
  }

  private updateActive(state: GameState): void {
    const mana = state.resources.mana;
    for (const def of ABILITIES) {
      const btn = this.buttonsById.get(def.id);
      const overlay = this.overlayById.get(def.id);
      const badge = this.activeBadgeById.get(def.id);
      const status = this.statusById.get(def.id);
      const desc = this.descById.get(def.id);
      const levelBadge = this.levelBadgeById.get(def.id);
      const upgradeBtn = this.upgradeBtnById.get(def.id);
      const manaTag = btn ? btn.querySelector<HTMLElement>('.ability-mana') : null;
      if (!btn || !overlay || !badge || !status || !desc || !levelBadge || !upgradeBtn) continue;
      const abState = state.abilities[def.id];
      const onCd = abState.cooldown > 0;
      const reason = this.handlers.reasonBlocked(def.id, state.wave.highestWave);
      const canCast = reason === null;
      const stats = this.handlers.getEffectiveStats(def.id);
      const isMaxed = this.handlers.isMaxed(def.id);
      const cost = this.handlers.getUpgradeCost(def.id);
      const canAfford = state.resources.gold >= cost;
      const isUnlocked = state.wave.highestWave >= def.unlockWave;

      setDisabled(btn, !canCast);
      toggleClass(btn, 'is-ready', canCast);
      toggleClass(btn, 'is-cooldown', onCd);
      toggleClass(btn, 'is-locked', reason === 'Locked' || (reason?.startsWith('Unlocks at') ?? false));
      toggleClass(btn, 'is-active', abState.active);

      if (manaTag) {
        setText(manaTag, `${stats.manaCost}`);
      }
      setAriaLabel(btn, `${def.name} Lv.${stats.level}, ${stats.manaCost} mana, ${stats.cooldown.toFixed(1)}s cooldown`);

      if (onCd) {
        const ratio = Math.max(0, Math.min(1, abState.cooldown / stats.cooldown));
        setStyle(overlay, 'height', `${ratio * 100}%`);
        setStyle(overlay, 'opacity', '1');
      } else {
        setStyle(overlay, 'height', '0%');
        setStyle(overlay, 'opacity', '0');
      }

      if (abState.active && abState.activeTimer > 0) {
        setDisplay(badge, 'flex');
        setText(badge, `${abState.activeTimer.toFixed(1)}s`);
      } else {
        setDisplay(badge, 'none');
      }

      setText(desc, stats.displayText || def.description);

      if (reason) {
        setText(status, `${reason} · ${formatInt(stats.manaCost)}/${formatInt(mana)} mana`);
        toggleClass(status, 'ability-status-blocked', true);
      } else {
        setText(status, `Ready · ${formatInt(stats.manaCost)}/${formatInt(mana)} mana`);
        toggleClass(status, 'ability-status-blocked', false);
      }

      const label = this.labelById.get(def.id);
      if (label) {
        setText(label, def.name);
      }

      if (isMaxed) {
        setText(levelBadge, 'MAX');
        toggleClass(levelBadge, 'is-maxed', true);
      } else {
        setText(levelBadge, `Lv ${stats.level}`);
        toggleClass(levelBadge, 'is-maxed', false);
      }

      const showUpgrade = isUnlocked && !isMaxed && cost > 0;
      setDisplay(upgradeBtn, showUpgrade ? 'inline-flex' : 'none');
      toggleClass(upgradeBtn, 'is-maxed', isMaxed);
      toggleClass(upgradeBtn, 'can-afford', canAfford);
      toggleClass(upgradeBtn, 'cannot-afford', showUpgrade && !canAfford);
      setDisabled(upgradeBtn, !canAfford);
      setText(upgradeBtn, `Upgrade · ${formatInt(cost)}g`);

      const xpBarEl = this.xpBarEls.get(def.id);
      const xpFillEl = this.xpBarFillEls.get(def.id);
      const xpTextEl = this.xpTextEls.get(def.id);
      if (xpBarEl && xpFillEl && xpTextEl) {
        if (!isUnlocked || isMaxed) {
          setDisplay(xpBarEl.parentElement!, 'none');
        } else {
          const xp = this.handlers.getXp(def.id);
          const needed = abilityXpForLevel(abState.level + 1);
          const ratio = needed > 0 ? Math.min(1, xp / needed) : 0;
          setStyle(xpFillEl, 'width', `${ratio * 100}%`);
          setText(xpTextEl, `${xp}/${needed}`);
          setDisplay(xpBarEl.parentElement!, 'flex');
        }
      }

      const tooltip = this.upgradeTooltipById.get(def.id);
      if (tooltip && tooltip.style.display !== 'none') {
        this.refreshTooltip(def.id, tooltip, def, stats, cost, canAfford, isMaxed);
      }
    }
  }

  private updatePassive(_state: GameState): void {
    const wave = this.passiveDeps.highestWave;
    const gold = _state.resources.gold;
    for (const def of PASSIVE_ABILITIES) {
      const root = this.passiveRoots.get(def.id);
      const levelEl = this.passiveLevelEls.get(def.id);
      const descEl = this.passiveDescEls.get(def.id);
      const xpBar = this.passiveXpBarEls.get(def.id);
      const xpFill = this.passiveXpBarFillEls.get(def.id);
      const xpText = this.passiveXpTextEls.get(def.id);
      const actionBtn = this.passiveActionBtnEls.get(def.id);
      if (!root || !levelEl || !descEl || !xpBar || !xpFill || !xpText || !actionBtn) continue;

      const waveReached = wave >= def.unlockWave;
      const unlocked = this.passiveDeps.isUnlocked(def.id);
      const level = unlocked ? this.passiveDeps.getLevel(def.id) : 0;
      const xp = unlocked ? this.passiveDeps.getXp(def.id) : 0;
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
        const cost = this.passiveDeps.getUnlockCost(def.id);
        const canAfford = gold >= cost;
        setText(descEl, `Unlocks at wave ${def.unlockWave}`);
        setDisplay(xpBar, 'none');
        setDisplay(xpText, 'none');
        setDisplay(actionBtn, 'inline-flex');
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
        const cost = this.passiveDeps.getUpgradeCost(def.id);
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

  flashCast(id: AbilityId): void {
    const btn = this.buttonsById.get(id);
    if (!btn) return;
    btn.classList.add('is-flash');
    setTimeout(() => btn.classList.remove('is-flash'), 220);
  }

  flashUpgrade(id: AbilityId): void {
    const card = this.cardsById.get(id);
    if (!card) return;
    card.classList.add('is-upgrade-flash');
    setTimeout(() => card.classList.remove('is-upgrade-flash'), 320);
  }

  private unmount(): void {
    this.root = null;
  }

  private switchSubTab(tab: SubTab): void {
    this.subTab = tab;
    if (this.subTabActiveBtn) toggleClass(this.subTabActiveBtn, 'active', tab === 'active');
    if (this.subTabPassiveBtn) toggleClass(this.subTabPassiveBtn, 'active', tab === 'passives');
    if (this.activeContentRoot) setDisplay(this.activeContentRoot, tab === 'active' ? '' : 'none');
    if (this.passiveContentRoot) setDisplay(this.passiveContentRoot, tab === 'passives' ? '' : 'none');
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'ability-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Abilities';
    parent.appendChild(title);

    const subTabBar = document.createElement('div');
    subTabBar.className = 'ability-sub-tabs';

    this.subTabActiveBtn = document.createElement('button');
    this.subTabActiveBtn.className = 'ability-sub-tab-btn active';
    this.subTabActiveBtn.textContent = 'Active';
    this.subTabActiveBtn.addEventListener('click', () => this.switchSubTab('active'));
    subTabBar.appendChild(this.subTabActiveBtn);

    this.subTabPassiveBtn = document.createElement('button');
    this.subTabPassiveBtn.className = 'ability-sub-tab-btn';
    this.subTabPassiveBtn.textContent = 'Passives';
    this.subTabPassiveBtn.addEventListener('click', () => this.switchSubTab('passives'));
    subTabBar.appendChild(this.subTabPassiveBtn);

    parent.appendChild(subTabBar);

    this.activeContentRoot = document.createElement('div');
    this.activeContentRoot.className = 'ability-active-content';
    this.renderActiveInto(this.activeContentRoot);
    parent.appendChild(this.activeContentRoot);

    this.passiveContentRoot = document.createElement('div');
    this.passiveContentRoot.className = 'ability-passive-content';
    this.passiveContentRoot.style.display = 'none';
    this.renderPassiveInto(this.passiveContentRoot);
    parent.appendChild(this.passiveContentRoot);
  }

  private renderActiveInto(parent: HTMLElement): void {
    const intro = document.createElement('p');
    intro.className = 'panel-note';
    intro.textContent = 'Active abilities. Spend mana to cast, then wait for the cooldown. Hover the Upgrade button to compare stats.';
    parent.appendChild(intro);

    const grid = document.createElement('div');
    grid.className = 'ability-grid';
    for (const def of ABILITIES) {
      grid.appendChild(this.renderCard(def));
    }
    parent.appendChild(grid);

    const footer = document.createElement('p');
    footer.className = 'panel-note';
    footer.textContent = 'Each ability unlocks at a different wave and can be upgraded up to 10 times from this panel.';
    parent.appendChild(footer);
  }

  private renderPassiveInto(parent: HTMLElement): void {
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

  private renderCard(def: AbilityDef): HTMLElement {
    const card = document.createElement('div');
    card.className = 'ability-card';
    card.dataset.abilityId = def.id;
    card.style.position = 'relative';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ability-btn';
    btn.style.setProperty('--ability-color', def.color);
    btn.addEventListener('click', () => this.handlers.onCast(def.id));
    btn.setAttribute('aria-label', `${def.name}, ability`);

    const overlay = document.createElement('div');
    overlay.className = 'ability-cooldown-overlay';
    btn.appendChild(overlay);

    const icon = document.createElement('div');
    icon.className = 'ability-icon';
    icon.textContent = def.glyph;
    btn.appendChild(icon);

    const hotkey = document.createElement('div');
    hotkey.className = 'ability-hotkey';
    hotkey.textContent = def.hotkey;
    btn.appendChild(hotkey);

    const badge = document.createElement('div');
    badge.className = 'ability-active-badge';
    badge.style.display = 'none';
    btn.appendChild(badge);

    const mana = document.createElement('div');
    mana.className = 'ability-mana';
    mana.textContent = `${def.manaCost}`;
    btn.appendChild(mana);

    card.appendChild(btn);

    const info = document.createElement('div');
    info.className = 'ability-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'ability-name-row';
    const label = document.createElement('span');
    label.className = 'ability-name';
    label.textContent = def.name;
    const levelBadge = document.createElement('span');
    levelBadge.className = 'ability-level-badge';
    levelBadge.textContent = 'Lv 1';
    nameRow.appendChild(label);
    nameRow.appendChild(levelBadge);
    info.appendChild(nameRow);

    const desc = document.createElement('div');
    desc.className = 'ability-desc';
    desc.textContent = def.description;
    info.appendChild(desc);

    const status = document.createElement('div');
    status.className = 'ability-status';
    status.textContent = 'Ready';
    info.appendChild(status);

    const xpRow = document.createElement('div');
    xpRow.className = 'passive-xp-row';
    const xpBar = document.createElement('div');
    xpBar.className = 'passive-xp-bar';
    this.xpBarEls.set(def.id, xpBar);
    const xpFill = document.createElement('div');
    xpFill.className = 'passive-xp-fill';
    xpFill.style.background = def.color;
    this.xpBarFillEls.set(def.id, xpFill);
    xpBar.appendChild(xpFill);
    xpRow.appendChild(xpBar);
    const xpText = document.createElement('div');
    xpText.className = 'passive-xp-text';
    this.xpTextEls.set(def.id, xpText);
    xpRow.appendChild(xpText);
    info.appendChild(xpRow);

    const upgradeBtn = document.createElement('button');
    upgradeBtn.type = 'button';
    upgradeBtn.className = 'ability-upgrade-btn';
    upgradeBtn.style.display = 'none';
    upgradeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onUpgrade(def.id);
    });
    upgradeBtn.addEventListener('mouseenter', () => this.showTooltip(def.id));
    upgradeBtn.addEventListener('mouseleave', () => this.hideTooltip(def.id));
    upgradeBtn.addEventListener('focus', () => this.showTooltip(def.id));
    upgradeBtn.addEventListener('blur', () => this.hideTooltip(def.id));
    info.appendChild(upgradeBtn);

    card.appendChild(info);

    const tooltip = document.createElement('div');
    tooltip.className = 'ability-upgrade-tooltip';
    tooltip.style.display = 'none';
    card.appendChild(tooltip);

    this.cardsById.set(def.id, card);
    this.buttonsById.set(def.id, btn);
    this.overlayById.set(def.id, overlay);
    this.activeBadgeById.set(def.id, badge);
    this.labelById.set(def.id, label);
    this.statusById.set(def.id, status);
    this.descById.set(def.id, desc);
    this.levelBadgeById.set(def.id, levelBadge);
    this.upgradeBtnById.set(def.id, upgradeBtn);
    this.upgradeTooltipById.set(def.id, tooltip);
    return card;
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
    this.passiveLevelEls.set(def.id, levelEl);
    nameRow.appendChild(levelEl);
    info.appendChild(nameRow);

    const descEl = document.createElement('div');
    descEl.className = 'passive-desc';
    descEl.textContent = def.description.replace('{value}', passiveEffectValue(def, 0).toFixed(1));
    this.passiveDescEls.set(def.id, descEl);
    info.appendChild(descEl);

    const xpRow = document.createElement('div');
    xpRow.className = 'passive-xp-row';

    const xpBar = document.createElement('div');
    xpBar.className = 'passive-xp-bar';
    this.passiveXpBarEls.set(def.id, xpBar);
    const xpFill = document.createElement('div');
    xpFill.className = 'passive-xp-fill';
    this.passiveXpBarFillEls.set(def.id, xpFill);
    xpBar.appendChild(xpFill);
    xpRow.appendChild(xpBar);

    const xpText = document.createElement('div');
    xpText.className = 'passive-xp-text';
    xpText.textContent = '';
    this.passiveXpTextEls.set(def.id, xpText);
    xpRow.appendChild(xpText);

    info.appendChild(xpRow);

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'passive-action-btn';
    actionBtn.style.display = 'none';
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const s = this.passiveDeps;
      if (s.isUnlocked(def.id)) {
        s.onUpgrade(def.id);
      } else if (s.canUnlock(def.id)) {
        s.onUnlock(def.id);
      }
    });
    this.passiveActionBtnEls.set(def.id, actionBtn);
    info.appendChild(actionBtn);

    row.appendChild(info);
    return row;
  }

  private showTooltip(id: AbilityId): void {
    const tooltip = this.upgradeTooltipById.get(id);
    const upgradeBtn = this.upgradeBtnById.get(id);
    const def = ABILITY_BY_ID[id];
    if (!tooltip || !upgradeBtn || !def) return;
    const stats = this.handlers.getEffectiveStats(id);
    if (stats.isMaxed) {
      this.hideTooltip(id);
      return;
    }
    const cost = this.handlers.getUpgradeCost(id);
    this.refreshTooltip(id, tooltip, def, stats, cost, true, false);
    setDisplay(tooltip, 'block');
    this.positionTooltip(id);
  }

  private hideTooltip(id: AbilityId): void {
    const tooltip = this.upgradeTooltipById.get(id);
    if (tooltip) setDisplay(tooltip, 'none');
  }

  private positionTooltip(id: AbilityId): void {
    const tooltip = this.upgradeTooltipById.get(id);
    const upgradeBtn = this.upgradeBtnById.get(id);
    if (!tooltip || !upgradeBtn) return;
    const btnRect = upgradeBtn.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    const desiredRight = window.innerWidth - btnRect.left + gap;
    const desiredBottom = window.innerHeight - btnRect.bottom;
    const maxRight = window.innerWidth - tipRect.width - margin;
    const right = Math.max(margin, Math.min(maxRight, desiredRight));
    const top = Math.max(margin, btnRect.bottom - tipRect.height);
    setStyle(tooltip, 'right', `${right}px`);
    setStyle(tooltip, 'bottom', `${desiredBottom}px`);
    setStyle(tooltip, 'top', `${top}px`);
    setStyle(tooltip, 'left', 'auto');
  }

  private refreshTooltip(
    _id: AbilityId,
    el: HTMLElement,
    def: AbilityDef,
    currentStats: ReturnType<typeof computeEffectiveStats>,
    cost: number,
    canAfford: boolean,
    _isMaxed: boolean,
  ): void {
    setInnerHTML(el, renderAbilityTooltip(def, currentStats, cost, canAfford, true, true));
  }
}
