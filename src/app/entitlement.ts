/**
 * entitlement.ts — which plan the player is on, and how the game finds out
 * (plans/monetization.md §2.4). A port of learn-thai's `entitlementStore`,
 * written without Solid: a tiny observable instead of signals.
 *
 * Two rules make it work offline:
 *
 *  1. **The cache renders, the store verifies.** `plan()` comes from a cache
 *     read once at boot, before the hub is drawn. The billing SDK is asked in
 *     the background and, if it disagrees, the cache is rewritten and the
 *     listeners told. A player who has paid and is on a plane plays it all.
 *  2. **A verification failure never downgrades.** `refresh()` writes only on
 *     a definite answer. Offline, no Play Services, a signed-out account: none
 *     of those is evidence that a purchase didn't happen.
 *
 * A definite "not entitled" does downgrade: that is how a refund takes
 * effect. "Definite" means the store has first been asked to re-link this
 * account's purchases, so a paying player on a fresh install is re-linked,
 * not locked out.
 *
 * **The purchase is not in the profile** (Principle 3). The cache has its own
 * key in the save store, so exporting, importing or restoring a profile never
 * carries a purchase, and a broken profile never loses one. Android's backup
 * rules leave the key behind too (res/xml/backup_rules.xml).
 */

import { getBilling, type PurchaseResult } from '../billing';
import type { Plan } from '../meta/plan';
import { getSaveStore, type SaveStore } from '../meta/save/stores';
import { isNative, isNativeDebugBuild } from '../platform/native';

/** The cache's key in the save store. Fixed from the first release: renaming it forgets every purchase's cache. */
export const ENTITLEMENT_KEY = 'tower-entitlement';

/** The dev switch's key (localStorage): a plan forced in dev and debug builds only. */
const DEV_PLAN_KEY = 'blue-hour-dev-plan';

/**
 * The least time between two checks triggered by the app resuming. A paying
 * player's check re-links their Play purchases, a network round trip;
 * flicking between apps should not repeat it on every switch.
 */
export const RESUME_RECHECK_MS = 60_000;

interface EntitlementCache {
  plan: Plan;
  /** ISO timestamp of the last definite answer from the store, or null. */
  verifiedAt: string | null;
}

const DEFAULT_CACHE: EntitlementCache = { plan: 'free', verifiedAt: null };

function isEntitlementCache(v: unknown): v is EntitlementCache {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const plan = (v as EntitlementCache).plan;
  return plan === 'free' || plan === 'full';
}

export interface EntitlementOptions {
  /** Where the cache lives; the save store by default. */
  store?: () => SaveStore;
  /** Whether the dev switch exists: dev servers and debug APKs. */
  devSwitch?: boolean;
}

export type Entitlement = ReturnType<typeof createEntitlement>;

export function createEntitlement(options: EntitlementOptions = {}) {
  const saveStore = options.store ?? getSaveStore;
  const devSwitch = options.devSwitch ?? false;
  let cache: EntitlementCache = DEFAULT_CACHE;
  let loaded = false;
  let busy = false;
  let priceString: string | null = null;
  let devPlan: Plan | null = devSwitch ? readDevPlan() : null;
  const listeners = new Set<(plan: Plan) => void>();

  const plan = (): Plan => devPlan ?? cache.plan;

  /** Tell the listeners, once, when what `plan()` says has changed. */
  const changing = (edit: () => void): void => {
    const before = plan();
    edit();
    const after = plan();
    if (after !== before) for (const l of listeners) l(after);
  };

  const persist = (next: EntitlementCache): void => {
    void saveStore().set(ENTITLEMENT_KEY, JSON.stringify(next)).catch((e) => {
      console.warn('[Billing] entitlement cache not written:', e);
    });
  };

  const write = (next: EntitlementCache): void => {
    changing(() => { cache = next; });
    persist(next);
  };

  /** Read the cache. Called once at boot, before the hub is drawn. */
  const load = async (): Promise<void> => {
    if (loaded) return;
    try {
      const raw = await saveStore().get(ENTITLEMENT_KEY);
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      cache = isEntitlementCache(parsed) ? parsed : DEFAULT_CACHE;
    } catch (e) {
      console.warn('[Billing] entitlement cache unreadable:', e);
      cache = DEFAULT_CACHE;
    }
    loaded = true;
  };

  /** When the store was last asked, for the resume throttle. */
  let lastAskedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  let askAgain = false;

  const askOnce = async (): Promise<void> => {
    lastAskedAt = Date.now();
    const billing = getBilling();
    await billing.init();
    const before = cache;
    // Believing full, a "no" is taken only once the store has re-linked this
    // account's purchases (see `checkEntitlement`).
    const result = await billing.checkEntitlement({ confirmAbsence: before.plan === 'full' });
    // `unknown` writes nothing: a failed check must not revoke a purchase.
    if (result === 'unknown') return;
    // A purchase or restore that landed while the store was being asked is
    // newer than the answer; writing the answer would undo a purchase.
    if (cache !== before) return;
    write({ plan: result === 'entitled' ? 'full' : 'free', verifiedAt: new Date().toISOString() });
  };

  /**
   * Ask the store, in the background. Calls that overlap share one check,
   * but a call made while a check runs queues exactly one more after it: the
   * running check may have read the store's answer from before whatever
   * prompted the new call.
   */
  const refresh = (): Promise<void> => {
    if (inFlight) {
      askAgain = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        do {
          askAgain = false;
          await askOnce();
        } while (askAgain);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  /** Re-check on returning to the foreground, at most once per `RESUME_RECHECK_MS`. */
  const refreshOnResume = (now = Date.now()): Promise<void> => {
    if (now - lastAskedAt < RESUME_RECHECK_MS) return Promise.resolve();
    return refresh();
  };

  /**
   * Keep checking after boot: when the store pushes a change of its own (a
   * pending payment clearing, a refund), and when the app comes back to the
   * foreground. A push prompts a check only when it disagrees with the
   * cache, and the check, not the push, decides what is written. Returns a
   * teardown for tests; the game never calls it.
   */
  const watch = (): (() => void) => {
    const log = (e: unknown) => console.warn('[Billing] entitlement refresh failed:', e);
    const unsubscribe = getBilling().onEntitlementChange((entitled) => {
      if (entitled !== (cache.plan === 'full')) refresh().catch(log);
    });
    let removeAppState: (() => void) | undefined;
    let disposed = false;
    if (isNative()) {
      void import('@capacitor/app')
        .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) refreshOnResume().catch(log);
        }))
        .then((handle) => {
          if (disposed) void handle.remove();
          else removeAppState = () => void handle.remove();
        })
        .catch((e) => console.warn('[Billing] app-state listener unavailable:', e));
    }
    return () => {
      disposed = true;
      unsubscribe();
      removeAppState?.();
    };
  };

  /** Load the localised price for the paywall and the locked card. Null while unknown. */
  const loadPrice = async (): Promise<string | null> => {
    const product = await getBilling().getProduct();
    priceString = product?.priceString ?? null;
    return priceString;
  };

  /**
   * The full game, now: written to the cache, and any dev switch's forced
   * plan dropped, so a mock purchase in a dev build opens the game as a real
   * one would.
   */
  const grant = (): void => {
    const forced = devPlan !== null;
    const next: EntitlementCache = { plan: 'full', verifiedAt: new Date().toISOString() };
    changing(() => {
      devPlan = null;
      cache = next;
    });
    if (forced) writeDevPlan(null);
    persist(next);
  };

  const purchase = async (): Promise<PurchaseResult> => {
    if (busy) return { status: 'cancelled' };
    busy = true;
    try {
      const result = await getBilling().purchase();
      // Only "the full game is open now" writes. `pending` is paid but
      // unconfirmed; `watch` picks it up once it clears.
      if (result.status === 'purchased' || result.status === 'already-owned') grant();
      return result;
    } finally {
      busy = false;
    }
  };

  const restore = async (): Promise<PurchaseResult> => {
    if (busy) return { status: 'cancelled' };
    busy = true;
    try {
      const result = await getBilling().restore();
      // `not-found` writes nothing: it isn't evidence of a refund, only that
      // this store account has nothing to restore.
      if (result.status === 'already-owned' || result.status === 'purchased') grant();
      return result;
    } finally {
      busy = false;
    }
  };

  return {
    plan,
    /** True once `load` has read the cache. */
    loaded: (): boolean => loaded,
    busy: (): boolean => busy,
    priceString: (): string | null => priceString,
    /** Be told when `plan()` changes. Returns the unsubscribe. */
    subscribe: (listener: (plan: Plan) => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    refresh,
    refreshOnResume,
    watch,
    loadPrice,
    purchase,
    restore,
    /** Whether the dev switch exists in this build. */
    devSwitch: (): boolean => devSwitch,
    /** The dev switch's forced plan, or null when the store's answer holds. */
    devPlan: (): Plan | null => devPlan,
    /** Force a plan in a dev or debug build; null hands it back to the store. No-op elsewhere. */
    setDevPlan: (next: Plan | null): void => {
      if (!devSwitch) return;
      changing(() => { devPlan = next; });
      writeDevPlan(next);
    },
  };
}

function readDevPlan(): Plan | null {
  try {
    const v = localStorage.getItem(DEV_PLAN_KEY);
    return v === 'free' || v === 'full' ? v : null;
  } catch {
    return null;
  }
}

function writeDevPlan(plan: Plan | null): void {
  try {
    if (plan) localStorage.setItem(DEV_PLAN_KEY, plan);
    else localStorage.removeItem(DEV_PLAN_KEY);
  } catch {
    /* a private window: the switch lasts this session */
  }
}

/** The game's one entitlement. The dev switch exists on the dev server and in debug APKs. */
export const entitlement = createEntitlement({
  devSwitch: typeof window !== 'undefined' && (import.meta.env.DEV || isNativeDebugBuild()),
});
