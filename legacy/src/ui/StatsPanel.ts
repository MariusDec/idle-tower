import { formatInt, formatNumber } from '../utils/bigNumber';
import type { RunRecord } from '../types';

export interface StatsPanelHandlers {
  getHistory: () => RunRecord[];
  getCurrentRun: () => { startedAt: number; highestWave: number; goldEarned: number; enemiesKilled: number; abilitiesCast: number; lifetimeAP: number; lifetimeGold: number; lifetimeHighestWave: number; lifetimeAscensions: number; transcendences: number } | null;
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

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

export class StatsPanel {
  private root: HTMLElement | null = null;
  private readonly handlers: StatsPanelHandlers;
  private body: HTMLElement | null = null;

  constructor(handlers: StatsPanelHandlers) {
    this.handlers = handlers;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.renderInto(parent);
  }

  unmount(): void {
    if (this.root) {
      this.root.innerHTML = '';
      this.root = null;
    }
    this.body = null;
  }

  private renderInto(parent: HTMLElement): void {
    const header = document.createElement('h3');
    header.textContent = 'Stats & Run History';
    header.className = 'panel-header';
    parent.appendChild(header);

    const body = document.createElement('div');
    body.className = 'stats-panel-body';
    this.body = body;
    parent.appendChild(body);

    this.refresh();
  }

  update(): void {
    this.refresh();
  }

  private refresh(): void {
    if (!this.body) return;
    this.body.innerHTML = '';

    this.body.appendChild(this.renderCurrent());
    this.body.appendChild(this.renderHistory());
  }

  private renderCurrent(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'stats-current';

    const title = document.createElement('h4');
    title.className = 'stats-section-title';
    title.textContent = 'Current Run';
    section.appendChild(title);

    const run = this.handlers.getCurrentRun();
    if (!run) {
      const empty = document.createElement('div');
      empty.className = 'stats-empty';
      empty.textContent = 'No active run.';
      section.appendChild(empty);
      return section;
    }

    const elapsed = Math.max(0, Math.floor((Date.now() - run.startedAt) / 1000));
    const grid = document.createElement('div');
    grid.className = 'stats-grid';
    const items: Array<[string, string]> = [
      ['Time', formatDuration(elapsed)],
      ['Highest Wave', formatInt(run.highestWave)],
      ['Lifetime Highest', formatInt(run.lifetimeHighestWave)],
      ['Gold Earned (this run)', formatNumber(run.goldEarned)],
      ['Kills (this run)', formatNumber(run.enemiesKilled)],
      ['Abilities Cast', formatNumber(run.abilitiesCast)],
      ['Lifetime Gold', formatNumber(run.lifetimeGold)],
      ['Lifetime AP', formatNumber(run.lifetimeAP)],
      ['Ascensions', formatInt(run.lifetimeAscensions)],
      ['Transcendences', formatInt(run.transcendences)],
    ];
    for (const [label, value] of items) {
      const cell = document.createElement('div');
      cell.className = 'stats-cell';
      const l = document.createElement('div');
      l.className = 'stats-cell-label';
      l.textContent = label;
      const v = document.createElement('div');
      v.className = 'stats-cell-value';
      v.textContent = value;
      cell.appendChild(l);
      cell.appendChild(v);
      grid.appendChild(cell);
    }
    section.appendChild(grid);
    return section;
  }

  private renderHistory(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'stats-history';

    const title = document.createElement('h4');
    title.className = 'stats-section-title';
    title.textContent = 'Run History';
    section.appendChild(title);

    const history = this.handlers.getHistory();
    if (history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'stats-empty';
      empty.textContent = 'No completed runs yet. Ascend or Transcend to record a run.';
      section.appendChild(empty);
      return section;
    }

    const wrap = document.createElement('div');
    wrap.className = 'stats-history-list';
    // Newest first
    const ordered = [...history].reverse();
    for (const r of ordered) {
      wrap.appendChild(this.renderHistoryRow(r));
    }
    section.appendChild(wrap);
    return section;
  }

  private renderHistoryRow(r: RunRecord): HTMLElement {
    const row = document.createElement('div');
    row.className = `stats-history-row stats-history-${r.kind}`;
    const header = document.createElement('div');
    header.className = 'stats-history-header';
    const kindLabel = r.kind === 'ascension' ? 'Ascension' : 'Transcendence';
    const headerLeft = document.createElement('span');
    headerLeft.className = 'stats-history-kind';
    headerLeft.textContent = kindLabel;
    const headerRight = document.createElement('span');
    headerRight.className = 'stats-history-date';
    headerRight.textContent = formatDate(r.endedAt);
    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    row.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'stats-history-grid';
    const items: Array<[string, string]> = [
      ['Wave', formatInt(r.highestWave)],
      ['Time', formatDuration(r.durationSeconds)],
      ['Gold', formatNumber(r.goldEarned)],
      ['Kills', formatNumber(r.enemiesKilled)],
      ['Casts', formatNumber(r.abilitiesCast)],
    ];
    if (r.kind === 'ascension') {
      items.push(['AP + RP', `+${formatInt(r.currencyGained)} / +${formatInt(r.rpGained)}`]);
    } else {
      items.push(['TP', `+${formatInt(r.currencyGained)}`]);
    }
    for (const [label, value] of items) {
      const cell = document.createElement('div');
      cell.className = 'stats-history-cell';
      const l = document.createElement('div');
      l.className = 'stats-history-cell-label';
      l.textContent = label;
      const v = document.createElement('div');
      v.className = 'stats-history-cell-value';
      v.textContent = value;
      cell.appendChild(l);
      cell.appendChild(v);
      grid.appendChild(cell);
    }
    row.appendChild(grid);

    if (r.newRecordGold || r.newRecordWave) {
      const records = document.createElement('div');
      records.className = 'stats-history-records';
      if (r.newRecordGold) records.appendChild(this.makeBadge('🏆 Gold record'));
      if (r.newRecordWave) records.appendChild(this.makeBadge('🏆 Wave record'));
      row.appendChild(records);
    }

    return row;
  }

  private makeBadge(text: string): HTMLElement {
    const b = document.createElement('span');
    b.className = 'run-summary-record';
    b.textContent = text;
    return b;
  }
}
