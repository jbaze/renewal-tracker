import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The tests share one seeded database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
