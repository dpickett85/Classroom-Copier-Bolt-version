/**
 * Quality budget: `duplicate_dedupe_fixture` — **blocking** (§8.1, §4.3).
 *
 * Every assertion here is a ZERO-PROVIDER-CALL assertion, and that is the whole
 * point of the file. §4.3 found that duplicate prevention is inert on the first
 * run: an item marked `duplicate_title` still reaches `transferPost`, still
 * calls `createCourseWork`, and creates a REAL second copy in the teacher's
 * destination course. `finish()` then refuses the ledger write because the row
 * is already terminal, so the reconciliation sum balances, the item reads
 * `skipped`, and the app shows nothing wrong. The only witness is Google
 * Classroom.
 *
 * So an outcome assertion here would pass against the broken engine and would
 * therefore be evidence of nothing. These assert on the provider call log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { logger } from '../../src/logger.js'
import { MockClassroomProvider } from '../../src/adapters/mock/mock-classroom-provider.js'
import { PreflightEngine } from '../../src/services/preflight-engine.js'
import { TransferEngine, createTransferJob } from '../../src/services/transfer-engine.js'
import { checkInvariant, countOutcomes } from '../../src/services/reconciliation.js'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { recordingProvider } from '../helpers/recording-provider.js'
import { FAST_ENGINE } from '../helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
  vi.restoreAllMocks()
})

/** F15's four seeded duplicate titles — the posts that must never be created. */
const DUPLICATE_TITLES = [
  'Angle Pairs Practice',
  'Proof Writing Quiz',
  'Triangle Congruence  Notes',
  'Circle Theorems Packet',
]

describe('[budget] duplicate_dedupe_fixture — first run, cold start, no pause', () => {
  it('makes ZERO create calls carrying a duplicate title, and one per pending item', async () => {
    const rec = recordingProvider(new MockClassroomProvider(db.prisma))
    const scan = await new PreflightEngine(db.prisma, rec.provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F15_SOURCE,
      targetCourseId: FIXTURE_KEYS.F15_TARGET,
    })
    expect(scan.duplicates).toHaveLength(4)

    const { jobId } = await createTransferJob(db.prisma, {
      accountId: 'acct-jamie',
      scanId: scan.scanId,
      resolutions: [],
    })

    // Counted BEFORE the run: the target is "one create per item that was
    // pending when the job started", so duplicates must already be resolved.
    const pendingAtStart = await db.prisma.transferJobItem.count({
      where: { jobId, outcome: 'pending' },
    })

    const errorSpy = vi.spyOn(logger, 'error')
    rec.mark('run')
    await new TransferEngine(db.prisma, rec.provider, FAST_ENGINE).run(jobId)

    const titles = rec.createdTitles(rec.since('run'))
    console.log(
      `[budget] dedupe first run: pendingAtStart=${pendingAtStart} createCalls=${titles.length} ` +
        `duplicateTitleCreates=${titles.filter((t) => DUPLICATE_TITLES.includes(t)).length}`,
    )

    for (const duplicate of DUPLICATE_TITLES) {
      expect(titles, `"${duplicate}" was created in the destination course`).not.toContain(
        duplicate,
      )
    }
    expect(titles).toHaveLength(pendingAtStart)
    expect(pendingAtStart).toBe(3)

    // The signature of the defect: a create that succeeded followed by a ledger
    // write the pending-predicate refused. Its ABSENCE is part of the gate.
    const refusals = errorSpy.mock.calls.filter(([message]) =>
      message.includes('refused to overwrite an already-terminal item outcome'),
    )
    expect(refusals, JSON.stringify(refusals)).toHaveLength(0)
  })

  it('resolves each duplicate as exactly one skipped/duplicate_title item, ledger balanced', async () => {
    const rec = recordingProvider(new MockClassroomProvider(db.prisma))
    const scan = await new PreflightEngine(db.prisma, rec.provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F15_SOURCE,
      targetCourseId: FIXTURE_KEYS.F15_TARGET,
    })
    const { jobId } = await createTransferJob(db.prisma, {
      accountId: 'acct-jamie',
      scanId: scan.scanId,
      resolutions: [],
    })
    await new TransferEngine(db.prisma, rec.provider, FAST_ENGINE).run(jobId)

    const duplicates = await db.prisma.transferJobItem.findMany({
      where: { jobId, skipReason: 'duplicate_title' },
    })
    expect(duplicates.map((d) => d.title).sort()).toEqual([...DUPLICATE_TITLES].sort())
    for (const item of duplicates) {
      expect(item.outcome).toBe('skipped')
      // Never attempted, so it must carry no evidence of a write.
      expect(item.targetPostId).toBeNull()
      expect(item.claimedTargetPostId).toBeNull()
      expect(item.attemptedAt).toBeNull()
    }

    // §6.5 — the invariant is UNCHANGED; duplicates land in `skipped`.
    const invariant = await checkInvariant(db.prisma, jobId)
    expect(invariant.holds, invariant.detail).toBe(true)

    // §6.4/F6 — and they are their own bucket, not "interrupted before we could
    // confirm they copied".
    const counts = await countOutcomes(db.prisma, jobId)
    expect(counts.skippedDuplicate).toBe(4)
    expect(counts.skippedBySystem).toBe(0)
    expect(counts.skippedTotal).toBe(
      counts.skippedByUser + counts.skippedBySystem + counts.skippedDuplicate,
    )
  })
})
