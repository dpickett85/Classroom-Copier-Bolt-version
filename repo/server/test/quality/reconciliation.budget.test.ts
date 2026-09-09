/**
 * Quality budget: `reconciliation_invariant_all_fixtures` (owner: transfer-engine).
 *
 * `transferred + fallback_shell + skipped == count(items) == scan.totalPostsScanned`
 * for every fixture, with `totalPostsScanned` READ FROM THE PERSISTED SCAN ROW.
 * The previous gate derived both sides from one in-test read of the same
 * fixture, which made it a tautology in the test and an unenforced assumption
 * in production.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { checkInvariant } from '../../src/services/reconciliation.js'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { runTransfer } from '../helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

const CASES: { fixture: string; source: string; accountId: string; target: string }[] = [
  { fixture: 'F1', source: FIXTURE_KEYS.F1, accountId: 'acct-jamie', target: FIXTURE_KEYS.TARGET_JAMIE },
  { fixture: 'F2', source: FIXTURE_KEYS.F2, accountId: 'acct-jamie', target: FIXTURE_KEYS.TARGET_JAMIE },
  { fixture: 'F3', source: FIXTURE_KEYS.F3, accountId: 'acct-jamie', target: FIXTURE_KEYS.TARGET_JAMIE },
  { fixture: 'F4', source: FIXTURE_KEYS.F4, accountId: 'acct-jamie', target: FIXTURE_KEYS.TARGET_JAMIE },
  { fixture: 'F5', source: FIXTURE_KEYS.F5, accountId: 'acct-jamie', target: FIXTURE_KEYS.TARGET_JAMIE },
  { fixture: 'F6', source: FIXTURE_KEYS.F6, accountId: 'acct-dana', target: FIXTURE_KEYS.TARGET_DANA },
  { fixture: 'F7', source: FIXTURE_KEYS.F7, accountId: 'acct-dana', target: FIXTURE_KEYS.TARGET_DANA },
  { fixture: 'F13', source: FIXTURE_KEYS.F13, accountId: 'acct-dana', target: FIXTURE_KEYS.TARGET_DANA },
  { fixture: 'F14', source: FIXTURE_KEYS.F14, accountId: 'acct-dana', target: FIXTURE_KEYS.TARGET_DANA },
]

describe('[budget] reconciliation_invariant_all_fixtures', () => {
  for (const c of CASES) {
    it(`${c.fixture} reconciles exactly, with topics excluded from the sum`, async () => {
      const { jobId } = await runTransfer(db.prisma, {
        accountId: c.accountId,
        sourceCourseId: c.source,
        targetCourseId: c.target,
      })
      const result = await checkInvariant(db.prisma, jobId)
      console.log(`[budget] reconciliation ${c.fixture}: ${result.detail}`)
      expect(result.holds, `${c.fixture}: ${result.detail}`).toBe(true)

      const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
      const sum =
        result.counts.transferred + result.counts.fallbackShell + result.counts.skippedTotal
      expect(sum).toBe(result.totalPostsScanned)
      const topics = job.topicsCreatedCount + job.topicsReusedCount
      if (topics > 0) {
        expect(sum + topics).not.toBe(result.totalPostsScanned)
      }
    })
  }
})
