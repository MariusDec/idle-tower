import type { WatchChapterView } from './UIManager';
import { setDisplay, setStyle, setText } from '../utils/dom';
import { renderIcon } from './Icon';

/**
 * The data the chip needs to render one frame. Mirrors the fields the host
 * (`UIManager`) already pulls from `WatchInfo` and `WatchManager.activeProgress`
 * — the host assembles a snapshot once per ~10 Hz tick and the chip decides
 * whether the rebuild path is necessary.
 */
export interface JournalStripInfo {
  /** The chapter currently on the board, or null when all twelve are done. */
  active: WatchChapterView | null;
  /** How many of the chapter's three goals are met. `2 / 3` is the headline. */
  met: number;
  /** Total objectives on the live chapter — always 3 today, but the chip reads it. */
  total: number;
}

export interface JournalStripHandlers {
  /**
   * Returns the chapter-and-progress info the chip paints. `UIManager` already
   * owns the `WatchInfo` closure, so the host is the only place that has to
   * know both the snapshot and the manager's counters.
   */
  getInfo: () => JournalStripInfo;
  /**
   * Opens the Journal tab. On mobile the journal tab lives in the progress
   * group, so the host's implementation opens the bottom-nav sheet for the
   * progress group before landing on the journal tab (plan §6.5).
   */
  onOpenJournal: () => void;
}

const PULSE_SECONDS = 4;

/**
 * The bottom-left "Long Watch" chip (plan §6.5).
 *
 * Sits one row above the milestone strip and shows the live chapter's number,
 * name, and a progress bar that is the mean of the chapter's three objective
 * fills. A click opens the Journal tab.
 *
 * The chip hides itself entirely when every chapter is done — the celebration
 * is the modal, and a perpetual "all twelve done" pill in the corner would
 * just be dead pixels. On mobile the whole slot is hidden, for the same reason
 * the milestone strip's hover-flyout was killed (see `docs/milestones.md`).
 */
export class JournalStrip {
  private readonly root: HTMLElement;
  private readonly handlers: JournalStripHandlers;
  private flashTimer = 0;
  /** Stable signature so we only rebuild the DOM when the active chapter or
   * met-count flips — not on every fill-bar percentage change. */
  private signature = '';
  private collapsedBtn!: HTMLButtonElement;
  private collapsedFill!: HTMLElement;
  private collapsedGlyph!: HTMLElement;
  private collapsedTitle!: HTMLElement;
  private collapsedCount!: HTMLElement;

  constructor(root: HTMLElement, handlers: JournalStripHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.render();
  }

  /**
   * Pulse the chip for a few seconds. Mirrors `MilestoneStrip.flashLastEntry` —
   * it adds the `is-pulse` class that runs `@keyframes milestone-pulse`,
   * shared with the milestone strip so there is only one flourish to tune.
   */
  flashLastEntry(): void {
    if (!this.collapsedBtn) return;
    this.flashTimer = PULSE_SECONDS;
    this.collapsedBtn.classList.remove('is-pulse');
    void this.collapsedBtn.offsetWidth;
    this.collapsedBtn.classList.add('is-pulse');
  }

  /** Per-frame tick from `UIManager`; decrements the pulse timer. */
  update(dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      if (this.flashTimer === 0) {
        this.collapsedBtn.classList.remove('is-pulse');
      }
    }
  }

  /** Pull a fresh snapshot and rebuild only when the chapter or met-count flips. */
  refresh(): void {
    const info = this.handlers.getInfo();
    const sig = `${info.active?.id ?? ''}|${info.met}`;
    if (sig === this.signature) {
      this.refreshProgress();
      return;
    }
    this.signature = sig;
    this.updateCollapsed(info);
    this.refreshProgress();
  }

  // ── private ──

  private updateCollapsed(info: JournalStripInfo): void {
    const active = info.active;
    if (!active) {
      // All chapters done — the celebration modal was the last thing, and a
      // perpetual "N/N" pill in the corner would just be dead pixels.
      setDisplay(this.collapsedBtn, 'none');
      return;
    }
    setDisplay(this.collapsedBtn, '');
    renderIcon(this.collapsedGlyph, active.icon);
    setStyle(this.collapsedGlyph, 'color', active.color);
    setText(this.collapsedTitle, `Ch. ${active.number} · ${active.name}`);
    setText(this.collapsedCount, `${info.met} / ${info.total}`);
  }

  private refreshProgress(): void {
    const info = this.handlers.getInfo();
    const active = info.active;
    if (!active) {
      setStyle(this.collapsedFill, 'width', '0%');
      return;
    }
    // Mean of the three objective fills — what the spec calls "the mean of the
    // three objective fills". Clamping guards against any bad input from the
    // view model.
    let sum = 0;
    for (const g of active.goals) sum += Math.max(0, Math.min(1, g.fill));
    const mean = active.goals.length > 0 ? sum / active.goals.length : 0;
    setStyle(this.collapsedFill, 'width', `${(mean * 100).toFixed(1)}%`);
  }

  private render(): void {
    this.root.innerHTML = '';

    this.collapsedBtn = document.createElement('button');
    this.collapsedBtn.type = 'button';
    this.collapsedBtn.className = 'journal-collapsed-btn';

    const fill = document.createElement('div');
    fill.className = 'journal-collapsed-fill';
    this.collapsedFill = fill;
    this.collapsedBtn.appendChild(fill);

    const content = document.createElement('div');
    content.className = 'journal-collapsed-content';

    const glyph = document.createElement('span');
    glyph.className = 'journal-collapsed-glyph';
    this.collapsedGlyph = glyph;
    content.appendChild(glyph);

    const title = document.createElement('span');
    title.className = 'journal-collapsed-title';
    this.collapsedTitle = title;
    content.appendChild(title);

    const count = document.createElement('span');
    count.className = 'journal-collapsed-count';
    this.collapsedCount = count;
    content.appendChild(count);

    this.collapsedBtn.appendChild(content);
    this.collapsedBtn.addEventListener('click', () => {
      this.handlers.onOpenJournal();
    });

    this.root.appendChild(this.collapsedBtn);
  }
}
