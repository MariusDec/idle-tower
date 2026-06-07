import { toggleClass } from '../utils/dom';

export interface BottomNavItem {
  id: string;
  label: string;
  icon: string;
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
      const icon = document.createElement('span');
      icon.className = 'bottom-nav-btn-icon';
      icon.textContent = item.icon;
      const label = document.createElement('span');
      label.className = 'bottom-nav-btn-label';
      label.textContent = item.label;
      btn.appendChild(icon);
      btn.appendChild(label);
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

  setOnSelect(handler: (id: string) => void): void {
    this.onSelect = handler;
  }

  destroy(): void {
    if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
  }
}
