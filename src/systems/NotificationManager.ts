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

export class NotificationManager {
  private readonly root: HTMLElement;
  private toasts: Toast[] = [];
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
    if (this.toasts.length > MAX_TOASTS) {
      this.toasts.splice(0, this.toasts.length - MAX_TOASTS);
    }
    this.render();
  }

  tick(dt: number): void {
    if (this.toasts.length === 0) return;
    let changed = false;
    for (const t of this.toasts) {
      t.age += dt;
      if (t.age >= t.life) changed = true;
    }
    if (changed) {
      this.toasts = this.toasts.filter(t => t.age < t.life);
      this.render();
    }
  }

  private render(): void {
    this.root.innerHTML = '';
    for (const t of this.toasts) {
      const el = document.createElement('div');
      el.className = `toast toast-${t.kind}`;
      const fade = Math.max(0, 1 - Math.max(0, t.age - (t.life - 0.6)) / 0.6);
      el.style.opacity = String(fade);
      el.textContent = t.text;
      el.addEventListener('click', () => {
        this.toasts = this.toasts.filter(x => x.id !== t.id);
        this.render();
      });
      this.root.appendChild(el);
    }
  }

  reset(): void {
    this.toasts = [];
    this.render();
  }
}
