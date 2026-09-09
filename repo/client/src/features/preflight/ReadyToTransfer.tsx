/**
 * Screen 4c — the confirmation checkpoint before the batch write commits.
 *
 * D26: a scan with `totalPostsScanned === 0` says so out loud. Start Transfer
 * stays as an explicit confirmation (the server creates a zero-item job that
 * completes immediately and still satisfies the reconciliation invariant),
 * rather than the screen quietly reporting success for a copy that never had
 * anything to copy.
 */
import type { PreflightResponse } from '@classroom-copier/shared'
import { Button, DUPLICATE_RUN_NOTICE, Disclosure, NarrationBanner } from '../../components/shared'

export const REASSURANCE =
  'Everything will land as Drafts with dates cleared — nothing is visible to students until you publish it.'

/**
 * APPLY-I — the scan is a snapshot, and this line says when it was taken. A post
 * added to the source after the scan is correctly excluded from the job, and the
 * Completion Summary then reports "N of N" about an N measured earlier; in a
 * product whose thesis is that it never lies about what happened, saying nothing
 * about that was the gap. (`POST /transfer-jobs` also refuses a scan older than
 * the TTL, so the silence is not the only guard.)
 */
export function scannedAtLabel(scannedAt: string): string {
  const at = new Date(scannedAt)
  if (Number.isNaN(at.getTime())) return 'Scanned just now.'
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `Scanned at ${time}. If the source course has changed since, go back and scan again.`
}

interface ReadyToTransferProps {
  scan: PreflightResponse
  onBack: () => void
  onStart: () => void
  backDisabled?: boolean
}

/**
 * Decision C — the count line the teacher reads BEFORE confirming. Duplicates
 * are already decided (they will be skipped); this is disclosure, which is why
 * it is a plain sentence and a collapsed list rather than an Action Sheet row
 * demanding a decision that has no alternative.
 */
export function duplicateSummaryLine(count: number, total: number): string {
  const one = count === 1
  return `${count} of ${total} item${total === 1 ? '' : 's'} ${
    one ? 'is' : 'are'
  } already in the destination course and will be skipped.`
}

/**
 * QA-3 / Acceptance Scenarios 10 and 13 — the headline count.
 *
 * This used to read `Ready to copy {totalPostsScanned} posts`: the full scanned
 * count, with the duplicate exclusion disclosed only in a separate sentence
 * below. No information was lost, but the number the teacher acts on was the
 * wrong one, and UX §1 step 6, the wireframe and Scenario 10 all specify
 * "X of Y".
 *
 * The "X of Y" form is uniform, never conditional on there being duplicates:
 * "42 of 42" on a first run is the same shape as "38 of 42" on the second, so
 * a teacher reading the screen twice is reading one sentence, not two.
 */
export function copyableCount(scan: PreflightResponse): number {
  return Math.max(0, scan.totalPostsScanned - (scan.duplicates?.length ?? 0))
}

/**
 * Scenario 13's all-duplicate re-run — the EXPECTED, successful outcome of this
 * product's headline promise, which is exactly why it needs its own sentence.
 * Left to the generic screen it would read as a stuck or empty state, and this
 * is the one case where a teacher most needs to be told that nothing happening
 * IS the thing working.
 *
 * It replaces the "everything lands as Drafts" reassurance rather than joining
 * it: nothing lands here, so that sentence would be false.
 */
export function allDuplicateNote(total: number): string {
  const one = total === 1
  return (
    `All ${total} item${one ? '' : 's'} already exist${one ? 's' : ''} in the destination — ` +
    `there’s nothing new to copy. Running this will skip everything and won’t create any duplicates.`
  )
}

export function ReadyToTransfer({ scan, onBack, onStart, backDisabled = false }: ReadyToTransferProps) {
  const empty = scan.totalPostsScanned === 0
  const duplicates = scan.duplicates ?? []
  const topicReuse = scan.topicReuse ?? []
  const copyable = copyableCount(scan)
  // Distinct from `empty`, which is D26's "the source course has no classwork".
  // Same zero on screen, two different facts, two different sentences.
  const allDuplicates = !empty && copyable === 0

  return (
    <div className="screen">
      <div className="ready-card">
        {empty ? (
          <p>
            <b>0 posts to copy</b> — “{scan.sourceCourseName}” has no classwork to move into “
            {scan.targetCourseName}.”
          </p>
        ) : (
          <p>
            Ready to copy{' '}
            <b>
              {copyable} of {scan.totalPostsScanned} post{scan.totalPostsScanned === 1 ? '' : 's'}
            </b>{' '}
            from “{scan.sourceCourseName}” into “{scan.targetCourseName}.”
          </p>
        )}
        {allDuplicates ? (
          <p className="reassure" data-testid="all-duplicate-note">
            {allDuplicateNote(scan.totalPostsScanned)}
          </p>
        ) : (
          <p className="reassure">{REASSURANCE}</p>
        )}
        <p className="mock-note" data-testid="scan-freshness">
          {scannedAtLabel(scan.scannedAt)}
        </p>
        <NarrationBanner glyph="i" variant="reassurance">
          {DUPLICATE_RUN_NOTICE}
        </NarrationBanner>

        {duplicates.length > 0 ? (
          <>
            <p data-testid="duplicate-summary">
              {duplicateSummaryLine(duplicates.length, scan.totalPostsScanned)}
            </p>
            <Disclosure
              data-testid="duplicate-disclosure"
              summary={`Which ${duplicates.length === 1 ? 'item' : 'items'} will be skipped`}
            >
              {duplicates.map((d) => (
                <div className="disclosure-row" key={d.scanItemId}>
                  <b>{d.postTitle}</b> ({d.postTypeLabel}) — already there as{' '}
                  {d.matchedState === 'DRAFT' ? 'an unpublished draft' : 'a published post'},
                  under the title “{d.matchedTitle}”.
                </div>
              ))}
            </Disclosure>
          </>
        ) : null}

        {topicReuse.length > 0 ? (
          <Disclosure
            data-testid="topic-reuse-disclosure"
            summary={`${topicReuse.length} topic${
              topicReuse.length === 1 ? '' : 's'
            } already exist${topicReuse.length === 1 ? 's' : ''} and will be reused`}
          >
            {topicReuse.map((t) => (
              <div className="disclosure-row" key={t.sourceTopicId}>
                “{t.sourceTopicName}” → “{t.destinationTopicName}”
                {t.ambiguous ? (
                  <div className="disclosure-ambiguity">
                    More than one topic in the destination has this name. The first one is used.
                  </div>
                ) : null}
              </div>
            ))}
          </Disclosure>
        ) : null}
        <div className="ready-actions">
          <Button variant="secondary" onClick={onBack} disabled={backDisabled}>
            ← Back
          </Button>
          <Button onClick={onStart}>Start Transfer</Button>
        </div>
      </div>
    </div>
  )
}
