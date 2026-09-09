/**
 * Quality budget: `reauth_grace_period_boundary` — advisory (§8.1).
 *
 * A job paused for re-auth stops heartbeating on purpose: the executor released
 * its lease and returned, and the next write will come from a resume minutes or
 * hours later. Under the ordinary staleness rule the reconciler would therefore
 * terminate it almost immediately — while the teacher is on Google's consent
 * screen doing precisely what the app just asked them to do.
 *
 * So both bounds are asserted, not just the interesting one: a guard that only
 * ever proves "it eventually fires" would also pass if it fired instantly.
 *
 * Also covers F9 (the pre-start token-lifetime floor) and F6 (the three-way
 * skip split), both of which are boundary conditions of the same decision.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { MockClassroomProvider } from '../../src/adapters/mock/mock-classroom-provider.js'
import { JobReconciler } from '../../src/services/job-reconciler.js'
import { PreflightEngine } from '../../src/services/preflight-engine.js'
import { TransferEngine, createTransferJob } from '../../src/services/transfer-engine.js'
import { countOutcomes } from '../../src/services/reconciliation.js'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { recordingProvider } from '../helpers/recording-provider.js'
import { FAST_ENGINE } from '../helpers/transfer.js'

const GRACE_MS = 30 * 60 * 1000
const STALE_MS = 60_000

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

async function pausedJob(): Promise<string> {
  const rec = recordingProvider(new MockClassroomProvider(db.prisma))
  const scan = await new PreflightEngine(db.prisma, rec.provider).run({
    accountId: 'acct-jamie',
    sourceCourseId: FIXTURE_KEYS.F1,
    targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
  })
  const { jobId } = await createTransferJob(db.prisma, {
    accountId: 'acct-jamie',
    scanId: scan.scanId,
    resolutions: [],
  })
  rec.failPostCreateAt = 3
  await new TransferEngine(db.prisma, rec.provider, FAST_ENGINE).run(jobId)
  return jobId
}

function reconciler(): JobReconciler {
  return new JobReconciler(db.prisma, new MockClassroomProvider(db.prisma), {
    staleAfterMs: STALE_MS,
    reauthGraceMs: GRACE_MS,
  })
}

describe('[budget] reauth_grace_period_boundary', () => {
  it('does NOT touch a job paused 5 minutes ago — well past the ordinary staleness window', async () => {
    const jobId = await pausedJob()
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000)
    await db.prisma.transferJob.update({
      where: { id: jobId },
      // Deliberately BOTH: the heartbeat is stale by the ordinary rule, so this
      // only passes if the pause genuinely exempts the job from that rule.
      data: { googleReauthRequiredAt: fiveMinutesAgo, lastHeartbeatAt: fiveMinutesAgo },
    })

    const result = await reconciler().reconcileStaleJobs()
    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    console.log(
      `[budget] reauth grace @5min: reconciled=${result.jobsReconciled} status=${job.status}`,
    )

    expect(result.jobsReconciled).toBe(0)
    expect(job.status).toBe('running')
    expect(job.googleReauthRequiredAt).toBeInstanceOf(Date)
  })

  it('DOES resolve a job paused past the ceiling, landing it at interrupted', async () => {
    const jobId = await pausedJob()
    const longAgo = new Date(Date.now() - GRACE_MS - 60_000)
    await db.prisma.transferJob.update({
      where: { id: jobId },
      data: { googleReauthRequiredAt: longAgo, lastHeartbeatAt: longAgo },
    })

    const result = await reconciler().reconcileStaleJobs()
    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    const items = await db.prisma.transferJobItem.findMany({ where: { jobId } })
    console.log(
      `[budget] reauth grace past ceiling: reconciled=${result.jobsReconciled} status=${job.status}`,
    )

    expect(result.jobsReconciled).toBe(1)
    // The EXISTING terminal status, not a new one: /active, the partial unique
    // index and the reconciler all derive from `status` alone.
    expect(job.status).toBe('interrupted')
    expect(job.activeAccountId).toBeNull()
    // Cleared with the terminal write — nothing left for a reconnect to resume.
    expect(job.googleReauthRequiredAt).toBeNull()
    expect(items.filter((i) => i.outcome === 'pending')).toHaveLength(0)
    expect(
      items.filter((i) => i.skipReason === 'server_interrupted').length,
    ).toBeGreaterThan(0)
  })

  it('still resolves an ORDINARY stale job on the short window — the exemption is scoped', async () => {
    const jobId = await pausedJob()
    // Same job, but no longer waiting on re-auth.
    await db.prisma.transferJob.update({
      where: { id: jobId },
      data: {
        googleReauthRequiredAt: null,
        lastHeartbeatAt: new Date(Date.now() - 5 * 60_000),
      },
    })

    const result = await reconciler().reconcileStaleJobs()
    expect(result.jobsReconciled).toBe(1)
  })
})

describe('[budget] F9 — the pre-start token-lifetime floor', () => {
  it('never claims the lease when the token has 2 minutes left', async () => {
    const rec = recordingProvider(new MockClassroomProvider(db.prisma))
    const scan = await new PreflightEngine(db.prisma, rec.provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const { jobId } = await createTransferJob(db.prisma, {
      accountId: 'acct-jamie',
      scanId: scan.scanId,
      resolutions: [],
    })

    // `GoogleAccount.id` is Google's `sub`; the transfer job's `accountId` is
    // polymorphic and names it directly in google mode.
    await db.prisma.googleAccount.create({
      data: {
        id: 'acct-jamie',
        email: 'jamie.rivera@pickettusd.example',
        displayName: 'Jamie Rivera',
        accessTokenCiphertext: 'x',
        accessTokenIv: 'x',
        accessTokenTag: 'x',
        accessTokenExpiresAt: new Date(Date.now() + 2 * 60_000),
        scopesGranted: 'openid email',
      },
    })

    rec.mark('run')
    await new TransferEngine(db.prisma, rec.provider, FAST_ENGINE).run(jobId)

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.googleReauthRequiredAt).toBeInstanceOf(Date)
    // Never started: still queued, no lease, and nothing written to the course.
    expect(job.status).toBe('queued')
    expect(job.executorId).toBeNull()
    expect(job.startedAt).toBeNull()
    expect(rec.since('run')).toHaveLength(0)
  })

  it('starts normally when the token has an hour left', async () => {
    const rec = recordingProvider(new MockClassroomProvider(db.prisma))
    const scan = await new PreflightEngine(db.prisma, rec.provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const { jobId } = await createTransferJob(db.prisma, {
      accountId: 'acct-jamie',
      scanId: scan.scanId,
      resolutions: [],
    })
    await db.prisma.googleAccount.create({
      data: {
        id: 'acct-jamie',
        email: 'jamie.rivera@pickettusd.example',
        displayName: 'Jamie Rivera',
        accessTokenCiphertext: 'x',
        accessTokenIv: 'x',
        accessTokenTag: 'x',
        accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
        scopesGranted: 'openid email',
      },
    })

    await new TransferEngine(db.prisma, rec.provider, FAST_ENGINE).run(jobId)
    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.status).toBe('completed')
    expect(job.googleReauthRequiredAt).toBeNull()
  })
})

describe('[budget] F6 — duplicate_title is its OWN bucket in countOutcomes', () => {
  it('never lands a duplicate in skippedBySystem, and keeps the sum by construction', async () => {
    const provider = new MockClassroomProvider(db.prisma)
    const scan = await new PreflightEngine(db.prisma, provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F15_SOURCE,
      targetCourseId: FIXTURE_KEYS.F15_TARGET,
    })
    const { jobId } = await createTransferJob(db.prisma, {
      accountId: 'acct-jamie',
      scanId: scan.scanId,
      resolutions: [],
    })
    await new TransferEngine(db.prisma, provider, FAST_ENGINE).run(jobId)

    const counts = await countOutcomes(db.prisma, jobId)
    console.log(
      `[budget] three-way skip split: byUser=${counts.skippedByUser} ` +
        `bySystem=${counts.skippedBySystem} duplicate=${counts.skippedDuplicate} ` +
        `total=${counts.skippedTotal}`,
    )
    expect(counts.skippedDuplicate).toBe(4)
    // The exact failure the UI's P0 Delta raised: the 5-term "interrupted" line
    // firing on an ordinary re-run.
    expect(counts.skippedBySystem).toBe(0)
    expect(counts.skippedTotal).toBe(
      counts.skippedByUser + counts.skippedBySystem + counts.skippedDuplicate,
    )
  })
})
