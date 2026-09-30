import { setText, toggleClass } from '../utils/dom';

/**
 * The "click to place it" banner (gameplay plan §4.3).
 *
 * Placement mode is a *modal input state* — the next canvas click means
 * something different from usual — and the one thing an input state must never
 * be is invisible. This is a strip rather than a dialog for the same reason
 * `RunStalledBanner` is: the game keeps running underneath it, and stopping the
 * simulation to ask where the meteor goes would break the idle contract that
 * the whole plan is written around.
 */
export class PlacementPrompt {
  private readonly root: HTMLElement;
  private wrap: HTMLElement | null = null;
  private messageEl: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Show `text`, or hide the strip entirely when passed null. */
  set(text: string | null): void {
    if (!text) {
      if (this.wrap) toggleClass(this.wrap, 'is-visible', false);
      return;
    }
    if (!this.wrap) this.render();
    if (!this.wrap || !this.messageEl) return;
    setText(this.messageEl, text);
    toggleClass(this.wrap, 'is-visible', true);
  }

  private render(): void {
    const wrap = document.createElement('div');
    wrap.className = 'placement-prompt';
    const msg = document.createElement('span');
    msg.className = 'placement-prompt-text';
    wrap.appendChild(msg);
    this.root.appendChild(wrap);
    this.wrap = wrap;
    this.messageEl = msg;
  }
}
