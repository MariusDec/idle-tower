// Ported from learn-thai: src/billing/{purchaseErrors,storeKey,revenuecat}.test.ts (plans/monetization.md §2.3).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FULL_ENTITLEMENT_ID, FULL_PRODUCT_ID } from '../src/billing/types';
import { classifyPurchaseError } from '../src/billing/purchaseErrors';
import { revenueCatKey } from '../src/billing/storeKey';

describe('classifyPurchaseError', () => {
  it('reads a cancel from the flag or the code', () => {
    expect(classifyPurchaseError({ userCancelled: true, code: '1' })).toBe('cancelled');
    expect(classifyPurchaseError({ code: '1' })).toBe('cancelled');
    expect(classifyPurchaseError({ data: { userCancelled: true } })).toBe('cancelled');
  });

  it('recognises a product already owned', () => {
    expect(classifyPurchaseError({ code: '6', message: 'already owned' })).toBe('already-owned');
    expect(classifyPurchaseError({ code: 6 })).toBe('already-owned');
  });

  it('recognises a payment the store has not confirmed yet', () => {
    expect(classifyPurchaseError({ code: '20' })).toBe('pending');
    expect(classifyPurchaseError({ data: { code: '20' } })).toBe('pending');
  });

  it('recognises no connection', () => {
    expect(classifyPurchaseError({ code: '10' })).toBe('network');
    expect(classifyPurchaseError({ code: '35' })).toBe('network');
  });

  it('calls anything else "other"', () => {
    expect(classifyPurchaseError({ code: '2', message: 'store problem' })).toBe('other');
    expect(classifyPurchaseError(new Error('boom'))).toBe('other');
    expect(classifyPurchaseError(null)).toBe('other');
    // A false flag is not a cancel.
    expect(classifyPurchaseError({ userCancelled: false, code: '6' })).toBe('already-owned');
  });
});

const GOOG = 'goog_AbC123';
const TEST = 'test_dcNmbJXNojAtHKcbIuFBhpwhqKA';

describe('revenueCatKey', () => {
  it('a release uses the store key', () => {
    expect(revenueCatKey({ testStore: false, storeKey: GOOG, testStoreKey: '' })).toBe(GOOG);
    expect(revenueCatKey({ testStore: false, storeKey: 'appl_Xyz9', testStoreKey: '' })).toBe(
      'appl_Xyz9',
    );
  });

  it('a release refuses a Test Store key pasted in as the store key', () => {
    expect(revenueCatKey({ testStore: false, storeKey: TEST, testStoreKey: '' })).toBeNull();
  });

  it('a release refuses the placeholder', () => {
    const storeKey = 'TODO: goog_xxxxxxxxxxxxxxxxxxxxxxxxx';
    expect(revenueCatKey({ testStore: false, storeKey, testStoreKey: TEST })).toBeNull();
  });

  it('a release never falls back to the Test Store key', () => {
    expect(revenueCatKey({ testStore: false, storeKey: '', testStoreKey: TEST })).toBeNull();
  });

  it('a Test Store build uses the Test Store key', () => {
    expect(revenueCatKey({ testStore: true, storeKey: GOOG, testStoreKey: TEST })).toBe(TEST);
  });

  it('a Test Store build never falls back to the real store', () => {
    expect(revenueCatKey({ testStore: true, storeKey: GOOG, testStoreKey: '' })).toBeNull();
    expect(revenueCatKey({ testStore: true, storeKey: GOOG, testStoreKey: GOOG })).toBeNull();
  });
});

/**
 * The adapter's error handling against a fake plugin. Error shapes follow the
 * plugin's `PurchasesError` (`code` is a numeric string).
 */
const plugin = vi.hoisted(() => ({
  purchaseError: null as unknown,
  /** What a successful purchase grants: false is a dashboard missing the entitlement. */
  purchaseEntitled: true,
  restoreEntitled: false,
  restoreError: null as unknown,
  restoreCalls: 0,
  configureCalls: 0,
}));

// Keyed by the real constant: the identifier is whatever the dashboard says.
const info = (pro: boolean) => ({
  entitlements: { active: pro ? { [FULL_ENTITLEMENT_ID]: {} } : {} },
});

vi.mock('@revenuecat/purchases-capacitor', () => ({
  LOG_LEVEL: { ERROR: 'ERROR' },
  Purchases: {
    setLogLevel: async () => undefined,
    configure: async () => {
      plugin.configureCalls++;
    },
    getOfferings: async () => ({
      current: {
        availablePackages: [{ product: { identifier: 'full_game', priceString: '€1' } }],
      },
    }),
    purchasePackage: async () => {
      if (plugin.purchaseError) throw plugin.purchaseError;
      return { customerInfo: info(plugin.purchaseEntitled) };
    },
    restorePurchases: async () => {
      plugin.restoreCalls++;
      if (plugin.restoreError) throw plugin.restoreError;
      return { customerInfo: info(plugin.restoreEntitled) };
    },
  },
}));

const { createRevenueCatBilling, revenueCatApiKey } = await import('../src/billing/revenuecat');

beforeEach(() => {
  plugin.purchaseError = null;
  plugin.purchaseEntitled = true;
  plugin.restoreEntitled = false;
  plugin.restoreError = null;
  plugin.restoreCalls = 0;
  plugin.configureCalls = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('purchase', () => {
  it('turns "already owned" into an unlock by restoring', async () => {
    plugin.purchaseError = { code: '6', message: 'The product is already owned' };
    plugin.restoreEntitled = true;
    expect(await createRevenueCatBilling('goog_test').purchase()).toEqual({
      status: 'already-owned',
    });
    expect(plugin.restoreCalls).toBe(1);
  });

  it('points at Restore when the restore does not find it either', async () => {
    plugin.purchaseError = { code: '6', message: 'The product is already owned' };
    const result = await createRevenueCatBilling('goog_test').purchase();
    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.message).toMatch(/Restore purchase/);
  });

  it('reports a pending payment as pending', async () => {
    plugin.purchaseError = { code: '20', message: 'The payment is pending' };
    expect(await createRevenueCatBilling('goog_test').purchase()).toEqual({ status: 'pending' });
  });

  it('pins the ids (D-7)', () => {
    expect(FULL_PRODUCT_ID).toBe('full_game');
    expect(FULL_ENTITLEMENT_ID).toBe('blue-hour-full');
  });

  it('reports no connection with the store-unreachable message', async () => {
    plugin.purchaseError = { code: '10', message: 'Error performing request' };
    const result = await createRevenueCatBilling('goog_test').purchase();
    expect(result.status).toBe('unavailable');
  });

  it('never shows the SDK’s own wording', async () => {
    plugin.purchaseError = { code: '2', message: 'BillingClient SERVICE_UNAVAILABLE (-1)' };
    const result = await createRevenueCatBilling('goog_test').purchase();
    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.message).not.toMatch(/BillingClient/);
  });

  it('never tells a player who may have paid that nothing was charged', async () => {
    // A backend error can follow a payment Google Play already took.
    plugin.purchaseError = { code: '16', message: 'Unknown backend error' };
    const result = await createRevenueCatBilling('goog_test').purchase();
    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.message).not.toMatch(/nothing was charged/i);
    expect(result.status === 'error' && result.message).toMatch(/Restore purchase/);
  });

  it('tells a player who paid but got no entitlement that they paid, and to restore', async () => {
    plugin.purchaseEntitled = false;
    const result = await createRevenueCatBilling('goog_test').purchase();
    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.message).toMatch(/took your payment/);
    expect(result.status === 'error' && result.message).toMatch(/Restore purchase/);
  });

  it('keeps a cancel silent', async () => {
    plugin.purchaseError = { code: '1', userCancelled: true };
    expect(await createRevenueCatBilling('goog_test').purchase()).toEqual({ status: 'cancelled' });
  });
});

describe('restore', () => {
  it('says not-found, not cancelled, when there is nothing to restore', async () => {
    expect(await createRevenueCatBilling('goog_test').restore()).toEqual({ status: 'not-found' });
  });

  it('unlocks when there is', async () => {
    plugin.restoreEntitled = true;
    expect(await createRevenueCatBilling('goog_test').restore()).toEqual({
      status: 'already-owned',
    });
  });
});

describe('without a usable key', () => {
  it('never configures the SDK and reports the store unreachable', async () => {
    const billing = createRevenueCatBilling(null);
    expect((await billing.purchase()).status).toBe('unavailable');
    expect((await billing.restore()).status).toBe('unavailable');
    expect(await billing.getProduct()).toBeNull();
    expect(await billing.checkEntitlement()).toBe('unknown');
    expect(plugin.configureCalls).toBe(0);
  });

  it('ships no Test Store key outside a Test Store build', () => {
    // The Play key is `npm run check:release`'s to insist on: until the
    // RevenueCat project exists it is a TODO, and the store stays off.
    expect(revenueCatApiKey(true)).toBeNull();
  });
});
