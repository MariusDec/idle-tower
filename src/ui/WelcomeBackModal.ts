import { formatNumber } from '../utils/bigNumber';
import type { OfflineResult } from '../systems/SaveManager';
import { formatIdleDuration } from '../data/prestige';
import { Modal } from './Modal';
export interface WelcomeBackData {
  result: OfflineResult;
  startWave: number;
  endWave: number;
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.max(0, Math.floor(seconds * 1000))} ms`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.floor(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rem}s`;
  const hours = Math.floor(minutes / 60);
  const min = minutes % 60;
  if (hours < 24) return `${hours}h ${min}m`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return `${days}d ${h}h`;
}

export class WelcomeBackModal {
  private readonly root: HTMLElement;
  private modal: Modal | null = null;
  private onDismiss: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** True while the modal is up — see `UIManager.isModalOpen`. */
  isOpen(): boolean {
    return this.modal !== null;
  }

  show(data: WelcomeBackData, onDismiss: () => void): void {
    this.hide();
    this.onDismiss = onDismiss;
    const dur = formatDuration(data.result.elapsedSeconds);
    // Dismissible: Escape and a backdrop tap mean the same thing as Continue,
    // and the report is only ever information.
    const modal = new Modal({
      id: 'welcome-back',
      title: 'Welcome back!',
      sub: data.result.capped
        ? `You were away for a long time (capped at ${formatIdleDuration(data.result.maxIdleSeconds)}). Your tower kept working for ${dur}.`
        : `You were away for ${dur}. Your tower kept working while you were gone.`,
      width: 440,
      onClose: () => this.dismiss(),
      root: this.root,
    });
    this.modal = modal;
    const card = modal.body;

    const stats = document.createElement('div');
    stats.className = 'welcome-modal-stats';
    const goldStat = document.createElement('div');
    goldStat.className = 'welcome-stat';
    const goldLabel = document.createElement('div');
    goldLabel.className = 'welcome-stat-label';
    goldLabel.textContent = 'Gold earned';
    const goldValue = document.createElement('div');
    goldValue.className = 'welcome-stat-value';
    goldValue.textContent = formatNumber(data.result.goldEarned);
    goldStat.appendChild(goldLabel);
    goldStat.appendChild(goldValue);
    stats.appendChild(goldStat);

    const waveStat = document.createElement('div');
    waveStat.className = 'welcome-stat';
    const waveLabel = document.createElement('div');
    waveLabel.className = 'welcome-stat-label';
    waveLabel.textContent = 'Waves cleared';
    const waveValue = document.createElement('div');
    waveValue.className = 'welcome-stat-value';
    waveValue.textContent = data.result.wavesCleared > 0
      ? `${formatNumber(data.result.wavesCleared)}`
      : '0';
    waveStat.appendChild(waveLabel);
    waveStat.appendChild(waveValue);
    // Only worth a row when the run actually moved: once the walk reaches the
    // player's deepest wave it farms there, and start == end again.
    if (data.endWave > data.startWave) {
      const progressValue = document.createElement('div');
      progressValue.className = 'welcome-stat-sub';
      progressValue.textContent = `wave ${data.startWave} → ${data.endWave}`;
      waveStat.appendChild(progressValue);
    }
    stats.appendChild(waveStat);

    const xpStat = document.createElement('div');
    xpStat.className = 'welcome-stat';
    const xpLabel = document.createElement('div');
    xpLabel.className = 'welcome-stat-label';
    xpLabel.textContent = 'Tower XP earned';
    const xpValue = document.createElement('div');
    xpValue.className = 'welcome-stat-value';
    xpValue.textContent = data.result.xpEarned > 0
      ? `${formatNumber(data.result.xpEarned)}`
      : '0';
    xpStat.appendChild(xpLabel);
    xpStat.appendChild(xpValue);
    stats.appendChild(xpStat);

    card.appendChild(stats);

    const efficiency = document.createElement('p');
    efficiency.className = 'welcome-modal-note';
    const dps = Math.floor(data.result.effectiveDPS);
    efficiency.textContent = `Tower ran at 50% efficiency (≈ ${formatNumber(dps)} effective DPS), `
      + 'with your full gold multiplier applied.';
    card.appendChild(efficiency);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-claim';
    btn.textContent = 'Continue';
    btn.addEventListener('click', () => this.dismiss());
    card.appendChild(btn);

    modal.open();
  }

  hide(): void {
    const modal = this.modal;
    this.modal = null;
    this.onDismiss = null;
    modal?.destroy();
  }

  /**
   * Continue, Escape or a backdrop tap — all one path. `hide()` clears the
   * callback before tearing the shell down, so the `onClose` it triggers
   * re-enters here with nothing left to fire.
   */
  private dismiss(): void {
    const cb = this.onDismiss;
    if (!cb) return;
    this.hide();
    cb();
  }
}
