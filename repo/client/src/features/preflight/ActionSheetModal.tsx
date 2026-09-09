/**
 * Screen 4b — the Action Sheet Modal. Renders only when the scan produced
 * findings; blocking until every row resolves.
 *
 * Two independent visual states, never conflated (03-ui-direction.md §3):
 *   - `.recommended` is a STATIC per-row label — the teal tint plus the
 *     "Recommended" stamp. It never changes with what is chosen.
 *   - `.selected` is the DYNAMIC interaction state with its own shape change,
 *     so a teacher who picks "Link Existing File" gets the same visible
 *     confirmation as one who accepts the recommendation.
 *
 * Every option label comes from `finding.options` — the server owns the
 * type-aware wording ("Skip Material", "Skip Question"). Nothing here
 * reconstructs a label, which is what stops "Skip Assignment" from being
 * hardcoded onto a Material.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { AttachmentIssue, PreflightFinding, Resolution, ResolutionKind } from '@classroom-copier/shared'
import { Button } from '../../components/shared'

const ISSUE_TEXT: Record<AttachmentIssue, string> = {
  trashed: 'Issue: file is trashed or deleted.',
  deleted: 'Issue: file is trashed or deleted.',
  permission_locked: 'Issue: permission-locked (co-teacher owned).',
}

export const AUTO_FIX_LABEL = 'Apply recommended fixes automatically'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ActionSheetModalProps {
  findings: PreflightFinding[]
  onContinue: (resolutions: Resolution[]) => void
  onCancel: () => void
  /** Focus returns here when the dialog closes (03-ui-direction.md §6). */
  returnFocusTo?: RefObject<HTMLElement | null>
}

export function ActionSheetModal({
  findings,
  onContinue,
  onCancel,
  returnFocusTo,
}: ActionSheetModalProps) {
  const [choices, setChoices] = useState<Record<string, ResolutionKind>>({})
  const [autoFix, setAutoFix] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // First focus lands on the heading.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // Focus returns to the triggering control when the dialog goes away.
  useEffect(() => {
    const target = returnFocusTo
    return () => {
      target?.current?.focus()
    }
  }, [returnFocusTo])

  /**
   * The trap is built from sentinels rather than a keydown handler, because a
   * radio group is a single tab stop whose focused member is not necessarily
   * the last one in the DOM — comparing `document.activeElement` against the
   * last focusable node lets focus escape straight out of a dialog whose
   * options are radios, which is exactly what this dialog is made of.
   */
  const focusEdge = useCallback((edge: 'first' | 'last') => {
    const dialog = dialogRef.current
    if (!dialog) return
    const items = Array.from(
      dialog.querySelectorAll<HTMLElement>(`${FOCUSABLE.split(', ').join(':not([data-focus-sentinel]), ')}:not([data-focus-sentinel])`),
    )
    const target = edge === 'first' ? items[0] : items[items.length - 1]
    target?.focus()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
    }
  }

  const choose = (findingId: string, kind: ResolutionKind) => {
    setChoices((prev) => ({ ...prev, [findingId]: kind }))
  }

  const toggleAutoFix = () => {
    const next = !autoFix
    setAutoFix(next)
    if (!next) return
    // Turning it on selects every row's recommended option at once.
    const applied: Record<string, ResolutionKind> = {}
    for (const finding of findings) {
      const recommended = finding.options.find((o) => o.recommended)
      if (recommended) applied[finding.id] = recommended.kind
    }
    setChoices((prev) => ({ ...prev, ...applied }))
  }

  const resolved = findings.every((f) => choices[f.id] !== undefined)
  const count = findings.length
  const heading = `We found ${count} item${count === 1 ? '' : 's'} that need${
    count === 1 ? 's' : ''
  } your attention before copying.`

  const submit = () => {
    const resolutions = findings
      .map((finding) => {
        const kind = choices[finding.id]
        return kind ? ({ kind, findingId: finding.id } as Resolution) : null
      })
      .filter((r): r is Resolution => r !== null)
    onContinue(resolutions)
  }

  return (
    <div className="modal-backdrop" onKeyDown={onKeyDown}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-sheet-heading"
        ref={dialogRef}
      >
        <div data-focus-sentinel="start" tabIndex={0} onFocus={() => focusEdge('last')} />
        <div className="modal-head">
          <h3 id="action-sheet-heading" ref={headingRef} tabIndex={-1}>
            {heading}
          </h3>
          <button type="button" className="modal-close" onClick={onCancel}>
            ✕ Cancel
          </button>
        </div>

        <button
          type="button"
          className="toggle-row"
          role="switch"
          aria-checked={autoFix}
          onClick={toggleAutoFix}
        >
          <span className={autoFix ? 'switch on' : 'switch'} aria-hidden="true" />
          <span className="toggle-copy">
            <b>{AUTO_FIX_LABEL}</b> — off by default. Review each item, or turn this on to accept the
            recommended option for every row.
          </span>
        </button>

        {findings.map((finding) => (
          <fieldset key={finding.id} className="issue-row">
            <legend className="sr-only">
              {finding.attachmentName} on “{finding.postTitle}”
            </legend>
            <div className="issue-context">
              Attached to “{finding.postTitle}” ({finding.postTypeLabel})
            </div>
            <div className="issue-file">{finding.attachmentName}</div>
            <div className="issue-desc">{ISSUE_TEXT[finding.issue]}</div>

            {finding.options.map((option) => {
              const selected = choices[finding.id] === option.kind
              const classes = [
                'option',
                option.recommended ? 'recommended' : '',
                selected ? 'selected' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <div key={option.kind}>
                  <label className={classes}>
                    <input
                      type="radio"
                      name={`finding-${finding.id}`}
                      value={option.kind}
                      checked={selected}
                      onChange={() => choose(finding.id, option.kind)}
                    />
                    <span className="radio" aria-hidden="true" />
                    <span>{option.label}</span>
                    {option.recommended ? <span className="stamp">Recommended</span> : null}
                  </label>
                  {option.riskWarning ? (
                    <p className="risk-warning">{option.riskWarning}</p>
                  ) : null}
                </div>
              )
            })}
          </fieldset>
        ))}

        <div className="modal-foot">
          <Button disabled={!resolved} onClick={submit}>
            Continue →
          </Button>
        </div>
        <div data-focus-sentinel="end" tabIndex={0} onFocus={() => focusEdge('first')} />
      </div>
    </div>
  )
}
