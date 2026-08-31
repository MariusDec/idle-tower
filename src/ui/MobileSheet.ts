import { setInnerHTML, toggleClass, resetScroll } from '../utils/dom';

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
  private readonly badgeSource: ((id: string) => number) | null;
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

  constructor(host: HTMLElement, opts?: { badgeSource?: (id: string) => number }) {
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
      // `Modal`'s document-level handler runs before this window one, so a
      // dialog opened over the sheet has already spent the press by the time
      // it arrives here — closing the sheet as well would take two surfaces
      // away on one Escape.
      if (ev.defaultPrevented) return;
      if (ev.key === 'Escape' && this.isOpenFlag) {
        ev.preventDefault();
        this.close();
      }
    };
    window.addEventListener('keydown', this.boundOnKeydown);

    this.bindSwipe();
    this.badgeSource = opts?.badgeSource ?? null;
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
      // Same per-tab badge surface as the desktop sub-strip: a notification
      // attached to one tab in the group is a notification attached to the
      // matching segmented button, so the player sees the same mark whichever
      // surface they are on. Empty until `setBadge` is called by UIManager.
      const badge = document.createElement('span');
      badge.className = 'mobile-sheet-segmented-btn-badge';
      badge.dataset.tabBadge = t.id;
      // Re-apply the current badge count immediately after creation: the
      // player may have earned a notification (e.g. talent point, equipment
      // drop) well before the first time they tap the bottom nav. Without
      // this, fresh badge elements would stay empty until the next
      // `setBadge` call, hiding the very notification that brought them
      // to this tab. The `setBadge` path is the live updates; this is the
      // catch-up after a DOM rebuild.
      if (this.badgeSource) {
        const count = this.badgeSource(t.id);
        badge.textContent = count > 0 ? String(count) : '';
        toggleClass(badge, 'is-visible', count > 0);
      }
      btn.appendChild(badge);
      btn.addEventListener('click', () => this.activate(t.id));
      this.segmented.appendChild(btn);
    }
  }

  /**
   * Mirror of `BottomNav.setBadge` for the segmented strip. The desktop
   * sub-strip and the mobile segmented strip are the same per-tab surface
   * drawn on different canvases, so a tab notification has to land on both —
   * the player who flips between phone and desktop on the same device should
   * never have to re-discover the new-talent counter.
   */
  setBadge(id: string, count: number): void {
    const badge = this.segmented.querySelector<HTMLElement>(`[data-tab-badge="${id}"]`);
    if (!badge) return;
    badge.textContent = count > 0 ? String(count) : '';
    toggleClass(badge, 'is-visible', count > 0);
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
    // Every panel adds its own class to the container it renders into, and the
    // sheet reuses one body element for all of them — so without this reset the
    // classes accumulate and a settings sheet is still wearing `.upgrade-panel`
    // (and its padding) from three taps ago. UI plan §9.F.
    this.body.className = 'mobile-sheet-body';
    setInnerHTML(this.body, '');
    tab.render(this.body);
    // Each tab opens at the top, not where the previous tab was scrolled to.
    resetScroll(this.body, this.root);
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
