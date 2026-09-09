/**
 * The generic catch-all (02-ux-workflow.md §5, Deltas P1). Register per
 * 03-ui-direction.md §4: plainspoken, no exclamation points, and it never
 * blames the teacher — the system is the thing that had the problem.
 *
 * `--red-700` is used here and effectively nowhere else: true errors only.
 */
import { useEffect, useRef } from 'react'
import { Button } from './Button'

interface ErrorStateProps {
  /**
   * P0-5 — OPTIONAL, and omitted when retrying cannot work. A job that reached
   * `failed` server-side will still be `failed` on the next poll, so offering
   * "Retry" there is a button that is guaranteed to do nothing; the honest
   * action is to start over. Every Retry this component renders is wired to
   * something that actually re-enters.
   */
  onRetry?: () => void
  onStartOver: () => void
  /** An optional plain-language line about what specifically did not work. */
  detail?: string
}

export function ErrorState({ onRetry, onStartOver, detail }: ErrorStateProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  /**
   * UI §6 / QA-4 — this screen REPLACES the one the teacher was on (4a, session
   * expired mid-wizard, is exactly this component), so the control they had
   * focus on no longer exists and the browser drops focus to `<body>`. Moving
   * it to the heading is the same pattern the Completion Summary has used since
   * v1: the page change gets announced, and the next Tab starts from the top of
   * the new content rather than the top of the document.
   */
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="error-state" data-testid="error-state">
      <div className="error-glyph" aria-hidden="true">
        ×
      </div>
      <h2 ref={headingRef} tabIndex={-1}>
        Something went wrong
      </h2>
      <p>
        {onRetry
          ? 'Nothing was lost. You can try again, or start over from the beginning.'
          : 'Nothing was lost. You can start over from the beginning.'}
      </p>
      {detail ? <p className="mock-note">{detail}</p> : null}
      <div className="error-actions">
        {onRetry ? <Button onClick={onRetry}>Retry</Button> : null}
        <Button variant={onRetry ? 'secondary' : 'primary'} onClick={onStartOver}>
          Start Over
        </Button>
      </div>
    </div>
  )
}
