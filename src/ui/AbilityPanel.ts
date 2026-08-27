import type { AbilityId, GameState } from '../types';
import { ABILITIES, ABILITY_BY_ID, computeEffectiveStats, type AbilityDef } from '../data/abilities';
import { abilityXpForLevel } from '../data/xpTables';
import { formatInt } from '../utils/bigNumber';
import { setAriaLabel, setDisabled, setStyle, setText, toggleClass, setDisplay, setDataAttr } from '../utils/dom';
import { renderAbilityTooltip } from './abilityFormat';
import { renderIcon } from './Icon';
import { bindLongPress } from '../utils/longPress';

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
  /** Plan §3.1: auto-cast is unlocked by the Auto-Caster TP perk. */
  isAutoCastUnlocked: () => boolean;
  isAutoCastEnabled: (id: AbilityId) => boolean;
  onToggleAutoCast: (id: AbilityId, enabled: boolean) => void;
}

export class AbilityPanel {
  private readonly handlers: AbilityPanelHandlers;
  private root: HTMLElement | null = null;

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
  private actionById = new Map<AbilityId, HTMLElement>();
  private upgradeTooltipById = new Map<AbilityId, HTMLElement>();
  private xpBarEls = new Map<AbilityId, HTMLElement>();
  private xpBarFillEls = new Map<AbilityId, HTMLElement>();
  private xpTextEls = new Map<AbilityId, HTMLElement>();
  private autoCastRowById = new Map<AbilityId, HTMLElement>();
  private autoCastInputById = new Map<AbilityId, HTMLInputElement>();
  /** Teardown for the §9.C hold-to-read bindings on the upgrade buttons. */
  private longPressUnbinds: (() => void)[] = [];

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
    this.actionById.clear();
    this.upgradeTooltipById.clear();
    this.xpBarEls.clear();
    this.xpBarFillEls.clear();
    this.xpTextEls.clear();
    this.autoCastRowById.clear();
    this.autoCastInputById.clear();
    this.renderInto(parent);
  }

  update(state: GameState): void {
    if (!this.root) return;
    this.updateActive(state);
  }

  private updateActive(state: GameState): void {
    const mana = state.resources.mana;
    const autoUnlocked = this.handlers.isAutoCastUnlocked();
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

      // Plan §8.B: card state. With no upgrade to offer the action column
      // collapses rather than reserving an empty gutter.
      const cardEl = this.cardsById.get(def.id);
      if (cardEl) {
        setDataAttr(cardEl, 'afford', isMaxed ? 'maxed' : showUpgrade && canAfford ? 'yes' : 'no');
      }
      const actionEl = this.actionById.get(def.id);
      if (actionEl) setDisplay(actionEl, showUpgrade ? '' : 'none');

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

      const autoRow = this.autoCastRowById.get(def.id);
      const autoInput = this.autoCastInputById.get(def.id);
      if (autoRow && autoInput) {
        const showAuto = autoUnlocked && isUnlocked;
        setDisplay(autoRow, showAuto ? 'flex' : 'none');
        if (showAuto) {
          const on = this.handlers.isAutoCastEnabled(def.id);
          if (autoInput.checked !== on) autoInput.checked = on;
        }
      }

      const tooltip = this.upgradeTooltipById.get(def.id);
      if (tooltip && tooltip.style.display !== 'none') {
        this.refreshTooltip(def.id, tooltip, def, stats, cost, canAfford, isMaxed);
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
    for (const unbind of this.longPressUnbinds) unbind();
    this.longPressUnbinds.length = 0;
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
    // Derived, not hardcoded: Rocket Barrage caps at 15 while the rest cap at
    // 10, so "up to 10 times" was already wrong for one of the ten cards.
    const deepestMax = Math.max(...ABILITIES.map(a => a.maxLevel));
    footer.textContent = `Each ability unlocks at a different wave and can be upgraded up to ${deepestMax - 1} times from this panel.`;
    parent.appendChild(footer);
  }

  private renderCard(def: AbilityDef): HTMLElement {
    const card = document.createElement('div');
    card.className = 'card ability-card';
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
    renderIcon(icon, def.icon);
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
    // §9.C: the upgrade tooltip was hover- and focus-only, which on a phone
    // means the only way to read what a level buys is to buy it. Hold opens
    // it; the helper swallows the trailing click so the hold does not also
    // spend the gold.
    this.longPressUnbinds.push(bindLongPress(upgradeBtn, {
      onLongPress: () => this.showTooltip(def.id),
      onRelease: () => this.hideTooltip(def.id),
    }));

    // Plan §3.1: per-ability auto-cast opt-out. Hidden until the Auto-Caster
    // perk is bought, so it does not advertise a system the player cannot use.
    const autoRow = document.createElement('label');
    autoRow.className = 'ability-autocast-row';
    autoRow.style.display = 'none';
    const autoInput = document.createElement('input');
    autoInput.type = 'checkbox';
    autoInput.checked = true;
    autoInput.addEventListener('change', () => {
      this.handlers.onToggleAutoCast(def.id, autoInput.checked);
    });
    const autoText = document.createElement('span');
    autoText.textContent = 'Auto-cast';
    autoRow.appendChild(autoInput);
    autoRow.appendChild(autoText);
    info.appendChild(autoRow);
    this.autoCastRowById.set(def.id, autoRow);
    this.autoCastInputById.set(def.id, autoInput);

    card.appendChild(info);

    // Plan §8.B: the upgrade button lives in the shared card's action column
    // rather than trailing the text block.
    const action = document.createElement('div');
    action.className = 'card-action ability-action';
    action.appendChild(upgradeBtn);
    card.appendChild(action);
    this.actionById.set(def.id, action);

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
    tooltip: HTMLElement,
    def: AbilityDef,
    stats: ReturnType<typeof computeEffectiveStats>,
    cost: number,
    canAfford: boolean,
    isMaxed: boolean,
  ): void {
    tooltip.innerHTML = renderAbilityTooltip(def, stats, cost, canAfford, !isMaxed, true);
  }
}
