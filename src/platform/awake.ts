import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Keeping the screen on (R5 §4). In a browser, through the web's Screen Wake
 * Lock; inside the Android app, through the game's own `ScreenAwake` plugin
 * (`ScreenAwakePlugin.java`: the window's keep-screen-on flag), since a
 * WebView need not grant the web lock. Neither needs a manifest permission.
 *
 * The app says each frame whether it wants the screen awake; this holds a
 * lock exactly while it does and the page is visible. The browser drops a
 * lock when the page is hidden, so a return to the page asks again. Where the
 * API is missing or refuses (a desktop tab without a gesture, a battery
 * saver), nothing happens: the screen keeps its usual timeout.
 */

/** The slice of `navigator.wakeLock` this uses: injectable for tests. */
export interface WakeLockApi {
  request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(type: 'release', fn: () => void): void }>;
}

/** After a refusal, how long before asking again. */
const RETRY_MS = 30_000;

type Sentinel = Awaited<ReturnType<WakeLockApi['request']>>;

export class ScreenAwake {
  private wanted = false;
  private lock: Sentinel | null = null;
  /** A request in flight: no second one until it settles. */
  private asking = false;
  /** When a request was last refused: no new one for `RETRY_MS`, unless the page is shown again. */
  private refusedAt = -Infinity;

  constructor(
    private readonly api: WakeLockApi | null = defaultApi(),
    private readonly visible: () => boolean = () => typeof document === 'undefined' || document.visibilityState === 'visible',
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Whether a lock is held now. */
  get held(): boolean {
    return this.lock !== null;
  }

  /** Want the screen awake, or not. Cheap on no change: call it every frame. */
  want(on: boolean): void {
    this.wanted = on;
    if (on) this.acquire();
    else if (this.lock) this.drop();
  }

  /** The page was shown again: a lock the browser dropped while hidden is asked for anew. */
  shown(): void {
    this.refusedAt = -Infinity;
    if (this.wanted) this.acquire();
  }

  private acquire(): void {
    if (!this.api || this.asking || this.lock || !this.visible()) return;
    if (this.now() - this.refusedAt < RETRY_MS) return;
    this.asking = true;
    this.api.request('screen').then(
      (lock) => {
        this.asking = false;
        // Unwanted while it was being granted: give it straight back.
        if (!this.wanted) {
          void lock.release().catch(() => undefined);
          return;
        }
        this.lock = lock;
        lock.addEventListener('release', () => {
          if (this.lock === lock) this.lock = null;
        });
      },
      () => {
        // Refused (hidden, battery saver, no gesture yet): the next `want` or `shown` tries again.
        this.asking = false;
        this.refusedAt = this.now();
      },
    );
  }

  private drop(): void {
    const lock = this.lock;
    this.lock = null;
    if (lock) void lock.release().catch(() => undefined);
  }
}

interface ScreenAwakePlugin {
  set(opts: { on: boolean }): Promise<void>;
}

/**
 * The native flag dressed as a wake lock. Android drops the flag's effect by
 * itself while the app is behind, so the lock never reports a release.
 */
export function nativeApi(plugin: ScreenAwakePlugin): WakeLockApi {
  return {
    request: async () => {
      await plugin.set({ on: true });
      return {
        release: () => plugin.set({ on: false }),
        addEventListener: () => undefined,
      };
    },
  };
}

function defaultApi(): WakeLockApi | null {
  if (Capacitor.isNativePlatform()) return nativeApi(registerPlugin<ScreenAwakePlugin>('ScreenAwake'));
  if (typeof navigator === 'undefined') return null;
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  return api ?? null;
}
