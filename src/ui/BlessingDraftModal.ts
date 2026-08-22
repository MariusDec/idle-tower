import { Modal } from './Modal';
import {
  BLESSING_RARITY_COLORS,
  describeBlessing,
  type BlessingDef,
} from '../data/blessings';
import { iconFrame } from './Icon';

export interface BlessingDraftData {
  /** Wave that was just cleared — the draft is the reward for it. */
  wave: number;
  offers: readonly BlessingDef[];
  /** Everything the run already holds, for the "your build" strip. */
  held: ReadonlyArray<{ def: BlessingDef; stacks: number }>;
  picksTaken: number;
  maxPicks: number;
  /** Free rerolls plus banked tokens. */
  rerolls: number;
  /** Whether auto-pick is on (forced or chosen), for the checkbox state. */
  autoPick: boolean;
  /** True when auto-pick cannot be turned off (tab hidden / auto-buy unlocked). */
  autoPickForced: boolean;
  /** Wall-clock seconds until the draft resolves itself. */
  timeoutSeconds: number;
}

export interface BlessingDraftCallbacks {
  onChoose: (id: string) => void;
  onSkip: () => void;
  onReroll: () => void;
  /** Fired when the countdown runs out; the caller decides what to take. */
  onAutoPick: () => void;
  onToggleAutoPick: (enabled: boolean) => void;
}

/**
 * The draft picker (plan §1.4).
 *
 * Modelled on `WaveModifierModal` — same backdrop, same card grid, same
 * `onChoose`/`onSkip` contract — with one difference that matters: this modal
 * pauses the **intermission timer only**. The simulation keeps running
 * underneath it, and every exit path (choose, skip, auto-pick, reroll-then-pick)
 * goes back through the caller, which owns the un-pause. See
 * `docs/wave-modifier-system.md` for why that obligation is spelled out rather
 * than assumed.
 *
 * The countdown is never off: with auto-pick enabled it is 20 s, and without it
 * a long safety timeout. An unattended game must not stall on a modal
 * (cross-cutting rule 1), and "the player walked away mid-draft" is exactly the
 * case where it would.
 */
export class BlessingDraftModal {
  private readonly root: HTMLElement;
  private modal: Modal | null = null;
  private callbacks: BlessingDraftCallbacks | null = null;
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

  show(data: BlessingDraftData, callbacks: BlessingDraftCallbacks): void {
    this.hide();
    this.callbacks = callbacks;
    this.timer = data.timeoutSeconds;
    this.total = Math.max(0.001, data.timeoutSeconds);

    // Escape and a backdrop tap skip the pick, which is what the Skip button
    // does and what the caller already knows how to un-pause from.
    const modal = new Modal({
      id: 'blessing-draft',
      title: 'Choose a Blessing',
      sub: `Wave ${data.wave} cleared · pick ${data.picksTaken + 1} of ${data.maxPicks}`
        + ' · blessings last until you ascend.',
      width: 760,
      onClose: () => this.handleDismiss(),
      root: this.root,
    });
    this.modal = modal;
    const card = modal.body;

    const grid = document.createElement('div');
    grid.className = 'blessing-modal-grid';
    if (data.offers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'blessing-modal-empty';
      empty.textContent = 'Nothing left to offer — every blessing you can take is already maxed.';
      grid.appendChild(empty);
    }
    for (const def of data.offers) {
      grid.appendChild(this.buildCard(def, data));
    }
    card.appendChild(grid);

    card.appendChild(this.buildActions(data));
    card.appendChild(this.buildHeldStrip(data));
    card.appendChild(this.buildAutoRow(data));
    card.appendChild(this.buildCountdown());

    this.refreshCountdown();

    modal.open();
  }

  /**
   * Escape or a backdrop tap. Every other exit clears `callbacks` in `hide()`
   * before the shell closes, so those re-enter here as a no-op.
   */
  private handleDismiss(): void {
    const cb = this.callbacks;
    if (!cb) return;
    this.hide();
    cb.onSkip();
  }

  private buildCard(def: BlessingDef, data: BlessingDraftData): HTMLElement {
    const heldStacks = data.held.find(h => h.def.id === def.id)?.stacks ?? 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'blessing-card';
    btn.dataset.blessingId = def.id;
    btn.style.setProperty('--bl-color', BLESSING_RARITY_COLORS[def.rarity]);

    const header = document.createElement('div');
    header.className = 'blessing-card-header';
    // The rarity frame (§8.E): the tier reads from the frame's tint and corner
    // notch, so it survives a player who cannot separate the border hues.
    header.appendChild(iconFrame(def.icon, {
      variant: 'item',
      rarity: def.rarity,
      className: 'blessing-card-frame',
    }));
    const name = document.createElement('div');
    name.className = 'blessing-card-name';
    name.textContent = def.name;
    header.appendChild(name);
    const rarity = document.createElement('span');
    rarity.className = 'blessing-card-rarity';
    rarity.textContent = def.rarity;
    header.appendChild(rarity);
    btn.appendChild(header);

    const desc = document.createElement('div');
    desc.className = 'blessing-card-desc';
    // Show what taking it would mean, not what one stack is worth in isolation.
    desc.textContent = describeBlessing(def, heldStacks + 1);
    btn.appendChild(desc);

    const foot = document.createElement('div');
    foot.className = 'blessing-card-foot';
    foot.textContent = def.maxStacks > 1
      ? `${heldStacks} / ${def.maxStacks} stacks held`
      : heldStacks > 0 ? 'Held' : 'New';
    btn.appendChild(foot);

    btn.addEventListener('click', () => {
      const cb = this.callbacks;
      this.hide();
      cb?.onChoose(def.id);
    });
    return btn;
  }

  private buildActions(data: BlessingDraftData): HTMLElement {
    const row = document.createElement('div');
    row.className = 'blessing-modal-actions';

    const reroll = document.createElement('button');
    reroll.type = 'button';
    reroll.className = 'btn blessing-reroll-btn';
    reroll.textContent = data.rerolls > 0 ? `Reroll (${data.rerolls})` : 'Reroll (0)';
    reroll.disabled = data.rerolls <= 0 || data.offers.length === 0;
    reroll.addEventListener('click', () => {
      // The caller redraws by calling `show` again with the new offer, so the
      // modal never has to know how the pool works.
      this.callbacks?.onReroll();
    });
    row.appendChild(reroll);

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn blessing-skip-btn';
    skip.textContent = 'Skip';
    skip.addEventListener('click', () => {
      const cb = this.callbacks;
      this.hide();
      cb?.onSkip();
    });
    row.appendChild(skip);

    return row;
  }

  private buildHeldStrip(data: BlessingDraftData): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'blessing-held-strip';
    const label = document.createElement('span');
    label.className = 'blessing-held-label';
    label.textContent = 'Your build:';
    wrap.appendChild(label);
    if (data.held.length === 0) {
      const none = document.createElement('span');
      none.className = 'blessing-held-empty';
      none.textContent = 'nothing yet';
      wrap.appendChild(none);
      return wrap;
    }
    for (const { def, stacks } of data.held) {
      const chip = document.createElement('span');
      chip.className = 'blessing-held-chip';
      chip.style.setProperty('--bl-color', BLESSING_RARITY_COLORS[def.rarity]);
      chip.textContent = stacks > 1 ? `${def.name} ×${stacks}` : def.name;
      chip.title = describeBlessing(def, stacks);
      wrap.appendChild(chip);
    }
    return wrap;
  }

  private buildAutoRow(data: BlessingDraftData): HTMLElement {
    const row = document.createElement('div');
    row.className = 'blessing-modal-auto';
    const label = document.createElement('label');
    label.className = 'blessing-modal-auto-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = data.autoPick;
    input.disabled = data.autoPickForced;
    input.addEventListener('change', () => this.callbacks?.onToggleAutoPick(input.checked));
    label.appendChild(input);
    const text = document.createElement('span');
    text.textContent = data.autoPickForced
      ? 'Auto-pick (forced on while automation is running)'
      : 'Auto-pick blessings for me';
    label.appendChild(text);
    row.appendChild(label);
    return row;
  }

  private buildCountdown(): HTMLElement {
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
    return wrap;
  }

  private refreshCountdown(): void {
    if (this.countdownLabel) {
      this.countdownLabel.textContent = `Auto-picks in ${Math.max(0, Math.ceil(this.timer))}s`;
    }
    if (this.countdownBar) {
      const ratio = Math.max(0, Math.min(1, this.timer / this.total));
      this.countdownBar.style.transform = `scaleX(${ratio})`;
    }
  }

  /**
   * Advance the countdown on the **wall clock**, not the simulation clock: at
   * 6.5x speed a 20 s game-time deadline would fire in three real seconds,
   * which is not enough time to read three cards.
   */
  tick(realDt: number): boolean {
    if (!this.modal || !this.callbacks) return false;
    this.timer -= realDt;
    if (this.timer <= 0) {
      const cb = this.callbacks;
      this.hide();
      cb.onAutoPick();
      return true;
    }
    this.refreshCountdown();
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
