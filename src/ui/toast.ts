import type { IconId } from '../content/icons';
import { icon } from './icon';

/** Seconds a toast stays up. */
const TOAST_SECONDS = 3.2;
/** At most this many at once; a new one pushes the oldest out. */
const MAX_TOASTS = 3;

/**
 * Toasts (§4.3, §7.3): a short card under the HUD for something new — the
 * Bestiary's one-line card on an enemy's first sight, a relic found. They
 * never take input and never stop the game. Timed on the wall clock.
 */
export class Toasts {
  private readonly root: HTMLElement;
  private live: { el: HTMLElement; t: number }[] = [];

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'toasts';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    host.appendChild(this.root);
  }

  show(iconId: IconId, title: string, line: string, tone: 'enemy' | 'relic' | 'gold' = 'gold'): void {
    const el = document.createElement('div');
    el.className = `toast toast-${tone}`;
    const head = document.createElement('div');
    head.className = 'toast-head';
    const t = document.createElement('span');
    t.className = 'toast-title';
    t.textContent = title;
    head.append(icon(iconId), t);
    const p = document.createElement('p');
    p.className = 'toast-line';
    p.textContent = line;
    el.append(head, p);
    this.root.append(el);
    this.live.push({ el, t: 0 });
    while (this.live.length > MAX_TOASTS) this.live.shift()!.el.remove();
  }

  tick(realDt: number): void {
    for (const x of this.live) x.t += realDt;
    const done = this.live.filter((x) => x.t >= TOAST_SECONDS);
    for (const x of done) x.el.remove();
    if (done.length > 0) this.live = this.live.filter((x) => x.t < TOAST_SECONDS);
  }

  clear(): void {
    for (const x of this.live) x.el.remove();
    this.live = [];
  }
}
