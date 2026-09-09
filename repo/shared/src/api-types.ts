/**
 * shared-contracts (D17) — the SINGLE declaration of every client<->server DTO.
 *
 * Each payload is declared exactly once, as a zod schema, and exported as both
 * a runtime validator and an inferred TypeScript type. The client imports these
 * types; it never redeclares a payload shape. Before this module existed, four
 * cross-tier edges were typed twice and drift between what the server returned
 * and what the client expected was invisible to the compiler — which
 * contradicted the architecture's own governing principle that the
 * reconciliation arithmetic has exactly one implementation in the system while
 * permitting the *type* of the payload carrying it to have two.
 */
import { z } from 'zod'

/* ------------------------------------------------------------------ *
 * Enumerations shared by both tiers
 * ------------------------------------------------------------------ */

/** Which of the two structurally-separate coursework tables a post lives in. */
export const SourceTypeSchema = z.enum(['courseWork', 'courseWorkMaterial'])
export type SourceType = z.infer<typeof SourceTypeSchema>

export const WorkTypeSchema = z.enum([
  'ASSIGNMENT',
  'QUIZ_ASSIGNMENT',
  'SHORT_ANSWER_QUESTION',
  'MULTIPLE_CHOICE_QUESTION',
])
export type WorkType = z.infer<typeof WorkTypeSchema>

export const CourseStateSchema = z.enum(['ACTIVE', 'ARCHIVED'])
export type CourseState = z.infer<typeof CourseStateSchema>

// Google's real courseWorkStates vocabulary. A scheduled post is NOT its own
// state — it is a DRAFT carrying `scheduledTime` (APPLY-D, resolved). Google
// also defines DELETED, which v1 deliberately does not model: nothing requests
// deleted posts and no fixture exercises them, and an enum member with nothing
// underneath it is this project's recurring defect class.
export const CourseWorkStateSchema = z.enum(['DRAFT', 'PUBLISHED'])
export type CourseWorkState = z.infer<typeof CourseWorkStateSchema>

export const ShareModeSchema = z.enum(['VIEW', 'EDIT', 'STUDENT_COPY'])
export type ShareMode = z.infer<typeof ShareModeSchema>

/**
 * The single-valued, NOT-NULL outcome enum. There is no representable state in
 * which an item lands in two buckets. `pending` IS a fourth representable
 * state — the schema does not forbid fall-through, which is why the totality
 * obligations (D12) exist in `transfer-engine` with their own acceptance gates.
 */
export const OutcomeSchema = z.enum(['pending', 'transferred', 'fallback_shell', 'skipped'])
export type Outcome = z.infer<typeof OutcomeSchema>

/** Closed skip vocabulary. Exactly three of these are the teacher's choice. */
export const SkipReasonSchema = z.enum([
  'user_skip_post',
  'user_skip_attachment',
  'cancelled_by_user',
  'provider_error',
  'server_interrupted',
  'rate_limit_exhausted',
  /**
   * Decision G — a post whose title already exists on the destination.
   *
   * It is NEITHER a user skip nor a system skip, and it gets its own bucket
   * (`skippedDuplicate`) for a concrete copy reason: the system-skip line reads
   * "N posts were interrupted before we could confirm they copied", which is
   * actively false for a duplicate that was never attempted.
   */
  'duplicate_title',
])
export type SkipReason = z.infer<typeof SkipReasonSchema>

/** `cancelled_by_user` — the teacher clicked Cancel, so every item the
 *  cancellation drains is honestly "Skipped by you", the same as an
 *  Action-Sheet skip. */
export const USER_SKIP_REASONS: readonly SkipReason[] = [
  'user_skip_post',
  'user_skip_attachment',
  'cancelled_by_user',
]
export const SYSTEM_SKIP_REASONS: readonly SkipReason[] = [
  'provider_error',
  'server_interrupted',
  'rate_limit_exhausted',
]
/**
 * The third bucket. It has exactly one member today, and it is a named constant
 * rather than an inline comparison so that the three-way partition is one
 * declaration the exhaustiveness test can check against `SkipReasonSchema`.
 */
export const DUPLICATE_SKIP_REASONS: readonly SkipReason[] = ['duplicate_title']

export function isSystemSkip(reason: SkipReason | null | undefined): boolean {
  return reason != null && SYSTEM_SKIP_REASONS.includes(reason)
}
export function isDuplicateSkip(reason: SkipReason | null | undefined): boolean {
  return reason != null && DUPLICATE_SKIP_REASONS.includes(reason)
}
export function isUserSkip(reason: SkipReason | null | undefined): boolean {
  return reason != null && USER_SKIP_REASONS.includes(reason)
}

/**
 * Job lifecycle. `rate_limited_pause` is deliberately NOT here — a rate-limit
 * pause is a nullable field on the job, not a status (D5), so the non-terminal
 * predicate that the partial unique index and `/active` both derive from is a
 * single definition rather than two that disagree.
 */
export const JobStatusSchema = z.enum(['queued', 'running', 'completed', 'interrupted', 'failed'])
export type JobStatus = z.infer<typeof JobStatusSchema>

/** The one definition of "terminal". Everything else derives from it (D5). */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['completed', 'interrupted', 'failed']
export const NON_TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['queued', 'running']
export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status)
}

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

export const AccountSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
  initials: z.string(),
  /** Google's profile photo. Absent for mock accounts, which render initials. */
  pictureUrl: z.string().nullish(),
})
export type AccountSummary = z.infer<typeof AccountSummarySchema>

export const MockAccountsResponseSchema = z.object({ accounts: z.array(AccountSummarySchema) })
export type MockAccountsResponse = z.infer<typeof MockAccountsResponseSchema>

export const SignInRequestSchema = z.object({ accountId: z.string().min(1) })
export type SignInRequest = z.infer<typeof SignInRequestSchema>

export const SessionResponseSchema = z.object({ account: AccountSummarySchema })
export type SessionResponse = z.infer<typeof SessionResponseSchema>

/**
 * `GET /api/auth/google/url` — the authorization URL to send the browser to.
 *
 * The URL is BUILT SERVER-SIDE and handed over ready-made, rather than
 * assembled in the client from a client id: the PKCE verifier and the state
 * nonce are minted in the same request and stored in an httpOnly cookie, so the
 * two halves of the flow cannot drift apart, and no client secret or PKCE
 * verifier ever exists in the public bundle.
 */
export const GoogleAuthUrlResponseSchema = z.object({ url: z.string().min(1) })
export type GoogleAuthUrlResponse = z.infer<typeof GoogleAuthUrlResponseSchema>

/**
 * The three sign-in failure states (UX 1e/1f/1g), as the closed vocabulary the
 * server puts in `?authError=` and the client renders copy for. A closed set,
 * not a free string, so an unrecognised value degrades to the generic case
 * rather than rendering a server-supplied string into the page.
 */
export const AuthErrorSchema = z.enum(['denied', 'expired', 'generic'])
export type AuthError = z.infer<typeof AuthErrorSchema>

/* ------------------------------------------------------------------ *
 * Courses
 * ------------------------------------------------------------------ */

export const CourseRoleSchema = z.enum(['source', 'target'])
export type CourseRole = z.infer<typeof CourseRoleSchema>

export const CourseSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  section: z.string().nullable(),
  state: CourseStateSchema,
  isSisShell: z.boolean(),
  postCount: z.number().int().nonnegative(),
})
export type CourseSummary = z.infer<typeof CourseSummarySchema>

export const CourseListResponseSchema = z.object({ courses: z.array(CourseSummarySchema) })
export type CourseListResponse = z.infer<typeof CourseListResponseSchema>

/* ------------------------------------------------------------------ *
 * Pre-flight  (D11 — the scan is persisted and carries an id)
 * ------------------------------------------------------------------ */

export const AttachmentIssueSchema = z.enum(['trashed', 'deleted', 'permission_locked'])
export type AttachmentIssue = z.infer<typeof AttachmentIssueSchema>

/**
 * The five Action-Sheet options, as a closed set. `transfer-engine` maps each
 * to exactly one outcome bucket (D15) — the mapping is code, not inference.
 */
export const ResolutionKindSchema = z.enum([
  'create_draft_shell_with_note', // Scenario 2 (recommended) -> fallback_shell
  'skip_post', // Scenario 2               -> skipped / user_skip_post
  'copy_to_my_drive', // Scenario 3 (recommended) -> transferred
  'link_existing_file', // Scenario 3               -> transferred
  'skip_attachment_and_note_draft', // Scenario 3   -> fallback_shell
])
export type ResolutionKind = z.infer<typeof ResolutionKindSchema>

export const PreflightOptionSchema = z.object({
  kind: ResolutionKindSchema,
  /** Type-aware: "Skip Material", never a hardcoded "Skip Assignment". */
  label: z.string(),
  recommended: z.boolean(),
  /** Rendered under "Link Existing File (Risk Warning)". */
  riskWarning: z.string().nullable(),
})
export type PreflightOption = z.infer<typeof PreflightOptionSchema>

export const PreflightFindingSchema = z.object({
  id: z.string(),
  scanItemId: z.string(),
  sourceType: SourceTypeSchema,
  sourceId: z.string(),
  postTitle: z.string(),
  /** "Material" / "Assignment" / "Quiz assignment" / "Question". */
  postTypeLabel: z.string(),
  attachmentId: z.string(),
  attachmentName: z.string(),
  issue: AttachmentIssueSchema,
  scenario: z.union([z.literal(2), z.literal(3)]),
  options: z.array(PreflightOptionSchema).min(2),
})
export type PreflightFinding = z.infer<typeof PreflightFindingSchema>

/** A source post whose title already exists on the destination (Decision C). */
export const DuplicateDisclosureSchema = z.object({
  scanItemId: z.string(),
  sourceType: SourceTypeSchema,
  sourceId: z.string(),
  postTitle: z.string(),
  postTypeLabel: z.string(),
  /** The destination post's title as it actually reads there, un-normalized. */
  matchedTitle: z.string(),
  /** So the UI can say "already there as a draft" rather than just "already there". */
  matchedState: CourseWorkStateSchema,
})
export type DuplicateDisclosure = z.infer<typeof DuplicateDisclosureSchema>

/** A source topic that already exists on the destination and will be reused. */
export const TopicReuseDisclosureSchema = z.object({
  sourceTopicId: z.string(),
  sourceTopicName: z.string(),
  destinationTopicId: z.string(),
  destinationTopicName: z.string(),
  /**
   * More than one destination topic normalized to the same name. The first by
   * API return order is reused; this flag is what lets the UI say so instead of
   * silently picking one.
   */
  ambiguous: z.boolean(),
})
export type TopicReuseDisclosure = z.infer<typeof TopicReuseDisclosureSchema>

export const PreflightRequestSchema = z.object({ targetId: z.string().min(1) })
export type PreflightRequest = z.infer<typeof PreflightRequestSchema>

export const PreflightResponseSchema = z.object({
  scanId: z.string(),
  sourceCourseId: z.string(),
  targetCourseId: z.string(),
  sourceCourseName: z.string(),
  targetCourseName: z.string(),
  /**
   * count(PreflightScanItem) for this scan — written once, at scan time.
   * `POST /transfer-jobs` inserts its items FROM those same stored rows, which
   * is what makes `count(items) == totalPostsScanned` one measurement read
   * twice rather than two measurements hoped to agree (D11).
   */
  totalPostsScanned: z.number().int().nonnegative(),
  /**
   * APPLY-I — when the count was measured. The scan is a SNAPSHOT: a post added
   * to the source afterwards is correctly excluded from the job, and the
   * Completion Summary then reads "N of N" about an N measured earlier. In a
   * product whose thesis is that it never lies about what happened, the silence
   * was the gap. Ready-to-Transfer renders this, and `POST /transfer-jobs`
   * refuses a scan older than the TTL rather than transferring a stale picture.
   */
  scannedAt: z.string(),
  findings: z.array(PreflightFindingSchema),
  /**
   * Decision G — DISCLOSURE ONLY, deliberately separate from `findings[]`.
   *
   * A finding is something the teacher must decide about; a duplicate is
   * something already decided (it is skipped) and merely reported, so folding it
   * into findings[] would put an un-actionable row in the Action Sheet.
   */
  duplicates: z.array(DuplicateDisclosureSchema),
  topicReuse: z.array(TopicReuseDisclosureSchema),
})
export type PreflightResponse = z.infer<typeof PreflightResponseSchema>

/* ------------------------------------------------------------------ *
 * Transfer jobs
 * ------------------------------------------------------------------ */

/**
 * A resolution is a discriminated union over `kind`, so an unknown option is a
 * runtime rejection rather than a silently-ignored string.
 */
export const ResolutionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create_draft_shell_with_note'), findingId: z.string() }),
  z.object({ kind: z.literal('skip_post'), findingId: z.string() }),
  z.object({ kind: z.literal('copy_to_my_drive'), findingId: z.string() }),
  z.object({ kind: z.literal('link_existing_file'), findingId: z.string() }),
  z.object({ kind: z.literal('skip_attachment_and_note_draft'), findingId: z.string() }),
])
export type Resolution = z.infer<typeof ResolutionSchema>

export const CreateTransferJobRequestSchema = z.object({
  scanId: z.string().min(1),
  resolutions: z.array(ResolutionSchema),
})
export type CreateTransferJobRequest = z.infer<typeof CreateTransferJobRequestSchema>

export const CreateTransferJobResponseSchema = z.object({ jobId: z.string() })
export type CreateTransferJobResponse = z.infer<typeof CreateTransferJobResponseSchema>

export const RateLimitPauseSchema = z.object({
  retryInMs: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  itemTitle: z.string(),
})
export type RateLimitPause = z.infer<typeof RateLimitPauseSchema>

export const CurrentItemSchema = z.object({
  title: z.string(),
  outcome: OutcomeSchema,
  skipReason: SkipReasonSchema.nullable(),
})
export type CurrentItem = z.infer<typeof CurrentItemSchema>

export const TransferJobStatusSchema = z.object({
  jobId: z.string(),
  status: JobStatusSchema,
  sourceCourseName: z.string(),
  targetCourseName: z.string(),
  targetCourseId: z.string(),
  /** count(TransferJobItem) — equal to the scan's totalPostsScanned by construction. */
  totalItems: z.number().int().nonnegative(),
  totalPostsScanned: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  transferred: z.number().int().nonnegative(),
  fallbackShell: z.number().int().nonnegative(),
  /** The third term of the three-term reconciliation sum. */
  skippedTotal: z.number().int().nonnegative(),
  /**
   * Split for LABELLING only (D14) — the sum stays three-term over
   * skippedTotal. The Completion Summary's "Skipped by you" tile binds to
   * skippedByUser alone, so a post the server abandoned is never attributed on
   * screen to a teacher who never chose it.
   */
  skippedByUser: z.number().int().nonnegative(),
  skippedBySystem: z.number().int().nonnegative(),
  /**
   * Decision G — the THIRD bucket, not a subset of the other two.
   *
   * A duplicate folded into `skippedBySystem` fires the completion summary's
   * "N posts were interrupted before we could confirm they copied" line on an
   * ordinary re-run, which is simply false: nothing was interrupted and nothing
   * was attempted. `skippedTotal === skippedByUser + skippedBySystem +
   * skippedDuplicate` holds BY CONSTRUCTION — all four come from one GROUP BY,
   * never from independently incremented counters.
   */
  skippedDuplicate: z.number().int().nonnegative(),
  /** Never a term in the reconciliation sum — a topic is not a post. */
  topicsCreatedOrMapped: z.number().int().nonnegative(),
  /** Decision D — the split behind the tile above. Created in the destination. */
  topicsCreatedCount: z.number().int().nonnegative(),
  /** Filed into a destination topic that already existed. */
  topicsReusedCount: z.number().int().nonnegative(),
  /**
   * Decision F — DERIVED, deliberately not the raw timestamp. The client needs
   * to know whether to show the reconnect banner; the moment the token died is
   * server-side bookkeeping and nothing on screen renders it.
   */
  googleReauthRequired: z.boolean(),
  /** A non-additive subset tag, not a fourth bucket. */
  rubricNotesAdded: z.number().int().nonnegative(),
  currentItem: CurrentItemSchema.nullable(),
  rateLimitPause: RateLimitPauseSchema.nullable(),
  /** The flag the executor reads BETWEEN items — never an external write to
   *  item rows. True from the moment `POST /transfer-jobs/:id/cancel`
   *  succeeds, whether or not the drain has finished yet. */
  cancelRequested: z.boolean(),
  /** Set in the SAME statement as `status: 'completed'` when the job's
   *  remaining items were drained by a cancellation, never a status of its
   *  own (mirrors D5's rate-limit-pause-is-a-field precedent). */
  cancelledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
})
export type TransferJobStatus = z.infer<typeof TransferJobStatusSchema>

export const ActiveJobResponseSchema = z.object({ jobId: z.string() })
export type ActiveJobResponse = z.infer<typeof ActiveJobResponseSchema>

/**
 * `POST /transfer-jobs/:id/cancel` — idempotent while the job is non-terminal.
 * A cancel on an already-finished job is a 409 `job_already_finished`
 * (`ApiErrorSchema`), never this shape.
 */
export const CancelTransferJobResponseSchema = z.object({
  jobId: z.string(),
  cancelRequested: z.literal(true),
})
export type CancelTransferJobResponse = z.infer<typeof CancelTransferJobResponseSchema>

/**
 * Per-type field payload for the itemized log's "Type-specific fields" column.
 * A discriminated union rather than a nullable bag, so no screen can render a
 * single generic "post" shape across all four coursework types: a Material
 * literally has no representation carrying points or an answer config.
 */
export const TypeSpecificFieldsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('graded'), maxPoints: z.number().int().nullable() }),
  z.object({ kind: z.literal('multipleChoice'), optionCount: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('shortAnswer') }),
])
export type TypeSpecificFields = z.infer<typeof TypeSpecificFieldsSchema>

export const TransferJobItemRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceType: SourceTypeSchema,
  workType: WorkTypeSchema.nullable(),
  /** "Material" / "Assignment" / "Quiz assignment" / "Question". */
  typeLabel: z.string(),
  topicName: z.string().nullable(),
  outcome: OutcomeSchema,
  skipReason: SkipReasonSchema.nullable(),
  /** Derived from skipReason; null unless outcome === 'skipped'. */
  skippedBy: z.enum(['user', 'system', 'duplicate']).nullable(),
  typeSpecific: TypeSpecificFieldsSchema,
  /** Rendered in full, never truncated — the fallback note is a product guarantee. */
  note: z.string().nullable(),
  rubricDegraded: z.boolean(),
  attemptCount: z.number().int().nonnegative(),
  /** Evidence that the post the item claims it created actually exists (D14). */
  targetPostId: z.string().nullable(),
})
export type TransferJobItemRow = z.infer<typeof TransferJobItemRowSchema>

export const TransferJobItemsResponseSchema = z.object({
  jobId: z.string(),
  items: z.array(TransferJobItemRowSchema),
})
export type TransferJobItemsResponse = z.infer<typeof TransferJobItemsResponseSchema>

/* ------------------------------------------------------------------ *
 * Health & errors
 * ------------------------------------------------------------------ */

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeMs: z.number().nonnegative(),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Present on 409 from POST /transfer-jobs — the already-running job. */
    jobId: z.string().optional(),
  }),
})
export type ApiError = z.infer<typeof ApiErrorSchema>
