import { EventBus } from '../game/EventBus';

export type ToastKind = 'info' | 'warning' | 'milestone';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  age: number;
  life: number;
}

const DEFAULT_LIFE = 3.5;
const MILESTONE_LIFE = 5;
const MAX_TOASTS = 3;

/** Seconds of exit animation before a toast is actually removed. */
const EXIT_SECONDS = 0.32;

/**
 * Importance, for the eviction rule (UI plan §7).
 *
 * The stack used to drop whichever toast was oldest, so three "Restarted wave"
 * notices in a row could push out "First boss defeated! +200g" before the player
 * had read it. Now the *least important* one goes, and only its own age breaks a
 * tie within a tier.
 */
const TIER_RANK: Record<ToastKind, number> = { info: 0, warning: 1, milestone: 2 };

export class NotificationManager {
  private readonly root: HTMLElement;
  private toasts: Toast[] = [];
  /** Live element per toast id. Reconciled, never rebuilt — see `sync`. */
  private readonly els = new Map<number, HTMLElement>();
  private nextId = 1;

  constructor(root: HTMLElement, bus: EventBus) {
    this.root = root;
    bus.on('toast', (payload: unknown) => {
      const p = payload as { kind: ToastKind; text: string; life?: number };
      if (!p || typeof p.text !== 'string') return;
      this.push(p.kind ?? 'info', p.text, p.life);
    });
  }

  push(kind: ToastKind, text: string, life?: number): void {
    const toast: Toast = {
      id: this.nextId++,
      kind,
      text,
      age: 0,
      life: life ?? (kind === 'milestone' ? MILESTONE_LIFE : DEFAULT_LIFE),
    };
    this.toasts.push(toast);
    while (this.toasts.length > MAX_TOASTS) {
      this.toasts.splice(this.leastImportantIndex(), 1);
    }
    this.sync();
  }

  tick(dt: number): void {
    if (this.toasts.length === 0) return;
    let expired = false;
    for (const t of this.toasts) {
      t.age += dt;
      // The exit is a CSS animation, armed once. It used to be an opacity value
      // recomputed and written on every frame of the last 0.6s of every toast.
      if (t.age >= t.life - EXIT_SECONDS) {
        const el = this.els.get(t.id);
        if (el && !el.classList.contains('is-leaving')) el.classList.add('is-leaving');
      }
      if (t.age >= t.life) expired = true;
    }
    if (expired) {
      this.toasts = this.toasts.filter(t => t.age < t.life);
      this.sync();
    }
  }

  /**
   * Reconcile the DOM against the list.
   *
   * The previous implementation cleared `innerHTML` and rebuilt every element
   * on every push and every expiry, which restarted the entry animation on all
   * of the surviving toasts each time — so a stack of three re-flew in from the
   * right whenever a fourth arrived.
   */
  private sync(): void {
    const live = new Set<number>();
    for (const t of this.toasts) {
      live.add(t.id);
      let el = this.els.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `toast toast-${t.kind}`;
        el.setAttribute('role', t.kind === 'warning' ? 'alert' : 'status');
        el.textContent = t.text;
        el.addEventListener('click', () => this.dismiss(t.id));
        this.els.set(t.id, el);
        this.root.appendChild(el);
      }
    }
    for (const [id, el] of this.els) {
      if (live.has(id)) continue;
      this.els.delete(id);
      el.remove();
    }
  }

  private dismiss(id: number): void {
    this.toasts = this.toasts.filter(t => t.id !== id);
    this.sync();
  }

  /** Lowest tier first, oldest within the tier. */
  private leastImportantIndex(): number {
    let best = 0;
    for (let i = 1; i < this.toasts.length; i++) {
      const a = this.toasts[i];
      const b = this.toasts[best];
      if (TIER_RANK[a.kind] < TIER_RANK[b.kind]) best = i;
    }
    return best;
  }

  reset(): void {
    this.toasts = [];
    this.sync();
  }
}
