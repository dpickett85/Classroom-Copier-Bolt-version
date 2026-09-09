/**
 * The composition-root acceptance gates.
 *
 * QA-1 — `04-architecture.md`'s `composition-root` module requires "a second
 * test asserts the interval reconciler resolves a job wedged in 'running'
 * WITHOUT a process restart". Every existing test called `reconcileStaleJobs()`
 * directly and synchronously, which proves the reconciliation LOGIC and says
 * nothing about the interval SCHEDULING that is half of D12's claim — and the
 * scheduling is wired at the composition root, not inside the reconciler's own
 * unit tests. So this drives the wiring `buildApp` actually produces.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { config } from '../src/config.js'
import { MockClassroomProvider } from '../src/adapters/mock/mock-classroom-provider.js'
import { GoogleClassroomProvider } from '../src/adapters/google/google-classroom-provider.js'
import { FIXTURE_KEYS } from '../src/fixtures/index.js'
import { countOutcomes } from '../src/services/reconciliation.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { scanAndCreateJob } from './helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

/** `config` is resolved once at import, so mode is swapped in place — the same
 *  technique `google-oauth.integration.test.ts` already uses for the key. */
function withMode<T>(mode: 'mock' | 'google', fn: () => T): T {
  const original = config.googleProviderMode
  Object.defineProperty(config, 'googleProviderMode', { value: mode, configurable: true })
  try {
    return fn()
  } finally {
    Object.defineProperty(config, 'googleProviderMode', { value: original, configurable: true })
  }
}

/** Drops the `isTest` exemption so the guard is observed as a production boot
 *  sees it. */
function withProductionLikeTestFlag<T>(fn: () => T): T {
  const original = config.isTest
  Object.defineProperty(config, 'isTest', { value: false, configurable: true })
  try {
    return fn()
  } finally {
    Object.defineProperty(config, 'isTest', { value: original, configurable: true })
  }
}

/** Observes the boot as a Render deploy sees it: production-like, not a test. */
function withProductionLike<T>(fn: () => T): T {
  const originalProd = config.isProductionLike
  const originalTest = config.isTest
  Object.defineProperty(config, 'isProductionLike', { value: true, configurable: true })
  Object.defineProperty(config, 'isTest', { value: false, configurable: true })
  try {
    return fn()
  } finally {
    Object.defineProperty(config, 'isProductionLike', { value: originalProd, configurable: true })
    Object.defineProperty(config, 'isTest', { value: originalTest, configurable: true })
  }
}

async function wedgedJob(): Promise<string> {
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
      // Older than the default `jobStaleAfterMs` (60s) the composition root
      // hands the reconciler.
      lastHeartbeatAt: new Date(Date.now() - 20 * 60_000),
    },
  })
  return run.jobId
}

describe('composition-root — the interval reconciler', () => {
  it('resolves a job wedged in "running" WITHOUT a process restart (D12)', async () => {
    const jobId = await wedgedJob()
    const { reconciler } = buildApp({ prisma: db.prisma })

    // Nothing has run yet: this is the state the user was stuck in, watching a
    // counter that would never move, with no cancel control to escape it.
    expect(
      (await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })).status,
    ).toBe('running')

    const stop = reconciler.start(20)
    try {
      const deadline = Date.now() + 3000
      let status = 'running'
      while (Date.now() < deadline && status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 20))
        status = (await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })).status
      }
      expect(status).toBe('interrupted')
    } finally {
      stop()
    }

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.activeAccountId, 'the single-active-job guard was not released').toBeNull()
    expect(job.executorId).toBeNull()
    expect((await countOutcomes(db.prisma, jobId)).pending).toBe(0)
  })

  it('stops firing once the returned disposer is called', async () => {
    const { reconciler } = buildApp({ prisma: db.prisma })
    const stop = reconciler.start(10)
    stop()

    const jobId = await wedgedJob()
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(
      (await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })).status,
      'the interval kept running after shutdown',
    ).toBe('running')
  })
})

/**
 * E1 — provider selection per `GOOGLE_PROVIDER_MODE`.
 *
 * This seam had 587 passing tests over it and none touched it, because every
 * other test injects `deps.provider` explicitly. That gap is what let the whole
 * phase ship inert: a teacher could complete real Google OAuth and still have
 * every course read, coursework read and post creation served by the mock
 * fixture world. These cases assert the IDENTITY of the adapter the composition
 * root picks, which is the only fact the injection seam hides.
 */
describe('composition-root — ClassroomProvider selection (E1)', () => {
  it('selects MockClassroomProvider in mock mode', () => {
    const { provider } = withMode('mock', () => buildApp({ prisma: db.prisma }))
    expect(provider).toBeInstanceOf(MockClassroomProvider)
  })

  it('selects the Google-backed adapter in google mode — NOT the mock', () => {
    const { provider } = withMode('google', () => buildApp({ prisma: db.prisma }))
    expect(provider).toBeInstanceOf(GoogleClassroomProvider)
    expect(provider).not.toBeInstanceOf(MockClassroomProvider)
  })

  it('refuses to boot when google mode resolves to anything but a Google adapter', () => {
    // The test seam is exempt only under NODE_ENV=test; a production boot is
    // guarded even against an explicit injection.
    expect(() =>
      withMode('google', () =>
        withProductionLikeTestFlag(() =>
          buildApp({ prisma: db.prisma, provider: new MockClassroomProvider(db.prisma) }),
        ),
      ),
    ).toThrow(/GOOGLE_PROVIDER_MODE=google/)
  })

  /**
   * QA-1 — the OTHER direction, and the one a real deploy actually hits.
   *
   * The guard above fires only when the mode is explicitly `google`. It was
   * silent on `NODE_ENV=production` + mode `mock`/unset, so a Render deploy
   * that merely omitted the variable booted into the fixture world. `config.ts`
   * now refuses to RESOLVE that combination at all; this is the composition
   * root's defence-in-depth copy, kept because `deps` and test seams can hand
   * `buildApp` a config state that import-time resolution never saw.
   *
   * The two directions live in one describe block on purpose: neither can be
   * deleted or weakened without the sibling case sitting immediately above or
   * below it in the same file going unexplained.
   */
  it('refuses to boot in a production-like environment when the mode is mock (QA-1)', () => {
    expect(() =>
      withMode('mock', () =>
        withProductionLike(() => buildApp({ prisma: db.prisma })),
      ),
    ).toThrow(/GOOGLE_PROVIDER_MODE/)
  })

  it('the production-like guard names google as the value to set, not just the variable', () => {
    let message = ''
    try {
      withMode('mock', () => withProductionLike(() => buildApp({ prisma: db.prisma })))
    } catch (caught) {
      message = caught instanceof Error ? caught.message : String(caught)
    }
    expect(message, 'the production-like mock boot did not throw').not.toBe('')
    expect(message).toContain('GOOGLE_PROVIDER_MODE=google')
  })

  it('boots normally in mock mode when the environment is NOT production-like', () => {
    // The guard is on the environment, never on mock mode itself — a
    // developer's laptop and the whole test suite run in mock mode.
    const { provider } = withMode('mock', () => buildApp({ prisma: db.prisma }))
    expect(provider).toBeInstanceOf(MockClassroomProvider)
  })
})
