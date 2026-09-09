/**
 * UX Acceptance Scenarios 7 (live counter), 9 (rate-limit pause) and 18
 * (reconnect). Plus D12 (`failed` renders an error state, not a frozen bar) and
 * D30 (outcome icons carry a text alternative).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransferJobStatus } from '@classroom-copier/shared'
import { TransferProgress } from './TransferProgress'
import * as api from '../../lib/api-client'

vi.mock('../../lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  )
  return { ...actual, getActiveJob: vi.fn(), pollJobStatus: vi.fn() }
})

function status(overrides: Partial<TransferJobStatus> = {}): TransferJobStatus {
  return {
    jobId: 'job-1',
    status: 'running',
    sourceCourseName: 'US History (2025)',
    targetCourseName: 'US History — Period 3',
    targetCourseId: 'c-target',
    totalItems: 50,
    totalPostsScanned: 50,
    pending: 50,
    transferred: 0,
    fallbackShell: 0,
    skippedTotal: 0,
    skippedByUser: 0,
    skippedBySystem: 0,
    skippedDuplicate: 0,
    topicsCreatedOrMapped: 0,
    topicsCreatedCount: 0,
    topicsReusedCount: 0,
    googleReauthRequired: false,
    rubricNotesAdded: 0,
    currentItem: null,
    rateLimitPause: null,
    cancelRequested: false,
    cancelledAt: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

/** Captures the callbacks the component hands to `pollJobStatus`. */
let emit: (s: TransferJobStatus) => void
/** P0-5 — the poll has exhausted its bounded retries and given up. */
let emitPollFailure: (error: unknown) => void
let polledJobIds: string[]

beforeEach(() => {
  vi.clearAllMocks()
  polledJobIds = []
  emit = () => {}
  emitPollFailure = () => {}
  vi.mocked(api.getActiveJob).mockResolvedValue(null)
  vi.mocked(api.pollJobStatus).mockImplementation((jobId, onTick, onError) => {
    polledJobIds.push(jobId)
    emit = onTick
    emitPollFailure = (error) => onError?.(error)
    return () => {}
  })
})

async function mount(props: Partial<Parameters<typeof TransferProgress>[0]> = {}) {
  const onComplete = vi.fn()
  const view = render(
    <TransferProgress
      jobId="job-1"
      onComplete={onComplete}
      onStartOver={vi.fn()}
      {...props}
    />,
  )
  await waitFor(() => expect(api.pollJobStatus).toHaveBeenCalled())
  return { ...view, onComplete }
}

describe('Batch Transfer Progress', () => {
  it('shows the mono fraction counter (Scenario 7)', async () => {
    await mount()
    act(() => emit(status({ pending: 19, transferred: 30, fallbackShell: 1 })))
    expect(screen.getByText('Transferring 31 of 50 posts…')).toBeInTheDocument()
  })

  /* ---------------------------------------------------------------- *
   * The mid-transfer Cancel control — the partial-completion contract.
   * One click reveals an in-register confirm (never `window.confirm()`);
   * confirming POSTs the cancel and lets the poll loop carry the screen to
   * its normal terminal transition.
   * ---------------------------------------------------------------- */

  it('offers a Cancel transfer control while the job is running', async () => {
    await mount()
    act(() => emit(status({ pending: 20, transferred: 30 })))
    expect(screen.getByRole('button', { name: 'Cancel transfer' })).toBeInTheDocument()
  })

  it('one click reveals an in-register confirm, never the browser confirm()', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    await mount()
    act(() => emit(status({ pending: 20, transferred: 30 })))

    await userEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }))

    expect(screen.getByText('Cancel the remaining posts?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel remaining posts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep going' })).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('"Keep going" dismisses the confirm without posting anything', async () => {
    const cancelSpy = vi.spyOn(api, 'cancelTransferJob')
    await mount()
    act(() => emit(status({ pending: 20, transferred: 30 })))

    await userEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Keep going' }))

    expect(screen.queryByText('Cancel the remaining posts?')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel transfer' })).toBeInTheDocument()
    expect(cancelSpy).not.toHaveBeenCalled()
  })

  it('confirming POSTs the cancel for the polled job', async () => {
    const cancelSpy = vi
      .spyOn(api, 'cancelTransferJob')
      .mockResolvedValue({ jobId: 'job-1', cancelRequested: true })
    await mount()
    act(() => emit(status({ pending: 20, transferred: 30 })))

    await userEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel remaining posts' }))

    expect(cancelSpy).toHaveBeenCalledWith('job-1')
  })

  it('transitions to the normal completion callback once the drained job reports terminal (cancelledAt set)', async () => {
    vi.spyOn(api, 'cancelTransferJob').mockResolvedValue({ jobId: 'job-1', cancelRequested: true })
    const { onComplete } = await mount()
    act(() => emit(status({ pending: 20, transferred: 30 })))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel remaining posts' }))

    act(() =>
      emit(
        status({
          status: 'completed',
          pending: 0,
          transferred: 30,
          skippedTotal: 20,
          skippedByUser: 20,
          cancelRequested: true,
          cancelledAt: '2026-08-14T18:05:00.000Z',
        }),
      ),
    )

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0]![0]).toMatchObject({ cancelledAt: '2026-08-14T18:05:00.000Z' })
  })

  it('never lets the progress bar reverse or reset', async () => {
    const { container } = await mount()
    act(() => emit(status({ pending: 10, transferred: 40 })))
    const width = () => (container.querySelector('.progress-fill') as HTMLElement).style.width

    expect(width()).toBe('80%')
    // A tick that reports fewer resolved items (a stale or re-read poll) must
    // not walk the bar backwards.
    act(() => emit(status({ pending: 30, transferred: 20 })))
    expect(width()).toBe('80%')
  })

  it('gives every ticker outcome icon a text alternative (D30)', async () => {
    const { container } = await mount()
    act(() =>
      emit(
        status({
          pending: 47,
          transferred: 3,
          currentItem: { title: 'Week 3 Reading', outcome: 'transferred', skipReason: null },
        }),
      ),
    )
    act(() =>
      emit(
        status({
          pending: 46,
          transferred: 3,
          fallbackShell: 1,
          currentItem: { title: 'Essay 1', outcome: 'fallback_shell', skipReason: null },
        }),
      ),
    )
    act(() =>
      emit(
        status({
          pending: 45,
          transferred: 3,
          fallbackShell: 1,
          skippedTotal: 1,
          skippedByUser: 1,
          currentItem: { title: 'Bonus Worksheet', outcome: 'skipped', skipReason: 'user_skip_post' },
        }),
      ),
    )

    const ticker = container.querySelector('.ticker') as HTMLElement
    const icons = within(ticker).getAllByRole('img')
    expect(icons).toHaveLength(3)
    icons.forEach((icon) => expect(icon.getAttribute('aria-label')).toBeTruthy())
    expect(within(ticker).getByText('fallback shell')).toBeInTheDocument()
    expect(within(ticker).getByText('skipped')).toBeInTheDocument()
  })

  it('throttles the aria-live region — 20 ticks must not be 20 announcements', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await mount()

    const live = screen.getByTestId('progress-live-region')
    const announcements = new Set<string>()
    for (let i = 1; i <= 20; i += 1) {
      act(() =>
        emit(
          status({
            pending: 50 - i,
            transferred: i,
            currentItem: { title: `Post ${i}`, outcome: 'transferred', skipReason: null },
          }),
        ),
      )
      const text = live.textContent ?? ''
      if (text.length > 0) announcements.add(text)
    }

    expect(announcements.size).toBeLessThanOrEqual(3)
    expect(announcements.size).toBeLessThan(20)
    vi.useRealTimers()
  })

  it('announces once on completion', async () => {
    const { onComplete } = await mount()
    act(() =>
      emit(status({ status: 'completed', pending: 0, transferred: 48, fallbackShell: 1, skippedTotal: 1 })),
    )
    expect(screen.getByTestId('progress-live-region')).toHaveTextContent(
      'Transfer complete. 50 of 50 posts processed.',
    )
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  })

  it('narrates a rate-limit pause with a live countdown and freezes the bar (Scenario 9)', async () => {
    const { container } = await mount()
    act(() => emit(status({ pending: 19, transferred: 31 })))
    const frozenWidth = (container.querySelector('.progress-fill') as HTMLElement).style.width

    act(() =>
      emit(
        status({
          pending: 19,
          transferred: 31,
          rateLimitPause: { retryInMs: 8000, attempt: 2, itemTitle: 'Quiz: Ch. 2' },
        }),
      ),
    )
    expect(screen.getByText(/retrying automatically in 8s/)).toBeInTheDocument()
    expect(container.querySelector('.rate-banner')).not.toBeNull()
    expect((container.querySelector('.progress-fill') as HTMLElement).style.width).toBe(frozenWidth)
  })

  it('renders the error state, not a frozen progress bar, when the job fails (D12)', async () => {
    const { container } = await mount()
    act(() => emit(status({ pending: 12, transferred: 38 })))
    act(() => emit(status({ status: 'failed', pending: 12, transferred: 38 })))

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(container.querySelector('.progress-fill')).toBeNull()
    expect(container.querySelector('.progress-track')).toBeNull()
  })

  /* ---------------------------------------------------------------- *
   * P0-5 — the two dead ends on that error state.
   *
   * `onRetry` used to be wired to `setStage('transfer')` while the stage was
   * ALREADY `'transfer'`: a React no-op. Clicking Retry did literally nothing,
   * and no test clicked it — the render was asserted, the behaviour was not.
   * ---------------------------------------------------------------- */

  it('offers a Retry that genuinely restarts the poll after it gives up (P0-5)', async () => {
    await mount()
    expect(polledJobIds).toHaveLength(1)
    expect(screen.queryByTestId('error-state')).toBeNull()

    act(() => emitPollFailure(new Error('the poll exhausted its retries')))
    const retry = await screen.findByRole('button', { name: 'Retry' })

    await userEvent.click(retry)

    // The button DID something: a second poll loop is running and the error
    // state is gone.
    await waitFor(() => expect(polledJobIds).toHaveLength(2))
    expect(screen.queryByTestId('error-state')).toBeNull()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('offers no Retry when the JOB failed server-side, and Start Over routes onward (P0-5)', async () => {
    const onStartOver = vi.fn()
    await mount({ onStartOver })
    act(() => emit(status({ status: 'failed', pending: 12, transferred: 38 })))

    expect(screen.getByTestId('error-state')).toBeInTheDocument()
    // Retrying a terminally failed job re-reads `failed`. A button that cannot
    // succeed is worse than no button.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Start Over' }))
    expect(onStartOver).toHaveBeenCalledTimes(1)
  })

  it('resumes an in-flight job discovered on mount rather than restarting it (Scenario 18 / F12)', async () => {
    vi.mocked(api.getActiveJob).mockResolvedValue('job-77')
    render(
      <TransferProgress jobId={null} onComplete={vi.fn()} onStartOver={vi.fn()} />,
    )
    await waitFor(() => expect(api.pollJobStatus).toHaveBeenCalled())
    expect(polledJobIds).toEqual(['job-77'])
  })

  it('polls the job it was handed when nothing else is in flight', async () => {
    vi.mocked(api.getActiveJob).mockResolvedValue(null)
    await mount({ jobId: 'job-5' })
    expect(polledJobIds).toEqual(['job-5'])
  })
})

/* ------------------------------------------------------------------ *
 * 4b / 4c — the two mid-transfer interrupt banners (UI §3.5)
 * ------------------------------------------------------------------ */

describe('mid-transfer interrupt banners', () => {
  it('4b: an expired app session keeps the frozen progress bar on screen', async () => {
    await mount({ sessionExpired: true })
    act(() => emit(status({ pending: 20, transferred: 30 })))

    const banner = screen.getByTestId('session-expired-banner')
    expect(banner).toHaveClass('interrupt-banner')
    // It sits WITH the progress bar rather than replacing the screen — the
    // teacher has to be able to see how far the transfer got.
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: 'Sign in again' })).toBeInTheDocument()
  })

  it('4c: a Google reconnect banner appears from the status flag alone', async () => {
    await mount()
    act(() => emit(status({ pending: 20, transferred: 30, googleReauthRequired: true })))

    const banner = screen.getByTestId('google-reconnect-banner')
    expect(banner).toHaveClass('interrupt-banner')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(
      within(banner).getByRole('button', { name: 'Reconnect Google account' }),
    ).toBeInTheDocument()
  })

  /**
   * UX Decision 10 — 4b and 4c must be tellable apart WITHOUT reading the body
   * copy. Asserted on the heading, the glyph and the button label separately,
   * because "they look different" is satisfied by any one of the three and the
   * requirement is all three.
   */
  it('4b and 4c differ in heading, glyph AND button label', async () => {
    // F3 — the heading is read from `span:last-child`, NOT from
    // `.interrupt-head`'s whole textContent. That container also holds the
    // glyph, so the "headings differ" assertion used to be satisfied by the
    // glyph difference alone — the any-one-of-three outcome this test's own
    // docblock rules out, and the one it was written to catch.
    const headingOf = (banner: HTMLElement) =>
      banner.querySelector('.interrupt-head span:last-child')!.textContent
    const glyphOf = (banner: HTMLElement) =>
      banner.querySelector('.interrupt-head span')!.textContent

    const first = await mount({ sessionExpired: true })
    act(() => emit(status({ googleReauthRequired: false })))
    const b = screen.getByTestId('session-expired-banner')
    const bHead = headingOf(b)
    const bGlyph = glyphOf(b)
    const bButton = within(b).getByRole('button').textContent
    first.unmount()

    await mount()
    act(() => emit(status({ googleReauthRequired: true })))
    const c = screen.getByTestId('google-reconnect-banner')
    const cHead = headingOf(c)
    const cGlyph = glyphOf(c)
    const cButton = within(c).getByRole('button').textContent

    // The glyph is the FIRST span and the heading the LAST, so neither
    // assertion can be satisfied by the other's difference.
    expect(bHead).not.toBe(bGlyph)
    expect(cHead).not.toBe(cGlyph)
    expect(bHead).not.toBe(cHead)
    expect(bGlyph).not.toBe(cGlyph)
    expect(bButton).not.toBe(cButton)
  })

  it("4c reads as routine, not as a failure — it is a WEEKLY event in testing mode", async () => {
    await mount()
    act(() => emit(status({ googleReauthRequired: true })))
    const banner = screen.getByTestId('google-reconnect-banner')

    expect(banner).toHaveTextContent('Time to reconnect Google')
    // Copy that reads as a failure turns a scheduled weekly occurrence into a
    // recurring trust hit.
    expect(banner).toHaveTextContent('about once a week')
    expect(banner).toHaveTextContent("expected, not a sign of a problem")
    expect(banner.textContent).not.toMatch(/error|failed|problem occurred|went wrong/i)
  })

  it('shows neither banner on an ordinary running job', async () => {
    await mount()
    act(() => emit(status({ pending: 20, transferred: 30 })))
    expect(screen.queryByTestId('session-expired-banner')).toBeNull()
    expect(screen.queryByTestId('google-reconnect-banner')).toBeNull()
  })

  /**
   * QA-4 / 03-ui-direction.md §6 — "4a/4b/4c all move focus to their
   * heading/banner on mount."
   *
   * `role="alert"` is already right and is NOT this. It announces without
   * moving anyone: the teacher is told the transfer needs their attention and
   * is left wherever they were, with the whole progress screen still between
   * them and the "Sign in again" button the announcement was about. Both
   * banners appear MID-transfer, so the effect has to key on the banner
   * appearing, not on the screen mounting — the screen mounted long before.
   *
   * The assertion is on `document.activeElement`, which is what QA measured
   * live and found sitting on `<body>`; asserting a `tabIndex` instead would
   * pass against a component that never calls `.focus()`.
   */
  it('4b: focus moves to the banner when the session expires mid-transfer', async () => {
    await mount({ sessionExpired: true })
    act(() => emit(status({ pending: 20, transferred: 30 })))

    const banner = screen.getByTestId('session-expired-banner')
    await waitFor(() => expect(document.activeElement).toBe(banner))
    expect(banner.getAttribute('tabindex')).toBe('-1')
  })

  it('4c: focus moves to the banner when Google needs reconnecting mid-transfer', async () => {
    await mount()
    act(() => emit(status({ pending: 20, transferred: 30 })))
    // Focus is untouched while the job is running normally — this screen is not
    // one the teacher is meant to be pulled into.
    expect(document.activeElement).toBe(document.body)

    act(() => emit(status({ pending: 20, transferred: 30, googleReauthRequired: true })))
    const banner = screen.getByTestId('google-reconnect-banner')
    await waitFor(() => expect(document.activeElement).toBe(banner))
  })

  it('does not re-steal focus on every poll tick while the banner stays up', async () => {
    // A teacher who tabbed to the button must not be yanked back to the banner
    // by the next 1s poll. The move happens when the banner APPEARS, once.
    await mount()
    act(() => emit(status({ pending: 20, transferred: 30, googleReauthRequired: true })))
    const banner = screen.getByTestId('google-reconnect-banner')
    await waitFor(() => expect(document.activeElement).toBe(banner))

    const button = within(banner).getByRole('button', { name: 'Reconnect Google account' })
    button.focus()
    act(() => emit(status({ pending: 19, transferred: 31, googleReauthRequired: true })))
    expect(document.activeElement).toBe(button)
  })
})
