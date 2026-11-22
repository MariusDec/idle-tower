/**
 * types.ts — the billing surface, as this game needs it (plans/monetization.md).
 * Ported from learn-thai's `src/billing/`; keep the two in step where they can be.
 *
 * Narrow on purpose. The game has exactly one product and one entitlement, so
 * the interface is "what does it cost", "buy it", "restore it", and "am I
 * entitled". Anything wider would leak a particular vendor's model into every
 * caller, and the vendor is the part most likely to change.
 */

/** The Play product id. Must match the in-app product created in Play Console (D-7). */
export const FULL_PRODUCT_ID = 'full_game';

/** The RevenueCat entitlement identifier configured in its dashboard (D-7). */
export const FULL_ENTITLEMENT_ID = 'blue-hour-full';

export interface ProductInfo {
  /** Localised, currency-formatted price string from the store, e.g. "€4.99". */
  priceString: string;
}

/**
 * How a purchase or restore ended.
 *
 * - `purchased` / `already-owned` — the full game is open now.
 * - `cancelled` — the player backed out; say nothing.
 * - `pending` — paid by a method the store has not confirmed yet (a slow card,
 *   cash at a shop). Nothing is granted; `entitlement.refresh` picks it up
 *   on a later launch or resume once the store confirms.
 * - `not-found` — a restore found no purchase on this store account.
 * - `unavailable` / `error` — carry a message fit to show the player.
 */
export type PurchaseResult =
  | { status: 'purchased' }
  | { status: 'cancelled' }
  | { status: 'already-owned' }
  | { status: 'pending' }
  | { status: 'not-found' }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

/** A definite answer from the store, or `unknown` when it could not be reached. */
export type EntitlementCheck = 'entitled' | 'not-entitled' | 'unknown';

export interface BillingAdapter {
  /**
   * Prepare the SDK. Safe to call more than once; later calls are no-ops.
   * Never throws — a billing failure must not stop the game from starting.
   */
  init(): Promise<void>;
  /** The product, or null when the store is unreachable or has no such product. */
  getProduct(): Promise<ProductInfo | null>;
  /**
   * What the store says about the full-game entitlement.
   *
   * `unknown` whenever the store could not be asked — offline, no Play
   * Services, an SDK error. Only `not-entitled` is evidence of anything, and
   * with `confirmAbsence` it is returned only once the store has also been
   * asked to re-link this account's purchases, so a new install that has not
   * yet been linked is not mistaken for a refund.
   */
  checkEntitlement(options?: { confirmAbsence?: boolean }): Promise<EntitlementCheck>;
  /** Run the purchase flow. */
  purchase(): Promise<PurchaseResult>;
  /** Re-query past purchases for this store account. */
  restore(): Promise<PurchaseResult>;
  /**
   * Be told when the store's own view of the entitlement changes without the
   * game asking — a pending payment clearing, a refund. `entitled` is what the
   * store now says; it is a prompt to re-check, not a verdict to write.
   * Returns a teardown, safe to call before the subscription has finished
   * setting up.
   */
  onEntitlementChange(listener: (entitled: boolean) => void): () => void;
}
