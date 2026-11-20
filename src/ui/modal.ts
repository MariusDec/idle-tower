/**
 * A minimal modal: a scrim, a card, a set of buttons. The legacy `Modal.ts`
 * grew focus traps and stacking for a dozen dialogs; the rebuild has three
 * (pause, draft, bestiary card), so this starts small and grows on demand.
 */
export interface ModalButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export class Modal {
  private el: HTMLElement | null = null;

  constructor(private readonly host: HTMLElement) {}

  get open(): boolean {
    return this.el !== null;
  }

  /** `body` is a line of text, or a node drawn as given (the pause menu's build, U3). */
  show(title: string, body: string | Node, buttons: ModalButton[]): void {
    this.close();
    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim';
    const card = document.createElement('div');
    card.className = 'modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    const h = document.createElement('h2');
    h.className = 'modal-title';
    h.textContent = title;
    card.appendChild(h);
    // The body scrolls on its own; the title and the buttons stay in view.
    if (typeof body !== 'string' || body) {
      const scroll = document.createElement('div');
      scroll.className = 'modal-scroll';
      if (typeof body !== 'string') {
        scroll.appendChild(body);
      } else {
        const p = document.createElement('p');
        p.className = 'modal-body';
        p.textContent = body;
        scroll.appendChild(p);
      }
      card.appendChild(scroll);
    }
    const row = document.createElement('div');
    row.className = 'modal-actions';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = b.primary ? 'btn btn-primary' : 'btn';
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        this.close();
        b.onClick();
      });
      row.appendChild(btn);
    }
    card.appendChild(row);
    scrim.appendChild(card);
    this.host.appendChild(scrim);
    this.el = scrim;
    (row.querySelector('.btn-primary') as HTMLElement | null)?.focus();
  }

  close(): void {
    this.el?.remove();
    this.el = null;
  }
}
