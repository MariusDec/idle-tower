import { formatInt, formatNumber } from '../utils/bigNumber';
import type { RunRecord } from '../types';
import { toggleClass } from '../utils/dom';

export interface RunSummaryData {
  record: RunRecord;
  previous: RunRecord | null;
}

function formatDuration(seconds: number): string {
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

function formatDelta(current: number, previous: number | undefined, suffix = ''): { text: string; isPositive: boolean } | null {
  if (previous === undefined || previous === 0) return null;
  const delta = current - previous;
  if (delta === 0) return null;
  const pct = Math.round((delta / previous) * 100);
  const sign = delta > 0 ? '+' : '';
  return {
    text: `${sign}${pct}%${suffix}`,
    isPositive: delta > 0,
  };
}

export class RunSummaryModal {
  private readonly root: HTMLElement;
  private currentRoot: HTMLElement | null = null;
  private onDismiss: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  show(data: RunSummaryData, onDismiss: () => void): void {
    this.hide();
    this.onDismiss = onDismiss;
    const wrap = document.createElement('div');
    wrap.className = 'welcome-modal run-summary-modal';
    this.currentRoot = wrap;

    const backdrop = document.createElement('div');
    backdrop.className = 'welcome-modal-backdrop';
    wrap.appendChild(backdrop);

    const card = document.createElement('div');
    card.className = 'welcome-modal-card run-summary-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Run summary');

    const title = document.createElement('h2');
    title.className = 'welcome-modal-title';
    title.textContent = data.record.kind === 'ascension' ? 'Ascension Complete' : 'Transcendence Complete';
    card.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'welcome-modal-sub';
    const currencyLabel = data.record.kind === 'ascension' ? 'AP gained' : 'TP gained';
    sub.textContent = `Wave ${data.record.highestWave} • ${formatDuration(data.record.durationSeconds)} • +${formatInt(data.record.currencyGained)} ${currencyLabel}`;
    card.appendChild(sub);

    const stats = document.createElement('div');
    stats.className = 'welcome-modal-stats run-summary-stats';
    const items: Array<{ label: string; value: string; prev?: number; cur: number }> = [
      { label: 'Highest Wave', value: formatInt(data.record.highestWave), cur: data.record.highestWave, prev: data.previous?.highestWave },
      { label: 'Run Duration', value: formatDuration(data.record.durationSeconds), cur: data.record.durationSeconds, prev: data.previous?.durationSeconds },
      { label: 'Gold Earned', value: formatNumber(data.record.goldEarned), cur: data.record.goldEarned, prev: data.previous?.goldEarned },
      { label: 'Enemies Killed', value: formatNumber(data.record.enemiesKilled), cur: data.record.enemiesKilled, prev: data.previous?.enemiesKilled },
      { label: 'Ability Casts', value: formatNumber(data.record.abilitiesCast), cur: data.record.abilitiesCast, prev: data.previous?.abilitiesCast },
    ];
    for (const it of items) {
      const cell = document.createElement('div');
      cell.className = 'welcome-stat run-summary-stat';
      const label = document.createElement('div');
      label.className = 'welcome-stat-label';
      label.textContent = it.label;
      const value = document.createElement('div');
      value.className = 'welcome-stat-value';
      value.textContent = it.value;
      cell.appendChild(label);
      cell.appendChild(value);
      const delta = formatDelta(it.cur, it.prev);
      if (delta) {
        const dEl = document.createElement('div');
        dEl.className = `run-summary-delta ${delta.isPositive ? 'is-up' : 'is-down'}`;
        dEl.textContent = `${delta.text} vs last run`;
        cell.appendChild(dEl);
      }
      stats.appendChild(cell);
    }
    card.appendChild(stats);

    if (data.record.newRecordGold || data.record.newRecordWave) {
      const records = document.createElement('div');
      records.className = 'run-summary-records';
      if (data.record.newRecordGold) {
        const r = document.createElement('span');
        r.className = 'run-summary-record';
        r.textContent = '🏆 New gold record!';
        records.appendChild(r);
      }
      if (data.record.newRecordWave) {
        const r = document.createElement('span');
        r.className = 'run-summary-record';
        r.textContent = '🏆 New wave record!';
        records.appendChild(r);
      }
      card.appendChild(records);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-claim';
    btn.textContent = data.record.kind === 'ascension' ? 'Begin new run' : 'Begin new cycle';
    btn.addEventListener('click', () => this.dismiss());
    card.appendChild(btn);

    wrap.appendChild(card);
    this.root.appendChild(wrap);
    requestAnimationFrame(() => toggleClass(wrap, 'is-visible', true));
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
