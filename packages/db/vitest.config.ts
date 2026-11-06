import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Every test here talks to the same database, so they must not interleave.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
