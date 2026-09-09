/**
 * Quality budget: `fixture_f12_reconnect_fidelity` (owner: transfer-job-api).
 * Target: 0 duplicated or missing items after a disconnect/reconnect mid-batch.
 *
 * F12's slow mode is a RUN-SCOPED PROVIDER OPTION here (D25), not seeded course
 * data — seeded as data it would slow F4's own throughput budget and that
 * budget would then be measuring its own harness.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { buildApp } from '../../src/app.js'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { FAST_ENGINE } from '../helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

describe('[budget] fixture_f12_reconnect_fidelity', () => {
  it('a reconnected client rediscovers the job and the final ledger is whole', async () => {
    const { app } = buildApp({
      prisma: db.prisma,
      // The run-scoped slow mode — the whole point of F12.
      providerOptions: { perItemDelayMs: 3 },
      engineOptions: FAST_ENGINE,
    })

    const first = request.agent(app).set('X-Classroom-Copier', '1')
    await first.post('/api/auth/sign-in').send({ accountId: 'acct-jamie' }).expect(200)
    const scan = await first
      .post(`/api/courses/${FIXTURE_KEYS.F4}/preflight`)
      .send({ targetId: FIXTURE_KEYS.TARGET_JAMIE })
      .expect(200)
    const created = await first
      .post('/api/transfer-jobs')
      .send({ scanId: scan.body.scanId, resolutions: [] })
      .expect(202)

    // Stop polling entirely (the tab is gone), then reconnect from scratch.
    const reconnected = request.agent(app).set('X-Classroom-Copier', '1')
    await reconnected.post('/api/auth/sign-in').send({ accountId: 'acct-jamie' }).expect(200)

    let discovered: string | null = null
    let sawInFlight = false
    for (let i = 0; i < 300; i += 1) {
      const active = await reconnected.get('/api/transfer-jobs/active')
      if (active.status === 200) {
        discovered = active.body.jobId as string
        sawInFlight = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    let final: Record<string, unknown> | null = null
    for (let i = 0; i < 400; i += 1) {
      const status = await reconnected
        .get(`/api/transfer-jobs/${created.body.jobId}/status`)
        .expect(200)
      if (['completed', 'interrupted', 'failed'].includes(status.body.status as string)) {
        final = status.body as Record<string, unknown>
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    expect(final, 'job never reached a terminal status').not.toBeNull()
    if (sawInFlight) expect(discovered).toBe(created.body.jobId)

    const items = await db.prisma.transferJobItem.findMany({
      where: { jobId: created.body.jobId as string },
    })
    // 0 missing: exactly the scanned count. 0 duplicated: one row per scan item.
    expect(items).toHaveLength(scan.body.totalPostsScanned as number)
    expect(new Set(items.map((i) => i.scanItemId)).size).toBe(items.length)

    const transferred = items.filter((i) => i.outcome === 'transferred')
    const created_ids = transferred.map((i) => i.targetPostId)
    expect(new Set(created_ids).size).toBe(created_ids.length)

    console.log(
      `[budget] f12: items=${items.length} duplicated=0 missing=0 sawInFlight=${String(sawInFlight)} status=${String(final?.status)}`,
    )
    expect(final?.status).toBe('completed')
  })
})
