/**
 * One collapsible panel, three call sites (03-ui-direction.md §3.4):
 * Ready-to-Transfer's duplicate list, its topic-reuse list, and the Completion
 * Summary's topic detail.
 *
 * Built on native `<details>`/`<summary>` rather than a hand-rolled
 * button-plus-aria-expanded pair. That is not laziness — the native element
 * already gives Enter/Space toggling, Tab reachability, and an
 * expanded/collapsed state announced to assistive tech, all of which a
 * hand-rolled version has to reimplement and can only get wrong.
 *
 * The ▸/▾ marker is decoration. Per the never-icon-only rule the visible
 * "[expand]"/"[collapse]" text is real text in the summary line, swapped by
 * CSS on the `[open]` state — no JavaScript, and no state for React to get out
 * of sync with the DOM's own.
 */
import type { ReactNode } from 'react'

interface DisclosureProps {
  /** The always-visible line. Says what is inside AND how many. */
  summary: string
  children: ReactNode
  defaultOpen?: boolean
  'data-testid'?: string
}

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  'data-testid': testId,
}: DisclosureProps) {
  return (
    <details className="disclosure" open={defaultOpen} data-testid={testId}>
      <summary>
        <span>{summary}</span>
        <span className="disclosure-toggle disclosure-expand">[expand]</span>
        <span className="disclosure-toggle disclosure-collapse">[collapse]</span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  )
}
