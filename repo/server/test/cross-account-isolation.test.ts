/**
 * §8.0/S5 — the cross-account isolation this schema no longer enforces.
 *
 * `Session.accountId` lost its foreign key to `MockAccount` so that it could
 * name either a MockAccount or a GoogleAccount (§5.1). That removed the
 * database's own safety net: from here on, "account B cannot read account A's
 * work" is an APPLICATION-level property held up by an `accountId` clause in
 * every scoped query, and nothing but this file notices when one goes missing.
 *
 * So it drives every account-scoped read with B's session against A's resource
 * ids and demands 404/403 — never 200, and never a body carrying A's data.
 * Do not weaken it into "does not equal A's payload"; the assertion that matters
 * is the status code, because a 200 with an empty body is still a leak of
 * existence.
 */
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { buildApp } from '../src/app.js'
import { ACCOUNT_DANA, ACCOUNT_JAMIE, FIXTURE_KEYS } from '../src/fixtures/index.js'
import { GoogleAccountDirectory } from '../src/services/account-directory.js'
import { NoOpMonetizationService } from '../src/services/monetization.js'
import { SESSION_COOKIE, createSession } from '../src/services/session.js'
import { encryptToken } from '../src/services/token-crypto.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { FAST_ENGINE } from './helpers/transfer.js'

let db: TestDb
let app: Express
const KEY = crypto.randomBytes(32)

beforeEach(async () => {
  db = await createTestDb()
  app = buildApp({ prisma: db.prisma, engineOptions: FAST_ENGINE, monetization: new NoOpMonetizationService() }).app
})
afterEach(async () => {
  await db.dispose()
})

async function signIn(accountId: string) {
  const agent = request.agent(app).set('X-Classroom-Copier', '1')
  await agent.post('/api/auth/sign-in').send({ accountId }).expect(200)
  return agent
}

/** A scan and a job that belong to A, created by A, for B to try to read. */
async function accountAResources() {
  const jamie = await signIn(ACCOUNT_JAMIE)
  const scan = await jamie
    .post(`/api/courses/${FIXTURE_KEYS.F5}/preflight`)
    .send({ targetId: FIXTURE_KEYS.TARGET_JAMIE })
    .expect(200)
  const scanId: string = scan.body.scanId
  const job = await jamie
    .post('/api/transfer-jobs')
    .send({ scanId, resolutions: [] })
    .expect(202)
  return { scanId, jobId: job.body.jobId as string }
}

describe('cross-account isolation (§8.0/S5)', () => {
  it('never serves account A′s job status, items or scan to account B', async () => {
    const { scanId, jobId } = await accountAResources()
    const dana = await signIn(ACCOUNT_DANA)

    for (const path of [`/api/transfer-jobs/${jobId}/status`, `/api/transfer-jobs/${jobId}/items`]) {
      const res = await dana.get(path)
      expect([403, 404]).toContain(res.status)
    }

    // A's scan id, replayed by B, must not become B's transfer.
    const stolenJob = await dana.post('/api/transfer-jobs').send({ scanId, resolutions: [] })
    expect([403, 404]).toContain(stolenJob.status)
  })

  it('scopes GET /transfer-jobs/active to the caller — B sees no job of A′s', async () => {
    await accountAResources()
    const dana = await signIn(ACCOUNT_DANA)
    // 204 is the "nothing active for you" answer; a 200 carrying A's job id
    // would be the leak. Both are asserted rather than only the body, because a
    // 200 with an empty body is still a leak of existence.
    const res = await dana.get('/api/transfer-jobs/active')
    expect(res.status).toBe(204)
    expect(res.body?.jobId ?? null).toBeNull()
  })

  it('never lists account A′s courses to account B', async () => {
    const dana = await signIn(ACCOUNT_DANA)
    for (const role of ['source', 'target']) {
      const res = await dana.get(`/api/courses?role=${role}`).expect(200)
      const ids: string[] = res.body.courses.map((c: { id: string }) => c.id)
      expect(ids).not.toContain(FIXTURE_KEYS.F5)
      expect(ids).not.toContain(FIXTURE_KEYS.TARGET_JAMIE)
      // A list that is empty for the wrong reason would pass the two assertions
      // above without proving anything, so B must still see B's own courses.
      expect(ids).toContain(FIXTURE_KEYS.TARGET_DANA)
    }
  })

  it('refuses a pre-flight scan of account A′s courses driven by account B', async () => {
    const dana = await signIn(ACCOUNT_DANA)
    const res = await dana
      .post(`/api/courses/${FIXTURE_KEYS.F5}/preflight`)
      .send({ targetId: FIXTURE_KEYS.TARGET_JAMIE })
    expect([403, 404]).toContain(res.status)
  })

  it('reports /api/auth/me as the signed-in account, never the other one', async () => {
    const dana = await signIn(ACCOUNT_DANA)
    const res = await dana.get('/api/auth/me').expect(200)
    expect(res.body.account.id).toBe(ACCOUNT_DANA)
  })

  it('rejects a revoked session outright rather than falling back to any account', async () => {
    const dana = await signIn(ACCOUNT_DANA)
    await dana.post('/api/auth/sign-out').expect(204)
    await dana.get('/api/auth/me').expect(401)
  })
})

/**
 * E2 — the same boundary, driven by two distinct `GoogleAccount` identities.
 *
 * The cases above sign in through the MOCK account picker, so every one of them
 * exercises `Session.accountId` naming a `MockAccount`. The code under test is
 * provider-agnostic — the routes ask the `AccountDirectory` port, not a table —
 * so that coverage is representative, but the literal google-mode case had no
 * test at all, which is the same shape of gap E1 was.
 *
 * Scope is stated rather than implied: this covers the SESSION → IDENTITY half,
 * where §8.0/S5's missing foreign key actually bites. The job/scan half needs
 * fixture courses owned by a GoogleAccount id, which the mock fixture world does
 * not have, and is tracked as a backlog item rather than faked here.
 */
describe('cross-account isolation — two GoogleAccount identities (E2)', () => {
  const A = '112233445566778899001'
  const B = '998877665544332211009'

  async function googleAccount(id: string, email: string, displayName: string) {
    const token = encryptToken('ya29.isolation-test-token', KEY)
    await db.prisma.googleAccount.create({
      data: {
        id,
        email,
        displayName,
        pictureUrl: null,
        accessTokenCiphertext: token.ciphertext,
        accessTokenIv: token.iv,
        accessTokenTag: token.tag,
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        scopesGranted: 'https://www.googleapis.com/auth/classroom.courses',
      },
    })
  }

  async function googleAgent(accountId: string) {
    const { token } = await createSession(db.prisma, accountId)
    return request
      .agent(app)
      .set('X-Classroom-Copier', '1')
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
  }

  beforeEach(async () => {
    // The directory is what makes `Session.accountId` resolve against
    // `GoogleAccount` instead of `MockAccount` — the one mode-dependent piece.
    app = buildApp({
      prisma: db.prisma,
      accounts: new GoogleAccountDirectory(db.prisma),
      engineOptions: FAST_ENGINE,
      monetization: new NoOpMonetizationService(),
    }).app
    await googleAccount(A, 'a.teacher@example.edu', 'Alex Pickett')
    await googleAccount(B, 'b.teacher@example.edu', 'Bailey Rivera')
  })

  it('reports each session as ITS OWN Google identity, never the other one', async () => {
    const alex = await googleAgent(A)
    const bailey = await googleAgent(B)

    const mine = await alex.get('/api/auth/me').expect(200)
    expect(mine.body.account.id).toBe(A)
    expect(mine.body.account.email).toBe('a.teacher@example.edu')

    const theirs = await bailey.get('/api/auth/me').expect(200)
    expect(theirs.body.account.id).toBe(B)
    // The leak this asserts against is a directory that resolves to whatever
    // row it finds first rather than to the one the session names.
    expect(theirs.body.account.email).not.toBe('a.teacher@example.edu')
  })

  it('refuses a session naming a GoogleAccount that does not exist', async () => {
    const ghost = await googleAgent('000000000000000000000')
    // Not a fallback to any account, and not a 200 with an empty body: the
    // request is rejected outright.
    await ghost.get('/api/auth/me').expect(401)
  })
})
