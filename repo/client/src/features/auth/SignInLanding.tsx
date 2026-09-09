/**
 * Screen 1a — the sign-in landing, re-authored in the token system.
 *
 * The version this replaces was written in Tailwind utility classes. This
 * project has no Tailwind, so every one of those classes was INERT: the screen
 * rendered as user-agent defaults, and the Google mark — a `viewBox`-only
 * `<svg>` with no width, no height, and no CSS to size it — stretched to fill
 * its containing block at 898x898px. That is why every inline `<svg>` here
 * carries explicit `width`/`height` attributes; it is a project-wide rule, not
 * a patch for this one icon.
 *
 * There is no account list. The account chooser is Google's, not ours.
 */
import { useEffect, useRef } from 'react'
import type { AuthError } from '@classroom-copier/shared'

export const TAGLINE =
  'Batch-copy your classwork into any existing course — without duplicating Drive files.'

/**
 * Replaces v1's "simulated accounts" disclaimer in the same typographic slot.
 * It is set BEFORE the redirect on purpose: once the browser is on Google's
 * domain this app can no longer narrate anything, so a teacher who has not been
 * warned reads a slow wake-up as a broken link (UX Delta P0-1).
 */
export const WARMUP_NOTE = 'First sign-in today can take up to a minute while the app wakes up.'

/**
 * One treatment, three copies (03-ui-direction.md §3.1). Distinguishable
 * wording matters — a teacher who hits the same failure twice needs to know it
 * is the same failure — but three different COLOURS would imply three
 * severities, and none of these lost any data.
 */
export const AUTH_ERROR_COPY: Record<AuthError, string> = {
  denied: "You didn't grant access, so we couldn't sign you in. Nothing was changed.",
  expired: 'This sign-in link has expired.',
  generic: 'Something went wrong signing in with Google.',
}

interface SignInLandingProps {
  onSignIn: () => void
  busy?: boolean
  authError?: AuthError | null
  /** 1g's optional support reference. Rendered de-emphasised, never as copy. */
  errorReference?: string | null
}

/**
 * Google's "G", at Google's published proportions. `aria-hidden` because the
 * button's own text already names the action — a second announcement of "G"
 * would be noise, not information.
 */
function GoogleGLogo() {
  return (
    <svg
      className="google-g-logo"
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0 0 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18A13.2 13.2 0 0 1 11 24c0-1.45.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  )
}

export function SignInLanding({
  onSignIn,
  busy = false,
  authError = null,
  errorReference = null,
}: SignInLandingProps) {
  const errorRef = useRef<HTMLDivElement>(null)

  /**
   * UI §6 / QA-4 — 1e/1f/1g move focus to the banner when it appears.
   *
   * `role="alert"` (below) announces it, which is not the same thing: a
   * screen-reader user was being told the sign-in failed and left standing at
   * the top of the document, with the wordmark, the tagline and the button
   * still between them and the sentence that had just been read out.
   *
   * Keyed on `authError`, not on mount: 1g arrives AFTER mount (the landing
   * renders clean, the teacher clicks, the fetch fails), so a mount-only effect
   * would cover two of the three states and miss the one that is reached by
   * using the screen. A null error focuses nothing — 1a is the ordinary
   * landing, not a new screen, and must leave focus where the browser put it.
   */
  useEffect(() => {
    if (authError) errorRef.current?.focus()
  }, [authError])

  return (
    <div className="signin-screen">
      <div className="wordmark">
        <span className="seal" aria-hidden="true" />
        Classroom Copier
      </div>
      <p className="signin-tag">{TAGLINE}</p>

      {/* A real <button>, not an <a> styled as one: this fires a fetch first
          (UX 1b) so the cold-start overlay can cover a sleeping server, and it
          is only after that answer that the browser leaves for Google. */}
      <button
        type="button"
        className="google-signin-btn"
        onClick={onSignIn}
        disabled={busy}
      >
        <GoogleGLogo />
        Sign in with Google
      </button>

      <div className="mock-note">{WARMUP_NOTE}</div>

      {authError ? (
        // role="alert", not "status": this appears in response to the teacher's
        // own action and needs to interrupt, not wait for a quiet moment.
        <div className="signin-error" role="alert" ref={errorRef} tabIndex={-1}>
          <span className="glyph" aria-hidden="true">
            !
          </span>
          <span>
            {AUTH_ERROR_COPY[authError]}
            {errorReference ? (
              <span className="ref">Reference: {errorReference} (for support, not required)</span>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  )
}
