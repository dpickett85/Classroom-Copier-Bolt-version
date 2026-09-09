/**
 * Spec 3 — Refresh-resume (F12 reconnect).
 *
 * F4 (50 posts, all healthy) is transferred with the e2e server's
 * `MOCK_PROVIDER_DELAY_MS` slowing each item enough that a mid-transfer
 * reload has something to reconnect to. On mount, both the app shell and the
 * TransferProgress screen ask the server what is already in flight
 * (`GET /transfer-jobs/active`) rather than trusting client state, so a
 * reloaded tab should land back on live progress — never back on Selection —
 * and the job should still reach the Completion Summary.
 */
import { expect, test } from '@playwright/test'
import { COURSE_IDS } from '../support/fixtures'
import {
  passSilentPreflight,
  selectCourses,
  signInAsJamie,
  startTransfer,
  waitForSummary,
} from '../support/flows'

test('refresh-resume: reload mid-transfer reconnects to the running F4 job and reaches the summary', async ({
  page,
}) => {
  await signInAsJamie(page)
  await selectCourses(page, COURSE_IDS.F4, COURSE_IDS.TARGET_JAMIE_PLAIN)
  await passSilentPreflight(page)
  await expect(page.getByText(/Ready to copy 50 of 50 posts/)).toBeVisible()

  await startTransfer(page)

  // Let the batch make real progress before reloading — not just "Starting…".
  await expect(page.locator('.progress-count')).not.toHaveText('Transferring 0 of 50 posts…', {
    timeout: 20_000,
  })
  await expect(page.locator('.progress-count')).not.toHaveText('Transferring 50 of 50 posts…')

  await page.reload()

  // The reload must land back on live progress, not the account picker or
  // Selection — that is the whole point of the F12 reconnect guarantee.
  await expect(page.locator('.progress-count')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('#source-course')).not.toBeVisible()

  await waitForSummary(page, 45_000)

  const reconciliationText = await page.getByTestId('reconciliation').innerText()
  expect(reconciliationText).toContain('of 50 posts scanned')
})
