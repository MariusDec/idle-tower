/**
 * mock.ts — the billing adapter used on the web build, in dev and in tests.
 *
 * The web build has no store, so "buy" cannot mean a transaction there. It
 * means: show the real flow, and grant the entitlement locally. That keeps the
 * paywall developable and demo-able without a signed APK and a licensed tester
 * account, and the web build is not a distribution channel for the paid product.
 *
 * `import.meta.env.DEV` is not consulted here: which adapter is used is decided
 * once, in `billing/index.ts`, by platform.
 */

import type { BillingAdapter, EntitlementCheck, ProductInfo, PurchaseResult } from './types';

export interface MockBillingOptions {
  /**
   * Start already entitled. Set on debuggable native builds, where there is no
   * store to buy from and being locked out of the content is pure friction.
   */
  entitled?: boolean;
}

export function createMockBilling(options: MockBillingOptions = {}): BillingAdapter {
  let entitled = options.entitled === true;

  return {
    init: async () => {},
    // No store, so no price: the paywall CTA then reads as its label alone
    // rather than *Get the full game · —*.
    getProduct: async (): Promise<ProductInfo | null> => null,
    // There is no store behind this adapter, so it can confirm a grant but
    // never an absence: a "not entitled" would revoke, on every reload, the
    // full game this adapter granted on the web and the app cached.
    checkEntitlement: async (): Promise<EntitlementCheck> => (entitled ? 'entitled' : 'unknown'),
    purchase: async (): Promise<PurchaseResult> => {
      entitled = true;
      return { status: 'purchased' };
    },
    restore: async (): Promise<PurchaseResult> =>
      entitled ? { status: 'already-owned' } : { status: 'not-found' },
    // Nothing outside this adapter can change its answer, so there is never
    // anything to report.
    onEntitlementChange: () => () => {},
  };
}
