/**
 * The Capacitor shell's only web-side surface. Kept from the legacy game.
 *
 * Every entry point is guarded by `Capacitor.isNativePlatform()`, so importing
 * this module from a browser tab (dev server, `vite preview`) costs one branch
 * and nothing else. The plugin packages ship web fallbacks, but the fallbacks
 * still install listeners we do not want in a tab.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

/** True inside the Android (or a future iOS) shell, false in any browser. */
export const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * Called once, as early as the bundle runs — before the sprite fetch resolves.
 * The status bar has to be told to overlay the WebView *and* to draw light
 * glyphs; the config's `StatusBar` block covers a cold start, but a config-only
 * setup loses to any theme the OS re-applies on resume, so it is re-asserted here.
 */
export async function initNativeShell(): Promise<void> {
  if (!isNative()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    // A status-bar failure is cosmetic. Never let it cost the boot.
  }
}

/**
 * Called after the UI has mounted and the first frame is on screen. Hiding the
 * splash any earlier shows the player an empty canvas.
 */
export async function hideNativeSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    await SplashScreen.hide();
  } catch {
    /* nothing to hide */
  }
}

/**
 * Back button and lifecycle.
 *
 * `onBack` returns true when it consumed the press by closing something. When
 * nothing was open we **minimise** rather than exit: the game is an idle game,
 * a killed process is a lost session, and Android's own convention for a single
 * -activity app at the root of its stack is to go to the launcher.
 *
 * `onPause` exists next to the app's `visibilitychange` handler, not instead
 * of it: this is the last hook that reliably runs before the OS is free to kill
 * the process from the background. It returns a promise because the save
 * backend is asynchronous, and this is the one place where waiting for the
 * write is both possible and worth it. `onResume` may fire twice for one
 * return (the state change and the resume event); the app's handler is
 * idempotent.
 */
export function bindNativeLifecycle(handlers: {
  onBack: () => boolean;
  onPause: () => Promise<void> | void;
  /** Back in front: the app settles the absence (offline earnings, §6.1). */
  onResume: () => void;
}): void {
  if (!isNative()) return;

  void App.addListener('backButton', () => {
    if (!handlers.onBack()) void App.minimizeApp();
  });

  void App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) void handlers.onPause();
    else handlers.onResume();
  });

  void App.addListener('pause', () => { void handlers.onPause(); });
  void App.addListener('resume', () => { handlers.onResume(); });
}
