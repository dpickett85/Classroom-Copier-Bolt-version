/**
 * The one cold-start surface (03-ui-direction.md §3, D4). Built once and
 * reused wherever `frontend-api-client` reports an unresolved call past the
 * 2s threshold — never bespoke per screen.
 *
 * The copy is static on purpose: this is a single `aria-live="polite"`
 * announcement, not a ticking counter that would re-announce every second.
 */

export const COLD_START_TITLE = 'Waking up server…'
export const COLD_START_SUBLINE = 'This can take up to 50 seconds the first time.'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function ColdStartOverlay() {
  // A static equivalent rather than an animation, per 03-ui-direction.md §6.
  const spinnerClass = prefersReducedMotion() ? 'spinner-static' : 'spinner'

  return (
    <div className="coldstart" role="status" aria-live="polite">
      <div className={spinnerClass} aria-hidden="true" />
      <div className="coldstart-title">{COLD_START_TITLE}</div>
      <div className="coldstart-sub">{COLD_START_SUBLINE}</div>
    </div>
  )
}
