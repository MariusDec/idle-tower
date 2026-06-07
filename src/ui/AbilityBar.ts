import type { AbilityId, GameState } from '../types';
import { ABILITIES, type EffectiveAbilityStats } from '../data/abilities';
import { setAriaLabel, setDisabled, setStyle, setText, toggleClass, setDisplay, hasClass } from '../utils/dom';
import { AbilityUpgradePopover } from './AbilityUpgradePopover';

export interface AbilityBarHandlers {
  canCast: (id: AbilityId, wave: number) => boolean;
  reasonBlocked: (id: AbilityId, wave: number) => string | null;
  onCast: (id: AbilityId) => void;
  onUpgrade: (id: AbilityId) => void;
  canUpgrade: (id: AbilityId, wave: number) => boolean;
  isMaxed: (id: AbilityId) => boolean;
  getUpgradeCost: (id: AbilityId) => number;
  getEffectiveStats: (id: AbilityId) => EffectiveAbilityStats;
}

const LONG_PRESS_MS = 380;

interface BarButtonRefs {
  def: typeof ABILITIES[number];
  wrap: HTMLElement;
  btn: HTMLButtonElement;
  overlay: HTMLElement;
  badge: HTMLElement;
  mana: HTMLElement;
  label: HTMLElement;
  upgradeBtn: HTMLButtonElement;
  longPressTimer: number | null;
}

export class AbilityBar {
  private readonly root: HTMLElement;
  private readonly handlers: AbilityBarHandlers;
  private readonly popover: AbilityUpgradePopover;
  private readonly buttons = new Map<AbilityId, BarButtonRefs>();
  private lastState: GameState | null = null;
  private boundKeydown: ((ev: KeyboardEvent) => void) | null = null;
  private boundTouchStart: ((ev: TouchEvent) => void) | null = null;
  private boundTouchEnd: ((ev: TouchEvent) => void) | null = null;
  private boundTouchCancel: ((ev: TouchEvent) => void) | null = null;
  private boundWindowBlur: (() => void) | null = null;

  constructor(root: HTMLElement, handlers: AbilityBarHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.popover = new AbilityUpgradePopover(document.body, {
      getEffectiveStats: (id) => this.handlers.getEffectiveStats(id),
      isMaxed: (id) => this.handlers.isMaxed(id),
      getUpgradeCost: (id) => this.handlers.getUpgradeCost(id),
      canAfford: (id) => {
        const cost = this.handlers.getUpgradeCost(id);
        return this.lastState ? this.lastState.resources.gold >= cost : false;
      },
      onUpgrade: (id) => this.handlers.onUpgrade(id),
    });
    this.render();
    this.bindKeyboard();
    this.bindTouch();
  }

  update(state: GameState): void {
    this.lastState = state;
    for (const def of ABILITIES) {
      const refs = this.buttons.get(def.id);
      if (!refs) continue;
      const abState = state.abilities[def.id];
      const onCd = abState.cooldown > 0;
      const reason = this.handlers.reasonBlocked(def.id, state.wave.highestWave);
      const canCast = reason === null;
      const stats = this.handlers.getEffectiveStats(def.id);
      const isMaxed = this.handlers.isMaxed(def.id);
      const cost = this.handlers.getUpgradeCost(def.id);
      const canAfford = state.resources.gold >= cost;
      const isUnlocked = state.wave.highestWave >= def.unlockWave;

      setDisabled(refs.btn, !canCast);
      toggleClass(refs.btn, 'is-ready', canCast);
      toggleClass(refs.btn, 'is-cooldown', onCd);
      toggleClass(refs.btn, 'is-locked', reason === 'Locked' || (reason?.startsWith('Unlocks at') ?? false));
      toggleClass(refs.btn, 'is-active', abState.active);

      setText(refs.mana, `${stats.manaCost}`);
      setAriaLabel(refs.btn, `${def.name} Lv.${stats.level}, ${stats.manaCost} mana, ${stats.cooldown.toFixed(1)}s cooldown`);

      if (onCd) {
        const ratio = Math.max(0, Math.min(1, abState.cooldown / stats.cooldown));
        setStyle(refs.overlay, 'height', `${ratio * 100}%`);
        setStyle(refs.overlay, 'opacity', '1');
      } else {
        setStyle(refs.overlay, 'height', '0%');
        setStyle(refs.overlay, 'opacity', '0');
      }

      if (abState.active && abState.activeTimer > 0) {
        setDisplay(refs.badge, 'flex');
        setText(refs.badge, `${abState.activeTimer.toFixed(1)}s`);
      } else {
        setDisplay(refs.badge, 'none');
      }

      setText(refs.label, def.name);

      // Upgrade badge on the bar button is hidden — upgrade is reachable
      // through the long-press popover. But we keep the button's state in
      // sync so the popover can read it instantly.
      const showUpgrade = isUnlocked && !isMaxed && cost > 0;
      setDisplay(refs.upgradeBtn, 'none');
      toggleClass(refs.btn, 'has-upgrade', showUpgrade);
      toggleClass(refs.btn, 'can-afford-upgrade', showUpgrade && canAfford);

      // Hide the bar entry entirely if its ability hasn't been unlocked yet.
      const hidden = !isUnlocked;
      setDisplay(refs.wrap, hidden ? 'none' : 'flex');
    }
  }

  flashCast(id: AbilityId): void {
    const refs = this.buttons.get(id);
    if (!refs) return;
    refs.btn.classList.add('is-flash');
    setTimeout(() => refs.btn.classList.remove('is-flash'), 220);
  }

  flashUpgrade(id: AbilityId): void {
    const refs = this.buttons.get(id);
    if (!refs) return;
    refs.btn.classList.add('is-upgrade-flash');
    setTimeout(() => refs.btn.classList.remove('is-upgrade-flash'), 320);
  }

  destroy(): void {
    if (this.boundKeydown) window.removeEventListener('keydown', this.boundKeydown);
    const bar = this.root.querySelector('.ability-bar') as HTMLElement | null;
    if (bar) {
      if (this.boundTouchStart) bar.removeEventListener('touchstart', this.boundTouchStart);
      if (this.boundTouchEnd) bar.removeEventListener('touchend', this.boundTouchEnd);
      if (this.boundTouchCancel) bar.removeEventListener('touchcancel', this.boundTouchCancel);
    }
    if (this.boundWindowBlur) window.removeEventListener('blur', this.boundWindowBlur);
    for (const refs of this.buttons.values()) {
      if (refs.longPressTimer !== null) window.clearTimeout(refs.longPressTimer);
    }
    this.popover.hide();
  }

  private render(): void {
    this.root.innerHTML = '';
    this.root.className = 'ability-bar-host';
    const bar = document.createElement('div');
    bar.className = 'ability-bar';
    for (const def of ABILITIES) {
      const refs = this.createButton(def);
      this.buttons.set(def.id, refs);
      bar.appendChild(refs.wrap);
    }
    this.root.appendChild(bar);
    document.body.classList.add('has-ability-bar');
  }

  private createButton(def: typeof ABILITIES[number]): BarButtonRefs {
    const wrap = document.createElement('div');
    wrap.className = 'ability-bar-slot';
    wrap.dataset.abilityId = def.id;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ability-btn';
    btn.style.setProperty('--ability-color', def.color);
    btn.setAttribute('aria-label', `${def.name}, ability`);
    btn.addEventListener('click', (ev) => {
      // Suppress the click that follows a long-press popover.
      if (hasClass(btn, 'is-long-press')) {
        ev.preventDefault();
        btn.classList.remove('is-long-press');
        return;
      }
      this.handlers.onCast(def.id);
    });
    btn.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.showPopover(def.id, btn);
    });
    btn.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      this.showPopover(def.id, btn);
    });

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

    // Upgrade button is hidden in the bar (long-press / context menu opens
    // the popover), but we still keep a reference so the popover can hook in.
    const upgradeBtn = document.createElement('button');
    upgradeBtn.type = 'button';
    upgradeBtn.className = 'ability-upgrade-btn';
    upgradeBtn.style.display = 'none';

    const label = document.createElement('div');
    label.className = 'ability-bar-slot-label';
    label.textContent = def.name;

    wrap.appendChild(btn);
    wrap.appendChild(label);

    return { def, wrap, btn, overlay, badge, mana, label, upgradeBtn, longPressTimer: null };
  }

  private bindKeyboard(): void {
    // Hotkeys are handled in main.ts (it already calls game.castAbility).
    // The bar just reflects state — we don't need to bind keys here.
    this.boundKeydown = null;
  }

  private bindTouch(): void {
    const bar = this.root.querySelector('.ability-bar') as HTMLElement | null;
    if (!bar) return;

    const clearTimer = (refs: BarButtonRefs | null) => {
      if (refs && refs.longPressTimer !== null) {
        window.clearTimeout(refs.longPressTimer);
        refs.longPressTimer = null;
      }
    };

    this.boundTouchStart = (ev: TouchEvent) => {
      const target = (ev.target as HTMLElement | null)?.closest('.ability-bar-slot') as HTMLElement | null;
      if (!target) return;
      const id = target.dataset.abilityId as AbilityId | undefined;
      if (!id) return;
      const refs = this.buttons.get(id);
      if (!refs) return;
      clearTimer(refs);
      refs.longPressTimer = window.setTimeout(() => {
        refs.longPressTimer = null;
        refs.btn.classList.add('is-long-press');
        this.showPopover(refs.def.id, refs.btn);
      }, LONG_PRESS_MS);
    };

    this.boundTouchEnd = (ev: TouchEvent) => {
      const target = (ev.target as HTMLElement | null)?.closest('.ability-bar-slot') as HTMLElement | null;
      if (!target) return;
      const id = target.dataset.abilityId as AbilityId | undefined;
      if (!id) return;
      const refs = this.buttons.get(id);
      if (refs) clearTimer(refs);
    };

    this.boundTouchCancel = () => {
      for (const refs of this.buttons.values()) clearTimer(refs);
    };

    this.boundWindowBlur = () => {
      for (const refs of this.buttons.values()) clearTimer(refs);
    };

    bar.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    bar.addEventListener('touchend', this.boundTouchEnd, { passive: true });
    bar.addEventListener('touchcancel', this.boundTouchCancel, { passive: true });
    bar.addEventListener('touchmove', this.boundTouchCancel, { passive: true });
    window.addEventListener('blur', this.boundWindowBlur);
  }

  private showPopover(id: AbilityId, anchor: HTMLElement): void {
    if (this.handlers.isMaxed(id)) return;
    const stats = this.handlers.getEffectiveStats(id);
    this.popover.show(id, stats, anchor);
  }
}
