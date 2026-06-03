import { formatNumber } from '../utils/bigNumber';
import type { OfflineResult } from '../systems/SaveManager';

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
  private currentRoot: HTMLElement | null = null;
  private onDismiss: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  show(data: WelcomeBackData, onDismiss: () => void): void {
    this.hide();
    this.onDismiss = onDismiss;
    const wrap = document.createElement('div');
    wrap.className = 'welcome-modal';
    this.currentRoot = wrap;

    const backdrop = document.createElement('div');
    backdrop.className = 'welcome-modal-backdrop';
    wrap.appendChild(backdrop);

    const card = document.createElement('div');
    card.className = 'welcome-modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Welcome back');

    const title = document.createElement('h2');
    title.className = 'welcome-modal-title';
    title.textContent = 'Welcome back!';
    card.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'welcome-modal-sub';
    const dur = formatDuration(data.result.elapsedSeconds);
    sub.textContent = data.result.capped
      ? `You were away for a long time (capped at 7 days). Your tower kept working for ${dur}.`
      : `You were away for ${dur}. Your tower kept working while you were gone.`;
    card.appendChild(sub);

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
    stats.appendChild(waveStat);

    card.appendChild(stats);

    const efficiency = document.createElement('p');
    efficiency.className = 'welcome-modal-note';
    const dps = Math.floor(data.result.effectiveDPS);
    efficiency.textContent = `Tower ran at 70% efficiency (≈ ${formatNumber(dps)} effective DPS).`;
    card.appendChild(efficiency);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-claim';
    btn.textContent = 'Continue';
    btn.addEventListener('click', () => this.dismiss());
    card.appendChild(btn);

    wrap.appendChild(card);
    this.root.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('is-visible'));
  }

  hide(): void {
    if (this.currentRoot && this.currentRoot.parentNode) {
      this.currentRoot.parentNode.removeChild(this.currentRoot);
    }
    this.currentRoot = null;
    this.onDismiss = null;
  }

  private dismiss(): void {
    const cb = this.onDismiss;
    this.hide();
    if (cb) cb();
  }
}
