// Ported from learn-thai's src/state/entitlementStore.test.ts (plans/monetization.md §2.4).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingAdapter, EntitlementCheck } from '../src/billing';
import { setBillingForTests } from '../src/billing';
import { createMockBilling } from '../src/billing/mock';
import { ENTITLEMENT_KEY, RESUME_RECHECK_MS, createEntitlement } from '../src/app/entitlement';
import { MemorySaveStore } from '../src/meta/save/stores/SaveStore';

let data = new MemorySaveStore();
const cached = async (): Promise<unknown> => {
  const raw = await data.get(ENTITLEMENT_KEY);
  return raw === null ? null : JSON.parse(raw);
};

interface FakeBilling extends BillingAdapter {
  calls: Array<{ confirmAbsence?: boolean } | undefined>;
  /** Simulate the store pushing a change of its own. */
  push: (entitled: boolean) => void;
}

function fakeBilling(answer: () => Promise<EntitlementCheck>): FakeBilling {
  const calls: FakeBilling['calls'] = [];
  let listener: ((entitled: boolean) => void) | null = null;
  return {
    calls,
    push: (entitled) => listener?.(entitled),
    onEntitlementChange: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    init: async () => {},
    getProduct: async () => null,
    checkEntitlement: (options) => {
      calls.push(options);
      return answer();
    },
    purchase: async () => ({ status: 'purchased' }),
    restore: async () => ({ status: 'not-found' }),
  };
}

/** A fresh entitlement over `cache`, talking to `billing`. */
async function setup(cache: 'free' | 'full' | null, billing: BillingAdapter) {
  data = new MemorySaveStore();
  if (cache) await data.set(ENTITLEMENT_KEY, JSON.stringify({ plan: cache, verifiedAt: null }));
  setBillingForTests(billing);
  const store = createEntitlement({ store: () => data });
  await store.load();
  return store;
}

beforeEach(() => {
  setBillingForTests(null);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('entitlement.refresh', () => {
  it('downgrades a player the store definitely says is not entitled — a refund', async () => {
    const billing = fakeBilling(async () => 'not-entitled');
    const store = await setup('full', billing);

    await store.refresh();

    expect(store.plan()).toBe('free');
    await vi.waitFor(async () => expect(await cached()).toMatchObject({ plan: 'free' }));
  });

  it('asks the store to confirm the absence before downgrading a paying player', async () => {
    const billing = fakeBilling(async () => 'not-entitled');
    const store = await setup('full', billing);

    await store.refresh();

    expect(billing.calls).toEqual([{ confirmAbsence: true }]);
  });

  it('does not ask for confirmation when the player is already free', async () => {
    const billing = fakeBilling(async () => 'not-entitled');
    const store = await setup('free', billing);

    await store.refresh();

    expect(billing.calls).toEqual([{ confirmAbsence: false }]);
  });

  it('never downgrades on an unknown answer — offline, no Play Services', async () => {
    const store = await setup(
      'full',
      fakeBilling(async () => 'unknown'),
    );

    await store.refresh();

    expect(store.plan()).toBe('full');
    expect(await cached()).toMatchObject({ plan: 'full', verifiedAt: null });
  });

  it('upgrades a player the store says is entitled', async () => {
    const store = await setup(
      null,
      fakeBilling(async () => 'entitled'),
    );

    await store.refresh();

    expect(store.plan()).toBe('full');
  });

  it('does not undo a purchase that completed while the store was being asked', async () => {
    let answer: (v: EntitlementCheck) => void = () => {};
    const billing = fakeBilling(
      () => new Promise<EntitlementCheck>((resolve) => (answer = resolve)),
    );
    const store = await setup('free', billing);

    const refreshing = store.refresh();
    await vi.waitFor(() => expect(billing.calls).toHaveLength(1));
    await store.purchase();
    answer('not-entitled');
    await refreshing;

    expect(store.plan()).toBe('full');
  });
});

describe('entitlement.refresh, overlapping', () => {
  it('runs one more check for a call made while a check is running, not one per call', async () => {
    const answers: Array<(v: EntitlementCheck) => void> = [];
    const billing = fakeBilling(
      () => new Promise<EntitlementCheck>((resolve) => answers.push(resolve)),
    );
    const store = await setup('free', billing);

    const first = store.refresh();
    await vi.waitFor(() => expect(billing.calls).toHaveLength(1));
    void store.refresh();
    void store.refresh();
    answers[0]?.('not-entitled');
    await vi.waitFor(() => expect(billing.calls).toHaveLength(2));
    answers[1]?.('entitled');
    await first;

    expect(billing.calls).toHaveLength(2);
    expect(store.plan()).toBe('full');
  });
});

describe('entitlement.watch', () => {
  it('unlocks when the store reports a pending payment has cleared', async () => {
    let answer: EntitlementCheck = 'not-entitled';
    const billing = fakeBilling(async () => answer);
    const store = await setup('free', billing);
    const stop = store.watch();

    answer = 'entitled';
    billing.push(true);

    await vi.waitFor(() => expect(store.plan()).toBe('full'));
    stop();
  });

  it('ignores a push that agrees with the cache', async () => {
    const billing = fakeBilling(async () => 'entitled');
    const store = await setup('full', billing);
    const stop = store.watch();

    billing.push(true);
    await Promise.resolve();

    expect(billing.calls).toEqual([]);
    stop();
  });

  it('re-links before a "not entitled" push can revoke a paying player', async () => {
    const billing = fakeBilling(async () => 'not-entitled');
    const store = await setup('full', billing);
    const stop = store.watch();

    billing.push(false);

    await vi.waitFor(() => expect(store.plan()).toBe('free'));
    expect(billing.calls).toEqual([{ confirmAbsence: true }]);
    stop();
  });

  it('stops listening after teardown', async () => {
    const billing = fakeBilling(async () => 'entitled');
    const store = await setup('free', billing);
    store.watch()();

    billing.push(true);
    await Promise.resolve();

    expect(billing.calls).toEqual([]);
  });
});

describe('entitlement.refreshOnResume', () => {
  it('asks the store on resume, but not again within the throttle window', async () => {
    const billing = fakeBilling(async () => 'not-entitled');
    const store = await setup('free', billing);

    await store.refreshOnResume();
    await store.refreshOnResume(Date.now() + RESUME_RECHECK_MS / 2);
    expect(billing.calls).toHaveLength(1);

    await store.refreshOnResume(Date.now() + RESUME_RECHECK_MS + 1);
    expect(billing.calls).toHaveLength(2);
  });
});

describe('entitlement.loadPrice', () => {
  it('exposes the price the store reports, so the paywall CTA can show it', async () => {
    const billing = fakeBilling(async () => 'unknown');
    billing.getProduct = async () => ({ priceString: '€4.99' });
    const store = await setup('free', billing);

    expect(store.priceString()).toBeNull();
    await store.loadPrice();

    expect(store.priceString()).toBe('€4.99');
  });
});

describe('the web mock adapter', () => {
  it('never reports an absence, so a locally granted full survives a reload', async () => {

    expect(await createMockBilling().checkEntitlement({ confirmAbsence: true })).toBe('unknown');
    expect(await createMockBilling({ entitled: true }).checkEntitlement()).toBe('entitled');
  });

  it('reports no price — there is no store to quote one', async () => {

    expect(await createMockBilling().getProduct()).toBeNull();
  });
});


describe('entitlement, the game’s own', () => {
  it('tells its listeners once, when the plan changes, and not when it holds', async () => {
    const billing = fakeBilling(async () => 'entitled');
    const store = await setup('free', billing);
    const heard: string[] = [];
    store.subscribe((p) => heard.push(p));
    await store.refresh();
    await store.refresh();
    expect(heard).toEqual(['full']);
  });

  it('reads a broken cache as free, and never throws on it', async () => {
    data = new MemorySaveStore();
    await data.set(ENTITLEMENT_KEY, '{not json');
    setBillingForTests(fakeBilling(async () => 'unknown'));
    const store = createEntitlement({ store: () => data });
    await store.load();
    expect(store.plan()).toBe('free');
  });

  it('keeps the dev switch out of a build without it', async () => {
    const store = await setup('free', fakeBilling(async () => 'unknown'));
    store.setDevPlan('full');
    expect(store.devSwitch()).toBe(false);
    expect(store.plan()).toBe('free');
  });
});
