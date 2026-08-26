import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
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
});
