/**
 * Fix 1 — `scan_stale` and `scan_already_used` are real 409s from
 * `POST /transfer-jobs`, distinct from the double-submit self-heal
 * (`job_already_running`, D5) and distinct from every other failure. Both
 * used to fall into the generic catch-all, which told the teacher nothing
 * they could act on. Both recover the same way — re-scan the same two
 * courses — so both get dedicated copy and a primary action that routes
 * straight back to Pre-flight rather than back to Selection.
 */
import { Button } from './Button'

export type ScanConflictKind = 'scan_stale' | 'scan_already_used'

const COPY: Record<ScanConflictKind, { heading: string; body: string }> = {
  scan_stale: {
    heading: 'This scan is out of date.',
    body: 'Too much time passed since the last scan, and the source course may have changed since. Scan it again before starting the transfer.',
  },
  scan_already_used: {
    heading: 'This scan was already used.',
    body: 'A transfer already ran from this scan, so it cannot start a second one. Scan the course again to start a new transfer.',
  },
}

interface ScanConflictNoticeProps {
  kind: ScanConflictKind
  /** Routes back to Pre-flight with the same source/target still selected. */
  onRescan: () => void
}

export function ScanConflictNotice({ kind, onRescan }: ScanConflictNoticeProps) {
  const copy = COPY[kind]
  return (
    <div className="error-state" data-testid="scan-conflict-state">
      <div className="error-glyph notice-glyph" aria-hidden="true">
        !
      </div>
      <h2>{copy.heading}</h2>
      <p>{copy.body}</p>
      <div className="error-actions">
        <Button onClick={onRescan}>Scan again</Button>
      </div>
    </div>
  )
}
