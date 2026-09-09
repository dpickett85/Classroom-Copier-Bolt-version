/**
 * The v1 mock account picker — a TEST-ONLY double.
 *
 * It lives in its own module, and `app.ts` mounts it only when
 * `config.googleProviderMode === 'mock'`. That is the whole point of the
 * separation (§8.4): under `GOOGLE_PROVIDER_MODE=google` these routes are not
 * merely disabled behind a conditional inside a handler, they are never
 * registered, so there is no production-reachable path that mints a session
 * without Google having authenticated anybody.
 */
import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { SignInRequestSchema } from '@classroom-copier/shared'
import {
  SESSION_COOKIE,
  cookieOptions,
  createSession,
  resolveSession,
  revokeSession,
} from '../services/session.js'

export function mockAuthRouter(prisma: PrismaClient): Router {
  const router = Router()

  router.get('/auth/mock-accounts', async (_req, res) => {
    const accounts = await prisma.mockAccount.findMany({ orderBy: { displayName: 'asc' } })
    res.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        email: a.email,
        initials: a.initials,
      })),
    })
  })

  router.post('/auth/sign-in', async (req, res) => {
    const parsed = SignInRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'bad_request', message: 'accountId is required.' } })
      return
    }
    const account = await prisma.mockAccount.findUnique({ where: { id: parsed.data.accountId } })
    if (!account) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such account.' } })
      return
    }

    // Revoke whatever was there. Always minting a fresh session is what makes
    // the picker unskippable and what makes "switch account" safe.
    const existing = await resolveSession(
      prisma,
      (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE],
    )
    if (existing) await revokeSession(prisma, existing.sessionId)

    const { token, expiresAt } = await createSession(prisma, account.id)
    res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt))
    res.json({
      account: {
        id: account.id,
        displayName: account.displayName,
        email: account.email,
        initials: account.initials,
      },
    })
  })

  return router
}
