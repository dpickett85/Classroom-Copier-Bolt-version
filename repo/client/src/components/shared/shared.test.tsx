import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  Badge,
  Button,
  COLD_START_SUBLINE,
  COLD_START_TITLE,
  ColdStartOverlay,
  DUPLICATE_GLYPH,
  DUPLICATE_LABEL,
  DUPLICATE_RUN_NOTICE,
  Disclosure,
  ErrorState,
  NarrationBanner,
  OUTCOME_LABEL,
  OutcomeIcon,
  OutcomePill,
  RATE_LIMIT_NOTICE,
  StepIndicator,
  outcomeText,
} from './index'
import {
  OutcomeSchema,
  SkipReasonSchema,
  isDuplicateSkip,
  isUserSkip,
} from '@classroom-copier/shared'
import type { Outcome } from '@classroom-copier/shared'

describe('ColdStartOverlay', () => {
  it('is a polite status region carrying the pinned copy', () => {
    render(<ColdStartOverlay />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent(COLD_START_TITLE)
    expect(status).toHaveTextContent(COLD_START_SUBLINE)
    expect(COLD_START_TITLE).toBe('Waking up server…')
    expect(COLD_START_SUBLINE).toBe('This can take up to 50 seconds the first time.')
  })

  it('announces once — the region text does not change as time passes', () => {
    const { rerender } = render(<ColdStartOverlay />)
    const before = screen.getByRole('status').textContent
    for (let i = 0; i < 10; i += 1) rerender(<ColdStartOverlay />)
    expect(screen.getByRole('status').textContent).toBe(before)
  })

  it('renders a static equivalent under prefers-reduced-motion', () => {
    const matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    vi.stubGlobal('matchMedia', matchMedia)
    const { container } = render(<ColdStartOverlay />)
    expect(container.querySelector('.spinner-static')).not.toBeNull()
    expect(container.querySelector('.spinner')).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('NarrationBanner', () => {
  it('is an inline banner, never a modal interrupt', () => {
    render(<NarrationBanner glyph="i">{DUPLICATE_RUN_NOTICE}</NarrationBanner>)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(DUPLICATE_RUN_NOTICE)).toBeInTheDocument()
  })

  /**
   * QA-2 — this case previously asserted v1's warning verbatim ("…does not
   * check for existing copies yet") and cited the v1 scenario, so it passed
   * green while pinning the literal opposite of what this phase shipped. It now
   * asserts the reassurance copy UX Decision 11 / Acceptance Scenario 16
   * require, and — this is the part that makes it stronger than a swapped
   * literal — it separately asserts the CLAIM, so no future rewording can
   * reintroduce a sentence that says the check does not exist.
   */
  it('carries the duplicate-skip reassurance copy, not v1s warning (Scenario 16)', () => {
    expect(DUPLICATE_RUN_NOTICE).toBe(
      'Classroom Copier checks for items that already exist and skips them — safe to run more than once. ' +
        'Matches are found by title, so content changes since the last run aren’t detected.',
    )

    // The claim, independent of the wording: it says the check happens…
    expect(DUPLICATE_RUN_NOTICE).toMatch(/checks for items that already exist/i)
    expect(DUPLICATE_RUN_NOTICE).toMatch(/safe to run more than once/i)
    // …and it never says the opposite, in any of the shapes v1's copy took.
    expect(DUPLICATE_RUN_NOTICE).not.toMatch(/creates duplicate/i)
    expect(DUPLICATE_RUN_NOTICE).not.toMatch(/does not check|doesn’t check|doesn't check/i)
    expect(DUPLICATE_RUN_NOTICE, 'a "…yet" clause is v1 copy describing behaviour that now exists').not.toMatch(
      /\byet\b/i,
    )
    // Register per 03-ui-direction §4: plainspoken, no exclamation points.
    expect(DUPLICATE_RUN_NOTICE).not.toContain('!')
    // The honest limit is still stated — reassurance is not a promise it
    // detects edits (PM §6.7 non-goal).
    expect(DUPLICATE_RUN_NOTICE).toMatch(/title/i)

    expect(RATE_LIMIT_NOTICE(8)).toContain('retrying automatically in 8s')
    expect(RATE_LIMIT_NOTICE(8)).not.toBe(DUPLICATE_RUN_NOTICE)
  })

  it('renders the reassurance variant with its own styling hook, not the warning treatment', () => {
    // The amber `.notice` treatment IS the warning, in the other medium: the
    // copy flipped to reassurance and the colour would otherwise still say
    // "careful". The reassurance variant uses the same teal pairing the
    // "Already in course" outcome pill uses, so the banner and the outcome it
    // describes read as the same thing.
    const { container } = render(
      <NarrationBanner glyph="i" variant="reassurance">
        {DUPLICATE_RUN_NOTICE}
      </NarrationBanner>,
    )
    expect(container.querySelector('.reassurance-banner')).not.toBeNull()
    expect(container.querySelector('.notice')).toBeNull()
  })

  it('renders the rate-limit variant with its own styling hook', () => {
    const { container } = render(
      <NarrationBanner glyph="⏱" variant="rate-banner">
        {RATE_LIMIT_NOTICE(3)}
      </NarrationBanner>,
    )
    expect(container.querySelector('.rate-banner')).not.toBeNull()
  })
})

describe('StepIndicator', () => {
  const LABELS = ['1 Select', '2 Pre-flight', '3 Transfer', '4 Summary']

  it('renders the four steps in order', () => {
    render(<StepIndicator current={1} />)
    LABELS.forEach((label) => expect(screen.getByText(label)).toBeInTheDocument())
  })

  it('is non-interactive — no links, no buttons', () => {
    const { container } = render(<StepIndicator current={3} />)
    expect(container.querySelectorAll('a, button')).toHaveLength(0)
  })

  it('marks the current step with aria-current="step" and nothing else', () => {
    render(<StepIndicator current={3} />)
    const current = screen.getByText('3 Transfer')
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('2 Pre-flight')).not.toHaveAttribute('aria-current')
    expect(screen.getByText('4 Summary')).not.toHaveAttribute('aria-current')
  })
})

describe('OutcomeIcon (D30)', () => {
  const OUTCOMES: Outcome[] = ['transferred', 'fallback_shell', 'skipped']

  it.each(OUTCOMES)('%s has a non-empty accessible name', (outcome) => {
    render(<OutcomeIcon outcome={outcome} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAccessibleName(OUTCOME_LABEL[outcome])
    expect(OUTCOME_LABEL[outcome].length).toBeGreaterThan(0)
  })

  it.each(OUTCOMES)('%s renders its text label in the DOM, not the glyph alone', (outcome) => {
    const { container } = render(<OutcomeIcon outcome={outcome} />)
    expect(within(container).getByText(OUTCOME_LABEL[outcome])).toBeInTheDocument()
  })

  it('keeps the label when the label is visually hidden', () => {
    const { container } = render(<OutcomeIcon outcome="skipped" labelVisibility="sr-only" />)
    const label = within(container).getByText(OUTCOME_LABEL.skipped)
    expect(label).toHaveClass('sr-only')
    expect(screen.getByRole('img')).toHaveAccessibleName(OUTCOME_LABEL.skipped)
  })

  it('has no prop that suppresses the label — passing plausible suppressors changes nothing', () => {
    const hostile = {
      outcome: 'transferred',
      hideLabel: true,
      iconOnly: true,
      showLabel: false,
      noLabel: true,
      label: '',
      'aria-label': '',
    } as unknown as { outcome: Outcome }
    render(<OutcomeIcon {...hostile} />)
    expect(screen.getByRole('img')).toHaveAccessibleName(OUTCOME_LABEL.transferred)
    expect(screen.getByText(OUTCOME_LABEL.transferred)).toBeInTheDocument()
  })

  it('declares no icon-only mode in its source', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/shared/OutcomeIcon.tsx'),
      'utf8',
    )
    expect(source).not.toMatch(/hideLabel|iconOnly|noLabel|labelless|withoutLabel/i)
  })
})

describe('OutcomePill', () => {
  it.each([
    ['transferred', 'Transferred', 'outcome-transferred'],
    ['fallback_shell', 'Fallback', 'outcome-fallback'],
    ['skipped', 'Skipped', 'outcome-skipped'],
  ] as const)('%s renders text plus a colour class, never colour alone', (outcome, text, cls) => {
    render(<OutcomePill outcome={outcome} />)
    const pill = screen.getByText(text)
    expect(pill).toHaveClass('outcome-pill')
    expect(pill).toHaveClass(cls)
  })
})

describe('Button', () => {
  it('renders a primary button that calls its handler', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Continue →</Button>)
    const button = screen.getByRole('button', { name: 'Continue →' })
    expect(button).toHaveClass('btn-primary')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire when disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Continue →
      </Button>,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders secondary and link variants', () => {
    const { container } = render(
      <>
        <Button variant="secondary">Back</Button>
        <Button variant="link">Sign out</Button>
      </>,
    )
    expect(container.querySelector('.btn-secondary')).not.toBeNull()
    expect(container.querySelector('.link-btn')).not.toBeNull()
  })
})

describe('Badge', () => {
  it.each([
    ['active', 'Active', 'badge-active'],
    ['archived', 'Archived', 'badge-archived'],
    ['sis', 'SIS Roster Shell', 'badge-sis'],
  ] as const)('%s renders as a stamped tag', (kind, text, cls) => {
    render(<Badge kind={kind} />)
    const badge = screen.getByText(text)
    expect(badge).toHaveClass('badge')
    expect(badge).toHaveClass(cls)
  })
})

describe('ErrorState', () => {
  it('says what happened without blaming the user, and offers Retry / Start Over', async () => {
    const onRetry = vi.fn()
    const onStartOver = vi.fn()
    render(<ErrorState onRetry={onRetry} onStartOver={onStartOver} />)

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    const body = screen.getByTestId('error-state').textContent ?? ''
    expect(body).not.toMatch(/\byou(r)?\s+(mistake|error|fault)\b/i)
    expect(body).not.toContain('!')

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start Over' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onStartOver).toHaveBeenCalledTimes(1)
  })

  it('shows an optional detail line', () => {
    render(<ErrorState onRetry={() => {}} onStartOver={() => {}} detail="The server did not respond in time." />)
    expect(screen.getByText('The server did not respond in time.')).toBeInTheDocument()
  })

  /**
   * Fix 2 — this is the app-wide catch-all (App.tsx's bare `if (error)`
   * branch renders it with no `detail` at all), yet the body copy hard-coded
   * "the transfer" and "the itemized log" — wrong for a session-load failure,
   * an active-job lookup failure, or a render-time crash on Selection, none
   * of which involve a transfer or a log. The default body must stay generic.
   */
  it('keeps the default body generic rather than assuming a transfer/log context that is not always true', () => {
    const { rerender } = render(<ErrorState onRetry={() => {}} onStartOver={() => {}} />)
    let body = screen.getByTestId('error-state').textContent ?? ''
    expect(body).not.toMatch(/the transfer/i)
    expect(body).not.toMatch(/itemized log/i)

    rerender(<ErrorState onStartOver={() => {}} />)
    body = screen.getByTestId('error-state').textContent ?? ''
    expect(body).not.toMatch(/the transfer/i)
    expect(body).not.toMatch(/itemized log/i)
  })

  /**
   * QA-4 / 03-ui-direction.md §6 — screen 4a (session expired mid-wizard)
   * "reuses the existing `.error-state` combination verbatim" (UI §7.7), so the
   * focus-on-mount that §6 requires of 4a belongs here, on the component 4a
   * actually is. This screen REPLACES the one the teacher was on: leaving focus
   * on a control that no longer exists is the worst of the six cases, because
   * the browser drops it to `<body>` and the next Tab starts from the top of a
   * page whose content just changed entirely.
   *
   * Asserted on `document.activeElement` — the measurement QA took live — not
   * on the presence of a tabIndex.
   */
  it('takes focus on its heading when it mounts (UI §6, screen 4a)', () => {
    render(<ErrorState onRetry={() => {}} onStartOver={() => {}} />)
    const heading = screen.getByRole('heading', { name: 'Something went wrong' })
    expect(document.activeElement).toBe(heading)
    expect(heading.getAttribute('tabindex')).toBe('-1')
  })
})

/* ------------------------------------------------------------------ *
 * Decision G — the duplicate treatment on OutcomeIcon / OutcomePill
 * ------------------------------------------------------------------ */

describe('the duplicate outcome treatment (§3.3)', () => {
  it('is ADDITIVE — an existing call site that passes no skipReason is unchanged', () => {
    const { container: withoutProp } = render(<OutcomePill outcome="skipped" />)
    const { container: withNull } = render(<OutcomePill outcome="skipped" skipReason={null} />)
    expect(withoutProp.innerHTML).toBe(withNull.innerHTML)
    expect(withoutProp.querySelector('.outcome-pill')).toHaveTextContent('Skipped')
  })

  it('renders "Already in course" with the teal treatment for duplicate_title', () => {
    const { container } = render(
      <OutcomePill outcome="skipped" skipReason="duplicate_title" />,
    )
    const pill = container.querySelector('.outcome-pill')!
    expect(pill).toHaveTextContent('Already in course')
    expect(pill).toHaveClass('outcome-duplicate')
  })

  it('gives the icon its own glyph AND its own text label, never colour alone', () => {
    const { container } = render(
      <OutcomeIcon outcome="skipped" skipReason="duplicate_title" />,
    )
    expect(container.querySelector('.ticker-icon')).toHaveTextContent(DUPLICATE_GLYPH)
    expect(container.querySelector('.ticker-icon')).toHaveClass('icon-duplicate')
    // The accessible name and the visible label are the text, not the glyph.
    expect(screen.getByRole('img', { name: DUPLICATE_LABEL })).toBeInTheDocument()
  })

  it('leaves the three system-interrupted reasons on the existing generic treatment', () => {
    // Out of this phase's scope, per PM §6 / UX §3: only the duplicate-vs-user
    // distinction is in scope, and widening it silently would be scope creep
    // wearing a bug fix's clothes.
    for (const reason of ['provider_error', 'server_interrupted', 'rate_limit_exhausted'] as const) {
      const { container, unmount } = render(<OutcomePill outcome="skipped" skipReason={reason} />)
      const pill = container.querySelector('.outcome-pill')!
      expect(pill, reason).toHaveTextContent('Skipped')
      expect(pill, reason).toHaveClass('outcome-skipped')
      unmount()
    }
  })

  it('routes every consumer through ONE label function', () => {
    // F2 — this used to assert five hardcoded literals and never render a pill,
    // so a SECOND implementation inside `OutcomePill` that happened to agree on
    // those five would have kept it green. It now renders the pill for EVERY
    // member of the enum and compares against the label function's own answer,
    // whatever that answer is: the claim is "one function", not "these strings".
    for (const reason of SkipReasonSchema.options) {
      const { container, unmount } = render(<OutcomePill outcome="skipped" skipReason={reason} />)
      expect(container.querySelector('.outcome-pill'), reason).toHaveTextContent(
        outcomeText('skipped', reason),
      )
      unmount()
    }
    for (const outcome of OutcomeSchema.options) {
      const { container, unmount } = render(<OutcomePill outcome={outcome} />)
      expect(container.querySelector('.outcome-pill'), outcome).toHaveTextContent(
        outcomeText(outcome, null),
      )
      unmount()
    }
  })

  it('partitions skip reasons by the SHARED predicates, not by its own list (F4)', () => {
    // The server fills `skippedByUser` from `isUserSkip`. When the client
    // re-implemented the same partition as a hardcoded if-chain, a new
    // user-skip reason would have been counted by one and rendered as a generic
    // "Skipped" by the other, with no test red anywhere.
    for (const reason of SkipReasonSchema.options) {
      const label = outcomeText('skipped', reason)
      if (isDuplicateSkip(reason)) {
        expect(label, reason).toBe('Already in course')
      } else if (isUserSkip(reason)) {
        expect(label, reason).toBe('Skipped — you chose to skip')
      } else {
        expect(label, reason).toBe(outcomeText('skipped', null))
      }
    }
  })
})

describe('Disclosure', () => {
  it('is collapsed by default and carries the state as text', () => {
    render(
      <Disclosure summary="Two items" data-testid="d">
        <div>body</div>
      </Disclosure>,
    )
    const panel = screen.getByTestId('d') as HTMLDetailsElement
    expect(panel.open).toBe(false)
    expect(screen.getByText('[expand]')).toBeInTheDocument()
    expect(screen.getByText('[collapse]')).toBeInTheDocument()
  })

  it('honours defaultOpen', () => {
    render(
      <Disclosure summary="Two items" defaultOpen data-testid="d">
        <div>body</div>
      </Disclosure>,
    )
    expect((screen.getByTestId('d') as HTMLDetailsElement).open).toBe(true)
  })
})
