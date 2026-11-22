import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  root: '.',
  define: {
    // A debug APK built for RevenueCat's Test Store (`npm run android:test-store`).
    // Fixed at build time, so any other build compiles the Test Store key out
    // (src/billing/revenuecat.ts); `npm run check:release` refuses it set.
    __REVENUECAT_TEST_STORE__: JSON.stringify(loadEnv(mode, process.cwd(), '').REVENUECAT_TEST_STORE === '1'),
  },
  // UI plan §9.E: relative base path so `dist/` can be served from anywhere
  // (Capacitor's `capacitor://` or `https://` host, a sub-path on a static
  // site, etc.) without re-bundling. The icon sprite is already relative —
  // `ICON_SPRITE_PATH = 'icons/sprite.svg'` — which is exactly the path it
  // will resolve to.
  base: './',
  server: {
    // Honour PORT so a second dev server (or a tool that assigns a free port)
    // can run alongside one that already holds 5173.
    port: Number(process.env.PORT) || 5173,
    open: false,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
  },
}));
