/**
 * Automated accessibility audit of the shared components (UI-Δ2, quality
 * budget `wcag_aa_automated_per_step`, owner `ui-shared-components`).
 *
 * NOTE: axe under jsdom CANNOT evaluate colour contrast — jsdom performs no
 * layout and computes no used colours, so axe reports `color-contrast` as
 * "incomplete" and never as a violation. That is precisely why
 * `src/styles/contrast.a11y.test.ts` exists: it audits the palette
 * arithmetically against the declared tokens instead of relying on a rule axe
 * cannot run here.
 */
import axe from 'axe-core'
import type { ImpactValue } from 'axe-core'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Badge,
  Button,
  ColdStartOverlay,
  DUPLICATE_RUN_NOTICE,
  Disclosure,
  ErrorState,
  NarrationBanner,
  OutcomeIcon,
  OutcomePill,
  StepIndicator,
} from './index'

const BLOCKING: ImpactValue[] = ['critical', 'serious']

export async function expectNoSeriousViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    resultTypes: ['violations'],
    // jsdom has no layout; these rules cannot produce a meaningful result here.
    rules: { 'color-contrast': { enabled: false } },
  })
  const blocking = results.violations.filter((v) => BLOCKING.includes(v.impact ?? 'minor'))
  expect(
    blocking.map((v) => `${v.id}: ${v.help}`),
    'critical/serious axe violations',
  ).toEqual([])
}

describe('shared components pass an axe audit with no critical/serious violations', () => {
  it('ColdStartOverlay', async () => {
    const { container } = render(<ColdStartOverlay />)
    await expectNoSeriousViolations(container)
  })

  it('NarrationBanner', async () => {
    const { container } = render(
      <NarrationBanner glyph="i" variant="reassurance">{DUPLICATE_RUN_NOTICE}</NarrationBanner>,
    )
    await expectNoSeriousViolations(container)
  })

  it('StepIndicator', async () => {
    const { container } = render(<StepIndicator current={2} />)
    await expectNoSeriousViolations(container)
  })

  it('OutcomeIcon (all outcomes)', async () => {
    const { container } = render(
      <ul>
        <li>
          <OutcomeIcon outcome="transferred" />
        </li>
        <li>
          <OutcomeIcon outcome="fallback_shell" />
        </li>
        <li>
          <OutcomeIcon outcome="skipped" labelVisibility="sr-only" />
        </li>
      </ul>,
    )
    await expectNoSeriousViolations(container)
  })

  it('OutcomePill', async () => {
    const { container } = render(
      <p>
        <OutcomePill outcome="transferred" />
        <OutcomePill outcome="fallback_shell" />
        <OutcomePill outcome="skipped" />
      </p>,
    )
    await expectNoSeriousViolations(container)
  })

  it('Button and Badge', async () => {
    const { container } = render(
      <div>
        <Button>Continue →</Button>
        <Button variant="secondary">← Back</Button>
        <Badge kind="active" />
        <Badge kind="archived" />
        <Badge kind="sis" />
      </div>,
    )
    await expectNoSeriousViolations(container)
  })

  it('ErrorState', async () => {
    const { container } = render(<ErrorState onRetry={() => {}} onStartOver={() => {}} />)
    await expectNoSeriousViolations(container)
  })

  it('the duplicate outcome treatment', async () => {
    const { container } = render(
      <div>
        <OutcomeIcon outcome="skipped" skipReason="duplicate_title" />
        <OutcomePill outcome="skipped" skipReason="duplicate_title" />
      </div>,
    )
    await expectNoSeriousViolations(container)
  })

  it('Disclosure, collapsed and expanded', async () => {
    const { container } = render(
      <div>
        <Disclosure summary="Collapsed panel">
          <div>hidden body</div>
        </Disclosure>
        <Disclosure summary="Expanded panel" defaultOpen>
          <div>visible body</div>
        </Disclosure>
      </div>,
    )
    await expectNoSeriousViolations(container)
  })
})
