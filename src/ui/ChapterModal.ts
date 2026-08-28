import type { IconId } from '../data/icons';
import { WATCH_CHAPTERS, WATCH_UNLOCKS } from '../data/watch';
import { setStyle } from '../utils/dom';
import { renderIcon } from './Icon';
import { Modal } from './Modal';

/**
 * The payload shape `WatchManager.check()` emits on completion
 * (`src/systems/WatchManager.ts`). The queue lives in `UIManager`; this class
 * only renders. Mirrored as a type so `UIManager`'s subscription does not need
 * to depend on the manager's internal types.
 */
export interface ChapterCompletedPayload {
  id: string;
  number: number;
  name: string;
  unlockId: string;
  unlockName: string;
  unlockDescription: string;
  icon: IconId;
  /** Accent colour. Sourced from `WATCH_CHAPTERS` — arrives as data, not a literal. */
  color: string;
  /** Name of the chapter that comes next, or null when this was the last one. */
  next: string | null;
}

/**
 * The "Chapter N complete" modal (plan §6.4).
 *
 * Built on the shared `Modal` shell, like `EnemyCodexModal`. The card shows
 * the chapter's name, flavour, then a large reward block — unlock icon, name,
 * description — and a "what's next" footer that names the following chapter
 * and its reward (or *"The Watch is kept."* if this was the last one).
 *
 * A single `Continue` CTA closes the modal; `UIManager` owns the queueing
 * (it must not stack over a blessing draft or a run summary) and the
 * `Modal.anyOpen()` registry is what makes the queue correct.
 */
export class ChapterModal {
  private modal: Modal | null = null;

  /** True while the modal is up — `UIManager.isModalOpen()` reads this. */
  isOpen(): boolean {
    return this.modal !== null;
  }

  show(payload: ChapterCompletedPayload, onClose?: () => void): void {
    this.hide();
    const chapter = WATCH_CHAPTERS.find(c => c.id === payload.id) ?? null;
    // Chapter 12 → index 11 is the last; everything past is the "watch is kept"
    // footer. The manager already emits `next: null` for the last chapter, but
    // we also accept `null` if the table ever grows past `number`.
    const nextChapter = payload.next !== null
      ? WATCH_CHAPTERS.find(c => c.name === payload.next) ?? null
      : null;
    const unlock = WATCH_UNLOCKS[payload.unlockId as keyof typeof WATCH_UNLOCKS] ?? null;
    const modal = new Modal({
      id: 'chapter-complete',
      title: `Chapter ${payload.number} complete`,
      width: 480,
      dismissible: true,
      // The shell calls `onClose` from its own `close()` so the queue owner
      // learns the card is gone the moment it actually is — the modal API
      // exposes no "onDismiss" of its own.
      onClose,
    });
    this.modal = modal;

    const root = document.createElement('div');
    root.className = 'chapter-modal';

    // ── Heading: chapter name + flavour, in the chapter's accent colour. ──
    const heading = document.createElement('div');
    heading.className = 'chapter-modal-heading';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'chapter-modal-icon';
    renderIcon(iconWrap, payload.icon, { size: 40, tone: 'inherit' });
    // Accent colour arrives as data — the table is the source of truth, the
    // modal just paints with whatever it is told.
    setStyle(heading, 'color', payload.color);
    setStyle(iconWrap, 'color', payload.color);
    heading.appendChild(iconWrap);

    const headingText = document.createElement('div');
    headingText.className = 'chapter-modal-heading-text';
    const nameEl = document.createElement('div');
    nameEl.className = 'chapter-modal-name';
    nameEl.textContent = payload.name;
    headingText.appendChild(nameEl);
    if (chapter) {
      const flavourEl = document.createElement('p');
      flavourEl.className = 'chapter-modal-flavour';
      flavourEl.textContent = chapter.flavour;
      headingText.appendChild(flavourEl);
    }
    heading.appendChild(headingText);
    root.appendChild(heading);

    // ── Reward block: large icon + name + description. ──
    if (unlock) {
      const reward = document.createElement('div');
      reward.className = 'chapter-modal-reward';
      setStyle(reward, 'borderColor', payload.color);

      const rewardIcon = document.createElement('div');
      rewardIcon.className = 'chapter-modal-reward-icon';
      renderIcon(rewardIcon, unlock.icon, { size: 32, tone: 'inherit' });
      setStyle(rewardIcon, 'color', payload.color);
      reward.appendChild(rewardIcon);

      const rewardBody = document.createElement('div');
      rewardBody.className = 'chapter-modal-reward-body';
      const rewardLabel = document.createElement('div');
      rewardLabel.className = 'chapter-modal-reward-label';
      rewardLabel.textContent = 'Unlocked';
      rewardBody.appendChild(rewardLabel);
      const rewardName = document.createElement('div');
      rewardName.className = 'chapter-modal-reward-name';
      rewardName.textContent = unlock.name;
      rewardBody.appendChild(rewardName);
      const rewardDesc = document.createElement('div');
      rewardDesc.className = 'chapter-modal-reward-desc';
      rewardDesc.textContent = unlock.description;
      rewardBody.appendChild(rewardDesc);
      reward.appendChild(rewardBody);
      root.appendChild(reward);
    }

    // ── Footer: what's next, or the final line. ──
    const footer = document.createElement('div');
    footer.className = 'chapter-modal-footer';
    if (nextChapter) {
      const nextReward = WATCH_UNLOCKS[nextChapter.reward];
      const footerLabel = document.createElement('div');
      footerLabel.className = 'chapter-modal-footer-label';
      footerLabel.textContent = "What's next";
      footer.appendChild(footerLabel);
      const footerLine = document.createElement('div');
      footerLine.className = 'chapter-modal-footer-line';
      footerLine.textContent = `Chapter ${nextChapter.number} · ${nextChapter.name}`;
      footer.appendChild(footerLine);
      if (nextReward) {
        const footerReward = document.createElement('div');
        footerReward.className = 'chapter-modal-footer-reward';
        footerReward.textContent = `Reward: ${nextReward.name}`;
        footer.appendChild(footerReward);
      }
    } else {
      const final = document.createElement('div');
      final.className = 'chapter-modal-finale';
      final.textContent = 'The Watch is kept.';
      footer.appendChild(final);
    }
    root.appendChild(footer);

    // ── CTA. ──
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'btn btn-claim chapter-modal-cta';
    cta.textContent = 'Continue';
    cta.addEventListener('click', () => this.hide());
    root.appendChild(cta);

    modal.body.appendChild(root);
    modal.open();
  }

  hide(): void {
    const modal = this.modal;
    this.modal = null;
    modal?.destroy();
  }
}
