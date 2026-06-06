import type { MilestoneDef } from '../data/milestones';
import { TRANSCENDENCE_UNLOCK_AP } from '../data/prestige';
import { setDisplay, setStyle, setText, setTitle, toggleClass } from '../utils/dom';

export interface MilestoneStripHandlers {
  /**
   * Returns the player's current progress info used to drive the fill bars:
   * - `currentWave`: highest wave reached this run
   * - `apThisCycle`: AP accumulated this transcendence cycle (0 if not yet transcended)
   */
  getProgress: () => { currentWave: number; apThisCycle: number };
  /**
   * Returns the next milestones to show. Implementing this in the host avoids
   * duplicating milestone-source knowledge here.
   */
  getUpcoming: () => MilestoneDef[];
}

interface EntryEls {
  wrap: HTMLElement;
  fill: HTMLElement;
  glyph: HTMLElement;
  label: HTMLElement;
  detail: HTMLElement;
  waveTag: HTMLElement;
}

const MAX_VISIBLE_ENTRIES = 3;

/**
 * Compact, hover-expandable "what's next" panel. By default a single pill is
 * visible (showing the *next* milestone with a progress fill that grows as
 * the player advances). Hovering reveals the full upcoming list of up to
 * 3 milestones, each with its own progress fill.
 */
export class MilestoneStrip {
  private readonly root: HTMLElement;
  private readonly handlers: MilestoneStripHandlers;
  private entries: EntryEls[] = [];
  private announcedSet: Set<string> = new Set();
  private flashTimer = 0;
  private latestToFlash = -1;
  private hoverContainer!: HTMLElement;
  private isHovered = false;
  private hoverTimer = 0;
  private collapsedBtn!: HTMLButtonElement;
  private collapsedFill!: HTMLElement;
  private collapsedWaveTag!: HTMLElement;
  private collapsedGlyph!: HTMLElement;
  private collapsedLabel!: HTMLElement;

  constructor(root: HTMLElement, handlers: MilestoneStripHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.root.classList.add('milestone-strip-root');
    this.render();
  }

  /**
   * Mark the last (rightmost) entry as just-triggered so it pulses.
   * Called by the host immediately after a milestone wave is reached.
   */
  flashLastEntry(): void {
    if (this.entries.length === 0) return;
    const idx = this.entries.length - 1;
    this.flashTimer = 4;
    this.latestToFlash = idx;
    const entry = this.entries[idx];
    if (!entry) return;
    entry.wrap.classList.remove('is-pulse');
    void entry.wrap.offsetWidth;
    entry.wrap.classList.add('is-pulse');
  }

  update(dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      if (this.flashTimer === 0 && this.latestToFlash >= 0) {
        const entry = this.entries[this.latestToFlash];
        if (entry) entry.wrap.classList.remove('is-pulse');
        this.latestToFlash = -1;
      }
    }
    if (this.hoverTimer > 0) {
      this.hoverTimer = Math.max(0, this.hoverTimer - dt);
      if (this.hoverTimer === 0 && !this.isHovered) {
        toggleClass(this.hoverContainer, 'is-open', false);
      }
    }
    this.refreshProgress();
  }

  refresh(): void {
    const upcoming = this.handlers.getUpcoming();
    const upcomingIds = new Set(upcoming.map(m => m.id));
    // Detect whether the set of upcoming milestones has changed since the
    // last rebuild AND whether any previously-announced milestone was reached.
    let reachedOne = false;
    let sameSet = upcomingIds.size === this.announcedSet.size;
    for (const prev of this.announcedSet) {
      if (!upcomingIds.has(prev)) {
        reachedOne = true;
        sameSet = false;
        break;
      }
    }
    // Early-out: nothing to rebuild — just refresh the progress bar widths.
    // This skips the per-UI-tick innerHTML teardown/rebuild of up to 3
    // milestone entries, which was the single biggest per-frame DOM cost in
    // the project.
    if (sameSet) {
      this.refreshProgress();
      return;
    }
    this.entries = [];
    this.hoverContainer.innerHTML = '';
    if (upcoming.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'milestone-empty';
      empty.textContent = 'No upcoming milestones';
      this.hoverContainer.appendChild(empty);
      this.announcedSet.clear();
      this.updateCollapsed(null);
      this.refreshProgress();
      return;
    }
    const limited = upcoming.slice(0, MAX_VISIBLE_ENTRIES);
    for (let i = 0; i < limited.length; i++) {
      const m = limited[i];
      if (!m) continue;
      this.hoverContainer.appendChild(this.renderEntry(m, i === 0));
    }
    this.updateCollapsed(limited[0] ?? null);
    this.refreshProgress();
    if (reachedOne) {
      this.flashLastEntry();
    }
    this.announcedSet = upcomingIds;
  }

  private updateCollapsed(next: MilestoneDef | null): void {
    if (!next) {
      setDisplay(this.collapsedBtn, 'none');
      return;
    }
    setDisplay(this.collapsedBtn, '');
    setText(this.collapsedWaveTag, next.wave > 0 ? `Wave ${next.wave}` : this.kindLabel(next.kind));
    setText(this.collapsedLabel, next.label);
    setText(this.collapsedGlyph, next.glyph);
    setStyle(this.collapsedGlyph, 'color', next.color);
    setTitle(this.collapsedBtn, `${next.label} — ${next.detail}`);
  }

  private render(): void {
    this.root.innerHTML = '';

    this.collapsedBtn = document.createElement('button');
    this.collapsedBtn.type = 'button';
    this.collapsedBtn.className = 'milestone-collapsed-btn';
    this.collapsedBtn.setAttribute('aria-label', 'Show upcoming milestones');

    const collapsedFill = document.createElement('div');
    collapsedFill.className = 'milestone-collapsed-fill';
    this.collapsedFill = collapsedFill;
    this.collapsedBtn.appendChild(collapsedFill);

    const collapsedContent = document.createElement('div');
    collapsedContent.className = 'milestone-collapsed-content';

    const collapsedGlyph = document.createElement('span');
    collapsedGlyph.className = 'milestone-collapsed-glyph';
    this.collapsedGlyph = collapsedGlyph;
    collapsedContent.appendChild(collapsedGlyph);

    const collapsedTextCol = document.createElement('div');
    collapsedTextCol.className = 'milestone-collapsed-textcol';
    const collapsedWaveTag = document.createElement('span');
    collapsedWaveTag.className = 'milestone-collapsed-wave';
    this.collapsedWaveTag = collapsedWaveTag;
    collapsedTextCol.appendChild(collapsedWaveTag);
    const collapsedLabel = document.createElement('span');
    collapsedLabel.className = 'milestone-collapsed-label';
    this.collapsedLabel = collapsedLabel;
    collapsedTextCol.appendChild(collapsedLabel);
    collapsedContent.appendChild(collapsedTextCol);

    this.collapsedBtn.appendChild(collapsedContent);

    this.hoverContainer = document.createElement('div');
    this.hoverContainer.className = 'milestone-strip';

    this.collapsedBtn.addEventListener('mouseenter', () => {
      this.isHovered = true;
      this.hoverTimer = 0;
      toggleClass(this.hoverContainer, 'is-open', true);
    });
    this.collapsedBtn.addEventListener('mouseleave', () => {
      this.isHovered = false;
      this.hoverTimer = 0.25;
    });
    this.hoverContainer.addEventListener('mouseenter', () => {
      this.isHovered = true;
      this.hoverTimer = 0;
      toggleClass(this.hoverContainer, 'is-open', true);
    });
    this.hoverContainer.addEventListener('mouseleave', () => {
      this.isHovered = false;
      this.hoverTimer = 0.25;
    });

    this.root.appendChild(this.collapsedBtn);
    this.root.appendChild(this.hoverContainer);
    this.refresh();
  }

  private renderEntry(m: MilestoneDef, isNext: boolean): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = `milestone-entry${isNext ? ' is-next' : ''}`;
    wrap.dataset.kind = m.kind;
    wrap.dataset.milestoneId = m.id;

    const fill = document.createElement('div');
    fill.className = 'milestone-entry-fill';
    wrap.appendChild(fill);

    const glyph = document.createElement('div');
    glyph.className = 'milestone-entry-glyph';
    glyph.textContent = m.glyph;
    setStyle(glyph, 'color', m.color);

    const body = document.createElement('div');
    body.className = 'milestone-entry-body';
    const waveRow = document.createElement('div');
    waveRow.className = 'milestone-entry-row';
    const waveTag = document.createElement('span');
    waveTag.className = 'milestone-entry-wave';
    waveTag.textContent = m.wave > 0 ? `Wave ${m.wave}` : this.kindLabel(m.kind);
    const label = document.createElement('span');
    label.className = 'milestone-entry-label';
    label.textContent = m.label;
    waveRow.appendChild(waveTag);
    waveRow.appendChild(label);
    body.appendChild(waveRow);
    const detail = document.createElement('div');
    detail.className = 'milestone-entry-detail';
    detail.textContent = m.detail;
    body.appendChild(detail);

    wrap.appendChild(glyph);
    wrap.appendChild(body);

    this.entries.push({ wrap, fill, glyph, label, detail, waveTag });
    return wrap;
  }

  private refreshProgress(): void {
    const progress = this.handlers.getProgress();
    const upcoming = this.handlers.getUpcoming();
    const limited = upcoming.slice(0, MAX_VISIBLE_ENTRIES);
    let prevWave = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const def = limited[i];
      if (!entry) continue;
      const fillPct = this.computeFill(def ?? null, prevWave, progress);
      setStyle(entry.fill, 'width', `${(fillPct * 100).toFixed(1)}%`);
      if (def && def.wave > 0) prevWave = def.wave;
    }
    const collapsedDef = limited[0];
    if (collapsedDef) {
      const collapsedPct = this.computeFill(collapsedDef, 0, progress);
      setStyle(this.collapsedFill, 'width', `${(collapsedPct * 100).toFixed(1)}%`);
    } else {
      setStyle(this.collapsedFill, 'width', '0%');
    }
  }

  private computeFill(
    m: MilestoneDef | null,
    prevWave: number,
    progress: { currentWave: number; apThisCycle: number },
  ): number {
    if (!m) return 0;
    if (m.wave === 0) {
      const target = TRANSCENDENCE_UNLOCK_AP;
      if (target <= 0) return 0;
      return Math.max(0, Math.min(1, progress.apThisCycle / target));
    }
    const start = Math.max(1, prevWave);
    const end = m.wave;
    if (end <= start) return 1;
    return Math.max(0, Math.min(1, (progress.currentWave - start) / (end - start)));
  }

  private kindLabel(kind: string): string {
    switch (kind) {
      case 'mana': return 'Wave 10';
      case 'ascension': return 'Wave 20';
      case 'transcendence': return `${TRANSCENDENCE_UNLOCK_AP} AP`;
      case 'ability': return 'Ability';
      case 'enemy': return 'Enemy';
      case 'research': return 'Research';
      default: return 'Soon';
    }
  }
}
