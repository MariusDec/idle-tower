import { formatInt } from '../utils/bigNumber';
import { setText, toggleClass } from '../utils/dom';

export interface RunStalledData {
  /** Wave that has overrun and started enraging. */
  wave: number;
  /** AP the player would bank by ascending right now. */
  apPreview: number;
}

/**
 * Non-blocking "this run has stalled" prompt (plan §4.3).
 *
 * Enrage already guarantees a stalled wave eventually *ends* the run, but the
 * player has no reason to sit through that once the wall is obvious. This
 * banner names the moment the wave overran and offers the ascension inline,
 * so the run has a visible off-ramp rather than a silent grind. It is
 * deliberately not a modal: the player may well beat the wave, and stopping
 * the game to ask would punish them for trying.
 */
export class RunStalledBanner {
  private readonly root: HTMLElement;
  private wrap: HTMLElement | null = null;
  private messageEl: HTMLElement | null = null;
  private ascendBtn: HTMLButtonElement | null = null;
  private onAscend: (() => void) | null = null;
  /** Wave the player dismissed, so it does not immediately reappear. */
  private dismissedWave = -1;
  /** Wave currently being advertised, so the dismiss button knows what it mutes. */
  private currentWave = -1;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  setOnAscend(handler: () => void): void {
    this.onAscend = handler;
  }

  show(data: RunStalledData): void {
    if (data.wave === this.dismissedWave) return;
    this.currentWave = data.wave;
    if (!this.wrap) this.render();
    if (!this.wrap || !this.messageEl || !this.ascendBtn) return;
    setText(
      this.messageEl,
      `Wave ${data.wave} has outrun its clock and is enraging. This run has gone as far as it can.`,
    );
    setText(this.ascendBtn, `Ascend now (+${formatInt(data.apPreview)} AP)`);
    toggleClass(this.wrap, 'is-visible', true);
  }

  /** Hide without marking the wave dismissed (used when the wave changes). */
  hide(): void {
    if (this.wrap) toggleClass(this.wrap, 'is-visible', false);
  }

  /** Called when a new wave starts, so the next stall can prompt again. */
  reset(): void {
    this.dismissedWave = -1;
    this.hide();
  }

  private render(): void {
    const wrap = document.createElement('div');
    wrap.className = 'run-stalled-banner';
    wrap.setAttribute('role', 'status');

    const body = document.createElement('div');
    body.className = 'run-stalled-body';

    const title = document.createElement('div');
    title.className = 'run-stalled-title';
    title.textContent = 'Run stalled';
    body.appendChild(title);

    const message = document.createElement('div');
    message.className = 'run-stalled-message';
    this.messageEl = message;
    body.appendChild(message);
    wrap.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'run-stalled-actions';

    const ascendBtn = document.createElement('button');
    ascendBtn.type = 'button';
    ascendBtn.className = 'btn btn-claim';
    ascendBtn.addEventListener('click', () => {
      this.hide();
      if (this.onAscend) this.onAscend();
    });
    this.ascendBtn = ascendBtn;
    actions.appendChild(ascendBtn);

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'run-stalled-dismiss';
    dismissBtn.setAttribute('aria-label', 'Dismiss');
    dismissBtn.textContent = '×';
    dismissBtn.addEventListener('click', () => {
      this.dismissedWave = this.currentWave;
      this.hide();
    });
    actions.appendChild(dismissBtn);

    wrap.appendChild(actions);
    this.root.appendChild(wrap);
    this.wrap = wrap;
  }
}
