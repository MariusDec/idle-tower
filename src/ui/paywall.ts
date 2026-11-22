import type { PurchaseResult } from '../billing';
import type { Modal } from './modal';
import { icon } from './icon';

/** What the paywall asks of the app. */
export interface PaywallActions {
  /** The store's localised price, or null when it can't be had (never hard-coded). */
  price(): Promise<string | null>;
  buy(): Promise<PurchaseResult>;
  restore(): Promise<PurchaseResult>;
  /** The full game just opened: the app takes the player to it. */
  opened(): void;
}

/** What one purchase opens (plans/monetization.md §3.3), in three lines. */
export const PAYWALL_LINES: readonly string[] = [
  'Three more regions and the Blight',
  'Act 2: pacts, the Abyss, Boss Rush, the Daily Omen',
  'Yours for good, offline, no ads',
];

/** Said when the store can't be asked at all. */
const NO_STORE = 'The store can’t be reached right now. Check your connection and try again.';

/**
 * The paywall sheet (plans/monetization.md §3.3), on the app's one Modal, so
 * the back button closes it like any dialog (`App#back`). Buy and Restore
 * close it while Google Play's own sheet is up, then say how it ended:
 * opened, pending, or the paywall again with the reason. A cancel says
 * nothing.
 */
export class Paywall {
  constructor(private readonly modal: Modal, private readonly actions: PaywallActions) {}

  /** Show the sheet; `message` is the last attempt's reason, if it failed. */
  open(message = ''): void {
    const body = document.createElement('div');
    body.className = 'paywall';
    const lead = document.createElement('p');
    lead.className = 'modal-body paywall-lead';
    lead.textContent = 'The first three regions are yours to keep. One purchase opens the rest of the tower.';
    const list = document.createElement('ul');
    list.className = 'paywall-lines';
    for (const line of PAYWALL_LINES) {
      const li = document.createElement('li');
      li.append(icon('round-star'), document.createTextNode(line));
      list.append(li);
    }
    const price = document.createElement('p');
    price.className = 'paywall-price';
    price.hidden = true;
    const note = document.createElement('p');
    note.className = 'paywall-note';
    note.setAttribute('role', 'status');
    note.textContent = message;
    note.hidden = message === '';
    body.append(lead, list, price, note);
    this.modal.show('The rest of the tower', body, [
      { label: 'Not now', onClick: () => {} },
      { label: 'Restore purchase', onClick: () => void this.settle(this.actions.restore()) },
      { label: 'Buy', primary: true, onClick: () => void this.settle(this.actions.buy()) },
    ], 'paywall');
    // The price comes from the store; the sheet reads fine without it.
    void this.actions.price().then((p) => {
      if (!p || !body.isConnected) return;
      price.textContent = `One purchase · ${p}`;
      price.hidden = false;
    }, () => {});
  }

  /** Say how a Buy or Restore ended. */
  private async settle(pending: Promise<PurchaseResult>): Promise<void> {
    this.modal.show('One moment', 'Asking Google Play…', [], 'paywall-busy');
    let result: PurchaseResult;
    try {
      result = await pending;
    } catch {
      result = { status: 'unavailable', message: NO_STORE };
    }
    // Closed with back while Play was asked: the answer still lands, quietly.
    const watching = this.modal.kind === 'paywall-busy';
    if (watching) this.modal.close();
    switch (result.status) {
      case 'purchased':
      case 'already-owned':
        this.modal.show('The tower is yours', 'Ember Rift is open, and everything past it. Thank you for playing.', [
          { label: 'Onward', primary: true, onClick: () => this.actions.opened() },
        ], 'paywall-done');
        return;
      case 'pending':
        if (watching) {
          this.modal.show('Waiting on Google Play', 'Your payment is pending. The rest of the tower opens as soon as Google Play confirms it.', [
            { label: 'Close', primary: true, onClick: () => {} },
          ]);
        }
        return;
      case 'cancelled':
        return;
      case 'not-found':
        if (watching) this.open('No purchase was found on this Google account.');
        return;
      case 'unavailable':
      case 'error':
        if (watching) this.open(result.message);
        return;
      default: {
        const exhaustive: never = result;
        return exhaustive;
      }
    }
  }
}
