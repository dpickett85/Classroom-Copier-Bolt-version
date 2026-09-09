/**
 * The rewritten `composition-root` acceptance gate.
 *
 * The previous gate seeded 10 pending items and asserted all 10 became
 * `skipped`. That gate ASSERTED THE BUG: an item whose provider call had
 * already succeeded but whose checkpoint write had not was recorded as
 * "skipped", the Completion Summary rendered that tile as "Skipped by you", and
 * the teacher re-created a post that already existed. This seeds a MIX and
 * asserts each class lands correctly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockClassroomProvider } from '../adapters/mock/mock-classroom-provider.js'
import { FIXTURE_KEYS } from '../fixtures/index.js'
import { createTestDb, type TestDb } from '../../test/helpers/db.js'
import { scanAndCreateJob } from '../../test/helpers/transfer.js'
import { JobReconciler } from './job-reconciler.js'
import { checkInvariant, countOutcomes } from './reconciliation.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

async function seedInterruptedJob() {
  const run = await scanAndCreateJob(db.prisma, {
    accountId: 'acct-jamie',
    sourceCourseId: FIXTURE_KEYS.F1,
    targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
  })
  const items = await db.prisma.transferJobItem.findMany({
    where: { jobId: run.jobId },
    orderBy: { createdOrder: 'asc' },
  })
  expect(items.length).toBeGreaterThanOrEqual(3)

  const neverAttempted = items[0]!
  const attemptedAndPresent = items[1]!
  const attemptedAndAbsent = items[2]!

  // P0-4 — the job's own clock. Nothing created before this instant can be this
  // job's work, and the title fallback is scoped by it.
  const startedAt = new Date(Date.now() - 12 * 60_000)

  // Class 1: never attempted — attemptedAt IS NULL. Left as-is.

  // Class 2: attempted, and the post ACTUALLY EXISTS in the target. This is the
  // crash-after-write-before-checkpoint window that used to be reported as a
  // user-chosen skip. Deliberately WITHOUT `claimedTargetPostId`, so this case
  // exercises the title FALLBACK rather than the primary evidence path.
  await db.prisma.mockCourseWork.create({
    data: {
      id: 'target-recovered-post',
      courseId: FIXTURE_KEYS.TARGET_JAMIE,
      title: attemptedAndPresent.title,
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      creationTime: new Date(startedAt.getTime() + 1_000),
      createdOrder: 0,
    },
  })
  await db.prisma.transferJobItem.update({
    where: { id: attemptedAndPresent.id },
    data: { attemptedAt: new Date(), attemptCount: 1, sourceType: 'courseWork' },
  })

  // Class 3: attempted, and nothing was created.
  await db.prisma.transferJobItem.update({
    where: { id: attemptedAndAbsent.id },
    data: { attemptedAt: new Date(), attemptCount: 1 },
  })

  // Make the job look wedged.
  await db.prisma.transferJob.update({
    where: { id: run.jobId },
    data: {
      status: 'running',
      startedAt,
      lastHeartbeatAt: new Date(Date.now() - 10 * 60_000),
    },
  })

  return { run, neverAttempted, attemptedAndPresent, attemptedAndAbsent, startedAt }
}

describe('D14 — reconciliation branches on EVIDENCE, never blanket-skips', () => {
  it('resolves each of the three classes correctly', async () => {
    const seeded = await seedInterruptedJob()
    const reconciler = new JobReconciler(db.prisma, new MockClassroomProvider(db.prisma), {
      staleAfterMs: 60_000, reauthGraceMs: 30 * 60 * 1000,
    })

    const result = await reconciler.reconcileStaleJobs()
    expect(result.jobsReconciled).toBe(1)
    expect(result.itemsVerifiedTransferred).toBe(1)
    expect(result.itemsSkippedNotFound).toBe(1)
    expect(result.itemsSkippedNeverAttempted).toBeGreaterThanOrEqual(1)

    const neverAttempted = await db.prisma.transferJobItem.findUniqueOrThrow({
      where: { id: seeded.neverAttempted.id },
    })
    expect(neverAttempted.outcome).toBe('skipped')
    expect(neverAttempted.skipReason).toBe('server_interrupted')
    expect(neverAttempted.targetPostId).toBeNull()

    const recovered = await db.prisma.transferJobItem.findUniqueOrThrow({
      where: { id: seeded.attemptedAndPresent.id },
    })
    // The post exists, so the ledger says so — and backfills what it created.
    expect(recovered.outcome).toBe('transferred')
    expect(recovered.targetPostId).toBe('target-recovered-post')

    const absent = await db.prisma.transferJobItem.findUniqueOrThrow({
      where: { id: seeded.attemptedAndAbsent.id },
    })
    expect(absent.outcome).toBe('skipped')
    expect(absent.skipReason).toBe('server_interrupted')
  })

  it('never attributes a system skip to the teacher — skippedByUser stays 0', async () => {
    await seedInterruptedJob()
    const reconciler = new JobReconciler(db.prisma, new MockClassroomProvider(db.prisma), {
      staleAfterMs: 60_000, reauthGraceMs: 30 * 60 * 1000,
    })
    await reconciler.reconcileStaleJobs()

    const job = await db.prisma.transferJob.findFirstOrThrow({ where: { status: 'interrupted' } })
    const counts = await countOutcomes(db.prisma, job.id)
    expect(counts.skippedBySystem).toBeGreaterThan(0)
    // This is the assertion the wireframe's "[ Skipped by you: 1 ]" tile made
    // false. A post the server abandoned is never the teacher's choice.
    expect(counts.skippedByUser).toBe(0)
  })

  it('marks the job interrupted, releases the active-job guard, and keeps the invariant', async () => {
    const seeded = await seedInterruptedJob()
    const reconciler = new JobReconciler(db.prisma, new MockClassroomProvider(db.prisma), {
      staleAfterMs: 60_000, reauthGraceMs: 30 * 60 * 1000,
    })
    await reconciler.reconcileStaleJobs()

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: seeded.run.jobId } })
    expect(job.status).toBe('interrupted')
    expect(job.activeAccountId).toBeNull()

    const invariant = await checkInvariant(db.prisma, seeded.run.jobId)
    expect(invariant.holds, invariant.detail).toBe(true)
  })

  it('leaves a job alone while its heartbeat is fresh', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    await db.prisma.transferJob.update({
      where: { id: run.jobId },
      data: { status: 'running', lastHeartbeatAt: new Date() },
    })
    const reconciler = new JobReconciler(db.prisma, new MockClassroomProvider(db.prisma), {
      staleAfterMs: 60_000, reauthGraceMs: 30 * 60 * 1000,
    })
    const result = await reconciler.reconcileStaleJobs()
    expect(result.jobsReconciled).toBe(0)
  })
})

describe('D12 — the reconciler runs on an INTERVAL, not only at boot', () => {
  it('resolves a wedged job without a process restart', async () => {
    const seeded = await seedInterruptedJob()
    const reconciler = new JobReconciler(db.prisma, new MockClassroomProvider(db.prisma), {
      staleAfterMs: 10, reauthGraceMs: 30 * 60 * 1000,
    })

    const stop = reconciler.start(20)
    // Wait for one tick. Before the interval existed, this job would have
    // polled a frozen counter forever: boot reconciliation never fires while
    // the process is alive, there is no watchdog and there is no cancel.
    await new Promise((resolve) => setTimeout(resolve, 120))
    stop()

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: seeded.run.jobId } })
    expect(job.status).toBe('interrupted')
    expect((await countOutcomes(db.prisma, seeded.run.jobId)).pending).toBe(0)
  })
})
