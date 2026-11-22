/**
 * index.ts — pick the adapter once, by platform.
 *
 * `isNative()` (`platform/native.ts`) is the project's own check:
 * `'Capacitor' in window` is true in a plain browser too, because the global
 * ships with the web runtime.
 */

import { isNative as isNativePlatform, isNativeDebugBuild } from '../platform/native';
import { createMockBilling } from './mock';
import type { BillingAdapter } from './types';

/**
 * An adapter that loads the real one on first use.
 *
 * Every adapter method is already async, so deferring the module costs the
 * caller nothing — and keeps the RevenueCat adapter (and its error
 * classification) out of the entry chunk, where the web build, which never
 * uses it, was paying for it on every launch.
 */
function deferred(load: () => Promise<BillingAdapter>): BillingAdapter {
  let loading: Promise<BillingAdapter> | null = null;
  const real = () => {
    loading ??= load();
    return loading;
  };
  return {
    init: async () => (await real()).init(),
    getProduct: async () => (await real()).getProduct(),
    checkEntitlement: async (options) => (await real()).checkEntitlement(options),
    purchase: async () => (await real()).purchase(),
    restore: async () => (await real()).restore(),
    onEntitlementChange: (listener) => {
      let remove: (() => void) | undefined;
      let disposed = false;
      real()
        .then((adapter) => {
          if (!disposed) remove = adapter.onEntitlementChange(listener);
        })
        .catch((e) => {
          console.warn('[Billing] entitlement listener unavailable:', e);
        });
      return () => {
        disposed = true;
        remove?.();
      };
    },
  };
}

let adapter: BillingAdapter | null = null;

export function getBilling(): BillingAdapter {
  if (adapter) return adapter;
  const debug = isNativeDebugBuild();
  if (debug && !__REVENUECAT_TEST_STORE__) {
    // A debug APK is not attached to a Play licence, so the store flow can only
    // fail there. Hand it the mock, already entitled: debug builds exist to
    // exercise the content, not the till.
    adapter = createMockBilling({ entitled: true });
  } else if (isNativePlatform()) {
    // Loaded lazily so the web bundle never reaches the adapter or the plugin.
    // A debug APK gets here only when built for the Test Store
    // (`npm run android:test-store`), and then may use only the Test Store key;
    // a release may use only a real store key, whatever it was built with.
    adapter = deferred(async () => {
      const { createRevenueCatBilling, revenueCatApiKey } = await import('./revenuecat');
      return createRevenueCatBilling(revenueCatApiKey(debug));
    });
  } else {
    // The web build: the dev server plays the full game (Settings' dev switch
    // plays the free plan); a production web build starts free and "buys" locally.
    adapter = createMockBilling({ entitled: import.meta.env.DEV });
  }
  return adapter;
}

/** Test seam. */
export function setBillingForTests(next: BillingAdapter | null): void {
  adapter = next;
}

export type { BillingAdapter, EntitlementCheck, ProductInfo, PurchaseResult } from './types';
export { FULL_ENTITLEMENT_ID, FULL_PRODUCT_ID } from './types';
