import type { NextFunction, Request, Response } from 'express'
import { config } from '../config.js'
import type { MonetizationService } from '../services/monetization.js'

/**
 * The credit check at job creation. With the flag off it always calls next()
 * and never touches the ledger — but it IS called, which is the point: the hook
 * point exists and is exercised by a spy in the acceptance test.
 *
 * Never mounted on `/api/health` or the auth routes (composition-root enforces
 * the mount order), and never on the status endpoint — a poll must not be
 * gated by a credit check.
 */
export function monetizationGate(service: MonetizationService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const accountId = req.auth?.accountId
    if (!accountId) {
      next()
      return
    }
    const allowed = await service.checkCredit(accountId)
    if (!allowed && config.featureMonetizationEnabled) {
      res
        .status(402)
        .json({ error: { code: 'insufficient_credit', message: 'No transfer credits remaining.' } })
      return
    }
    next()
  }
}
