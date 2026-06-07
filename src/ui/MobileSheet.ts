import { setInnerHTML, toggleClass } from '../utils/dom';

export interface MobileSheetTab {
  id: string;
  label: string;
  render: (body: HTMLElement) => void;
}

export class MobileSheet {
  private readonly host: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly root: HTMLElement;
  private readonly grip: HTMLElement;
  private readonly segmented: HTMLElement;
  private readonly body: HTMLElement;
  private tabs: MobileSheetTab[] = [];
  private activeId: string | null = null;
  private isOpenFlag = false;
  private boundOnKeydown: ((ev: KeyboardEvent) => void) | null = null;
  private boundOnTouchStart: ((ev: TouchEvent) => void) | null = null;
  private boundOnTouchMove: ((ev: TouchEvent) => void) | null = null;
  private boundOnTouchEnd: ((ev: TouchEvent) => void) | null = null;
  private touchStartY = 0;
  private touchDeltaY = 0;
  private isDragging = false;

  constructor(host: HTMLElement) {
    this.host = host;
    this.host.classList.add('mobile-sheet-root');

    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-sheet-backdrop';
    backdrop.addEventListener('click', () => this.close());
    document.body.appendChild(backdrop);
    this.backdrop = backdrop;

    const root = document.createElement('div');
    root.className = 'mobile-sheet';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    const grip = document.createElement('div');
    grip.className = 'mobile-sheet-grip';
    root.appendChild(grip);
    this.grip = grip;

    const header = document.createElement('div');
    header.className = 'mobile-sheet-header';

    const segmented = document.createElement('div');
    segmented.className = 'mobile-sheet-segmented';
    header.appendChild(segmented);
    this.segmented = segmented;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mobile-sheet-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);
    root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'mobile-sheet-body';
    root.appendChild(body);
    this.body = body;

    document.body.appendChild(root);
    this.root = root;

    this.boundOnKeydown = (ev) => {
      if (ev.key === 'Escape' && this.isOpenFlag) {
        ev.preventDefault();
        this.close();
      }
    };
    window.addEventListener('keydown', this.boundOnKeydown);

    this.bindSwipe();
  }

  setTabs(tabs: MobileSheetTab[]): void {
    this.tabs = tabs;
    this.segmented.innerHTML = '';
    for (const t of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mobile-sheet-segmented-btn';
      btn.textContent = t.label;
      btn.dataset.tabId = t.id;
      btn.addEventListener('click', () => this.activate(t.id));
      this.segmented.appendChild(btn);
    }
    if (tabs.length > 0) this.activate(tabs[0].id);
  }

  open(tabId?: string): void {
    if (this.tabs.length === 0) return;
    const id = tabId ?? this.activeId ?? this.tabs[0].id;
    this.activate(id);
    this.root.classList.add('is-open');
    this.backdrop.classList.add('is-open');
    this.isOpenFlag = true;
  }

  close(): void {
    this.root.classList.remove('is-open');
    this.backdrop.classList.remove('is-open');
    this.isOpenFlag = false;
    this.root.style.transform = '';
  }

  isOpen(): boolean {
    return this.isOpenFlag;
  }

  destroy(): void {
    this.close();
    if (this.boundOnKeydown) window.removeEventListener('keydown', this.boundOnKeydown);
    if (this.grip) {
      this.grip.removeEventListener('touchstart', this.boundOnTouchStart!);
      window.removeEventListener('touchmove', this.boundOnTouchMove!);
      window.removeEventListener('touchend', this.boundOnTouchEnd!);
    }
    if (this.backdrop.parentElement) this.backdrop.parentElement.removeChild(this.backdrop);
    if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
  }

  private activate(id: string): void {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;
    this.activeId = id;
    for (const btn of Array.from(this.segmented.querySelectorAll<HTMLButtonElement>('.mobile-sheet-segmented-btn'))) {
      toggleClass(btn, 'active', btn.dataset.tabId === id);
    }
    setInnerHTML(this.body, '');
    tab.render(this.body);
  }

  private bindSwipe(): void {
    this.boundOnTouchStart = (ev: TouchEvent) => {
      if (!this.isOpenFlag) return;
      this.touchStartY = ev.touches[0]?.clientY ?? 0;
      this.touchDeltaY = 0;
      this.isDragging = true;
    };
    this.boundOnTouchMove = (ev: TouchEvent) => {
      if (!this.isDragging) return;
      const y = ev.touches[0]?.clientY ?? 0;
      this.touchDeltaY = Math.max(0, y - this.touchStartY);
      if (this.touchDeltaY > 0) {
        this.root.style.transform = `translateY(${this.touchDeltaY}px)`;
        this.root.style.transition = 'none';
      }
    };
    this.boundOnTouchEnd = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.root.style.transition = '';
      if (this.touchDeltaY > 80) {
        this.close();
      } else {
        this.root.style.transform = '';
      }
    };
    this.grip.addEventListener('touchstart', this.boundOnTouchStart, { passive: true });
    window.addEventListener('touchmove', this.boundOnTouchMove, { passive: true });
    window.addEventListener('touchend', this.boundOnTouchEnd);
  }
}
