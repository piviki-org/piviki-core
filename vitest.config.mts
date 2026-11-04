import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Route handlers import the config as Next does (tsconfig paths).
  resolve: {
    alias: { '@payload-config': fileURLToPath(new URL('./src/payload.config.ts', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    // One shared Postgres; files reset the tables they use.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
