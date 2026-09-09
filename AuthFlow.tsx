/**
 * The sign-in state machine: landing -> (Google's domain) -> callback landing.
 *
 * Two things about the shape of this file are deliberate.
 *
 * **The prop shape is `onSignedIn` / `startAt` / `onError`, restored from v1.**
 * `App.tsx` has always called it that way; a rewrite that made it a `{children}`
 * wrapper left every one of those props ignored, so the callback landing never
 * reported the session it had just confirmed.
 *
 * **The click fetches BEFORE it redirects** (UX 1b). Linking straight to Google
 * would be one fewer round trip and would also mean a sleeping Render service
 * shows the teacher nothing at all for up to a minute. Going through
 * `getGoogleAuthUrl()` puts that wait inside the app's existing cold-start
 * machinery, which is the only place it can be narrated — once the browser is
 * on accounts.google.com this app cannot say anything.
 *
 * The whole file is written in the design-token system. Its predecessor was
 * Tailwind, which this project does not have, so its `loading` branch rendered
 * an unstyled `<div>` reading "Loading Classroom Copier..." — the same defect
 * class as the 898px icon, just without a visible symptom.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountSummary, AuthError } from '@classroom-copier/shared'
import { SignInLanding } from './SignInLanding'
import { confirmSession, getGoogleAuthUrl, isAbortError } from '../../lib/api-client'

export type AuthStage = 'landing' | 'callback'

interface AuthFlowProps {
  onSignedIn: (account: AccountSummary) => void
  /**
   * `'callback'` is how `App.tsx` enters the return leg after Google redirects
   * back. `'landing'` is everything else, including the header's "Switch
   * account".
   */
  startAt?: AuthStage
  onError?: (error: unknown) => void
  /** From `?authError=` — a failed round trip returns HERE, never to a dead page. */
  authError?: AuthError | null
  /** Injected so a test can drive the redirect without navigating jsdom. */
  redirect?: (url: string) => void
}

const defaultRedirect = (url: string) => {
  window.location.assign(url)
}

export function AuthFlow({
  onSignedIn,
  startAt = 'landing',
  onError,
  authError = null,
  redirect = defaultRedirect,
}: AuthFlowProps) {
  const [stage, setStage] = useState<AuthStage>(startAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthError | null>(authError)
  // A round trip already in flight must not be started twice by a double click.
  const inFlight = useRef(false)
  /** UI §6 / QA-4 — 1d's focus target. */
  const titleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setError(authError)
  }, [authError])

  useEffect(() => {
    if (stage === 'callback') titleRef.current?.focus()
  }, [stage])

  const signIn = useCallback(() => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    getGoogleAuthUrl()
      .then(({ url }) => {
        // No state reset here on purpose. The browser is leaving; re-enabling
        // the button first would let a second click fire into a page that is
        // already navigating away.
        redirect(url)
      })
      .catch((caught: unknown) => {
        inFlight.current = false
        setBusy(false)
        if (isAbortError(caught)) return
        // 1g — the catch-all. The app could not even ask Google for a URL, so
        // there is nothing more specific to say.
        setError('generic')
        onError?.(caught)
      })
  }, [onError, redirect])

  // 1d — the return leg. The callback already set the session cookie
  // server-side; this confirms it and names the teacher.
  useEffect(() => {
    if (stage !== 'callback') return
    const controller = new AbortController()
    let live = true
    confirmSession(controller.signal)
      .then((session) => {
        if (!live) return
        if (session) {
          onSignedIn(session.account)
          return
        }
        // The redirect completed but no session came back. Never a dead page:
        // fall back to the landing screen with the expired-link copy, which is
        // what a reloaded or bookmarked callback URL actually is.
        setError('expired')
        setStage('landing')
      })
      .catch((caught: unknown) => {
        if (!live || isAbortError(caught)) return
        setError('generic')
        setStage('landing')
        onError?.(caught)
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [stage, onSignedIn, onError])

  if (stage === 'callback') {
    // Deliberately minimal and deliberately NOT given a slow-state of its own:
    // if this fetch passes 2s the app-wide ColdStartOverlay layers on top, the
    // same mechanism every other screen uses.
    return (
      <div className="signing-in">
        <div className="spinner" aria-hidden="true" />
        {/* UI §6 / QA-4 — 1d moves focus to its title on mount. This screen is
            reached by a full-page redirect back from Google, so the teacher
            arrives on a fresh document with focus at the top of `<body>`; the
            move is what puts a screen-reader user ON the one line this screen
            has to say. */}
        <div className="signing-in-title" role="status" ref={titleRef} tabIndex={-1}>
          Signing you in…
        </div>
      </div>
    )
  }

  return <SignInLanding onSignIn={signIn} busy={busy} authError={error} />
}
