/**
 * The wizard end to end, against a stubbed api-client: sign-in -> forced
 * picker -> selection -> pre-flight -> ready -> transfer -> summary, checking
 * the step indicator and Back availability at every step.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountSummary,
  CourseSummary,
  TransferJobItemRow,
  TransferJobStatus,
} from '@classroom-copier/shared'
import { App } from './App'
import * as api from './lib/api-client'

vi.mock('./lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('./lib/api-client')>('./lib/api-client')
  return {
    ...actual,
    me: vi.fn(),
    confirmSession: vi.fn(),
    getGoogleAuthUrl: vi.fn(),
    signOut: vi.fn(),
    listCourses: vi.fn(),
    runPreflight: vi.fn(),
    createTransferJob: vi.fn(),
    getActiveJob: vi.fn(),
    getJobItems: vi.fn(),
    pollJobStatus: vi.fn(),
  }
})

const JAMIE: AccountSummary = {
  id: 'google-sub-jamie',
  displayName: 'Jamie Rivera',
  email: 'jamie.rivera@pickettusd.example',
  initials: 'JR',
}
const SOURCE: CourseSummary = {
  id: 'c-source',
  name: 'US History (2025)',
  section: 'Period 3',
  state: 'ACTIVE',
  isSisShell: false,
  postCount: 42,
}
const TARGET: CourseSummary = {
  id: 'c-target',
  name: 'US History — Period 3',
  section: null,
  state: 'ACTIVE',
  isSisShell: true,
  postCount: 0,
}

const COMPLETED: TransferJobStatus = {
  jobId: 'job-1',
  status: 'completed',
  sourceCourseName: SOURCE.name,
  targetCourseName: TARGET.name,
  targetCourseId: TARGET.id,
  totalItems: 42,
  totalPostsScanned: 42,
  pending: 0,
  transferred: 39,
  fallbackShell: 2,
  skippedTotal: 1,
  skippedByUser: 1,
  skippedBySystem: 0,
  skippedDuplicate: 0,
  topicsCreatedOrMapped: 6,
  topicsCreatedCount: 6,
  topicsReusedCount: 0,
  googleReauthRequired: false,
  rubricNotesAdded: 1,
  currentItem: null,
  rateLimitPause: null,
  cancelRequested: false,
  cancelledAt: null,
  startedAt: null,
  finishedAt: null,
}

const ITEM: TransferJobItemRow = {
  id: 'i1',
  title: 'Week 1 Reading',
  sourceType: 'courseWorkMaterial',
  workType: null,
  typeLabel: 'Material',
  topicName: 'Unit 1',
  outcome: 'transferred',
  skipReason: null,
  skippedBy: null,
  typeSpecific: { kind: 'none' },
  note: null,
  rubricDegraded: false,
  attemptCount: 1,
  targetPostId: 'tp-1',
}

let emit: (s: TransferJobStatus) => void
let polledJobIds: string[]

beforeEach(() => {
  vi.clearAllMocks()
  polledJobIds = []
  emit = () => {}
  vi.mocked(api.me).mockResolvedValue(null)
  vi.mocked(api.confirmSession).mockResolvedValue({ account: JAMIE })
  vi.mocked(api.getGoogleAuthUrl).mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2' })
  vi.mocked(api.signOut).mockResolvedValue(undefined)
  vi.mocked(api.listCourses).mockImplementation(async (role) =>
    role === 'source' ? { courses: [SOURCE] } : { courses: [TARGET] },
  )
  vi.mocked(api.runPreflight).mockResolvedValue({
    scanId: 'scan-1',
    sourceCourseId: SOURCE.id,
    targetCourseId: TARGET.id,
    sourceCourseName: SOURCE.name,
    targetCourseName: TARGET.name,
    totalPostsScanned: 42,
    scannedAt: new Date().toISOString(),
    findings: [],
    duplicates: [],
    topicReuse: [],
  })
  vi.mocked(api.createTransferJob).mockResolvedValue({ conflict: false, jobId: 'job-1' })
  vi.mocked(api.getActiveJob).mockResolvedValue(null)
  vi.mocked(api.getJobItems).mockResolvedValue({ jobId: 'job-1', items: [ITEM] })
  vi.mocked(api.pollJobStatus).mockImplementation((jobId, onTick) => {
    polledJobIds.push(jobId)
    emit = onTick
    return () => {}
  })
})

function currentStep(): string | null {
  const el = document.querySelector('[aria-current="step"]')
  return el?.textContent ?? null
}

function backButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: /←\s*Back/ })
}

/**
 * The course lists arrive asynchronously, so the `<select>` exists before its
 * `<option>`s do. Waiting on the label alone raced the fetch and failed
 * intermittently with "Value \"c-source\" not found in options" — a flaky test
 * is a gate nobody trusts.
 */
async function loadedSelect(label: string): Promise<HTMLSelectElement> {
  const select = (await screen.findByLabelText(label)) as HTMLSelectElement
  await waitFor(() => expect(select.options.length).toBeGreaterThan(1))
  return select
}

describe('the linear wizard', () => {
  it('walks sign-in -> summary, tracking the step indicator and Back availability', async () => {
    render(<App />)

    // --- Sign-in landing: no step indicator yet. The sign-in leg itself leaves
    // this app for Google's domain, so it is driven in auth.test.tsx with an
    // injected redirect; here the wizard is entered with a live session.
    await screen.findByRole('button', { name: 'Sign in with Google' })
    expect(currentStep()).toBeNull()
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    cleanup()
    render(<App />)

    // --- Step 1: Selection. No Back — this is the first step.
    const source = await loadedSelect('Copy from (source)')
    const target = await loadedSelect('Copy to (target)')
    expect(currentStep()).toBe('1 Select')
    expect(backButton()).toBeNull()

    await userEvent.selectOptions(source, SOURCE.id)
    await userEvent.selectOptions(target, TARGET.id)
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }))

    // --- Step 2: Pre-flight, then Ready to Transfer with Back enabled.
    await waitFor(() => expect(currentStep()).toBe('2 Pre-flight'))
    await screen.findByText(/Ready to copy/, undefined, { timeout: 4000 })
    expect(currentStep()).toBe('2 Pre-flight')
    expect(backButton()).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Start Transfer' }))

    // --- Step 3: Transfer. Back is gone once the batch write has started,
    // but Cancel transfer (the mid-transfer partial-completion control) is
    // there instead — a half-completed batch write is not something Back can
    // undo, but it IS something the teacher can stop from here on out.
    await waitFor(() => expect(currentStep()).toBe('3 Transfer'))
    await waitFor(() => expect(polledJobIds).toContain('job-1'))
    expect(backButton()).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel transfer' })).toBeInTheDocument()

    // --- Step 4: Summary.
    act(() => emit(COMPLETED))
    await screen.findByRole('heading', { name: 'Transfer complete.' })
    expect(currentStep()).toBe('4 Summary')
    expect(backButton()).toBeNull()
    expect(screen.getByTestId('reconciliation')).toHaveTextContent('39 + 2 + 0 + 1 = 42 of 42')
  })

  it('shows the persistent account header once signed in', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    render(<App />)

    const header = await screen.findByTestId('account-header')
    expect(within(header).getByText('JR')).toBeInTheDocument()
    expect(within(header).getByText(/Jamie Rivera/)).toBeInTheDocument()
    // Substring, not exact: the header renders "Name <email>" as one node.
    expect(within(header).getByText((text) => text.includes(JAMIE.email))).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Switch account' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('returns to the landing screen on "Switch account" and discards the in-progress selection', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    render(<App />)

    const sourceSelect = await loadedSelect('Copy from (source)')
    await userEvent.selectOptions(sourceSelect, SOURCE.id)
    expect(sourceSelect.value).toBe(SOURCE.id)

    await userEvent.click(screen.getByRole('button', { name: 'Switch account' }))
    // "Switch account" now returns to the landing screen: the account chooser
    // is Google's, so there is no in-app picker to jump to.
    expect(
      await screen.findByRole('button', { name: 'Sign in with Google' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Copy from (source)')).toBeNull()
  })

  it('signs out back to the landing screen', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    render(<App />)
    await screen.findByLabelText('Copy from (source)')
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByRole('button', { name: 'Sign in with Google' }),
    ).toBeInTheDocument()
  })

  it('lands a reloaded tab back on Progress when a job is already in flight (F12)', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    vi.mocked(api.getActiveJob).mockResolvedValue('job-77')
    render(<App />)

    await waitFor(() => expect(currentStep()).toBe('3 Transfer'))
    await waitFor(() => expect(polledJobIds).toContain('job-77'))
    expect(screen.queryByLabelText('Copy from (source)')).toBeNull()
  })

  /* ---------------------------------------------------------------- *
   * APPLY-N — a broken server is not "you are signed out"
   * ---------------------------------------------------------------- */

  it('surfaces a non-401 session failure instead of silently showing the sign-in screen', async () => {
    // `me()` resolves to null ONLY on 401. Every other rejection used to be
    // swallowed by a bare `.catch(() => {})`, parking the user on the landing
    // screen after a 5xx with no explanation at all.
    vi.mocked(api.me).mockRejectedValue(
      new api.ApiRequestError(500, 'internal', 'Something went wrong.'),
    )
    render(<App />)
    expect(await screen.findByTestId('error-state')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull()
  })

  it('surfaces a failed active-job lookup rather than dropping the user on Selection (F12)', async () => {
    // Treating any `getActiveJob()` failure as "no active job" sent the user to
    // Selection while a transfer was still running server-side — silently
    // defeating the reconnect guarantee that call exists to deliver.
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    vi.mocked(api.getActiveJob).mockRejectedValue(
      new api.ApiRequestError(503, 'unavailable', 'Service unavailable.'),
    )
    render(<App />)
    expect(await screen.findByTestId('error-state')).toBeInTheDocument()
  })

  /* ---------------------------------------------------------------- *
   * APPLY-O — a render-time throw is not a white page
   * ---------------------------------------------------------------- */

  it('catches a render-time throw in a screen and offers a way out', async () => {
    // Every other error path in this client is a `.catch()` into state, which
    // covers asynchronous failure and nothing else. A synchronous throw during
    // render unmounted the whole tree, mid-batch-write, with no cancel control.
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    vi.mocked(api.listCourses).mockImplementation(() => {
      throw new Error('render-time explosion')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<App />)
      expect(await screen.findByTestId('error-state')).toBeInTheDocument()
      // The boundary's own copy, so this cannot pass via the async error path.
      expect(
        screen.getByText(/The screen could not be displayed/),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start Over' })).toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('returns to Selection from the summary via "Start another transfer"', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    vi.mocked(api.getActiveJob).mockResolvedValue('job-1')
    render(<App />)
    await waitFor(() => expect(polledJobIds).toContain('job-1'))

    act(() => emit(COMPLETED))
    await screen.findByRole('heading', { name: 'Transfer complete.' })

    await userEvent.click(screen.getByRole('button', { name: 'Start another transfer' }))
    await screen.findByLabelText('Copy from (source)')
    expect(currentStep()).toBe('1 Select')
  })

  /* ---------------------------------------------------------------- *
   * DEFER 2 — the reconnect discovery fetch must not fire twice: once in
   * this shell's own mount effect, once again in TransferProgress's mount
   * effect, for the exact same reconnect.
   * ---------------------------------------------------------------- */

  it('fetches GET /transfer-jobs/active exactly once on an F12 reconnect', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    vi.mocked(api.getActiveJob).mockResolvedValue('job-77')
    render(<App />)

    await waitFor(() => expect(currentStep()).toBe('3 Transfer'))
    await waitFor(() => expect(polledJobIds).toContain('job-77'))
    expect(api.getActiveJob).toHaveBeenCalledTimes(1)
  })

  /* ---------------------------------------------------------------- *
   * DEFER 3 — a failed `signOut()` must not proceed silently. The cookie may
   * still be alive server-side, so the teacher gets a notice instead of a
   * shell that quietly acts as if signing out worked.
   * ---------------------------------------------------------------- */

  it('shows a notice rather than silently proceeding when Sign out fails', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    vi.mocked(api.signOut).mockRejectedValue(
      new api.ApiRequestError(500, 'internal', 'Something went wrong.'),
    )
    render(<App />)
    await screen.findByLabelText('Copy from (source)')

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1))

    expect(await screen.findByText(/session may still be active/i)).toBeInTheDocument()
    // Did not silently proceed to the sign-in screen as though it worked.
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull()
    expect(await screen.findByTestId('account-header')).toBeInTheDocument()
  })

  /* ---------------------------------------------------------------- *
   * Fix 1 — `scan_stale` / `scan_already_used` are real 409s from
   * POST /transfer-jobs, not generic failures. Each gets dedicated copy and a
   * primary action that re-scans, preserving the courses already selected.
   * ---------------------------------------------------------------- */

  describe('scan conflict 409s (Fix 1)', () => {
    async function toReadyToTransfer() {
      vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
      render(<App />)
      const source = await loadedSelect('Copy from (source)')
      const target = await loadedSelect('Copy to (target)')
      await userEvent.selectOptions(source, SOURCE.id)
      await userEvent.selectOptions(target, TARGET.id)
      await userEvent.click(screen.getByRole('button', { name: /Continue/ }))
      await screen.findByText(/Ready to copy/, undefined, { timeout: 4000 })
    }

    it('renders dedicated copy for scan_stale and re-scans on the primary action', async () => {
      vi.mocked(api.createTransferJob).mockRejectedValue(
        new api.ApiRequestError(409, 'scan_stale', 'This pre-flight scan is out of date.'),
      )
      await toReadyToTransfer()

      await userEvent.click(screen.getByRole('button', { name: 'Start Transfer' }))

      expect(await screen.findByText(/out of date/i)).toBeInTheDocument()
      // Not the generic catch-all.
      expect(screen.queryByText('Something went wrong')).toBeNull()

      vi.mocked(api.runPreflight).mockClear()
      await userEvent.click(screen.getByRole('button', { name: /Scan again/i }))

      // Back on Pre-flight, re-scanning the SAME courses (no return to Selection).
      await waitFor(() => expect(api.runPreflight).toHaveBeenCalledWith(SOURCE.id, TARGET.id, expect.anything()))
      expect(screen.queryByLabelText('Copy from (source)')).toBeNull()
    })

    it('renders dedicated copy for scan_already_used and re-scans on the primary action', async () => {
      vi.mocked(api.createTransferJob).mockRejectedValue(
        new api.ApiRequestError(409, 'scan_already_used', 'This pre-flight scan has already been transferred.'),
      )
      await toReadyToTransfer()

      await userEvent.click(screen.getByRole('button', { name: 'Start Transfer' }))

      expect(await screen.findByText(/already (been )?used/i)).toBeInTheDocument()
      expect(screen.queryByText('Something went wrong')).toBeNull()

      vi.mocked(api.runPreflight).mockClear()
      await userEvent.click(screen.getByRole('button', { name: /Scan again/i }))

      await waitFor(() => expect(api.runPreflight).toHaveBeenCalledWith(SOURCE.id, TARGET.id, expect.anything()))
      expect(screen.queryByLabelText('Copy from (source)')).toBeNull()
    })
  })
})
