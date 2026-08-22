import { toggleClass } from '../utils/dom';
import { icon as renderIconEl } from './Icon';
import type { IconId } from '../data/icons';

export interface BottomNavItem {
  id: string;
  label: string;
  /**
   * Plan §8.A: a sprite id, not a glyph. The four ASCII characters this used
   * to carry were the last of the pre-Part-6 icon layer.
   */
  icon: IconId;
}

export class BottomNav {
  private readonly host: HTMLElement;
  private readonly root: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private onSelect: (id: string) => void = () => {};

  constructor(host: HTMLElement, items: BottomNavItem[] = []) {
    this.host = host;
    this.host.classList.add('bottom-nav-host');
    this.root = document.createElement('nav');
    this.root.className = 'bottom-nav';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bottom-nav-btn';
      btn.dataset.navId = item.id;
      const iconWrap = document.createElement('span');
      iconWrap.className = 'bottom-nav-btn-icon';
      iconWrap.appendChild(renderIconEl(item.icon, { size: 22, tone: 'inherit' }));
      const label = document.createElement('span');
      label.className = 'bottom-nav-btn-label';
      label.textContent = item.label;
      const badge = document.createElement('span');
      badge.className = 'bottom-nav-btn-badge';
      badge.dataset.navBadge = item.id;
      btn.appendChild(iconWrap);
      btn.appendChild(label);
      btn.appendChild(badge);
      btn.addEventListener('click', () => {
        this.onSelect(item.id);
        this.setActive(item.id);
      });
      this.root.appendChild(btn);
      this.buttons.push(btn);
    }
    this.host.appendChild(this.root);
  }

  setActive(id: string): void {
    for (const btn of this.buttons) {
      toggleClass(btn, 'active', btn.dataset.navId === id);
    }
  }

  /** Plan §8.A: the group badge is the sum over the group's tabs. */
  setBadge(id: string, count: number): void {
    const badge = this.root.querySelector<HTMLElement>(`[data-nav-badge="${id}"]`);
    if (!badge) return;
    badge.textContent = count > 0 ? String(count) : '';
    toggleClass(badge, 'is-visible', count > 0);
  }

  setOnSelect(handler: (id: string) => void): void {
    this.onSelect = handler;
  }

  destroy(): void {
    if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
  }
}
