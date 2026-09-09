import { describe, expect, it } from 'vitest'
import {
  CancelTransferJobResponseSchema,
  NON_TERMINAL_JOB_STATUSES,
  ResolutionSchema,
  DUPLICATE_SKIP_REASONS,
  SkipReasonSchema,
  SYSTEM_SKIP_REASONS,
  TERMINAL_JOB_STATUSES,
  TransferJobStatusSchema,
  TypeSpecificFieldsSchema,
  USER_SKIP_REASONS,
  isDuplicateSkip,
  isSystemSkip,
  isTerminalJobStatus,
  isUserSkip,
} from './api-types.js'
import {
  attachmentFallbackNote,
  cancelledByUserNote,
  rateLimitExhaustionNote,
  rubricDegradedNote,
} from './notes.js'

describe('Resolution (D15) — the discriminated union', () => {
  it('accepts each of the five Action-Sheet options', () => {
    for (const kind of [
      'create_draft_shell_with_note',
      'skip_post',
      'copy_to_my_drive',
      'link_existing_file',
      'skip_attachment_and_note_draft',
    ] as const) {
      expect(ResolutionSchema.parse({ kind, findingId: 'f1' })).toEqual({ kind, findingId: 'f1' })
    }
  })

  it('rejects an unknown kind at runtime rather than ignoring it silently', () => {
    expect(ResolutionSchema.safeParse({ kind: 'do_whatever', findingId: 'f1' }).success).toBe(false)
  })
})

describe('job status (D5) — one definition of terminal', () => {
  it('never treats a rate-limit pause as a status', () => {
    // A paused job used to escape the single-active-job index while /active
    // still returned it — the exact double-submit window D5 exists for.
    expect([...TERMINAL_JOB_STATUSES, ...NON_TERMINAL_JOB_STATUSES]).not.toContain(
      'rate_limited_pause',
    )
  })

  it('partitions every status into exactly one of terminal / non-terminal', () => {
    const all = [...TERMINAL_JOB_STATUSES, ...NON_TERMINAL_JOB_STATUSES]
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort()).toEqual(
      ['queued', 'running', 'completed', 'interrupted', 'failed'].sort(),
    )
    expect(isTerminalJobStatus('failed')).toBe(true)
    expect(isTerminalJobStatus('queued')).toBe(false)
  })
})

describe('skip reasons (D14 + Decision G) — user vs system vs duplicate', () => {
  /**
   * This case used to read `expect(all).toHaveLength(6)` against the CONCATENATION
   * of the two lists, which is not the claim its own name makes. It could not
   * observe a reason that appears in `SkipReasonSchema` and in neither list —
   * exactly what happened when `duplicate_title` was added: the test stayed green
   * while its stated claim became false.
   *
   * It now derives from the schema, so a new skip reason that nobody classifies
   * fails here rather than silently landing in whichever bucket an `else` branch
   * happens to own.
   */
  it('partitions SkipReasonSchema exhaustively and pairwise-disjointly into THREE buckets', () => {
    const buckets = {
      user: USER_SKIP_REASONS,
      system: SYSTEM_SKIP_REASONS,
      duplicate: DUPLICATE_SKIP_REASONS,
    }
    const all = [...buckets.user, ...buckets.system, ...buckets.duplicate]

    // Pairwise disjoint: no reason may sit in two buckets.
    expect(new Set(all).size, `a reason is classified twice: ${all.join(', ')}`).toBe(all.length)

    // Exhaustive, in BOTH directions.
    const declared = [...SkipReasonSchema.options].sort()
    expect([...all].sort(), 'SkipReasonSchema and the buckets disagree').toEqual(declared)

    // And the predicates agree with the lists, for every option — so a bucket
    // list that is right while its predicate is wrong still fails.
    for (const reason of SkipReasonSchema.options) {
      const hits = [isUserSkip(reason), isSystemSkip(reason), isDuplicateSkip(reason)].filter(
        Boolean,
      )
      expect(hits, `${reason} is classified by ${hits.length} predicates, not 1`).toHaveLength(1)
    }
  })

  it('puts duplicate_title in NEITHER the user nor the system bucket', () => {
    // The system-skip copy reads "interrupted before we could confirm they
    // copied", which is actively false for a post that was never attempted.
    expect(USER_SKIP_REASONS).not.toContain('duplicate_title')
    expect(SYSTEM_SKIP_REASONS).not.toContain('duplicate_title')
    expect(isDuplicateSkip('duplicate_title')).toBe(true)
  })

  it('never counts server_interrupted as a skip the teacher chose', () => {
    expect(isUserSkip('server_interrupted')).toBe(false)
    expect(isUserSkip('provider_error')).toBe(false)
    expect(isUserSkip('rate_limit_exhausted')).toBe(false)
    expect(isUserSkip('user_skip_post')).toBe(true)
  })

  it('counts a teacher-cancelled drain as the teacher\'s own choice (D14 for cancel)', () => {
    // The teacher clicked Cancel — "Skipped by you" is honest attribution for
    // every item the cancellation drained, not just the Action-Sheet skips.
    expect(isUserSkip('cancelled_by_user')).toBe(true)
    expect(USER_SKIP_REASONS).toContain('cancelled_by_user')
  })
})

describe('cancel — the flag contract', () => {
  it('TransferJobStatus carries cancelRequested and cancelledAt', () => {
    const shape = TransferJobStatusSchema.shape
    expect(shape.cancelRequested).toBeDefined()
    expect(shape.cancelledAt).toBeDefined()
  })

  it('CancelTransferJobResponseSchema accepts the idempotent 200 body', () => {
    const parsed = CancelTransferJobResponseSchema.safeParse({
      jobId: 'job-1',
      cancelRequested: true,
    })
    expect(parsed.success).toBe(true)
  })
})

describe('TransferJobStatus — the reconciliation payload', () => {
  it('carries skippedByUser and skippedBySystem as separate numbers', () => {
    const shape = TransferJobStatusSchema.shape
    expect(shape.skippedByUser).toBeDefined()
    expect(shape.skippedBySystem).toBeDefined()
    expect(shape.skippedTotal).toBeDefined()
  })
})

describe('TypeSpecificFields — per type, never one generic post shape', () => {
  it('has no representation in which a Material carries points', () => {
    expect(TypeSpecificFieldsSchema.safeParse({ kind: 'none', maxPoints: 100 }).success).toBe(true)
    // ...but the parsed value strips it: a Material row cannot render points.
    const parsed = TypeSpecificFieldsSchema.parse({ kind: 'none', maxPoints: 100 })
    expect(parsed).toEqual({ kind: 'none' })
    expect('maxPoints' in parsed).toBe(false)
  })

  it('models multiple-choice and short-answer as distinct shapes', () => {
    expect(TypeSpecificFieldsSchema.parse({ kind: 'multipleChoice', optionCount: 4 })).toEqual({
      kind: 'multipleChoice',
      optionCount: 4,
    })
    expect(TypeSpecificFieldsSchema.parse({ kind: 'shortAnswer' })).toEqual({ kind: 'shortAnswer' })
  })
})

describe('notes (D6, Δ2)', () => {
  it('renders the canonical attachment note exactly, in full', () => {
    expect(attachmentFallbackNote('Unit_1_Quiz.pdf')).toBe(
      "[Classroom Copier Note: Original attachment 'Unit_1_Quiz.pdf' could not be linked due to a permission error or deleted file.]",
    )
  })

  it('keeps the rate-limit-exhaustion note DISTINCT from the attachment note', () => {
    expect(rateLimitExhaustionNote(5)).not.toBe(attachmentFallbackNote('anything'))
    expect(rateLimitExhaustionNote(5)).not.toContain('could not be linked due to a permission error')
  })

  it('keeps the rubric note distinct from both fallback notes', () => {
    expect(rubricDegradedNote()).not.toBe(attachmentFallbackNote('x'))
    expect(rubricDegradedNote()).not.toBe(rateLimitExhaustionNote(5))
  })

  it('the cancel note is honest, plainspoken, and distinct from every other note', () => {
    expect(cancelledByUserNote()).toBe('Cancelled by you before this post was attempted.')
    expect(cancelledByUserNote()).not.toBe(attachmentFallbackNote('x'))
    expect(cancelledByUserNote()).not.toBe(rateLimitExhaustionNote(5))
    expect(cancelledByUserNote()).not.toBe(rubricDegradedNote())
  })
})
