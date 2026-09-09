/**
 * The itemized log's outcome pill: text + colour, never colour alone
 * (03-ui-direction.md §6). All filterable outcome kinds have a sanctioned
 * style — Skipped included.
 *
 * `duplicate_title` is a SkipReason, NOT a fifth Outcome: the Outcome enum
 * stays four-valued per PM §6.5's closed-vocabulary rule. So the distinction
 * arrives as an optional `skipReason` prop, and every existing call site that
 * passes no prop is unaffected.
 */
import { isDuplicateSkip, isUserSkip } from '@classroom-copier/shared'
import type { Outcome, SkipReason } from '@classroom-copier/shared'

/**
 * THE label function. One implementation, three consumers — this pill, the
 * filter dropdown, and the CSV export.
 *
 * A second implementation of "what does this outcome mean" is how the exported
 * file starts disagreeing with the table it was exported from, which is the
 * same failure the reconciliation line's own comment already warns about.
 */
export function outcomeText(outcome: Outcome, skipReason?: SkipReason | null): string {
  // F4 — the partition comes from `shared`, which is where the SERVER already
  // reads it from to fill `skippedByUser`. Re-listing the reasons here was a
  // second implementation of the same three-way split: a new user-skip reason
  // added to `USER_SKIP_REASONS` would be counted as a user skip by the server
  // and rendered as a generic "Skipped" by this client, with nothing red.
  if (outcome !== 'skipped') return OUTCOME_TEXT[outcome]
  if (isDuplicateSkip(skipReason)) return 'Already in course'
  if (isUserSkip(skipReason)) return 'Skipped — you chose to skip'
  // The system-interrupted reasons keep their existing generic treatment: this
  // phase's scope is the duplicate/user distinction only.
  return OUTCOME_TEXT[outcome]
}

/** The base text for each outcome, with no skip reason to refine it. */
export const OUTCOME_TEXT: Record<Outcome, string> = {
  pending: 'In progress',
  transferred: 'Transferred',
  fallback_shell: 'Fallback',
  skipped: 'Skipped',
}

const CLASS_NAME: Record<Outcome, string> = {
  pending: 'outcome-skipped',
  transferred: 'outcome-transferred',
  fallback_shell: 'outcome-fallback',
  skipped: 'outcome-skipped',
}

export function OutcomePill({
  outcome,
  skipReason = null,
}: {
  outcome: Outcome
  skipReason?: SkipReason | null
}) {
  const duplicate = outcome === 'skipped' && isDuplicateSkip(skipReason)
  const className = duplicate ? 'outcome-duplicate' : CLASS_NAME[outcome]
  return (
    <span className={`outcome-pill ${className}`}>{outcomeText(outcome, skipReason)}</span>
  )
}
