/**
 * Spec 1 — Clean transfer.
 *
 * Jamie signs in, copies F1 (a clean 6-post course, including a scheduled
 * DRAFT) into her SIS-shell target, sails through a silent pre-flight (no
 * findings, no Action Sheet), starts the transfer, and lands on the
 * Completion Summary. The reconciliation line's visible arithmetic must
 * balance: transferred + fallback + skips = total scanned.
 */
import { expect, test } from '@playwright/test'
import { COURSE_IDS } from '../support/fixtures'
import {
  parseReconciliation,
  passSilentPreflight,
  selectCourses,
  signInAsJamie,
  startTransfer,
  waitForSummary,
} from '../support/flows'

const TARGET_LABEL = 'US History — Period 3 — 2026 Spring · Active · SIS Roster Shell'

test('clean transfer: F1 into the SIS-shell target, silent pre-flight, balanced reconciliation', async ({
  page,
}) => {
  await signInAsJamie(page)

  // Confirm the exact target label the product promises, then select by id.
  const targetOption = page.locator('#target-course option', { hasText: TARGET_LABEL })
  await expect(targetOption).toHaveCount(1)
  await expect(targetOption).toHaveAttribute('value', COURSE_IDS.TARGET_JAMIE)

  await selectCourses(page, COURSE_IDS.F1, COURSE_IDS.TARGET_JAMIE)

  // F1 is clean: no Action Sheet, the scan auto-advances to Ready-to-Transfer.
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await passSilentPreflight(page)

  await expect(page.getByText(/Ready to copy 6 of 6 posts/)).toBeVisible()

  await startTransfer(page)
  await waitForSummary(page)

  const reconciliationText = await page.getByTestId('reconciliation').innerText()
  const { transferred, fallbackShell, skippedTotal, totalItems, totalPostsScanned } =
    parseReconciliation(reconciliationText)

  expect(transferred + fallbackShell + skippedTotal).toBe(totalItems)
  expect(totalItems).toBe(totalPostsScanned)
  expect(totalPostsScanned).toBe(6)
})
