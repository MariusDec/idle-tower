import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shell's configuration. See `plans/capacitor.md`.
 *
 * `appId` is the Play Store identity and the Java package; it is effectively
 * permanent once published. `server.androidScheme` is pinned rather than left to
 * default because it decides the WebView's *origin* — and the origin is what
 * `localStorage` is keyed by. Changing `https`/`localhost` here would orphan every
 * player's save (`the-tower-save`, `src/systems/SaveManager.ts`).
 */
const config: CapacitorConfig = {
  appId: 'com.mariusdonci.thetower',
  appName: 'The Tower',
  webDir: 'dist',
  // Matches --surface-0 / the theme-color meta. This is what shows for the
  // frame between the native splash going away and the first canvas paint.
  backgroundColor: '#0a0d14',
  android: {
    backgroundColor: '#0a0d14',
    // The canvas owns its own pinch/zoom semantics; the WebView must not add any.
    zoomEnabled: false,
  },
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
  },
  plugins: {
    SplashScreen: {
      // The game hides it itself once the icon sprite is injected and the UI has
      // mounted (src/platform/native.ts), so there is no white gap.
      launchAutoHide: false,
      backgroundColor: '#0a0d14',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      // Dark ground, light glyphs.
      style: 'DARK',
      backgroundColor: '#0a0d14',
      overlaysWebView: true,
    },
  },
};

export default config;
