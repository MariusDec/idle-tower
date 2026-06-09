import { toggleClass } from '../utils/dom';
import type { WaveModifierSnapshot } from '../types';

export type WaveModifierAutoMode = 'off' | 'skip' | 'select';

export interface WaveModifierChoiceData {
  /** Wave number the modifier will be applied to (e.g. 10, 20, 30). */
  wave: number;
  /** Up to 3 modifiers to choose from. */
  choices: WaveModifierSnapshot[];
}

export interface WaveModifierCallbacks {
  /** Player picked one of the offered modifiers. */
  onChoose: (snapshot: WaveModifierSnapshot) => void;
  /** Player declined (or auto-declined) the modifier for this wave. */
  onSkip: () => void;
}

const AUTO_PICK_DELAY = 5;

const PREFS_KEY = 'the-tower-wave-mod-auto-mode';

function readAutoModePref(): WaveModifierAutoMode {
  try {
    const v = localStorage.getItem(PREFS_KEY);
    if (v === 'skip' || v === 'select') return v;
  } catch {
    // ignore
  }
  return 'off';
}

function writeAutoModePref(mode: WaveModifierAutoMode): void {
  try {
    if (mode === 'off') localStorage.removeItem(PREFS_KEY);
    else localStorage.setItem(PREFS_KEY, mode);
  } catch {
    // ignore
  }
}

export class WaveModifierModal {
  private readonly root: HTMLElement;
  private currentRoot: HTMLElement | null = null;
  private callbacks: WaveModifierCallbacks | null = null;
  private autoMode: WaveModifierAutoMode = 'off';
  private autoTimer = 0;
  private currentChoices: WaveModifierSnapshot[] = [];

  // Element refs for live updates
  private countdownLabel: HTMLElement | null = null;
  private countdownBar: HTMLElement | null = null;
  private autoModeLabel: HTMLElement | null = null;
  private autoSkipInput: HTMLInputElement | null = null;
  private autoSelectInput: HTMLInputElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  show(data: WaveModifierChoiceData, callbacks: WaveModifierCallbacks): void {
    this.hide();
    this.callbacks = callbacks;
    this.autoMode = readAutoModePref();
    this.autoTimer = AUTO_PICK_DELAY;
    this.currentChoices = [...data.choices];

    const wrap = document.createElement('div');
    wrap.className = 'wave-mod-modal';
    this.currentRoot = wrap;

    const backdrop = document.createElement('div');
    backdrop.className = 'wave-mod-modal-backdrop';
    wrap.appendChild(backdrop);

    const card = document.createElement('div');
    card.className = 'wave-mod-modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', `Choose a wave modifier for wave ${data.wave}`);

    const title = document.createElement('h2');
    title.className = 'wave-mod-modal-title';
    title.textContent = `Wave ${data.wave} Mutator`;
    card.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'wave-mod-modal-sub';
    sub.textContent = 'Choose a mutator, decline, or let auto-pick handle it. The reward is granted on selection.';
    card.appendChild(sub);

    const grid = document.createElement('div');
    grid.className = 'wave-mod-modal-grid';
    for (const choice of data.choices) {
      grid.appendChild(this.buildChoice(choice));
    }
    card.appendChild(grid);

    // No-mutator button (separate from the choice grid).
    const skipRow = document.createElement('div');
    skipRow.className = 'wave-mod-modal-skip-row';
    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'btn wave-mod-skip-btn';
    skipBtn.textContent = 'No Mutator';
    skipBtn.addEventListener('click', () => this.handleSkip());
    skipRow.appendChild(skipBtn);
    card.appendChild(skipRow);

    // Auto-pick controls.
    const autoBlock = document.createElement('div');
    autoBlock.className = 'wave-mod-modal-auto';

    const autoModeLabel = document.createElement('div');
    autoModeLabel.className = 'wave-mod-modal-auto-mode-label';
    autoModeLabel.textContent = 'Auto-pick';
    autoBlock.appendChild(autoModeLabel);

    const autoRow = document.createElement('div');
    autoRow.className = 'wave-mod-modal-auto-row';

    const skipLabel = document.createElement('label');
    skipLabel.className = 'wave-mod-modal-auto-option';
    const skipInput = document.createElement('input');
    skipInput.type = 'checkbox';
    skipInput.checked = this.autoMode === 'skip';
    skipInput.addEventListener('change', () => {
      if (skipInput.checked) {
        this.setAutoMode('skip');
        if (this.autoSelectInput) this.autoSelectInput.checked = false;
      } else if (this.autoMode === 'skip') {
        this.setAutoMode('off');
      }
    });
    skipLabel.appendChild(skipInput);
    const skipText = document.createElement('span');
    skipText.textContent = `Auto-skip (${AUTO_PICK_DELAY}s)`;
    skipLabel.appendChild(skipText);
    autoRow.appendChild(skipLabel);
    this.autoSkipInput = skipInput;

    const selectLabel = document.createElement('label');
    selectLabel.className = 'wave-mod-modal-auto-option';
    const selectInput = document.createElement('input');
    selectInput.type = 'checkbox';
    selectInput.checked = this.autoMode === 'select';
    selectInput.addEventListener('change', () => {
      if (selectInput.checked) {
        this.setAutoMode('select');
        if (this.autoSkipInput) this.autoSkipInput.checked = false;
      } else if (this.autoMode === 'select') {
        this.setAutoMode('off');
      }
    });
    selectLabel.appendChild(selectInput);
    const selectText = document.createElement('span');
    selectText.textContent = `Auto-select (${AUTO_PICK_DELAY}s)`;
    selectLabel.appendChild(selectText);
    autoRow.appendChild(selectLabel);
    this.autoSelectInput = selectInput;

    autoBlock.appendChild(autoRow);
    card.appendChild(autoBlock);

    // Countdown / mode indicator (hidden when autoMode is 'off').
    const countdownWrap = document.createElement('div');
    countdownWrap.className = 'wave-mod-modal-countdown';
    const modeLabel = document.createElement('div');
    modeLabel.className = 'wave-mod-modal-countdown-mode';
    this.autoModeLabel = modeLabel;
    countdownWrap.appendChild(modeLabel);
    const barTrack = document.createElement('div');
    barTrack.className = 'wave-mod-modal-countdown-track';
    const barFill = document.createElement('div');
    barFill.className = 'wave-mod-modal-countdown-fill';
    barTrack.appendChild(barFill);
    countdownWrap.appendChild(barTrack);
    const countdownText = document.createElement('div');
    countdownText.className = 'wave-mod-modal-countdown-text';
    this.countdownLabel = countdownText;
    this.countdownBar = barFill;
    countdownWrap.appendChild(countdownText);
    card.appendChild(countdownWrap);

    this.refreshCountdown();

    wrap.appendChild(card);
    this.root.appendChild(wrap);
    requestAnimationFrame(() => toggleClass(wrap, 'is-visible', true));
  }

  private buildChoice(snapshot: WaveModifierSnapshot): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wave-mod-card';
    btn.style.setProperty('--mod-color', snapshot.color);

    const header = document.createElement('div');
    header.className = 'wave-mod-card-header';

    const glyph = document.createElement('div');
    glyph.className = 'wave-mod-card-glyph';
    glyph.textContent = snapshot.glyph;
    header.appendChild(glyph);

    const nameWrap = document.createElement('div');
    nameWrap.className = 'wave-mod-card-namewrap';
    const name = document.createElement('div');
    name.className = 'wave-mod-card-name';
    name.textContent = snapshot.name;
    nameWrap.appendChild(name);
    const detail = document.createElement('div');
    detail.className = 'wave-mod-card-detail';
    detail.textContent = snapshot.detail;
    nameWrap.appendChild(detail);
    header.appendChild(nameWrap);
    btn.appendChild(header);

    const desc = document.createElement('div');
    desc.className = 'wave-mod-card-desc';
    desc.textContent = snapshot.description;
    btn.appendChild(desc);

    const reward = document.createElement('div');
    reward.className = 'wave-mod-card-reward';
    const parts: string[] = [];
    if (snapshot.reward.ap > 0) parts.push(`+${snapshot.reward.ap} AP`);
    if (snapshot.reward.gold > 0) parts.push(`×${snapshot.reward.gold} Gold on clear`);
    if (snapshot.reward.tp > 0) parts.push(`+${snapshot.reward.tp} TP`);
    reward.textContent = parts.length > 0 ? `Reward: ${parts.join(', ')}` : 'No bonus reward';
    btn.appendChild(reward);

    btn.addEventListener('click', () => this.handleChoose(snapshot));
    return btn;
  }

  private setAutoMode(mode: WaveModifierAutoMode): void {
    this.autoMode = mode;
    this.autoTimer = AUTO_PICK_DELAY;
    writeAutoModePref(mode);
    this.refreshCountdown();
  }

  private refreshCountdown(): void {
    const active = this.autoMode !== 'off';
    if (this.countdownLabel?.parentElement) {
      toggleClass(this.countdownLabel.parentElement, 'is-active', active);
    }
    if (this.autoModeLabel) {
      this.autoModeLabel.textContent = this.autoMode === 'skip'
        ? 'Auto-skipping in…'
        : this.autoMode === 'select'
          ? 'Auto-selecting in…'
          : '';
    }
    if (this.countdownLabel) {
      const t = Math.max(0, Math.ceil(this.autoTimer));
      this.countdownLabel.textContent = active ? `${t}s` : '';
    }
    if (this.countdownBar) {
      const ratio = active ? Math.max(0, Math.min(1, this.autoTimer / AUTO_PICK_DELAY)) : 0;
      this.countdownBar.style.transform = `scaleX(${ratio})`;
    }
  }

  /**
   * Advance the auto-pick countdown. Returns true while the modal is
   * visible (so callers can early-out other UI ticks).
   */
  tick(dt: number): boolean {
    if (!this.currentRoot || !this.callbacks) return false;
    if (this.autoMode === 'off') {
      return true;
    }
    this.autoTimer -= dt;
    if (this.autoTimer <= 0) {
      if (this.autoMode === 'skip') {
        this.handleSkip();
      } else {
        // 'select' — 50% skip, 50% pick one of the offered choices
        if (this.currentChoices.length === 0 || Math.random() < 0.5) {
          this.handleSkip();
        } else {
          const pick = this.currentChoices[Math.floor(Math.random() * this.currentChoices.length)];
          this.handleChoose(pick);
        }
      }
      return true;
    }
    this.refreshCountdown();
    return true;
  }

  private handleChoose(snapshot: WaveModifierSnapshot): void {
    const cb = this.callbacks;
    this.hide();
    if (cb) cb.onChoose(snapshot);
  }

  private handleSkip(): void {
    const cb = this.callbacks;
    this.hide();
    if (cb) cb.onSkip();
  }

  hide(): void {
    if (this.currentRoot && this.currentRoot.parentNode) {
      this.currentRoot.parentNode.removeChild(this.currentRoot);
    }
    this.currentRoot = null;
    this.callbacks = null;
    this.autoMode = 'off';
    this.autoTimer = 0;
    this.currentChoices = [];
    this.countdownLabel = null;
    this.countdownBar = null;
    this.autoModeLabel = null;
    this.autoSkipInput = null;
    this.autoSelectInput = null;
  }

  isVisible(): boolean {
    return this.currentRoot !== null;
  }
}
