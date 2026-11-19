import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shell's configuration. See `plans/capacitor.md`.
 *
 * `appId` is the Play Store identity and the Java package; it is effectively
 * permanent once published. `server.androidScheme` is pinned rather than left to
 * default because it decides the WebView's *origin* — and the origin is what
 * `localStorage` is keyed by. Changing `https`/`localhost` here would orphan every
 * player's save (`src/meta/save/index.ts`).
 *
 * The game was called "The Tower" until R6 (`plans/review-risks.md`). Only
 * the display name changed: `appId`, the scheme and hostname, and every
 * storage key (`the-tower-*`, IndexedDB `the-tower`, `tower-*`) keep the
 * legacy name for good.
 */
const config: CapacitorConfig = {
  appId: 'com.mariusdonci.thetower',
  appName: 'Blue Hour',
  webDir: 'dist',
  // Matches --theme-color / the theme-color meta (Blue hour's indigo). This is what shows for the
  // frame between the native splash going away and the first canvas paint.
  backgroundColor: '#1d2148',
  android: {
    backgroundColor: '#1d2148',
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
      backgroundColor: '#1d2148',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      // Dark ground, light glyphs.
      style: 'DARK',
      backgroundColor: '#1d2148',
      overlaysWebView: true,
    },
  },
};

export default config;
