import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Every file shares one local database, and the audit tests count rows
    // and briefly revoke a grant. Serial files keep that deterministic.
    fileParallelism: false,
  },
});
