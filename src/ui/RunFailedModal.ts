import { formatInt, formatNumber } from '../utils/bigNumber';
import { toggleClass } from '../utils/dom';

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
}

/**
 * Shown when the tower is destroyed and ascension is available (plan §2.3.3).
 *
 * The point of the modal is that a run now *ends* somewhere instead of
 * stalling forever: the player is told what they earned and offered the
 * ascension immediately, rather than being silently rewound a wave and left
 * to grind a wall they cannot beat.
 */
export class RunFailedModal {
  private readonly root: HTMLElement;
  private currentRoot: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  isOpen(): boolean {
    return this.currentRoot !== null;
  }

  show(data: RunFailedData, onAscend: () => void, onRetry: () => void): void {
    this.hide();
    const wrap = document.createElement('div');
    wrap.className = 'welcome-modal run-failed-modal';
    this.currentRoot = wrap;

    const backdrop = document.createElement('div');
    backdrop.className = 'welcome-modal-backdrop';
    wrap.appendChild(backdrop);

    const card = document.createElement('div');
    card.className = 'welcome-modal-card run-failed-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Run over');

    const title = document.createElement('h2');
    title.className = 'welcome-modal-title';
    title.textContent = 'Tower destroyed';
    card.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'welcome-modal-sub';
    sub.textContent = data.enrageStacks > 0
      ? `Wave ${data.wave} enraged (${data.enrageStacks}×) and overwhelmed the tower. This run has gone as far as it can.`
      : `Wave ${data.wave} overwhelmed the tower.`;
    card.appendChild(sub);

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
    wrap.appendChild(card);
    this.root.appendChild(wrap);
    requestAnimationFrame(() => toggleClass(wrap, 'is-visible', true));
  }

  hide(): void {
    if (this.currentRoot && this.currentRoot.parentNode) {
      this.currentRoot.parentNode.removeChild(this.currentRoot);
    }
    this.currentRoot = null;
  }
}
