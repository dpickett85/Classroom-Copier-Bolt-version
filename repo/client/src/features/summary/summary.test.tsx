/**
 * UX Acceptance Scenarios 10 (overflow note), 11 (rubric degradation as its own
 * count), 13 (per-type fields) and 15 (reconciliation). Plus D14 (system skips
 * are never attributed to the teacher) and D30 (focus lands on the heading).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TransferJobItemRow, TransferJobStatus } from '@classroom-copier/shared'
import {
  SkipReasonSchema,
  attachmentFallbackNote,
  attachmentOverflowNote,
} from '@classroom-copier/shared'
import { outcomeText } from '../../components/shared'
import { CompletionSummary, buildLogCsv, logCsvFilename } from './CompletionSummary'

function status(overrides: Partial<TransferJobStatus> = {}): TransferJobStatus {
  return {
    jobId: 'job-1',
    status: 'completed',
    sourceCourseName: 'US History (2025)',
    targetCourseName: 'US History — Period 3',
    targetCourseId: 'c-target',
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
    startedAt: '2026-08-14T18:00:00.000Z',
    finishedAt: '2026-08-14T18:02:00.000Z',
    ...overrides,
  }
}

const MATERIAL: TransferJobItemRow = {
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

const ASSIGNMENT: TransferJobItemRow = {
  id: 'i2',
  title: 'Essay 1',
  sourceType: 'courseWork',
  workType: 'ASSIGNMENT',
  typeLabel: 'Assignment',
  topicName: 'Unit 2',
  outcome: 'fallback_shell',
  skipReason: null,
  skippedBy: null,
  typeSpecific: { kind: 'graded', maxPoints: 100 },
  note: attachmentFallbackNote('Unit_1_Quiz.pdf'),
  rubricDegraded: false,
  attemptCount: 1,
  targetPostId: 'tp-2',
}

const QUESTION_MC: TransferJobItemRow = {
  id: 'i3',
  title: 'Discussion Q1',
  sourceType: 'courseWork',
  workType: 'MULTIPLE_CHOICE_QUESTION',
  typeLabel: 'Question',
  topicName: null,
  outcome: 'transferred',
  skipReason: null,
  skippedBy: null,
  typeSpecific: { kind: 'multipleChoice', optionCount: 4 },
  note: null,
  rubricDegraded: false,
  attemptCount: 1,
  targetPostId: 'tp-3',
}

const QUESTION_SA: TransferJobItemRow = {
  id: 'i4',
  title: 'Exit Ticket',
  sourceType: 'courseWork',
  workType: 'SHORT_ANSWER_QUESTION',
  typeLabel: 'Question',
  topicName: 'Unit 2',
  outcome: 'transferred',
  skipReason: null,
  skippedBy: null,
  typeSpecific: { kind: 'shortAnswer' },
  note: null,
  rubricDegraded: false,
  attemptCount: 1,
  targetPostId: 'tp-4',
}

const SKIPPED_BY_USER: TransferJobItemRow = {
  id: 'i5',
  title: 'Bonus Worksheet',
  sourceType: 'courseWorkMaterial',
  workType: null,
  typeLabel: 'Material',
  topicName: 'Unit 3',
  outcome: 'skipped',
  skipReason: 'user_skip_post',
  skippedBy: 'user',
  typeSpecific: { kind: 'none' },
  note: 'Skipped by you — chose “Skip Material” after the attachment could not be linked.',
  rubricDegraded: false,
  attemptCount: 0,
  targetPostId: null,
}

const SKIPPED_DUPLICATE: TransferJobItemRow = {
  id: 'i6',
  title: 'Angle Pairs Practice',
  sourceType: 'courseWork',
  workType: 'ASSIGNMENT',
  typeLabel: 'Assignment',
  topicName: 'Unit 3',
  outcome: 'skipped',
  skipReason: 'duplicate_title',
  skippedBy: 'duplicate',
  typeSpecific: { kind: 'none' },
  note: 'Already in the destination course as an unpublished draft.',
  rubricDegraded: false,
  attemptCount: 0,
  targetPostId: null,
}

const ITEMS = [MATERIAL, ASSIGNMENT, QUESTION_MC, QUESTION_SA, SKIPPED_BY_USER, SKIPPED_DUPLICATE]

function renderSummary(overrides: Partial<TransferJobStatus> = {}, items = ITEMS) {
  return render(
    <CompletionSummary
      status={status(overrides)}
      items={items}
      onOpenTargetCourse={vi.fn()}
      onStartAnother={vi.fn()}
    />,
  )
}

function rowFor(title: string): HTMLElement {
  return screen.getByRole('cell', { name: title }).closest('tr') as HTMLElement
}

function typeSpecificCell(title: string): HTMLElement {
  return within(rowFor(title)).getAllByRole('cell')[4] as HTMLElement
}

describe('Completion Summary', () => {
  it('is a full-screen report, not a modal, and moves focus to its heading (D30)', async () => {
    renderSummary()
    expect(screen.queryByRole('dialog')).toBeNull()
    const heading = screen.getByRole('heading', { name: 'Transfer complete.' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('renders the seven stat tiles in two labelled ledger groups', () => {
    renderSummary({ skippedDuplicate: 3, topicsCreatedCount: 4, topicsReusedCount: 2 })
    const groups = screen.getByTestId('stat-groups-region')
    const tile = (label: string) =>
      within(groups).getByText(label).closest('.stat-tile') as HTMLElement

    expect(within(tile('Drafts transferred')).getByText('39')).toBeInTheDocument()
    expect(within(tile('Fallback shells')).getByText('2')).toBeInTheDocument()
    expect(within(tile('Skipped, already existed')).getByText('3')).toBeInTheDocument()
    expect(within(tile('Skipped by you')).getByText('1')).toBeInTheDocument()
    expect(within(tile('Topics created')).getByText('4')).toBeInTheDocument()
    expect(within(tile('Topics reused')).getByText('2')).toBeInTheDocument()
    expect(within(tile('Rubric notes added')).getByText('1')).toBeInTheDocument()
  })

  /**
   * The whole point of splitting the row: a teacher must be able to see, from
   * layout alone, which numbers sum to the total below. Asserted structurally,
   * not visually — the four reconciled tiles are in one group and the three
   * that are never terms are in the other, with nothing crossing over.
   */
  it('keeps the reconciled tiles and the reported-separately tiles in different groups', () => {
    renderSummary()
    const items = screen.getByTestId('stat-group-items')
    const separate = screen.getByTestId('stat-group-separate')

    for (const label of [
      'Drafts transferred',
      'Fallback shells',
      'Skipped, already existed',
      'Skipped by you',
    ]) {
      expect(within(items).getByText(label), label).toBeInTheDocument()
      expect(within(separate).queryByText(label), label).toBeNull()
    }
    for (const label of ['Topics created', 'Topics reused', 'Rubric notes added']) {
      expect(within(separate).getByText(label), label).toBeInTheDocument()
      expect(within(items).queryByText(label), label).toBeNull()
    }
  })

  it('says out loud that topics are never counted in the item total', () => {
    renderSummary({ topicsCreatedCount: 4, topicsReusedCount: 2 })
    const callout = screen.getByTestId('topics-callout')
    expect(callout).toHaveTextContent('never counted in the item total above')
    expect(callout).toHaveTextContent('4 created + 2 reused = 6 topics referenced')
    // NOT the green `.reconcile` treatment — that colour means "the item ledger
    // balances", and wearing it here would claim topics are part of that sum.
    expect(callout).not.toHaveClass('reconcile')
  })
})

describe('cancel — the cancelled-by-you banner (partial-completion contract)', () => {
  it('shows a cancelled-by-you banner when cancelledAt is set', () => {
    renderSummary({ cancelRequested: true, cancelledAt: '2026-08-14T18:05:00.000Z' })
    expect(screen.getByTestId('cancelled-banner')).toBeInTheDocument()
  })

  it('omits the banner when the job finished without being cancelled', () => {
    renderSummary()
    expect(screen.queryByTestId('cancelled-banner')).toBeNull()
  })

  it('the "Skipped by you" tile reflects the items the cancellation drained', () => {
    // skippedByUser already sums every user-attributed skip reason, including
    // cancelled_by_user (D14 for cancel) — the drained items are simply part
    // of that count, the same tile, no separate bucket.
    renderSummary({
      cancelRequested: true,
      cancelledAt: '2026-08-14T18:05:00.000Z',
      transferred: 1,
      fallbackShell: 0,
      skippedTotal: 4,
      skippedByUser: 4,
      skippedBySystem: 0,
      totalItems: 5,
      totalPostsScanned: 5,
    })
    const groups = screen.getByTestId('stat-groups-region')
    const tile = within(groups).getByText('Skipped by you').closest('.stat-tile') as HTMLElement
    expect(within(tile).getByText('4')).toBeInTheDocument()
  })
})

describe('D14 — a post the server abandoned is never attributed to the teacher', () => {
  it('binds "Skipped by you" to skippedByUser alone and names the system skip separately', () => {
    renderSummary({ skippedTotal: 1, skippedByUser: 0, skippedBySystem: 1 })

    const groups = screen.getByTestId('stat-groups-region')
    const tile = within(groups).getByText('Skipped by you').closest('.stat-tile') as HTMLElement
    expect(within(tile).getByText('0')).toBeInTheDocument()

    const systemLine = screen.getByTestId('system-skip-line')
    expect(systemLine).toHaveTextContent(
      '1 post was interrupted before we could confirm it copied — see the log below.',
    )
  })

  it('pluralizes the system-skip line', () => {
    renderSummary({ skippedTotal: 3, skippedByUser: 1, skippedBySystem: 2 })
    expect(screen.getByTestId('system-skip-line')).toHaveTextContent(
      '2 posts were interrupted before we could confirm they copied — see the log below.',
    )
  })

  it('omits the system-skip line entirely when nothing was abandoned', () => {
    renderSummary()
    expect(screen.queryByTestId('system-skip-line')).toBeNull()
  })
})

describe('the reconciliation line (Scenario 15)', () => {
  it('renders the four-term sum in tile order, topics and rubric notes excluded', () => {
    renderSummary()
    expect(screen.getByTestId('reconciliation')).toHaveTextContent(
      '✓ 39 + 2 + 0 + 1 = 42 of 42 posts scanned — every post resolved to a transfer, fallback, or skip.',
    )
  })

  it('splits the skip term into duplicate and user, matching the four tiles left to right', () => {
    renderSummary({
      transferred: 30,
      fallbackShell: 2,
      skippedTotal: 10,
      skippedDuplicate: 7,
      skippedByUser: 3,
      skippedBySystem: 0,
    })
    expect(screen.getByTestId('reconciliation')).toHaveTextContent(
      '✓ 30 + 2 + 7 + 3 = 42 of 42 posts scanned',
    )
  })

  /**
   * The case the four-term-only version could not represent: with a
   * system-interrupted skip, four terms do not reach the total and the line
   * silently stops balancing.
   */
  it('adds a fifth LABELLED term only when skippedBySystem > 0, and still balances', () => {
    renderSummary({
      transferred: 30,
      fallbackShell: 2,
      skippedTotal: 10,
      skippedDuplicate: 5,
      skippedByUser: 2,
      skippedBySystem: 3,
    })
    expect(screen.getByTestId('reconciliation')).toHaveTextContent(
      '✓ 30 + 2 + 5 + 2 + 3 interrupted = 42 of 42 posts scanned',
    )
  })

  it('omits the fifth term entirely when nothing was interrupted — not "+ 0 interrupted"', () => {
    renderSummary()
    expect(screen.getByTestId('reconciliation')).not.toHaveTextContent('interrupted')
  })

  it('reads the total from the server rather than recomputing it client-side', () => {
    // A deliberately inconsistent payload: a client-side sum would print 42.
    renderSummary({ totalItems: 99, totalPostsScanned: 99 })
    expect(screen.getByTestId('reconciliation')).toHaveTextContent('= 99 of 99 posts scanned')
  })
})

describe('the itemized log', () => {
  it('has the six specified columns in order', () => {
    renderSummary()
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      'Title',
      'Type',
      'Topic',
      'Outcome',
      'Type-specific fields',
      'Note',
    ])
  })

  it('leaves a Material row genuinely empty of type-specific content (Scenario 13)', () => {
    renderSummary()
    const cell = typeSpecificCell('Week 1 Reading')
    expect(cell.textContent).not.toMatch(/pts|Due|Answer/)
  })

  it('renders due/points for Assignments and answer config for Questions (Scenario 13)', () => {
    renderSummary()
    expect(typeSpecificCell('Essay 1')).toHaveTextContent('Due: cleared · Max pts: 100')
    expect(typeSpecificCell('Discussion Q1')).toHaveTextContent('Answer: Multiple choice (4 opts)')
    expect(typeSpecificCell('Exit Ticket')).toHaveTextContent('Answer: Short answer')
  })

  it('never renders a uniform placeholder across types', () => {
    renderSummary()
    const material = typeSpecificCell('Week 1 Reading').textContent
    const assignment = typeSpecificCell('Essay 1').textContent
    expect(material).not.toBe(assignment)
  })

  it('renders the canonical fallback note in full, never truncated or ellipsized', () => {
    renderSummary()
    const canonical = attachmentFallbackNote('Unit_1_Quiz.pdf')
    const noteCell = within(rowFor('Essay 1')).getAllByRole('cell')[5] as HTMLElement
    expect(noteCell.textContent).toBe(canonical)
    expect(noteCell.textContent).not.toContain('…')
    expect(noteCell.textContent).not.toContain('...')
  })

  it('renders the attachment-overflow note on that post row (Scenario 10)', () => {
    const overflow: TransferJobItemRow = { ...MATERIAL, id: 'i9', title: 'Photo Gallery', note: attachmentOverflowNote(5) }
    renderSummary({}, [overflow])
    expect(screen.getByText(attachmentOverflowNote(5))).toBeInTheDocument()
  })

  it('shows each outcome as a coloured pill with text', () => {
    renderSummary()
    expect(within(rowFor('Week 1 Reading')).getByText('Transferred')).toHaveClass('outcome-transferred')
    expect(within(rowFor('Essay 1')).getByText('Fallback')).toHaveClass('outcome-fallback')
    expect(within(rowFor('Bonus Worksheet')).getByText('Skipped — you chose to skip')).toHaveClass(
      'outcome-skipped',
    )
  })

  /**
   * §3.3 — colour alone is never sufficient. The two skips must be tellable
   * apart from the TEXT, which is what this asserts; the different class (and
   * therefore colour) is a second signal on top, not the only one.
   */
  it('distinguishes a duplicate skip from a user skip in text, not just colour', () => {
    renderSummary()
    const duplicate = within(rowFor('Angle Pairs Practice')).getByText('Already in course')
    const userSkip = within(rowFor('Bonus Worksheet')).getByText('Skipped — you chose to skip')
    expect(duplicate).toHaveClass('outcome-duplicate')
    expect(userSkip).toHaveClass('outcome-skipped')
    expect(duplicate.textContent).not.toBe(userSkip.textContent)
  })

  it('shows "(none)" for an untopiced post rather than an empty cell', () => {
    renderSummary()
    expect(within(rowFor('Discussion Q1')).getByText('(none)')).toBeInTheDocument()
  })

  it('filters by outcome, with the two kinds of skip on separate options', async () => {
    renderSummary()
    const filter = screen.getByLabelText('Filter by outcome')

    await userEvent.selectOptions(filter, 'fallback_shell')
    expect(screen.getByRole('cell', { name: 'Essay 1' })).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'Week 1 Reading' })).toBeNull()

    await userEvent.selectOptions(filter, 'user_skip')
    expect(screen.getByRole('cell', { name: 'Bonus Worksheet' })).toBeInTheDocument()
    // The point of splitting them: "Skipped by you" must not sweep up an item
    // the teacher never chose to skip.
    expect(screen.queryByRole('cell', { name: 'Angle Pairs Practice' })).toBeNull()

    await userEvent.selectOptions(filter, 'duplicate')
    expect(screen.getByRole('cell', { name: 'Angle Pairs Practice' })).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'Bonus Worksheet' })).toBeNull()

    await userEvent.selectOptions(filter, 'all')
    expect(screen.getByRole('cell', { name: 'Week 1 Reading' })).toBeInTheDocument()
  })

  it('horizontal-scrolls rather than collapsing to cards (UI-Δ1)', () => {
    const { container } = renderSummary()
    expect(container.querySelector('.log-scroll')).not.toBeNull()
    expect(container.querySelector('table.log-table')).not.toBeNull()
  })

  it('the scroll container is keyboard-reachable, not just mouse-scrollable', () => {
    const { container } = renderSummary()
    const scroller = container.querySelector('.log-scroll') as HTMLElement
    expect(scroller).not.toBeNull()
    expect(scroller.getAttribute('tabindex')).toBe('0')
    expect(scroller.getAttribute('aria-label')).toBeTruthy()
  })

  it('marks the Title column, and only the Title column, as the sticky column', () => {
    renderSummary()
    const headers = screen.getAllByRole('columnheader')
    expect(headers[0]).toHaveTextContent('Title')
    expect(headers[0]).toHaveClass('log-title-col')
    for (const other of headers.slice(1)) {
      expect(other).not.toHaveClass('log-title-col')
    }

    const firstDataCell = within(rowFor('Week 1 Reading')).getAllByRole('cell')[0]
    expect(firstDataCell).toHaveTextContent('Week 1 Reading')
    expect(firstDataCell).toHaveClass('log-title-col')
  })

  it('keeps the six columns in the documented order, Title first (structural)', () => {
    renderSummary()
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers[0]).toBe('Title')
    expect(headers).toEqual([
      'Title',
      'Type',
      'Topic',
      'Outcome',
      'Type-specific fields',
      'Note',
    ])
  })
})

describe('CSV export of the itemized log (5a)', () => {
  const NOTE_WITH_COMMAS_AND_QUOTES: TransferJobItemRow = {
    id: 'i6',
    title: 'Field Trip Permission, Signed',
    sourceType: 'courseWorkMaterial',
    workType: null,
    typeLabel: 'Material',
    topicName: null,
    outcome: 'skipped',
    skipReason: 'user_skip_post',
    skippedBy: 'user',
    typeSpecific: { kind: 'none' },
    note: 'Skipped by you — chose "Skip Material," see notes.',
    rubricDegraded: false,
    attemptCount: 0,
    targetPostId: null,
  }

  const MIXED_ITEMS = [...ITEMS, NOTE_WITH_COMMAS_AND_QUOTES]

  it('offers an "Export log (CSV)" action on the Completion Summary', () => {
    renderSummary()
    expect(screen.getByRole('button', { name: 'Export log (CSV)' })).toBeInTheDocument()
  })

  it('names the file classroom-copier-log-<jobId>.csv', () => {
    expect(logCsvFilename('job-42')).toBe('classroom-copier-log-job-42.csv')
  })

  it('builds a CSV mirroring the on-screen six columns, for a mixed-outcome job', () => {
    const csv = buildLogCsv(MIXED_ITEMS)
    const lines = csv.split('\r\n')
    // F2 — the Outcome cell is DERIVED from the label function, never spelled.
    // Written out as a literal it asserted only that two implementations agreed
    // on the day it was written, which is precisely the drift `outcomeText`
    // exists to make impossible.
    const label = (index: number) =>
      outcomeText(MIXED_ITEMS[index]!.outcome, MIXED_ITEMS[index]!.skipReason)

    expect(lines[0]).toBe('Title,Type,Topic,Outcome,Type-specific fields,Note')
    expect(lines[1]).toBe(`Week 1 Reading,Material,Unit 1,${label(0)},,`)
    expect(lines[2]).toBe(
      `Essay 1,Assignment,Unit 2,${label(1)},Due: cleared · Max pts: 100,${attachmentFallbackNote('Unit_1_Quiz.pdf')}`,
    )
    expect(lines[3]).toBe(
      `Discussion Q1,Question,(none),${label(2)},Answer: Multiple choice (4 opts),`,
    )
    expect(lines[4]).toBe(`Exit Ticket,Question,Unit 2,${label(3)},Answer: Short answer,`)
    expect(lines[5]).toBe(
      `Bonus Worksheet,Material,Unit 3,${label(4)},,Skipped by you — chose “Skip Material” after the attachment could not be linked.`,
    )
  })

  it('routes the Outcome column through the SAME label function for EVERY skip reason (F2)', () => {
    // The six-column case above covers the outcomes this fixture happens to
    // contain. This one exhausts the enum, so a reason the CSV renders through
    // some other path cannot hide behind a fixture that never produces it.
    const rows = SkipReasonSchema.options.map((skipReason, index) => ({
      ...MIXED_ITEMS[0]!,
      id: `csv-${skipReason}`,
      title: `Post ${index}`,
      outcome: 'skipped' as const,
      skipReason,
      note: null,
      typeSpecific: { kind: 'none' as const },
      topicName: null,
    }))
    const dataLines = buildLogCsv(rows).split('\r\n').slice(1)

    expect(dataLines.map((line) => line.split(',')[3])).toEqual(
      rows.map((row) => outcomeText(row.outcome, row.skipReason)),
    )
  })

  it('quotes and escapes a field containing commas and double quotes (RFC 4180)', () => {
    const csv = buildLogCsv([NOTE_WITH_COMMAS_AND_QUOTES])
    const lines = csv.split('\r\n')
    const label = outcomeText(
      NOTE_WITH_COMMAS_AND_QUOTES.outcome,
      NOTE_WITH_COMMAS_AND_QUOTES.skipReason,
    )

    expect(lines[0]).toBe('Title,Type,Topic,Outcome,Type-specific fields,Note')
    expect(lines[1]).toBe(
      `"Field Trip Permission, Signed",Material,(none),${label},,"Skipped by you — chose ""Skip Material,"" see notes."`,
    )
  })
})

describe('summary actions', () => {
  it('offers the mock target-course link and a way to start another transfer', async () => {
    const onOpenTargetCourse = vi.fn()
    const onStartAnother = vi.fn()
    render(
      <CompletionSummary
        status={status()}
        items={ITEMS}
        onOpenTargetCourse={onOpenTargetCourse}
        onStartAnother={onStartAnother}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open target course' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start another transfer' }))
    expect(onOpenTargetCourse).toHaveBeenCalledTimes(1)
    expect(onStartAnother).toHaveBeenCalledTimes(1)
  })
})
