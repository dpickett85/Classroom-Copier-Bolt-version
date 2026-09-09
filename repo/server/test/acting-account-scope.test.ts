/**
 * E1 — every path into a `ClassroomProvider` names the acting account first.
 *
 * `RealClassroomProvider` is bound to ONE account because every real call
 * carries that account's bearer token, while the port itself is account-less
 * (`listTopics(courseId)`, `countPosts(courseId)`, `getRubric(id)`). The seam
 * that reconciles the two is `runForAccount()` — and a seam nothing calls is a
 * seam that does not work.
 *
 * These cases do not care what the provider RETURNS. They record whether each
 * call arrived inside a scope, because a provider call made outside one is
 * exactly the bug: in google mode it throws, and no fixture-world test would
 * ever notice, since the mock ignores the account entirely.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { buildApp } from '../src/app.js'
import type { ClassroomProvider } from '../src/adapters/classroom-provider.interface.js'
import { MockClassroomProvider } from '../src/adapters/mock/mock-classroom-provider.js'
import { GoogleClassroomProvider } from '../src/adapters/google/google-classroom-provider.js'
import { AuthExpiredError } from '../src/adapters/types.js'
import { FIXTURE_KEYS } from '../src/fixtures/index.js'
import { JobReconciler } from '../src/services/job-reconciler.js'
import { NoOpMonetizationService } from '../src/services/monetization.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { FAST_ENGINE, scanAndCreateJob } from './helpers/transfer.js'

interface ScopeSpy {
  provider: ClassroomProvider
  /** One entry per `runForAccount`, in order. */
  scopes: string[]
  /** Method names that were called with NO account in scope. Must stay empty. */
  unscoped: string[]
}

/**
 * Wraps a real mock provider so behaviour is unchanged and only the scoping is
 * observed. `runForAccount` is implemented here rather than on the mock itself
 * because the mock is account-agnostic and deliberately does not implement it —
 * which is the very thing that makes the production gap invisible.
 */
function scopeSpy(inner: ClassroomProvider): ScopeSpy {
  const scopes: string[] = []
  const unscoped: string[] = []
  let depth = 0

  const provider = new Proxy(inner, {
    get(target, prop) {
      if (prop === 'runForAccount') {
        return async <T>(accountId: string, fn: () => Promise<T>): Promise<T> => {
          scopes.push(accountId)
          depth += 1
          try {
            return await fn()
          } finally {
            depth -= 1
          }
        }
      }
      const value = Reflect.get(target, prop, target) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        if (depth === 0) unscoped.push(String(prop))
        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  }) as ClassroomProvider

  return { provider, scopes, unscoped }
}

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

async function signedIn(app: Express, accountId: string) {
  const agent = request.agent(app).set('X-Classroom-Copier', '1')
  await agent.post('/api/auth/sign-in').send({ accountId }).expect(200)
  return agent
}

describe('acting-account scope (E1)', () => {
  it('GET /courses names the session account before touching the provider', async () => {
    const spy = scopeSpy(new MockClassroomProvider(db.prisma))
    const { app } = buildApp({
      prisma: db.prisma,
      provider: spy.provider,
      engineOptions: FAST_ENGINE,
      monetization: new NoOpMonetizationService(),
    })
    const agent = await signedIn(app, 'acct-jamie')
    await agent.get('/api/courses').expect(200)

    expect(spy.scopes).toEqual(['acct-jamie'])
    // `countPosts(courseId)` carries no account of its own; outside a scope a
    // real adapter has no token to spend on it.
    expect(spy.unscoped, 'a provider call escaped the acting-account scope').toEqual([])
  })

  it('POST /courses/:id/preflight scopes the whole pre-flight scan', async () => {
    const spy = scopeSpy(new MockClassroomProvider(db.prisma))
    const { app } = buildApp({
      prisma: db.prisma,
      provider: spy.provider,
      engineOptions: FAST_ENGINE,
      monetization: new NoOpMonetizationService(),
    })
    const agent = await signedIn(app, 'acct-jamie')
    await agent
      .post(`/api/courses/${FIXTURE_KEYS.F1}/preflight`)
      .send({ targetId: FIXTURE_KEYS.TARGET_JAMIE })
      .expect(200)

    expect(spy.scopes.at(-1)).toBe('acct-jamie')
    expect(spy.unscoped, 'a pre-flight provider call escaped the scope').toEqual([])
  })

  it('the transfer executor scopes to the JOB OWNER, not to whoever asked', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-dana',
      sourceCourseId: FIXTURE_KEYS.F6,
      targetCourseId: FIXTURE_KEYS.TARGET_DANA,
    })
    const spy = scopeSpy(new MockClassroomProvider(db.prisma))
    const { TransferEngine } = await import('../src/services/transfer-engine.js')
    const engine = new TransferEngine(db.prisma, spy.provider, FAST_ENGINE)
    await engine.run(run.jobId)

    expect(spy.scopes).toEqual(['acct-dana'])
    expect(spy.unscoped, 'the executor called the provider outside the scope').toEqual([])
  })

  it('the reconciler scopes its target verification to the job owner', async () => {
    const run = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    await db.prisma.transferJob.update({
      where: { id: run.jobId },
      data: {
        status: 'running',
        startedAt: new Date(Date.now() - 20 * 60_000),
        lastHeartbeatAt: new Date(Date.now() - 20 * 60_000),
      },
    })

    const spy = scopeSpy(new MockClassroomProvider(db.prisma))
    const reconciler = new JobReconciler(db.prisma, spy.provider, {
      staleAfterMs: 60_000,
      reauthGraceMs: 30 * 60_000,
    })
    const result = await reconciler.reconcileStaleJobs()

    expect(result.jobsReconciled).toBe(1)
    expect(spy.scopes).toEqual(['acct-jamie'])
    expect(spy.unscoped, 'the reconciler read the target outside the scope').toEqual([])
  })
})

describe('GoogleClassroomProvider — the binding itself', () => {
  it('refuses a call made with no acting account in scope', async () => {
    const provider = new GoogleClassroomProvider(db.prisma)
    // Not a runtime condition — a wiring bug. It must be loud, and it must not
    // pick an account.
    await expect(provider.listTopics('course-1')).rejects.toThrow(/no acting account in scope/)
  })

  it('defers the token read to FIRST USE, so an expired token surfaces from a CALL', async () => {
    const provider = new GoogleClassroomProvider(db.prisma)
    let entered = false

    // There is no GoogleAccount row for this id, so loading a token raises
    // AuthExpiredError. Entering the scope must NOT: the transfer executor
    // enters it OUTSIDE the try that turns AuthExpiredError into a re-auth
    // pause (F7), so an eager bind would mark the job `failed` with no way back
    // for exactly the routine case pause-and-resume exists to handle.
    await expect(
      provider.runForAccount('goog-nobody', async () => {
        entered = true
        await provider.listTopics('course-1')
      }),
    ).rejects.toBeInstanceOf(AuthExpiredError)
    expect(entered, 'scope entry itself threw — the bind is not lazy').toBe(true)
  })
})
