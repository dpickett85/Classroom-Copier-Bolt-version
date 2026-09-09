/**
 * Screen 4a — the pre-flight scan, and the container that decides whether the
 * Action Sheet is needed at all.
 *
 * Healthy scan (F1/F4): the status lines cycle, a brief "All clear" confirms,
 * and the flow auto-advances — Acceptance Scenario 2. The pause exists so the
 * transition does not read as a glitch.
 */
import { useEffect, useRef, useState } from 'react'
import type { PreflightResponse, Resolution } from '@classroom-copier/shared'
import { ActionSheetModal } from './ActionSheetModal'
import { isAbortError, runPreflight } from '../../lib/api-client'

export const SCAN_LINES = ['Checking topics…', 'Verifying attachments…', 'Checking permissions…']

interface PreflightScreenProps {
  sourceId: string
  targetId: string
  onReady: (scan: PreflightResponse, resolutions: Resolution[]) => void
  onCancel: () => void
  onError?: (error: unknown) => void
  /** How long each status line holds. */
  stepMs?: number
  /** How long "All clear" is shown before auto-advancing (~1s). */
  allClearMs?: number
}

export function PreflightScreen({
  sourceId,
  targetId,
  onReady,
  onCancel,
  onError,
  stepMs = 700,
  allClearMs = 1000,
}: PreflightScreenProps) {
  const [lineIndex, setLineIndex] = useState(0)
  const [scan, setScan] = useState<PreflightResponse | null>(null)
  const [allClear, setAllClear] = useState(false)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  // Run the scan once.
  useEffect(() => {
    let live = true
    const controller = new AbortController() // APPLY-M
    runPreflight(sourceId, targetId, controller.signal)
      .then((result) => {
        if (live) setScan(result)
      })
      .catch((error: unknown) => {
        if (live && !isAbortError(error)) onError?.(error)
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [sourceId, targetId, onError])

  // Cycle the status lines while the scan is outstanding.
  useEffect(() => {
    if (scan) return undefined
    const handle = setInterval(() => {
      setLineIndex((i) => Math.min(i + 1, SCAN_LINES.length - 1))
    }, stepMs)
    return () => clearInterval(handle)
  }, [scan, stepMs])

  // Healthy scan: confirm, then advance.
  useEffect(() => {
    if (!scan || scan.findings.length > 0) return undefined
    setAllClear(true)
    const handle = setTimeout(() => onReadyRef.current(scan, []), allClearMs)
    return () => clearTimeout(handle)
  }, [scan, allClearMs])

  if (scan && scan.findings.length > 0) {
    return (
      <ActionSheetModal
        findings={scan.findings}
        onContinue={(resolutions) => onReady(scan, resolutions)}
        onCancel={onCancel}
      />
    )
  }

  return (
    <div className="scanning" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <div className="scan-lines">
        {SCAN_LINES.map((line, i) => (
          <div key={line} className={allClear || i < lineIndex ? 'done' : i === lineIndex ? 'active' : ''}>
            {line}
          </div>
        ))}
        {allClear ? <div className="done">All clear</div> : null}
      </div>
    </div>
  )
}
