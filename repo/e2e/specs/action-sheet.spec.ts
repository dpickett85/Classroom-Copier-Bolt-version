/**
 * Spec 2 — Action Sheet.
 *
 * F2 carries two attachment findings: a trashed Material attachment
 * ("Unit 1 Slides.pdf", on "Week 1 Reading") and a deleted Assignment
 * attachment ("Council Minutes.docx", on "Essay: Local government"). Both are
 * scenario-2 (trashed/deleted -> Create Draft Shell with Note recommended, or
 * a type-aware Skip). This resolves the Material finding with the
 * recommended option (which injects the canonical fallback note) and the
 * Assignment finding with its type-aware Skip ("Skip Assignment") — then
 * checks the summary shows exactly one user skip and renders the full,
 * non-truncated canonical note.
 */
import { expect, test } from '@playwright/test'
import { COURSE_IDS, FALLBACK_NOTE_UNIT_1_SLIDES, F2_FINDINGS } from '../support/fixtures'
import {
  chooseActionSheetOption,
  selectCourses,
  signInAsJamie,
  startTransfer,
  submitActionSheet,
  waitForActionSheet,
  waitForSummary,
} from '../support/flows'

test('action sheet: recommended fix + type-aware skip, exact canonical note in the summary', async ({
  page,
}) => {
  await signInAsJamie(page)
  await selectCourses(page, COURSE_IDS.F2, COURSE_IDS.TARGET_JAMIE_PLAIN)

  const dialog = await waitForActionSheet(page)
  await expect(dialog).toContainText('We found 2 items that need your attention before copying.')

  // Trashed Material attachment -> accept the recommended fix.
  await chooseActionSheetOption(
    page,
    F2_FINDINGS.TRASHED_ATTACHMENT,
    /Create Draft Shell with Note/,
  )

  // Deleted Assignment attachment -> the type-aware skip, not a generic one.
  await chooseActionSheetOption(page, F2_FINDINGS.DELETED_ATTACHMENT, /^Skip Assignment$/)

  await submitActionSheet(page)
  await startTransfer(page)
  await waitForSummary(page)

  const skippedTile = page.locator('.stat-tile').filter({ hasText: 'Skipped by you' })
  await expect(skippedTile.locator('.stat-num')).toHaveText('1')

  // The note must be the EXACT canonical text, rendered in full — never
  // truncated or ellipsized — on the row for the post that carried the
  // fallback-shell resolution ("Week 1 Reading").
  const noteCell = page.locator('tr', { hasText: 'Week 1 Reading' }).locator('.note-cell')
  await expect(noteCell).toHaveText(FALLBACK_NOTE_UNIT_1_SLIDES)

  // The skipped post carries its own explanatory note — a DIFFERENT string
  // from the attachment fallback note above, never the fallback note reused.
  const skippedRow = page.locator('tr', { hasText: 'Essay: Local government' })
  await expect(skippedRow.locator('.note-cell')).toHaveText(
    'Skipped by you — you chose to skip this post after its attachment could not be linked.',
  )
})
