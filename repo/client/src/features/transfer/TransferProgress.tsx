/**
 * Screen 5 — Batch Transfer Progress.
 *
 * Three things here are load-bearing rather than decorative:
 *
 *  - **F12 reconnect.** On mount the screen asks the server what is already in
 *    flight (`GET /transfer-jobs/active`) instead of assuming the job it was
 *    handed. A reloaded tab therefore lands back on live progress rather than
 *    restarting or duplicating the job.
 *  - **aria-live throttling** (02-ux-workflow.md §6). ONE polite region,
 *    announcing a periodic count — every ~5 items AND no more often than ~3s,
 *    "whichever is less frequent" — plus exactly one completion announcement.
 *    Never per item: 50 spoken outcomes is unusable screen-reader noise.
 *  - **D12.** `status === 'failed'` is a real error state, not a progress bar
 *    that stopped moving.
 *  - **P0-5.** Both dead ends on that error state are gone. A LOST POLL is now
 *    recoverable here — the poll retries with backoff first (api-client), and
 *    if it still gives up, Retry genuinely restarts the loop, because a bumped
 *    `restartToken` re-runs the effect. Before, `onRetry` was wired to
 *    `setStage('transfer')` while the stage was ALREADY `'transfer'`: a React
 *    no-op, so the button did nothing at all, and no test clicked it. A job
 *    that reached `failed` SERVER-side offers no Retry, because retrying a
 *    terminal failure cannot succeed; it routes back to Selection instead.
 *
 * The mid-transfer Cancel control (the partial-completion contract, decided).
 * One click reveals an IN-REGISTER confirm — never `window.confirm()` — and
 * confirming POSTs the cancel and steps back; the poll loop above is already
 * the only thing that carries this screen to its terminal transition, so
 * confirming does nothing but ask the server to start draining. The server
 * finishes the in-flight item naturally, drains the rest as
 * `skipped`/`cancelled_by_user`, and the job still lands `completed` (with
 * `cancelledAt` set) — never `failed`, and no new status — so this screen's
 * own `isTerminalJobStatus` handling needs no special case for it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CurrentItem, TransferJobStatus } from '@classroom-copier/shared'
import { isTerminalJobStatus } from '@classroom-copier/shared'
import {
  Button,
  ErrorState,
  NarrationBanner,
  OutcomeIcon,
  RATE_LIMIT_NOTICE,
} from '../../components/shared'
import { cancelTransferJob, getActiveJob, isAbortError, pollJobStatus } from '../../lib/api-client'

/** "every 5 items or every ~3 seconds, whichever is LESS frequent" — so both. */
export const ANNOUNCE_EVERY_ITEMS = 5
export const ANNOUNCE_EVERY_MS = 3000
const TICKER_LENGTH = 3

interface TransferProgressProps {
  /** The job just created, if any. The server's answer still wins. */
  jobId: string | null
  onComplete: (status: TransferJobStatus) => void
  /** Where "Start Over" goes: back to Selection. */
  onStartOver: () => void
  /**
   * DEFER 2 — the caller already resolved `GET /transfer-jobs/active` itself
   * (App's own mount effect does this for the F12 reconnect path) and handed
   * the result down as `jobId`. When true, this screen trusts `jobId`
   * outright instead of repeating the same discovery fetch a second time.
   * Defaults to false so a screen mounted on its own (including these unit
   * tests) still performs its own discovery, unchanged.
   */
  skipDiscovery?: boolean
  /**
   * 4b — the APP's own session expired mid-transfer (a poll came back 401).
   * Distinct from 4c below: the job is fine, the browser's login is not.
   */
  sessionExpired?: boolean
  /** Where "Sign in again" / "Reconnect Google account" send the teacher. */
  onReconnect?: () => void
}

export function TransferProgress({
  jobId,
  onComplete,
  onStartOver,
  skipDiscovery = false,
  sessionExpired = false,
  onReconnect,
}: TransferProgressProps) {
  const [status, setStatus] = useState<TransferJobStatus | null>(null)
  const [ticker, setTicker] = useState<CurrentItem[]>([])
  const [announcement, setAnnouncement] = useState('')
  const [countdownMs, setCountdownMs] = useState<number | null>(null)
  /** P0-5 — the poll gave up after its bounded retries. Recoverable, locally. */
  const [pollFailed, setPollFailed] = useState(false)
  /** P0-5 — bumping this re-runs the poll effect. THIS is what Retry does. */
  const [restartToken, setRestartToken] = useState(0)
  /** The Cancel control's in-register confirm — never `window.confirm()`. */
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  /** The bar is monotonic: it freezes on pause and never reverses (§3). */
  const highWater = useRef(0)
  /** UI §6 / QA-4 — 4b's and 4c's focus targets. */
  const sessionBannerRef = useRef<HTMLDivElement>(null)
  const googleBannerRef = useRef<HTMLDivElement>(null)
  const lastAnnouncedAt = useRef(0)
  const lastAnnouncedCount = useRef(0)
  const completedOnce = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  /**
   * UI §6 / QA-4 — 4b and 4c move focus to their banner when it appears.
   *
   * `role="alert"` already announces them; it does not MOVE anyone, so the
   * teacher was told the transfer needs their attention and left wherever they
   * were, with the whole progress screen between them and the button the
   * announcement was about.
   *
   * Keyed on WHETHER the banner is up, never on the status object: this screen
   * polls about once a second, and a teacher who tabbed to the button must not
   * be yanked back to the banner by the next tick. The move happens once, when
   * the interrupt arrives.
   */
  const googleReauthRequired = status?.googleReauthRequired ?? false
  useEffect(() => {
    if (sessionExpired) sessionBannerRef.current?.focus()
  }, [sessionExpired])
  useEffect(() => {
    if (googleReauthRequired) googleBannerRef.current?.focus()
  }, [googleReauthRequired])

  const handleTick = useCallback((next: TransferJobStatus) => {
    setStatus(next)

    const resolved = next.totalItems - next.pending
    if (resolved > highWater.current) highWater.current = resolved

    if (next.currentItem && next.currentItem.outcome !== 'pending') {
      const item = next.currentItem
      setTicker((prev) =>
        prev[0] && prev[0].title === item.title && prev[0].outcome === item.outcome
          ? prev
          : [item, ...prev].slice(0, TICKER_LENGTH),
      )
    }

    setCountdownMs(next.rateLimitPause ? next.rateLimitPause.retryInMs : null)

    if (isTerminalJobStatus(next.status)) {
      if (next.status !== 'failed' && !completedOnce.current) {
        completedOnce.current = true
        setAnnouncement(`Transfer complete. ${resolved} of ${next.totalItems} posts processed.`)
        onCompleteRef.current(next)
      }
      return
    }

    const now = Date.now()
    const sinceItems = resolved - lastAnnouncedCount.current
    const sinceMs = now - lastAnnouncedAt.current
    if (sinceItems >= ANNOUNCE_EVERY_ITEMS && sinceMs >= ANNOUNCE_EVERY_MS) {
      lastAnnouncedCount.current = resolved
      lastAnnouncedAt.current = now
      setAnnouncement(`${resolved} of ${next.totalItems} posts processed.`)
    }
  }, [])

  // Mount (and every explicit restart): rediscover the in-flight job, then poll
  // it. `restartToken` is the ONLY thing that re-runs this — a re-render never
  // starts a second poll loop.
  useEffect(() => {
    let cancelPoll: (() => void) | undefined
    let live = true
    // APPLY-M — the discovery request is aborted if this screen goes away.
    const controller = new AbortController()

    const startPolling = (target: string | null) => {
      if (!live || !target) return
      cancelPoll = pollJobStatus(target, handleTick, () => {
        if (live) setPollFailed(true)
      })
    }

    if (skipDiscovery) {
      // DEFER 2 — the caller already discovered this job; do not repeat
      // `GET /transfer-jobs/active` for the same reconnect.
      startPolling(jobId)
    } else {
      getActiveJob(controller.signal)
        .catch((error: unknown) => {
          // A failed discovery is not fatal: fall back to the job we were handed.
          if (!isAbortError(error)) return null
          return null
        })
        .then((active) => startPolling(active ?? jobId))
    }

    return () => {
      live = false
      controller.abort()
      cancelPoll?.()
    }
    // Deps are deliberately just `restartToken`: restarting is an explicit user
    // action, never a consequence of a re-render. Adding
    // `jobId`/`handleTick`/`skipDiscovery` here would start a second poll loop.
  }, [restartToken])

  const restart = useCallback(() => {
    setPollFailed(false)
    setStatus(null)
    setTicker([])
    setRestartToken((token) => token + 1)
  }, [])

  const requestCancel = useCallback(() => setConfirmingCancel(true), [])
  const keepGoing = useCallback(() => setConfirmingCancel(false), [])
  const confirmCancel = useCallback(() => {
    if (!status) return
    setCancelling(true)
    // Fire-and-forget from the screen's point of view: the flag lives
    // server-side, and the poll loop already running above is what carries
    // this screen to its normal terminal transition once the drain finishes
    // (status='completed', cancelledAt set — never a special case here).
    void cancelTransferJob(status.jobId)
      .catch(() => {})
      .finally(() => setConfirmingCancel(false))
  }, [status])

  // The rate-limit countdown ticks locally between polls.
  useEffect(() => {
    if (countdownMs === null) return undefined
    const handle = setInterval(() => {
      setCountdownMs((ms) => (ms === null ? null : Math.max(0, ms - 1000)))
    }, 1000)
    return () => clearInterval(handle)
  }, [countdownMs === null])

  // P0-5 — the job is terminally `failed` on the server. Polling it again will
  // report `failed` again, so there is no Retry to offer; Start Over routes back
  // to Selection with the failure explained.
  if (status?.status === 'failed') {
    return (
      <ErrorState
        onStartOver={onStartOver}
        detail="The transfer stopped partway. The itemized log records what had already been copied, and nothing else will be written."
      />
    )
  }

  // P0-5 — we lost contact with the server, not the job. This one IS worth
  // retrying, and Retry restarts the poll for real.
  if (pollFailed) {
    return (
      <ErrorState
        onRetry={restart}
        onStartOver={onStartOver}
        detail="We lost contact with the server while the transfer was running. The transfer itself may still be going — try again to reconnect to it."
      />
    )
  }

  const total = status?.totalItems ?? 0
  const resolved = Math.max(highWater.current, 0)
  const percent = total > 0 ? Math.round((resolved / total) * 100) : 0

  return (
    <div className="screen">
      <div className="progress-wrap">
        <div className="progress-count">{`Transferring ${resolved} of ${total} posts…`}</div>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={resolved}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Posts copied"
        >
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>

        <div className="ticker">
          {ticker.length === 0 ? (
            <div className="ticker-row">Starting…</div>
          ) : (
            ticker.map((item, i) => (
              <div className="ticker-row" key={`${item.title}-${i}`}>
                <OutcomeIcon outcome={item.outcome} skipReason={item.skipReason} />
                <span>“{item.title}”</span>
              </div>
            ))
          )}
        </div>

        {status?.rateLimitPause ? (
          <NarrationBanner glyph="⏱" variant="rate-banner">
            {RATE_LIMIT_NOTICE(Math.ceil((countdownMs ?? status.rateLimitPause.retryInMs) / 1000))}
          </NarrationBanner>
        ) : null}

        {/* 4b and 4c sit WITH the frozen progress bar rather than replacing the
            screen — the teacher needs to see how far the transfer got. They
            must be tellable apart without reading the body copy (UX Decision
            10), so they differ in glyph, heading AND button label, not just in
            prose. 4b is the local session; 4c is the Google connection. */}
        {sessionExpired ? (
          <div
            className="interrupt-banner"
            role="alert"
            data-testid="session-expired-banner"
            ref={sessionBannerRef}
            tabIndex={-1}
          >
            <div className="interrupt-head">
              <span aria-hidden="true">!</span>
              <span>Your sign-in expired</span>
            </div>
            <p>
              The transfer is still running on our side. Sign in again to keep watching it —
              nothing has been lost, and nothing will be copied twice.
            </p>
            <Button onClick={onReconnect}>Sign in again</Button>
          </div>
        ) : null}

        {status?.googleReauthRequired ? (
          <div
            className="interrupt-banner"
            role="alert"
            data-testid="google-reconnect-banner"
            ref={googleBannerRef}
            tabIndex={-1}
          >
            <div className="interrupt-head">
              {/* ⇄ rather than ! — a cheap, consistent cue that THIS one is
                  about the external connection, not the local session. */}
              <span aria-hidden="true">⇄</span>
              <span>Time to reconnect Google</span>
            </div>
            {/* Routine, not alarmed: in testing mode this is a WEEKLY event,
                and copy that reads as a failure turns a scheduled occurrence
                into a recurring trust hit. "Why is this happening" comes
                before "nothing was lost", because that is the order a teacher
                asks them in. */}
            <p>
              This happens about once a week while the app is in testing — it&rsquo;s expected, not
              a sign of a problem. Everything copied so far is safe, and the rest will pick up
              exactly where it stopped.
            </p>
            <Button onClick={onReconnect}>Reconnect Google account</Button>
          </div>
        ) : null}

        {confirmingCancel ? (
          <div className="notice" role="alert" data-testid="cancel-confirm-banner">
            <span className="glyph" aria-hidden="true">
              !
            </span>
            <div className="cancel-confirm-body">
              <p className="cancel-confirm-question">Cancel the remaining posts?</p>
              <p className="cancel-confirm-detail">
                The post being copied right now will finish. Every post still waiting will be
                skipped — already-copied drafts stay exactly as they are.
              </p>
              <div className="cancel-confirm-actions">
                <Button variant="secondary" onClick={confirmCancel}>
                  Cancel remaining posts
                </Button>
                <Button variant="link" onClick={keepGoing}>
                  Keep going
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="cancel-row">
            <Button variant="secondary" onClick={requestCancel} disabled={cancelling}>
              {cancelling ? 'Cancelling…' : 'Cancel transfer'}
            </Button>
          </div>
        )}

        {/* One region. Throttled. Never per item. */}
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          data-testid="progress-live-region"
        >
          {announcement}
        </div>
      </div>
    </div>
  )
}
