/**
 * Screen 3 — Source & Target Selection.
 *
 * Scenario 17 scoping is enforced by the API (`role=source` returns
 * ACTIVE+ARCHIVED, `role=target` returns ACTIVE only), so this screen renders
 * two independent lists rather than filtering one list two ways — a client-side
 * filter would be a second, drifting definition of the same rule.
 *
 * DEVIATION FROM THE MOCKUP, noted deliberately: the mockup draws the two
 * fields as `.select-input` divs containing `<Badge>` elements. A native
 * `<select>` cannot contain markup inside `<option>`, and 02-ux-workflow.md §3
 * asks for real dropdowns. The badge text is therefore folded into the option
 * label, and the styled `<Badge>` stamps are rendered beneath the field for the
 * currently-selected course, so both the accessible name and the visual stamp
 * survive.
 */
import { useEffect, useMemo, useState } from 'react'
import type { CourseSummary } from '@classroom-copier/shared'
import { Badge, Button, DUPLICATE_RUN_NOTICE, NarrationBanner } from '../../components/shared'
import { isAbortError, listCourses } from '../../lib/api-client'

export const SAME_COURSE_ERROR = 'Choose two different courses.'

export function sourceOptionLabel(course: CourseSummary): string {
  const section = course.section ? ` — ${course.section}` : ''
  const state = course.state === 'ARCHIVED' ? 'Archived' : 'Active'
  const posts = `${course.postCount} post${course.postCount === 1 ? '' : 's'}`
  return `${course.name}${section} · ${state} · ${posts}`
}

export function targetOptionLabel(course: CourseSummary): string {
  const section = course.section ? ` — ${course.section}` : ''
  const shell = course.isSisShell ? ' · SIS Roster Shell' : ''
  return `${course.name}${section} · Active${shell}`
}

function CourseStamps({ course }: { course: CourseSummary | undefined }) {
  if (!course) return null
  return (
    <p className="mock-note" style={{ marginTop: 6 }}>
      <Badge kind={course.state === 'ARCHIVED' ? 'archived' : 'active'} />
      {course.isSisShell ? <Badge kind="sis" /> : null}
    </p>
  )
}

interface SelectionScreenProps {
  onContinue: (source: CourseSummary, target: CourseSummary) => void
  initialSourceId?: string
  initialTargetId?: string
}

export function SelectionScreen({
  onContinue,
  initialSourceId = '',
  initialTargetId = '',
}: SelectionScreenProps) {
  const [sources, setSources] = useState<CourseSummary[]>([])
  const [targets, setTargets] = useState<CourseSummary[]>([])
  const [sourceId, setSourceId] = useState(initialSourceId)
  const [targetId, setTargetId] = useState(initialTargetId)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let live = true
    // APPLY-M — abort on unmount. A `live` flag keeps React quiet but leaves the
    // fetch running and the global slow-request counter incremented, so the
    // cold-start overlay could outlive the screen that raised it.
    const controller = new AbortController()
    Promise.all([listCourses('source', controller.signal), listCourses('target', controller.signal)])
      .then(([s, t]) => {
        if (!live) return
        setSources(s.courses)
        setTargets(t.courses)
      })
      .catch((error: unknown) => {
        if (live && !isAbortError(error)) setLoadFailed(true)
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [])

  const source = useMemo(() => sources.find((c) => c.id === sourceId), [sources, sourceId])
  const target = useMemo(() => targets.find((c) => c.id === targetId), [targets, targetId])

  const collision = sourceId !== '' && sourceId === targetId
  const canContinue = sourceId !== '' && targetId !== '' && !collision

  return (
    <div className="screen">
      <h2 className="screen-title">Choose a source and a target course</h2>
      <p className="screen-sub">
        Classwork is copied from the source into the target. The target keeps everything it already
        has.
      </p>

      {loadFailed ? <p className="field-error">Your course list could not be loaded.</p> : null}

      <div className="field-group">
        <label className="field-label" htmlFor="source-course">
          Copy from (source)
        </label>
        <select
          id="source-course"
          className="select-input"
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
        >
          <option value="">Select a course…</option>
          {sources.map((course) => (
            <option key={course.id} value={course.id}>
              {sourceOptionLabel(course)}
            </option>
          ))}
        </select>
        <CourseStamps course={source} />
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="target-course">
          Copy to (target)
        </label>
        <select
          id="target-course"
          className="select-input"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          aria-describedby={collision ? 'target-course-error' : undefined}
          aria-invalid={collision || undefined}
        >
          <option value="">Select a course…</option>
          {targets.map((course) => (
            <option key={course.id} value={course.id}>
              {targetOptionLabel(course)}
            </option>
          ))}
        </select>
        <CourseStamps course={target} />
      </div>

      {collision ? (
        <p className="field-error" id="target-course-error" role="alert">
          {SAME_COURSE_ERROR}
        </p>
      ) : null}

      <NarrationBanner glyph="i" variant="reassurance">
        {DUPLICATE_RUN_NOTICE}
      </NarrationBanner>

      <div className="actions-row">
        <Button
          disabled={!canContinue}
          onClick={() => {
            if (source && target) onContinue(source, target)
          }}
        >
          Continue →
        </Button>
      </div>
    </div>
  )
}
