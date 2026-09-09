import type { NextFunction, Request, Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { SESSION_COOKIE, resolveSession } from '../services/session.js'

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { accountId: string; sessionId: string }
  }
}

export function requireAuth(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE]
    const headerToken = extractBearerToken(req.get('authorization'))
    const token = headerToken ?? cookieToken
    const session = await resolveSession(prisma, token)
    if (!session) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } })
      return
    }
    req.auth = session
    next()
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : undefined
}
