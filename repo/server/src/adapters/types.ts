/**
 * classroom-provider-interface — payload and error types (D10, D18).
 *
 * Everything carrying real-API fidelity used to live inside the undefined word
 * `payload`. A payload type that is not declared is a payload type the mock
 * defines by whatever it finds convenient — which is precisely the failure mode
 * the swappable-boundary driver exists to prevent. In particular the brief's
 * binding requirement "preserve each attachment's shareMode … never default to
 * VIEW" had a column in the schema and nowhere in the interface to travel.
 *
 * Pure types. No runtime code in this module.
 */
import type {
  CourseState,
  CourseWorkState,
  ShareMode,
  SourceType,
  WorkType,
} from '@classroom-copier/shared'

export type { CourseState, CourseWorkState, ShareMode, SourceType, WorkType }

/* ------------------------------------------------------------------ *
 * Attachment materials — the four-way union
 * ------------------------------------------------------------------ */

/**
 * `shareMode` is REQUIRED on driveFile and STRUCTURALLY ABSENT on the other
 * three kinds. That is what gives "never default shareMode to VIEW" a carrier:
 * a driveFile material cannot be constructed without an explicit value, so
 * defaulting it is not something a caller can do by omission.
 *
 * (Real Classroom accepts shareMode only on driveFile. The mock's `Attachment`
 * table carries the column uniformly, which is a small mock-shaped divergence
 * noted in the schema — the *interface* is shaped to the real API.)
 */
export type Material =
  | { kind: 'driveFile'; driveFileId: string; title: string; shareMode: ShareMode }
  | { kind: 'youTubeVideo'; videoId: string; title: string }
  | { kind: 'link'; url: string; title: string }
  | { kind: 'form'; formUrl: string; title: string }

export type MaterialKind = Material['kind']

export type AnswerConfig =
  | { type: 'multipleChoice'; choices: string[] }
  | { type: 'shortAnswer' }

/* ------------------------------------------------------------------ *
 * Create payloads
 * ------------------------------------------------------------------ */

/**
 * Note the two fields that are ABSENT rather than nulled: `dueDate` and
 * `scheduledTime` cannot be set through this interface at all, which is how
 * "everything lands as a Draft with dates cleared" stops being a convention a
 * future contributor can violate silently.
 */
export interface CourseWorkPayload {
  title: string
  description?: string | null
  workType: WorkType
  /** Literal — nothing this tool creates is ever visible to students. */
  state: 'DRAFT'
  topicId?: string | null
  maxPoints?: number | null
  answerConfig?: AnswerConfig | null
  quizFormLink?: string | null
  /** At most 20. Overflow is appended to `description` as URL links. */
  materials: Material[]
  assigneeMode: 'ALL_STUDENTS'
}

export interface CourseWorkMaterialPayload {
  title: string
  description?: string | null
  state: 'DRAFT'
  topicId?: string | null
  materials: Material[]
  /* no maxPoints, no dueDate, no answerConfig — the fields do not exist */
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export interface AttachmentRef {
  id: string
  parentType: SourceType
  parentId: string
}

export type HealthState = 'healthy' | 'trashed' | 'deleted' | 'permission_locked'

export interface ProviderAttachment {
  id: string
  parentType: SourceType
  parentId: string
  kind: MaterialKind
  title: string
  driveFileId: string | null
  url: string | null
  shareMode: ShareMode | null
  sortOrder: number
  ownerAccountId: string | null
}

export interface ProviderCourse {
  id: string
  name: string
  section: string | null
  state: CourseState
  isSisShell: boolean
  ownerAccountId: string
}

export interface ProviderTopic {
  id: string
  name: string
  sortOrder: number
}

export interface ProviderCourseWork {
  id: string
  courseId: string
  title: string
  description: string | null
  workType: WorkType
  state: CourseWorkState
  /** Non-null exactly when this DRAFT is scheduled for future publication —
   *  Google's representation of "scheduled", there being no such state. */
  scheduledTime: Date | null
  maxPoints: number | null
  answerConfig: AnswerConfig | null
  quizFormLink: string | null
  topicId: string | null
  /**
   * APPLY-J — `creationTime` is the ordering key the port promises. The mock
   * tables' `createdOrder` column is a per-table seed ordinal and is
   * deliberately NOT carried here: it is not comparable across the two
   * surfaces, so it could never have been the tiebreak the schema comment
   * claimed. `post-enumerator` orders on (creationTime, sourceType, sourceId).
   */
  creationTime: Date
  attachments: ProviderAttachment[]
  hasRubric: boolean
}

export interface ProviderCourseWorkMaterial {
  id: string
  courseId: string
  title: string
  description: string | null
  state: CourseWorkState
  topicId: string | null
  creationTime: Date
  attachments: ProviderAttachment[]
}

/* ------------------------------------------------------------------ *
 * Rubrics (D23) — get-then-create, matching the real API's actual shape
 * ------------------------------------------------------------------ */

export interface RubricLevel {
  title: string
  description: string | null
  points: number
  sortOrder: number
}

export interface RubricCriterion {
  title: string
  description: string | null
  sortOrder: number
  levels: RubricLevel[]
}

/** Criteria and levels are copied verbatim — a rubric that arrives flattened is
 *  a fidelity loss the summary would not report. */
export interface RubricBody {
  criteria: RubricCriterion[]
}

/* ------------------------------------------------------------------ *
 * Pagination
 * ------------------------------------------------------------------ */

export interface PageRequest {
  pageToken?: string | null
  pageSize?: number
}

export interface Page<T> {
  items: T[]
  nextPageToken: string | null
}

export interface ListCoursesRequest extends PageRequest {
  /** D19/E — `courses-api` must scope source (ACTIVE+ARCHIVED) and target
   *  (ACTIVE) differently; filtering after the fact against fields the port
   *  does not promise is not a contract. */
  courseStates?: CourseState[]
}

export interface ListCourseWorkRequest extends PageRequest {
  /**
   * D19/D — the most dangerous adapter finding. Real
   * `courses.courseWork.list` returns PUBLISHED only unless this is passed
   * explicitly. F8 mandates Draft, Published and Scheduled source posts, so an
   * adapter without this filter silently drops two-thirds of them — and every
   * mock test would still pass, because the mock reads from SQLite and would
   * happily return everything. The mock is therefore held to the real default.
   *
   * APPLY-D, resolved: `SCHEDULED` was a mock-invented member of this
   * vocabulary and has been removed. Google's enum is `PUBLISHED | DRAFT`
   * (plus `DELETED`, deliberately unmodelled in v1 — no fixture exercises it).
   * A scheduled post is a DRAFT carrying `scheduledTime`, stored once, and the
   * contract test asserts that representation as fidelity.
   */
  courseWorkStates?: CourseWorkState[]
}

/**
 * APPLY-D — a SEPARATE request type for the second surface. `courseWorkMaterials
 * .list` is a different real endpoint with a differently-named state parameter;
 * one shared `ListCourseWorkRequest` was asserting a single vocabulary for two
 * endpoints, which is precisely the kind of mock-shaped convenience the port
 * exists to prevent.
 */
export interface ListCourseWorkMaterialsRequest extends PageRequest {
  courseWorkMaterialStates?: CourseWorkState[]
}

/* ------------------------------------------------------------------ *
 * Error taxonomy (D10) — every one of these has a declared terminal
 * outcome path in transfer-engine (D12). A declared error class with no
 * declared outcome is how an item gets stuck in `pending` forever.
 * ------------------------------------------------------------------ */

export class ProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class RateLimitError extends ProviderError {
  readonly retryAfterMs: number | undefined
  constructor(message = 'Rate limited', retryAfterMs?: number) {
    super(message)
    this.retryAfterMs = retryAfterMs
  }
}

export class PermissionError extends ProviderError {}

/**
 * The CREDENTIAL itself was rejected — Google answered 401 / `invalid_grant`,
 * or the stored token no longer decrypts (a rotated or corrupted
 * TOKEN_ENCRYPTION_KEY). Deliberately distinct from `PermissionError`, which
 * means "this account may not touch THIS resource": the fix for that is a
 * different resource, and the fix for this one is always the same — the teacher
 * signs in again.
 *
 * `transfer-engine` routes it to pause-for-reauth rather than to a per-item
 * failure, so an expired token costs a reconnect, not a half-finished transfer.
 * `MockClassroomProvider` never throws it (a mock has no real token to expire);
 * its handling is exercised by direct injection, the same way
 * PermissionError/NotFoundError already are.
 */
export class AuthExpiredError extends ProviderError {
  constructor(message = 'Your Google connection expired. Sign in again to continue.') {
    super(message)
  }
}
export class NotFoundError extends ProviderError {}
export class LicenseBlockedError extends ProviderError {}

export function isRateLimitError(e: unknown): e is RateLimitError {
  return e instanceof RateLimitError
}
