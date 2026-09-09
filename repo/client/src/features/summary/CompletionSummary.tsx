/**
 * Screen 6 — the Completion Summary. A full-screen report surface, not a modal
 * (02-ux-workflow.md Deltas P0 #1): at F4's 50-post volume a dialog cannot hold
 * the itemized log, and the zero-silent-drop guarantee is only a guarantee if
 * every outcome is actually reviewable.
 *
 * Two rules here are correctness, not layout:
 *
 *  - **D14.** "Skipped by you" binds to `skippedByUser` and nothing else. Any
 *    `skippedBySystem` is reported on its own line, in its own words. A post
 *    the server abandoned must never appear on screen as a choice the teacher
 *    made.
 *  - **Scenario 15.** The reconciliation line renders the server's counts. Its
 *    terms are transferred + fallbackShell + skippedDuplicate + skippedByUser,
 *    plus a labelled fifth term for skippedBySystem that appears only when that
 *    count is non-zero — the split ledger this stage introduced, not the earlier
 *    three-term sum. The total is `totalItems` as the server reports it: the
 *    arithmetic is not re-derived here, because a second implementation of the
 *    sum is exactly how a ledger starts disagreeing with itself. Topics and
 *    rubric notes are tiles and are never terms.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TransferJobItemRow, TransferJobStatus, TypeSpecificFields } from '@classroom-copier/shared'
import { Button, Disclosure, OutcomePill, outcomeText } from '../../components/shared'

/**
 * Five options, up from four. `duplicate` and `user_skip` are SkipReasons, not
 * Outcomes, so the filter predicate cannot be a bare `outcome ===` comparison
 * any more — it lives in `matchesFilter` below, once.
 */
type OutcomeFilter = 'all' | 'transferred' | 'fallback_shell' | 'duplicate' | 'user_skip'

const FILTERS: ReadonlyArray<{ value: OutcomeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'transferred', label: 'Transferred' },
  { value: 'fallback_shell', label: 'Fallback' },
  { value: 'duplicate', label: 'Already in course' },
  { value: 'user_skip', label: 'Skipped by you' },
]

export function matchesFilter(item: TransferJobItemRow, filter: OutcomeFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'transferred':
      return item.outcome === 'transferred'
    case 'fallback_shell':
      return item.outcome === 'fallback_shell'
    case 'duplicate':
      return item.skippedBy === 'duplicate'
    case 'user_skip':
      return item.skippedBy === 'user'
    default:
      return true
  }
}

export function systemSkipLine(count: number): string {
  const one = count === 1
  return `${count} post${one ? '' : 's'} ${one ? 'was' : 'were'} interrupted before we could confirm ${
    one ? 'it' : 'they'
  } copied — see the log below.`
}

/**
 * The "Type-specific fields" cell. `none` is genuinely empty — the em dash is
 * decoration, not content — so a Material never carries a due date or points
 * it does not have.
 */
function TypeSpecificCell({ fields }: { fields: TypeSpecificFields }) {
  switch (fields.kind) {
    case 'graded':
      return <td>{`Due: cleared · Max pts: ${fields.maxPoints ?? '—'}`}</td>
    case 'multipleChoice':
      return <td>{`Answer: Multiple choice (${fields.optionCount} opts)`}</td>
    case 'shortAnswer':
      return <td>Answer: Short answer</td>
    case 'none':
    default:
      return (
        <td className="type-specific-empty">
          <span aria-hidden="true">—</span>
        </td>
      )
  }
}

/**
 * 5a — the plain-text mirror of `TypeSpecificCell`'s content for each type,
 * used by the CSV export. The `none` case is genuinely empty here too — no
 * decorative em dash, since a CSV cell has no "decoration".
 */
function typeSpecificText(fields: TypeSpecificFields): string {
  switch (fields.kind) {
    case 'graded':
      return `Due: cleared · Max pts: ${fields.maxPoints ?? '—'}`
    case 'multipleChoice':
      return `Answer: Multiple choice (${fields.optionCount} opts)`
    case 'shortAnswer':
      return 'Answer: Short answer'
    case 'none':
    default:
      return ''
  }
}

/** RFC 4180 — a field is quoted only when it contains a comma, a double
 *  quote, or a line break; an embedded quote is escaped by doubling it. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

const LOG_CSV_HEADER = ['Title', 'Type', 'Topic', 'Outcome', 'Type-specific fields', 'Note']

/**
 * 5a — client-side CSV of the itemized log, mirroring the on-screen table
 * exactly: same six columns, same values, the FULL log regardless of the
 * outcome filter currently applied on screen (an export that silently
 * dropped filtered-out rows would be its own kind of silent drop).
 */
export function buildLogCsv(items: TransferJobItemRow[]): string {
  const rows = [
    LOG_CSV_HEADER,
    ...items.map((item) => [
      item.title,
      item.typeLabel,
      item.topicName ?? '(none)',
      // The SAME label function the on-screen Outcome column renders through.
      // A second implementation here is how the exported file starts
      // disagreeing with the table it was exported from.
      outcomeText(item.outcome, item.skipReason),
      typeSpecificText(item.typeSpecific),
      item.note ?? '',
    ]),
  ]
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n')
}

export function logCsvFilename(jobId: string): string {
  return `classroom-copier-log-${jobId}.csv`
}

/**
 * NOTE: this viewer environment's sandbox can make an anchor-download inert,
 * but `URL.createObjectURL` + a synthetic anchor click is the standard
 * client-only download mechanism and works in a real browser — the part
 * that is actually tested is `buildLogCsv`'s output, not this click path.
 */
function downloadLogCsv(jobId: string, items: TransferJobItemRow[]): void {
  const blob = new Blob([buildLogCsv(items)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = logCsvFilename(jobId)
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-num">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

interface CompletionSummaryProps {
  status: TransferJobStatus
  items: TransferJobItemRow[]
  onOpenTargetCourse: () => void
  onStartAnother: () => void
}

export function CompletionSummary({
  status,
  items,
  onOpenTargetCourse,
  onStartAnother,
}: CompletionSummaryProps) {
  const [filter, setFilter] = useState<OutcomeFilter>('all')
  const headingRef = useRef<HTMLHeadingElement>(null)

  // D30 — focus moves to the heading so the page change is announced.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const visible = useMemo(
    () => items.filter((item) => matchesFilter(item, filter)),
    [items, filter],
  )

  // §3.2's corrected formula. The four Group-A terms are the common case and
  // are checkable BY EYE against the four tiles above, left to right — which
  // only works because the term order matches the tile order.
  //
  // The fifth term appears ONLY when skippedBySystem > 0, and is labelled
  // rather than bare, because it has no Group-A tile to be checked against by
  // position. It reads the same server aggregate `systemSkipLine` already
  // renders below — the same number twice, never a second computation of it.
  const reconciliation =
    `✓ ${status.transferred} + ${status.fallbackShell} + ${status.skippedDuplicate} + ` +
    `${status.skippedByUser}` +
    (status.skippedBySystem > 0 ? ` + ${status.skippedBySystem} interrupted` : '') +
    ` = ${status.totalItems} of ${status.totalPostsScanned} posts scanned — ` +
    `every post resolved to a transfer, fallback, or skip.`

  const topicsReferenced = status.topicsCreatedCount + status.topicsReusedCount

  return (
    <div className="screen">
      <h2 className="screen-title" ref={headingRef} tabIndex={-1}>
        Transfer complete.
      </h2>

      {/* Cancel — the partial-completion contract. `cancelledAt` is written in
          the SAME statement as `status: 'completed'`, never a status of its
          own, so this banner is the only thing that distinguishes a cancelled
          run from a fully finished one. */}
      {status.cancelledAt ? (
        <div className="notice" data-testid="cancelled-banner">
          <span className="glyph" aria-hidden="true">
            !
          </span>
          <span>
            You cancelled this transfer. The post in progress finished; every post still waiting
            was skipped and counted below. Drafts already created stay as they are.
          </span>
        </div>
      ) : null}

      {/* Two labelled ledger sections, not one seven-tile row (§3.2). The
          split is what makes visible, by layout alone, which numbers sum to
          the total below and which never do. */}
      <div className="stat-groups" data-testid="stat-groups-region">
        <div>
          <div className="stat-group-label">Items scanned</div>
          <div className="stat-group-grid" data-testid="stat-group-items">
            {/* Order matches the reconciliation line's term order below, so
                the arithmetic is checkable by eye against the tiles. */}
            <StatTile value={status.transferred} label="Drafts transferred" />
            <StatTile value={status.fallbackShell} label="Fallback shells" />
            <StatTile value={status.skippedDuplicate} label="Skipped, already existed" />
            {/* D14: skippedByUser ONLY — never any other skip. */}
            <StatTile value={status.skippedByUser} label="Skipped by you" />
          </div>
        </div>

        <div>
          <div className="stat-group-label">Reported separately</div>
          <div className="stat-group-grid topics-group" data-testid="stat-group-separate">
            <StatTile value={status.topicsCreatedCount} label="Topics created" />
            <StatTile value={status.topicsReusedCount} label="Topics reused" />
            <StatTile value={status.rubricNotesAdded} label="Rubric notes added" />
          </div>
          <p className="topics-callout" data-testid="topics-callout">
            Topics are reported separately and never counted in the item total above — reusing an
            existing topic is not an item outcome. {status.topicsCreatedCount} created +{' '}
            {status.topicsReusedCount} reused = {topicsReferenced} topic
            {topicsReferenced === 1 ? '' : 's'} referenced by this transfer.
          </p>
          {status.topicsReusedCount > 0 ? (
            <Disclosure
              data-testid="topic-detail"
              summary={`${status.topicsReusedCount} topic${
                status.topicsReusedCount === 1 ? '' : 's'
              } already existed and ${status.topicsReusedCount === 1 ? 'was' : 'were'} reused`}
            >
              <div className="disclosure-row">
                Items filed into these topics were added to the topic already in the destination
                course, rather than into a second topic with the same name.
              </div>
            </Disclosure>
          ) : null}
        </div>
      </div>

      {status.skippedBySystem > 0 ? (
        <p className="system-skip-line" data-testid="system-skip-line">
          <span className="glyph" aria-hidden="true">
            ⊘
          </span>
          <span>{systemSkipLine(status.skippedBySystem)}</span>
        </p>
      ) : null}

      <div className="reconcile" data-testid="reconciliation">
        {reconciliation}
      </div>

      <div className="log-filter">
        <label className="field-label" htmlFor="outcome-filter" style={{ marginBottom: 0 }}>
          Filter by outcome
        </label>
        <select
          id="outcome-filter"
          className="select-input"
          style={{ width: 'auto' }}
          value={filter}
          onChange={(e) => setFilter(e.target.value as OutcomeFilter)}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {/* UI-Δ1: horizontal scroll with a sticky Title column. Never cards.
          tabIndex + aria-label make the scroll region itself keyboard-
          reachable (arrow/Page keys scroll a focused element natively) —
          without this, a keyboard-only user on a narrow viewport has no way
          to reach the columns hidden past the fold. Nothing here traps
          focus; Tab continues past the region exactly as it did before. */}
      <div
        className="log-scroll"
        tabIndex={0}
        role="region"
        aria-label="Itemized transfer log, scrollable horizontally"
      >
        <table className="log-table">
          <caption className="sr-only">Itemized log of every post in this transfer</caption>
          <thead>
            <tr>
              <th scope="col" className="log-title-col">
                Title
              </th>
              <th scope="col">Type</th>
              <th scope="col">Topic</th>
              <th scope="col">Outcome</th>
              <th scope="col">Type-specific fields</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id}>
                <td className="log-title-col">{item.title}</td>
                <td>{item.typeLabel}</td>
                <td>{item.topicName ?? '(none)'}</td>
                <td>
                  <OutcomePill outcome={item.outcome} skipReason={item.skipReason} />
                </td>
                <TypeSpecificCell fields={item.typeSpecific} />
                {/* Rendered in full. Never truncated, never ellipsized. */}
                <td className="note-cell">{item.note ?? <span aria-hidden="true">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="summary-actions">
        <Button variant="secondary" onClick={() => downloadLogCsv(status.jobId, items)}>
          Export log (CSV)
        </Button>
        <Button variant="secondary" onClick={onOpenTargetCourse}>
          Open target course
        </Button>
        <Button onClick={onStartAnother}>Start another transfer</Button>
      </div>
    </div>
  )
}
