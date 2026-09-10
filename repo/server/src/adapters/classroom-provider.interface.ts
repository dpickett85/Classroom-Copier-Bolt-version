/**
 * The `ClassroomProvider` port — types only, no runtime code.
 *
 * Because this module emits no JavaScript, no downstream module can
 * accidentally import a concrete provider through it; `composition-root` is the
 * only place a concrete implementation is named. Both `MockClassroomProvider`
 * (v1) and a future `RealClassroomProvider` implement this exact shape, and the
 * same contract-test suite runs against either.
 *
 * The method set is deliberately shaped to Classroom's REAL surface rather than
 * to the mock's convenience: separate courseWork / courseWorkMaterials calls,
 * explicit state filters, pagination from day one, a discrete
 * copy-to-my-drive for the `drive.file` scope, batched attachment health, and
 * get-then-create rubrics.
 */
import type {
  AttachmentRef,
  CourseWorkMaterialPayload,
  CourseWorkPayload,
  HealthState,
  ListCourseWorkMaterialsRequest,
  ListCourseWorkRequest,
  ListCoursesRequest,
  Page,
  PageRequest,
  ProviderCourse,
  ProviderCourseWork,
  ProviderCourseWorkMaterial,
  ProviderTopic,
  RubricBody,
} from './types.js'

export interface ClassroomProvider {
  /**
   * OPTIONAL — establishes the acting account for the duration of `fn`.
   *
   * Account-agnostic adapters (the mock reads a shared database) omit it; an
   * adapter whose every call carries ONE account's credentials implements it,
   * because the rest of this port is deliberately account-less and gives it
   * nowhere else to learn who is acting. Callers never branch on its presence —
   * they go through `runForAccount()` in `acting-account.ts`, which is a
   * pass-through for adapters that do not need it.
   */
  runForAccount?<T>(accountId: string, fn: () => Promise<T>): Promise<T>

  listCourses(accountId: string, req?: ListCoursesRequest): Promise<Page<ProviderCourse>>

  /**
   * APPLY-B — added so `preflight-engine` can name the source and target
   * courses through the PORT. It used to reach around the type-only seam into
   * `prisma.mockCourse`, which is a table that disappears the day a real
   * adapter ships.
   */
  getCourse(courseId: string): Promise<ProviderCourse | null>

  /**
   * APPLY-K — the selection screen needs a COUNT, not a corpus. `GET /courses`
   * used to run a full two-surface paginated enumeration (plus an attachment
   * query and a rubric query) for EVERY course the teacher owns, on the first
   * authenticated call, only to render `postCount`.
   */
  countPosts(courseId: string): Promise<number>

  listTopics(courseId: string, req?: PageRequest): Promise<Page<ProviderTopic>>
  createTopic(courseId: string, name: string): Promise<{ topicId: string }>

  listCourseWork(courseId: string, req?: ListCourseWorkRequest): Promise<Page<ProviderCourseWork>>
  /** APPLY-D — its own request type; a different real endpoint with a
   *  differently-named state parameter. */
  listCourseWorkMaterials(
    courseId: string,
    req?: ListCourseWorkMaterialsRequest,
  ): Promise<Page<ProviderCourseWorkMaterial>>

  /** Throws RateLimitError | PermissionError | NotFoundError. */
  createCourseWork(courseId: string, payload: CourseWorkPayload): Promise<{ id: string }>
  /** Throws RateLimitError | PermissionError | NotFoundError. */
  createCourseWorkMaterial(
    courseId: string,
    payload: CourseWorkMaterialPayload,
  ): Promise<{ id: string }>

  /**
   * Mirrors `courses.courseWork.patch` with `updateMask=description` — a real
   * API method, not a mock convenience. The engine needs it because the rubric
   * licence denial arrives on `createRubric`, i.e. AFTER the post exists, and
   * the brief mandates graceful degradation to a note *in the description*.
   * Without it the note could only live in the summary ledger, which is a
   * quieter place than the brief specifies.
   */
  updateCourseWorkDescription(courseWorkId: string, description: string): Promise<void>
  updateCourseWorkMaterialDescription(materialId: string, description: string): Promise<void>

  /**
   * Batch-shaped from day one (D20), for exactly the reason the list methods
   * are pagination-shaped: per-attachment calls on a 50-post course means
   * hundreds of sequential round-trips against real Drive — and a 429 storm
   * *during pre-flight*, on a path with no backoff specified at all.
   */
  getAttachmentHealth(refs: AttachmentRef[]): Promise<Map<string, HealthState>>

  copyAttachmentToMyDrive(
    ref: AttachmentRef,
    actingAccountId: string,
  ): Promise<{ newDriveFileId: string }>

  /** D23 — real Classroom has no server-side rubric copy. It is get-then-create,
   *  two calls with two failure surfaces, the licence denial arriving on the
   *  create. A single boolean-returning `copyRubric` could not decompose into
   *  that without the signature change driver 1 exists to prevent. */
  getRubric(courseWorkId: string): Promise<RubricBody | null>
  /** May throw a provider error when Google refuses rubric creation for licensing, permissions, or OAuth-client reasons. */
  createRubric(targetCourseWorkId: string, rubric: RubricBody): Promise<{ id: string }>

  /**
   * Creates a Google Sheet in the teacher's Drive, formatted for Classroom's
   * "Import from Sheets" rubric feature. Used as a fallback when `createRubric`
   * is blocked by the Workspace tier.
   */
  createRubricSheet(rubric: RubricBody, assignmentTitle: string): Promise<{ sheetUrl: string }>
}
