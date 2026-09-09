/**
 * CSRF hardening (`middleware/csrf.ts`).
 *
 * `POST /api/auth/sign-out` takes no body, which makes it a CORS "simple
 * request" — a plain cross-site `<form method="post">` reaches it without
 * ever triggering a preflight, so the pinned CORS origin allowlist never gets
 * a vote. Requiring a custom header on every state-changing method forces
 * preflight on all of them, sign-out included.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { buildApp } from '../src/app.js'
import { FIXTURE_KEYS } from '../src/fixtures/index.js'
import { NoOpMonetizationService } from '../src/services/monetization.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { FAST_ENGINE } from './helpers/transfer.js'

const CSRF_HEADER = 'X-Classroom-Copier'

let db: TestDb
let app: Express

beforeEach(async () => {
  db = await createTestDb()
  app = buildApp({
    prisma: db.prisma,
    engineOptions: FAST_ENGINE,
    monetization: new NoOpMonetizationService(),
  }).app
})
afterEach(async () => {
  await db.dispose()
})

/** A signed-in agent whose default header carries the CSRF token, so tests
 *  can opt OUT for a single request with `.unset(CSRF_HEADER)` rather than
 *  having to opt in everywhere. */
async function signedIn(accountId = 'acct-jamie') {
  const agent = request.agent(app)
  await agent
    .post('/api/auth/sign-in')
    .set(CSRF_HEADER, '1')
    .send({ accountId })
    .expect(200)
  return agent
}

describe('CSRF header requirement on state-changing methods', () => {
  it('POST /api/auth/sign-out WITHOUT the header is rejected 403 csrf_header_missing', async () => {
    const agent = await signedIn()
    const res = await agent.post('/api/auth/sign-out').unset(CSRF_HEADER).expect(403)
    expect(res.body.error.code).toBe('csrf_header_missing')
  })

  it('POST /api/auth/sign-out WITH the header succeeds', async () => {
    const agent = await signedIn()
    await agent.post('/api/auth/sign-out').set(CSRF_HEADER, '1').expect(204)
  })

  it('POST /api/transfer-jobs WITHOUT the header is rejected 403 csrf_header_missing', async () => {
    const agent = await signedIn()
    const scan = await agent
      .post(`/api/courses/${FIXTURE_KEYS.F1}/preflight`)
      .set(CSRF_HEADER, '1')
      .send({ targetId: FIXTURE_KEYS.TARGET_JAMIE })
      .expect(200)

    const res = await agent
      .post('/api/transfer-jobs')
      .unset(CSRF_HEADER)
      .send({ scanId: scan.body.scanId, resolutions: [] })
      .expect(403)
    expect(res.body.error.code).toBe('csrf_header_missing')
  })

  it('POST /api/transfer-jobs WITH the header is accepted (202, not 403)', async () => {
    const agent = await signedIn()
    const scan = await agent
      .post(`/api/courses/${FIXTURE_KEYS.F1}/preflight`)
      .set(CSRF_HEADER, '1')
      .send({ targetId: FIXTURE_KEYS.TARGET_JAMIE })
      .expect(200)

    await agent
      .post('/api/transfer-jobs')
      .set(CSRF_HEADER, '1')
      .send({ scanId: scan.body.scanId, resolutions: [] })
      .expect(202)
  })

  it('GET requests are unprotected — no header needed', async () => {
    await request(app).get('/api/health').expect(200)
    await request(app).get('/api/auth/mock-accounts').expect(200)
  })

  it('the header check happens even for an unauthenticated caller (403, not 401)', async () => {
    const res = await request(app).post('/api/transfer-jobs').send({}).expect(403)
    expect(res.body.error.code).toBe('csrf_header_missing')
  })
})
