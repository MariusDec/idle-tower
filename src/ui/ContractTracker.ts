import { setStyle, setText, setTitle } from '../utils/dom';

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

interface RowEls {
  wrap: HTMLElement;
  name: HTMLElement;
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
  private rows = new Map<number, RowEls>();
  /** Rows detached from `rows` and counting down their flourish. */
  private fading: Array<{ el: HTMLElement; timer: number }> = [];

  constructor(root: HTMLElement, handlers: ContractTrackerHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.root.classList.add('contract-tracker');

    const title = document.createElement('div');
    title.className = 'contract-tracker-title';
    title.textContent = 'Contracts';
    this.root.appendChild(title);

    this.list = document.createElement('div');
    this.list.className = 'contract-tracker-list';
    this.root.appendChild(this.list);
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
    for (const data of rows) {
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
      setStyle(els.fill, 'width', `${(Math.max(0, Math.min(1, data.fill)) * 100).toFixed(1)}%`);
    }
    // A uid that vanished without a `flourish` call — a save load, an
    // ascension — is dropped silently rather than celebrated.
    for (const [uid, els] of this.rows) {
      if (seen.has(uid)) continue;
      this.rows.delete(uid);
      els.wrap.remove();
    }
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

    const name = document.createElement('span');
    name.className = 'contract-row-name';
    body.appendChild(name);

    const progress = document.createElement('span');
    progress.className = 'contract-row-progress';
    body.appendChild(progress);

    wrap.appendChild(body);

    const reward = document.createElement('div');
    reward.className = 'contract-row-reward';
    wrap.appendChild(reward);

    return { wrap, name, progress, fill, reward };
  }
}
