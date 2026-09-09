/**
 * Quality budget: `engine_throughput_f4_50posts` (owner: quality-budgets).
 * Target: < 120s of server-side engine time for F4's 50 posts, EXCLUDING client
 * poll overhead and with F12's slow mode OFF.
 *
 * The slow-mode exclusion is the correction: as seeded course data it would
 * have slowed this very course, and the budget would have been measuring its
 * own harness rather than the engine.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { checkInvariant } from '../../src/services/reconciliation.js'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { scanAndCreateJob } from '../helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

const BUDGET_MS = 120_000

describe('[budget] engine_throughput_f4_50posts', () => {
  it('transfers 50 posts in under 120s of engine time', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F4,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
      // Explicitly no perItemDelayMs — F12's harness must not skew this row.
      providerOptions: {},
    })

    const startedAt = performance.now()
    await run.engine.run(run.jobId)
    const elapsedMs = performance.now() - startedAt

    const invariant = await checkInvariant(db.prisma, run.jobId)
    console.log(
      `[budget] perf f4: ${elapsedMs.toFixed(0)}ms for ${invariant.counts.totalItems} posts (budget ${BUDGET_MS}ms)`,
    )
    expect(invariant.counts.totalItems).toBe(50)
    expect(invariant.holds, invariant.detail).toBe(true)
    expect(elapsedMs).toBeLessThan(BUDGET_MS)
  })
})
