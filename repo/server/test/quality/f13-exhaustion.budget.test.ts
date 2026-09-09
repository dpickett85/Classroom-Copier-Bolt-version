/**
 * Quality budget: `fixture_f13_exhaustion_terminal` (owner: transfer-engine).
 *
 * Target: `attemptCount == 5, outcome == fallback_shell, targetPostId != null`.
 *
 * The third clause is the one that matters. Under the old F13 definition ("the
 * mock call ALWAYS returns 429 regardless of attempt count") this budget was
 * unsatisfiable as written: the guaranteed shell was created by the same call
 * that had just refused five times, so the sixth attempt refused identically
 * and the item could never reach `fallback_shell`. Asserting `targetPostId`
 * is what stops "fallback shell" from meaning a ledger row with no post
 * behind it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachmentFallbackNote, rateLimitExhaustionNote } from '@classroom-copier/shared'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { MAX_ATTEMPTS } from '../../src/services/backoff.js'
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

describe('[budget] fixture_f13_exhaustion_terminal', () => {
  it('attemptCount == 5, outcome == fallback_shell, and a REAL target post exists', async () => {
    const { jobId } = await runTransfer(db.prisma, {
      accountId: 'acct-dana',
      sourceCourseId: FIXTURE_KEYS.F13,
      targetCourseId: FIXTURE_KEYS.TARGET_DANA,
    })
    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, title: 'Semester Reflection Prompt' },
    })
    console.log(
      `[budget] f13: attemptCount=${item.attemptCount} outcome=${item.outcome} targetPostId=${item.targetPostId ?? 'null'}`,
    )
    expect(item.attemptCount).toBe(MAX_ATTEMPTS)
    expect(item.outcome).toBe('fallback_shell')
    expect(item.targetPostId).not.toBeNull()

    const post = await db.prisma.mockCourseWork.findUnique({ where: { id: item.targetPostId! } })
    expect(post, 'the fallback shell must be a real post, not a ledger row').not.toBeNull()
    expect(post!.state).toBe('DRAFT')

    expect(item.note).toBe(rateLimitExhaustionNote(MAX_ATTEMPTS))
    expect(item.note).not.toBe(attachmentFallbackNote('Reflection prompt.docx'))

    const invariant = await checkInvariant(db.prisma, jobId)
    expect(invariant.holds, invariant.detail).toBe(true)
  })
})
