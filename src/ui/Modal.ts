import { toggleClass } from '../utils/dom';

/**
 * Everything that can hold focus inside a card. Used by the Tab trap; the
 * `:not([disabled])` filters matter because a disabled reroll button is still
 * in the DOM and would otherwise swallow a tab stop.
 */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),'
  + 'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface ModalOptions {
  /** → `data-modal="…"` for CSS hooks and tests. */
  id: string;
  title: string;
  sub?: string;
  /** CSS px, capped by `min(width, 100vw - 2 * safe-inset - 32px)`. */
  width?: number;
  /** Escape + backdrop tap. Default true. */
  dismissible?: boolean;
  /** Fired once whenever the modal closes, for any reason. */
  onClose?: () => void;
  /**
   * Where the modal mounts. Not in the plan's sketch, but every adopter is
   * handed a `modalRoot` by `main.ts` and mounting somewhere else would put
   * the card outside the overlay stacking context. Defaults to `#modal-root`,
   * then `document.body`.
   */
  root?: HTMLElement;
}

/**
 * The one modal shell (UI plan §8.F).
 *
 * Before this there were three independent shells plus an overlay
 * (`welcome-modal*`, `blessing-modal*`, `wave-mod-modal*`, `KeybindsOverlay`),
 * each re-implementing backdrop, visibility transition and dismissal, and none
 * of them trapping focus. Adopters now own their *content* only: they render
 * into `body` and nothing else, keeping their existing content classes so
 * their layouts survive the move.
 *
 * The static registry behind `anyOpen()` is what lets `UIManager.isModalOpen()`
 * stop being a hand-written list of names that two people had to remember to
 * edit — a new modal answers the Space-binding gate by existing.
 */
export class Modal {
  /** Every open modal, innermost last, so Escape only reaches the top one. */
  private static readonly openStack: Modal[] = [];

  static anyOpen(): boolean {
    return Modal.openStack.length > 0;
  }

  readonly body: HTMLElement;

  private readonly opts: ModalOptions;
  private readonly root: HTMLElement;
  private readonly wrap: HTMLElement;
  private readonly card: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private open_ = false;
  private previousFocus: HTMLElement | null = null;
  private readonly keydownHandler = (e: KeyboardEvent) => this.onKeydown(e);

  constructor(opts: ModalOptions) {
    this.opts = opts;
    this.root = opts.root
      ?? (document.getElementById('modal-root') as HTMLElement | null)
      ?? document.body;

    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.dataset.modal = opts.id;
    this.wrap = wrap;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', () => {
      if (this.opts.dismissible !== false) this.close();
    });
    wrap.appendChild(backdrop);

    const card = document.createElement('div');
    card.className = 'modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.tabIndex = -1;
    if (opts.width) card.style.setProperty('--modal-width', `${opts.width}px`);
    this.card = card;

    // The X. Escape and the backdrop tap already dismiss, but neither is
    // reachable on a phone where the card fills the viewport — so every
    // dismissible modal gets a visible close affordance. It is sticky rather
    // than absolute because `.modal-card` is itself the scroller: an absolute
    // button scrolls off the top of a long dialog and strands the user again.
    if (opts.dismissible !== false) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'modal-close';
      close.textContent = '\u00d7';
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', () => this.close());
      card.appendChild(close);
    }

    const titleId = `modal-title-${opts.id}`;
    const title = document.createElement('h2');
    title.className = 'modal-title';
    title.id = titleId;
    title.textContent = opts.title;
    card.setAttribute('aria-labelledby', titleId);
    card.appendChild(title);
    this.titleEl = title;

    const sub = document.createElement('p');
    sub.className = 'modal-sub';
    sub.textContent = opts.sub ?? '';
    toggleClass(sub, 'is-hidden', !opts.sub);
    card.appendChild(sub);
    this.subEl = sub;

    const body = document.createElement('div');
    body.className = 'modal-body';
    card.appendChild(body);
    this.body = body;

    wrap.appendChild(card);
  }

  /** Retitle without rebuilding — adopters re-`show` with fresh data a lot. */
  setTitle(title: string): void {
    this.titleEl.textContent = title;
  }

  setSub(sub: string | undefined): void {
    this.subEl.textContent = sub ?? '';
    toggleClass(this.subEl, 'is-hidden', !sub);
  }

  /** The card itself, for the rare adopter that needs a content-specific class. */
  get cardElement(): HTMLElement {
    return this.card;
  }

  isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    const active = document.activeElement;
    this.previousFocus = active instanceof HTMLElement ? active : null;
    this.root.appendChild(this.wrap);
    Modal.openStack.push(this);
    document.addEventListener('keydown', this.keydownHandler);
    requestAnimationFrame(() => toggleClass(this.wrap, 'is-visible', true));
    const first = this.focusableNodes()[0];
    (first ?? this.card).focus();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    document.removeEventListener('keydown', this.keydownHandler);
    const i = Modal.openStack.indexOf(this);
    if (i >= 0) Modal.openStack.splice(i, 1);
    toggleClass(this.wrap, 'is-visible', false);
    if (this.wrap.parentNode) this.wrap.parentNode.removeChild(this.wrap);
    const prev = this.previousFocus;
    this.previousFocus = null;
    if (prev && prev.isConnected) prev.focus();
    this.opts.onClose?.();
  }

  /** Drop every listener and forget the node. Only for teardown. */
  destroy(): void {
    this.close();
    this.wrap.remove();
  }

  /** Empty the body so an adopter can re-render into a modal it keeps around. */
  clearBody(): void {
    this.body.replaceChildren();
  }

  private focusableNodes(): HTMLElement[] {
    return [...this.card.querySelectorAll<HTMLElement>(FOCUSABLE)]
      // `offsetParent === null` is the cheap "not rendered" test. jsdom-free
      // environments report 0 for everything, which is harmless: the trap then
      // simply has no nodes and swallows the Tab.
      .filter(n => n.offsetParent !== null);
  }

  private onKeydown(e: KeyboardEvent): void {
    // Only the topmost modal reacts, so a picker opened over a debrief does
    // not close both on one Escape.
    if (Modal.openStack[Modal.openStack.length - 1] !== this) return;
    if (e.key === 'Escape' && this.opts.dismissible !== false) {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = this.focusableNodes();
    if (nodes.length === 0) { e.preventDefault(); return; }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  }
}
