import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import {
  CreateTransferJobRequestSchema,
  OutcomeSchema,
  isDuplicateSkip,
  isUserSkip,
  type JobStatus,
  type Outcome,
  type SkipReason,
  type SourceType,
  type TransferJobItemRow,
  type TransferJobStatus,
  type TypeSpecificFields,
  type WorkType,
} from '@classroom-copier/shared'
import { config } from '../config.js'
import { requireAuth } from '../middleware/auth.js'
import { monetizationGate } from '../middleware/monetization.js'
import type { MonetizationService } from '../services/monetization.js'
import { typeLabel } from '../services/post-enumerator.js'
import { countOutcomes } from '../services/reconciliation.js'
import {
  ActiveJobConflictError,
  JobAlreadyFinishedError,
  JobNotFoundError,
  ScanAlreadyUsedError,
  ScanNotFoundError,
  ScanStaleError,
  createTransferJob,
  requestJobCancellation,
  type TransferEngine,
} from '../services/transfer-engine.js'
import { logger } from '../logger.js'

const NON_TERMINAL: JobStatus[] = ['queued', 'running']

/** Express 5 types route params as `string | string[] | undefined`; every route
 *  here declares a single required param, so narrow it once rather than at
 *  every call site. */
function param(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function typeSpecificFor(
  sourceType: SourceType,
  workType: WorkType | null,
  maxPoints: number | null,
  answerConfig: { type: string; choices?: string[] } | null,
): TypeSpecificFields {
  // Per type, never one generic post shape: a Material has no representation
  // that can carry points or an answer config.
  if (sourceType === 'courseWorkMaterial') return { kind: 'none' }
  if (workType === 'MULTIPLE_CHOICE_QUESTION') {
    return { kind: 'multipleChoice', optionCount: answerConfig?.choices?.length ?? 0 }
  }
  if (workType === 'SHORT_ANSWER_QUESTION') return { kind: 'shortAnswer' }
  return { kind: 'graded', maxPoints }
}

export function transferJobsRouter(
  prisma: PrismaClient,
  engine: TransferEngine,
  monetization: MonetizationService,
): Router {
  const router = Router()
  const auth = requireAuth(prisma)

  /**
   * POST /api/transfer-jobs {scanId, resolutions[]}
   *
   * Items are inserted from the STORED scan rows. The request carries a
   * `scanId`, not a source course id, precisely so no re-enumeration can happen
   * here — that second scan is what made `count(items) == totalPostsScanned`
   * true only by convention.
   */
  router.post(
    '/transfer-jobs',
    auth,
    monetizationGate(monetization),
    async (req, res, next) => {
      const parsed = CreateTransferJobRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: { code: 'bad_request', message: 'scanId and resolutions[] are required.' } })
        return
      }
      try {
        const { jobId } = await createTransferJob(prisma, {
          accountId: req.auth!.accountId,
          scanId: parsed.data.scanId,
          resolutions: parsed.data.resolutions,
          scanTtlMs: config.scanTtlMs,
        })
        // 202 — the work is never done inline in the request.
        res.status(202).json({ jobId })
        // Fire-and-forget, but never unhandled: the engine's own top-level
        // catch marks the job `failed` and resolves its remaining items.
        void engine.run(jobId).catch((error: unknown) => {
          logger.error('transfer job executor rejected outside the engine', {
            jobId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      } catch (error) {
        if (error instanceof ActiveJobConflictError) {
          // Self-healing rather than confusing: attach to the job already
          // running. D5 — and the terminal set excludes nothing that a
          // rate-limit pause could hide behind, because pause is not a status.
          res.status(409).json({
            error: {
              code: 'job_already_running',
              message: 'A transfer is already running for this account.',
              jobId: error.existingJobId,
            },
            jobId: error.existingJobId,
          })
          return
        }
        if (error instanceof ScanAlreadyUsedError) {
          // APPLY-C — a scan produces at most one job. Back-then-confirm used to
          // copy every post a second time, with no id collision to stop it.
          res.status(409).json({
            error: {
              code: 'scan_already_used',
              message:
                'This pre-flight scan has already been transferred. Run a new pre-flight to copy again.',
              jobId: error.existingJobId,
            },
            jobId: error.existingJobId,
          })
          return
        }
        if (error instanceof ScanStaleError) {
          // APPLY-I — refuse rather than report "N of N" about a stale N.
          res.status(409).json({
            error: {
              code: 'scan_stale',
              message:
                'This pre-flight scan is out of date — the source course may have changed since. Run it again.',
            },
          })
          return
        }
        if (error instanceof ScanNotFoundError) {
          res.status(404).json({ error: { code: 'scan_not_found', message: error.message } })
          return
        }
        next(error)
      }
    },
  )

  /** Reconnect discovery (F12) — a SERVER fact, not a localStorage trick. */
  router.get('/transfer-jobs/active', auth, async (req, res) => {
    const job = await prisma.transferJob.findFirst({
      where: { accountId: req.auth!.accountId, status: { in: NON_TERMINAL } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!job) {
      res.status(204).end()
      return
    }
    res.json({ jobId: job.id })
  })

  router.get('/transfer-jobs/:id/status', auth, async (req, res) => {
    const job = await prisma.transferJob.findUnique({
      where: { id: param(req.params.id) },
      include: { scan: true },
    })
    if (!job || job.accountId !== req.auth!.accountId) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such transfer job.' } })
      return
    }

    const counts = await countOutcomes(prisma, job.id)
    const current = await prisma.transferJobItem.findFirst({
      where: { jobId: job.id, outcome: { not: 'pending' } },
      orderBy: { createdOrder: 'desc' },
      select: { title: true, outcome: true, skipReason: true },
    })

    const payload: TransferJobStatus = {
      jobId: job.id,
      status: job.status as JobStatus,
      sourceCourseName: job.scan.sourceCourseName,
      targetCourseName: job.scan.targetCourseName,
      targetCourseId: job.scan.targetCourseId,
      totalItems: counts.totalItems,
      totalPostsScanned: job.scan.totalPostsScanned,
      pending: counts.pending,
      transferred: counts.transferred,
      fallbackShell: counts.fallbackShell,
      skippedTotal: counts.skippedTotal,
      skippedByUser: counts.skippedByUser,
      skippedBySystem: counts.skippedBySystem,
      skippedDuplicate: counts.skippedDuplicate,
      // Kept as the SUM of the two counters below, not as a third stored
      // column: one measurement, several readers, the same anti-drift rule the
      // outcome counts follow.
      topicsCreatedOrMapped: job.topicsCreatedCount + job.topicsReusedCount,
      topicsCreatedCount: job.topicsCreatedCount,
      topicsReusedCount: job.topicsReusedCount,
      // Decision F — DERIVED. The client needs to know whether to offer the
      // reconnect; the moment the token died is server-side bookkeeping.
      googleReauthRequired: job.googleReauthRequiredAt != null,
      rubricNotesAdded: counts.rubricNotesAdded,
      currentItem: current
        ? {
            title: current.title,
            outcome: current.outcome as Outcome,
            skipReason: (current.skipReason as SkipReason | null) ?? null,
          }
        : null,
      rateLimitPause: job.rateLimitPause
        ? (JSON.parse(job.rateLimitPause) as TransferJobStatus['rateLimitPause'])
        : null,
      cancelRequested: job.cancelRequested,
      cancelledAt: job.cancelledAt?.toISOString() ?? null,
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    }
    res.json(payload)
  })

  /**
   * POST /transfer-jobs/:id/cancel — the mid-transfer Cancel control.
   *
   * Sets the flag; never writes to `TransferJobItem` rows itself (the
   * executor is the only writer of those while it holds the lease). Idempotent
   * while the job is non-terminal (200 every time); refused with 409 once the
   * job has already finished — there is nothing left to drain.
   */
  router.post('/transfer-jobs/:id/cancel', auth, async (req, res, next) => {
    try {
      const { jobId } = await requestJobCancellation(prisma, {
        jobId: param(req.params.id),
        accountId: req.auth!.accountId,
      })
      res.status(200).json({ jobId, cancelRequested: true })
    } catch (error) {
      if (error instanceof JobAlreadyFinishedError) {
        res.status(409).json({
          error: {
            code: 'job_already_finished',
            message: 'This transfer has already finished; there is nothing left to cancel.',
          },
        })
        return
      }
      if (error instanceof JobNotFoundError) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such transfer job.' } })
        return
      }
      next(error)
    }
  })

  /** Fetched ONCE at completion — the aria-live throttling requirement is
   *  satisfied by the protocol shape, not only by client debounce discipline. */
  router.get('/transfer-jobs/:id/items', auth, async (req, res) => {
    const job = await prisma.transferJob.findUnique({ where: { id: param(req.params.id) } })
    if (!job || job.accountId !== req.auth!.accountId) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such transfer job.' } })
      return
    }
    // APPLY-H — a closed vocabulary crossing the application boundary is parsed,
    // not forwarded. Prisma parameterises, so this was never injectable; it was
    // an unparsed enum in a codebase whose stated discipline is that zod is the
    // boundary.
    let filter: Outcome | undefined
    if (typeof req.query.outcome === 'string') {
      const parsedOutcome = OutcomeSchema.safeParse(req.query.outcome)
      if (!parsedOutcome.success) {
        res.status(400).json({
          error: { code: 'bad_request', message: `Unknown outcome filter '${req.query.outcome}'.` },
        })
        return
      }
      filter = parsedOutcome.data
    }

    const rows = await prisma.transferJobItem.findMany({
      where: { jobId: job.id, ...(filter ? { outcome: filter } : {}) },
      orderBy: { createdOrder: 'asc' },
    })

    // APPLY-E / APPLY-B — rendered from the IMMUTABLE RECORD on the item row,
    // copied at scan time. This used to re-read `prisma.mockCourseWork` for
    // data the item already persisted, so a post deleted from the source after
    // the transfer lost its workType and a Question was relabelled "Assignment"
    // in the completion log — the two-measurements bug, inside the very ledger
    // this run is about — and it reached around the type-only port to do it.
    const items: TransferJobItemRow[] = rows.map((row) => {
      let answerConfig: { type: string; choices?: string[] } | null = null
      if (row.answerConfig) {
        try {
          answerConfig = JSON.parse(row.answerConfig) as { type: string; choices?: string[] }
        } catch {
          answerConfig = null
        }
      }
      const workType = (row.workType as WorkType | null) ?? null
      const skipReason = (row.skipReason as SkipReason | null) ?? null
      return {
        id: row.id,
        title: row.title,
        sourceType: row.sourceType as SourceType,
        workType,
        typeLabel: typeLabel(row.sourceType as SourceType, workType),
        topicName: row.topicName,
        outcome: row.outcome as Outcome,
        skipReason,
        // Decision G — three-way, duplicate FIRST, mirroring countOutcomes'
        // own ordering. The previous two-way version's bare `else` is what put
        // duplicates in the system bucket.
        skippedBy:
          row.outcome !== 'skipped'
            ? null
            : isDuplicateSkip(skipReason)
              ? 'duplicate'
              : isUserSkip(skipReason)
                ? 'user'
                : 'system',
        typeSpecific: typeSpecificFor(
          row.sourceType as SourceType,
          workType,
          row.maxPoints,
          answerConfig,
        ),
        note: row.note,
        rubricDegraded: row.rubricDegraded,
        attemptCount: row.attemptCount,
        targetPostId: row.targetPostId,
      }
    })

    res.json({ jobId: job.id, items })
  })

  return router
}
