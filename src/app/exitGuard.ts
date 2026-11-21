/** How long the first back press at the Tower waits for a second one, in ms. */
export const EXIT_WINDOW_MS = 2000;

/**
 * Two backs to leave (Android's convention for a root screen): the first press
 * at the Tower only warns, a second inside the window leaves. A press after the
 * window has run out warns again. `reset` forgets a pending first press (the
 * player moved off the Tower, or the app went to the background).
 */
export interface ExitGuard {
  /** True when this press should leave the app; false when it only warned. */
  press(): boolean;
  reset(): void;
}

export function exitGuard(windowMs = EXIT_WINDOW_MS, now: () => number = () => Date.now()): ExitGuard {
  let armedAt: number | null = null;
  return {
    press() {
      const t = now();
      if (armedAt !== null && t - armedAt <= windowMs) {
        armedAt = null;
        return true;
      }
      armedAt = t;
      return false;
    },
    reset() {
      armedAt = null;
    },
  };
}
