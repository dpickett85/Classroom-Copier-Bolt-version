/**
 * UX Acceptance Scenarios 2 (silent healthy pre-flight), 3 (type-aware skip
 * label), 4 (Scenario-3 option set), 5 (global auto-fix toggle). Plus this
 * phase's 10 ("X of Y" count excluding duplicates), 12 (topic-reuse
 * disclosure), 13 (all-duplicate re-run) and 16 (the duplicate-run notice
 * restated verbatim — reassurance, not v1's warning). Plus D26 (empty course).
 */
import { useRef, useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreflightFinding, PreflightResponse, Resolution } from '@classroom-copier/shared'
import { ActionSheetModal } from './ActionSheetModal'
import { PreflightScreen } from './PreflightScreen'
import { REASSURANCE, ReadyToTransfer } from './ReadyToTransfer'
import { DUPLICATE_RUN_NOTICE } from '../../components/shared'
import * as api from '../../lib/api-client'

vi.mock('../../lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  )
  return { ...actual, runPreflight: vi.fn() }
})

/** F2 on a Material — the fixture the "never hardcode Skip Assignment" gate needs. */
const MATERIAL_FINDING: PreflightFinding = {
  id: 'find-1',
  scanItemId: 'si-1',
  sourceType: 'courseWorkMaterial',
  sourceId: 'm-1',
  postTitle: 'Week 1 Reading',
  postTypeLabel: 'Material',
  attachmentId: 'att-1',
  attachmentName: 'Unit 1 Slides.pdf',
  issue: 'trashed',
  scenario: 2,
  options: [
    {
      kind: 'create_draft_shell_with_note',
      label: 'Create Draft Shell with Note',
      recommended: true,
      riskWarning: null,
    },
    { kind: 'skip_post', label: 'Skip Material', recommended: false, riskWarning: null },
  ],
}

/** F3 on an Assignment. */
const ASSIGNMENT_FINDING: PreflightFinding = {
  id: 'find-2',
  scanItemId: 'si-2',
  sourceType: 'courseWork',
  sourceId: 'cw-1',
  postTitle: 'Essay 1',
  postTypeLabel: 'Assignment',
  attachmentId: 'att-2',
  attachmentName: 'Rubric Template.docx',
  issue: 'permission_locked',
  scenario: 3,
  options: [
    {
      kind: 'copy_to_my_drive',
      label: 'Copy to My Drive (Become Owner)',
      recommended: true,
      riskWarning: null,
    },
    {
      kind: 'link_existing_file',
      label: 'Link Existing File (Risk Warning)',
      recommended: false,
      riskWarning: 'If the co-teacher removes access later, students lose the file.',
    },
    {
      kind: 'skip_attachment_and_note_draft',
      label: 'Skip Attachment and Note Draft',
      recommended: false,
      riskWarning: null,
    },
  ],
}

function scan(overrides: Partial<PreflightResponse> = {}): PreflightResponse {
  return {
    scanId: 'scan-1',
    sourceCourseId: 'c-source',
    targetCourseId: 'c-target',
    sourceCourseName: 'US History (2025)',
    targetCourseName: 'US History — Period 3',
    totalPostsScanned: 42,
    scannedAt: new Date().toISOString(),
    findings: [],
    duplicates: [],
    topicReuse: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

describe('Pre-flight scanning (Acceptance Scenario 2)', () => {
  it('cycles the three status lines', async () => {
    vi.mocked(api.runPreflight).mockReturnValue(new Promise(() => {}))
    render(
      <PreflightScreen
        sourceId="c-source"
        targetId="c-target"
        onReady={vi.fn()}
        onCancel={vi.fn()}
        stepMs={5}
      />,
    )
    expect(screen.getByText('Checking topics…')).toBeInTheDocument()
    await screen.findByText('Verifying attachments…')
    await screen.findByText('Checking permissions…')
  })

  it('shows a brief "All clear" and auto-advances when there are no findings', async () => {
    vi.mocked(api.runPreflight).mockResolvedValue(scan())
    const onReady = vi.fn()
    render(
      <PreflightScreen
        sourceId="c-source"
        targetId="c-target"
        onReady={onReady}
        onCancel={vi.fn()}
        stepMs={5}
        allClearMs={20}
      />,
    )

    expect(await screen.findByText('All clear')).toBeInTheDocument()
    expect(onReady).not.toHaveBeenCalled()
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ scanId: 'scan-1' }), [])
  })

  it('never opens the Action Sheet when the scan is healthy', async () => {
    vi.mocked(api.runPreflight).mockResolvedValue(scan())
    render(
      <PreflightScreen
        sourceId="c-source"
        targetId="c-target"
        onReady={vi.fn()}
        onCancel={vi.fn()}
        stepMs={5}
        allClearMs={5}
      />,
    )
    await screen.findByText('All clear')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the Action Sheet when the scan reports findings', async () => {
    vi.mocked(api.runPreflight).mockResolvedValue(scan({ findings: [MATERIAL_FINDING] }))
    render(
      <PreflightScreen
        sourceId="c-source"
        targetId="c-target"
        onReady={vi.fn()}
        onCancel={vi.fn()}
        stepMs={5}
      />,
    )
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByText('We found 1 item that needs your attention before copying.'),
    ).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ *
 * Action Sheet Modal
 * ------------------------------------------------------------------ */

function ModalHarness({
  findings,
  onContinue = vi.fn(),
}: {
  findings: PreflightFinding[]
  onContinue?: (resolutions: Resolution[]) => void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button type="button" ref={trigger} onClick={() => setOpen(true)}>
        Open action sheet
      </button>
      {open ? (
        <ActionSheetModal
          findings={findings}
          onContinue={(r) => {
            setOpen(false)
            onContinue(r)
          }}
          onCancel={() => setOpen(false)}
          returnFocusTo={trigger}
        />
      ) : null}
    </>
  )
}

describe('Action Sheet Modal', () => {
  it('renders the heading, the parent post title with its type, the attachment and the issue', async () => {
    render(<ActionSheetModal findings={[MATERIAL_FINDING, ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    expect(
      screen.getByText('We found 2 items that need your attention before copying.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Attached to “Week 1 Reading” (Material)')).toBeInTheDocument()
    expect(screen.getByText('Unit 1 Slides.pdf')).toBeInTheDocument()
    expect(screen.getByText('Issue: file is trashed or deleted.')).toBeInTheDocument()
    expect(screen.getByText('Attached to “Essay 1” (Assignment)')).toBeInTheDocument()
    expect(screen.getByText('Issue: permission-locked (co-teacher owned).')).toBeInTheDocument()
  })

  it('uses the server-supplied type-aware skip label: "Skip Material", never "Skip Assignment" (Scenario 3)', () => {
    render(<ActionSheetModal findings={[MATERIAL_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Skip Material/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Skip Assignment/ })).toBeNull()
  })

  it('renders the Scenario-3 option set with "Copy to My Drive" stamped Recommended (Scenario 4)', () => {
    render(<ActionSheetModal findings={[ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    const recommended = screen.getByRole('radio', { name: /Copy to My Drive \(Become Owner\)/ })
    expect(recommended.closest('.option')).toHaveClass('recommended')
    expect(within(recommended.closest('.option') as HTMLElement).getByText('Recommended')).toHaveClass(
      'stamp',
    )
    expect(screen.getByRole('radio', { name: /Link Existing File/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Skip Attachment and Note Draft/ })).toBeInTheDocument()
    expect(
      screen.getByText('If the co-teacher removes access later, students lose the file.'),
    ).toBeInTheDocument()
  })

  it('defaults the global auto-fix switch to OFF with nothing selected and Continue disabled', () => {
    const { container } = render(
      <ActionSheetModal findings={[MATERIAL_FINDING, ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByRole('switch', { name: /Apply recommended fixes automatically/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    screen.getAllByRole('radio').forEach((radio) => expect(radio).not.toBeChecked())
    expect(container.querySelectorAll('.option.selected')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
  })

  it('selects every recommended option and enables Continue when the switch is turned on (Scenario 5)', async () => {
    const onContinue = vi.fn()
    render(
      <ActionSheetModal
        findings={[MATERIAL_FINDING, ASSIGNMENT_FINDING]}
        onContinue={onContinue}
        onCancel={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('switch', { name: /Apply recommended fixes automatically/ }))

    expect(screen.getByRole('radio', { name: /Create Draft Shell with Note/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Copy to My Drive/ })).toBeChecked()
    const continueButton = screen.getByRole('button', { name: /Continue/ })
    expect(continueButton).toBeEnabled()

    await userEvent.click(continueButton)
    expect(onContinue).toHaveBeenCalledWith([
      { kind: 'create_draft_shell_with_note', findingId: 'find-1' },
      { kind: 'copy_to_my_drive', findingId: 'find-2' },
    ])
  })

  it('keeps Continue disabled until EVERY row resolves', async () => {
    render(
      <ActionSheetModal findings={[MATERIAL_FINDING, ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />,
    )
    await userEvent.click(screen.getByRole('radio', { name: /Skip Material/ }))
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: /Link Existing File/ }))
    expect(screen.getByRole('button', { name: /Continue/ })).toBeEnabled()
  })

  it('marks a NON-recommended choice as visibly selected, independently of the recommended tint', async () => {
    render(<ActionSheetModal findings={[ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    const chosen = screen.getByRole('radio', { name: /Link Existing File/ })
    await userEvent.click(chosen)

    const chosenRow = chosen.closest('.option') as HTMLElement
    expect(chosenRow).toHaveClass('selected')
    expect(chosenRow).not.toHaveClass('recommended')

    // The recommended row keeps its static tint and stamp but is NOT selected.
    const recommendedRow = screen
      .getByRole('radio', { name: /Copy to My Drive/ })
      .closest('.option') as HTMLElement
    expect(recommendedRow).toHaveClass('recommended')
    expect(recommendedRow).not.toHaveClass('selected')
  })

  it('marks an accepted recommendation as both recommended and selected', async () => {
    render(<ActionSheetModal findings={[ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    const recommended = screen.getByRole('radio', { name: /Copy to My Drive/ })
    await userEvent.click(recommended)
    const row = recommended.closest('.option') as HTMLElement
    expect(row).toHaveClass('recommended')
    expect(row).toHaveClass('selected')
  })

  it('is a focus-trapped dialog whose first focus lands on the heading', async () => {
    render(<ActionSheetModal findings={[MATERIAL_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', {
          name: 'We found 1 item that needs your attention before copying.',
        }),
      ),
    )
  })

  it('closes on Escape and returns focus to the control that opened it', async () => {
    render(<ModalHarness findings={[MATERIAL_FINDING]} />)
    const trigger = screen.getByRole('button', { name: 'Open action sheet' })
    await userEvent.click(trigger)
    await screen.findByRole('dialog')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('closes on Cancel and returns focus to the control that opened it', async () => {
    render(<ModalHarness findings={[MATERIAL_FINDING]} />)
    const trigger = screen.getByRole('button', { name: 'Open action sheet' })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('button', { name: /Cancel/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('keeps Tab inside the dialog', async () => {
    render(<ActionSheetModal findings={[MATERIAL_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    for (let i = 0; i < 12; i += 1) {
      await userEvent.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ *
 * Ready to Transfer
 * ------------------------------------------------------------------ */

describe('Ready to Transfer', () => {
  it('restates the counts, the reassurance line and the duplicate-run notice verbatim (Scenarios 10, 16)', () => {
    render(<ReadyToTransfer scan={scan()} onBack={vi.fn()} onStart={vi.fn()} />)
    // QA-3 — this used to assert "Ready to copy 42 posts", the FULL scanned
    // count. UX §1 step 6, the wireframe and Scenario 10 all specify "X of Y"
    // excluding duplicates. The form is uniform: with no duplicates it reads
    // "42 of 42", the same shape the teacher sees on a re-run, rather than a
    // second phrasing that only appears when the count happens to be clean.
    expect(
      screen.getByText(/Ready to copy/).textContent?.replace(/\s+/g, ' '),
    ).toBe('Ready to copy 42 of 42 posts from “US History (2025)” into “US History — Period 3.”')
    expect(
      screen.getByText(
        'Everything will land as Drafts with dates cleared — nothing is visible to students until you publish it.',
      ),
    ).toHaveClass('reassure')
    // QA-2 — Acceptance Scenario 16 requires the SAME reassurance sentence
    // restated here, not v1's warning. Asserting the shared constant alone let
    // a stale constant pass, so the rendered claim is checked as well.
    const banner = screen.getByText(DUPLICATE_RUN_NOTICE)
    expect(banner).toBeInTheDocument()
    expect(banner.textContent).toMatch(/checks for items that already exist/i)
    expect(banner.textContent, 'v1s warning copy is still on Ready to Transfer').not.toMatch(
      /creates duplicate/i,
    )
  })

  it('offers Back and Start Transfer', async () => {
    const onBack = vi.fn()
    const onStart = vi.fn()
    render(<ReadyToTransfer scan={scan()} onBack={onBack} onStart={onStart} />)
    await userEvent.click(screen.getByRole('button', { name: /Back/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Start Transfer' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('says WHEN the count was measured (APPLY-I)', () => {
    // The scan is a snapshot: a post added to the source after it is correctly
    // excluded from the job, and the summary then reads "N of N" about an N
    // measured earlier. Saying nothing about that, in a product whose thesis is
    // that it never lies about what happened, was the gap.
    const at = new Date('2026-08-14T09:41:00.000Z')
    render(
      <ReadyToTransfer
        scan={scan({ scannedAt: at.toISOString() })}
        onBack={vi.fn()}
        onStart={vi.fn()}
      />,
    )
    const freshness = screen.getByTestId('scan-freshness')
    expect(freshness).toHaveTextContent(/^Scanned at /)
    expect(freshness).toHaveTextContent(
      at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    )
    expect(freshness).toHaveTextContent(/scan again/)
  })

  it('renders the explicit 0-posts state rather than silently succeeding (D26)', async () => {
    const onStart = vi.fn()
    render(<ReadyToTransfer scan={scan({ totalPostsScanned: 0 })} onBack={vi.fn()} onStart={onStart} />)

    expect(screen.getByText(/0 posts to copy/)).toBeInTheDocument()
    expect(screen.queryByText(/Ready to copy 0 posts/)).toBeNull()

    const start = screen.getByRole('button', { name: 'Start Transfer' })
    expect(start).toBeEnabled()
    await userEvent.click(start)
    expect(onStart).toHaveBeenCalledTimes(1)
  })
})

/* ------------------------------------------------------------------ *
 * Decision C/D — duplicate and topic-reuse disclosure (UI §3.4)
 * ------------------------------------------------------------------ */

const DUPLICATES = [
  {
    scanItemId: 'scan-1-i0',
    sourceType: 'courseWork' as const,
    sourceId: 'cw-1',
    postTitle: 'Angle Pairs Practice',
    postTypeLabel: 'Assignment',
    matchedTitle: 'Angle Pairs Practice',
    matchedState: 'DRAFT' as const,
  },
  {
    scanItemId: 'scan-1-i1',
    sourceType: 'courseWork' as const,
    sourceId: 'cw-2',
    postTitle: 'Proof Writing Quiz',
    postTypeLabel: 'Quiz assignment',
    matchedTitle: 'Proof Writing Quiz',
    matchedState: 'PUBLISHED' as const,
  },
]

const TOPIC_REUSE = [
  {
    sourceTopicId: 't-1',
    sourceTopicName: 'Unit A — Angles',
    destinationTopicId: 'dt-1',
    destinationTopicName: 'Unit A — Angles',
    ambiguous: false,
  },
  {
    sourceTopicId: 't-2',
    sourceTopicName: 'Review',
    destinationTopicId: 'dt-2',
    destinationTopicName: 'Review',
    ambiguous: true,
  },
]

describe('Ready to Transfer — duplicate and topic disclosure', () => {
  /**
   * QA-3 / Acceptance Scenario 10 — the headline is the count the teacher acts
   * on. Showing the full scanned count while disclosing the exclusion in a
   * separate sentence loses no information but fails the criterion, and the
   * previous test pinned that wrong behaviour as correct.
   */
  it('excludes duplicates from the headline count, not just from a sentence below it (Scenario 10)', () => {
    render(
      <ReadyToTransfer scan={scan({ duplicates: DUPLICATES })} onBack={vi.fn()} onStart={vi.fn()} />,
    )
    const headline = screen.getByText(/Ready to copy/).textContent?.replace(/\s+/g, ' ')
    expect(headline).toContain('Ready to copy 40 of 42 posts')
    // The headline must not read as if all 42 will be copied. `40 of 42`
    // contains "42", so the check is on the copyable half specifically.
    expect(headline, 'the headline still leads with the un-excluded count').not.toMatch(
      /Ready to copy 42 (of 42 )?posts/,
    )
  })

  /**
   * QA-3 / Acceptance Scenario 13, the all-duplicate re-run — the EXPECTED,
   * successful outcome of this product's headline promise. It must read as
   * success, not as the D26 empty-course error-ish state and not as a stuck
   * screen: `Start Transfer` still works.
   */
  it('reads "0 of Y" and as a success, not an error, when every item is a duplicate (Scenario 13)', async () => {
    const allDuplicates = Array.from({ length: 42 }, (_unused, i) => ({
      ...DUPLICATES[0]!,
      scanItemId: `dup-${i}`,
    }))
    const onStart = vi.fn()
    render(
      <ReadyToTransfer
        scan={scan({ duplicates: allDuplicates })}
        onBack={vi.fn()}
        onStart={onStart}
      />,
    )

    expect(screen.getByText(/Ready to copy/).textContent?.replace(/\s+/g, ' ')).toContain(
      'Ready to copy 0 of 42 posts',
    )
    // Distinct from D26's empty-course state, which is a different fact.
    expect(screen.queryByText(/0 posts to copy/)).toBeNull()

    const line = screen.getByTestId('all-duplicate-note')
    expect(line).toHaveTextContent('All 42 items already exist in the destination')
    expect(line).toHaveTextContent('nothing new to copy')
    expect(line).toHaveTextContent(/won’t create any duplicates/)

    // "Everything will land as Drafts" is false when nothing lands.
    expect(screen.queryByText(REASSURANCE)).toBeNull()

    // Not a dead end: the re-run still completes, with 0 new drafts.
    await userEvent.click(screen.getByRole('button', { name: 'Start Transfer' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('shows the all-duplicate note ONLY when every scanned item is a duplicate', () => {
    render(
      <ReadyToTransfer scan={scan({ duplicates: DUPLICATES })} onBack={vi.fn()} onStart={vi.fn()} />,
    )
    expect(screen.queryByTestId('all-duplicate-note')).toBeNull()
    expect(screen.getByText(REASSURANCE)).toBeInTheDocument()
  })

  it('states the duplicate count before the teacher confirms, not after', () => {
    render(
      <ReadyToTransfer
        scan={scan({ duplicates: DUPLICATES })}
        onBack={vi.fn()}
        onStart={vi.fn()}
      />,
    )
    expect(screen.getByTestId('duplicate-summary')).toHaveTextContent(
      '2 of 42 items are already in the destination course and will be skipped.',
    )
  })

  it('lists each duplicate with its destination state, quoting the destination title', () => {
    render(
      <ReadyToTransfer
        scan={scan({ duplicates: DUPLICATES })}
        onBack={vi.fn()}
        onStart={vi.fn()}
      />,
    )
    const panel = screen.getByTestId('duplicate-disclosure')
    // "already there" and "already there as a draft you have not published yet"
    // send a teacher to two different places.
    expect(panel).toHaveTextContent('an unpublished draft')
    expect(panel).toHaveTextContent('a published post')
    expect(within(panel).getByText('Angle Pairs Practice')).toBeInTheDocument()
  })

  it('says an ambiguous topic match WAS ambiguous rather than silently picking one', () => {
    render(
      <ReadyToTransfer
        scan={scan({ topicReuse: TOPIC_REUSE })}
        onBack={vi.fn()}
        onStart={vi.fn()}
      />,
    )
    const panel = screen.getByTestId('topic-reuse-disclosure')
    expect(panel).toHaveTextContent('More than one topic in the destination has this name')
    expect(panel.querySelectorAll('.disclosure-ambiguity')).toHaveLength(1)
  })

  it('shows neither panel when there is nothing to disclose', () => {
    render(<ReadyToTransfer scan={scan()} onBack={vi.fn()} onStart={vi.fn()} />)
    expect(screen.queryByTestId('duplicate-disclosure')).toBeNull()
    expect(screen.queryByTestId('topic-reuse-disclosure')).toBeNull()
    expect(screen.queryByTestId('duplicate-summary')).toBeNull()
  })

  /**
   * §3.4 — native <details>/<summary> is the whole reason this needs no ARIA of
   * our own: Enter/Space toggling and Tab reachability come from the element.
   *
   * What is asserted here is that we are genuinely using those elements and
   * that the summary is focusable, plus that toggling works. jsdom implements
   * <details> toggling on CLICK but does NOT implement the Enter-key activation
   * a real browser gives <summary> — so a keyboard assertion here would be
   * testing jsdom's gaps, not this component. The keyboard path is a browser
   * guarantee that follows from the element choice, and the element choice is
   * what this pins down.
   *
   * MANUAL-VERIFY: confirm Enter/Space toggling in a real browser during the
   * QA pass.
   */
  it('is a real <details>/<summary> with a focusable summary, and toggles', async () => {
    render(
      <ReadyToTransfer
        scan={scan({ duplicates: DUPLICATES })}
        onBack={vi.fn()}
        onStart={vi.fn()}
      />,
    )
    const panel = screen.getByTestId('duplicate-disclosure') as HTMLDetailsElement
    expect(panel.tagName).toBe('DETAILS')
    expect(panel.open).toBe(false)

    const summary = panel.querySelector('summary') as HTMLElement
    expect(summary).not.toBeNull()
    summary.focus()
    expect(document.activeElement).toBe(summary)

    await userEvent.click(summary)
    expect(panel.open).toBe(true)
    await userEvent.click(summary)
    expect(panel.open).toBe(false)

    // No hand-rolled state: nothing here reimplements what the element does.
    expect(summary.getAttribute('aria-expanded')).toBeNull()
    expect(summary.getAttribute('role')).toBeNull()
  })

  it('carries the expand/collapse state as real TEXT, never the triangle alone', () => {
    render(
      <ReadyToTransfer
        scan={scan({ duplicates: DUPLICATES })}
        onBack={vi.fn()}
        onStart={vi.fn()}
      />,
    )
    const panel = screen.getByTestId('duplicate-disclosure')
    expect(within(panel).getByText('[expand]')).toBeInTheDocument()
    expect(within(panel).getByText('[collapse]')).toBeInTheDocument()
  })
})
