/**
 * The shared "in-the-moment narration" banner (03-ui-direction.md §3).
 *
 * One component, three uses:
 *  - the duplicate-run notice on Source & Target Selection,
 *  - the same sentence restated on Ready to Transfer (UX Acceptance Scenario 16
 *    — identical copy, which is why it is a constant and not two literals),
 *  - the rate-limit pause banner on Batch Transfer Progress, which is a
 *    different event and carries its own distinct copy.
 *
 * It is never a modal interrupt.
 */
import type { ReactNode } from 'react'

/**
 * Reused verbatim at its two touchpoints. Do not retype it at a call site.
 *
 * UX Decision 11 / Acceptance Scenario 16 — this sentence used to WARN that
 * re-running creates duplicate drafts and that the app "does not check for
 * existing copies yet". That was true in v1 and is the literal opposite of what
 * this phase built, so it is now reassurance: the check exists, and saying so
 * is the whole point of having built it.
 *
 * The second sentence is not hedging — it is PM §6.7's non-goal, stated where
 * the teacher forms the expectation. Matching is by title, so a post edited
 * since the last run is skipped as a duplicate rather than re-copied. A
 * reassurance that omitted that would be a promise the engine does not keep.
 */
export const DUPLICATE_RUN_NOTICE =
  'Classroom Copier checks for items that already exist and skips them — safe to run more than once. ' +
  'Matches are found by title, so content changes since the last run aren’t detected.'

/** Same component, different event, its own copy. */
export function RATE_LIMIT_NOTICE(retryInSeconds: number): string {
  return `Google is rate-limiting requests — retrying automatically in ${retryInSeconds}s. Progress pauses here and resumes on its own.`
}

interface NarrationBannerProps {
  /**
   * The leading status glyph: `i` for the reassurance notice (the wireframe's
   * `(i)`), `!` for a genuine warning, `⏱` for the rate-limit pause.
   */
  glyph: string
  /**
   * `notice` is the amber warning treatment; `reassurance` is the teal one.
   *
   * These are not interchangeable skins. Amber IS the warning, in the other
   * medium — leaving the duplicate notice amber after its copy flipped would
   * have told a teacher "careful" in colour while the sentence said "safe",
   * which is the same defect QA-2 found in the text. The teal pairing is the
   * one the "Already in course" outcome pill already uses, so the promise and
   * the outcome that fulfils it read as the same thing.
   */
  variant?: 'notice' | 'reassurance' | 'rate-banner'
  children: ReactNode
}

/**
 * Explicit, because the class name and the prop value are no longer the same
 * word for every variant and a bare `className={variant}` would silently emit
 * an unstyled class the day someone adds one that differs.
 */
const VARIANT_CLASS: Record<NonNullable<NarrationBannerProps['variant']>, string> = {
  notice: 'notice',
  reassurance: 'reassurance-banner',
  'rate-banner': 'rate-banner',
}

export function NarrationBanner({ glyph, variant = 'notice', children }: NarrationBannerProps) {
  return (
    <div className={VARIANT_CLASS[variant]}>
      <span className="glyph" aria-hidden="true">
        {glyph}
      </span>
      <span>{children}</span>
    </div>
  )
}
