/**
 * storeKey.ts — which RevenueCat key a build may configure the SDK with.
 *
 * Two kinds of public key exist. A store key (`goog_…`, later `appl_…`) talks to
 * a real store and is the only kind a release may use. A Test Store key
 * (`test_…`) talks to RevenueCat's own fake store: purchases there cost nothing
 * and unlock nothing real, so a release carrying one would sell the full game
 * for free to everyone. The rule is pure so it can be tested; the keys
 * themselves live in `revenuecat.ts`.
 */

/** A real store's public key: Google Play, App Store or Amazon. */
const STORE_KEY = /^(goog|appl|amzn)_[A-Za-z0-9]+$/;

/** RevenueCat Test Store key. */
const TEST_STORE_KEY = /^test_[A-Za-z0-9]+$/;

export interface KeyChoice {
  /**
   * True only in a debuggable build made with `REVENUECAT_TEST_STORE=1`. A
   * release never passes true, whatever it was built with.
   */
  testStore: boolean;
  /** `REVENUECAT_PUBLIC_KEY`: the Google Play key (`goog_…`). */
  storeKey: string;
  /** The Test Store key, or '' in a build that was not made for the Test Store. */
  testStoreKey: string;
}

/**
 * The key to configure, or null when there is none this build may use. Null
 * leaves the adapter unconfigured, so the paywall says the store cannot be
 * reached and no purchase can happen.
 *
 * Neither mode falls back to the other: a test build must not reach Google
 * Play (a debug APK has no Play licence, and a purchase there would be real),
 * and a release must not reach the Test Store.
 */
export function revenueCatKey({ testStore, storeKey, testStoreKey }: KeyChoice): string | null {
  if (testStore) return TEST_STORE_KEY.test(testStoreKey) ? testStoreKey : null;
  return STORE_KEY.test(storeKey) ? storeKey : null;
}
