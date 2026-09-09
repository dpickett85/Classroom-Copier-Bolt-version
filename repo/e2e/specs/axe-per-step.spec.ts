/**
 * Spec 4 — Accessibility, per wizard step (WCAG 2.1 AA).
 *
 * Real @axe-core/playwright scans against the actual rendered layout —
 * including color-contrast, which only exists once the real stylesheet is
 * loaded (a jsdom unit test cannot catch it). Violations are reported
 * honestly: nothing here filters, disables, or downgrades a rule. A failing
 * assertion here is a FINDING, not something to work around.
 */
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { COURSE_IDS } from '../support/fixtures'
import {
  passSilentPreflight,
  selectCourses,
  signInAsJamie,
  startTransfer,
  waitForActionSheet,
  waitForSummary,
} from '../support/flows'

const WCAG21AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function scan(page: import('@playwright/test').Page) {
  return new AxeBuilder({ page }).withTags(WCAG21AA).analyze()
}

test.describe('accessibility (WCAG 2.1 AA) per wizard step', () => {
  test('sign-in (landing + forced account picker)', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Sign in with Google (mock)' })).toBeVisible()
    const landing = await scan(page)
    expect(landing.violations, JSON.stringify(landing.violations, null, 2)).toEqual([])

    await page.getByRole('button', { name: 'Sign in with Google (mock)' }).click()
    await expect(page.getByText('Choose an account')).toBeVisible()
    const picker = await scan(page)
    expect(picker.violations, JSON.stringify(picker.violations, null, 2)).toEqual([])
  })

  test('selection (source & target)', async ({ page }) => {
    await signInAsJamie(page)
    const results = await scan(page)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })

  test('action sheet (modal, F2)', async ({ page }) => {
    await signInAsJamie(page)
    await selectCourses(page, COURSE_IDS.F2, COURSE_IDS.TARGET_JAMIE)
    await waitForActionSheet(page)
    const results = await scan(page)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })

  test('ready-to-transfer', async ({ page }) => {
    await signInAsJamie(page)
    await selectCourses(page, COURSE_IDS.F1, COURSE_IDS.TARGET_JAMIE)
    await passSilentPreflight(page)
    const results = await scan(page)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })

  test('completion summary', async ({ page }) => {
    await signInAsJamie(page)
    await selectCourses(page, COURSE_IDS.F1, COURSE_IDS.TARGET_JAMIE_PLAIN)
    await passSilentPreflight(page)
    await startTransfer(page)
    await waitForSummary(page)
    const results = await scan(page)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })
})
