/**
 * Sign-in, against the REAL Google flow.
 *
 * These cases replace v1's mock-account-picker suite, which asserted a screen
 * this phase deliberately removes: the account chooser is Google's now, and the
 * in-app picker was a mock-mode affordance that must not exist in a production
 * client bundle at all.
 *
 * The three failure states are covered because each one is a promise the UX
 * makes to a specific teacher in a specific hole — and because they are exactly
 * the paths nobody exercises by hand.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthFlow } from './AuthFlow'
import { AUTH_ERROR_COPY, TAGLINE, WARMUP_NOTE } from './SignInLanding'
import * as api from '../../lib/api-client'
import { expectNoSeriousViolations } from '../../components/shared/shared.a11y.test'

vi.mock('../../lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  )
  return {
    ...actual,
    confirmSession: vi.fn(),
  }
})

const JAMIE = {
  id: 'google-sub-jamie',
  displayName: 'Jamie Rivera',
  email: 'jamie.rivera@pickettusd.example',
  initials: 'JR',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.confirmSession).mockResolvedValue({ account: JAMIE })
})

describe('1a — the sign-in landing', () => {
  it('carries the wordmark, tagline, the Google CTA and the warm-up note', () => {
    const { container } = render(<AuthFlow onSignedIn={() => {}} />)
    expect(screen.getByText('Classroom Copier')).toBeInTheDocument()
    expect(container.querySelector('.wordmark .seal')).not.toBeNull()
    expect(screen.getByText(TAGLINE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument()
    // The reassurance line is set BEFORE the redirect, because after it this
    // app cannot narrate anything.
    expect(screen.getByText(WARMUP_NOTE)).toHaveClass('mock-note')
  })

  it('offers NO in-app account list — the chooser is Google’s', () => {
    render(<AuthFlow onSignedIn={() => {}} />)
    expect(screen.queryByRole('heading', { name: 'Choose an account' })).toBeNull()
    expect(screen.queryByText(/mock/i)).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('sizes the Google mark explicitly, which is what the 898px bug was', () => {
    const { container } = render(<AuthFlow onSignedIn={() => {}} />)
    const svg = container.querySelector('svg.google-g-logo')
    expect(svg).not.toBeNull()
    // A viewBox-only <svg> with no width/height stretches to fill its
    // containing block. Both attributes, asserted, not just the class.
    expect(svg!.getAttribute('width')).toBe('18')
    expect(svg!.getAttribute('height')).toBe('18')
  })
})

describe('1b — the pre-redirect warm-up', () => {
  it('starts OAuth with a top-level API redirect', async () => {
    const redirect = vi.fn()
    render(<AuthFlow onSignedIn={() => {}} redirect={redirect} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))

    await waitFor(() => expect(redirect).toHaveBeenCalledWith(`${api.API_BASE_URL}/api/auth/google/start`))
  })

  it('blocks a second click after navigation begins', async () => {
    const redirect = vi.fn()
    render(<AuthFlow onSignedIn={() => {}} redirect={redirect} />)
    const button = screen.getByRole('button', { name: 'Sign in with Google' })

    await userEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    await userEvent.click(button)

    expect(redirect).toHaveBeenCalledTimes(1)
  })
})

describe('1d — the callback landing', () => {
  it('shows "Signing you in…" and reports the confirmed account', async () => {
    const onSignedIn = vi.fn()
    render(<AuthFlow onSignedIn={onSignedIn} startAt="callback" />)

    expect(screen.getByText('Signing you in…')).toBeInTheDocument()
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(JAMIE))
  })

  it('gets NO bespoke slow-state — the app-wide cold-start overlay covers it', () => {
    // Asserted structurally: the callback landing reuses `.coldstart`'s layout
    // so the overlay replacing it at 2s is not a visual jump, and it must not
    // grow a second "still working…" string of its own.
    const { container } = render(<AuthFlow onSignedIn={() => {}} startAt="callback" />)
    expect(container.querySelector('.signing-in')).not.toBeNull()
    expect(container.querySelector('.spinner')).not.toBeNull()
    expect(screen.queryByText(/waking up/i)).toBeNull()
    expect(screen.queryByText(/50 seconds/i)).toBeNull()
  })

  it('never dead-ends: no session on the return leg falls back to 1f', async () => {
    vi.mocked(api.confirmSession).mockResolvedValue(null)
    render(<AuthFlow onSignedIn={() => {}} startAt="callback" />)

    // Exactly what a reloaded or bookmarked callback URL is.
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_COPY.expired)
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument()
  })
})

describe('1e / 1f / 1g — the three failure states', () => {
  const cases = [
    ['denied', AUTH_ERROR_COPY.denied],
    ['expired', AUTH_ERROR_COPY.expired],
    ['generic', AUTH_ERROR_COPY.generic],
  ] as const

  for (const [code, copy] of cases) {
    it(`renders "${code}" inline on the landing screen, never as a takeover`, () => {
      render(<AuthFlow onSignedIn={() => {}} authError={code} />)
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(copy)
      expect(alert).toHaveClass('signin-error')
      // The CTA is still right there — every failure path returns here with a
      // retry, never to a dead page.
      expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument()
    })
  }

  it('gives all three ONE treatment and three distinct copies', () => {
    const rendered = cases.map(([code]) => {
      const { container, unmount } = render(<AuthFlow onSignedIn={() => {}} authError={code} />)
      const alert = container.querySelector('.signin-error')!
      const result = { className: alert.className, text: alert.textContent }
      unmount()
      return result
    })
    // One visual treatment: three different colours would imply three
    // severities, and none of these lost any data.
    expect(new Set(rendered.map((r) => r.className)).size).toBe(1)
    // Three distinct copies: a teacher who hits the same failure twice has to
    // be able to tell it is the same failure.
    expect(new Set(rendered.map((r) => r.text)).size).toBe(3)
  })

  it('uses role="alert", not role="status"', () => {
    render(<AuthFlow onSignedIn={() => {}} authError="denied" />)
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert.getAttribute('role')).toBe('alert')
  })

})

/* ------------------------------------------------------------------ *
 * QA-4 — focus management on mount (03-ui-direction.md §6)
 * ------------------------------------------------------------------ */

/**
 * "1d/1e/1f/1g and 4a/4b/4c all move focus to their heading/banner on mount,
 * matching the existing pattern (Completion Summary heading, v1 §6)" — an
 * explicit, named acceptance point that was implemented for none of the six
 * screens. `role="alert"` announces without MOVING anyone, so a screen-reader
 * user was told something happened and left standing on `<body>`, with the rest
 * of the page still between them and the thing they were told about.
 *
 * Every case below asserts `document.activeElement` — the thing QA measured
 * live — and not merely the presence of a `tabIndex`, which is the assertion
 * that would pass against a component that never calls `.focus()`.
 */
describe('focus moves to the new screen on mount (UI §6)', () => {
  it('1d — the callback landing takes focus on its title', () => {
    render(<AuthFlow onSignedIn={() => {}} startAt="callback" />)
    const title = screen.getByText('Signing you in…')
    expect(document.activeElement).toBe(title)
    // Programmatically focusable but not a tab stop: it is not a control.
    expect(title.getAttribute('tabindex')).toBe('-1')
  })

  for (const code of ['denied', 'expired', 'generic'] as const) {
    it(`1e/1f/1g — the "${code}" banner takes focus when it appears`, () => {
      render(<AuthFlow onSignedIn={() => {}} authError={code} />)
      expect(document.activeElement).toBe(screen.getByRole('alert'))
    })
  }

  it('does NOT steal focus on a clean landing screen, which is not a new screen', () => {
    // The rule is "on mount of one of the six named screens", not "on every
    // render". 1a with no error is the ordinary landing and must leave focus
    // where the browser put it.
    render(<AuthFlow onSignedIn={() => {}} authError={null} />)
    expect(document.activeElement).toBe(document.body)
  })

  it('moves focus when the banner appears AFTER mount, not only when it is there first', async () => {
    const { rerender } = render(<AuthFlow onSignedIn={() => {}} authError={null} />)
    expect(document.activeElement).toBe(document.body)

    rerender(<AuthFlow onSignedIn={() => {}} authError="generic" />)
    const alert = await screen.findByRole('alert')
    await waitFor(() => expect(document.activeElement).toBe(alert))
  })
})

/* ------------------------------------------------------------------ *
 * a11y (§8.4a) — the sign-in screen is IN SCOPE for the existing budget
 * ------------------------------------------------------------------ */

describe('the sign-in screen passes an axe audit with no critical/serious violations', () => {
  for (const state of [null, 'denied', 'expired', 'generic'] as const) {
    it(`landing${state ? ` with the "${state}" banner` : ''}`, async () => {
      const { container } = render(<AuthFlow onSignedIn={() => {}} authError={state} />)
      await expectNoSeriousViolations(container)
    })
  }

  it('the callback landing', async () => {
    const { container } = render(<AuthFlow onSignedIn={() => {}} startAt="callback" />)
    await expectNoSeriousViolations(container)
  })

  /**
   * §8.4a's ruling, tested rather than assumed. Google's button is a documented
   * exemption from THIS PRODUCT'S contrast tokens — and only from those, and
   * only for its own text-on-fill pair. Everything else the budget cares about
   * still applies, so it is asserted here instead of waved through.
   *
   * MANUAL-VERIFY resolved, arithmetically, in `styles/contrast.a11y.test.ts`:
   * Google's spec at these sizes is #1F1F1F on #FFFFFF,
   * which is 16.5:1 — it PASSES WCAG AA comfortably, so no `color-contrast`
   * suppression was added. A suppression for a violation that never fires would
   * be its own kind of lie.
   */
  it('gives the Google button a real accessible name, a real <button>, and no aria-hidden label', () => {
    const { container } = render(<AuthFlow onSignedIn={() => {}} />)
    const button = screen.getByRole('button', { name: 'Sign in with Google' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-hidden')).toBeNull()
    // The mark is decorative; the label is not.
    expect(container.querySelector('.google-g-logo')!.getAttribute('aria-hidden')).toBe('true')
    expect(button.textContent).toContain('Sign in with Google')
  })
})
