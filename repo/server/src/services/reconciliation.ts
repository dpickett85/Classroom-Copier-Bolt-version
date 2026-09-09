/**
 * The one implementation of the reconciliation arithmetic in the system.
 *
 * Counts are `GROUP BY outcome` aggregates over the item rows — never
 * independently-incremented counters, which is the classic drift bug where a
 * counter is bumped on a path that later throws. The Completion Summary renders
 * these numbers directly and never recomputes them client-side.
 *
 *   transferred + fallback_shell + skipped_total == count(items) == scan.totalPostsScanned
 *
 * The topic counters are never terms (a topic is not a post).
 * `rubricNotesAdded` is a non-additive subset tag over posts already counted in
 * one of the three buckets.
 */
import type { PrismaClient } from '@prisma/client'
import { isDuplicateSkip, isUserSkip, type SkipReason } from '@classroom-copier/shared'

export interface OutcomeCounts {
  totalItems: number
  pending: number
  transferred: number
  fallbackShell: number
  skippedTotal: number
  skippedByUser: number
  skippedBySystem: number
  /**
   * Decision G — the third bucket. It exists because the two-way if/else put
   * `duplicate_title` in `skippedBySystem`, which is what fires the completion
   * summary's "N posts were interrupted before we could confirm they copied"
   * line on an ordinary re-run. Nothing was interrupted; nothing was attempted.
   *
   * skippedTotal === skippedByUser + skippedBySystem + skippedDuplicate holds by
   * construction — one GROUP BY, four readers, never an independent counter.
   */
  skippedDuplicate: number
  rubricNotesAdded: number
}

export async function countOutcomes(
  prisma: PrismaClient,
  jobId: string,
): Promise<OutcomeCounts> {
  const rows = await prisma.transferJobItem.findMany({
    where: { jobId },
    select: { outcome: true, skipReason: true, rubricDegraded: true },
  })

  const counts: OutcomeCounts = {
    totalItems: rows.length,
    pending: 0,
    transferred: 0,
    fallbackShell: 0,
    skippedTotal: 0,
    skippedByUser: 0,
    skippedBySystem: 0,
    skippedDuplicate: 0,
    rubricNotesAdded: 0,
  }

  for (const row of rows) {
    if (row.rubricDegraded) counts.rubricNotesAdded += 1
    switch (row.outcome) {
      case 'pending':
        counts.pending += 1
        break
      case 'transferred':
        counts.transferred += 1
        break
      case 'fallback_shell':
        counts.fallbackShell += 1
        break
      case 'skipped': {
        counts.skippedTotal += 1
        // D14 — the split is for LABELLING. The three-term SUM is unchanged;
        // this is a three-way split of its third term.
        //
        // The duplicate test comes FIRST and is explicit. The previous two-way
        // if/else ended in a bare `else`, so any reason nobody classified fell
        // into `skippedBySystem` by default — which is how `duplicate_title`
        // silently acquired the "interrupted" copy.
        const reason = row.skipReason as SkipReason | null
        if (isDuplicateSkip(reason)) counts.skippedDuplicate += 1
        else if (isUserSkip(reason)) counts.skippedByUser += 1
        else counts.skippedBySystem += 1
        break
      }
      default:
        break
    }
  }

  return counts
}

export interface InvariantResult {
  holds: boolean
  detail: string
  counts: OutcomeCounts
  totalPostsScanned: number
}

/** Reads `totalPostsScanned` from the PERSISTED scan row, not from a fresh
 *  count — the whole point of D11 is that there is one measurement. */
export async function checkInvariant(
  prisma: PrismaClient,
  jobId: string,
): Promise<InvariantResult> {
  const job = await prisma.transferJob.findUnique({
    where: { id: jobId },
    include: { scan: { select: { totalPostsScanned: true } } },
  })
  if (!job) throw new Error(`TransferJob ${jobId} not found`)

  const counts = await countOutcomes(prisma, jobId)
  const sum = counts.transferred + counts.fallbackShell + counts.skippedTotal
  const totalPostsScanned = job.scan.totalPostsScanned

  const holds =
    counts.pending === 0 && sum === counts.totalItems && counts.totalItems === totalPostsScanned

  return {
    holds,
    counts,
    totalPostsScanned,
    detail:
      `transferred=${counts.transferred} + fallback_shell=${counts.fallbackShell} + ` +
      `skipped=${counts.skippedTotal} = ${sum}; items=${counts.totalItems}; ` +
      `scan.totalPostsScanned=${totalPostsScanned}; pending=${counts.pending}`,
  }
}
