import { toggleClass } from '../utils/dom';
import { Modal } from './Modal';
import { CORES, describeCoreStats, type CoreDef, type CoreId } from '../data/cores';
import { icon } from './Icon';

export interface CorePickerCore {
  def: CoreDef;
  unlocked: boolean;
  /** True when this is the core the run is currently set to. */
  current: boolean;
  /** AP the player has, for the unlock affordance on a locked card. */
  affordable: boolean;
}

export interface CorePickerData {
  cores: readonly CorePickerCore[];
  /** Ascension points on hand, for the "unlock for N AP" line. */
  ascensionPoints: number;
  /** Wave the new run starts at, purely for the sub-heading. */
  startWave: number;
  /** Wall-clock seconds before the modal resolves itself. */
  timeoutSeconds: number;
}

export interface CorePickerCallbacks {
  /** Run this core. The modal is already hidden when this fires. */
  onSelect: (id: CoreId) => void;
  /** Buy a locked core with AP. The caller re-`show`s with fresh data. */
  onUnlock: (id: CoreId) => void;
  /** Dismissed, or the countdown ran out: keep whatever is selected. */
  onDismiss: () => void;
}

/**
 * The run-start core picker (plan §6.2).
 *
 * It is the `RunSummaryModal`'s CTA rather than a separate prompt: the debrief
 * is the one moment in the game where the player is already thinking about the
 * run they just finished, which is the only information a core choice can be
 * made *with*. Before the first ascension there is no debrief and no picker —
 * a new player is on `marksman` and is never asked a question they cannot
 * answer.
 *
 * Two things it deliberately shares with `BlessingDraftModal`: the card grid
 * vocabulary (so a choice looks like a choice everywhere in the game), and a
 * countdown that is never off. Cross-cutting rule 1 — nothing blocks on a modal
 * forever — and an auto-ascending idle game reaches this modal without a player
 * in front of it several times an hour. Timing out keeps the current selection,
 * which `CoreManager.resetRun` has already restored to the player's preference,
 * so an unattended run keeps the identity the player last chose.
 *
 * Locked cores are shown, not hidden: "there are four more of these and one
 * costs 5 AP" is the whole reason to save AP for them.
 */
export class CorePickerModal {
  private readonly root: HTMLElement;
  private modal: Modal | null = null;
  private callbacks: CorePickerCallbacks | null = null;
  private timer = 0;
  private total = 0;
  private countdownLabel: HTMLElement | null = null;
  private countdownBar: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  isVisible(): boolean {
    return this.modal !== null;
  }

  show(data: CorePickerData, callbacks: CorePickerCallbacks): void {
    this.hide();
    this.callbacks = callbacks;
    this.timer = data.timeoutSeconds;
    this.total = Math.max(0.001, data.timeoutSeconds);

    // Escape and a backdrop tap keep the current core — the same answer the
    // countdown lands on, so dismissing is never a choice the player did not
    // mean to make.
    const modal = new Modal({
      id: 'core-picker',
      title: 'Choose Your Core',
      sub: 'The core decides how this run shoots, and it biases which blessings you are'
        + ` offered. It lasts until you ascend. Starting at wave ${data.startWave}.`,
      width: 940,
      onClose: () => this.handleDismiss(),
      root: this.root,
    });
    this.modal = modal;
    modal.cardElement.classList.add('core-modal-card');
    const card = modal.body;

    const grid = document.createElement('div');
    grid.className = 'blessing-modal-grid core-modal-grid';
    for (const entry of data.cores) {
      grid.appendChild(this.buildCard(entry));
    }
    card.appendChild(grid);

    const actions = document.createElement('div');
    actions.className = 'blessing-modal-actions';
    const ap = document.createElement('div');
    ap.className = 'core-modal-ap';
    ap.textContent = `${Math.floor(data.ascensionPoints)} AP available`;
    actions.appendChild(ap);
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'btn blessing-skip-btn';
    const currentName = data.cores.find(c => c.current)?.def.name ?? CORES[0].name;
    keep.textContent = `Keep ${currentName}`;
    keep.addEventListener('click', () => {
      const cb = this.callbacks;
      this.hide();
      cb?.onDismiss();
    });
    actions.appendChild(keep);
    card.appendChild(actions);

    card.appendChild(this.buildCountdown(currentName));
    this.refreshCountdown(currentName);

    modal.open();
  }

  /**
   * Escape or a backdrop tap. `hide()` drops `callbacks` first, so a close the
   * modal itself started (select / keep / timeout) reaches this with nothing
   * left to fire.
   */
  private handleDismiss(): void {
    const cb = this.callbacks;
    if (!cb) return;
    this.hide();
    cb.onDismiss();
  }

  private buildCard(entry: CorePickerCore): HTMLElement {
    const { def, unlocked, current, affordable } = entry;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'blessing-card core-card';
    btn.dataset.coreId = def.id;
    btn.style.setProperty('--bl-color', def.color);
    toggleClass(btn, 'is-locked', !unlocked);
    toggleClass(btn, 'is-current', current);

    const header = document.createElement('div');
    header.className = 'blessing-card-header';
    const name = document.createElement('div');
    name.className = 'blessing-card-name';
    name.appendChild(icon(def.icon, { className: 'blessing-card-icon' }));
    name.appendChild(document.createTextNode(def.name));
    header.appendChild(name);
    const tag = document.createElement('span');
    tag.className = 'blessing-card-rarity';
    tag.textContent = current ? 'current' : unlocked ? 'owned' : `${def.apCost} AP`;
    header.appendChild(tag);
    btn.appendChild(header);

    const tagline = document.createElement('div');
    tagline.className = 'core-card-tagline';
    tagline.textContent = def.tagline;
    btn.appendChild(tagline);

    const stats = document.createElement('div');
    stats.className = 'core-card-stats';
    for (const line of describeCoreStats(def)) {
      const chip = document.createElement('span');
      chip.className = 'core-card-stat';
      toggleClass(chip, 'is-down', line.startsWith('-') || line.startsWith('−'));
      chip.textContent = line;
      stats.appendChild(chip);
    }
    btn.appendChild(stats);

    const shot = document.createElement('div');
    shot.className = 'blessing-card-desc';
    shot.textContent = def.shotText;
    btn.appendChild(shot);

    const foot = document.createElement('div');
    foot.className = 'blessing-card-foot';
    if (unlocked) {
      foot.textContent = current ? 'Running this core' : 'Click to run this core';
    } else {
      foot.textContent = affordable
        ? `Click to unlock for ${def.apCost} AP`
        : `Locked — needs ${def.apCost} AP`;
    }
    btn.appendChild(foot);

    btn.disabled = !unlocked && !affordable;
    btn.addEventListener('click', () => {
      const cb = this.callbacks;
      if (!unlocked) {
        // Unlocking leaves the modal open — the caller re-`show`s with the new
        // AP balance, so the player can buy and then pick in one visit.
        cb?.onUnlock(def.id);
        return;
      }
      this.hide();
      cb?.onSelect(def.id);
    });
    return btn;
  }

  private buildCountdown(currentName: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'blessing-modal-countdown';
    const track = document.createElement('div');
    track.className = 'blessing-modal-countdown-track';
    const fill = document.createElement('div');
    fill.className = 'blessing-modal-countdown-fill';
    track.appendChild(fill);
    wrap.appendChild(track);
    const text = document.createElement('div');
    text.className = 'blessing-modal-countdown-text';
    wrap.appendChild(text);
    this.countdownBar = fill;
    this.countdownLabel = text;
    this.refreshCountdown(currentName);
    return wrap;
  }

  private refreshCountdown(currentName: string): void {
    if (this.countdownLabel) {
      this.countdownLabel.textContent =
        `Keeps ${currentName} in ${Math.max(0, Math.ceil(this.timer))}s`;
    }
    if (this.countdownBar) {
      const ratio = Math.max(0, Math.min(1, this.timer / this.total));
      this.countdownBar.style.transform = `scaleX(${ratio})`;
    }
  }

  /**
   * Advance the countdown on the **wall clock**, for the same reason the
   * blessing draft's is: at 6.5x speed a game-time deadline would give the
   * player three real seconds to read five cards.
   */
  tick(realDt: number, currentName: string): boolean {
    if (!this.modal || !this.callbacks) return false;
    this.timer -= realDt;
    if (this.timer <= 0) {
      const cb = this.callbacks;
      this.hide();
      cb.onDismiss();
      return true;
    }
    this.refreshCountdown(currentName);
    return true;
  }

  hide(): void {
    const modal = this.modal;
    this.modal = null;
    this.callbacks = null;
    modal?.destroy();
    this.timer = 0;
    this.countdownBar = null;
    this.countdownLabel = null;
  }
}
