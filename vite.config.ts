import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
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
