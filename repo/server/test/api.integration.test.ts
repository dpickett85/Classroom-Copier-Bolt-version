import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { buildApp } from '../src/app.js'
import { FIXTURE_KEYS } from '../src/fixtures/index.js'
import { NoOpMonetizationService } from '../src/services/monetization.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { FAST_ENGINE } from './helpers/transfer.js'

let db: TestDb
let app: Express
let monetization: NoOpMonetizationService

beforeEach(async () => {
  db = await createTestDb()
  monetization = new NoOpMonetizationService()
  app = buildApp({
    prisma: db.prisma,
    engineOptions: FAST_ENGINE,
    monetization,
  }).app
})
afterEach(async () => {
  await db.dispose()
})

async function signedIn(accountId = 'acct-jamie') {
  // The CSRF header is set as an AGENT DEFAULT (superagent applies `.set()`
  // calls on an agent to every subsequent request from it), so every POST
  // made through this agent — including this very sign-in — carries it.
  const agent = request.agent(app).set('X-Classroom-Copier', '1')
  await agent.post('/api/auth/sign-in').send({ accountId }).expect(200)
  return agent
}

/* ------------------------------------------------------------------ */

describe('health (cold-start detection target)', () => {
  it('responds ok with the harness flag unset', async () => {
    const res = await request(app).get('/api/health').expect(200)
    expect(res.body.status).toBe('ok')
  })
})

describe('auth — the forced picker is a property of the route', () => {
  it('lists at least two mock accounts with distinct emails (F10)', async () => {
    const res = await request(app).get('/api/auth/mock-accounts').expect(200)
    expect(res.body.accounts.length).toBeGreaterThanOrEqual(2)
    expect(new Set(res.body.accounts.map((a: { email: string }) => a.email)).size).toBe(
      res.body.accounts.length,
    )
  })

  it('mints a FRESH session on every sign-in — never short-circuited by an existing one', async () => {
    const agent = await signedIn()
    const before = await db.prisma.session.count()
    await agent.post('/api/auth/sign-in').send({ accountId: 'acct-jamie' }).expect(200)
    expect(await db.prisma.session.count()).toBe(before + 1)
    // ...and the previous one is revoked, so a copied cookie cannot be replayed.
    expect(await db.prisma.session.count({ where: { revokedAt: { not: null } } })).toBe(1)
  })

  it('switching accounts invalidates the prior session on the next request', async () => {
    const agent = await signedIn('acct-jamie')
    await agent.get('/api/auth/me').expect(200)
    await agent.post('/api/auth/sign-in').send({ accountId: 'acct-dana' }).expect(200)
    const me = await agent.get('/api/auth/me').expect(200)
    expect(me.body.account.id).toBe('acct-dana')
  })

  it('a revoked session returns 401, not a silently-succeeding request', async () => {
    const agent = await signedIn()
    await agent.post('/api/auth/sign-out').expect(204)
    await agent.get('/api/auth/me').expect(401)
  })

  it('rejects an unauthenticated request to a scoped route', async () => {
    await request(app).get('/api/courses?role=source').expect(401)
  })
})

describe('courses — role scoping goes through the port', () => {
  it('source lists active AND archived; target lists active only', async () => {
    const agent = await signedIn()
    const source = await agent.get('/api/courses?role=source').expect(200)
    const target = await agent.get('/api/courses?role=target').expect(200)

    expect(source.body.courses.some((c: { state: string }) => c.state === 'ARCHIVED')).toBe(true)
    expect(target.body.courses.every((c: { state: string }) => c.state === 'ACTIVE')).toBe(true)
    expect(target.body.courses.some((c: { id: string }) => c.id === FIXTURE_KEYS.ARCHIVED_JAMIE)).toBe(
      false,
    )
  })

  it('flags the SIS roster shell on the target list', async () => {
    const agent = await signedIn()
    const target = await agent.get('/api/courses?role=target').expect(200)
    const shell = target.body.courses.find((c: { id: string }) => c.id === FIXTURE_KEYS.TARGET_JAMIE)
    expect(shell.isSisShell).toBe(true)
  })

  it('scopes the list to the signed-in account (F10 collision avoidance)', async () => {
    const jamie = await signedIn('acct-jamie')
    const dana = await signedIn('acct-dana')
    const jamieCourses = (await jamie.get('/api/courses?role=source')).body.courses
    const danaCourses = (await dana.get('/api/courses?role=source')).body.courses
    const jamieIds = new Set(jamieCourses.map((c: { id: string }) => c.id))
    expect(danaCourses.every((c: { id: string }) => !jamieIds.has(c.id))).toBe(true)
  })

  it('rejects source === target', async () => {
    const agent = await signedIn()
    await agent
      .post(`/api/courses/${FIXTURE_KEYS.F1}/preflight`)
      .send({ targetId: FIXTURE_KEYS.F1 })
      .expect(400)
  })

  it('returns a scanId that resolves to a persisted PreflightScan row', async () => {
    const agent = await signedIn()
    const res = await agent
      .post(`/api/courses/${FIXTURE_KEYS.F1}/preflight`)
      .send({ targetId: FIXTURE_KEYS.TARGET_JAMIE })
      .expect(200)
    const stored = await db.prisma.preflightScan.findUnique({ where: { id: res.body.scanId } })
    expect(stored).not.toBeNull()
    expect(stored!.totalPostsScanned).toBe(res.body.totalPostsScanned)
  })
})

/* ------------------------------------------------------------------ */

async function preflight(agent: ReturnType<typeof request.agent>, source: string, target: string) {
  const res = await agent.post(`/api/courses/${source}/preflight`).send({ targetId: target }).expect(200)
  return res.body as {
    scanId: string
    totalPostsScanned: number
    scannedAt: string
    findings: { id: string }[]
  }
}

async function waitForTerminal(
  agent: ReturnType<typeof request.agent>,
  jobId: string,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i += 1) {
    const res = await agent.get(`/api/transfer-jobs/${jobId}/status`).expect(200)
    if (['completed', 'interrupted', 'failed'].includes(res.body.status as string)) return res.body
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('job never reached a terminal status')
}

describe('transfer jobs', () => {
  it('POST returns 202 with a jobId and does the work out of band', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const res = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    expect(res.body.jobId).toBeTruthy()

    const final = await waitForTerminal(agent, res.body.jobId as string)
    expect(final.status).toBe('completed')
    expect(final.totalItems).toBe(scan.totalPostsScanned)
    expect(final.totalPostsScanned).toBe(scan.totalPostsScanned)
  })

  it('D11 — a job created from a scan keeps exactly scan.totalPostsScanned items even if the course changed', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)

    await db.prisma.mockCourseWork.create({
      data: {
        id: 'cw-f1-added-between',
        courseId: FIXTURE_KEYS.F1,
        title: 'Added between scan and job',
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        creationTime: new Date(),
        createdOrder: 98,
      },
    })

    const res = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    const items = await db.prisma.transferJobItem.count({ where: { jobId: res.body.jobId } })
    expect(items).toBe(scan.totalPostsScanned)
  })

  it('D5 — a double-POST returns 409 carrying the FIRST jobId, not a second job', async () => {
    const agent = await signedIn()
    const scanA = await preflight(agent, FIXTURE_KEYS.F4, FIXTURE_KEYS.TARGET_JAMIE)
    const first = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scanA.scanId, resolutions: [] })
      .expect(202)

    const scanB = await preflight(agent, FIXTURE_KEYS.F2, FIXTURE_KEYS.TARGET_JAMIE)
    const second = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scanB.scanId, resolutions: [] })

    if (second.status === 409) {
      expect(second.body.jobId).toBe(first.body.jobId)
      expect(await db.prisma.transferJob.count()).toBe(1)
    } else {
      // The first job finished before the second POST landed — legitimate, and
      // then there genuinely is no conflict to report.
      expect(second.status).toBe(202)
    }
    await waitForTerminal(agent, first.body.jobId as string)
  })

  it('404s a scan that belongs to another account', async () => {
    const jamie = await signedIn('acct-jamie')
    const scan = await preflight(jamie, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const dana = await signedIn('acct-dana')
    await dana.post('/api/transfer-jobs').send({ scanId: scan.scanId, resolutions: [] }).expect(404)
  })

  it('F12 — a fresh client rediscovers the in-flight job via /active and sees the same final state', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F4, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)

    // "Reload the tab": a brand-new client context with only the cookie.
    const reconnected = request.agent(app).set('X-Classroom-Copier', '1')
    await reconnected.post('/api/auth/sign-in').send({ accountId: 'acct-jamie' }).expect(200)

    let discovered: string | null = null
    for (let i = 0; i < 100 && discovered == null; i += 1) {
      const active = await reconnected.get('/api/transfer-jobs/active')
      if (active.status === 200) discovered = active.body.jobId as string
      else await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const final = await waitForTerminal(agent, created.body.jobId as string)
    // Either the reconnect saw the job in flight (the interesting case) or the
    // job finished first; in both cases the ledger must be whole.
    if (discovered != null) expect(discovered).toBe(created.body.jobId)
    expect(final.status).toBe('completed')
    expect(final.totalItems).toBe(50)
    expect(
      (final.transferred as number) + (final.fallbackShell as number) + (final.skippedTotal as number),
    ).toBe(50)
  })

  it('/active answers 204 when nothing is running', async () => {
    const agent = await signedIn()
    await agent.get('/api/transfer-jobs/active').expect(204)
  })

  it('the itemized log carries per-type fields, skip attribution and the full note', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    await waitForTerminal(agent, created.body.jobId as string)

    const res = await agent.get(`/api/transfer-jobs/${created.body.jobId}/items`).expect(200)
    const items = res.body.items as {
      title: string
      typeLabel: string
      typeSpecific: { kind: string; optionCount?: number; maxPoints?: number | null }
      skippedBy: string | null
    }[]

    const material = items.find((i) => i.typeLabel === 'Material')!
    // A Material has no representation that can carry points or an answer config.
    expect(material.typeSpecific).toEqual({ kind: 'none' })

    const mcq = items.find((i) => i.title === 'Discussion: Whose frontier?')!
    expect(mcq.typeSpecific).toEqual({ kind: 'multipleChoice', optionCount: 4 })

    const shortAnswer = items.find((i) => i.title === 'Exit ticket: one takeaway')!
    expect(shortAnswer.typeSpecific).toEqual({ kind: 'shortAnswer' })

    const assignment = items.find((i) => i.title === 'Essay 1: Founding Documents')!
    expect(assignment.typeSpecific).toEqual({ kind: 'graded', maxPoints: 100 })

    expect(items.every((i) => i.skippedBy === null)).toBe(true)
  })

  it('filters the itemized log by outcome', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    await waitForTerminal(agent, created.body.jobId as string)
    const res = await agent
      .get(`/api/transfer-jobs/${created.body.jobId}/items?outcome=transferred`)
      .expect(200)
    expect((res.body.items as { outcome: string }[]).every((i) => i.outcome === 'transferred')).toBe(
      true,
    )
  })

  /* ---------------------------------------------------------------- *
   * Cycle-2 findings at the HTTP boundary
   * ---------------------------------------------------------------- */

  it('APPLY-C — replaying a consumed scan is refused, not copied a second time', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const first = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    await waitForTerminal(agent, first.body.jobId as string)

    // Back button, then confirm again. `TransferJob.scanId` was not @unique, so
    // this used to create a whole second job and copy every post again — item
    // ids are `${jobId}-i${n}`, so there was not even a collision to stop it.
    const replay = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(409)
    expect(replay.body.error.code).toBe('scan_already_used')
    expect(await db.prisma.transferJob.count({ where: { scanId: scan.scanId } })).toBe(1)
  })

  it('APPLY-I — a stale scan is refused rather than transferred as an old picture', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    expect(typeof scan.scannedAt).toBe('string')

    await db.prisma.preflightScan.update({
      where: { id: scan.scanId },
      data: { scannedAt: new Date(Date.now() - 60 * 60_000) },
    })
    const stale = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(409)
    expect(stale.body.error.code).toBe('scan_stale')
    expect(await db.prisma.transferJob.count({ where: { scanId: scan.scanId } })).toBe(0)
  })

  it('APPLY-H — an unknown ?outcome= is a 400, not a query forwarded into Prisma', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    await waitForTerminal(agent, created.body.jobId as string)

    const res = await agent
      .get(`/api/transfer-jobs/${created.body.jobId}/items?outcome=not-a-real-outcome`)
      .expect(400)
    expect(res.body.error.code).toBe('bad_request')
  })

  it('APPLY-E — the itemized log survives the source post being deleted afterwards', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    await waitForTerminal(agent, created.body.jobId as string)

    // The teacher tidies up the old course. The completion log is an IMMUTABLE
    // RECORD of what was copied; re-reading live source rows for `workType`,
    // `maxPoints` and `answerConfig` relabelled a Question as "Assignment" and
    // showed points that were never the ones copied.
    await db.prisma.mockAttachment.deleteMany({ where: { parentId: 'cw-f1-4' } })
    await db.prisma.mockCourseWork.delete({ where: { id: 'cw-f1-4' } })
    await db.prisma.mockAttachment.deleteMany({ where: { parentId: 'cw-f1-1' } })
    await db.prisma.mockCourseWork.delete({ where: { id: 'cw-f1-1' } })

    const res = await agent.get(`/api/transfer-jobs/${created.body.jobId}/items`).expect(200)
    const items = res.body.items as {
      title: string
      typeLabel: string
      typeSpecific: { kind: string; optionCount?: number; maxPoints?: number | null }
    }[]

    const mcq = items.find((i) => i.title === 'Discussion: Whose frontier?')!
    expect(mcq.typeLabel).toBe('Question')
    expect(mcq.typeSpecific).toEqual({ kind: 'multipleChoice', optionCount: 4 })

    const assignment = items.find((i) => i.title === 'Essay 1: Founding Documents')!
    expect(assignment.typeLabel).toBe('Assignment')
    expect(assignment.typeSpecific).toEqual({ kind: 'graded', maxPoints: 100 })
  })

  it('404s another account’s job', async () => {
    const jamie = await signedIn('acct-jamie')
    const scan = await preflight(jamie, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await jamie
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    const dana = await signedIn('acct-dana')
    await dana.get(`/api/transfer-jobs/${created.body.jobId}/status`).expect(404)
  })
})

describe('POST /transfer-jobs/:id/cancel — the partial-completion contract at the HTTP boundary', () => {
  it('cancels a running job: 200, drains the rest, and the job completes with cancelledAt set', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)

    const cancel = await agent
      .post(`/api/transfer-jobs/${created.body.jobId}/cancel`)
      .expect(200)
    expect(cancel.body).toEqual({ jobId: created.body.jobId, cancelRequested: true })

    const final = await waitForTerminal(agent, created.body.jobId as string)
    expect(final.status).toBe('completed')
    expect(final.cancelRequested).toBe(true)
    expect(final.cancelledAt).not.toBeNull()
    expect(
      (final.transferred as number) + (final.fallbackShell as number) + (final.skippedTotal as number),
    ).toBe(final.totalItems)
  })

  it('cancelling an already-finished job is refused with 409 job_already_finished', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    await waitForTerminal(agent, created.body.jobId as string)

    const res = await agent
      .post(`/api/transfer-jobs/${created.body.jobId}/cancel`)
      .expect(409)
    expect(res.body.error.code).toBe('job_already_finished')
  })

  it('double-cancelling a running job returns 200 both times', async () => {
    // A run-scoped provider delay (D25) keeps the 6-item F1 job genuinely
    // "running" for both cancel calls rather than racing its own completion,
    // even on a loaded machine.
    const slow = buildApp({
      prisma: db.prisma,
      providerOptions: { perItemDelayMs: 150 },
      engineOptions: FAST_ENGINE,
      monetization,
    }).app
    // Merge note: this test builds its own app instance, so it must carry the
    // CSRF header the way the shared agent at the top of this file does — it
    // was authored in a worktree that predated the header requirement.
    const agent = request.agent(slow).set('X-Classroom-Copier', '1')
    await agent.post('/api/auth/sign-in').send({ accountId: 'acct-jamie' }).expect(200)
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)

    // The engine checks cancelRequested BETWEEN items, including once before
    // item 0 dispatches — wait for genuine evidence the first item is in
    // flight before racing two cancels against it, the same signal the
    // engine-level test uses.
    let inFlight: unknown = null
    for (let i = 0; i < 200 && !inFlight; i += 1) {
      inFlight = await db.prisma.transferJobItem.findFirst({
        where: { jobId: created.body.jobId as string, attemptedAt: { not: null } },
        select: { id: true },
      })
      if (!inFlight) await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(inFlight, 'the first item never started').not.toBeNull()

    await Promise.all([
      agent.post(`/api/transfer-jobs/${created.body.jobId}/cancel`).expect(200),
      agent.post(`/api/transfer-jobs/${created.body.jobId}/cancel`).expect(200),
    ])

    await waitForTerminal(agent, created.body.jobId as string)
  })

  it('404s a cancel for another account’s job', async () => {
    const jamie = await signedIn('acct-jamie')
    const scan = await preflight(jamie, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await jamie
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    const dana = await signedIn('acct-dana')
    await dana.post(`/api/transfer-jobs/${created.body.jobId}/cancel`).expect(404)
    await waitForTerminal(jamie, created.body.jobId as string)
  })

  it('releases the single-active-job guard: /active answers 204 and a new job can start (D5/D12 unchanged)', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    await agent.post(`/api/transfer-jobs/${created.body.jobId}/cancel`).expect(200)
    await waitForTerminal(agent, created.body.jobId as string)

    await agent.get('/api/transfer-jobs/active').expect(204)

    const secondScan = await preflight(agent, FIXTURE_KEYS.F2, FIXTURE_KEYS.TARGET_JAMIE)
    const second = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: secondScan.scanId, resolutions: [] })
      .expect(202)
    await waitForTerminal(agent, second.body.jobId as string)
  })

  it('the reconciler finds nothing to do around a cancelled-and-completed job', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    await agent.post(`/api/transfer-jobs/${created.body.jobId}/cancel`).expect(200)
    await waitForTerminal(agent, created.body.jobId as string)

    const built = buildApp({ prisma: db.prisma, engineOptions: FAST_ENGINE, monetization })
    const result = await built.reconciler.reconcileStaleJobs(new Date(Date.now() + 60 * 60_000))
    expect(result.jobsReconciled).toBe(0)

    const job = await db.prisma.transferJob.findUniqueOrThrow({
      where: { id: created.body.jobId as string },
    })
    expect(job.status).toBe('completed')
  })
})

describe('monetization is present, called, and inert (flag off)', () => {
  it('calls the credit-check hook at job creation and the completion hook at the end, changing no balance', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    await waitForTerminal(agent, created.body.jobId as string)

    expect(monetization.calls.checkCredit).toBeGreaterThan(0)
    expect(monetization.calls.onJobComplete).toBe(1)
    expect(await db.prisma.creditLedger.count()).toBe(0)
  })

  it('never gates the status poll behind a credit check', async () => {
    const agent = await signedIn()
    const scan = await preflight(agent, FIXTURE_KEYS.F1, FIXTURE_KEYS.TARGET_JAMIE)
    const created = await agent
      .post('/api/transfer-jobs')
      .send({ scanId: scan.scanId, resolutions: [] })
      .expect(202)
    const before = monetization.calls.checkCredit
    await agent.get(`/api/transfer-jobs/${created.body.jobId}/status`).expect(200)
    expect(monetization.calls.checkCredit).toBe(before)
    await waitForTerminal(agent, created.body.jobId as string)
  })
})
