/**
 * Shared step-by-step flows over the real wizard, built from accessible
 * roles/labels rather than CSS selectors so the specs read the way a teacher
 * would use the app. Kept out of `fixtures.ts` (constants only) and out of
 * individual specs (would duplicate the same five screens four times).
 */
import { expect, type Page } from '@playwright/test'
import { JAMIE } from './fixtures'

/** Screen 1 -> 2: mock sign-in, forced account picker, choose Jamie. */
export async function signInAsJamie(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in with Google (mock)' }).click()
  await page.getByRole('button', { name: new RegExp(JAMIE.displayName) }).click()
  // Selection screen has landed once the source dropdown is present.
  await expect(page.locator('#source-course')).toBeVisible()
}

/** Screen 3: choose source + target by course id and continue. */
export async function selectCourses(page: Page, sourceId: string, targetId: string): Promise<void> {
  await page.locator('#source-course').selectOption(sourceId)
  await page.locator('#target-course').selectOption(targetId)
  await page.getByRole('button', { name: 'Continue →' }).click()
}

/**
 * Screen 4a: a scan with no findings cycles its status lines and
 * auto-advances straight to Ready-to-Transfer. Waits for that landing.
 */
export async function passSilentPreflight(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Start Transfer' })).toBeVisible({ timeout: 15_000 })
}

/** Screen 4b: waits for the Action Sheet modal to appear after a scan with findings. */
export async function waitForActionSheet(page: Page) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  return dialog
}

/**
 * Within the Action Sheet, picks a named option for the finding row
 * identified by its attachment file name (e.g. "Unit 1 Slides.pdf").
 */
export async function chooseActionSheetOption(
  page: Page,
  attachmentName: string,
  optionNamePattern: RegExp,
): Promise<void> {
  const row = page.locator('fieldset.issue-row').filter({ hasText: attachmentName })
  await row.getByRole('radio', { name: optionNamePattern }).check()
}

/** Submits the Action Sheet once every finding has a choice. */
export async function submitActionSheet(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Continue →' }).click()
}

/** Screen 4c -> 5: click Start Transfer. */
export async function startTransfer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start Transfer' }).click()
}

/** Screen 6: waits for the Completion Summary to render. */
export async function waitForSummary(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Transfer complete.' })).toBeVisible({ timeout })
}

/** Parses the reconciliation line's rendered arithmetic (data-testid="reconciliation"). */
export function parseReconciliation(text: string): {
  transferred: number
  fallbackShell: number
  skippedTotal: number
  totalItems: number
  totalPostsScanned: number
} {
  const match = text.match(
    /✓ (\d+) \+ (\d+) \+ (\d+) = (\d+) of (\d+) posts scanned/,
  )
  if (!match) throw new Error(`Reconciliation line did not match the expected shape: "${text}"`)
  const [, transferred, fallbackShell, skippedTotal, totalItems, totalPostsScanned] = match
  return {
    transferred: Number(transferred),
    fallbackShell: Number(fallbackShell),
    skippedTotal: Number(skippedTotal),
    totalItems: Number(totalItems),
    totalPostsScanned: Number(totalPostsScanned),
  }
}
