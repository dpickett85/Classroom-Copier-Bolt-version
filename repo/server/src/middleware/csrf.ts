import type { NextFunction, Request, Response } from 'express'

/**
 * CSRF hardening. `POST /api/auth/sign-out` takes no body, which makes it a
 * "simple request" under the CORS spec — a plain cross-site `<form>` POST
 * reaches it without ever triggering a preflight, so CORS's origin allowlist
 * never gets a vote. Every other state-changing route relied on preflight
 * alone, which is a property of the REQUEST (custom header + JSON content
 * type), not a guarantee Express enforces.
 *
 * The fix is a custom request header. A cross-site form or plain <script>
 * fetch cannot attach `X-Classroom-Copier` without first passing a CORS
 * preflight against our pinned origin allowlist — so requiring it converts
 * every state-changing route into one that MUST clear preflight, sign-out
 * included. GETs are read-only and stay unprotected.
 */
export const CSRF_HEADER = 'x-classroom-copier'

const PROTECTED_METHODS = new Set(['POST', 'PATCH', 'DELETE'])

export function requireCsrfHeader() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!PROTECTED_METHODS.has(req.method)) {
      next()
      return
    }
    if (req.get(CSRF_HEADER) == null) {
      res.status(403).json({ error: { code: 'csrf_header_missing', message: 'Missing required request header.' } })
      return
    }
    next()
  }
}
