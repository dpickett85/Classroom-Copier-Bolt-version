/**
 * D30 — outcome-icon text alternatives, with an acceptance gate.
 *
 * The glyph is `aria-hidden` decoration; the text label is always rendered and
 * always carried on the wrapper's accessible name. `labelVisibility` chooses
 * between showing the label and visually hiding it — there is deliberately NO
 * option that removes it. Rendering this component glyph-only is not
 * expressible, which is the point: colour and shape alone never carry an
 * outcome.
 */
import type { Outcome, SkipReason } from '@classroom-copier/shared'

export const OUTCOME_GLYPH: Record<Outcome, string> = {
  pending: '·',
  transferred: '✓',
  fallback_shell: '◆',
  skipped: '⊘',
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  pending: 'in progress',
  transferred: 'transferred',
  fallback_shell: 'fallback shell',
  skipped: 'skipped',
}

const OUTCOME_TINT: Record<Outcome, string> = {
  pending: 'icon-skip',
  transferred: 'icon-ok',
  fallback_shell: 'icon-note',
  skipped: 'icon-skip',
}

/**
 * The duplicate treatment. `≡` (U+2261, IDENTICAL TO) — "matches something
 * already there" — chosen over a geometric-shapes glyph for font coverage:
 * it sits in mathematical operators, which IBM Plex Mono covers, rather than
 * the more sparsely-implemented geometric shapes block.
 *
 * MANUAL-VERIFY (§3.3): confirm `≡` renders as expected in IBM Plex Mono in a
 * real browser, and substitute a bold ASCII `=` if it does not. Not verifiable
 * under jsdom, which has no fonts.
 */
export const DUPLICATE_GLYPH = '≡'
export const DUPLICATE_LABEL = 'already in course'

function isDuplicate(outcome: Outcome, skipReason: SkipReason | null | undefined): boolean {
  return outcome === 'skipped' && skipReason === 'duplicate_title'
}

interface OutcomeIconProps {
  outcome: Outcome
  /** Additive and backward-compatible: no prop, no change (§3.3). */
  skipReason?: SkipReason | null
  /**
   * Whether the paired text label is shown or visually hidden. Both values
   * render the label; neither removes it.
   */
  labelVisibility?: 'visible' | 'sr-only'
}

export function OutcomeIcon({
  outcome,
  skipReason = null,
  labelVisibility = 'visible',
}: OutcomeIconProps) {
  const duplicate = isDuplicate(outcome, skipReason)
  const label = duplicate ? DUPLICATE_LABEL : OUTCOME_LABEL[outcome]
  return (
    <span className="outcome-icon" role="img" aria-label={label}>
      <span
        className={`ticker-icon ${duplicate ? 'icon-duplicate' : OUTCOME_TINT[outcome]}`}
        aria-hidden="true"
      >
        {duplicate ? DUPLICATE_GLYPH : OUTCOME_GLYPH[outcome]}
      </span>
      <span className={labelVisibility === 'sr-only' ? 'sr-only' : undefined}>{label}</span>
    </span>
  )
}
