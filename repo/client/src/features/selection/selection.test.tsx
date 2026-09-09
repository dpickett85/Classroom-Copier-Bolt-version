/**
 * UX Acceptance Scenarios 3 (list contents), 6 (duplicate-run warning),
 * 16 (source !== target validation) and 17 (list scoping).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseSummary } from '@classroom-copier/shared'
import { SelectionScreen } from './SelectionScreen'
import { DUPLICATE_RUN_NOTICE } from '../../components/shared'
import * as api from '../../lib/api-client'

vi.mock('../../lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  )
  return { ...actual, listCourses: vi.fn() }
})

const ACTIVE: CourseSummary = {
  id: 'c-active',
  name: 'US History (2025)',
  section: 'Period 3',
  state: 'ACTIVE',
  isSisShell: false,
  postCount: 42,
}
const ARCHIVED: CourseSummary = {
  id: 'c-archived',
  name: 'US History (2024)',
  section: 'Period 1',
  state: 'ARCHIVED',
  isSisShell: false,
  postCount: 31,
}
const SIS_SHELL: CourseSummary = {
  id: 'c-sis',
  name: 'US History — Period 3',
  section: null,
  state: 'ACTIVE',
  isSisShell: true,
  postCount: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listCourses).mockImplementation(async (role) =>
    role === 'source' ? { courses: [ACTIVE, ARCHIVED] } : { courses: [ACTIVE, SIS_SHELL] },
  )
})

async function renderScreen(onContinue = vi.fn()) {
  render(<SelectionScreen onContinue={onContinue} />)
  const source = await screen.findByLabelText('Copy from (source)')
  const target = await screen.findByLabelText('Copy to (target)')
  return { source: source as HTMLSelectElement, target: target as HTMLSelectElement, onContinue }
}

describe('Source & Target Selection', () => {
  it('lists both active and archived courses as sources, with badge and post count (Scenario 17)', async () => {
    const { source } = await renderScreen()
    const options = within(source).getAllByRole('option').map((o) => o.textContent)
    expect(options.join('\n')).toContain('US History (2025) — Period 3 · Active · 42 posts')
    expect(options.join('\n')).toContain('US History (2024) — Period 1 · Archived · 31 posts')
  })

  it('never lists an archived course as a target (Scenario 17)', async () => {
    const { target } = await renderScreen()
    const options = within(target).getAllByRole('option').map((o) => o.textContent ?? '')
    expect(options.join('\n')).not.toContain('Archived')
    expect(options.some((o) => o.includes('US History (2024)'))).toBe(false)
  })

  it('badges an SIS roster shell in the target list', async () => {
    const { target } = await renderScreen()
    const options = within(target).getAllByRole('option').map((o) => o.textContent ?? '')
    expect(options.some((o) => o.includes('SIS Roster Shell'))).toBe(true)
  })

  /**
   * QA-2 — the citation was wrong as well as the copy: "Scenario 6" is a v1
   * scenario. This phase's Acceptance Scenario 16 is the one that governs, and
   * it requires the notice to state that already-existing items are detected
   * and skipped. Asserting the shared constant is not enough on its own (the
   * constant was stale and this test passed anyway), so the rendered text is
   * checked against the claim too.
   */
  it('shows the duplicate-skip reassurance notice persistently, in the shared wording (Scenario 16)', async () => {
    await renderScreen()
    const banner = screen.getByText(DUPLICATE_RUN_NOTICE)
    expect(banner).toBeInTheDocument()
    expect(banner.textContent).toMatch(/checks for items that already exist/i)
    expect(banner.textContent, 'v1s warning copy is still on the Selection screen').not.toMatch(
      /creates duplicate/i,
    )
  })

  it('keeps Continue disabled until both courses are chosen', async () => {
    const { source } = await renderScreen()
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
    await userEvent.selectOptions(source, ACTIVE.id)
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
  })

  it('disables Continue and explains inline when source and target are the same (Scenario 16)', async () => {
    const { source, target } = await renderScreen()
    await userEvent.selectOptions(source, ACTIVE.id)
    await userEvent.selectOptions(target, ACTIVE.id)

    expect(screen.getByText('Choose two different courses.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
  })

  it('shows no inline error before a collision actually exists', async () => {
    const { source, target } = await renderScreen()
    await userEvent.selectOptions(source, ARCHIVED.id)
    await userEvent.selectOptions(target, SIS_SHELL.id)
    expect(screen.queryByText('Choose two different courses.')).toBeNull()
  })

  it('enables Continue for two distinct courses and reports both ids', async () => {
    const { source, target, onContinue } = await renderScreen()
    await userEvent.selectOptions(source, ARCHIVED.id)
    await userEvent.selectOptions(target, SIS_SHELL.id)

    const button = screen.getByRole('button', { name: /Continue/ })
    expect(button).toBeEnabled()
    await userEvent.click(button)
    await waitFor(() =>
      expect(onContinue).toHaveBeenCalledWith(
        expect.objectContaining({ id: ARCHIVED.id }),
        expect.objectContaining({ id: SIS_SHELL.id }),
      ),
    )
  })
})
