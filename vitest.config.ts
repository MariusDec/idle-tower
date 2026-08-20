import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Everything under test is pure logic over plain objects; nothing here
    // touches the DOM, so the default node environment is enough and keeps
    // the suite dependency-free beyond vitest itself.
    environment: 'node',
  },
});
