import type { AbilityId, GameState } from '../types';
import { ABILITIES, ABILITY_BY_ID, type EffectiveAbilityStats } from '../data/abilities';
import {
  setAriaLabel,
  setDisabled,
  setStyle,
  setText,
  toggleClass,
  setDisplay,
  hasClass,
  setInnerHTML,
  setVisibility
} from '../utils/dom';
import { AbilityUpgradePopover } from './AbilityUpgradePopover';
import { renderAbilityTooltip } from './abilityFormat';
import { renderIcon } from './Icon';

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

/**
 * Hold-to-inspect (UI plan §7).
 *
 * 380ms is long enough not to fire on a tap that means "cast" and short enough
 * that a player who is deliberately holding does not conclude nothing is going
 * to happen.
 */
const HOLD_MS = 380;
const HOVER_DELAY_MS = 200;
/**
 * A hold that wanders further than this is a scroll or a drag, not an inspect.
 * Measured against the *pointer*, not the element, so a finger that slides off
 * the tile still cancels rather than opening a popover for the wrong ability.
 */
const HOLD_SLOP_PX = 12;

interface BarButtonRefs {
  def: typeof ABILITIES[number];
  wrap: HTMLElement;
  btn: HTMLButtonElement;
  /** The conic-gradient cooldown sweep. */
  sweep: HTMLElement;
  badge: HTMLElement;
  /** Seconds of cooldown left, over the icon. */
  cdText: HTMLElement;
  mana: HTMLElement;
  label: HTMLElement;
  pips: HTMLElement[];
  upgradeBtn: HTMLButtonElement;
  holdTimer: number | null;
  /** Where the hold started, for the slop test. */
  holdX: number;
  holdY: number;
  /** Last cooldown seen, so coming *off* cooldown can be detected exactly once. */
  wasOnCooldown: boolean;
  /** Alternates so a repeat ready-flash restarts without forcing a reflow. */
  flashPhase: boolean;
}

/**
 * The ability dock (UI plan §7).
 *
 * What changed and why each one mattered:
 *
 * - **The cooldown is radial.** It was a dark panel rising from the bottom of
 *   the tile, which reads as a fill level rather than as a clock, and at 52px
 *   the difference between 30% and 45% full was a few pixels. A sweep is a
 *   clock face, and it carries the remaining seconds in the middle of it.
 * - **The mana badge greys when unaffordable.** The number was always the same
 *   colour, so "can I cast this" needed a look at the HUD's mana bar and some
 *   arithmetic.
 * - **A ready-flash** on the frame the cooldown ends. An idle game's abilities
 *   come up while the player is looking somewhere else; without a transition
 *   the tile is simply different next time they glance at it.
 * - **A level pip row**, because ability level was invisible on the bar and
 *   only reachable through the popover it is an argument for opening.
 * - **Hold-to-inspect on any pointer.** The popover was reachable by right
 *   click and double click — neither of which exists on a phone — and it
 *   refused to open at all for a maxed ability, so the one surface describing
 *   what an ability *does* disappeared exactly when the player had finished
 *   investing in it.
 */
export class AbilityBar {
  private readonly root: HTMLElement;
  private readonly handlers: AbilityBarHandlers;
  private readonly popover: AbilityUpgradePopover;
  private readonly buttons = new Map<AbilityId, BarButtonRefs>();
  private lastState: GameState | null = null;
  private boundKeydown: ((ev: KeyboardEvent) => void) | null = null;
  private boundPointerDown: ((ev: PointerEvent) => void) | null = null;
  private boundPointerMove: ((ev: PointerEvent) => void) | null = null;
  private boundPointerEnd: ((ev: PointerEvent) => void) | null = null;
  private boundWindowBlur: (() => void) | null = null;
  private hoverTooltip: HTMLElement | null = null;
  private hoverTimer: number | null = null;

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
    this.bindPointer();
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
      const canPayMana = state.resources.mana >= stats.manaCost;

      setDisabled(refs.btn, !canCast);
      toggleClass(refs.btn, 'is-ready', canCast);
      toggleClass(refs.btn, 'is-cooldown', onCd);
      toggleClass(refs.btn, 'is-locked', reason === 'Locked' || (reason?.startsWith('Unlocks at') ?? false));
      toggleClass(refs.btn, 'is-active', abState.active);

      // The badge greys the moment the pool cannot pay for it, so affording a
      // cast stops being a two-readout arithmetic problem.
      setText(refs.mana, `${stats.manaCost}`);
      toggleClass(refs.mana, 'is-unaffordable', !canPayMana);
      setAriaLabel(
        refs.btn,
        `${def.name} Lv.${stats.level}, ${stats.manaCost} mana, ${stats.cooldown.toFixed(1)}s cooldown`
        + (onCd ? `, ${abState.cooldown.toFixed(1)}s remaining` : ', ready'),
      );

      if (onCd) {
        const remaining = Math.max(0, Math.min(1, abState.cooldown / stats.cooldown));
        // The dark wedge *is* the remaining time, so the sweep opens clockwise
        // from twelve o'clock as the cooldown burns down.
        setStyle(refs.sweep, '--cd-angle', `${((1 - remaining) * 360).toFixed(1)}deg`);
        setStyle(refs.sweep, 'opacity', '1');
        setText(refs.cdText, abState.cooldown >= 10
          ? `${Math.ceil(abState.cooldown)}`
          : abState.cooldown.toFixed(1));
        toggleClass(refs.cdText, 'is-visible', true);
      } else {
        setStyle(refs.sweep, 'opacity', '0');
        toggleClass(refs.cdText, 'is-visible', false);
      }

      // Coming *off* cooldown is the event worth marking: an idle game's
      // abilities come up while the player is looking somewhere else.
      if (refs.wasOnCooldown && !onCd && isUnlocked) {
        refs.flashPhase = !refs.flashPhase;
        toggleClass(refs.btn, 'is-ready-flash-a', refs.flashPhase);
        toggleClass(refs.btn, 'is-ready-flash-b', !refs.flashPhase);
      }
      refs.wasOnCooldown = onCd;

      if (abState.active && abState.activeTimer > 0) {
        setDisplay(refs.badge, 'flex');
        setText(refs.badge, `${abState.activeTimer.toFixed(1)}s`);
      } else {
        setDisplay(refs.badge, 'none');
      }

      setText(refs.label, def.name);

      for (let i = 0; i < refs.pips.length; i++) {
        toggleClass(refs.pips[i], 'is-on', i < stats.level);
      }
      toggleClass(refs.wrap, 'is-maxed', isMaxed);
      // The pip row doubles as the upgrade prompt: it lights up when the
      // upgrade is affordable, which is the only thing the hidden upgrade
      // button on the tile was ever trying to say.
      const showUpgrade = isUnlocked && !isMaxed && cost > 0;
      setDisplay(refs.upgradeBtn, 'none');
      toggleClass(refs.btn, 'has-upgrade', showUpgrade);
      toggleClass(refs.btn, 'can-afford-upgrade', showUpgrade && canAfford);
      toggleClass(refs.wrap, 'can-afford-upgrade', showUpgrade && canAfford);

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
    if (bar && this.boundPointerDown) bar.removeEventListener('pointerdown', this.boundPointerDown);
    if (this.boundPointerMove) window.removeEventListener('pointermove', this.boundPointerMove);
    if (this.boundPointerEnd) {
      window.removeEventListener('pointerup', this.boundPointerEnd);
      window.removeEventListener('pointercancel', this.boundPointerEnd);
    }
    if (this.boundWindowBlur) window.removeEventListener('blur', this.boundWindowBlur);
    this.cancelHolds();
    if (this.hoverTimer !== null) window.clearTimeout(this.hoverTimer);
    if (this.hoverTooltip && this.hoverTooltip.parentElement) {
      this.hoverTooltip.parentElement.removeChild(this.hoverTooltip);
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
      // Suppress the click that follows a hold-to-inspect.
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
    btn.addEventListener('mouseenter', () => this.onHoverStart(def.id, btn));
    btn.addEventListener('mouseleave', () => this.onHoverEnd());

    const sweep = document.createElement('div');
    sweep.className = 'ability-cooldown-radial';
    btn.appendChild(sweep);

    const icon = document.createElement('div');
    icon.className = 'ability-icon';
    renderIcon(icon, def.icon);
    btn.appendChild(icon);

    const cdText = document.createElement('div');
    cdText.className = 'ability-cd-text u-display u-tabular';
    btn.appendChild(cdText);

    const hotkey = document.createElement('div');
    hotkey.className = 'ability-hotkey';
    hotkey.textContent = def.hotkey;
    btn.appendChild(hotkey);

    const badge = document.createElement('div');
    badge.className = 'ability-active-badge';
    badge.style.display = 'none';
    btn.appendChild(badge);

    const mana = document.createElement('div');
    mana.className = 'ability-mana u-tabular';
    mana.textContent = `${def.manaCost}`;
    btn.appendChild(mana);

    // Upgrade button is hidden in the bar (hold / context menu opens the
    // popover), but we still keep a reference so the popover can hook in.
    const upgradeBtn = document.createElement('button');
    upgradeBtn.type = 'button';
    upgradeBtn.className = 'ability-upgrade-btn';
    upgradeBtn.style.display = 'none';

    // One pip per upgrade level. Ability level had no representation on the bar
    // at all, so an ability the player had sunk 40k gold into looked exactly
    // like one they had never touched.
    const pipRow = document.createElement('div');
    pipRow.className = 'ability-pips';
    const pips: HTMLElement[] = [];
    for (let i = 0; i < def.maxLevel; i++) {
      const pip = document.createElement('i');
      pip.className = 'ability-pip';
      pipRow.appendChild(pip);
      pips.push(pip);
    }

    const label = document.createElement('div');
    label.className = 'ability-bar-slot-label';
    label.textContent = def.name;

    wrap.appendChild(btn);
    wrap.appendChild(pipRow);
    wrap.appendChild(label);

    return {
      def, wrap, btn, sweep, badge, cdText, mana, label, pips, upgradeBtn,
      holdTimer: null, holdX: 0, holdY: 0, wasOnCooldown: false, flashPhase: false,
    };
  }

  private bindKeyboard(): void {
    // Hotkeys are handled in main.ts (it already calls game.castAbility).
    // The bar just reflects state — we don't need to bind keys here.
    this.boundKeydown = null;
  }

  /**
   * Hold-to-inspect, on pointer events rather than touch events.
   *
   * One code path for finger, mouse and pen. The touch-only version this
   * replaces meant the popover's only desktop routes were right-click and
   * double-click, and its only phone route was a `touchstart` handler that a
   * pen or a trackpad press never reached.
   *
   * `pointermove` and `pointerup` are bound to the *window*, not the tile: a
   * finger that slides off the button still has to cancel the hold, and a
   * pointerup that lands outside still has to clear the timer.
   */
  private bindPointer(): void {
    const bar = this.root.querySelector('.ability-bar') as HTMLElement | null;
    if (!bar) return;

    this.boundPointerDown = (ev: PointerEvent) => {
      const target = (ev.target as HTMLElement | null)?.closest('.ability-bar-slot') as HTMLElement | null;
      if (!target) return;
      const id = target.dataset.abilityId as AbilityId | undefined;
      if (!id) return;
      const refs = this.buttons.get(id);
      if (!refs) return;
      this.cancelHolds();
      refs.holdX = ev.clientX;
      refs.holdY = ev.clientY;
      refs.holdTimer = window.setTimeout(() => {
        refs.holdTimer = null;
        refs.btn.classList.add('is-long-press');
        this.onHoverEnd();
        this.showPopover(refs.def.id, refs.btn);
      }, HOLD_MS);
    };

    this.boundPointerMove = (ev: PointerEvent) => {
      for (const refs of this.buttons.values()) {
        if (refs.holdTimer === null) continue;
        const dx = ev.clientX - refs.holdX;
        const dy = ev.clientY - refs.holdY;
        if (dx * dx + dy * dy > HOLD_SLOP_PX * HOLD_SLOP_PX) this.cancelHolds();
      }
    };

    this.boundPointerEnd = () => this.cancelHolds();
    this.boundWindowBlur = () => this.cancelHolds();

    bar.addEventListener('pointerdown', this.boundPointerDown);
    window.addEventListener('pointermove', this.boundPointerMove, { passive: true });
    window.addEventListener('pointerup', this.boundPointerEnd);
    window.addEventListener('pointercancel', this.boundPointerEnd);
    window.addEventListener('blur', this.boundWindowBlur);
  }

  private cancelHolds(): void {
    for (const refs of this.buttons.values()) {
      if (refs.holdTimer === null) continue;
      window.clearTimeout(refs.holdTimer);
      refs.holdTimer = null;
    }
  }

  private onHoverStart(id: AbilityId, anchor: HTMLElement): void {
    if (this.hoverTimer !== null) window.clearTimeout(this.hoverTimer);
    this.hoverTimer = window.setTimeout(() => {
      this.hoverTimer = null;
      const stats = this.handlers.getEffectiveStats(id);
      const def = ABILITY_BY_ID[id];
      if (!def) return;
      const maxed = this.handlers.isMaxed(id);
      const cost = this.handlers.getUpgradeCost(id);
      const canAfford = this.lastState ? this.lastState.resources.gold >= cost : false;
      this.ensureHoverTooltip();
      if (!this.hoverTooltip) return;
      // A maxed ability still gets its stats read out. It used to get nothing,
      // which meant the description of what an ability does vanished exactly
      // when the player had finished paying for it.
      setInnerHTML(this.hoverTooltip, renderAbilityTooltip(def, stats, cost, canAfford, !maxed, true));
      setVisibility(this.hoverTooltip, 'hidden');
      setDisplay(this.hoverTooltip, 'block');
      this.positionHoverTooltip(anchor);
      setVisibility(this.hoverTooltip, 'visible');
      setStyle(this.hoverTooltip, 'pointer-events', 'none');
    }, HOVER_DELAY_MS);
  }

  private onHoverEnd(): void {
    if (this.hoverTimer !== null) {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (this.hoverTooltip) setDisplay(this.hoverTooltip, 'none');
  }

  private ensureHoverTooltip(): void {
    if (this.hoverTooltip) return;
    const el = document.createElement('div');
    el.className = 'ability-upgrade-tooltip';
    el.style.display = 'none';
    document.body.appendChild(el);
    this.hoverTooltip = el;
  }

  private positionHoverTooltip(anchor: HTMLElement): void {
    if (!this.hoverTooltip) return;
    const rect = anchor.getBoundingClientRect();
    const tipRect = this.hoverTooltip.getBoundingClientRect();
    const margin = 8;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bottom = vh - rect.top + gap;
    const left = Math.max(margin, Math.min(vw - tipRect.width - margin, rect.left + rect.width / 2 - tipRect.width / 2));
    setStyle(this.hoverTooltip, 'bottom', `${bottom}px`);
    setStyle(this.hoverTooltip, 'left', `${left}px`);
  }

  private showPopover(id: AbilityId, anchor: HTMLElement): void {
    const stats = this.handlers.getEffectiveStats(id);
    this.popover.show(id, stats, anchor);
  }
}
