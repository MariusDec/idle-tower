import type { MilestoneDef } from '../data/milestones';
import { TRANSCENDENCE_UNLOCK_AP } from '../data/prestige';
import { setDisplay, setStyle, setText, setTitle } from '../utils/dom';
import { renderIcon } from './Icon';

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
  /**
   * Opens the Progression tab. Wired by UIManager — the pill is a button that
   * deep-links into the full milestone list, which is the canonical home of
   * every milestone (plans/stats.md Part B).
   */
  onOpenProgression: () => void;
}

const PULSE_SECONDS = 4;

/**
 * Compact "what's next" pill. Shows the next milestone with a progress fill
 * that grows as the player advances, and on click opens the Progression tab,
 * which lists every milestone in full.
 *
 * The pill replaces the earlier hover-flyout: the flyout covered the play
 * area, swallowed pointer events around the bottom-left corner, and
 * duplicated the Progression tab.
 */
export class MilestoneStrip {
  private readonly root: HTMLElement;
  private readonly handlers: MilestoneStripHandlers;
  private announcedSet: Set<string> = new Set();
  private flashTimer = 0;
  private collapsedBtn!: HTMLButtonElement;
  private collapsedFill!: HTMLElement;
  private collapsedWaveTag!: HTMLElement;
  private collapsedGlyph!: HTMLElement;
  private collapsedLabel!: HTMLElement;

  constructor(root: HTMLElement, handlers: MilestoneStripHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.render();
  }

  /**
   * Pulse the pill for a few seconds (the same green-ring flourish the old
   * flyout used). Called by the host when a milestone wave is reached.
   */
  flashLastEntry(): void {
    if (!this.collapsedBtn) return;
    this.flashTimer = PULSE_SECONDS;
    this.collapsedBtn.classList.remove('is-pulse');
    void this.collapsedBtn.offsetWidth;
    this.collapsedBtn.classList.add('is-pulse');
  }

  update(dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      if (this.flashTimer === 0) {
        this.collapsedBtn.classList.remove('is-pulse');
      }
    }
    this.refreshProgress();
  }

  refresh(): void {
    const upcoming = this.handlers.getUpcoming();
    const upcomingIds = new Set(upcoming.map(m => m.id));
    // Early-out when the upcoming set is unchanged. The first ~10 Hz UI tick
    // where this matters is the per-frame `update()` call path.
    if (upcomingIds.size === this.announcedSet.size) {
      let sameSet = true;
      for (const prev of this.announcedSet) {
        if (!upcomingIds.has(prev)) {
          sameSet = false;
          break;
        }
      }
      if (sameSet) {
        this.refreshProgress();
        return;
      }
    }
    this.updateCollapsed(upcoming[0] ?? null);
    this.refreshProgress();
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
    renderIcon(this.collapsedGlyph, next.icon);
    setStyle(this.collapsedGlyph, 'color', next.color);
    setTitle(this.collapsedBtn, `${next.label} — ${next.detail}. Open Progression.`);
    this.collapsedBtn.setAttribute('aria-label', `Next milestone: ${next.label}. Open Progression.`);
  }

  private render(): void {
    this.root.innerHTML = '';

    this.collapsedBtn = document.createElement('button');
    this.collapsedBtn.type = 'button';
    this.collapsedBtn.className = 'milestone-collapsed-btn';

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

    this.collapsedBtn.addEventListener('click', () => {
      this.handlers.onOpenProgression();
    });

    this.root.appendChild(this.collapsedBtn);
  }

  private refreshProgress(): void {
    const progress = this.handlers.getProgress();
    const upcoming = this.handlers.getUpcoming();
    const next = upcoming[0];
    if (next) {
      const pct = this.computeFill(next, 0, progress);
      setStyle(this.collapsedFill, 'width', `${(pct * 100).toFixed(1)}%`);
    } else {
      setStyle(this.collapsedFill, 'width', '0%');
    }
  }

  private computeFill(
    m: MilestoneDef,
    prevWave: number,
    progress: { currentWave: number; apThisCycle: number },
  ): number {
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
