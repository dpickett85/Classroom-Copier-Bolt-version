/**
 * Quality budget: `fixture_f1_zero_fallback` (owner: transfer-engine).
 * Target: 0 fallback shells on the healthy F1 course (>=95% product bar).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { countOutcomes } from '../../src/services/reconciliation.js'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { runTransfer } from '../helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

describe('[budget] fixture_f1_zero_fallback', () => {
  it('a healthy source produces zero fallback shells and zero skips', async () => {
    const { jobId } = await runTransfer(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const counts = await countOutcomes(db.prisma, jobId)
    const fidelity = counts.totalItems === 0 ? 1 : counts.transferred / counts.totalItems
    console.log(
      `[budget] f1: fallback=${counts.fallbackShell} skipped=${counts.skippedTotal} fidelity=${(fidelity * 100).toFixed(1)}%`,
    )
    expect(counts.fallbackShell).toBe(0)
    expect(counts.skippedTotal).toBe(0)
    expect(fidelity).toBeGreaterThanOrEqual(0.95)
  })
})
