/**
 * The app shell: a single linear wizard, not a dashboard
 * (02-ux-workflow.md Decisions #1).
 *
 *   sign-in -> forced picker -> Select -> Pre-flight -> Ready -> Transfer -> Summary
 *
 * Rules encoded here rather than left to each screen:
 *  - The step indicator appears on the four post-sign-in steps and is inert.
 *  - Back exists through Ready-to-Transfer and is gone once the batch write has
 *    started — a half-completed batch write is not something Back can undo.
 *  - Switching accounts restarts at Selection and DISCARDS any in-progress,
 *    unconfirmed selection; it is never carried into the new account's list.
 *  - On mount the shell asks the server what is already in flight, so a
 *    reloaded tab lands back on Progress instead of at the beginning.
 *  - The cold-start overlay is driven by the api-client's latency store (D4),
 *    and its 60s ceiling surfaces as an error state, never a spinner forever.
 */
import { useCallback, useEffect, useState } from 'react'
import { AuthErrorSchema } from '@classroom-copier/shared'
import type {
  AccountSummary,
  AuthError,
  CourseSummary,
  PreflightResponse,
  Resolution,
  TransferJobItemRow,
  TransferJobStatus,
} from '@classroom-copier/shared'
import {
  ColdStartOverlay,
  ErrorBoundary,
  ErrorState,
  NarrationBanner,
  ScanConflictNotice,
  StepIndicator,
  Button,
} from './components/shared'
import type { ScanConflictKind, StepNumber } from './components/shared'
import { AuthFlow, type AuthStage } from './features/auth/AuthFlow'
import { SelectionScreen } from './features/selection/SelectionScreen'
import { PreflightScreen } from './features/preflight/PreflightScreen'
import { ReadyToTransfer } from './features/preflight/ReadyToTransfer'
import { TransferProgress } from './features/transfer/TransferProgress'
import { CompletionSummary } from './features/summary/CompletionSummary'
import {
  ApiRequestError,
  coldStartStore,
  createTransferJob,
  getActiveJob,
  getJobItems,
  isAbortError,
  me,
  signOut,
  useColdStart,
} from './lib/api-client'

type Stage = 'auth' | 'selection' | 'preflight' | 'ready' | 'transfer' | 'summary'

const STEP_FOR: Record<Exclude<Stage, 'auth'>, StepNumber> = {
  selection: 1,
  preflight: 2,
  ready: 2,
  transfer: 3,
  summary: 4,
}

/** APPLY-O — the boundary wraps the whole wizard; a render-time throw in any
 *  screen becomes an error state rather than a white page. */
export function App() {
  const [shellKey, setShellKey] = useState(0)
  return (
    <ErrorBoundary onReset={() => setShellKey((key) => key + 1)}>
      <Wizard key={shellKey} />
    </ErrorBoundary>
  )
}

/**
 * Read `?authError=` and the callback marker ONCE, at module scope for this
 * mount, and strip them from the URL immediately.
 *
 * `history.replaceState` runs before React paints, so the Back button cannot
 * return the teacher to a URL carrying a stale sign-in state. (The
 * authorization CODE itself never reaches the frontend URL at all — the server
 * consumes it in its own callback handler and redirects here with, at most, an
 * error code.)
 */
function consumeAuthQuery(): { authError: AuthError | null; isCallback: boolean } {
  if (typeof window === 'undefined') return { authError: null, isCallback: false }
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('authError')
  const isCallback = params.get('auth') === 'callback'
  if (raw == null && !isCallback) return { authError: null, isCallback: false }

  params.delete('authError')
  params.delete('auth')
  const query = params.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  )

  // A closed vocabulary: an unrecognised code degrades to the generic case
  // rather than rendering a URL-supplied string into the page.
  const parsed = AuthErrorSchema.safeParse(raw)
  return { authError: raw == null ? null : parsed.success ? parsed.data : 'generic', isCallback }
}

function Wizard() {
  const [authQuery] = useState(consumeAuthQuery)
  const [account, setAccount] = useState<AccountSummary | null>(null)
  const [authStart, setAuthStart] = useState<AuthStage>(
    authQuery.isCallback ? 'callback' : 'landing',
  )
  const [stage, setStage] = useState<Stage>('auth')

  const [source, setSource] = useState<CourseSummary | null>(null)
  const [target, setTarget] = useState<CourseSummary | null>(null)
  const [scan, setScan] = useState<PreflightResponse | null>(null)
  const [resolutions, setResolutions] = useState<Resolution[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [summary, setSummary] = useState<{
    status: TransferJobStatus
    items: TransferJobItemRow[]
  } | null>(null)
  const [error, setError] = useState<unknown>(null)
  /** Fix 1 — a real 409 whose fix is "re-scan", not the generic catch-all. */
  const [scanConflict, setScanConflict] = useState<ScanConflictKind | null>(null)
  /**
   * DEFER 2 — true only when THIS mount effect is the one that discovered the
   * in-flight job (F12 reconnect). Handed down so TransferProgress trusts
   * `jobId` instead of repeating the same `getActiveJob()` fetch.
   */
  const [reconnected, setReconnected] = useState(false)
  /** DEFER 3 — `signOut()` failed; the cookie may still be alive server-side. */
  const [signOutFailed, setSignOutFailed] = useState(false)

  const cold = useColdStart()

  /** Everything that must not survive an account switch or a fresh run. */
  const clearRun = useCallback(() => {
    setSource(null)
    setTarget(null)
    setScan(null)
    setResolutions([])
    setJobId(null)
    setSummary(null)
    setError(null)
    setScanConflict(null)
    setReconnected(false)
  }, [])

  // Mount: restore the session, then rediscover any in-flight job (F12).
  //
  // APPLY-N — `me()` resolves to `null` ONLY on 401, and that is the only case
  // that means "no session". Every other rejection is surfaced. Catching them
  // all as "signed out" parked the user on the landing screen with no
  // explanation after a 5xx, and treating a failed `getActiveJob()` as "no
  // active job" dropped them on Selection while a transfer was still running —
  // silently defeating the F12 reconnect guarantee this effect exists for.
  useEffect(() => {
    let live = true
    const controller = new AbortController() // APPLY-M
    me(controller.signal)
      .then(async (session) => {
        if (!live || !session) return
        setAccount(session.account)
        setStage('selection')
        const active = await getActiveJob(controller.signal)
        if (!live || !active) return
        setJobId(active)
        // DEFER 2 — this IS the reconnect discovery; TransferProgress must not
        // repeat it.
        setReconnected(true)
        setStage('transfer')
      })
      .catch((error: unknown) => {
        if (!live || isAbortError(error)) return
        setError(error)
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [])

  const handleSignedIn = (next: AccountSummary) => {
    clearRun()
    setAccount(next)
    setStage('selection')
  }

  /** Back to the sign-in landing, carrying nothing forward. Used by the 4a
   *  takeover and by both mid-transfer interrupt banners. */
  const returnToSignIn = () => {
    clearRun()
    setAccount(null)
    setAuthStart('landing')
    setStage('auth')
  }

  const switchAccount = () => {
    clearRun()
    setAccount(null)
    // "Switch account" re-enters at the landing screen: the account chooser is
    // Google's now, so there is no in-app picker to jump to.
    setAuthStart('landing')
    setStage('auth')
  }

  // DEFER 3 — a failed sign-out must not proceed as though it worked. The
  // cookie the server holds may still be alive, so this is a real notice, not
  // a fire-and-forget `.catch(() => {})` that silently lands on the sign-in
  // screen regardless of what the server actually did.
  const handleSignOut = () => {
    setSignOutFailed(false)
    signOut()
      .then(() => {
        clearRun()
        setAccount(null)
        setAuthStart('landing')
        setStage('auth')
      })
      .catch(() => {
        setSignOutFailed(true)
      })
  }

  const startTransfer = () => {
    if (!scan) return
    createTransferJob({ scanId: scan.scanId, resolutions })
      .then((result) => {
        // A 409 is not a failure: attach to the job already running (D5).
        setJobId(result.jobId)
        setStage('transfer')
      })
      .catch((err: unknown) => {
        // Fix 1 — `scan_stale` / `scan_already_used` are real 409s whose fix
        // is "re-scan", not the generic catch-all (APPLY-C / APPLY-I).
        if (err instanceof ApiRequestError && (err.code === 'scan_stale' || err.code === 'scan_already_used')) {
          setScanConflict(err.code)
          return
        }
        setError(err)
      })
  }

  const handleJobComplete = (status: TransferJobStatus) => {
    getJobItems(status.jobId)
      .then((res) => {
        setSummary({ status, items: res.items })
        setStage('summary')
      })
      .catch(setError)
  }

  const startAnother = () => {
    clearRun()
    setStage('selection')
  }

  /* ---- Error surfaces ------------------------------------------------ */

  if (cold.timedOut) {
    return (
      <div className="frame">
        <ErrorState
          detail="The server did not respond in time."
          onRetry={() => {
            coldStartStore.clearTimeout()
            setError(null)
          }}
          onStartOver={() => {
            coldStartStore.clearTimeout()
            startAnother()
          }}
        />
      </div>
    )
  }

  /**
   * 4a — the app's own session expired MID-WIZARD. Nothing durable has been
   * written yet at this point, so a full-screen takeover is honest and the
   * cheapest thing to reuse is `ErrorState`, already built for exactly this
   * shape of interrupt (recoverable, nothing lost, one clear next step).
   *
   * Mid-TRANSFER is a different matter — see 4b in TransferProgress, which
   * keeps the frozen progress bar on screen rather than replacing it.
   */
  const sessionExpired = error instanceof ApiRequestError && error.status === 401

  if (sessionExpired && stage !== 'transfer') {
    return (
      <div className="frame">
        <ErrorState
          detail="Your sign-in expired. Nothing was lost — sign in again to pick up where you left off."
          onRetry={returnToSignIn}
          onStartOver={returnToSignIn}
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="frame">
        <ErrorState onRetry={() => setError(null)} onStartOver={startAnother} />
      </div>
    )
  }

  // Fix 1 — dedicated copy for `scan_stale` / `scan_already_used`, with a
  // primary action that re-scans the SAME two courses (source/target are
  // untouched by this catch, so Pre-flight re-mounts against them).
  if (scanConflict) {
    return (
      <div className="frame">
        <ScanConflictNotice
          kind={scanConflict}
          onRescan={() => {
            setScanConflict(null)
            setStage('preflight')
          }}
        />
      </div>
    )
  }

  /* ---- The wizard ---------------------------------------------------- */

  return (
    <div className="frame">
      {account && stage !== 'auth' ? (
        <div className="header-bar" data-testid="account-header">
          <div className="header-account">
            <span className="avatar" aria-hidden="true">
              {account.initials}
            </span>
            <span>
              {account.displayName} &lt;{account.email}&gt;
            </span>
          </div>
          <div>
            <Button variant="link" onClick={switchAccount}>
              Switch account
            </Button>
            <Button variant="link" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      ) : null}

      {/* DEFER 3 — a failed sign-out gets a notice instead of proceeding as
          though it worked; the account header (and session) stays put. */}
      {signOutFailed ? (
        <NarrationBanner glyph="!">
          Signing out did not finish. The session may still be active — try Sign out again.
        </NarrationBanner>
      ) : null}

      {stage !== 'auth' ? <StepIndicator current={STEP_FOR[stage]} /> : null}

      {cold.coldStart ? <ColdStartOverlay /> : null}

      {stage === 'auth' ? (
        <AuthFlow
          onSignedIn={handleSignedIn}
          startAt={authStart}
          onError={setError}
          authError={authQuery.authError}
        />
      ) : null}

      {stage === 'selection' ? (
        <SelectionScreen
          onContinue={(nextSource, nextTarget) => {
            setSource(nextSource)
            setTarget(nextTarget)
            setStage('preflight')
          }}
        />
      ) : null}

      {stage === 'preflight' && source && target ? (
        <PreflightScreen
          sourceId={source.id}
          targetId={target.id}
          onReady={(result, chosen) => {
            setScan(result)
            setResolutions(chosen)
            setStage('ready')
          }}
          onCancel={() => setStage('selection')}
          onError={setError}
        />
      ) : null}

      {stage === 'ready' && scan ? (
        <ReadyToTransfer
          scan={scan}
          // Back re-validates by returning to Selection rather than trusting a
          // scan that may no longer describe the courses (02-ux-workflow.md §2).
          onBack={() => setStage('selection')}
          onStart={startTransfer}
        />
      ) : null}

      {stage === 'transfer' ? (
        <TransferProgress
          jobId={jobId}
          onComplete={handleJobComplete}
          onStartOver={startAnother}
          skipDiscovery={reconnected}
          sessionExpired={sessionExpired}
          onReconnect={returnToSignIn}
        />
      ) : null}

      {stage === 'summary' && summary ? (
        <CompletionSummary
          status={summary.status}
          items={summary.items}
          onOpenTargetCourse={() => {
            // Google Classroom's own canonical course URL. v1 opened
            // `/mock/courses/<id>`, a path this app never served — harmless
            // against a mock world, a 404 in a teacher's face the moment the
            // course is real, and a mock endpoint string in the production
            // bundle either way.
            window.open(
              `https://classroom.google.com/c/${encodeURIComponent(summary.status.targetCourseId)}`,
              '_blank',
              'noopener,noreferrer',
            )
          }}
          onStartAnother={startAnother}
        />
      ) : null}
    </div>
  )
}
