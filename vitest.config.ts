import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Billing's build flag (vite.config.ts): tests are never a Test Store build.
  define: { __REVENUECAT_TEST_STORE__: 'false' },
  test: {
    include: ['tests/**/*.test.ts'],
    // Everything under test is pure logic over plain objects; nothing here
    // touches the DOM, so the default node environment is enough and keeps
    // the suite dependency-free beyond vitest itself.
    environment: 'node',
  },
});
