/**
 * Quality budget: `interrupted_items_verified_not_assumed` (owner: composition-root).
 * Target: all classes correct, `skippedByUser == 0`, and NO false "transferred".
 *
 * This replaces the gate that asserted the bug — 10 pending items, all 10
 * become `skipped`. Under that gate, a post the server had actually created was
 * recorded as a skip and the Completion Summary told the teacher they had
 * chosen it.
 *
 * The cycle-1 replacement then had the opposite failure: it constructed the
 * HAPPY CASE (create a target post with the item's title, assert the matcher
 * matches) and so proved the mechanism rather than the key. The matcher keyed on
 * title alone, in a namespace shared with pre-existing posts, prior runs and
 * duplicates, and it manufactured "transferred" verdicts for posts that were
 * never copied — a silent drop produced by the anti-silent-drop mechanism.
 *
 * So the three false-positive cases below come FIRST, and each one asserts the
 * check REFUSES. Every one of them is red against a title-only matcher.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockClassroomProvider } from '../../src/adapters/mock/mock-classroom-provider.js'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { JobReconciler } from '../../src/services/job-reconciler.js'
import { checkInvariant, countOutcomes } from '../../src/services/reconciliation.js'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { runTransfer, scanAndCreateJob } from '../helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

function reconciler(): JobReconciler {
  return new JobReconciler(db.prisma, new MockClassroomProvider(db.prisma), {
    staleAfterMs: 60_000, reauthGraceMs: 30 * 60 * 1000,
  })
}

/** Mark every item attempted and wedge the job, with an explicit start time. */
async function wedge(jobId: string, startedAt: Date): Promise<void> {
  await db.prisma.transferJobItem.updateMany({
    where: { jobId },
    data: { attemptedAt: new Date(), attemptCount: 1 },
  })
  await db.prisma.transferJob.update({
    where: { id: jobId },
    data: {
      status: 'running',
      startedAt,
      lastHeartbeatAt: new Date(Date.now() - 10 * 60_000),
      activeAccountId: 'acct-jamie',
    },
  })
}

/** The invariant that outranks every count: one target post backs one item. */
async function assertNoSharedTargetPosts(jobId: string): Promise<void> {
  const items = await db.prisma.transferJobItem.findMany({ where: { jobId } })
  const seen = new Map<string, string>()
  for (const item of items) {
    if (!item.targetPostId) continue
    const other = seen.get(item.targetPostId)
    expect(
      other,
      `items "${other}" and "${item.id}" both claim target post ${item.targetPostId}`,
    ).toBeUndefined()
    seen.set(item.targetPostId, item.id)
  }
}

describe('[budget] interrupted_items_verified_not_assumed — the false-positive gates', () => {
  it('refuses a pre-existing post in a non-empty target whose title collides', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const items = await db.prisma.transferJobItem.findMany({
      where: { jobId: run.jobId },
      orderBy: { createdOrder: 'asc' },
    })
    const collided = items.find((i) => i.sourceType === 'courseWork')!
    const startedAt = new Date(Date.now() - 5 * 60_000)

    // UX permits transferring into an existing course. This post is a stranger's
    // — same title, created long before the job started.
    await db.prisma.mockCourseWork.create({
      data: {
        id: 'pre-existing-stranger',
        courseId: FIXTURE_KEYS.TARGET_JAMIE,
        title: collided.title,
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        creationTime: new Date(startedAt.getTime() - 60 * 60_000),
        createdOrder: 0,
      },
    })
    await wedge(run.jobId, startedAt)

    const result = await reconciler().reconcileStaleJobs()
    const after = await db.prisma.transferJobItem.findUniqueOrThrow({ where: { id: collided.id } })
    console.log(
      `[budget] reconcile pre-existing collision: verifiedTransferred=${result.itemsVerifiedTransferred} outcome=${after.outcome}`,
    )

    expect(after.outcome).toBe('skipped')
    expect(after.skipReason).toBe('server_interrupted')
    expect(after.targetPostId).toBeNull()
    expect(result.itemsVerifiedTransferred).toBe(0)
    await assertNoSharedTargetPosts(run.jobId)
  })

  it('refuses a dirty target left behind by a previous run of the same transfer', async () => {
    // Run the whole transfer once. The target now contains a post with EVERY
    // source title — which is what made the second run of any transfer verify
    // every attempted item as "transferred", unconditionally.
    const first = await runTransfer(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    expect((await countOutcomes(db.prisma, first.jobId)).transferred).toBeGreaterThan(0)

    const second = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    // The second job starts now; everything in the target predates it.
    await wedge(second.jobId, new Date())

    const result = await reconciler().reconcileStaleJobs()
    const counts = await countOutcomes(db.prisma, second.jobId)
    console.log(
      `[budget] reconcile dirty target: verifiedTransferred=${result.itemsVerifiedTransferred} ` +
        `notFound=${result.itemsSkippedNotFound} skippedByUser=${counts.skippedByUser}`,
    )

    expect(result.itemsVerifiedTransferred).toBe(0)
    expect(counts.transferred).toBe(0)
    expect(counts.skippedByUser).toBe(0)
    await assertNoSharedTargetPosts(second.jobId)
  })

  it('refuses on ambiguity when two source posts share a title', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const items = await db.prisma.transferJobItem.findMany({
      where: { jobId: run.jobId, sourceType: 'courseWork' },
      orderBy: { createdOrder: 'asc' },
    })
    const [a, b] = items
    expect(b).toBeDefined()

    const SHARED = 'Duplicate Title — Two Posts, One Name'
    await db.prisma.transferJobItem.updateMany({
      where: { id: { in: [a!.id, b!.id] } },
      data: { title: SHARED },
    })

    const startedAt = new Date(Date.now() - 5 * 60_000)
    for (const [index, id] of ['dupe-1', 'dupe-2'].entries()) {
      await db.prisma.mockCourseWork.create({
        data: {
          id,
          courseId: FIXTURE_KEYS.TARGET_JAMIE,
          title: SHARED,
          workType: 'ASSIGNMENT',
          state: 'DRAFT',
          creationTime: new Date(startedAt.getTime() + 1_000 + index),
          createdOrder: index,
        },
      })
    }
    await wedge(run.jobId, startedAt)

    const result = await reconciler().reconcileStaleJobs()
    const resolved = await db.prisma.transferJobItem.findMany({
      where: { id: { in: [a!.id, b!.id] } },
    })
    console.log(
      `[budget] reconcile duplicate titles: ambiguous=${result.itemsSkippedAmbiguous} ` +
        `outcomes=${resolved.map((r) => r.outcome).join(',')}`,
    )

    // `index.set` kept the last writer, so both items used to resolve to the
    // SAME targetPostId and nothing detected it.
    for (const item of resolved) {
      expect(item.outcome).toBe('skipped')
      expect(item.targetPostId).toBeNull()
    }
    expect(result.itemsSkippedAmbiguous).toBe(2)
    await assertNoSharedTargetPosts(run.jobId)
  })
})

describe('[budget] interrupted_items_verified_not_assumed — the true positives', () => {
  it('recovers an item from the evidence the JOB OWNS, not from a title', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const items = await db.prisma.transferJobItem.findMany({
      where: { jobId: run.jobId },
      orderBy: { createdOrder: 'asc' },
    })
    const [neverAttempted, claimed, attemptedAbsent] = items
    const startedAt = new Date(Date.now() - 5 * 60_000)

    // The executor got as far as writing `claimedTargetPostId` and then died.
    // That id names a specific post; it does not describe one.
    await db.prisma.mockCourseWork.create({
      data: {
        id: 'really-created-by-this-job',
        courseId: FIXTURE_KEYS.TARGET_JAMIE,
        // A DIFFERENT title from the item's, to prove the recovery is not
        // falling back on a title match.
        title: 'a title that matches no source post',
        workType: 'ASSIGNMENT',
        state: 'DRAFT',
        creationTime: new Date(startedAt.getTime() + 1_000),
        createdOrder: 0,
      },
    })
    await db.prisma.transferJobItem.update({
      where: { id: claimed!.id },
      data: {
        attemptedAt: new Date(),
        attemptCount: 1,
        claimedTargetPostId: 'really-created-by-this-job',
      },
    })
    await db.prisma.transferJobItem.update({
      where: { id: attemptedAbsent!.id },
      data: { attemptedAt: new Date(), attemptCount: 1 },
    })
    await db.prisma.transferJob.update({
      where: { id: run.jobId },
      data: {
        status: 'running',
        startedAt,
        lastHeartbeatAt: new Date(Date.now() - 10 * 60_000),
      },
    })

    const result = await reconciler().reconcileStaleJobs()
    const counts = await countOutcomes(db.prisma, run.jobId)
    console.log(
      `[budget] reconcile: verifiedTransferred=${result.itemsVerifiedTransferred} ` +
        `neverAttempted=${result.itemsSkippedNeverAttempted} notFound=${result.itemsSkippedNotFound} ` +
        `ambiguous=${result.itemsSkippedAmbiguous} ` +
        `skippedByUser=${counts.skippedByUser} skippedBySystem=${counts.skippedBySystem}`,
    )

    expect(result.itemsVerifiedTransferred).toBe(1)
    expect(result.itemsSkippedNotFound).toBe(1)
    expect(result.itemsSkippedNeverAttempted).toBeGreaterThanOrEqual(1)
    expect(
      (await db.prisma.transferJobItem.findUniqueOrThrow({ where: { id: claimed!.id } }))
        .targetPostId,
    ).toBe('really-created-by-this-job')
    expect(
      (await db.prisma.transferJobItem.findUniqueOrThrow({ where: { id: neverAttempted!.id } }))
        .skipReason,
    ).toBe('server_interrupted')

    // The headline assertion: nothing the server did is attributed to the teacher.
    expect(counts.skippedByUser).toBe(0)
    expect(counts.skippedBySystem).toBeGreaterThan(0)

    const invariant = await checkInvariant(db.prisma, run.jobId)
    expect(invariant.holds, invariant.detail).toBe(true)
    await assertNoSharedTargetPosts(run.jobId)
  })

  it('refuses to claim a post whose id the job recorded but which is not in the target', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId: run.jobId },
      orderBy: { createdOrder: 'asc' },
    })
    await db.prisma.transferJobItem.update({
      where: { id: item.id },
      data: {
        attemptedAt: new Date(),
        attemptCount: 1,
        claimedTargetPostId: 'a-post-that-does-not-exist',
      },
    })
    await db.prisma.transferJob.update({
      where: { id: run.jobId },
      data: {
        status: 'running',
        startedAt: new Date(Date.now() - 5 * 60_000),
        lastHeartbeatAt: new Date(Date.now() - 10 * 60_000),
      },
    })

    await reconciler().reconcileStaleJobs()
    const after = await db.prisma.transferJobItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(after.outcome).toBe('skipped')
    expect(after.targetPostId).toBeNull()
  })
})
