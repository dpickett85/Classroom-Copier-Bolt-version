/**
 * auth-module — the real Google OAuth flow.
 *
 * Four routes and one cookie. The cookie (`cc_oauth_state`) is what makes the
 * flow safe without server-side session storage for an unauthenticated visitor:
 * it carries the CSRF nonce and the PKCE `code_verifier`, is HttpOnly, scoped to
 * `/api/auth`, and lives ten minutes.
 *
 * Three properties are structural rather than conditional, because each is a
 * thing a later edit could quietly undo:
 *
 * - **The redirect target is `config.frontendOrigin`, a boot-time constant.**
 *   No part of the request contributes to it — not `Referer`, not `Origin`, not
 *   a `returnTo` parameter, not `state`. §8.0/S2.
 * - **The job to resume is found by the SESSION's account id**, never by a job
 *   id from the request, so one account can never resume another's. §8.0/S8.
 * - **The mock account picker is not in this file at all** (see
 *   `auth-mock.ts`), so there is no production-reachable route that mints a
 *   session without Google. §8.4.
 *
 * §8.0/S6 — nothing here logs a `code`, a `code_verifier`, a token, or a raw
 * provider error.
 */
import { Router, type CookieOptions, type Request, type Response } from 'express'
import crypto from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { AuthError as SharedAuthError } from '@classroom-copier/shared'
import { requireAuth } from '../middleware/auth.js'
import { config } from '../config.js'
import { logger } from '../logger.js'
import type { AccountDirectory } from '../services/account-directory.js'
import { encryptToken, decryptToken } from '../services/token-crypto.js'
import {
  SESSION_COOKIE,
  clearCookieOptions,
  cookieOptions,
  createSession,
  resolveSession,
  revokeSession,
} from '../services/session.js'
import {
  buildAuthorizationUrl,
  createPkcePair,
  exchangeCodeForTokens,
  revokeAccessToken,
  verifyIdentity,
  type ExchangedTokens,
  type GoogleIdentity,
} from '../adapters/google/oauth-client.js'

export const OAUTH_STATE_COOKIE = 'cc_oauth_state'
/** Ten minutes: long enough for a consent screen, short enough to be no use later. */
export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000

/** §8.0/S7 — scoped to the auth path, Secure in prod.
 *
 * The OAuth state cookie is set and read during top-level navigations: the
 * browser navigates to /api/auth/google/start (setting the cookie), goes to
 * Google, and returns to /api/auth/callback (reading the cookie). Both are
 * same-domain navigations on the backend origin, so SameSite=Lax is correct
 * and is NOT blocked by incognito mode the way SameSite=None would be. */
function oauthStateCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProductionLike,
    path: '/api/auth',
    maxAge: OAUTH_STATE_MAX_AGE_MS,
  }
}

/** Imported, not re-declared: the client renders copy for exactly these three
 *  codes and a second local list is a second thing to keep in sync. */
type AuthError = SharedAuthError

/**
 * The ONLY function that builds a Location header. It takes an error code and
 * nothing else — there is deliberately no parameter through which a request
 * could contribute to the origin.
 */
function redirectToFrontend(res: Response, authError: AuthError | null, sessionToken?: string): void {
  res.clearCookie(OAUTH_STATE_COOKIE, oauthStateCookieOptions())
  // On success the frontend is told it is on the RETURN LEG, so it can render
  // "Signing you in…" (UX 1d) instead of flashing the landing screen while its
  // own session check is in flight. The client strips this marker with
  // `history.replaceState` before it paints, so the Back button cannot return
  // to a URL carrying a stale sign-in state. Note what is NOT here: the
  // authorization CODE never reaches the frontend URL at all — it is consumed
  // by this handler and nothing downstream ever sees it.
  //
  // The session token is passed as a URL fragment (not a query param) so it
  // never reaches a server log or the browser's history. The frontend stores
  // it in sessionStorage and sends it as a Bearer header on every API call —
  // this works in incognito mode where SameSite=None cookies are blocked.
  if (authError) {
    res.redirect(302, `${config.frontendOrigin}/?authError=${authError}`)
    return
  }
  const fragment = sessionToken ? `#token=${sessionToken}` : ''
  res.redirect(302, `${config.frontendOrigin}/?auth=callback${fragment}`)
}

/** Injected so tests can drive the flow without a live Google. */
export interface OAuthClient {
  buildAuthorizationUrl: typeof buildAuthorizationUrl
  createPkcePair: typeof createPkcePair
  exchangeCodeForTokens: (code: string, verifier: string) => Promise<ExchangedTokens>
  verifyIdentity: (idToken: string) => Promise<GoogleIdentity>
  revokeAccessToken: (accessToken: string) => Promise<boolean>
}

const REAL_OAUTH: OAuthClient = {
  buildAuthorizationUrl,
  createPkcePair,
  exchangeCodeForTokens,
  verifyIdentity,
  revokeAccessToken,
}

export interface AuthRouterDeps {
  accounts: AccountDirectory
  oauth?: OAuthClient
  /** Decision F — resume the job this account paused for re-auth. */
  onReauthenticated?: (jobId: string) => void
}

interface StatePayload {
  nonce: string
  verifier: string
}

function readStateCookie(raw: string | undefined): StatePayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StatePayload>
    if (typeof parsed.nonce !== 'string' || typeof parsed.verifier !== 'string') return null
    return { nonce: parsed.nonce, verifier: parsed.verifier }
  } catch {
    return null
  }
}

export function authRouter(prisma: PrismaClient, deps: AuthRouterDeps): Router {
  const router = Router()
  const oauth = deps.oauth ?? REAL_OAUTH

  const startGoogleFlow = (_req: Request, res: Response): void => {
    const { verifier, challenge } = oauth.createPkcePair()
    const nonce = crypto.randomBytes(16).toString('base64url')
    res.cookie(
      OAUTH_STATE_COOKIE,
      JSON.stringify({ nonce, verifier } satisfies StatePayload),
      oauthStateCookieOptions(),
    )
    const url = oauth.buildAuthorizationUrl({ challenge, state: nonce })
    res.redirect(302, url)
  }

  router.get('/auth/google/start', startGoogleFlow)

  router.get('/auth/google/url', (_req, res) => {
    const { verifier, challenge } = oauth.createPkcePair()
    const nonce = crypto.randomBytes(16).toString('base64url')
    res.cookie(
      OAUTH_STATE_COOKIE,
      JSON.stringify({ nonce, verifier } satisfies StatePayload),
      oauthStateCookieOptions(),
    )
    res.json({ url: oauth.buildAuthorizationUrl({ challenge, state: nonce }) })
  })

  router.get('/auth/callback', async (req, res) => {
    const query = req.query as Record<string, string | undefined>
    // Google's own refusal arrives as a query parameter, not an exception.
    if (query.error) {
      redirectToFrontend(res, query.error === 'access_denied' ? 'denied' : 'generic')
      return
    }

    const state = readStateCookie((req.cookies as Record<string, string> | undefined)?.[OAUTH_STATE_COOKIE])
    // A missing cookie and a mismatched nonce are the same fact — this browser
    // did not start this flow — and get the same answer. `timingSafeEqual`
    // needs equal lengths, so the length check comes first.
    const nonceMatches =
      state != null &&
      typeof query.state === 'string' &&
      Buffer.byteLength(query.state) === Buffer.byteLength(state.nonce) &&
      crypto.timingSafeEqual(Buffer.from(query.state), Buffer.from(state.nonce))
    if (!nonceMatches || !query.code) {
      logger.warn('oauth callback rejected: state cookie missing or nonce mismatch', {
        hasStateCookie: state != null,
        hasCode: query.code != null,
      })
      redirectToFrontend(res, 'expired')
      return
    }

    let tokens: ExchangedTokens
    let identity: GoogleIdentity
    try {
      tokens = await oauth.exchangeCodeForTokens(query.code, state.verifier)
      if (!tokens.idToken) throw new Error('no id token')
      identity = await oauth.verifyIdentity(tokens.idToken)
    } catch (err) {
      // The caught error is discarded rather than logged: a failed exchange's
      // error object carries the authorization code and the client secret.
      // Extract ONLY the message string for diagnostics.
      const detail = err instanceof Error ? err.message : String(err)
      logger.warn('google oauth callback could not complete a token exchange', { reason: 'exchange_failed', detail })
      redirectToFrontend(res, 'expired')
      return
    }

    const encrypted = encryptToken(tokens.accessToken)
    const record = {
      email: identity.email,
      displayName: identity.displayName,
      pictureUrl: identity.pictureUrl,
      accessTokenCiphertext: encrypted.ciphertext,
      accessTokenIv: encrypted.iv,
      accessTokenTag: encrypted.tag,
      accessTokenExpiresAt: tokens.expiresAt,
      scopesGranted: tokens.scopesGranted,
    }
    await prisma.googleAccount.upsert({
      where: { id: identity.sub },
      create: { id: identity.sub, ...record },
      update: record,
    })

    const { token, expiresAt } = await createSession(prisma, identity.sub)
    res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt))

    // §8.0/S8 — the job is found by THIS session's account, never by an id the
    // request supplied, which would let one teacher resume another's transfer.
    const paused = await prisma.transferJob.findFirst({
      where: { accountId: identity.sub, googleReauthRequiredAt: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (paused) {
      // The CLEAR is deliberately NOT done here. `TransferEngine.resume()` owns
      // the whole transition — conditional clear, heartbeat, re-enter run() —
      // and clearing the flag from this side would leave it with nothing to
      // claim, so a resume that never actually started would be indistinguish-
      // able from one that did.
      logger.jobEvent('resumed', { jobId: paused.id, reason: 'reauthenticated' })
      deps.onReauthenticated?.(paused.id)
    }

    redirectToFrontend(res, null, token)
  })

  router.post('/auth/sign-out', async (req, res) => {
    const session = await resolveSession(
      prisma,
      (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE],
    )
    if (session) {
      await revokeSession(prisma, session.sessionId)
      // Best-effort, and deliberately awaited-but-never-fatal: the token expires
      // within the hour regardless, so this is defense in depth, not a
      // dependency. A failure here must never turn a routine sign-out into an
      // error the teacher sees.
      void revokeUpstream(prisma, oauth, session.accountId)
    }
    res.clearCookie(SESSION_COOKIE, clearCookieOptions())
    res.status(204).end()
  })

  router.get('/auth/me', requireAuth(prisma), async (req, res) => {
    // Through the AccountDirectory port, not `prisma.mockAccount`: the session's
    // accountId names a MockAccount or a GoogleAccount depending on provider
    // mode, and this route has no business knowing which.
    const account = await deps.accounts.getAccountSummary(req.auth!.accountId)
    if (!account) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } })
      return
    }
    res.json({ account })
  })

  return router
}

async function revokeUpstream(
  prisma: PrismaClient,
  oauth: OAuthClient,
  accountId: string,
): Promise<void> {
  try {
    const account = await prisma.googleAccount.findUnique({ where: { id: accountId } })
    if (!account) return
    const accessToken = decryptToken(
      {
        ciphertext: account.accessTokenCiphertext,
        iv: account.accessTokenIv,
        tag: account.accessTokenTag,
      },
      undefined,
      { accountId },
    )
    const revoked = await oauth.revokeAccessToken(accessToken)
    if (!revoked) logger.warn('google token revocation did not succeed', { accountId })
  } catch {
    logger.warn('google token revocation could not be attempted', { accountId })
  }
}
