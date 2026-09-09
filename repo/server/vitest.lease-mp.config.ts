import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * The two-process lease harness's OWN config — `test/lease-mp/**` only.
 *
 * Deliberately separate from `vitest.config.ts` (which explicitly excludes
 * this directory) rather than a CLI path filter: a path filter still has to
 * match the DEFAULT config's `include` glob to resolve to any tests, and
 * would put this suite one accidental config edit away from silently
 * rejoining `npm test`. A dedicated config with its own `include` is the one
 * that cannot regress that way.
 *
 * Run via `npm run -w server test:lease-mp`, never as part of `npm test`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/lease-mp/**/*.test.ts'],
    globalSetup: ['./test/helpers/global-setup.ts'],
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@classroom-copier/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
})
