/**
 * frontend-api-client — the single door between the React client and the
 * Express API.
 *
 * Three things are non-negotiable here:
 *
 * 1. **D17.** Every payload is parsed through the zod schema declared in
 *    `@classroom-copier/shared`. No payload shape is redeclared in this file;
 *    a response that does not validate becomes an error rather than something
 *    a screen renders anyway.
 * 2. **D4 + D29.** Cold start is *latency-triggered*: every request starts a
 *    2s timer, an unresolved call raises the overlay flag, a response clears
 *    it, and a 60s ceiling aborts into a distinct `ColdStartTimeoutError`.
 *    Not an idle clock, not a server flag, and never an indefinite overlay.
 * 3. **D5.** A 409 from `POST /transfer-jobs` is not a failure — it is the
 *    double-submit self-healing into "attach to the job already running".
 */
import { useSyncExternalStore } from 'react'
import {
  ActiveJobResponseSchema,
  ApiErrorSchema,
  CancelTransferJobResponseSchema,
  CourseListResponseSchema,
  CreateTransferJobResponseSchema,
  HealthResponseSchema,
  PreflightResponseSchema,
  GoogleAuthUrlResponseSchema,
  SessionResponseSchema,
  TransferJobItemsResponseSchema,
  TransferJobStatusSchema,
  isTerminalJobStatus,
} from '@classroom-copier/shared'
import type {
  ActiveJobResponse,
  CancelTransferJobResponse,
  CourseListResponse,
  CourseRole,
  CreateTransferJobRequest,
  HealthResponse,
  GoogleAuthUrlResponse,
  PreflightResponse,
  SessionResponse,
  TransferJobItemsResponse,
  TransferJobStatus,
} from '@classroom-copier/shared'
import type { z } from 'zod'

/**
 * Empty means same-origin, which is what the Vite dev proxy gives us locally.
 * Production sets VITE_API_BASE_URL to the deployed API origin (split-origin
 * Render services, `SameSite=None; Secure` cookies, pinned CORS allowlist).
 * The test environment pins it so URL assertions stay explicit.
 */
export const API_BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env?.MODE === 'test' ? 'http://localhost:4000' : '')

/** The session token, stored in sessionStorage so it survives navigations within
 *  the same tab but is dropped when the tab closes. Works in incognito mode where
 *  SameSite=None cookies are blocked. */
const SESSION_TOKEN_KEY = 'cc_session_token'

export function getSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setSessionToken(token: string): void {
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token)
  } catch {
    // sessionStorage may be unavailable in some restricted contexts
  }
}

export function clearSessionToken(): void {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
  } catch {
    // ignore
  }
}
export const COLD_START_THRESHOLD_MS = 2000
export const COLD_START_CEILING_MS = 60_000
/** §4.4 — "roughly every 1.5s". */
export const POLL_INTERVAL_MS = 1500

/**
 * P0-5 — the poll survives a blip.
 *
 * `pollJobStatus` used to return without rescheduling on ANY error, so one
 * transient fetch failure or one malformed frame stopped all progress updates
 * permanently — and the api-client's own test ASSERTED that behaviour rather
 * than flagging it. With no mid-transfer cancel in v1 (UX Decision 13), that
 * left the user on a frozen screen. A poll is idempotent and cheap; giving up
 * on the first failure is the expensive choice.
 */
export const POLL_MAX_RETRIES = 3
export const POLL_RETRY_BASE_MS = 750

/* ------------------------------------------------------------------ *
 * Errors — three distinct classes, because the UI treats them differently
 * ------------------------------------------------------------------ */

/** The server answered, but not with success. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly jobId?: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

/** The server answered with something the shared schema rejects (D17). */
export class ApiValidationError extends Error {
  constructor(
    readonly path: string,
    readonly issues: string,
  ) {
    super(`The server sent an unexpected response for ${path}.`)
    this.name = 'ApiValidationError'
  }
}

/**
 * D4 — the 60s ceiling. Deliberately its own class: a backend that is waking
 * up and a backend that is down must never be indistinguishable.
 */
export class ColdStartTimeoutError extends Error {
  constructor(readonly path: string) {
    super('The server did not respond in time.')
    this.name = 'ColdStartTimeoutError'
  }
}

/* ------------------------------------------------------------------ *
 * The cold-start store — a subscribable snapshot the overlay consumes
 * ------------------------------------------------------------------ */

export interface ColdStartState {
  /** At least one in-flight request has been unresolved for >= 2s. */
  readonly coldStart: boolean
  /** A request hit the 60s ceiling. The overlay is over; an error state owns the screen. */
  readonly timedOut: boolean
}

const INITIAL: ColdStartState = { coldStart: false, timedOut: false }

let slowRequests = 0
let snapshot: ColdStartState = INITIAL
const listeners = new Set<() => void>()

function publish(next: ColdStartState): void {
  if (next.coldStart === snapshot.coldStart && next.timedOut === snapshot.timedOut) return
  snapshot = next
  for (const listener of listeners) listener()
}

function syncColdStart(): void {
  publish({ coldStart: slowRequests > 0, timedOut: snapshot.timedOut })
}

export const coldStartStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): ColdStartState {
    return snapshot
  },
  /** Clears the timed-out latch once the user retries. */
  clearTimeout(): void {
    publish({ coldStart: snapshot.coldStart, timedOut: false })
  },
  /** Test seam — resets the module-level machine between cases. */
  reset(): void {
    slowRequests = 0
    snapshot = INITIAL
    for (const listener of listeners) listener()
  },
}

/** React binding for the overlay. */
export function useColdStart(): ColdStartState {
  return useSyncExternalStore(coldStartStore.subscribe, coldStartStore.getSnapshot, () => INITIAL)
}

/* ------------------------------------------------------------------ *
 * The request core
 * ------------------------------------------------------------------ */

/**
 * CSRF hardening (server `middleware/csrf.ts`) — every state-changing method
 * must carry this header or the server answers 403 `csrf_header_missing`.
 * Set here, in the one choke point every call flows through, rather than at
 * each call site, so no future mutating call can forget it.
 */
const CSRF_HEADER_NAME = 'X-Classroom-Copier'
const CSRF_HEADER_VALUE = '1'
const CSRF_PROTECTED_METHODS = new Set(['POST', 'PATCH', 'DELETE'])

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  /** Status codes that resolve to `null` instead of raising (204, 401, 409). */
  nullOn?: readonly number[]
  /**
   * APPLY-M — a caller's abort signal, so an effect can cancel its own request
   * on unmount. Without it the internal 60s ceiling was the ONLY thing that
   * aborted anything: components guarded with local `live` flags, so React was
   * quiet while the fetch ran on and the global `slowRequests` counter stayed
   * incremented — leaving the cold-start overlay visible over a screen that no
   * longer existed.
   */
  signal?: AbortSignal
}

/** True for the DOMException a caller's `AbortController.abort()` produces.
 *  An abort the app itself requested is not a failure to report. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

interface RawResult {
  status: number
  /** `null` for a bodyless response. */
  body: unknown
}

async function rawRequest(path: string, options: RequestOptions = {}): Promise<RawResult> {
  const controller = new AbortController()
  let flaggedSlow = false
  let hitCeiling = false

  const slowTimer = setTimeout(() => {
    flaggedSlow = true
    slowRequests += 1
    syncColdStart()
  }, COLD_START_THRESHOLD_MS)

  const ceilingTimer = setTimeout(() => {
    hitCeiling = true
    controller.abort()
  }, COLD_START_CEILING_MS)

  // APPLY-M — the caller's signal is chained onto the internal controller, so
  // the ceiling and the caller's cleanup both abort the same request and the
  // `finally` below decrements `slowRequests` exactly once either way.
  const abortFromCaller = () => controller.abort()
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', abortFromCaller, { once: true })
  }

  try {
    const method = options.method ?? 'GET'
    const headers: Record<string, string> = {}
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (CSRF_PROTECTED_METHODS.has(method)) headers[CSRF_HEADER_NAME] = CSRF_HEADER_VALUE
    const token = getSessionToken()
    if (token) headers['authorization'] = `Bearer ${token}`

    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      signal: controller.signal,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })

    let body: unknown = null
    if (response.status !== 204) {
      const text = await response.text()
      if (text.length > 0) {
        try {
          body = JSON.parse(text)
        } catch {
          body = null
        }
      }
    }
    return { status: response.status, body }
  } catch (error) {
    if (hitCeiling) throw new ColdStartTimeoutError(path)
    throw error
  } finally {
    clearTimeout(slowTimer)
    clearTimeout(ceilingTimer)
    options.signal?.removeEventListener('abort', abortFromCaller)
    if (flaggedSlow) {
      slowRequests -= 1
      syncColdStart()
    }
    if (hitCeiling) {
      publish({ coldStart: slowRequests > 0, timedOut: true })
    }
  }
}

function apiErrorFrom(path: string, status: number, body: unknown): ApiRequestError {
  const parsed = ApiErrorSchema.safeParse(body)
  if (parsed.success) {
    return new ApiRequestError(
      status,
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.jobId,
    )
  }
  return new ApiRequestError(status, 'unknown', `Request to ${path} failed (${status}).`)
}

function parseOrThrow<T>(path: string, schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new ApiValidationError(path, JSON.stringify(parsed.error.issues))
  }
  return parsed.data
}

/** Requests whose success path always carries a schema-validated body. */
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const { status, body } = await rawRequest(path, options)
  if (status < 200 || status >= 300) throw apiErrorFrom(path, status, body)
  return parseOrThrow(path, schema, body)
}

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

/**
 * The real sign-in's first leg (UX 1b). An ORDINARY cold-start-wrapped fetch:
 * it goes through `request`, so the 2s cold-start overlay and the 60s ceiling
 * apply to it exactly as they do to every other call. That is the whole point
 * of doing a round trip before the redirect instead of linking straight to
 * Google — a sleeping Render service would otherwise leave the teacher on a
 * dead screen with no narration, and once the browser is on Google's domain we
 * can no longer narrate anything.
 */
export function getGoogleAuthUrl(signal?: AbortSignal): Promise<GoogleAuthUrlResponse> {
  return request('/api/auth/google/url', GoogleAuthUrlResponseSchema, { signal })
}

/**
 * The return leg (UX 1d). The callback already set the session cookie
 * server-side; this confirms it and names the teacher.
 *
 * It is `me()` under a name that says what the caller is doing, because "is
 * there a session?" and "did my sign-in just work?" are different questions
 * with different answers on `null`: a null here is a FAILED sign-in, not an
 * anonymous visitor.
 */
export async function confirmSession(signal?: AbortSignal): Promise<SessionResponse | null> {
  return me(signal)
}

export async function signOut(): Promise<void> {
  const { status, body } = await rawRequest('/api/auth/sign-out', { method: 'POST' })
  clearSessionToken()
  if (status < 200 || status >= 300) throw apiErrorFrom('/api/auth/sign-out', status, body)
}

/**
 * `null` means "no session", which is an answer, not a failure.
 *
 * APPLY-N — and ONLY 401 means that. Every other status still throws, so the
 * caller can tell "you are signed out" from "the server is broken" instead of
 * parking the user on the sign-in screen with no explanation.
 */
export async function me(signal?: AbortSignal): Promise<SessionResponse | null> {
  const { status, body } = await rawRequest('/api/auth/me', { signal })
  if (status === 401) return null
  if (status < 200 || status >= 300) throw apiErrorFrom('/api/auth/me', status, body)
  return parseOrThrow('/api/auth/me', SessionResponseSchema, body)
}

/* ------------------------------------------------------------------ *
 * Courses & pre-flight
 * ------------------------------------------------------------------ */

export function listCourses(role: CourseRole, signal?: AbortSignal): Promise<CourseListResponse> {
  return request(`/api/courses?role=${role}`, CourseListResponseSchema, { signal })
}

export function runPreflight(
  sourceId: string,
  targetId: string,
  signal?: AbortSignal,
): Promise<PreflightResponse> {
  return request(
    `/api/courses/${encodeURIComponent(sourceId)}/preflight`,
    PreflightResponseSchema,
    { method: 'POST', body: { targetId }, signal },
  )
}

/* ------------------------------------------------------------------ *
 * Transfer jobs
 * ------------------------------------------------------------------ */

export interface CreateTransferJobResult {
  /** True when the server reported an already-running job (409, D5). */
  conflict: boolean
  jobId: string
}

export async function createTransferJob(
  input: CreateTransferJobRequest,
): Promise<CreateTransferJobResult> {
  const path = '/api/transfer-jobs'
  const { status, body } = await rawRequest(path, { method: 'POST', body: input })

  if (status === 409) {
    // D5 — only ONE of the 409s is the self-healing double-submit. The others
    // (`scan_already_used`, `scan_stale` — APPLY-C and APPLY-I) are refusals,
    // and attaching to the job named in a `scan_already_used` body would put the
    // user on a progress screen for a transfer that already finished.
    const parsed = ApiErrorSchema.safeParse(body)
    const jobId = parsed.success ? parsed.data.error.jobId : undefined
    const code = parsed.success ? parsed.data.error.code : undefined
    if (code !== 'job_already_running' || !jobId) throw apiErrorFrom(path, status, body)
    return { conflict: true, jobId }
  }
  if (status < 200 || status >= 300) throw apiErrorFrom(path, status, body)

  const ok = parseOrThrow(path, CreateTransferJobResponseSchema, body)
  return { conflict: false, jobId: ok.jobId }
}

/**
 * F12 reconnect discovery. `204` means "nothing in flight", which is `null`.
 *
 * APPLY-N — anything else throws. Treating every failure as "no active job"
 * dropped the user on Selection while a job was still running server-side,
 * silently defeating the reconnect guarantee this call exists to deliver.
 */
export async function getActiveJob(signal?: AbortSignal): Promise<string | null> {
  const path = '/api/transfer-jobs/active'
  const { status, body } = await rawRequest(path, { signal })
  if (status === 204) return null
  if (status < 200 || status >= 300) throw apiErrorFrom(path, status, body)
  const parsed: ActiveJobResponse = parseOrThrow(path, ActiveJobResponseSchema, body)
  return parsed.jobId
}

export function getJobStatus(jobId: string): Promise<TransferJobStatus> {
  return request(
    `/api/transfer-jobs/${encodeURIComponent(jobId)}/status`,
    TransferJobStatusSchema,
  )
}

/**
 * The mid-transfer Cancel control. Idempotent on the server while the job is
 * non-terminal (200 every time); a job that has already finished answers 409
 * `job_already_finished`, which surfaces here as an `ApiRequestError` like
 * every other non-2xx response — there is no special-cased "not an error"
 * path the way D5's double-submit 409 gets, because a cancel that arrives too
 * late is genuinely a refusal, not self-healing.
 */
export function cancelTransferJob(jobId: string): Promise<CancelTransferJobResponse> {
  return request(
    `/api/transfer-jobs/${encodeURIComponent(jobId)}/cancel`,
    CancelTransferJobResponseSchema,
    { method: 'POST' },
  )
}

export function getJobItems(
  jobId: string,
  signal?: AbortSignal,
): Promise<TransferJobItemsResponse> {
  return request(
    `/api/transfer-jobs/${encodeURIComponent(jobId)}/items`,
    TransferJobItemsResponseSchema,
    { signal },
  )
}

export function health(): Promise<HealthResponse> {
  return request('/api/health', HealthResponseSchema)
}

/* ------------------------------------------------------------------ *
 * Polling
 * ------------------------------------------------------------------ */

/**
 * Polls `GET /transfer-jobs/:id/status` on a ~1500ms cadence until the status
 * is terminal (`completed | interrupted | failed` — the one definition, from
 * shared-contracts). Returns a cancel function.
 *
 * P0-5 — a failed poll is RETRIED with exponential backoff, up to
 * `POLL_MAX_RETRIES` consecutive failures, before `onError` is called and the
 * loop stops. A single successful poll resets the counter, so a long transfer
 * that hiccups every few minutes never gives up.
 */
export function pollJobStatus(
  jobId: string,
  onTick: (status: TransferJobStatus) => void,
  onError?: (error: unknown) => void,
): () => void {
  let cancelled = false
  let handle: ReturnType<typeof setTimeout> | undefined
  let consecutiveFailures = 0

  const tick = async (): Promise<void> => {
    if (cancelled) return
    let status: TransferJobStatus
    try {
      status = await getJobStatus(jobId)
    } catch (error) {
      if (cancelled) return
      consecutiveFailures += 1
      if (consecutiveFailures > POLL_MAX_RETRIES) {
        onError?.(error)
        return
      }
      handle = setTimeout(
        () => void tick(),
        POLL_RETRY_BASE_MS * 2 ** (consecutiveFailures - 1),
      )
      return
    }
    if (cancelled) return
    consecutiveFailures = 0
    onTick(status)
    if (isTerminalJobStatus(status.status)) return
    handle = setTimeout(() => void tick(), POLL_INTERVAL_MS)
  }

  void tick()

  return () => {
    cancelled = true
    if (handle !== undefined) clearTimeout(handle)
  }
}
