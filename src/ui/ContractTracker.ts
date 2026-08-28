import { setStyle, setText, setTitle, toggleClass } from '../utils/dom';

/** One tracker row's worth of state, pushed by the host each UI tick. */
export interface ContractRowData {
  /** Instance id. Rows key on it, so a redraw of the same def is a new row. */
  uid: number;
  name: string;
  /** What the contract asks for, e.g. "Kill 40 enemies". */
  label: string;
  /** `12 / 40`. */
  progress: string;
  /** 0..1. */
  fill: number;
  /** Short reward blurb, e.g. "480g" or "1 reroll · +3% AP". */
  reward: string;
}

export interface ContractTrackerHandlers {
  getRows: () => ContractRowData[];
}

/** Seconds a completed row stays on screen playing its flourish. */
const FLOURISH_SECONDS = 1.1;

/** Fill at which a row starts advertising that it is nearly done. */
const CLOSE_FRACTION = 0.8;

/** Where the mobile collapse preference lives. */
const COLLAPSED_KEY = 'the-tower-contracts-collapsed';

function readCollapsed(): boolean {
  try {
    // Defaults **collapsed on a phone, open on a desktop**. The two viewports
    // have opposite problems: the corner is free real estate on a desktop and
    // is a third of the play area on a 375px screen.
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw !== null) return raw === '1';
  } catch { /* private mode — fall through to the default */ }
  return typeof matchMedia === 'function' && matchMedia('(max-width: 768px)').matches;
}

function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
  } catch { /* nothing to do — the preference is a nicety */ }
}

interface RowEls {
  wrap: HTMLElement;
  name: HTMLElement;
  /** The goal in words. Hidden on a desktop, where the `title` covers it. */
  label: HTMLElement;
  progress: HTMLElement;
  fill: HTMLElement;
  reward: HTMLElement;
}

/**
 * The three live contracts, under the milestone strip (gameplay plan §5.3).
 *
 * Rows are keyed on the contract's **instance id**, not its def id, which is
 * what lets a completed contract play its flourish while its replacement
 * slides in underneath — including the case where the replacement happens to be
 * the same def drawn again.
 *
 * Everything here is presentation: it is driven from `frameUpdate` through
 * `UIManager`, never from the substep loop, and it only rebuilds DOM when the
 * set of live uids changes. The per-tick work on a steady state is three text
 * writes and three width writes, all of them through the `dom` helpers that
 * cache the last value.
 */
export class ContractTracker {
  private readonly root: HTMLElement;
  private readonly handlers: ContractTrackerHandlers;
  private readonly list: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly countEl: HTMLElement;
  private readonly summaryFill: HTMLElement;
  private rows = new Map<number, RowEls>();
  /** Rows detached from `rows` and counting down their flourish. */
  private fading: Array<{ el: HTMLElement; timer: number }> = [];
  private collapsed = readCollapsed();
  /** Last height written to the CSS token, so a steady state writes nothing. */
  private lastHeight = 0;

  constructor(root: HTMLElement, handlers: ContractTrackerHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.root.classList.add('contract-tracker');

    // The header is a button on every viewport, but it only *does* anything
    // on a phone — the desktop CSS keeps the list open regardless of the
    // class. One DOM shape for both, rather than a breakpoint the JS has to
    // stay in sync with.
    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'contract-tracker-title';

    const label = document.createElement('span');
    label.className = 'contract-tracker-title-label';
    label.textContent = 'Contracts';
    this.toggle.appendChild(label);

    this.countEl = document.createElement('span');
    this.countEl.className = 'contract-tracker-count';
    this.toggle.appendChild(this.countEl);

    // The collapsed chip is not just a label: it carries the best live
    // contract's fill, so a glance at a folded tracker still says whether
    // something is about to land.
    this.summaryFill = document.createElement('span');
    this.summaryFill.className = 'contract-tracker-summary-fill';
    this.toggle.appendChild(this.summaryFill);

    this.toggle.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.root.appendChild(this.toggle);

    this.list = document.createElement('div');
    this.list.className = 'contract-tracker-list';
    this.root.appendChild(this.list);

    this.applyCollapsed();
    this.observeHeight();
  }

  private setCollapsed(next: boolean): void {
    this.collapsed = next;
    writeCollapsed(next);
    this.applyCollapsed();
    // Synchronously, not via the observer: the strip above has to move in the
    // same frame as the fold, or it visibly lags a tap by a frame.
    this.publishHeight();
  }

  private applyCollapsed(): void {
    toggleClass(this.root, 'is-collapsed', this.collapsed);
    this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
  }

  /**
   * Publish the tracker's real height as `--contract-tracker-height`.
   *
   * It used to be a hand-measured constant sized for the *worst* case — four
   * rows — so a three-row tracker pushed the milestone strip and the toast
   * stack 44px higher than anything needed, and a collapsed one on a phone
   * wasted the full 154px. Everything above it in the corner stack offsets
   * itself by this token, so measuring it is what makes collapsing reclaim
   * any play area at all.
   */
  private observeHeight(): void {
    // The observer catches what the explicit calls cannot name — a font
    // swap, a row wrapping to two lines at a narrow width. The explicit calls
    // (fold, row-set change) are what the layout actually depends on, so the
    // token is right even where `ResizeObserver` is missing or throttled.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => this.publishHeight()).observe(this.root);
    }
    this.publishHeight();
  }

  private publishHeight(): void {
    const h = Math.round(this.root.getBoundingClientRect().height);
    if (h <= 0 || h === this.lastHeight) return;
    this.lastHeight = h;
    document.documentElement.style.setProperty('--contract-tracker-height', `${h}px`);
  }

  /**
   * Mark a contract complete: its row flashes and drains out of the list.
   *
   * Called from the `contract_completed` subscription rather than inferred from
   * a row disappearing, because "completed" and "replaced by a save load" look
   * identical from the outside and only one of them deserves a celebration.
   */
  flourish(uid: number, rewardText: string): void {
    const els = this.rows.get(uid);
    if (!els) return;
    this.rows.delete(uid);
    setStyle(els.fill, 'width', '100%');
    setText(els.reward, rewardText ? `+${rewardText}` : 'Complete');
    els.wrap.classList.add('is-complete');
    this.fading.push({ el: els.wrap, timer: FLOURISH_SECONDS });
  }

  /** Presentation clock — drains the flourish rows. Runs on wall-clock dt. */
  update(dt: number): void {
    if (this.fading.length === 0) return;
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const entry = this.fading[i];
      entry.timer -= dt;
      if (entry.timer > 0) continue;
      entry.el.remove();
      this.fading.splice(i, 1);
    }
  }

  refresh(): void {
    const rows = this.handlers.getRows();
    const seen = new Set<number>();
    let best = 0;
    for (const data of rows) {
      best = Math.max(best, Math.max(0, Math.min(1, data.fill)));
      seen.add(data.uid);
      let els = this.rows.get(data.uid);
      if (!els) {
        els = this.createRow(data.uid);
        this.rows.set(data.uid, els);
        this.list.appendChild(els.wrap);
      }
      setText(els.name, data.name);
      setText(els.progress, data.progress);
      setText(els.reward, data.reward);
      setTitle(els.wrap, `${data.name} — ${data.label}`);
      const fill = Math.max(0, Math.min(1, data.fill));
      setText(els.label, data.label);
      setStyle(els.fill, 'width', `${(fill * 100).toFixed(1)}%`);
      // A row inside its last fifth lights its border, so "about to complete"
      // is visible before the flourish rather than only after it.
      toggleClass(els.wrap, 'is-close', fill >= CLOSE_FRACTION);
    }
    // A uid that vanished without a `flourish` call — a save load, an
    // ascension — is dropped silently rather than celebrated.
    for (const [uid, els] of this.rows) {
      if (seen.has(uid)) continue;
      this.rows.delete(uid);
      els.wrap.remove();
    }

    // Collapsed-chip readout. Written every tick like the rows, and through
    // the same caching helpers, so a folded tracker costs two writes.
    setText(this.countEl, String(rows.length));
    setStyle(this.summaryFill, 'width', `${(best * 100).toFixed(1)}%`);
    toggleClass(this.toggle, 'is-close', best >= CLOSE_FRACTION);
    // The Watch's fourth slot changes the tracker's height without anyone
    // folding it. `publishHeight` early-outs on an unchanged value, so this is
    // a `getBoundingClientRect` on a UI tick, not a write.
    this.publishHeight();
  }

  private createRow(uid: number): RowEls {
    const wrap = document.createElement('div');
    wrap.className = 'contract-row is-entering';
    wrap.dataset.uid = String(uid);
    // Let the entry animation finish, then drop the class so a later
    // completion flourish is not fighting it.
    setTimeout(() => wrap.classList.remove('is-entering'), 420);

    const fill = document.createElement('div');
    fill.className = 'contract-row-fill';
    wrap.appendChild(fill);

    const body = document.createElement('div');
    body.className = 'contract-row-body';

    const head = document.createElement('span');
    head.className = 'contract-row-head';

    const name = document.createElement('span');
    name.className = 'contract-row-name';
    head.appendChild(name);

    const progress = document.createElement('span');
    progress.className = 'contract-row-progress';
    head.appendChild(progress);

    body.appendChild(head);

    // What the contract actually asks for. A desktop reads this from the
    // row's `title`; a touch screen has no hover, so on mobile the goal is
    // rendered into the row itself rather than being unreachable.
    const label = document.createElement('span');
    label.className = 'contract-row-label';
    body.appendChild(label);

    wrap.appendChild(body);

    const reward = document.createElement('div');
    reward.className = 'contract-row-reward';
    wrap.appendChild(reward);

    return { wrap, name, label, progress, fill, reward };
  }
}
