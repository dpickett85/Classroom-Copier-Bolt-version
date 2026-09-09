/**
 * The ONE module that imports `google-auth-library`.
 *
 * PKCE lives here rather than in the route file on purpose (§8.0/S1): the
 * verifier, the challenge and the token exchange are three halves of one
 * protocol, and splitting them across a router and an adapter is how a
 * `code_verifier` ends up being generated in one place and never checked in
 * another. The routes ask this module for a URL and hand it back a code.
 *
 * §8.0/S6 — nothing here logs a `code`, a `code_verifier`, a token, or a raw
 * provider error object. googleapis error objects carry
 * `config.headers.Authorization`, i.e. the live bearer token, so passing one to
 * a logger writes the credential into the log file.
 */
import crypto from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import type { PrismaClient } from '@prisma/client'
import { AuthExpiredError } from '../types.js'
import { config } from '../../config.js'
import { decryptToken } from '../../services/token-crypto.js'

/**
 * The scopes this app asks for. `classroom.courses` is read-only at the course
 * level; everything that writes is scoped to the two classwork surfaces and
 * topics.
 *
 * **Two Drive scopes, and both are load-bearing** (04-architecture.md §2 and
 * §7/S9):
 *
 * - `drive.metadata.readonly` — the pre-flight attachment-health check
 *   (`RealClassroomProvider.driveFileHealth`) reads `trashed` and
 *   `capabilities/canCopy` on files the TEACHER created, long before this app
 *   existed. Nothing narrower can see them.
 * - `drive.file` — NOT `drive` — for the "Copy to My Drive" write: it grants
 *   access only to files this app itself created or the user explicitly opened
 *   with it, which is why copy-to-my-drive is a discrete step rather than the
 *   app simply reading any file it finds attached.
 *
 * `drive.file` alone was shipped once and cannot do the first job — it would
 * have made every real attachment classify as trashed or permission-locked on
 * the teacher's first live transfer (QA-7). `oauth-scopes.test.ts` now pins the
 * capability rather than the strings, so removing a scope while the call that
 * needs it survives goes red.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/classroom.courses',
  'https://www.googleapis.com/auth/classroom.coursework.me',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials',
  'https://www.googleapis.com/auth/classroom.topics',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.file',
] as const

export interface PkcePair {
  verifier: string
  challenge: string
}

/**
 * RFC 7636 — a high-entropy verifier and its S256 challenge. base64url, because
 * the verifier travels in a form body and the challenge in a query string.
 */
export function createPkcePair(): PkcePair {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function client(): OAuth2Client {
  return new OAuth2Client({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.googleRedirectUri,
  })
}

export interface AuthorizationUrlOptions {
  challenge: string
  /** Opaque, signed by the caller — this module never interprets it. */
  state: string
}

export function buildAuthorizationUrl({ challenge, state }: AuthorizationUrlOptions): string {
  return client().generateAuthUrl({
    // Decision A — no refresh token, so no `access_type: 'offline'` and no
    // `prompt: 'consent'`. The app holds an hour-long access token and asks the
    // teacher to reconnect when it lapses, which is the whole reason
    // pause-and-resume exists.
    scope: [...GOOGLE_SCOPES],
    include_granted_scopes: true,
    state,
    code_challenge_method: 'S256' as never,
    code_challenge: challenge,
  })
}

export interface ExchangedTokens {
  accessToken: string
  expiresAt: Date
  scopesGranted: string
  idToken: string | null
}

export async function exchangeCodeForTokens(code: string, verifier: string): Promise<ExchangedTokens> {
  try {
    const { tokens } = await client().getToken({ code, codeVerifier: verifier })
    if (!tokens.access_token) throw new AuthExpiredError('Google returned no access token.')
    return {
      accessToken: tokens.access_token,
      // Google returns an absolute epoch ms in `expiry_date`. Falling back to
      // "an hour from now" rather than "now" would make an unknown expiry look
      // like a fresh token, which is the direction that hurts.
      expiresAt: new Date(tokens.expiry_date ?? Date.now()),
      scopesGranted: tokens.scope ?? '',
      idToken: tokens.id_token ?? null,
    }
  } catch (error) {
    if (error instanceof AuthExpiredError) throw error
    // The raw error is never re-thrown or logged: a failed token exchange's
    // error object carries the authorization code and the client secret.
    // Extract ONLY the message string — never the error object itself.
    const detail = error instanceof Error ? error.message : String(error)
    throw new AuthExpiredError(`Google refused the sign-in. Try connecting again. (${detail})`)
  }
}

export interface GoogleIdentity {
  sub: string
  email: string
  displayName: string
  pictureUrl: string | null
}

/**
 * The identity comes from the ID token, verified against Google's keys — not
 * from a userinfo call, and never from an unverified JWT decode.
 */
export async function verifyIdentity(idToken: string): Promise<GoogleIdentity> {
  try {
    const ticket = await client().verifyIdToken({ idToken, audience: config.googleClientId })
    const payload = ticket.getPayload()
    if (!payload?.sub || !payload.email) throw new AuthExpiredError('Google returned an incomplete profile.')
    return {
      sub: payload.sub,
      email: payload.email,
      displayName: payload.name ?? payload.email,
      pictureUrl: payload.picture ?? null,
    }
  } catch (error) {
    if (error instanceof AuthExpiredError) throw error
    throw new AuthExpiredError('Google returned a profile we could not verify.')
  }
}

/**
 * Best effort, by design (§5.1). The token expires within the hour regardless,
 * so a failed revoke is defense-in-depth that did not land — never a reason to
 * fail a sign-out the teacher just asked for.
 */
export async function revokeAccessToken(accessToken: string): Promise<boolean> {
  try {
    await client().revokeToken(accessToken)
    return true
  } catch {
    return false
  }
}

export interface AuthorizedAccount {
  auth: OAuth2Client
  accessTokenExpiresAt: Date
}

/**
 * Builds an authorized client for one account, per call — tokens are short-lived
 * and there is no refresh token to renew with, so caching one would only cache a
 * credential that is about to stop working.
 *
 * Throws `AuthExpiredError` when the stored token is already past its expiry, so
 * the reconnect prompt happens before a request is spent discovering it.
 */
export async function buildAuthorizedClient(
  prisma: PrismaClient,
  accountId: string,
): Promise<AuthorizedAccount> {
  const account = await prisma.googleAccount.findUnique({ where: { id: accountId } })
  if (!account) throw new AuthExpiredError('No Google connection on file. Sign in again.')
  if (account.accessTokenExpiresAt.getTime() <= Date.now()) {
    throw new AuthExpiredError('Your Google connection expired. Sign in again to continue.')
  }
  // decryptToken raises AuthExpiredError itself on a rotated/corrupt key (S4).
  const accessToken = decryptToken(
    {
      ciphertext: account.accessTokenCiphertext,
      iv: account.accessTokenIv,
      tag: account.accessTokenTag,
    },
    undefined,
    { accountId },
  )
  const auth = client()
  auth.setCredentials({ access_token: accessToken })
  return { auth, accessTokenExpiresAt: account.accessTokenExpiresAt }
}
