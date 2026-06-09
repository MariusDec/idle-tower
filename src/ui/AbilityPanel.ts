import type { AbilityId, GameState } from '../types';
import { ABILITIES, ABILITY_BY_ID, computeEffectiveStats, type AbilityDef } from '../data/abilities';
import { formatInt } from '../utils/bigNumber';
import { setAriaLabel, setDisabled, setInnerHTML, setStyle, setText, toggleClass, setDisplay } from '../utils/dom';
import { renderAbilityTooltip } from './abilityFormat';

export interface AbilityPanelHandlers {
  onCast: (id: AbilityId) => void;
  onUpgrade: (id: AbilityId) => void;
  canCast: (id: AbilityId, wave: number) => boolean;
  reasonBlocked: (id: AbilityId, wave: number) => string | null;
  canUpgrade: (id: AbilityId, wave: number) => boolean;
  isMaxed: (id: AbilityId) => boolean;
  getUpgradeCost: (id: AbilityId) => number;
  getEffectiveStats: (id: AbilityId) => ReturnType<typeof computeEffectiveStats>;
}

export class AbilityPanel {
  private readonly handlers: AbilityPanelHandlers;
  private root: HTMLElement | null = null;
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

  constructor(handlers: AbilityPanelHandlers) {
    this.handlers = handlers;
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
    this.renderInto(parent);
  }

  update(state: GameState): void {
    if (!this.root) return;
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

      // Dynamic description (level-aware).
      setText(desc, stats.displayText || def.description);

      // Status line.
      if (reason) {
        setText(status, `${reason} · ${formatInt(stats.manaCost)}/${formatInt(mana)} mana`);
        toggleClass(status, 'ability-status-blocked', true);
      } else {
        setText(status, `Ready · ${formatInt(stats.manaCost)}/${formatInt(mana)} mana`);
        toggleClass(status, 'ability-status-blocked', false);
      }

      // Cooldown label.
      const label = this.labelById.get(def.id);
      if (label) {
        setText(label, def.name);
      }

      // Level badge.
      if (isMaxed) {
        setText(levelBadge, 'MAX');
        toggleClass(levelBadge, 'is-maxed', true);
      } else {
        setText(levelBadge, `Lv ${stats.level}`);
        toggleClass(levelBadge, 'is-maxed', false);
      }

      // Upgrade button visibility.
      const showUpgrade = isUnlocked && !isMaxed && cost > 0;
      setDisplay(upgradeBtn, showUpgrade ? 'inline-flex' : 'none');
      toggleClass(upgradeBtn, 'is-maxed', isMaxed);
      toggleClass(upgradeBtn, 'can-afford', canAfford);
      toggleClass(upgradeBtn, 'cannot-afford', showUpgrade && !canAfford);
      setDisabled(upgradeBtn, !canAfford);
      setText(upgradeBtn, `Upgrade · ${formatInt(cost)}g`);

      // Tooltip content (only refreshed when visible to avoid cost).
      const tooltip = this.upgradeTooltipById.get(def.id);
      if (tooltip && tooltip.style.display !== 'none') {
        this.refreshTooltip(def.id, tooltip, def, stats, cost, canAfford, isMaxed);
      }
    }
  }

  flashCast(id: AbilityId): void {
    const btn = this.buttonsById.get(id);
    if (!btn) return;
    // Animation restart: must always add the class (toggleClass would
    // short-circuit via the cache and skip the CSS animation).
    btn.classList.add('is-flash');
    setTimeout(() => btn.classList.remove('is-flash'), 220);
  }

  flashUpgrade(id: AbilityId): void {
    const card = this.cardsById.get(id);
    if (!card) return;
    // See flashCast — animation classes need unconditional add.
    card.classList.add('is-upgrade-flash');
    setTimeout(() => card.classList.remove('is-upgrade-flash'), 320);
  }

  private unmount(): void {
    this.root = null;
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'ability-panel';
    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Abilities';
    parent.appendChild(title);

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
    // Upgrade button is only visible when canUpgrade returns true, which already
    // requires the player to afford the cost — so the tooltip footer is always
    // green. We still render the class hook in case the affordability wiring
    // changes in the future.
    this.refreshTooltip(id, tooltip, def, stats, cost, true, false);
    setDisplay(tooltip, 'block');
    this.positionTooltip(id);
  }

  private hideTooltip(id: AbilityId): void {
    const tooltip = this.upgradeTooltipById.get(id);
    if (tooltip) setDisplay(tooltip, 'none');
  }

  /**
   * Position the upgrade tooltip to the left of the upgrade button, with its
   * bottom edge aligned to the button's bottom edge. Uses fixed positioning so
   * the tooltip renders above the game area (outside the scrollable panel).
   * Hides on scroll/resize to avoid floating disconnected from the button.
   */
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
    setInnerHTML(el, renderAbilityTooltip(def, currentStats, cost, canAfford));
  }
}
