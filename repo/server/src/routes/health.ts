import { Router } from 'express'
import { config } from '../config.js'

const startedAt = Date.now()

/**
 * cold-start-health. Doubles as Render's configured health-check path and the
 * frontend's cold-start detection target.
 *
 * `COLD_START_SIMULATE_DELAY_MS` is a TEST HARNESS, not a fixture (D25): cold
 * start has no fixture in F1–F14 and this endpoint does not retroactively claim
 * otherwise. The flag is inert by default and inert under a production-like
 * NODE_ENV — `config.harnessDelay` refuses to read it when NODE_ENV=production,
 * so the harness cannot leak into production behaviour.
 */
export function healthRouter(): Router {
  const router = Router()

  router.get('/health', async (_req, res) => {
    if (config.coldStartSimulateDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.coldStartSimulateDelayMs))
    }
    res.json({ status: 'ok', uptimeMs: Date.now() - startedAt })
  })

  return router
}
