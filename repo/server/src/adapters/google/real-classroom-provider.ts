/**
 * `RealClassroomProvider` — the `ClassroomProvider` port against the real
 * Google Classroom and Drive APIs.
 *
 * It implements the SAME port `MockClassroomProvider` does; the port was shaped
 * to Google's real surface from day one (separate courseWork /
 * courseWorkMaterials calls, explicit state filters, pagination, a discrete
 * copy-to-my-drive, get-then-create rubrics), so this adapter mostly translates
 * rather than reconciles.
 *
 * Three places where reality and the port genuinely disagree, resolved here and
 * documented rather than papered over:
 *
 * 1. **Attachment ids do not exist in Google's API.** Materials are inline on a
 *    post and carry no identifier. `ProviderAttachment.id` is therefore
 *    synthesised as `<parentType>:<parentId>:<index>` and the underlying
 *    material is remembered, so `getAttachmentHealth` and
 *    `copyAttachmentToMyDrive` can resolve a ref that only this adapter minted.
 * 2. **`updateCourseWorkDescription` / `getRubric` take a courseWorkId but no
 *    courseId**, which every real endpoint needs. The adapter remembers which
 *    course each post it listed or created belongs to. Within one run — which is
 *    the only way the engine uses these — the create always precedes the patch,
 *    so the lookup is populated. A cold call raises `NotFoundError` rather than
 *    guessing a course.
 * 3. **The Rubrics API is not in `googleapis@144`'s classroom typings.** It is
 *    called through the authorized client's generic `request()` against the
 *    documented REST path, typed locally, instead of being left unimplemented.
 *
 * §8.0/S6 — a `googleapis` error object carries `config.headers.Authorization`,
 * i.e. the live bearer token. Nothing in this file passes one to a logger, and
 * every error leaves through `mapGoogleError`, which extracts a status and a
 * reason string and discards the rest.
 */
import { google, type classroom_v1, type drive_v3 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { ClassroomProvider } from '../classroom-provider.interface.js'
import {
  AttachmentNotVisibleError,
  AuthExpiredError,
  LicenseBlockedError,
  NotFoundError,
  PermissionError,
  ProviderError,
  RateLimitError,
  TransientError,
  type AnswerConfig,
  type AttachmentRef,
  type CourseWorkMaterialPayload,
  type CourseWorkPayload,
  type CourseWorkState,
  type HealthState,
  type ListCourseWorkMaterialsRequest,
  type ListCourseWorkRequest,
  type ListCoursesRequest,
  type Material,
  type Page,
  type PageRequest,
  type ProviderAttachment,
  type ProviderCourse,
  type ProviderCourseWork,
  type ProviderCourseWorkMaterial,
  type ProviderTopic,
  type RubricBody,
  type ShareMode,
  type SourceType,
  type WorkType,
} from '../types.js'

const RUBRICS_BASE = 'https://classroom.googleapis.com/v1'

export interface GoogleApiClients {
  classroom: classroom_v1.Classroom
  drive: drive_v3.Drive
}

export function clientsFrom(auth: OAuth2Client): GoogleApiClients {
  return {
    classroom: google.classroom({ version: 'v1', auth }),
    drive: google.drive({ version: 'v3', auth }),
  }
}

/* ------------------------------------------------------------------ *
 * Error translation — the ONLY place a googleapis error is inspected
 * ------------------------------------------------------------------ */

interface GaxiosLike {
  code?: number | string
  status?: number
  message?: string
  response?: {
    status?: number
    headers?: Record<string, string | undefined>
    data?: { error?: { status?: string; message?: string; errors?: Array<{ reason?: string }> } }
  }
}

function statusOf(error: GaxiosLike): number | null {
  if (typeof error.status === 'number') return error.status
  if (typeof error.code === 'number') return error.code
  if (typeof error.response?.status === 'number') return error.response.status
  return null
}

/**
 * `invalid_grant` is Google's answer when the CREDENTIAL is dead, and it can
 * arrive as the OAuth error code, as an errors[].reason, or in the message. All
 * three are checked, because getting this wrong routes an expired token to a
 * per-item failure instead of the pause-and-resume path.
 */
function reasonOf(error: GaxiosLike): string {
  const data = error.response?.data?.error
  return [
    typeof error.code === 'string' ? error.code : '',
    data?.status ?? '',
    ...(data?.errors ?? []).map((e) => e.reason ?? ''),
    data?.message ?? '',
    error.message ?? '',
  ]
    .join(' ')
    .toLowerCase()
}

/** Seconds, or an HTTP-date. Both are legal; both appear in practice. */
function retryAfterMs(error: GaxiosLike): number | undefined {
  const raw = error.response?.headers?.['retry-after'] ?? error.response?.headers?.['Retry-After']
  if (!raw) return undefined
  const seconds = Number.parseInt(raw, 10)
  if (Number.isFinite(seconds) && String(seconds) === raw.trim()) return seconds * 1000
  const at = Date.parse(raw)
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now())
}

export function mapGoogleError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error
  const gaxios = (error ?? {}) as GaxiosLike
  const status = statusOf(gaxios)
  const reason = reasonOf(gaxios)

  if (status === 401 || reason.includes('invalid_grant') || reason.includes('unauthenticated')) {
    return new AuthExpiredError()
  }
  if (status === 429 || reason.includes('ratelimitexceeded') || reason.includes('resource_exhausted')) {
    return new RateLimitError('Google is rate limiting this account.', retryAfterMs(gaxios))
  }
  if (status === 403) {
    // A licence/tier denial and an access denial share a status code; the reason
    // string is the only thing that separates them, and they have genuinely
    // different outcomes (a licence denial degrades to a note, an access denial
    // fails the item).
    if (reason.includes('license') || reason.includes('licence')) {
      return new LicenseBlockedError('This course’s Google Workspace tier does not allow rubrics.')
    }
    return new PermissionError('Google refused access to this resource.')
  }
  if (status === 404) return new NotFoundError('Google could not find this resource.')
  if (reason.includes('attachmentnotvisible')) {
    return new AttachmentNotVisibleError('One or more attachments are not visible to this Google account.')
  }
  if (status === 502 || status === 503 || status === 504 || reason.includes('unavailable')) {
    return new TransientError('Google is temporarily unavailable.', retryAfterMs(gaxios))
  }
  const detail = [
    status != null ? `HTTP ${status}` : null,
    gaxios.response?.data?.error?.status ?? null,
    gaxios.response?.data?.error?.message ?? null,
  ]
    .filter((part): part is string => part != null && part.length > 0)
    .join(': ')
  return new ProviderError(detail ? `Google rejected the request (${detail}).` : 'Google returned an unexpected error.')
}

/** Wraps every outbound call. Nothing else in this file touches a raw error. */
async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw mapGoogleError(error)
  }
}

/* ------------------------------------------------------------------ *
 * Payload translation
 * ------------------------------------------------------------------ */

function toMaterial(material: classroom_v1.Schema$Material): Material | null {
  if (material.driveFile?.driveFile) {
    return {
      kind: 'driveFile',
      driveFileId: material.driveFile.driveFile.id ?? '',
      title: material.driveFile.driveFile.title ?? 'Drive file',
      // Never defaulted to VIEW — the brief's binding requirement. Google omits
      // the field only when it genuinely is VIEW, so the fallback is a read of
      // Google's own default, not this app choosing one.
      shareMode: (material.driveFile.shareMode as ShareMode | null | undefined) ?? 'VIEW',
    }
  }
  if (material.youtubeVideo) {
    return {
      kind: 'youTubeVideo',
      videoId: material.youtubeVideo.id ?? '',
      title: material.youtubeVideo.title ?? 'YouTube video',
    }
  }
  if (material.form) {
    return {
      kind: 'form',
      formUrl: material.form.formUrl ?? '',
      title: material.form.title ?? 'Google Form',
    }
  }
  if (material.link) {
    return { kind: 'link', url: material.link.url ?? '', title: material.link.title ?? 'Link' }
  }
  // An unrecognised material kind is DROPPED rather than coerced into a link
  // with an empty url, which would look like a successful copy of nothing.
  return null
}

function fromMaterial(material: Material): classroom_v1.Schema$Material {
  switch (material.kind) {
    case 'driveFile':
      return {
        driveFile: {
          driveFile: { id: material.driveFileId, title: material.title },
          shareMode: material.shareMode,
        },
      }
    case 'youTubeVideo':
      return { youtubeVideo: { id: material.videoId, title: material.title } }
    case 'form':
      return { form: { formUrl: material.formUrl, title: material.title } }
    case 'link':
      return { link: { url: material.url, title: material.title } }
  }
}

/**
 * Google's `workType` vocabulary is wider than this port's. The carried backlog
 * note resolves the divergence for the one member that matters: Google's
 * `QUIZ_ASSIGNMENT` is an `ASSIGNMENT` whose materials include a Google Form,
 * and it is READ as `ASSIGNMENT` + a detected `quizFormLink` so it round-trips
 * as an assignment carrying its form. (The port declares `QUIZ_ASSIGNMENT`
 * because v1's mock minted it; nothing in this adapter produces it, so the
 * create path never has to reconstruct a Form the app cannot create.)
 */
function toWorkType(raw: string | null | undefined): WorkType {
  switch (raw) {
    case 'QUIZ_ASSIGNMENT':
      return 'QUIZ_ASSIGNMENT'
    case 'SHORT_ANSWER_QUESTION':
      return 'SHORT_ANSWER_QUESTION'
    case 'MULTIPLE_CHOICE_QUESTION':
      return 'MULTIPLE_CHOICE_QUESTION'
    default:
      return 'ASSIGNMENT'
  }
}

function toAnswerConfig(work: classroom_v1.Schema$CourseWork): AnswerConfig | null {
  if (work.multipleChoiceQuestion) {
    return { type: 'multipleChoice', choices: work.multipleChoiceQuestion.choices ?? [] }
  }
  if (work.workType === 'SHORT_ANSWER_QUESTION') return { type: 'shortAnswer' }
  return null
}

function quizFormLinkOf(work: classroom_v1.Schema$CourseWork): string | null {
  const form = (work.materials ?? []).find((m) => m.form?.formUrl)
  return form?.form?.formUrl ?? null
}

function attachmentsOf(
  materials: classroom_v1.Schema$Material[] | null | undefined,
  parentType: SourceType,
  parentId: string,
  ownerAccountId: string,
): ProviderAttachment[] {
  const out: ProviderAttachment[] = []
  ;(materials ?? []).forEach((raw, index) => {
    const material = toMaterial(raw)
    if (!material) return
    out.push({
      // Synthesised — see the file header. Stable for a given post and ordering,
      // which is all `getAttachmentHealth`'s batch keying needs.
      id: `${parentType}:${parentId}:${index}`,
      parentType,
      parentId,
      kind: material.kind,
      title: material.title,
      driveFileId: material.kind === 'driveFile' ? material.driveFileId : null,
      url: material.kind === 'link'
        ? material.url
        : material.kind === 'form'
          ? material.formUrl
          : material.kind === 'youTubeVideo'
            ? `https://www.youtube.com/watch?v=${material.videoId}`
            : null,
      shareMode: material.kind === 'driveFile' ? material.shareMode : null,
      sortOrder: index,
      ownerAccountId,
    })
  })
  return out
}

function toDate(raw: string | null | undefined): Date {
  const parsed = raw ? Date.parse(raw) : Number.NaN
  return Number.isNaN(parsed) ? new Date(0) : new Date(parsed)
}

/* ------------------------------------------------------------------ *
 * The adapter
 * ------------------------------------------------------------------ */

export class RealClassroomProvider implements ClassroomProvider {
  /** courseWorkId | materialId -> courseId. See the file header, note 2. */
  private readonly courseOf = new Map<string, string>()
  /** Synthesised attachment id -> the drive file it names. Note 1. */
  private readonly driveFileOf = new Map<string, string>()

  /**
   * Bound to ONE account, because every real call carries that account's token.
   * The mock is account-agnostic (it reads a shared database); the real adapter
   * cannot be, so the composition root builds one of these per acting account.
   */
  constructor(
    private readonly accountId: string,
    private readonly clients: GoogleApiClients,
  ) {}

  async listCourses(accountId: string, req: ListCoursesRequest = {}): Promise<Page<ProviderCourse>> {
    const res = await call(() =>
      this.clients.classroom.courses.list({
        teacherId: 'me',
        courseStates: req.courseStates ?? ['ACTIVE'],
        pageSize: req.pageSize,
        pageToken: req.pageToken ?? undefined,
      }),
    )
    return {
      items: (res.data.courses ?? []).map((course) => this.toCourse(course, accountId)),
      nextPageToken: res.data.nextPageToken ?? null,
    }
  }

  async getCourse(courseId: string): Promise<ProviderCourse | null> {
    try {
      const res = await call(() => this.clients.classroom.courses.get({ id: courseId }))
      return this.toCourse(res.data, this.accountId)
    } catch (error) {
      // `getCourse` promises null for absent, not a throw — the port's callers
      // branch on null and would otherwise see a 404 become a 500.
      if (error instanceof NotFoundError) return null
      throw error
    }
  }

  private toCourse(course: classroom_v1.Schema$Course, ownerAccountId: string): ProviderCourse {
    return {
      id: course.id ?? '',
      name: course.name ?? 'Untitled course',
      section: course.section ?? null,
      state: (course.courseState as ProviderCourse['state'] | null) ?? 'ACTIVE',
      // A SIS-provisioned shell is one this teacher cannot write classwork into.
      // Google reports that as the absence of the create permission rather than
      // as a flag, so it is read from there rather than guessed from the name.
      isSisShell: (course.courseMaterialSets?.length ?? 0) === 0 && course.courseState === 'PROVISIONED',
      ownerAccountId,
    }
  }

  async countPosts(courseId: string): Promise<number> {
    // A count, not a corpus (APPLY-K). Google has no count endpoint, so this is
    // a page-token walk that reads ids only — still far cheaper than the full
    // two-surface enumeration with attachments and rubrics it replaced.
    let total = 0
    for (const surface of ['courseWork', 'courseWorkMaterials'] as const) {
      let pageToken: string | undefined
      do {
        if (surface === 'courseWork') {
          const res = await call(() =>
            this.clients.classroom.courses.courseWork.list({
              courseId,
              courseWorkStates: ['PUBLISHED', 'DRAFT'],
              fields: 'courseWork(id),nextPageToken',
              pageToken,
            }),
          )
          total += (res.data.courseWork ?? []).length
          pageToken = res.data.nextPageToken ?? undefined
        } else {
          const res = await call(() =>
            this.clients.classroom.courses.courseWorkMaterials.list({
              courseId,
              courseWorkMaterialStates: ['PUBLISHED', 'DRAFT'],
              fields: 'courseWorkMaterial(id),nextPageToken',
              pageToken,
            }),
          )
          total += (res.data.courseWorkMaterial ?? []).length
          pageToken = res.data.nextPageToken ?? undefined
        }
      } while (pageToken)
    }
    return total
  }

  async listTopics(courseId: string, req: PageRequest = {}): Promise<Page<ProviderTopic>> {
    // `courses.topics`, NOT `classroom.topics` — the latter does not exist, and
    // the response field is `topic` (singular), not `topics`.
    const res = await call(() =>
      this.clients.classroom.courses.topics.list({
        courseId,
        pageSize: req.pageSize,
        pageToken: req.pageToken ?? undefined,
      }),
    )
    return {
      items: (res.data.topic ?? []).map((topic, index) => ({
        id: topic.topicId ?? '',
        name: topic.name ?? '',
        // Google exposes no explicit ordinal for topics; list order is the only
        // ordering it gives, so that is what is reported rather than a fabricated
        // stable rank.
        sortOrder: index,
      })),
      nextPageToken: res.data.nextPageToken ?? null,
    }
  }

  async createTopic(courseId: string, name: string): Promise<{ topicId: string }> {
    // Idempotent by name within a course, matching the port's contract: the
    // old->new topic map is built once, and Classroom will happily create a
    // second topic with the same name if asked.
    let pageToken: string | undefined
    do {
      const page = await call(() =>
        this.clients.classroom.courses.topics.list({ courseId, pageToken }),
      )
      const existing = (page.data.topic ?? []).find((topic) => topic.name === name)
      if (existing?.topicId) return { topicId: existing.topicId }
      pageToken = page.data.nextPageToken ?? undefined
    } while (pageToken)

    const created = await call(() =>
      this.clients.classroom.courses.topics.create({ courseId, requestBody: { name } }),
    )
    return { topicId: created.data.topicId ?? '' }
  }

  async listCourseWork(
    courseId: string,
    req: ListCourseWorkRequest = {},
  ): Promise<Page<ProviderCourseWork>> {
    // D19/D — the states are ALWAYS sent explicitly. Google's unfiltered default
    // is PUBLISHED-only, which would silently drop every draft and every
    // scheduled post: two-thirds of what F8 exists to copy.
    const states: CourseWorkState[] = req.courseWorkStates ?? ['PUBLISHED']
    const res = await call(() =>
      this.clients.classroom.courses.courseWork.list({
        courseId,
        courseWorkStates: states,
        pageSize: req.pageSize,
        pageToken: req.pageToken ?? undefined,
      }),
    )
    const items = (res.data.courseWork ?? []).map((work) => {
      const id = work.id ?? ''
      this.courseOf.set(id, courseId)
      const attachments = attachmentsOf(work.materials, 'courseWork', id, this.accountId)
      this.rememberDriveFiles(attachments)
      return {
        id,
        courseId,
        title: work.title ?? 'Untitled',
        description: work.description ?? null,
        workType: toWorkType(work.workType),
        state: (work.state as CourseWorkState | null) ?? 'PUBLISHED',
        // Google has no SCHEDULED state: a scheduled post is a DRAFT carrying
        // scheduledTime, and that is exactly how it is reported here.
        scheduledTime: work.scheduledTime ? toDate(work.scheduledTime) : null,
        maxPoints: work.maxPoints ?? null,
        answerConfig: toAnswerConfig(work),
        quizFormLink: quizFormLinkOf(work),
        topicId: work.topicId ?? null,
        creationTime: toDate(work.creationTime),
        attachments,
        // Google does not report rubric presence on the courseWork resource, and
        // a rubrics call per post during enumeration is exactly the N+1 the port
        // was shaped to avoid. `getRubric` is the authority; this is the cheap
        // signal, and it is honest about being a maybe rather than claiming
        // false for everything.
        //
        // F11 — it is `maxPoints != null` and nothing more, i.e. "is this a
        // graded assignment". The disjunct that used to sit in front of it,
        // `associatedWithDeveloper === true`, means "this post was created by
        // THIS API project" and says nothing whatever about rubrics; it only
        // ever widened an already-true predicate, so removing it changes no
        // outcome and stops the expression from claiming a signal it never
        // carried. The remaining cost — one `getRubric` per graded post at
        // transfer time, most of which return null — is real and is tracked as
        // a backlog item rather than papered over here.
        hasRubric: work.maxPoints != null,
      } satisfies ProviderCourseWork
    })
    return { items, nextPageToken: res.data.nextPageToken ?? null }
  }

  async listCourseWorkMaterials(
    courseId: string,
    req: ListCourseWorkMaterialsRequest = {},
  ): Promise<Page<ProviderCourseWorkMaterial>> {
    const states: CourseWorkState[] = req.courseWorkMaterialStates ?? ['PUBLISHED']
    const res = await call(() =>
      this.clients.classroom.courses.courseWorkMaterials.list({
        courseId,
        // APPLY-D — a differently-named parameter on a different endpoint.
        courseWorkMaterialStates: states,
        pageSize: req.pageSize,
        pageToken: req.pageToken ?? undefined,
      }),
    )
    const items = (res.data.courseWorkMaterial ?? []).map((material) => {
      const id = material.id ?? ''
      this.courseOf.set(id, courseId)
      const attachments = attachmentsOf(material.materials, 'courseWorkMaterial', id, this.accountId)
      this.rememberDriveFiles(attachments)
      return {
        id,
        courseId,
        title: material.title ?? 'Untitled',
        description: material.description ?? null,
        state: (material.state as CourseWorkState | null) ?? 'PUBLISHED',
        topicId: material.topicId ?? null,
        creationTime: toDate(material.creationTime),
        attachments,
      } satisfies ProviderCourseWorkMaterial
    })
    return { items, nextPageToken: res.data.nextPageToken ?? null }
  }

  private rememberDriveFiles(attachments: ProviderAttachment[]): void {
    for (const attachment of attachments) {
      if (attachment.driveFileId) this.driveFileOf.set(attachment.id, attachment.driveFileId)
    }
  }

  async createCourseWork(courseId: string, payload: CourseWorkPayload): Promise<{ id: string }> {
    const res = await call(() =>
      this.clients.classroom.courses.courseWork.create({
        courseId,
        requestBody: {
          title: payload.title,
          description: payload.description ?? undefined,
          workType: payload.workType,
          // Literal DRAFT, and no dueDate/dueTime/scheduledTime anywhere in this
          // body — the port makes those unrepresentable and the adapter must not
          // reintroduce them.
          state: 'DRAFT',
          topicId: payload.topicId ?? undefined,
          maxPoints: payload.maxPoints ?? undefined,
          multipleChoiceQuestion:
            payload.answerConfig?.type === 'multipleChoice'
              ? { choices: payload.answerConfig.choices }
              : undefined,
          materials: payload.materials.map(fromMaterial),
          assigneeMode: payload.assigneeMode,
        },
      }),
    )
    const id = res.data.id ?? ''
    this.courseOf.set(id, courseId)
    return { id }
  }

  async createCourseWorkMaterial(
    courseId: string,
    payload: CourseWorkMaterialPayload,
  ): Promise<{ id: string }> {
    const res = await call(() =>
      this.clients.classroom.courses.courseWorkMaterials.create({
        courseId,
        requestBody: {
          title: payload.title,
          description: payload.description ?? undefined,
          state: 'DRAFT',
          topicId: payload.topicId ?? undefined,
          materials: payload.materials.map(fromMaterial),
        },
      }),
    )
    const id = res.data.id ?? ''
    this.courseOf.set(id, courseId)
    return { id }
  }

  private courseIdFor(postId: string): string {
    const courseId = this.courseOf.get(postId)
    if (!courseId) {
      throw new NotFoundError(
        `No course is known for post ${postId}. It must be listed or created through this provider first.`,
      )
    }
    return courseId
  }

  async updateCourseWorkDescription(courseWorkId: string, description: string): Promise<void> {
    await call(() =>
      this.clients.classroom.courses.courseWork.patch({
        courseId: this.courseIdFor(courseWorkId),
        id: courseWorkId,
        updateMask: 'description',
        requestBody: { description },
      }),
    )
  }

  async updateCourseWorkMaterialDescription(materialId: string, description: string): Promise<void> {
    await call(() =>
      this.clients.classroom.courses.courseWorkMaterials.patch({
        courseId: this.courseIdFor(materialId),
        id: materialId,
        updateMask: 'description',
        requestBody: { description },
      }),
    )
  }

  async getAttachmentHealth(refs: AttachmentRef[]): Promise<Map<string, HealthState>> {
    const health = new Map<string, HealthState>()
    if (refs.length === 0) return health

    const driveRefs: Array<{ ref: AttachmentRef; fileId: string }> = []
    for (const ref of refs) {
      const driveFileId = this.driveFileOf.get(ref.id)
      if (!driveFileId) {
        health.set(ref.id, 'healthy')
        continue
      }
      driveRefs.push({ ref, fileId: driveFileId })
    }

    const CONCURRENCY = 10
    for (let i = 0; i < driveRefs.length; i += CONCURRENCY) {
      const batch = driveRefs.slice(i, i + CONCURRENCY)
      const results = await Promise.all(
        batch.map(async ({ ref, fileId }) => {
          const state = await this.driveFileHealth(fileId)
          return [ref.id, state] as const
        }),
      )
      for (const [id, state] of results) health.set(id, state)
    }
    return health
  }

  private async driveFileHealth(fileId: string): Promise<HealthState> {
    try {
      const res = await call(() =>
        this.clients.drive.files.get({ fileId, fields: 'id,trashed,explicitlyTrashed,capabilities/canCopy' }),
      )
      if (res.data.trashed || res.data.explicitlyTrashed) return 'trashed'
      if (res.data.capabilities?.canCopy === false) return 'permission_locked'
      return 'healthy'
    } catch (error) {
      if (error instanceof NotFoundError) return 'deleted'
      if (error instanceof PermissionError) return 'permission_locked'
      throw error
    }
  }

  async copyAttachmentToMyDrive(
    ref: AttachmentRef,
    _actingAccountId: string,
  ): Promise<{ newDriveFileId: string }> {
    const driveFileId = this.driveFileOf.get(ref.id)
    if (!driveFileId) throw new NotFoundError(`Attachment ${ref.id} is not a Drive file.`)
    // `files.copy` — a copy and ONLY a copy (P0-3). Nothing here touches the
    // source file's permissions, parents or content.
    const res = await call(() => this.clients.drive.files.copy({ fileId: driveFileId, fields: 'id' }))
    return { newDriveFileId: res.data.id ?? '' }
  }

  /* -------------------------------------------------------------- *
   * Rubrics — absent from googleapis@144's classroom typings, so
   * called through the authorized client's generic request().
   * -------------------------------------------------------------- */

  private async rubricsRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    const auth = this.clients.classroom.context._options.auth as OAuth2Client
    try {
      const res = await auth.request<T>({ url: `${RUBRICS_BASE}${path}`, method, data: body })
      return res.data
    } catch (error) {
      const mapped = mapGoogleError(error)
      if (mapped instanceof NotFoundError) return null
      throw mapped
    }
  }

  async getRubric(courseWorkId: string): Promise<RubricBody | null> {
    const courseId = this.courseIdFor(courseWorkId)
    const data = await this.rubricsRequest<{ rubrics?: Array<{ criteria?: RawCriterion[] }> }>(
      'GET',
      `/courses/${courseId}/courseWork/${courseWorkId}/rubrics`,
    )
    const criteria = data?.rubrics?.[0]?.criteria
    if (!criteria || criteria.length === 0) return null
    return {
      criteria: criteria.map((criterion, index) => ({
        title: criterion.title ?? '',
        description: criterion.description ?? null,
        sortOrder: index,
        levels: (criterion.levels ?? []).map((level, levelIndex) => ({
          title: level.title ?? '',
          description: level.description ?? null,
          points: level.points ?? 0,
          sortOrder: levelIndex,
        })),
      })),
    }
  }

  async createRubric(targetCourseWorkId: string, rubric: RubricBody): Promise<{ id: string }> {
    const courseId = this.courseIdFor(targetCourseWorkId)
    const data = await this.rubricsRequest<{ id?: string }>(
      'POST',
      `/courses/${courseId}/courseWork/${targetCourseWorkId}/rubrics`,
      {
        criteria: rubric.criteria.map((criterion) => ({
          title: criterion.title,
          description: criterion.description ?? undefined,
          levels: criterion.levels.map((level) => ({
            title: level.title,
            description: level.description ?? undefined,
            points: level.points,
          })),
        })),
      },
    )
    // A null here means Google answered 404 for the create path, which is not
    // "no rubric" — it is a create that did not happen.
    if (!data) throw new NotFoundError('Google could not attach a rubric to this assignment.')
    return { id: data.id ?? '' }
  }
}

interface RawCriterion {
  title?: string
  description?: string
  levels?: Array<{ title?: string; description?: string; points?: number }>
}
