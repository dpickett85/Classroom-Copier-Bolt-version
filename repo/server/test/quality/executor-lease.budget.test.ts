/**
 * Quality budget: `executor_lease_mutual_exclusion` (owner: transfer-engine).
 * Target: exactly one writer of a job's terminal state; heartbeats in every gap.
 *
 * P0-2. The reconciler used to select purely on a stale heartbeat, with no
 * lease, epoch or version column anywhere and every executor write an
 * unconditional `update where {id}`. A live-but-slow executor therefore got
 * reconciled underneath itself: its pending items were rewritten, `status` was
 * set to `interrupted`, and — the severe part — `activeAccountId` was nulled
 * WHILE THE JOB WAS STILL RUNNING, releasing the single-active-job guard and
 * admitting a second executor into the same target course. The executor then
 * overwrote every verdict and wrote `completed` on top.
 *
 * Reachability was not theoretical: `jobStaleAfterMs` is 60s, and there was no
 * heartbeat at all during topic creation or the hydration enumeration — the two
 * places a run with `MOCK_PROVIDER_DELAY_MS` (a variable `config.ts` documents
 * for driving the deployed app by hand) sits silent for longer than that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockClassroomProvider } from '../../src/adapters/mock/mock-classroom-provider.js'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { JobReconciler } from '../../src/services/job-reconciler.js'
import { checkInvariant, countOutcomes } from '../../src/services/reconciliation.js'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { scanAndCreateJob } from '../helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await db.dispose()
})

describe('[budget] executor_lease_mutual_exclusion', () => {
  it('a reconciler firing mid-flight takes the job, and the executor stands down', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })

    // Fire the reconciler at the worst possible instant: the executor is alive
    // and has just written a post, and its heartbeat happens to be old.
    let raced = false
    const realCreate = run.provider.createCourseWork.bind(run.provider)
    vi.spyOn(run.provider, 'createCourseWork').mockImplementation(async (courseId, payload) => {
      const created = await realCreate(courseId, payload)
      if (!raced) {
        raced = true
        await db.prisma.transferJob.update({
          where: { id: run.jobId },
          data: { lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) },
        })
        await new JobReconciler(db.prisma, new MockClassroomProvider(db.prisma), {
          staleAfterMs: 60_000,
          reauthGraceMs: 30 * 60 * 1000,
        }).reconcileStaleJobs()
      }
      return created
    })

    await run.engine.run(run.jobId)

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: run.jobId } })
    const counts = await countOutcomes(db.prisma, run.jobId)
    console.log(
      `[budget] lease race: status=${job.status} executorId=${job.executorId ?? 'null'} ` +
        `activeAccountId=${job.activeAccountId ?? 'null'} pending=${counts.pending}`,
    )

    // Exactly one writer of the terminal state. The reconciler claimed it, so
    // the executor's `completed` write must have been refused.
    expect(job.status).toBe('interrupted')
    expect(job.executorId).toBeNull()
    expect(job.activeAccountId).toBeNull()
    expect(job.finishedAt).not.toBeNull()

    // And the ledger is still whole.
    expect(counts.pending).toBe(0)
    const invariant = await checkInvariant(db.prisma, run.jobId)
    expect(invariant.holds, invariant.detail).toBe(true)
  })

  it('an executor whose lease was revoked writes nothing further to the job', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })

    let revoked = false
    const realCreate = run.provider.createCourseWork.bind(run.provider)
    vi.spyOn(run.provider, 'createCourseWork').mockImplementation(async (courseId, payload) => {
      const created = await realCreate(courseId, payload)
      if (!revoked) {
        revoked = true
        // Whatever revoked it — a reconciler, an operator, a second executor —
        // the lease is gone.
        await db.prisma.transferJob.update({
          where: { id: run.jobId },
          data: { executorId: null, status: 'interrupted', activeAccountId: null },
        })
      }
      return created
    })

    await run.engine.run(run.jobId)

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: run.jobId } })
    // Neither `completed` nor `failed` — the executor did not get to have an
    // opinion about a job it no longer owns.
    expect(job.status).toBe('interrupted')
  })

  it('heartbeats through topic creation and through the hydration enumeration', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })

    let heartbeats = 0
    type JobWriter = (args: { data?: Record<string, unknown> }) => unknown
    const realUpdateMany = db.prisma.transferJob.updateMany.bind(db.prisma.transferJob) as JobWriter
    vi.spyOn(db.prisma.transferJob, 'updateMany').mockImplementation(((args: {
      data?: Record<string, unknown>
    }) => {
      if (args.data && 'lastHeartbeatAt' in args.data) heartbeats += 1
      return realUpdateMany(args)
    }) as unknown as typeof db.prisma.transferJob.updateMany)

    const atTopic: number[] = []
    const realCreateTopic = run.provider.createTopic.bind(run.provider)
    vi.spyOn(run.provider, 'createTopic').mockImplementation(async (courseId, name) => {
      atTopic.push(heartbeats)
      return realCreateTopic(courseId, name)
    })

    const atMaterialsPage: number[] = []
    const realListMaterials = run.provider.listCourseWorkMaterials.bind(run.provider)
    vi.spyOn(run.provider, 'listCourseWorkMaterials').mockImplementation(async (courseId, req) => {
      atMaterialsPage.push(heartbeats)
      return realListMaterials(courseId, req)
    })

    await run.engine.run(run.jobId)
    console.log(
      `[budget] heartbeats: atTopic=[${atTopic.join(',')}] atMaterialsPage=[${atMaterialsPage.join(',')}] total=${heartbeats}`,
    )

    // F1 has two topics. Before the fix, `buildTopicMap` created every topic in
    // one silent loop.
    expect(atTopic.length).toBeGreaterThanOrEqual(2)
    expect(
      atTopic[atTopic.length - 1]!,
      'no heartbeat between the first and last topic creation',
    ).toBeGreaterThan(atTopic[0]!)

    // ...and by the time the second surface is enumerated, the first surface's
    // pages have already reported liveness.
    expect(atMaterialsPage.length).toBeGreaterThan(0)
    expect(
      atMaterialsPage[0]!,
      'no heartbeat during the hydration enumeration',
    ).toBeGreaterThan(atTopic[atTopic.length - 1]!)
  })
})
