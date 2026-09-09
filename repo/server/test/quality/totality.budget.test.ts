/**
 * Quality budget: `no_pending_after_completion` (owner: transfer-engine).
 *
 * D12. Four error classes are injected — PermissionError, NotFoundError, an
 * arbitrary Error, and a top-level throw — and every one must leave zero
 * pending items behind. Before this, only RateLimitError had a declared exit
 * from `pending`, so the three terminal buckets could sum to LESS than
 * count(items) and the job could poll a frozen counter forever.
 *
 * The second describe block below is the HONESTY half (P0-1), and it exists
 * because the first half could not fail for it. Every injection above lands
 * BEFORE the provider create, so "zero pending" was proved while "the note tells
 * the truth" was never touched. A total function is not the same as an honest
 * one: the unconditional catch that closed the arithmetic also fired *after* a
 * successful create and rewrote a real post into `skipped`/`provider_error` with
 * `targetPostId` nulled and the note "Nothing was written to the target course".
 * These cases inject at each of the three reachable POST-CREATE throw sites.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError, PermissionError } from '../../src/adapters/types.js'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { checkInvariant, countOutcomes } from '../../src/services/reconciliation.js'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { scanAndCreateJob } from '../helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

const INJECTED: { name: string; error: Error }[] = [
  { name: 'PermissionError', error: new PermissionError('no access to the target course') },
  { name: 'NotFoundError', error: new NotFoundError('target course vanished') },
  { name: 'arbitrary Error', error: new TypeError("cannot read properties of undefined") },
]

describe('[budget] no_pending_after_completion', () => {
  for (const injected of INJECTED) {
    it(`${injected.name} still terminates every item`, async () => {
      const run = await scanAndCreateJob(db.prisma, {
        accountId: 'acct-jamie',
        sourceCourseId: FIXTURE_KEYS.F1,
        targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
      })
      vi.spyOn(run.provider, 'createCourseWork').mockRejectedValue(injected.error)
      vi.spyOn(run.provider, 'createCourseWorkMaterial').mockRejectedValue(injected.error)
      await run.engine.run(run.jobId)

      const result = await checkInvariant(db.prisma, run.jobId)
      console.log(`[budget] totality ${injected.name}: ${result.detail}`)
      expect(result.counts.pending).toBe(0)
      expect(result.holds, result.detail).toBe(true)
    })
  }

  it('a top-level executor throw lands status=failed with zero pending items', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    vi.spyOn(run.provider, 'listTopics').mockRejectedValue(new Error('executor blew up'))
    await run.engine.run(run.jobId)

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: run.jobId } })
    const counts = await countOutcomes(db.prisma, run.jobId)
    console.log(`[budget] totality top-level: status=${job.status} pending=${counts.pending}`)
    expect(job.status).toBe('failed')
    expect(counts.pending).toBe(0)
  })

  /* ================================================================ *
   * P0-1 — the honesty half. Each case injects a throw that can only
   * happen AFTER `issueCreate` has returned a real post id.
   * ================================================================ */

  const NOTHING_WRITTEN = 'Nothing was written to the target course'

  /**
   * Ground truth is the TARGET COURSE, not the ledger — the point of these
   * cases is that the ledger was lying about it. The target starts empty, so
   * anything in it was created by this run.
   */
  async function assertNoPostReportedAsUnwritten(jobId: string): Promise<void> {
    const [work, materials] = await Promise.all([
      db.prisma.mockCourseWork.findMany({ where: { courseId: FIXTURE_KEYS.TARGET_JAMIE } }),
      db.prisma.mockCourseWorkMaterial.findMany({
        where: { courseId: FIXTURE_KEYS.TARGET_JAMIE },
      }),
    ])
    const reallyInTarget = new Set([
      ...work.map((w) => `courseWork:${w.title}`),
      ...materials.map((m) => `courseWorkMaterial:${m.title}`),
    ])

    const items = await db.prisma.transferJobItem.findMany({ where: { jobId } })
    expect(items.length).toBeGreaterThan(0)
    let checked = 0
    for (const item of items) {
      if (!reallyInTarget.has(`${item.sourceType}:${item.title}`)) continue
      checked += 1
      expect(
        item.note ?? '',
        `"${item.title}" IS in the target course, but its note says nothing was written`,
      ).not.toContain(NOTHING_WRITTEN)
      expect(
        item.outcome,
        `"${item.title}" IS in the target course but was recorded as ${item.outcome}`,
      ).not.toBe('skipped')
      expect(item.targetPostId, `"${item.title}" lost its targetPostId`).not.toBeNull()
    }
    // A gate that checked nothing would be the failure mode this whole review
    // is about.
    expect(checked, 'no created post was actually checked').toBeGreaterThan(0)
  }

  it('a post-create throw from clearPause never becomes "nothing was written"', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })

    // clearPause runs immediately after a successful create and is two Prisma
    // writes outside any try. A SQLITE_BUSY here used to re-bucket a created
    // post as a system skip.
    const busy = (args: { data?: Record<string, unknown> }) =>
      args.data != null &&
      'rateLimitPause' in args.data &&
      args.data.rateLimitPause === null &&
      !('status' in args.data)

    type JobWriter = (args: { data?: Record<string, unknown> }) => unknown
    const realUpdate = db.prisma.transferJob.update.bind(db.prisma.transferJob) as JobWriter
    const realUpdateMany = db.prisma.transferJob.updateMany.bind(db.prisma.transferJob) as JobWriter
    const inject =
      (real: JobWriter): JobWriter =>
      (args) => {
        if (busy(args)) throw new Error('SQLITE_BUSY: database is locked')
        return real(args)
      }
    vi.spyOn(db.prisma.transferJob, 'update').mockImplementation(
      inject(realUpdate) as unknown as typeof db.prisma.transferJob.update,
    )
    vi.spyOn(db.prisma.transferJob, 'updateMany').mockImplementation(
      inject(realUpdateMany) as unknown as typeof db.prisma.transferJob.updateMany,
    )

    await run.engine.run(run.jobId)
    vi.restoreAllMocks()

    await assertNoPostReportedAsUnwritten(run.jobId)
    const result = await checkInvariant(db.prisma, run.jobId)
    console.log(`[budget] totality post-create clearPause: ${result.detail}`)
    expect(result.counts.pending).toBe(0)
  })

  it('a post-create throw from getRubric never becomes "nothing was written"', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    // getRubric sat OUTSIDE copyRubricIfAny's try, so a permission failure on
    // the rubric READ took down a post that had already been created.
    vi.spyOn(run.provider, 'getRubric').mockRejectedValue(
      new PermissionError('rubric read denied for this course'),
    )
    await run.engine.run(run.jobId)

    await assertNoPostReportedAsUnwritten(run.jobId)
    const counts = await countOutcomes(db.prisma, run.jobId)
    console.log(
      `[budget] totality post-create getRubric: transferred=${counts.transferred} skippedBySystem=${counts.skippedBySystem}`,
    )
    expect(counts.skippedBySystem).toBe(0)
    expect(counts.pending).toBe(0)
  })

  it('a post-create throw from updateCourseWorkDescription never becomes "nothing was written"', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    // Force the rubric-degraded path, which is the only caller of the
    // description patch, then make the patch itself fail.
    vi.spyOn(run.provider, 'createRubric').mockRejectedValue(
      new NotFoundError('rubric surface unavailable'),
    )
    vi.spyOn(run.provider, 'updateCourseWorkDescription').mockRejectedValue(
      new Error('patch failed'),
    )
    vi.spyOn(run.provider, 'updateCourseWorkMaterialDescription').mockRejectedValue(
      new Error('patch failed'),
    )
    await run.engine.run(run.jobId)

    await assertNoPostReportedAsUnwritten(run.jobId)
    const counts = await countOutcomes(db.prisma, run.jobId)
    console.log(
      `[budget] totality post-create description patch: transferred=${counts.transferred} rubricNotesAdded=${counts.rubricNotesAdded} skippedBySystem=${counts.skippedBySystem}`,
    )
    expect(counts.rubricNotesAdded).toBeGreaterThan(0)
    expect(counts.skippedBySystem).toBe(0)
    expect(counts.pending).toBe(0)
  })

  it('no job in the database ever reaches completed with a pending item', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F2,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    await run.engine.run(run.jobId)
    const completed = await db.prisma.transferJob.findMany({ where: { status: 'completed' } })
    for (const job of completed) {
      const pending = await db.prisma.transferJobItem.count({
        where: { jobId: job.id, outcome: 'pending' },
      })
      expect(pending, `job ${job.id} completed with pending items`).toBe(0)
    }
  })
})
