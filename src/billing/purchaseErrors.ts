/**
 * purchaseErrors.ts — what a failed purchase actually means.
 *
 * The RevenueCat plugin reports every non-success as a thrown error, and the
 * raw message is written for developers ("The product is already owned by
 * this user"). Three of those failures are not failures to the player:
 * cancelling, already owning the product (a reinstall, or cleared app data),
 * and a payment the store is still waiting to confirm. Each needs its own
 * handling, so they are told apart here, by the plugin's error code rather
 * than its wording.
 *
 * Codes are `PURCHASES_ERROR_CODE` from
 * `@revenuecat/purchases-typescript-internal-esm` (plugin 13.x), where they
 * are numeric strings. Capacitor may deliver `code` / `userCancelled` on the
 * error itself or under `data`, and a number or a string, so all are read.
 * No SDK import: the enum values are copied so this stays testable in Node.
 */

export type PurchaseErrorKind = 'cancelled' | 'already-owned' | 'pending' | 'network' | 'other';

const PURCHASE_CANCELLED = '1';
const PRODUCT_ALREADY_PURCHASED = '6';
const NETWORK_ERROR = '10';
const PAYMENT_PENDING = '20';
const OFFLINE_CONNECTION = '35';

function field(e: unknown, name: string): unknown {
  if (typeof e !== 'object' || e === null) return undefined;
  const own = (e as Record<string, unknown>)[name];
  if (own !== undefined && own !== null) return own;
  const data = (e as { data?: unknown }).data;
  return typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>)[name]
    : undefined;
}

export function classifyPurchaseError(e: unknown): PurchaseErrorKind {
  if (field(e, 'userCancelled') === true) return 'cancelled';
  const raw = field(e, 'code');
  const code = typeof raw === 'number' || typeof raw === 'string' ? String(raw) : '';
  switch (code) {
    case PURCHASE_CANCELLED:
      return 'cancelled';
    case PRODUCT_ALREADY_PURCHASED:
      return 'already-owned';
    case PAYMENT_PENDING:
      return 'pending';
    case NETWORK_ERROR:
    case OFFLINE_CONNECTION:
      return 'network';
    default:
      return 'other';
  }
}
