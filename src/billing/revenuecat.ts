/**
 * revenuecat.ts — the native billing adapter.
 *
 * The plugin is imported dynamically so that the web bundle never pulls it in:
 * it is dead weight there, and `billing/index.ts` never constructs this adapter
 * off-device.
 *
 * Every method swallows its errors and reports a result instead. A store that is
 * down, an unlicensed tester, or a device with no Play Services must degrade to
 * "you cannot buy right now", never to a crash — the app's whole value is
 * offline and none of it depends on this succeeding.
 */

import type { CustomerInfo } from '@revenuecat/purchases-capacitor';
import { classifyPurchaseError } from './purchaseErrors';
import { revenueCatKey } from './storeKey';
import {
  type BillingAdapter,
  type EntitlementCheck,
  FULL_ENTITLEMENT_ID,
  FULL_PRODUCT_ID,
  type ProductInfo,
  type PurchaseResult,
} from './types';

/**
 * The public SDK key from the RevenueCat dashboard (Project → API keys →
 * Google Play, the key beginning `goog_`).
 *
 * This one is safe to ship: it is the *public* key, it can only read and create
 * purchases for the device that holds it, and RevenueCat is designed around it
 * being in the client. It is not the secret key — never put that in this file.
 *
 * Only a store key counts here: a release refuses anything else, the Test Store
 * key included (`storeKey.ts`), and `npm run check:release` fails on it.
 */
const REVENUECAT_PUBLIC_KEY = 'TODO: goog_ key from the Blue Hour RevenueCat project';

/**
 * The Test Store key (Project → API keys → Test Store), used only by a debug
 * APK built with `npm run android:test-store`. Its purchases are free and
 * fake. The flag is fixed at build time, so any other build compiles this to ''
 * and the key is not in its bundle at all.
 */
const REVENUECAT_TEST_STORE_KEY = __REVENUECAT_TEST_STORE__
  ? 'TODO: test_ key from the Blue Hour RevenueCat project'
  : '';

/** The key this build may use; `testStore` is true only for a debug APK. */
export function revenueCatApiKey(testStore: boolean): string | null {
  return revenueCatKey({
    testStore,
    storeKey: REVENUECAT_PUBLIC_KEY,
    testStoreKey: REVENUECAT_TEST_STORE_KEY,
  });
}

const hasFull = (info: CustomerInfo): boolean =>
  info.entitlements.active[FULL_ENTITLEMENT_ID] !== undefined;

/** `apiKey` null: no usable key, so every call reports the store unreachable. */
export function createRevenueCatBilling(apiKey: string | null): BillingAdapter {
  let plugin: typeof import('@revenuecat/purchases-capacitor') | null = null;
  /**
   * The one configure call, shared by everyone who needs it. Every method goes
   * through here, not only `init`: the paywall asks for the price, and the
   * player can tap Buy, before `entitlement.refresh` has finished — or
   * after it failed — and the SDK throws on any call made before `configure`.
   * A failed attempt is forgotten so the next caller retries it.
   */
  let configuring: Promise<boolean> | null = null;

  async function load() {
    if (!plugin) plugin = await import('@revenuecat/purchases-capacitor');
    return plugin;
  }

  function ensureConfigured(): Promise<boolean> {
    configuring ??= (async () => {
      if (apiKey === null) {
        // Kept, not forgotten like a failed attempt: a missing key does not
        // come back on a retry, and one warning is enough.
        console.warn('[Billing] no RevenueCat key this build may use; the store is off');
        return false;
      }
      try {
        const { Purchases, LOG_LEVEL } = await load();
        // Best-effort: since plugin v14 the void methods reject on native
        // errors, and a failed log-level call must not keep the store off.
        await Purchases.setLogLevel({ level: LOG_LEVEL.ERROR }).catch(() => {});
        await Purchases.configure({ apiKey });
        return true;
      } catch (e) {
        console.warn('[Billing] init failed:', e);
        configuring = null;
        return false;
      }
    })();
    return configuring;
  }

  /**
   * The package that sells the full game. Matched by product id rather than
   * taken blind from the front of the offering, so a second package added in
   * the dashboard (a sale price, a test SKU) cannot become what the paywall
   * prices and sells. Falls back to the first package when none matches: that
   * is the offering's own default, and what this adapter always sold before.
   */
  async function fullPackage() {
    const { Purchases } = await load();
    const packages = (await Purchases.getOfferings()).current?.availablePackages ?? [];
    return packages.find((p) => p.product.identifier === FULL_PRODUCT_ID) ?? packages[0] ?? null;
  }

  const notConfigured = (): PurchaseResult => ({
    status: 'unavailable',
    message: 'The store could not be reached. Check your connection and try again.',
  });

  /**
   * Shown instead of the SDK's own wording, which is written for developers.
   * It never promises that nothing was charged: some of the errors that land
   * here (a backend error, a receipt RevenueCat would not accept) come after
   * Google Play has taken the payment. The SDK posts such a purchase again on
   * a later launch, and the entitlement listener opens the game when it lands.
   */
  const genericFailure = (): PurchaseResult => ({
    status: 'error',
    message: 'The purchase didn’t go through. If Google Play charged you, tap “Restore purchase”; otherwise, please try again.',
  });

  return {
    init: async () => {
      await ensureConfigured();
    },

    getProduct: async (): Promise<ProductInfo | null> => {
      if (!(await ensureConfigured())) return null;
      try {
        const pkg = await fullPackage();
        if (!pkg) return null;
        return { priceString: pkg.product.priceString };
      } catch (e) {
        console.warn('[Billing] getProduct failed:', e);
        return null;
      }
    },

    checkEntitlement: async (options): Promise<EntitlementCheck> => {
      if (!(await ensureConfigured())) return 'unknown';
      try {
        const { Purchases } = await load();
        const { customerInfo } = await Purchases.getCustomerInfo();
        if (hasFull(customerInfo)) return 'entitled';
        if (!options?.confirmAbsence) return 'not-entitled';
        // A player the app believes has paid, and RevenueCat does not know
        // about: a refund — or a reinstall, or a backup restored onto a new
        // phone, whose anonymous RevenueCat user has not been linked to the Play
        // purchase yet. Restoring asks Play for the account's purchases (silently
        // on Android) and links them, so only a "no" after that is a refund.
        const restored = await Purchases.restorePurchases();
        return hasFull(restored.customerInfo) ? 'entitled' : 'not-entitled';
      } catch (e) {
        console.warn('[Billing] entitlement check failed:', e);
        return 'unknown';
      }
    },

    purchase: async (): Promise<PurchaseResult> => {
      if (!(await ensureConfigured())) return notConfigured();
      try {
        const { Purchases } = await load();
        const pkg = await fullPackage();
        if (!pkg) {
          return {
            status: 'unavailable',
            message: `The store has no product "${FULL_PRODUCT_ID}" right now.`,
          };
        }
        const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
        // Paid, but RevenueCat grants no entitlement: the dashboard has not
        // attached `full_game` to the entitlement (the runbook's step 2). The
        // player has paid, so they are told so, and pointed at Restore.
        if (hasFull(customerInfo)) return { status: 'purchased' };
        console.warn(`[Billing] purchase of ${pkg.product.identifier} granted no "${FULL_ENTITLEMENT_ID}" entitlement`);
        return {
          status: 'error',
          message: 'Google Play took your payment, but the unlock hasn’t arrived yet. Tap “Restore purchase” in a moment.',
        };
      } catch (e) {
        const kind = classifyPurchaseError(e);
        if (kind === 'cancelled') return { status: 'cancelled' };
        // The raw SDK message stays in the log; the player gets plain words.
        console.warn(`[Billing] purchase failed (${kind}):`, e);
        if (kind === 'pending') return { status: 'pending' };
        if (kind === 'network') return notConfigured();
        if (kind === 'already-owned') {
          // Play still holds the purchase but this install's RevenueCat user
          // is not linked to it: a reinstall, or cleared app data. Linking it
          // is exactly what restore does.
          try {
            const { Purchases } = await load();
            const { customerInfo } = await Purchases.restorePurchases();
            if (hasFull(customerInfo)) return { status: 'already-owned' };
          } catch (restoreError) {
            console.warn('[Billing] restore after already-owned failed:', restoreError);
          }
          return {
            status: 'error',
            message: 'You already own the full game. Tap “Restore purchase” to unlock it.',
          };
        }
        return genericFailure();
      }
    },

    restore: async (): Promise<PurchaseResult> => {
      if (!(await ensureConfigured())) return notConfigured();
      try {
        const { Purchases } = await load();
        const { customerInfo } = await Purchases.restorePurchases();
        return hasFull(customerInfo) ? { status: 'already-owned' } : { status: 'not-found' };
      } catch (e) {
        const kind = classifyPurchaseError(e);
        console.warn(`[Billing] restore failed (${kind}):`, e);
        if (kind === 'network') return notConfigured();
        return {
          status: 'error',
          message: 'Your purchase could not be checked just now. Please try again.',
        };
      }
    },

    // The SDK re-reads the Play purchases itself whenever the app comes to the
    // foreground, and pushes the result here. This is how a pending payment
    // that clears while the app is open unlocks without a restart.
    onEntitlementChange: (listener) => {
      let callbackId: string | undefined;
      let disposed = false;
      const remove = (id: string) => {
        void load()
          .then(({ Purchases }) =>
            Purchases.removeCustomerInfoUpdateListener({ listenerToRemove: id }),
          )
          .catch(() => {});
      };
      void (async () => {
        if (!(await ensureConfigured())) return;
        try {
          const { Purchases } = await load();
          const id = await Purchases.addCustomerInfoUpdateListener((info) =>
            listener(hasFull(info)),
          );
          // The registration can resolve after a teardown that already ran.
          if (disposed) remove(id);
          else callbackId = id;
        } catch (e) {
          console.warn('[Billing] customer info listener failed:', e);
        }
      })();
      return () => {
        disposed = true;
        if (callbackId !== undefined) remove(callbackId);
      };
    },
  };
}
