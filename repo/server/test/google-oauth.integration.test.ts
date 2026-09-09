/**
 * The real Google OAuth flow, driven end to end against a faked token exchange.
 *
 * The interesting assertions here are all NEGATIVE — no session was created, no
 * account row was written, the Location header did not move — because every one
 * of §8.0's findings is a thing that must NOT happen. An assertion that the
 * happy path works would pass with every one of them live.
 */
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { buildApp } from '../src/app.js'
import { config } from '../src/config.js'
import { OAUTH_STATE_COOKIE, type OAuthClient } from '../src/routes/auth.js'
import { SESSION_COOKIE } from '../src/services/session.js'
import { NoOpMonetizationService } from '../src/services/monetization.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { FAST_ENGINE } from './helpers/transfer.js'

const KEY = crypto.randomBytes(32).toString('base64')
const SUB = '112233445566778899001'

let db: TestDb
let app: Express
let oauth: OAuthClient
let exchanged: Array<{ code: string; verifier: string }>

/** The verifier the fake will accept — anything else is a PKCE mismatch. */
let acceptedVerifier: string | null

function fakeOAuth(): OAuthClient {
  return {
    createPkcePair: () => {
      const verifier = crypto.randomBytes(32).toString('base64url')
      acceptedVerifier = verifier
      return {
        verifier,
        challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      }
    },
    buildAuthorizationUrl: ({ challenge, state }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?code_challenge=${challenge}&code_challenge_method=S256&state=${state}`,
    exchangeCodeForTokens: async (code, verifier) => {
      exchanged.push({ code, verifier })
      if (verifier !== acceptedVerifier) throw new Error('code_verifier mismatch')
      return {
        accessToken: 'ya29.fake-access-token',
        expiresAt: new Date(Date.now() + 3_600_000),
        scopesGranted: 'https://www.googleapis.com/auth/classroom.courses',
        idToken: 'fake.id.token',
      }
    },
    verifyIdentity: async () => ({
      sub: SUB,
      email: 'ms.pickett@example.edu',
      displayName: 'Alex Pickett',
      pictureUrl: 'https://lh3.example.com/photo',
    }),
    revokeAccessToken: async () => true,
  }
}

beforeEach(async () => {
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', KEY)
  // config resolved at import with no key; the tests need one to encrypt with.
  Object.defineProperty(config, 'tokenEncryptionKey', {
    value: Buffer.from(KEY, 'base64'),
    configurable: true,
  })
  db = await createTestDb()
  exchanged = []
  acceptedVerifier = null
  oauth = fakeOAuth()
  app = buildApp({
    prisma: db.prisma,
    oauth,
    engineOptions: FAST_ENGINE,
    monetization: new NoOpMonetizationService(),
  }).app
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await db.dispose()
})

/** Starts a flow and returns the agent (holding the state cookie) + the nonce. */
async function startFlow() {
  const agent = request.agent(app).set('X-Classroom-Copier', '1')
  const res = await agent.get('/api/auth/google/url').expect(200)
  const nonce = new URL(res.body.url).searchParams.get('state')!
  return { agent, nonce, url: res.body.url as string }
}

function cookieFrom(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  return (raw ?? []).find((c) => c.startsWith(`${name}=`))
}

/* ------------------------------------------------------------------ */

describe('GET /api/auth/google/url — PKCE (§8.0/S1)', () => {
  it('starts OAuth with a redirect while setting the state cookie', async () => {
    const res = await request(app).get('/api/auth/google/start').expect(302)
    expect(res.headers.location).toContain('state=')
    expect(cookieFrom(res, OAUTH_STATE_COOKIE)).toMatch(/HttpOnly/i)
  })

  it('carries code_challenge and code_challenge_method=S256', async () => {
    const { url } = await startFlow()
    const params = new URL(url).searchParams
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toBeTruthy()
    // The challenge is the S256 of the verifier — not the verifier itself, which
    // would defeat the entire mechanism.
    expect(params.get('code_challenge')).not.toBe(acceptedVerifier)
    expect(params.get('code_challenge')).toBe(
      crypto.createHash('sha256').update(acceptedVerifier!).digest('base64url'),
    )
  })

  it('sets cc_oauth_state HttpOnly, SameSite=Lax, Path=/api/auth, Max-Age=600 (§8.0/S7)', async () => {
    const res = await request(app).get('/api/auth/google/url').expect(200)
    const cookie = cookieFrom(res, OAUTH_STATE_COOKIE)!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\/api\/auth/i)
    expect(cookie).toMatch(/Max-Age=600\b/i)
    // Secure ONLY in production — shipping it in dev means no cookie is ever
    // sent over http and every local run looks like a broken auth bug.
    expect(cookie).not.toMatch(/Secure/i)
  })

  it('never puts the verifier in the URL — it lives only in the HttpOnly cookie', async () => {
    const res = await request(app).get('/api/auth/google/url').expect(200)
    expect(res.body.url).not.toContain(acceptedVerifier!)
    expect(cookieFrom(res, OAUTH_STATE_COOKIE)).toContain(encodeURIComponent(acceptedVerifier!).slice(0, 8))
  })
})

describe('GET /api/auth/callback — the happy path', () => {
  it('creates the GoogleAccount row, mints a session, and redirects with no error param', async () => {
    const { agent, nonce } = await startFlow()
    const res = await agent.get(`/api/auth/callback?code=auth-code&state=${nonce}`).expect(302)

    expect(res.headers.location).toBe(`${config.frontendOrigin}/?auth=callback`)
    expect(cookieFrom(res, SESSION_COOKIE)).toBeTruthy()

    const account = await db.prisma.googleAccount.findUnique({ where: { id: SUB } })
    expect(account!.email).toBe('ms.pickett@example.edu')
    expect(await db.prisma.session.count({ where: { accountId: SUB } })).toBe(1)
  })

  it('stores the access token ENCRYPTED — never in plaintext', async () => {
    const { agent, nonce } = await startFlow()
    await agent.get(`/api/auth/callback?code=auth-code&state=${nonce}`).expect(302)
    const account = await db.prisma.googleAccount.findUnique({ where: { id: SUB } })
    for (const column of [account!.accessTokenCiphertext, account!.accessTokenIv, account!.accessTokenTag]) {
      expect(column).not.toContain('ya29.fake-access-token')
    }
    expect(account!.accessTokenCiphertext).not.toBe('ya29.fake-access-token')
  })

  it('exchanges the code WITH the verifier from the cookie', async () => {
    const { agent, nonce } = await startFlow()
    await agent.get(`/api/auth/callback?code=auth-code&state=${nonce}`).expect(302)
    expect(exchanged).toEqual([{ code: 'auth-code', verifier: acceptedVerifier }])
  })

  it('clears cc_oauth_state on success', async () => {
    const { agent, nonce } = await startFlow()
    const res = await agent.get(`/api/auth/callback?code=auth-code&state=${nonce}`).expect(302)
    expect(cookieFrom(res, OAUTH_STATE_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i)
  })

  it('signs the same teacher in twice without duplicating the account row', async () => {
    for (let i = 0; i < 2; i++) {
      const { agent, nonce } = await startFlow()
      await agent.get(`/api/auth/callback?code=auth-code&state=${nonce}`).expect(302)
    }
    expect(await db.prisma.googleAccount.count()).toBe(1)
  })
})

describe('GET /api/auth/callback — refusals', () => {
  it('passes Google′s access_denied through as ?authError=denied, with no session', async () => {
    const { agent } = await startFlow()
    const res = await agent.get('/api/auth/callback?error=access_denied').expect(302)
    expect(res.headers.location).toBe(`${config.frontendOrigin}/?authError=denied`)
    expect(cookieFrom(res, SESSION_COOKIE)).toBeUndefined()
    expect(await db.prisma.session.count()).toBe(0)
  })

  it('answers a MISSING state cookie with ?authError=expired and creates nothing', async () => {
    const res = await request(app).get('/api/auth/callback?code=c&state=whatever').expect(302)
    expect(res.headers.location).toBe(`${config.frontendOrigin}/?authError=expired`)
    expect(await db.prisma.session.count()).toBe(0)
    expect(await db.prisma.googleAccount.count()).toBe(0)
    expect(exchanged).toHaveLength(0)
  })

  it('answers a MISMATCHED state with ?authError=expired and never exchanges the code', async () => {
    const { agent } = await startFlow()
    const res = await agent.get('/api/auth/callback?code=c&state=not-the-nonce').expect(302)
    expect(res.headers.location).toBe(`${config.frontendOrigin}/?authError=expired`)
    expect(exchanged).toHaveLength(0)
    expect(await db.prisma.session.count()).toBe(0)
  })

  it('answers a PKCE verifier mismatch with ?authError=expired and no session (§8.0/S1)', async () => {
    const { agent, nonce } = await startFlow()
    // Simulate a stolen code replayed by a different browser: the code is
    // genuine, the verifier this flow holds is not the one the challenge came
    // from.
    acceptedVerifier = 'a-different-verifier-entirely'
    const res = await agent.get(`/api/auth/callback?code=stolen-code&state=${nonce}`).expect(302)
    expect(res.headers.location).toBe(`${config.frontendOrigin}/?authError=expired`)
    expect(await db.prisma.session.count()).toBe(0)
    expect(await db.prisma.googleAccount.count()).toBe(0)
  })

  it('clears cc_oauth_state on mismatch and on denial alike', async () => {
    const { agent } = await startFlow()
    for (const path of ['/api/auth/callback?code=c&state=wrong', '/api/auth/callback?error=access_denied']) {
      const res = await agent.get(path).expect(302)
      expect(cookieFrom(res, OAUTH_STATE_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i)
    }
  })
})

describe('open redirect (§8.0/S2) — the Location is a boot-time constant', () => {
  const HOSTILE = 'https://evil.example.com'

  it('ignores a hostile Referer, a hostile Origin, a returnTo parameter and an absolute-URL state', async () => {
    const cases: Array<[string, (r: request.Test) => request.Test]> = [
      ['hostile Referer', (r) => r.set('Referer', HOSTILE)],
      ['hostile Origin', (r) => r.set('Origin', HOSTILE)],
      ['returnTo parameter', (r) => r],
      ['absolute-URL state', (r) => r],
    ]
    for (const [label, decorate] of cases) {
      const { agent, nonce } = await startFlow()
      const state = label === 'absolute-URL state' ? HOSTILE : nonce
      const returnTo = label === 'returnTo parameter' ? `&returnTo=${encodeURIComponent(HOSTILE)}` : ''
      const res = await decorate(
        agent.get(`/api/auth/callback?code=auth-code&state=${encodeURIComponent(state)}${returnTo}`),
      ).expect(302)
      const location = res.headers.location as string
      expect(location.startsWith(config.frontendOrigin), label).toBe(true)
      expect(location, label).not.toContain('evil.example.com')
    }
  })
})

describe('account-scoped resume (§8.0/S8)', () => {
  it('leaves a job paused under a DIFFERENT account untouched', async () => {
    const scan = await db.prisma.preflightScan.create({
      data: {
        id: 'scan-other',
        accountId: 'acct-jamie',
        sourceCourseId: 'course-f1',
        targetCourseId: 'course-target-jamie',
        sourceCourseName: 'Biology (Source)',
        targetCourseName: 'Biology (Target)',
        totalPostsScanned: 0,
        findingsJson: '[]',
      },
    })
    const pausedAt = new Date(Date.now() - 60_000)
    await db.prisma.transferJob.create({
      data: {
        id: 'job-other-account',
        accountId: 'acct-jamie',
        scanId: scan.id,
        status: 'running',
        googleReauthRequiredAt: pausedAt,
        activeAccountId: 'acct-jamie',
      },
    })

    const { agent, nonce } = await startFlow()
    await agent.get(`/api/auth/callback?code=auth-code&state=${nonce}`).expect(302)

    const job = await db.prisma.transferJob.findUnique({ where: { id: 'job-other-account' } })
    expect(job!.googleReauthRequiredAt).toEqual(pausedAt)
  })
})

describe('POST /api/auth/sign-out', () => {
  it('revokes the Session row even when the upstream revoke rejects', async () => {
    oauth.revokeAccessToken = async () => {
      throw new Error('google is down')
    }
    const { agent, nonce } = await startFlow()
    await agent.get(`/api/auth/callback?code=auth-code&state=${nonce}`).expect(302)

    await agent.post('/api/auth/sign-out').expect(204)
    const sessions = await db.prisma.session.findMany({ where: { accountId: SUB } })
    expect(sessions.every((s) => s.revokedAt != null)).toBe(true)
    await agent.get('/api/auth/me').expect(401)
  })
})

describe('§8.4 — the mock picker is not in the production routing table', () => {
  it('404s the mock-account routes when GOOGLE_PROVIDER_MODE=google', async () => {
    vi.stubEnv('GOOGLE_PROVIDER_MODE', 'google')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('GOOGLE_REDIRECT_URI', 'https://api.example.com/api/auth/callback')
    vi.resetModules()

    const { buildApp: buildGoogleApp } = await import('../src/app.js')
    const googleApp = buildGoogleApp({
      prisma: db.prisma,
      oauth,
      engineOptions: FAST_ENGINE,
      monetization: new NoOpMonetizationService(),
    }).app

    const accounts = await request(googleApp).get('/api/auth/mock-accounts').expect(404)
    expect(accounts.body.error.code).toBe('not_found')
    const signIn = await request(googleApp)
      .post('/api/auth/sign-in')
      .set('X-Classroom-Copier', '1')
      .send({ accountId: 'acct-jamie' })
      .expect(404)
    expect(signIn.body.error.code).toBe('not_found')
  })
})
