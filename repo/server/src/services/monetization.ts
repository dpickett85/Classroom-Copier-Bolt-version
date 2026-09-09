/**
 * monetization — present, feature-flagged, and a no-op.
 *
 * The hook points exist NOW so a future StripeMonetizationService is a flag
 * flip rather than a migration. The completion hook is injected into
 * `transfer-engine` as a callback (D28), which is what gives it a real code
 * path: previously it lived in one module's prose and in no module's code.
 *
 * Credit rule (specified now, inert now): deduct only on a 100% clean transfer;
 * auto-refund on any fallback injection. Users never pay for a degraded copy.
 */
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { config } from '../config.js'
import { logger } from '../logger.js'

export interface MonetizationService {
  /** Called at job creation. Returns false to block; always true while off. */
  checkCredit(accountId: string): Promise<boolean>
  /** Called at job completion (injected into transfer-engine as a callback). */
  onJobComplete(input: { jobId: string; accountId: string; cleanTransfer: boolean }): Promise<void>
}

export class NoOpMonetizationService implements MonetizationService {
  readonly calls = { checkCredit: 0, onJobComplete: 0 }

  async checkCredit(accountId: string): Promise<boolean> {
    this.calls.checkCredit += 1
    logger.debug('monetization.checkCredit (no-op)', { accountId })
    return true
  }

  async onJobComplete(input: {
    jobId: string
    accountId: string
    cleanTransfer: boolean
  }): Promise<void> {
    this.calls.onJobComplete += 1
    logger.debug('monetization.onJobComplete (no-op)', input)
  }
}

/** Not wired in v1 — kept so the shape of the real thing is visible and the
 *  flag flip is the only change. */
export class LedgerMonetizationService implements MonetizationService {
  constructor(private readonly prisma: PrismaClient) {}

  async checkCredit(accountId: string): Promise<boolean> {
    const entries = await this.prisma.creditLedger.findMany({ where: { accountId } })
    return entries.reduce((sum, e) => sum + e.delta, 0) > 0
  }

  async onJobComplete(input: {
    jobId: string
    accountId: string
    cleanTransfer: boolean
  }): Promise<void> {
    await this.prisma.creditLedger.create({
      data: {
        id: `credit-${randomUUID()}`,
        accountId: input.accountId,
        jobId: input.jobId,
        delta: input.cleanTransfer ? -1 : 0,
        reason: input.cleanTransfer ? 'clean_transfer_deduction' : 'fallback_auto_refund',
      },
    })
  }
}

export function createMonetizationService(prisma: PrismaClient): MonetizationService {
  return config.featureMonetizationEnabled
    ? new LedgerMonetizationService(prisma)
    : new NoOpMonetizationService()
}
