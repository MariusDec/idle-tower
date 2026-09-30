import { formatInt, formatNumber } from '../utils/bigNumber';
import { Modal } from './Modal';

/**
 * Wall-clock seconds before the run-over prompt auto-selects Retry Wave.
 *
 * §8 / cross-cutting rule 1: nothing in this game blocks on a modal forever.
 * The run is over either way — the player has to say which — but a player who
 * walks away must come back to a live game, not a frozen one. Twenty seconds is
 * enough to read the stats and pick, and short enough that an unattended idle
 * game does not sit dead for the rest of the session.
 */
export const RUN_FAILED_TIMEOUT_SECONDS = 20;

export interface RunFailedData {
  /** Wave the tower fell on. */
  wave: number;
  /** Deepest wave this run reached. */
  highestWave: number;
  /** AP the player would bank by ascending right now. */
  apPreview: number;
  /** Enrage stacks the wave had accumulated when the tower fell. */
  enrageStacks: number;
  /** Gold banked this run, for a sense of what is being reset. */
  goldEarned: number;
  /**
   * Wall-clock seconds before the modal resolves to Retry Wave on its own.
   * Default: {@link RUN_FAILED_TIMEOUT_SECONDS}.
   */
  timeoutSeconds?: number;
}

/**
 * Shown when the tower is destroyed and ascension is available (plan §2.3.3).
 *
 * The point of the modal is that a run now *ends* somewhere instead of
 * stalling forever: the player is told what they earned and offered the
 * ascension immediately, rather than being silently rewound a wave and left
 * to grind a wall they cannot beat.
 *
 * The modal is not dismissible (escape / backdrop tap do nothing) — the run
 * is over either way and the player has to say which. It does, however,
 * auto-resolve to Retry Wave after `timeoutSeconds` of wall-clock time, for
 * the same reason {@link CorePickerModal} and {@link BlessingDraftModal}
 * auto-resolve: an unattended idle session has to keep moving. Research and
 * passive RP continue to tick while the modal is up — see `Game.loop`.
 */
export class RunFailedModal {
  private readonly root: HTMLElement;
  private modal: Modal | null = null;
  private onRetry: (() => void) | null = null;
  private timer = 0;
  private total = 0;
  private countdownLabel: HTMLElement | null = null;
  private countdownBar: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  isOpen(): boolean {
    return this.modal !== null;
  }

  show(data: RunFailedData, onAscend: () => void, onRetry: () => void): void {
    this.hide();
    const timeout = data.timeoutSeconds ?? RUN_FAILED_TIMEOUT_SECONDS;
    this.timer = timeout;
    this.total = Math.max(0.001, timeout);
    this.onRetry = onRetry;
    // Not dismissible: the run is over either way, and the player has to say
    // which way. Escaping out of it would leave the tower dead and the game
    // waiting on a decision nothing else can make. The countdown below is the
    // answer for the player who walks away.
    const modal = new Modal({
      id: 'run-failed',
      title: 'Tower destroyed',
      sub: data.enrageStacks > 0
        ? `Wave ${data.wave} enraged (${data.enrageStacks}×) and overwhelmed the tower.`
          + ' This run has gone as far as it can.'
        : `Wave ${data.wave} overwhelmed the tower.`,
      width: 460,
      dismissible: false,
      root: this.root,
    });
    this.modal = modal;
    modal.cardElement.classList.add('run-failed-card');
    const card = modal.body;

    const stats = document.createElement('div');
    stats.className = 'welcome-modal-stats';
    const stat = (label: string, value: string) => {
      const box = document.createElement('div');
      box.className = 'welcome-stat';
      const l = document.createElement('div');
      l.className = 'welcome-stat-label';
      l.textContent = label;
      const v = document.createElement('div');
      v.className = 'welcome-stat-value';
      v.textContent = value;
      box.appendChild(l);
      box.appendChild(v);
      stats.appendChild(box);
    };
    stat('Deepest wave', formatInt(data.highestWave));
    stat('Gold this run', formatNumber(data.goldEarned));
    stat('Ascend for', `${formatInt(data.apPreview)} AP`);
    card.appendChild(stats);

    const note = document.createElement('p');
    note.className = 'welcome-modal-note';
    note.textContent = 'Ascending banks your AP and restarts the run with permanent bonuses. '
      + 'You can also retry this wave, but nothing about it has changed.';
    card.appendChild(note);

    card.appendChild(this.buildCountdown());

    const actions = document.createElement('div');
    actions.className = 'run-failed-actions';

    const ascendBtn = document.createElement('button');
    ascendBtn.type = 'button';
    ascendBtn.className = 'btn btn-claim';
    ascendBtn.textContent = `Ascend now (+${formatInt(data.apPreview)} AP)`;
    ascendBtn.addEventListener('click', () => {
      this.hide();
      onAscend();
    });
    actions.appendChild(ascendBtn);

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn';
    retryBtn.textContent = `Retry wave ${Math.max(1, data.wave - 1)}`;
    retryBtn.addEventListener('click', () => {
      this.hide();
      onRetry();
    });
    actions.appendChild(retryBtn);

    card.appendChild(actions);
    modal.open();
    this.refreshCountdown();
  }

  /**
   * Advance the countdown on the **wall clock**, for the same reason
   * {@link CorePickerModal.tick} does: at 6.5x speed a 20 s game-time deadline
   * is three real seconds, which is not enough to read the stats and pick.
   *
   * Called from `Game.tickWallClockSystems`, which runs whether or not the
   * simulation is paused for the modal — so the countdown reaches zero on the
   * player's clock even when the wave is dead.
   */
  tick(realDt: number): boolean {
    if (!this.modal || !this.onRetry) return false;
    this.timer -= realDt;
    if (this.timer <= 0) {
      // Mirror CorePickerModal.hide() — drop the retry callback *before*
      // calling it, so a click handler that re-enters `show` lands on a fresh
      // instance instead of this one's leftovers.
      const cb = this.onRetry;
      this.hide();
      cb();
      return true;
    }
    this.refreshCountdown();
    return true;
  }

  hide(): void {
    const modal = this.modal;
    this.modal = null;
    this.onRetry = null;
    modal?.destroy();
    this.timer = 0;
    this.countdownBar = null;
    this.countdownLabel = null;
  }

  private buildCountdown(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'run-failed-countdown';

    const track = document.createElement('div');
    track.className = 'run-failed-countdown-track';
    const fill = document.createElement('div');
    fill.className = 'run-failed-countdown-fill';
    track.appendChild(fill);
    wrap.appendChild(track);

    const text = document.createElement('div');
    text.className = 'run-failed-countdown-text';
    wrap.appendChild(text);

    this.countdownBar = fill;
    this.countdownLabel = text;
    return wrap;
  }

  private refreshCountdown(): void {
    const seconds = Math.max(0, Math.ceil(this.timer));
    if (this.countdownLabel) {
      // Spelling the default action out loud is what makes the countdown
      // feel like a choice the player knows about, not a hidden timeout.
      this.countdownLabel.textContent = `Retry wave in ${seconds}s`;
    }
    if (this.countdownBar) {
      const ratio = Math.max(0, Math.min(1, this.timer / this.total));
      this.countdownBar.style.transform = `scaleX(${ratio})`;
    }
  }
}
