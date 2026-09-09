/**
 * `1 Select — 2 Pre-flight — 3 Transfer — 4 Summary`.
 *
 * Deliberately NON-INTERACTIVE (02-ux-workflow.md §2): it orients, it does not
 * let the teacher jump ahead. No links, no buttons — only `aria-current="step"`
 * on the step the flow is actually on.
 */

export type StepNumber = 1 | 2 | 3 | 4

const STEPS: ReadonlyArray<{ n: StepNumber; label: string }> = [
  { n: 1, label: '1 Select' },
  { n: 2, label: '2 Pre-flight' },
  { n: 3, label: '3 Transfer' },
  { n: 4, label: '4 Summary' },
]

interface StepIndicatorProps {
  current: StepNumber
}

export function StepIndicator({ current }: StepIndicatorProps) {
  return (
    <div className="steps" aria-label="Progress through the transfer">
      {STEPS.map(({ n, label }) => {
        const state = n === current ? 'current' : n < current ? 'done' : ''
        return (
          <span
            key={n}
            className={`step ${state}`.trim()}
            {...(n === current ? { 'aria-current': 'step' as const } : {})}
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}
