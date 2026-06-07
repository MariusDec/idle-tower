import type { AbilityId } from '../types';
import { ABILITY_BY_ID, type EffectiveAbilityStats } from '../data/abilities';
import { setStyle, setDisplay } from '../utils/dom';
import { renderAbilityTooltip } from './abilityFormat';

export interface AbilityUpgradePopoverHandlers {
  getEffectiveStats: (id: AbilityId) => EffectiveAbilityStats;
  isMaxed: (id: AbilityId) => boolean;
  getUpgradeCost: (id: AbilityId) => number;
  canAfford: (id: AbilityId, wave: number) => boolean;
  onUpgrade: (id: AbilityId) => void;
}

export class AbilityUpgradePopover {
  private readonly host: HTMLElement;
  private readonly handlers: AbilityUpgradePopoverHandlers;
  private root: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private upgradeBtn: HTMLButtonElement | null = null;
  private backdrop: HTMLElement | null = null;
  private currentId: AbilityId | null = null;
  private boundOnClickBackdrop: (() => void) | null = null;
  private boundOnKeydown: ((ev: KeyboardEvent) => void) | null = null;
  private boundOnWindowChange: (() => void) | null = null;

  constructor(host: HTMLElement, handlers: AbilityUpgradePopoverHandlers) {
    this.host = host;
    this.handlers = handlers;
    this.render();
  }

  show(id: AbilityId, currentStats: EffectiveAbilityStats, anchor: HTMLElement): void {
    if (!this.root || !this.body || !this.upgradeBtn || !this.titleEl) return;
    const def = ABILITY_BY_ID[id];
    if (!def) return;
    this.currentId = id;
    this.titleEl.textContent = `${def.name} — Upgrade`;
    const cost = this.handlers.getUpgradeCost(id);
    const isMaxed = this.handlers.isMaxed(id);
    const canAfford = isMaxed ? false : this.handlers.canAfford(id, 0);
    this.body.innerHTML = renderAbilityTooltip(def, currentStats, cost, canAfford);
    this.upgradeBtn.style.display = isMaxed ? 'none' : 'inline-flex';
    this.upgradeBtn.textContent = `Upgrade · ${formatGold(cost)}g`;
    this.upgradeBtn.disabled = !canAfford;
    this.upgradeBtn.classList.toggle('can-afford', canAfford);
    this.upgradeBtn.classList.toggle('cannot-afford', !canAfford);
    this.root.style.display = 'block';
    this.root.classList.add('is-open');
    if (this.backdrop) this.backdrop.classList.add('is-open');
    this.position(anchor);
  }

  hide(): void {
    if (!this.root) return;
    this.root.style.display = 'none';
    this.root.classList.remove('is-open');
    if (this.backdrop) this.backdrop.classList.remove('is-open');
    this.currentId = null;
  }

  destroy(): void {
    this.hide();
    if (this.boundOnKeydown) window.removeEventListener('keydown', this.boundOnKeydown);
    if (this.boundOnWindowChange) {
      window.removeEventListener('resize', this.boundOnWindowChange);
      window.removeEventListener('scroll', this.boundOnWindowChange, true);
    }
    if (this.root && this.root.parentElement) this.root.parentElement.removeChild(this.root);
    if (this.backdrop && this.backdrop.parentElement) this.backdrop.parentElement.removeChild(this.backdrop);
  }

  private render(): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'ability-upgrade-popover-backdrop';
    this.boundOnClickBackdrop = () => this.hide();
    backdrop.addEventListener('click', this.boundOnClickBackdrop);
    document.body.appendChild(backdrop);
    this.backdrop = backdrop;

    const root = document.createElement('div');
    root.className = 'ability-upgrade-popover';
    root.style.display = 'none';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    const header = document.createElement('div');
    header.className = 'ability-upgrade-popover-header';
    const title = document.createElement('span');
    title.className = 'ability-upgrade-popover-title';
    header.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mobile-sheet-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => this.hide());
    header.appendChild(closeBtn);
    this.titleEl = title;

    const body = document.createElement('div');
    body.className = 'ability-upgrade-tooltip';
    body.style.display = 'block';
    body.style.position = 'static';
    body.style.minWidth = '0';

    const actions = document.createElement('div');
    actions.className = 'ability-upgrade-popover-actions';
    const upgradeBtn = document.createElement('button');
    upgradeBtn.type = 'button';
    upgradeBtn.className = 'ability-upgrade-btn';
    upgradeBtn.addEventListener('click', () => {
      if (this.currentId) this.handlers.onUpgrade(this.currentId);
      this.hide();
    });
    actions.appendChild(upgradeBtn);
    this.upgradeBtn = upgradeBtn;

    root.appendChild(header);
    root.appendChild(body);
    root.appendChild(actions);

    this.host.appendChild(root);
    this.root = root;
    this.body = body;

    this.boundOnKeydown = (ev) => {
      if (ev.key === 'Escape' && this.root && this.root.classList.contains('is-open')) {
        ev.preventDefault();
        this.hide();
      }
    };
    window.addEventListener('keydown', this.boundOnKeydown);

    this.boundOnWindowChange = () => {
      if (this.currentId) this.hide();
    };
    window.addEventListener('resize', this.boundOnWindowChange);
    window.addEventListener('scroll', this.boundOnWindowChange, true);
  }

  private position(anchor: HTMLElement): void {
    if (!this.root) return;
    const rect = anchor.getBoundingClientRect();
    const popRect = this.root.getBoundingClientRect();
    const margin = 8;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Try placing above the button.
    let top = rect.top - popRect.height - gap;
    let placement: 'above' | 'below' = 'above';
    if (top < margin) {
      top = rect.bottom + gap;
      placement = 'below';
    }
    if (top + popRect.height > vh - margin) {
      top = Math.max(margin, vh - popRect.height - margin);
    }
    const left = Math.max(margin, Math.min(vw - popRect.width - margin, rect.left + rect.width / 2 - popRect.width / 2));
    setStyle(this.root, 'top', `${top}px`);
    setStyle(this.root, 'left', `${left}px`);
    setStyle(this.root, 'right', 'auto');
    setStyle(this.root, 'bottom', 'auto');
    this.root.dataset.placement = placement;
    setDisplay(this.root, 'block');
  }
}

function formatGold(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${Math.floor(v)}`;
}
