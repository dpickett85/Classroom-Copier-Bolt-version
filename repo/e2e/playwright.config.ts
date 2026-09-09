import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Real-browser E2E suite (Chromium only) for Classroom Copier.
 *
 * Runs against ALTERNATE ports so it never collides with a dev server the
 * main checkout may already have running on 4000/5173:
 *   server -> 4100 (PORT)
 *   client -> 5273 (vite --port), proxying /api to the server via
 *             DEV_API_ORIGIN so the session cookie stays same-origin.
 *
 * The whole suite runs serially (fullyParallel:false, workers:1) — every spec
 * shares one account (acct-jamie) and one server process, and the server only
 * tracks ONE active transfer job per account at a time, so parallel specs
 * would race each other's jobs.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const SERVER_PORT = 4100
const CLIENT_PORT = 5273

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run -w server dev',
      cwd: repoRoot,
      url: `http://localhost:${SERVER_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: String(SERVER_PORT),
        SESSION_SECRET: 'e2e-test-secret',
        CORS_ORIGINS: `http://localhost:${CLIENT_PORT}`,
        GOOGLE_PROVIDER_MODE: 'mock',
        FEATURE_MONETIZATION_ENABLED: 'false',
        // Slow the mock provider enough that the refresh-resume spec can
        // reload mid-batch during an F4 (50-post) transfer. Applies to every
        // spec's transfers, but 150ms/item is negligible against F1/F2's
        // handful of posts.
        MOCK_PROVIDER_DELAY_MS: '150',
      },
    },
    {
      command: `npm run -w client dev -- --port ${CLIENT_PORT} --strictPort`,
      cwd: repoRoot,
      url: `http://localhost:${CLIENT_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DEV_API_ORIGIN: `http://localhost:${SERVER_PORT}`,
      },
    },
  ],
})
