/**
 * transfer-engine — the batch transfer orchestrator.
 *
 * This module carries the run's core promise, so the things that make it hold
 * are stated up front:
 *
 *  1. **The outcome function is TOTAL (D12).** Every per-item execution is
 *     wrapped in try/catch whose catch resolves the item to a terminal outcome.
 *     Before this, only `RateLimitError` had a declared exit from `pending` —
 *     `PermissionError`, `NotFoundError` and any unexpected exception left the
 *     item `pending` forever, so the three terminal buckets summed to LESS than
 *     count(items) and the "guarantee" was prose.
 *  2. **The outcome function is also HONEST (D32, P0-1).** Totality alone made
 *     things worse: the catch was unconditional, so it fired *after* a
 *     successful create and rewrote a real post into `skipped`/`provider_error`
 *     with `targetPostId` nulled and a note reading "Nothing was written to the
 *     target course". Two mechanisms now make that unrepresentable rather than
 *     merely unintended:
 *       - `claimedTargetPostId` is written IMMEDIATELY after `issueCreate`
 *         returns and before anything else can throw, so the catch has evidence
 *         the job itself owns; and
 *       - `finish()` carries an optimistic `outcome: 'pending'` predicate, so
 *         overwriting an already-terminal outcome is not expressible.
 *  3. **A sweep before `completed`.** No job reaches `completed` with a pending
 *     item; if one survives the loop, it is resolved and logged at ERROR.
 *  4. **The executor's top level catches** and marks the job `failed` —
 *     previously a status nothing in the system ever assigned.
 *  5. **The executor holds a LEASE (D33, P0-2).** `execute()` claims the job
 *     with a fresh `executorId` and every subsequent executor write is
 *     `updateMany where {id, executorId}`. The reconciler claims a stale job by
 *     nulling that column, so a displaced executor's next write affects zero
 *     rows and it aborts. Before this, staleness was the reconciler's only
 *     predicate: it could rewrite a live executor's items and null
 *     `activeAccountId` mid-run, releasing the single-active-job guard and
 *     admitting a second executor into the same target course.
 *
 * And on the fallback path: the rate-limit-exhaustion shell is a DIFFERENT CALL
 * with a DIFFERENT PAYLOAD (bare, no materials[]). Re-issuing the same failing
 * create is why the "guaranteed" shell was unreachable.
 */
import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  NON_TERMINAL_JOB_STATUSES,
  isTerminalJobStatus,
  type JobStatus,
  type Resolution,
  type SkipReason,
} from '@classroom-copier/shared'
import type { ClassroomProvider } from '../adapters/classroom-provider.interface.js'
import { runForAccount } from '../adapters/acting-account.js'
import { config } from '../config.js'
import {
  AttachmentNotVisibleError,
  AuthExpiredError,
  LicenseBlockedError,
  PermissionError,
  RateLimitError,
  TransientError,
  type CourseWorkPayload,
  type Material,
  type ProviderAttachment,
} from '../adapters/types.js'
import { logger } from '../logger.js'
import { DEFAULT_BACKOFF, MAX_ATTEMPTS, backoffDelayMs, type BackoffPolicy } from './backoff.js'
import {
  OVERFLOW_LINKS_HEADER,
  attachmentFallbackNote,
  attachmentNotVisibleNote,
  attachmentOverflowNote,
  cancelledByUserNote,
  duplicateSkipNote,
  postCreatedFollowUpFailedNote,
  rateLimitExhaustionNote,
  rubricDegradedNote,
  shareModeUnknownNote,
} from './notes.js'
import { enumeratePosts, type EnumeratedPost } from './post-enumerator.js'
import { countOutcomes } from './reconciliation.js'
import { buildPostResolutions, type PostResolutions, type ResolvedFinding } from './resolutions.js'

export const ATTACHMENT_CAP = 20

/** D5 — the single-active-job guard refused a second job for this account. */
export class ActiveJobConflictError extends Error {
  constructor(readonly existingJobId: string) {
    super(`Account already has a non-terminal transfer job (${existingJobId})`)
    this.name = 'ActiveJobConflictError'
  }
}

export class ScanNotFoundError extends Error {}

/**
 * APPLY-C — a scan has already produced a job. `TransferJob.scanId` is `@unique`,
 * so replaying a scan (back button, then confirm again) is refused by the
 * database rather than quietly copying every post a second time.
 */
export class ScanAlreadyUsedError extends Error {
  constructor(readonly existingJobId: string) {
    super(`Pre-flight scan already produced transfer job ${existingJobId}`)
    this.name = 'ScanAlreadyUsedError'
  }
}

/**
 * APPLY-I — the scan is a SNAPSHOT. A post added to the source after the scan is
 * correctly excluded from the job; staying silent about that in a product whose
 * thesis is "we never lie about what happened" is the gap. An old scan is
 * refused so the teacher re-scans instead of being told "N of N" about an N
 * measured an hour ago.
 */
export class ScanStaleError extends Error {
  constructor(readonly scannedAt: Date) {
    super(`Pre-flight scan from ${scannedAt.toISOString()} is too old to transfer`)
    this.name = 'ScanStaleError'
  }
}

/**
 * P0-2 — raised when an executor discovers the reconciler has taken its job.
 * It is NOT a failure of the transfer: the reconciler now owns the job's
 * terminal state, so the executor must stop writing rather than race it.
 */
export class ExecutorLeaseLostError extends Error {
  constructor(readonly jobId: string) {
    super(`Executor lease for job ${jobId} was released; the reconciler owns it now`)
    this.name = 'ExecutorLeaseLostError'
  }
}

/** Cancel on a job that has already reached a terminal status — 409 at the route. */
export class JobAlreadyFinishedError extends Error {
  constructor(readonly jobId: string) {
    super(`Transfer job ${jobId} has already finished`)
    this.name = 'JobAlreadyFinishedError'
  }
}

/** Cancel for a job id this account does not own (or that does not exist) — 404. */
export class JobNotFoundError extends Error {}

/**
 * The mid-transfer Cancel control — a FLAG the executor reads BETWEEN items,
 * never an external write to `TransferJobItem` rows while the executor holds
 * the lease (P0-2's lease discipline is otherwise untouched: this function
 * only ever touches the `TransferJob` row).
 *
 * Idempotent while the job is non-terminal: a second call while the job is
 * still `queued`/`running` re-affirms the same flag rather than erroring, and
 * `cancelRequestedAt` keeps the FIRST request's timestamp. A job that has
 * already reached a terminal status refuses with `JobAlreadyFinishedError` —
 * there is nothing left for the executor to drain.
 */
export async function requestJobCancellation(
  prisma: PrismaClient,
  input: { jobId: string; accountId: string; now?: Date },
): Promise<{ jobId: string }> {
  const job = await prisma.transferJob.findUnique({ where: { id: input.jobId } })
  if (!job || job.accountId !== input.accountId) {
    throw new JobNotFoundError(`Transfer job ${input.jobId} not found for this account`)
  }
  if (isTerminalJobStatus(job.status as JobStatus)) {
    throw new JobAlreadyFinishedError(job.id)
  }

  // A conditional updateMany, the same P0-2-style guard as everywhere else in
  // this file: if the job raced to a terminal status between the read above
  // and this write, the flag is never set on a job nothing will ever drain.
  const result = await prisma.transferJob.updateMany({
    where: { id: job.id, status: { in: [...NON_TERMINAL_JOB_STATUSES] } },
    data: {
      cancelRequested: true,
      cancelRequestedAt: job.cancelRequestedAt ?? (input.now ?? new Date()),
    },
  })
  if (result.count === 0) throw new JobAlreadyFinishedError(job.id)

  logger.jobEvent('cancel_requested', { jobId: job.id, accountId: input.accountId })
  return { jobId: job.id }
}

/** The default freshness window for a pre-flight scan (APPLY-I). */
export const DEFAULT_SCAN_TTL_MS = 10 * 60 * 1000

/**
 * D11 — job creation, in one place.
 *
 * Items are inserted **from the stored `PreflightScanItem` rows**, in the same
 * transaction, before any provider call. They are never produced by a fresh
 * re-enumeration of the source course. That is the whole mechanism behind
 * `count(items) == scan.totalPostsScanned`: one measurement, two readers. The
 * previous design ran two independent scans in two separate requests and called
 * their equality definitional.
 *
 * D5 — the single-active-job guard is the `activeAccountId` partial unique
 * index. A conflict surfaces as `409 {jobId}` rather than a hard error, so an
 * accidental double-submit self-heals into "attach to the job already running".
 */
export async function createTransferJob(
  prisma: PrismaClient,
  input: {
    accountId: string
    scanId: string
    resolutions: Resolution[]
    /** APPLY-I. Pass `null` to disable the freshness check (tests, tooling). */
    scanTtlMs?: number | null
    now?: Date
  },
): Promise<{ jobId: string }> {
  const scan = await prisma.preflightScan.findUnique({
    where: { id: input.scanId },
    include: { items: { orderBy: { createdOrder: 'asc' } } },
  })
  if (!scan || scan.accountId !== input.accountId) {
    throw new ScanNotFoundError(`Pre-flight scan ${input.scanId} not found for this account`)
  }

  const ttl = input.scanTtlMs === undefined ? DEFAULT_SCAN_TTL_MS : input.scanTtlMs
  if (ttl != null) {
    const age = (input.now ?? new Date()).getTime() - scan.scannedAt.getTime()
    if (age > ttl) throw new ScanStaleError(scan.scannedAt)
  }

  // APPLY-C — a consumed scan is a fast-path read; the @unique index below is
  // the real guard.
  const replay = await prisma.transferJob.findUnique({
    where: { scanId: scan.id },
    select: { id: true },
  })
  if (replay) throw new ScanAlreadyUsedError(replay.id)

  const existing = await prisma.transferJob.findFirst({
    where: { accountId: input.accountId, status: { in: ['queued', 'running'] } },
    select: { id: true },
  })
  if (existing) throw new ActiveJobConflictError(existing.id)

  const jobId = `job-${randomUUID()}`
  try {
    await prisma.$transaction([
      prisma.transferJob.create({
        data: {
          id: jobId,
          accountId: input.accountId,
          scanId: scan.id,
          status: 'queued',
          resolutionsJson: JSON.stringify(input.resolutions),
          activeAccountId: input.accountId,
          // Decision D — the topic-reuse map is COPIED from the scan, so the
          // transfer files into exactly the destination topics the teacher was
          // shown at pre-flight rather than re-resolving names mid-run against
          // a destination a co-teacher may have edited since.
          topicReuseJson: scan.topicReuseJson,
        },
      }),
      prisma.transferJobItem.createMany({
        data: scan.items.map((item) => {
          // Decision C/G — a duplicate is PRE-RESOLVED here, terminal before
          // the job starts, and therefore never selected by `execute()`'s
          // `outcome: 'pending'` item query. It is not a runtime check inside
          // the item loop: an item that never enters the loop cannot be created
          // by a bug in the loop.
          const isDuplicate = item.duplicateOfTitle != null
          return {
            id: `${jobId}-i${item.createdOrder}`,
            jobId,
            scanItemId: item.id,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            title: item.title,
            workType: item.workType,
            // APPLY-E — the per-type fields travel with the item, so the
            // itemized log renders what was copied rather than re-reading a
            // source row that may since have been edited or deleted.
            maxPoints: item.maxPoints,
            answerConfig: item.answerConfig,
            topicName: item.topicName,
            createdOrder: item.createdOrder,
            outcome: isDuplicate ? 'skipped' : 'pending',
            skipReason: isDuplicate ? 'duplicate_title' : null,
            note: isDuplicate
              ? duplicateSkipNote(item.duplicateOfTitle!, item.duplicateOfState)
              : null,
          }
        }),
      }),
    ])
  } catch (error) {
    // Two partial unique indexes are the real guards; the reads above are only
    // fast paths. A concurrent double-submit loses the race here, not silently.
    const replayed = await prisma.transferJob.findUnique({
      where: { scanId: scan.id },
      select: { id: true },
    })
    if (replayed) throw new ScanAlreadyUsedError(replayed.id)
    const conflict = await prisma.transferJob.findFirst({
      where: { accountId: input.accountId, status: { in: ['queued', 'running'] } },
      select: { id: true },
    })
    if (conflict) throw new ActiveJobConflictError(conflict.id)
    throw error
  }

  logger.jobEvent('created', {
    jobId,
    accountId: input.accountId,
    scanId: scan.id,
    items: scan.items.length,
    totalPostsScanned: scan.totalPostsScanned,
  })
  return { jobId }
}

export interface TransferEngineOptions {
  backoff?: BackoffPolicy
  /** Injected so tests do not actually sleep through five real backoffs. */
  sleep?: (ms: number) => Promise<void>
  /**
   * D28/K — the monetization completion hook is an INJECTED CALLBACK, keeping
   * the dependency edge pointing the right way while giving the hook a real
   * code path. It previously existed in one module's prose and in no module's
   * code.
   */
  onJobComplete?: (summary: {
    jobId: string
    accountId: string
    cleanTransfer: boolean
  }) => Promise<void> | void
}

interface ItemRow {
  id: string
  scanItemId: string
  sourceType: string
  sourceId: string
  title: string
  createdOrder: number
  /**
   * §4.3 fix 1 — selected, not merely filtered on. The old query omitted it
   * entirely, which is why nothing in the item loop could tell a fresh item
   * from one this job had already finished.
   */
  outcome: string
  /** D14's crash evidence: written immediately BEFORE the provider call. */
  attemptedAt: Date | null
  /** P0-1's evidence: written immediately AFTER the create returns. */
  claimedTargetPostId: string | null
}

/** P0-2 — the executor's proof that it still owns this job. */
interface Lease {
  jobId: string
  executorId: string
  accountId: string
}

interface CreateContext {
  targetCourseId: string
  description: string | null
  topicId: string | null
  materials: Material[]
  /** APPLY-F — carried so the bare shell keeps them instead of discarding them. */
  notes: string[]
  overflow: ProviderAttachment[]
  baseDescription: string | null
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** `TransferJob.topicMapJson` — Record<sourceTopicId, destinationTopicId>. */
function parseTopicMap(json: string | null): Record<string, string> {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json) as unknown
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  } catch {
    return {}
  }
}

/** `TransferJob.topicReuseJson` — the scan's TopicReuseDisclosure[], indexed. */
function parseTopicReuse(json: string | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!json) return map
  try {
    const parsed = JSON.parse(json) as { sourceTopicId?: unknown; destinationTopicId?: unknown }[]
    if (!Array.isArray(parsed)) return map
    for (const row of parsed) {
      if (typeof row?.sourceTopicId === 'string' && typeof row.destinationTopicId === 'string') {
        map.set(row.sourceTopicId, row.destinationTopicId)
      }
    }
  } catch {
    // A malformed snapshot must not stop a transfer; it only costs topic reuse.
  }
  return map
}

export class TransferEngine {
  private readonly backoff: BackoffPolicy
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: ClassroomProvider,
    private readonly options: TransferEngineOptions = {},
  ) {
    this.backoff = options.backoff ?? DEFAULT_BACKOFF
    this.sleep = options.sleep ?? defaultSleep
  }

  /* ================================================================ *
   * Entry point
   * ================================================================ */

  async run(jobId: string): Promise<void> {
    const holder: { lease: Lease | null } = { lease: null }
    try {
      // F9 — BEFORE the lease claim. A job started on a token with minutes left
      // is a mid-transfer stall waiting to happen; asking for a reconnect now
      // costs one click, asking after item 30 costs a half-finished course.
      if (await this.refuseOnNearExpiredToken(jobId)) return
      await this.execute(jobId, holder)
    } catch (error) {
      if (error instanceof ExecutorLeaseLostError) {
        // Not a failure. The reconciler claimed this job; it owns the terminal
        // state and this executor must stop writing rather than overwrite it.
        logger.warn('executor stood down — the reconciler holds this job', { jobId })
        return
      }
      // D12 part 3 — the executor's top-level catch. Without it a rejected
      // promise chain left the job `running` with a stale heartbeat while the
      // process was still alive: boot reconciliation never fires because there
      // is no boot, and the client polls a frozen counter forever.
      logger.error('transfer-engine executor threw at top level', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      })
      await this.failJob(jobId, holder.lease, error)
    }
  }

  /**
   * Decision F — resume a paused job.
   *
   * It clears `googleReauthRequiredAt` and re-invokes `run(jobId)` — the SAME
   * entry point job creation uses. There is no second execution path to keep in
   * sync, because `execute()` is re-entrant (§4.3 fixes 1–3): it now selects
   * only `outcome: 'pending'` items and resolves the evidence-ambiguous ones
   * without dispatching them.
   *
   * The clear is a conditional `updateMany`, so resuming a job that is not
   * actually paused is a no-op rather than a second executor.
   */
  async resume(jobId: string): Promise<void> {
    const cleared = await this.prisma.transferJob.updateMany({
      where: { id: jobId, googleReauthRequiredAt: { not: null } },
      data: { googleReauthRequiredAt: null, lastHeartbeatAt: new Date() },
    })
    if (cleared.count === 0) {
      logger.warn('resume called on a job that is not waiting for re-auth', { jobId })
      return
    }
    logger.jobEvent('reauth_resumed', { jobId })
    await this.run(jobId)
  }

  /**
   * §8.0/S8 — the OAuth callback's entry point.
   *
   * The job is resolved from the SESSION's account plus the paused-flag, never
   * from a job id in the request: a request-supplied id would let one account
   * resume another account's transfer. Returns the job it resumed, or null.
   */
  async resumeForAccount(accountId: string): Promise<string | null> {
    const paused = await this.prisma.transferJob.findFirst({
      where: { accountId, googleReauthRequiredAt: { not: null }, status: 'running' },
      select: { id: true },
    })
    if (!paused) return null
    await this.resume(paused.id)
    return paused.id
  }

  /**
   * F9 — the pre-start token-lifetime floor.
   *
   * `GoogleAccount.accessTokenExpiresAt` was written by the OAuth callback and
   * read by nothing (§5.1). Read here, before the lease claim, it converts the
   * most common real failure — starting a transfer at the end of a session —
   * from a stall partway through into a reconnect prompt before anything is
   * written.
   *
   * `findUnique` returns null in mock mode, where `accountId` names a
   * MockAccount, so this is inert there rather than mode-aware.
   */
  private async refuseOnNearExpiredToken(jobId: string): Promise<boolean> {
    const job = await this.prisma.transferJob.findUnique({
      where: { id: jobId },
      select: { accountId: true, status: true },
    })
    if (!job || isTerminalJobStatus(job.status as JobStatus)) return false

    const account = await this.prisma.googleAccount.findUnique({
      where: { id: job.accountId },
      select: { accessTokenExpiresAt: true },
    })
    if (!account) return false

    const remainingMs = account.accessTokenExpiresAt.getTime() - Date.now()
    if (remainingMs >= config.googleTokenMinRemainingMs) return false

    await this.prisma.transferJob.updateMany({
      where: { id: jobId, status: { in: ['queued', 'running'] } },
      data: { googleReauthRequiredAt: new Date(), lastHeartbeatAt: new Date() },
    })
    logger.jobEvent('reauth_required', { jobId, reason: 'token_near_expiry', remainingMs })
    return true
  }

  /**
   * Decision F — the pause. A FIELD, not a status.
   *
   * `status` stays `'running'` and `activeAccountId` stays set: that exact pair
   * ('running' + null executorId) is what the lease claim's own WHERE
   * re-matches on resume. `'interrupted'` would be terminal and unresumable,
   * and a new status value would break the partial unique index and `/active`,
   * both of which derive from `status` alone.
   *
   * Remaining pending items are deliberately NOT resolved. They stay pending
   * and durable in the database (driver 10 — no in-process wait), which is what
   * lets the resume pick them up minutes or hours later.
   */
  private async pauseForReauth(lease: Lease, item: ItemRow | null): Promise<void> {
    const paused = await this.prisma.transferJob.updateMany({
      where: { id: lease.jobId, executorId: lease.executorId },
      data: {
        googleReauthRequiredAt: new Date(),
        // ONLY the executor lease is released. activeAccountId stays, so the
        // job remains "the active job" for /active and no second transfer can
        // start underneath the teacher while this one waits.
        executorId: null,
        rateLimitPause: null,
        lastHeartbeatAt: new Date(),
      },
    })
    if (paused.count === 0) throw new ExecutorLeaseLostError(lease.jobId)
    logger.jobEvent('reauth_required', {
      jobId: lease.jobId,
      atItemId: item?.id ?? null,
      atItemTitle: item?.title ?? null,
    })
  }

  private async failJob(jobId: string, lease: Lease | null, error: unknown): Promise<void> {
    try {
      // Claim FIRST. A job the reconciler already resolved must not be reopened
      // and re-terminated by a losing executor.
      const claimed = await this.prisma.transferJob.updateMany({
        where: lease
          ? { id: jobId, executorId: lease.executorId }
          : { id: jobId, status: { in: ['queued', 'running'] } },
        data: {
          status: 'failed',
          activeAccountId: null,
          executorId: null,
          finishedAt: new Date(),
          rateLimitPause: null,
          lastHeartbeatAt: new Date(),
        },
      })
      if (claimed.count === 0) {
        logger.warn('job already terminal; the failure write was refused', { jobId })
        return
      }
      await this.resolveRemainingPending(jobId, 'provider_error', {
        note: `Transfer stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
      })
      logger.jobEvent('failed', { jobId })
    } catch (secondary) {
      logger.error('transfer-engine could not mark the job failed', {
        jobId,
        error: secondary instanceof Error ? secondary.message : String(secondary),
      })
    }
  }

  /* ================================================================ *
   * Execution
   * ================================================================ */

  private async execute(jobId: string, holder: { lease: Lease | null }): Promise<void> {
    const job = await this.prisma.transferJob.findUnique({
      where: { id: jobId },
      include: { scan: true },
    })
    if (!job) throw new Error(`TransferJob ${jobId} not found`)

    // E1 — every provider call below spends the JOB OWNER's credentials. The
    // scope wraps the whole execution, so an adapter bound inside it lives
    // exactly as long as the run does — which is what lets a real adapter
    // remember the course a post it just created belongs to.
    //
    // Entry is deliberately non-throwing: the token is read on FIRST USE inside
    // the scope, so an expired one surfaces from a provider call inside the try
    // below — where F7 turns it into a re-auth pause — instead of from here,
    // outside it, where it would mark the job `failed` with no way back.
    return runForAccount(this.provider, job.accountId, () =>
      this.executeInScope(job, jobId, holder),
    )
  }

  private async executeInScope(
    job: Prisma.TransferJobGetPayload<{ include: { scan: true } }>,
    jobId: string,
    holder: { lease: Lease | null },
  ): Promise<void> {
    // P0-2 — take the lease. `updateMany` with the non-terminal predicate means
    // a job the reconciler has already resolved cannot be re-entered.
    //
    // Two-process lease harness finding — `status: {in: ['queued','running']}`
    // ALONE does not stop two simultaneous executors from both believing they
    // own it, despite the comment above claiming otherwise: 'running' stays in
    // that allowed set after the FIRST claim commits, so a second concurrent
    // claim's WHERE still matches and it silently overwrites `executorId`
    // (proven by `test/lease-mp/executor-lease-two-process.test.ts` racing two
    // real OS processes against one SQLite file — both `updateMany` calls
    // returned `count: 1`). `executorId: null` closes it: only the claim that
    // observes the lease still unheld can take it, so a second concurrent
    // claim's WHERE no longer matches and its `count` is 0.
    const executorId = `exec-${randomUUID()}`
    const claimed = await this.prisma.transferJob.updateMany({
      where: { id: jobId, status: { in: ['queued', 'running'] }, executorId: null },
      data: {
        status: 'running',
        executorId,
        startedAt: job.startedAt ?? new Date(),
        lastHeartbeatAt: new Date(),
      },
    })
    if (claimed.count === 0) throw new ExecutorLeaseLostError(jobId)

    const lease: Lease = { jobId, executorId, accountId: job.accountId }
    holder.lease = lease
    logger.jobEvent('started', { jobId, accountId: job.accountId, executorId })

    const sourceCourseId = job.scan.sourceCourseId
    const targetCourseId = job.scan.targetCourseId

    /* ---------------------------------------------------------------- *
     * F7 — the pre-loop AuthExpiredError.
     *
     * Both calls below run BEFORE the item loop and therefore outside
     * `processItem`'s try. An expired token here used to reach `run()`'s
     * top-level catch and mark the job `failed`: no `googleReauthRequiredAt`,
     * no reconnect banner, no resume — the teacher's only recourse was to start
     * over. And this is a routine path, not an edge case: 7-day expiry is
     * guaranteed, and job start is exactly when a near-expiry token gets spent.
     *
     * The catch is on AuthExpiredError SPECIFICALLY. Every other error keeps
     * its existing path to `failed`. No item is marked, because none was
     * attempted.
     * ---------------------------------------------------------------- */
    let topicMap: Map<string, string>
    const detail = new Map<string, EnumeratedPost>()
    try {
      const topics = await this.buildTopicMap(lease, sourceCourseId, targetCourseId, {
        topicMapJson: job.topicMapJson,
        topicReuseJson: job.topicReuseJson,
      })
      topicMap = topics.map
      await this.heartbeat(lease, {
        topicsCreatedCount: job.topicsCreatedCount + topics.created,
        topicsReusedCount: job.topicsReusedCount + topics.reused,
      })

      // One enumeration hydrates the payload details. It does NOT decide HOW
      // MANY posts there are — the items came from the stored scan rows. A post
      // that has vanished since the scan simply has no detail and resolves to a
      // terminal `skipped`/`provider_error`, which is a real outcome, not a hole.
      //
      // P0-2 — it heartbeats per page. A 50-post enumeration under
      // MOCK_PROVIDER_DELAY_MS used to exceed `jobStaleAfterMs` in total
      // silence, which is precisely how a live executor got mistaken for a dead
      // one.
      const enumerated = await enumeratePosts(this.provider, sourceCourseId, {
        onPage: () => this.heartbeat(lease),
      })
      for (const post of enumerated.posts) {
        detail.set(`${post.sourceType}:${post.sourceId}`, post)
      }
    } catch (error) {
      if (!(error instanceof AuthExpiredError)) throw error
      await this.pauseForReauth(lease, null)
      return
    }

    const findings = this.parseFindings(job.scan.findingsJson)
    const resolutions = this.parseResolutions(job.resolutionsJson)
    const perPost = buildPostResolutions(resolutions, findings)

    /* ---------------------------------------------------------------- *
     * §4.3 fix 1 — THE P0. `execute()` is re-entrant from here.
     *
     * This query used to filter on `jobId` ALONE and did not even select
     * `outcome`. On any second entry — a resume after a token failure, a
     * reconciler hand-back — every already-terminal item fell straight through
     * `processItem` into `transferPost` and created a SECOND REAL POST in the
     * teacher's destination course. `finish()`'s pending-predicate then refused
     * the ledger write, so the reconciliation sum still balanced and the app
     * showed nothing wrong: the corruption was visible only in Google
     * Classroom.
     *
     * The same omission is why duplicate prevention was inert on the FIRST run:
     * an item pre-resolved to `skipped`/`duplicate_title` at job creation was
     * dispatched anyway.
     *
     * `outcome: 'pending'` is therefore load-bearing in two directions at once.
     * ---------------------------------------------------------------- */
    const pendingItems = (await this.prisma.transferJobItem.findMany({
      where: { jobId, outcome: 'pending' },
      orderBy: { createdOrder: 'asc' },
      select: {
        id: true,
        scanItemId: true,
        sourceType: true,
        sourceId: true,
        title: true,
        createdOrder: true,
        outcome: true,
        attemptedAt: true,
        claimedTargetPostId: true,
      },
    })) as ItemRow[]

    /* ---------------------------------------------------------------- *
     * §4.3 fix 3 — the evidence-ambiguous items.
     *
     * `pending` AND `attemptedAt IS NOT NULL` means the previous pass called
     * the provider and never learned the answer. Dispatching it again would
     * re-issue the create and — worse — re-run `copyAttachmentToMyDrive`,
     * making a second copy of the teacher's Drive file. It is resolved from the
     * evidence the job itself owns, through the same branch
     * `recordItemFailure` already implements, and never dispatched.
     * ---------------------------------------------------------------- */
    const items: ItemRow[] = []
    for (const item of pendingItems) {
      if (item.attemptedAt == null) {
        items.push(item)
        continue
      }
      await this.resolveFromEvidence(item)
    }

    // The mid-transfer Cancel control — checked BETWEEN items, never inside
    // one. The in-flight item (already dispatched by the PREVIOUS iteration)
    // always finishes naturally: a provider create cannot be un-asked. This
    // check only decides whether the NEXT item dispatches, so once it is
    // seen, no new item ever does.
    let cancelledMidRun = false
    for (const item of items) {
      const cancelState = await this.prisma.transferJob.findUnique({
        where: { id: jobId },
        select: { cancelRequested: true },
      })
      if (cancelState?.cancelRequested) {
        cancelledMidRun = true
        break
      }
      const post = detail.get(`${item.sourceType}:${item.sourceId}`)
      const postResolution = perPost.get(item.scanItemId) ?? null
      try {
        await this.processItem(lease, targetCourseId, item, post, postResolution, topicMap)
      } catch (error) {
        // Decision F — the CREDENTIAL died, not this post. `processItem` has
        // already resolved the triggering item: terminal if it was attempted,
        // left `pending` for this pause to own if it was not (F1). Either way
        // the job pauses rather than burning its remaining items against a
        // token that will refuse every one of them.
        if (!(error instanceof AuthExpiredError)) throw error
        await this.pauseForReauth(lease, item)
        return
      }
      await this.heartbeat(lease)
    }

    // The teacher's own choice — drain what never dispatched as an honest
    // `skipped`/`cancelled_by_user`, the SAME bucket the totality invariant
    // already accounts for. Every already-created draft stays exactly as it
    // is: cancel never touches an item this job has already terminated.
    let cancelledAt: Date | null = null
    if (cancelledMidRun) {
      const drained = await this.resolveRemainingPending(jobId, 'cancelled_by_user', {
        note: cancelledByUserNote(),
      })
      cancelledAt = new Date()
      logger.jobEvent('cancelled', { jobId, drained })
    }

    // D12 part 2 — the sweep. This is the last line of defence that makes the
    // invariant hold for real rather than only where every branch remembered.
    // (After a cancel-drain above, this finds nothing left to do.)
    const swept = await this.resolveRemainingPending(jobId, 'provider_error', {
      note: 'Resolved by the completion sweep — no branch recorded an outcome for this item.',
    })
    if (swept > 0) {
      logger.jobEvent('swept_pending', { jobId, swept })
    }

    const counts = await countOutcomes(this.prisma, jobId)
    const finished = await this.prisma.transferJob.updateMany({
      where: { id: jobId, executorId },
      data: {
        // NOT 'failed', and no new status: cancel is 'completed' with
        // `cancelledAt` set, so the single-active-job guard, `/active`, and
        // the reconciler all keep deriving from `status` alone.
        status: 'completed',
        // Releasing the partial unique index is what lets the account start
        // another transfer.
        activeAccountId: null,
        executorId: null,
        finishedAt: new Date(),
        rateLimitPause: null,
        lastHeartbeatAt: new Date(),
        ...(cancelledAt ? { cancelledAt } : {}),
      },
    })
    if (finished.count === 0) throw new ExecutorLeaseLostError(jobId)
    logger.jobEvent('completed', { jobId, ...counts })

    const cleanTransfer =
      counts.fallbackShell === 0 && counts.skippedTotal === 0 && counts.rubricNotesAdded === 0
    await this.options.onJobComplete?.({ jobId, accountId: job.accountId, cleanTransfer })
  }

  /* ---------------------------------------------------------------- */

  /**
   * P0-2 — every executor write to the job row goes through here, and every one
   * of them is a lease check. Zero affected rows means the reconciler took the
   * job, and continuing would mean two writers on one ledger.
   */
  private async heartbeat(
    lease: Lease,
    data: {
      topicsCreatedCount?: number
      topicsReusedCount?: number
      topicMapJson?: string
      rateLimitPause?: string | null
    } = {},
  ): Promise<void> {
    const result = await this.prisma.transferJob.updateMany({
      where: { id: lease.jobId, executorId: lease.executorId },
      data: { ...data, lastHeartbeatAt: new Date() },
    })
    if (result.count === 0) throw new ExecutorLeaseLostError(lease.jobId)
  }

  private parseFindings(findingsJson: string): ResolvedFinding[] {
    try {
      const raw = JSON.parse(findingsJson) as {
        id: string
        scanItemId: string
        attachmentId: string
        attachmentName: string
      }[]
      return raw.map((f) => ({
        findingId: f.id,
        scanItemId: f.scanItemId,
        attachmentId: f.attachmentId,
        attachmentName: f.attachmentName,
      }))
    } catch {
      return []
    }
  }

  /** Read back from the job row — persisted at creation, so a restart applies
   *  the same decisions rather than silently transferring without them. */
  private parseResolutions(resolutionsJson: string): Resolution[] {
    try {
      return JSON.parse(resolutionsJson) as Resolution[]
    } catch {
      return []
    }
  }

  /**
   * §4.3 fix 3 — resolve a `pending` item that was ALREADY ATTEMPTED, from the
   * evidence this job wrote about it, without touching the provider.
   *
   * `claimedTargetPostId` is written immediately after `issueCreate` returns
   * and before anything else can throw, so its presence is proof a post exists
   * in the destination course. Absence, with `attemptedAt` set, means the
   * process died between writing `attemptedAt` and getting an answer — no
   * evidence of a write, so the honest outcome is `server_interrupted`.
   *
   * Either way the item is terminal without a single provider call, which is
   * what stops a resumed job re-creating a post or re-copying a Drive file.
   */
  private async resolveFromEvidence(item: ItemRow): Promise<void> {
    if (item.claimedTargetPostId) {
      await this.finish(item.id, {
        outcome: 'transferred',
        skipReason: null,
        note: 'This post was created before the transfer was interrupted; it was already in the destination course when we resumed.',
        targetPostId: item.claimedTargetPostId,
        resolutionKind: null,
      })
      return
    }
    await this.finish(item.id, {
      outcome: 'skipped',
      skipReason: 'server_interrupted',
      note: 'The transfer was interrupted while this post was being copied, and we could not confirm it was created. Nothing was recorded for it.',
      resolutionKind: null,
    })
  }

  /**
   * §4.3 fix 2 — the topic map, made durable.
   *
   * This used to call `createTopic` unconditionally for every source topic on
   * every entry, so a resumed job created a second copy of every topic it had
   * already made. `topicReuseJson` cannot fix that on its own: it is a
   * pre-flight snapshot of the DESTINATION, blind to the topics pass 1 created
   * itself. So the map is seeded from two places, in precedence order:
   *
   *   1. `topicMapJson` — what THIS job already resolved. Never re-created,
   *      never re-counted: a re-entry is not work.
   *   2. `topicReuseJson` — a destination topic the teacher was shown at
   *      pre-flight. Reused, and counted as reused.
   *
   * and only what neither covers is created. The updated map is persisted in
   * the SAME lease-checked update as the existing per-topic heartbeat, so a
   * crash mid-loop loses at most the topic it was in the middle of.
   */
  private async buildTopicMap(
    lease: Lease,
    sourceCourseId: string,
    targetCourseId: string,
    persisted: { topicMapJson: string | null; topicReuseJson: string | null },
  ): Promise<{ map: Map<string, string>; created: number; reused: number }> {
    const map = new Map<string, string>(Object.entries(parseTopicMap(persisted.topicMapJson)))
    const alreadyMapped = new Set(map.keys())
    const reuseBySourceTopicId = parseTopicReuse(persisted.topicReuseJson)

    let created = 0
    let reused = 0
    const allTopics: { id: string; name: string }[] = []
    let pageToken: string | null = null
    do {
      const page = await this.provider.listTopics(sourceCourseId, { pageToken })
      await this.heartbeat(lease)
      for (const topic of page.items) allTopics.push({ id: topic.id, name: topic.name })
      pageToken = page.nextPageToken
    } while (pageToken != null)

    // Google's Topics API returns topics newest-first, but Classroom displays
    // them oldest-first. Reverse so the target course matches the source's
    // visible order rather than its API order.
    allTopics.reverse()

    for (const topic of allTopics) {
        if (alreadyMapped.has(topic.id)) continue

        const reuseTarget = reuseBySourceTopicId.get(topic.id)
        if (reuseTarget) {
          map.set(topic.id, reuseTarget)
          reused += 1
        } else {
          const createdTopic = await this.provider.createTopic(targetCourseId, topic.name)
          map.set(topic.id, createdTopic.topicId)
          created += 1
        }

        // P0-2 — a course with many topics used to create every one of them in
        // total silence, which is long enough to look dead. The map now rides
        // along on that same write, so it is durable per topic rather than only
        // at the end of the loop.
      await this.heartbeat(lease, { topicMapJson: JSON.stringify(Object.fromEntries(map)) })
    }

    return { map, created, reused }
  }

  /* ---------------------------------------------------------------- *
   * Per-item execution — the total AND honest outcome function (D12/D32)
   * ---------------------------------------------------------------- */

  private async processItem(
    lease: Lease,
    targetCourseId: string,
    item: ItemRow,
    post: EnumeratedPost | undefined,
    resolution: PostResolutions | null,
    topicMap: Map<string, string>,
  ): Promise<void> {
    try {
      if (resolution?.skipsPost) {
        await this.finish(item.id, {
          outcome: 'skipped',
          skipReason: resolution.skipReason ?? 'user_skip_post',
          note: `Skipped by you — you chose to skip this post after its attachment could not be linked.`,
          resolutionKind: resolution.kinds[0] ?? null,
        })
        return
      }

      if (!post) {
        // Present at scan time, absent now. A real terminal outcome, recorded
        // honestly rather than left pending.
        await this.finish(item.id, {
          outcome: 'skipped',
          skipReason: 'provider_error',
          note: 'This post no longer exists in the source course — it was removed after the pre-flight scan.',
          resolutionKind: null,
        })
        return
      }

      await this.transferPost(lease, targetCourseId, item, post, resolution, topicMap)
    } catch (error) {
      // A lost lease is not an item outcome — it means this executor must stop.
      if (error instanceof ExecutorLeaseLostError) throw error

      // THE catch that makes the outcome function total. PermissionError,
      // NotFoundError, a Prisma SQLITE_BUSY, a null deref in the payload
      // builder — all of them land here and all of them terminate the item.
      logger.error('transfer-engine item failed with an unhandled error', {
        jobId: lease.jobId,
        itemId: item.id,
        title: item.title,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      })
      // F1 — Decision F's premise, "the item WAS attempted", is not always
      // true. `copyAttachmentToMyDrive` runs BEFORE `createWithBackoff`, so a
      // token that expires during attachment preparation arrives here with
      // `attemptedAt` still null and nothing written to Drive or the target.
      // Marking that item terminal LOSES the post: `resume()` dispatches
      // `pending` items only, so it would never be retried — and because
      // `skipped`/`provider_error` is a legitimate bucket, the reconciliation
      // sum still balances and the ledger reads as an honest skip. Third of
      // this family, and the only one with no witness at all.
      //
      // So an unattempted item stays `pending` and the error is rethrown for
      // the pause path to own. The cost is that a partially-completed
      // attachment prep re-copies the Drive files it already copied on resume;
      // a duplicated Drive copy is recoverable, a silently dropped post is not.
      if (error instanceof AuthExpiredError && (await this.nothingWasAttempted(item))) throw error

      await this.recordItemFailure(item, error)

      // Decision F — rethrown AFTER the item is terminal, so `execute()` can
      // pause the job. Everything else stays exactly where it was: a total
      // outcome function that swallows the error and moves on.
      if (error instanceof AuthExpiredError) throw error
    }
  }

  /**
   * Evidence that this item reached NO provider write: still pending, never
   * stamped `attemptedAt`, and with neither a claimed nor a recorded target
   * post. Read from the row rather than from local state, for the same reason
   * `recordItemFailure` does — the row is what `resume()` will read.
   */
  private async nothingWasAttempted(item: ItemRow): Promise<boolean> {
    const current = await this.prisma.transferJobItem.findUnique({
      where: { id: item.id },
      select: {
        outcome: true,
        attemptedAt: true,
        targetPostId: true,
        claimedTargetPostId: true,
      },
    })
    return (
      current != null &&
      current.outcome === 'pending' &&
      current.attemptedAt == null &&
      current.targetPostId == null &&
      current.claimedTargetPostId == null
    )
  }

  /**
   * P0-1 — the evidence-aware half of the total outcome function.
   *
   * The unconditional version of this clause is what re-opened prior-P0-5: it
   * fired for a throw anywhere inside `transferPost`, INCLUDING after the
   * provider create had already succeeded, and told the teacher nothing was
   * written to a course that now contains the post. Three reachable post-create
   * throws did exactly that. So: read the evidence first, and never claim
   * "nothing was written" about a post this job knows it created.
   */
  private async recordItemFailure(item: ItemRow, error: unknown): Promise<void> {
    const detail = error instanceof Error ? error.message : 'Unknown provider error'
    const current = await this.prisma.transferJobItem.findUnique({
      where: { id: item.id },
      select: {
        outcome: true,
        note: true,
        targetPostId: true,
        claimedTargetPostId: true,
        attemptCount: true,
      },
    })

    if (current && current.outcome !== 'pending') {
      // Already terminal, and that outcome was recorded on evidence. Append the
      // late failure; never re-bucket.
      const suffix = postCreatedFollowUpFailedNote(detail)
      await this.prisma.transferJobItem.update({
        where: { id: item.id },
        data: { note: current.note ? `${current.note} ${suffix}` : suffix },
      })
      logger.warn('a terminal item saw a late failure; note appended, outcome preserved', {
        itemId: item.id,
        outcome: current.outcome,
        detail,
      })
      return
    }

    const created = current?.claimedTargetPostId ?? current?.targetPostId ?? null
    if (created) {
      await this.finish(item.id, {
        outcome: 'transferred',
        skipReason: null,
        note: postCreatedFollowUpFailedNote(detail),
        targetPostId: created,
        resolutionKind: null,
      })
      return
    }

    await this.finish(item.id, {
      outcome: 'skipped',
      skipReason: 'provider_error',
      note: `Could not be copied (${detail}). Nothing was written to the target course for this post.`,
      resolutionKind: null,
    })
  }

  private buildMaterials(
    attachments: ProviderAttachment[],
    drop: Set<string>,
    copiedDriveFileIds: Map<string, string>,
  ): {
    materials: Material[]
    overflow: ProviderAttachment[]
    /** APPLY-A — driveFiles whose shareMode could not be read. */
    unlinkable: ProviderAttachment[]
  } {
    // D22 — ordered by sortOrder, so WHICH 20 survive the cap is a total order.
    const usable = [...attachments]
      .filter((a) => !drop.has(a.id))
      .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1))

    const linked = usable.slice(0, ATTACHMENT_CAP)
    const overflow = usable.slice(ATTACHMENT_CAP)

    const materials: Material[] = []
    const unlinkable: ProviderAttachment[] = []
    for (const a of linked) {
      switch (a.kind) {
        case 'driveFile': {
          // APPLY-A — the brief's binding rule is "preserve each attachment's
          // shareMode … NEVER default to VIEW". `?? 'VIEW'` was that exact
          // substitution, under a comment asserting it could not happen. A null
          // shareMode is now a finding: the file is left unlinked and named in
          // a note, because re-sharing someone's file on a guess is worse than
          // telling the teacher we could not read the setting.
          if (a.shareMode == null) {
            unlinkable.push(a)
            break
          }
          materials.push({
            kind: 'driveFile',
            // P0-3 — the id of the COPY when Copy-to-My-Drive ran, otherwise the
            // source's own file id. The mock no longer rewrites the source row,
            // so this substitution is the only way the copy reaches the payload.
            driveFileId: copiedDriveFileIds.get(a.id) ?? a.driveFileId ?? a.id,
            title: a.title,
            shareMode: a.shareMode,
          })
          break
        }
        case 'youTubeVideo':
          materials.push({
            kind: 'youTubeVideo',
            videoId: a.url
              ? new URL(a.url).searchParams.get('v') ?? a.id
              : a.id,
            title: a.title,
          })
          break
        case 'form':
          if (a.url) materials.push({ kind: 'link', url: a.url, title: a.title })
          break
        default:
          materials.push({ kind: 'link', url: a.url ?? '', title: a.title })
      }
    }
    return { materials, overflow, unlinkable }
  }

  private composeDescription(
    base: string | null,
    parts: { overflow: ProviderAttachment[]; notes: string[] },
  ): string | null {
    const sections: string[] = []
    if (base) sections.push(base)
    if (parts.overflow.length > 0) {
      sections.push(
        [
          OVERFLOW_LINKS_HEADER,
          ...parts.overflow.map((a) => `- ${a.title}: ${a.url ?? a.driveFileId ?? ''}`),
        ].join('\n'),
      )
    }
    for (const note of parts.notes) sections.push(note)
    return sections.length > 0 ? sections.join('\n\n') : null
  }

  private async transferPost(
    lease: Lease,
    targetCourseId: string,
    item: ItemRow,
    post: EnumeratedPost,
    resolution: PostResolutions | null,
    topicMap: Map<string, string>,
  ): Promise<void> {
    const drop = resolution?.dropAttachmentIds ?? new Set<string>()

    // Scenario 3, "Copy to My Drive": become the owner BEFORE linking.
    //
    // P0-3 — the returned id is CONSUMED. The mock used to satisfy this contract
    // by rewriting the SOURCE course's attachment row in place — a move, not a
    // copy — and the engine depended on the mutation by re-reading the same
    // source rows afterwards. A faithful adapter (`drive.files.copy` → a new
    // file id, source untouched) would have returned into a caller that ignored
    // it, and the created post would have linked the still-locked original.
    const copiedDriveFileIds = new Map<string, string>()
    for (const attachmentId of resolution?.copyToMyDriveIds ?? []) {
      const { newDriveFileId } = await this.provider.copyAttachmentToMyDrive(
        { id: attachmentId, parentType: post.sourceType, parentId: post.sourceId },
        lease.accountId,
      )
      copiedDriveFileIds.set(attachmentId, newDriveFileId)
    }

    const { materials, overflow, unlinkable } = this.buildMaterials(
      post.attachments,
      drop,
      copiedDriveFileIds,
    )

    const notes: string[] = []
    for (const name of resolution?.notedAttachmentNames ?? []) {
      notes.push(attachmentFallbackNote(name))
    }
    for (const attachment of unlinkable) {
      notes.push(shareModeUnknownNote(attachment.title))
    }
    const overflowNote = overflow.length > 0 ? attachmentOverflowNote(overflow.length) : null
    if (overflowNote) notes.push(overflowNote)

    const description = this.composeDescription(post.description, { overflow, notes })
    const topicId = post.topicId ? (topicMap.get(post.topicId) ?? null) : null

    const declaredOutcome =
      resolution?.forcedOutcome === 'fallback_shell' || unlinkable.length > 0
        ? 'fallback_shell'
        : 'transferred'

    const created = await this.createWithBackoff(lease, item, post, {
      targetCourseId,
      description,
      topicId,
      materials,
      notes,
      overflow,
      baseDescription: post.description,
    })

    if (created.kind === 'exhausted') {
      // The item exhausted its 5 attempts and even the bare shell would not go
      // through. Terminal and honest — not a hang.
      await this.finish(item.id, {
        outcome: 'skipped',
        skipReason: 'rate_limit_exhausted',
        note: rateLimitExhaustionNote(MAX_ATTEMPTS),
        attemptCount: MAX_ATTEMPTS,
        resolutionKind: resolution?.kinds[0] ?? null,
      })
      return
    }

    /* ---------------------------------------------------------------- *
     * P0-1 — EVERYTHING BELOW THIS LINE IS POST-CREATE.
     *
     * The post exists in the target course. No failure down here may
     * re-bucket the item or null its evidence; each one degrades to a note.
     * ---------------------------------------------------------------- */

    const followUpFailures: string[] = []

    let rubricDegraded = false
    let rubricReason: 'license' | 'permission' | 'oauth' | 'unknown' = 'unknown'
    try {
      const result = await this.copyRubricIfAny(post, created.id)
      rubricDegraded = result.degraded
      if (result.reason) rubricReason = result.reason
    } catch (error) {
      followUpFailures.push('rubric copy')
      logger.warn('rubric step failed after the post was created; degrading to a note', {
        targetPostId: created.id,
        error: error instanceof Error ? error.message : String(error),
      })
      rubricDegraded = true
    }

    if (rubricDegraded) {
      const amended = this.composeDescription(post.description, {
        overflow,
        notes: [...notes, rubricDegradedNote(rubricReason)],
      })
      if (amended != null) {
        try {
          if (post.sourceType === 'courseWork') {
            await this.provider.updateCourseWorkDescription(created.id, amended)
          } else {
            await this.provider.updateCourseWorkMaterialDescription(created.id, amended)
          }
        } catch (error) {
          followUpFailures.push('description update')
          logger.warn('description amendment failed after the post was created', {
            targetPostId: created.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    const baseNote =
      created.kind === 'shell'
        ? created.note ?? rateLimitExhaustionNote(MAX_ATTEMPTS)
        : notes.length > 0
          ? notes.join(' ')
          : null
    const note =
      followUpFailures.length > 0
        ? [baseNote, postCreatedFollowUpFailedNote(followUpFailures.join(' and '))]
            .filter((part): part is string => part != null)
            .join(' ')
        : baseNote

    await this.finish(item.id, {
      outcome: created.kind === 'shell' ? 'fallback_shell' : declaredOutcome,
      skipReason: null,
      note,
      targetPostId: created.id,
      attemptCount: created.attempts,
      rubricDegraded,
      resolutionKind: resolution?.kinds[0] ?? null,
    })
  }

  /* ---------------------------------------------------------------- *
   * The create, with backoff and the DISTINCT bare-shell fallback (D13)
   * ---------------------------------------------------------------- */

  private async createWithBackoff(
    lease: Lease,
    item: ItemRow,
    post: EnumeratedPost,
    ctx: CreateContext,
  ): Promise<
    | { kind: 'created'; id: string; attempts: number }
    | { kind: 'shell'; id: string; attempts: number; note?: string }
    | { kind: 'exhausted' }
  > {
    let attempt = 0
    let lastRetryable: RateLimitError | TransientError | null = null

    while (attempt < MAX_ATTEMPTS) {
      attempt += 1
      // D14 — attemptedAt is written IMMEDIATELY BEFORE the provider call, so a
      // crash here leaves evidence that an attempt was made and the item's fate
      // is verifiable rather than assumed.
      await this.prisma.transferJobItem.update({
        where: { id: item.id },
        data: { attemptedAt: new Date(), attemptCount: attempt },
      })

      try {
        const id = await this.issueCreate(post, ctx)
        // P0-1/P0-4 — EVIDENCE FIRST, before anything else can throw. This is
        // what lets the item-level catch tell the truth and what lets the
        // reconciler resolve an interruption from an id the job owns rather
        // than from a title it hopes is unique.
        await this.claimTargetPost(item.id, id)
        await this.clearPause(lease)
        return { kind: 'created', id, attempts: attempt }
      } catch (error) {
        if (error instanceof AttachmentNotVisibleError) {
          const note = attachmentNotVisibleNote()
          try {
            const id = await this.issueCreate(post, {
              ...ctx,
              description: this.composeDescription(ctx.baseDescription, {
                overflow: ctx.overflow,
                notes: [...ctx.notes, note],
              }),
              materials: [],
            })
            await this.claimTargetPost(item.id, id)
            return { kind: 'shell', id, attempts: attempt, note }
          } catch (shellError) {
            logger.error('attachment-invisible fallback shell failed', {
              itemId: item.id,
              error: shellError instanceof Error ? shellError.message : String(shellError),
            })
            return { kind: 'exhausted' }
          }
        }

        const isRetryable = error instanceof RateLimitError || error instanceof TransientError
        if (!isRetryable) throw error
        lastRetryable = error as RateLimitError | TransientError
        if (attempt >= MAX_ATTEMPTS) break
        const retryAfter = error instanceof RateLimitError ? error.retryAfterMs : (error as TransientError).retryAfterMs
        const waitMs = backoffDelayMs(attempt, retryAfter, this.backoff)
        await this.recordPause(lease, item, attempt, waitMs)
        logger.jobEvent('rate_limited_pause', {
          itemId: item.id,
          title: item.title,
          attempt,
          waitMs,
        })
        await this.sleep(waitMs)
        logger.jobEvent('resumed', { itemId: item.id, attempt })
      }
    }

    await this.clearPause(lease)

    // Exhausted. The guaranteed draft shell is a DIFFERENT CALL with a
    // DIFFERENT PAYLOAD — bare, no materials[]. Re-issuing the same
    // attachment-bearing create that just refused five times is exactly why the
    // "guaranteed" shell used to be unreachable.
    //
    // APPLY-F — it carries the accumulated notes AND the overflow link list.
    // Discarding them made the shell say "re-attach any files" without naming
    // one, and silently voided the 21+-as-description-URLs guarantee.
    try {
      const id = await this.issueCreate(post, {
        ...ctx,
        description: this.composeDescription(ctx.baseDescription, {
          overflow: ctx.overflow,
          notes: [...ctx.notes, rateLimitExhaustionNote(MAX_ATTEMPTS)],
        }),
        materials: [],
      })
      await this.claimTargetPost(item.id, id)
      logger.warn('rate-limit exhausted; bare draft shell created', {
        itemId: item.id,
        title: item.title,
        attempts: MAX_ATTEMPTS,
        lastRetryAfterMs: lastRetryable?.retryAfterMs ?? null,
      })
      return { kind: 'shell', id, attempts: MAX_ATTEMPTS }
    } catch (shellError) {
      // If even the shell will not go through, say so honestly.
      logger.error('rate-limit exhausted and the bare shell also failed', {
        itemId: item.id,
        title: item.title,
        error: shellError instanceof Error ? shellError.message : String(shellError),
      })
      return { kind: 'exhausted' }
    }
  }

  /** P0-1/P0-4 — the job's own evidence that a post now exists. */
  private async claimTargetPost(itemId: string, targetPostId: string): Promise<void> {
    await this.prisma.transferJobItem.update({
      where: { id: itemId },
      data: { claimedTargetPostId: targetPostId },
    })
  }

  private async issueCreate(post: EnumeratedPost, ctx: CreateContext): Promise<string> {
    if (post.sourceType === 'courseWorkMaterial') {
      const result = await this.provider.createCourseWorkMaterial(ctx.targetCourseId, {
        title: post.title,
        description: ctx.description,
        state: 'DRAFT',
        topicId: ctx.topicId,
        materials: ctx.materials,
      })
      return result.id
    }
    const payload: CourseWorkPayload = {
      title: post.title,
      description: ctx.description,
      workType: post.workType ?? 'ASSIGNMENT',
      state: 'DRAFT',
      topicId: ctx.topicId,
      maxPoints: post.maxPoints,
      answerConfig: post.answerConfig,
      quizFormLink: post.quizFormLink,
      materials: ctx.materials,
      assigneeMode: 'ALL_STUDENTS',
    }
    const result = await this.provider.createCourseWork(ctx.targetCourseId, payload)
    return result.id
  }

  /* ---------------------------------------------------------------- */

  /**
   * P0-1 — `getRubric` is INSIDE the try. It used to sit outside it, so a
   * permission failure on the rubric READ propagated out of a post that had
   * already been created and took the whole item down with it.
   */
  private async copyRubricIfAny(
    post: EnumeratedPost,
    targetPostId: string,
  ): Promise<{ degraded: boolean; reason: 'license' | 'permission' | 'oauth' | 'unknown' | null }> {
    if (post.sourceType !== 'courseWork' || !post.hasRubric) {
      return { degraded: false, reason: null }
    }
    try {
      const rubric = await this.provider.getRubric(post.sourceId)
      if (!rubric) return { degraded: false, reason: null }
      await this.provider.createRubric(targetPostId, rubric)
      return { degraded: false, reason: null }
    } catch (error) {
      if (error instanceof LicenseBlockedError) {
        logger.warn('rubric copy blocked by licence; degrading to a note', {
          targetPostId,
          error: error instanceof Error ? error.message : String(error),
        })
        return { degraded: true, reason: 'license' }
      }
      const reason = error instanceof PermissionError ? 'permission' : 'unknown'
      logger.warn('rubric copy failed for a non-licence reason; degrading to a note', {
        targetPostId,
        error: error instanceof Error ? error.message : String(error),
      })
      return { degraded: true, reason }
    }
  }

  private async recordPause(
    lease: Lease,
    item: ItemRow,
    attempt: number,
    waitMs: number,
  ): Promise<void> {
    await this.heartbeat(lease, {
      rateLimitPause: JSON.stringify({ retryInMs: waitMs, attempt, itemTitle: item.title }),
    })
    await this.prisma.transferJobItem.update({
      where: { id: item.id },
      data: { nextAttemptAt: new Date(Date.now() + waitMs) },
    })
  }

  private async clearPause(lease: Lease): Promise<void> {
    await this.heartbeat(lease, { rateLimitPause: null })
  }

  /**
   * The single place an item leaves `pending`.
   *
   * P0-1 — the `outcome: 'pending'` predicate makes overwriting a terminal
   * outcome UNREPRESENTABLE rather than merely unintended. `finish()` used to
   * be `update where {id}`, and the item-level catch used it to turn a
   * successfully created post into a system skip with `targetPostId` nulled.
   */
  private async finish(
    itemId: string,
    data: {
      outcome: 'transferred' | 'fallback_shell' | 'skipped'
      skipReason: SkipReason | null
      note: string | null
      targetPostId?: string | null
      attemptCount?: number
      rubricDegraded?: boolean
      resolutionKind?: string | null
    },
  ): Promise<void> {
    const result = await this.prisma.transferJobItem.updateMany({
      where: { id: itemId, outcome: 'pending' },
      data: {
        outcome: data.outcome,
        skipReason: data.skipReason,
        note: data.note,
        // D14 — targetPostId is written in the SAME statement as the outcome,
        // so there is no window in which the item claims 'transferred' without
        // saying what it created.
        targetPostId: data.targetPostId ?? null,
        ...(data.attemptCount != null ? { attemptCount: data.attemptCount } : {}),
        ...(data.rubricDegraded != null ? { rubricDegraded: data.rubricDegraded } : {}),
        ...(data.resolutionKind != null ? { resolutionKind: data.resolutionKind } : {}),
      },
    })
    if (result.count === 0) {
      logger.error('refused to overwrite an already-terminal item outcome', {
        itemId,
        attemptedOutcome: data.outcome,
        attemptedSkipReason: data.skipReason,
      })
    }
  }

  /** Used by both the pre-completion sweep and the top-level failure path. */
  private async resolveRemainingPending(
    jobId: string,
    skipReason: SkipReason,
    opts: { note: string },
  ): Promise<number> {
    const result = await this.prisma.transferJobItem.updateMany({
      where: { jobId, outcome: 'pending' },
      data: { outcome: 'skipped', skipReason, note: opts.note },
    })
    return result.count
  }
}
