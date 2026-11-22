import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    pool: 'forks',
    fileParallelism: false,
    // Applied to process.env BEFORE test files (and therefore the app modules
    // that validate the environment at import time) are loaded.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:55433/crm_test',
      JWT_ACCESS_SECRET: 'test-secret-at-least-32-characters-long',
      LOG_LEVEL: 'silent',
    },
  },
});
