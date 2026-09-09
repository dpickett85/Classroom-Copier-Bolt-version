/**
 * `RealClassroomProvider` against a FAKE googleapis transport.
 *
 * The transport records every request, which is what lets these tests assert on
 * the CALLS rather than on the return values — the D19/D trap (an omitted state
 * filter silently returns PUBLISHED only) is invisible in a response and obvious
 * in a request, and an outcome assertion would pass while the bug is live.
 */
import { describe, expect, it } from 'vitest'
import type { classroom_v1, drive_v3 } from 'googleapis'
import {
  AuthExpiredError,
  LicenseBlockedError,
  NotFoundError,
  PermissionError,
  RateLimitError,
} from '../types.js'
import { RealClassroomProvider, mapGoogleError } from './real-classroom-provider.js'

const ACCOUNT = 'goog-112233'

interface Recorded {
  method: string
  params: Record<string, unknown>
}

/** A googleapis-shaped error: status, headers and an `error` envelope. */
function gaxiosError(
  status: number,
  options: { reason?: string; message?: string; retryAfter?: string; code?: string } = {},
) {
  const error = Object.assign(new Error(options.message ?? `HTTP ${status}`), {
    status,
    code: options.code ?? status,
    // The property that makes this dangerous to log: a real googleapis error
    // carries the live bearer token here.
    config: { headers: { Authorization: 'Bearer ya29.super-secret-live-token' } },
    response: {
      status,
      headers: options.retryAfter ? { 'retry-after': options.retryAfter } : {},
      data: { error: { status: options.reason, message: options.message, errors: [{ reason: options.reason }] } },
    },
  })
  return error
}

function fakeClients(handlers: Record<string, (params: Record<string, unknown>) => unknown> = {}) {
  const calls: Recorded[] = []
  const handle = (method: string) => async (params: Record<string, unknown> = {}) => {
    calls.push({ method, params })
    const handler = handlers[method]
    const data = handler ? handler(params) : {}
    if (data instanceof Error) throw data
    return { data }
  }
  const classroom = {
    courses: {
      list: handle('courses.list'),
      get: handle('courses.get'),
      topics: { list: handle('topics.list'), create: handle('topics.create') },
      courseWork: {
        list: handle('courseWork.list'),
        create: handle('courseWork.create'),
        patch: handle('courseWork.patch'),
      },
      courseWorkMaterials: {
        list: handle('courseWorkMaterials.list'),
        create: handle('courseWorkMaterials.create'),
        patch: handle('courseWorkMaterials.patch'),
      },
    },
    context: { _options: { auth: { request: handle('rubrics.request') } } },
  } as unknown as classroom_v1.Classroom
  const drive = {
    files: { get: handle('drive.files.get'), copy: handle('drive.files.copy') },
  } as unknown as drive_v3.Drive
  return { clients: { classroom, drive }, calls }
}

function providerWith(handlers: Record<string, (params: Record<string, unknown>) => unknown> = {}) {
  const { clients, calls } = fakeClients(handlers)
  return { provider: new RealClassroomProvider(ACCOUNT, clients), calls }
}

/* ------------------------------------------------------------------ */

describe('state filters are ALWAYS sent explicitly (D19/D)', () => {
  it('sends courseWorkStates on every listCourseWork, defaulting to Google′s own default', async () => {
    const { provider, calls } = providerWith()
    await provider.listCourseWork('course-1')
    expect(calls[0]!.params.courseWorkStates).toEqual(['PUBLISHED'])

    await provider.listCourseWork('course-1', { courseWorkStates: ['DRAFT', 'PUBLISHED'] })
    expect(calls[1]!.params.courseWorkStates).toEqual(['DRAFT', 'PUBLISHED'])
  })

  it('sends the DIFFERENTLY NAMED parameter on the materials surface (APPLY-D)', async () => {
    const { provider, calls } = providerWith()
    await provider.listCourseWorkMaterials('course-1', { courseWorkMaterialStates: ['DRAFT'] })
    expect(calls[0]!.method).toBe('courseWorkMaterials.list')
    expect(calls[0]!.params.courseWorkMaterialStates).toEqual(['DRAFT'])
    expect(calls[0]!.params.courseWorkStates).toBeUndefined()
  })

  it('reads topics from courses.topics and the singular `topic` response field', async () => {
    const { provider, calls } = providerWith({
      'topics.list': () => ({ topic: [{ topicId: 't1', name: 'Unit 1' }, { topicId: 't2', name: 'Unit 2' }] }),
    })
    const page = await provider.listTopics('course-1')
    expect(calls[0]!.method).toBe('topics.list')
    expect(page.items.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(page.items.map((t) => t.sortOrder)).toEqual([0, 1])
  })
})

describe('pagination', () => {
  it('surfaces nextPageToken and passes a supplied one back', async () => {
    const { provider, calls } = providerWith({
      'courseWork.list': (params) =>
        params.pageToken ? { courseWork: [], nextPageToken: null } : { courseWork: [], nextPageToken: 'page-2' },
    })
    const first = await provider.listCourseWork('course-1')
    expect(first.nextPageToken).toBe('page-2')
    const second = await provider.listCourseWork('course-1', { pageToken: 'page-2' })
    expect(calls[1]!.params.pageToken).toBe('page-2')
    expect(second.nextPageToken).toBeNull()
  })
})

describe('reads', () => {
  const WORK = {
    id: 'cw-1',
    title: 'Lab safety',
    description: 'Read first',
    workType: 'QUIZ_ASSIGNMENT',
    state: 'DRAFT',
    scheduledTime: '2026-09-01T08:00:00Z',
    maxPoints: 20,
    topicId: 't1',
    creationTime: '2026-08-01T08:00:00Z',
    materials: [
      { driveFile: { driveFile: { id: 'file-1', title: 'Handout' }, shareMode: 'STUDENT_COPY' } },
      { form: { formUrl: 'https://docs.google.com/forms/d/e/x/viewform', title: 'Quiz' } },
      { youTubeVideo: { id: 'yt-1', title: 'Ignored kind' } },
    ],
  }

  it('reports a scheduled post as a DRAFT carrying scheduledTime — never its own state', async () => {
    const { provider } = providerWith({ 'courseWork.list': () => ({ courseWork: [WORK] }) })
    const [item] = (await provider.listCourseWork('c1', { courseWorkStates: ['DRAFT'] })).items
    expect(item!.state).toBe('DRAFT')
    expect(item!.scheduledTime).toEqual(new Date('2026-09-01T08:00:00Z'))
  })

  it('preserves QUIZ_ASSIGNMENT and the detected original Form link', async () => {
    const { provider } = providerWith({ 'courseWork.list': () => ({ courseWork: [WORK] }) })
    const [item] = (await provider.listCourseWork('c1')).items
    expect(item!.workType).toBe('QUIZ_ASSIGNMENT')
    expect(item!.quizFormLink).toBe('https://docs.google.com/forms/d/e/x/viewform')
  })

  it('carries shareMode verbatim and never invents VIEW for a non-Drive material', async () => {
    const { provider } = providerWith({ 'courseWork.list': () => ({ courseWork: [WORK] }) })
    const [item] = (await provider.listCourseWork('c1')).items
    const drive = item!.attachments.find((a) => a.kind === 'driveFile')
    expect(drive!.shareMode).toBe('STUDENT_COPY')
    expect(item!.attachments.find((a) => a.kind === 'form')!.shareMode).toBeNull()
  })

  it('drops a material kind it does not recognise rather than coercing it to an empty link', async () => {
    const { provider } = providerWith({ 'courseWork.list': () => ({ courseWork: [WORK] }) })
    const [item] = (await provider.listCourseWork('c1')).items
    // driveFile + form are recognised; `youTubeVideo` (wrong casing, i.e. an
    // unknown shape) is not, and must not appear as a link with an empty url.
    expect(item!.attachments.map((a) => a.kind)).toEqual(['driveFile', 'form'])
    expect(item!.attachments.some((a) => a.url === '')).toBe(false)
  })
})

describe('creates always land as DRAFT with dates cleared', () => {
  it('sends state=DRAFT and no dueDate/dueTime/scheduledTime', async () => {
    const { provider, calls } = providerWith({ 'courseWork.create': () => ({ id: 'new-1' }) })
    await provider.createCourseWork('c1', {
      title: 'Copied',
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      materials: [{ kind: 'driveFile', driveFileId: 'file-1', title: 'Handout', shareMode: 'STUDENT_COPY' }],
      assigneeMode: 'ALL_STUDENTS',
    })
    const body = calls[0]!.params.requestBody as Record<string, unknown>
    expect(body.state).toBe('DRAFT')
    expect(Object.keys(body)).not.toContain('dueDate')
    expect(Object.keys(body)).not.toContain('dueTime')
    expect(Object.keys(body)).not.toContain('scheduledTime')
  })

  it('round-trips a non-VIEW shareMode through the create body', async () => {
    const { provider, calls } = providerWith({ 'courseWork.create': () => ({ id: 'new-1' }) })
    await provider.createCourseWork('c1', {
      title: 'Copied',
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      materials: [{ kind: 'driveFile', driveFileId: 'file-1', title: 'Handout', shareMode: 'STUDENT_COPY' }],
      assigneeMode: 'ALL_STUDENTS',
    })
    const body = calls[0]!.params.requestBody as { materials: Array<{ driveFile?: { shareMode?: string } }> }
    expect(body.materials[0]!.driveFile!.shareMode).toBe('STUDENT_COPY')
  })
})

describe('createTopic is idempotent by name within a course', () => {
  it('reuses an existing topic instead of creating a second one with the same name', async () => {
    const { provider, calls } = providerWith({
      'topics.list': () => ({ topic: [{ topicId: 't-existing', name: 'Unit 1' }] }),
      'topics.create': () => ({ topicId: 't-new' }),
    })
    expect(await provider.createTopic('c1', 'Unit 1')).toEqual({ topicId: 't-existing' })
    expect(calls.some((c) => c.method === 'topics.create')).toBe(false)
  })

  it('creates when the name is genuinely new', async () => {
    const { provider } = providerWith({
      'topics.list': () => ({ topic: [{ topicId: 't-existing', name: 'Unit 1' }] }),
      'topics.create': () => ({ topicId: 't-new' }),
    })
    expect(await provider.createTopic('c1', 'Unit 2')).toEqual({ topicId: 't-new' })
  })
})

describe('copyAttachmentToMyDrive is a copy and ONLY a copy (P0-3)', () => {
  it('issues files.copy and never touches the source file', async () => {
    const { provider, calls } = providerWith({
      'courseWork.list': () => ({
        courseWork: [{ id: 'cw-1', materials: [{ driveFile: { driveFile: { id: 'file-1', title: 'H' } } }] }],
      }),
      'drive.files.copy': () => ({ id: 'file-copy' }),
    })
    const [item] = (await provider.listCourseWork('c1')).items
    const ref = item!.attachments[0]!
    const result = await provider.copyAttachmentToMyDrive(ref, ACCOUNT)
    expect(result.newDriveFileId).toBe('file-copy')

    const driveCalls = calls.filter((c) => c.method.startsWith('drive.'))
    expect(driveCalls.map((c) => c.method)).toEqual(['drive.files.copy'])
    // No update, no permissions change, no delete — the only Drive verb used is
    // `copy`, and the source file id appears only as its `fileId`.
    expect(driveCalls[0]!.params.fileId).toBe('file-1')
  })
})

describe('getAttachmentHealth', () => {
  it('issues no request at all for an empty batch', async () => {
    const { provider, calls } = providerWith()
    expect(await provider.getAttachmentHealth([])).toEqual(new Map())
    expect(calls).toHaveLength(0)
  })

  it('maps trashed, missing and locked Drive files onto the port′s vocabulary', async () => {
    const { provider } = providerWith({
      'courseWork.list': () => ({
        courseWork: [
          {
            id: 'cw-1',
            materials: [
              { driveFile: { driveFile: { id: 'file-ok', title: 'A' } } },
              { driveFile: { driveFile: { id: 'file-trashed', title: 'B' } } },
              { driveFile: { driveFile: { id: 'file-gone', title: 'C' } } },
              { driveFile: { driveFile: { id: 'file-locked', title: 'D' } } },
              { link: { url: 'https://example.com', title: 'E' } },
            ],
          },
        ],
      }),
      'drive.files.get': (params) => {
        switch (params.fileId) {
          case 'file-trashed':
            return { id: params.fileId, trashed: true }
          case 'file-gone':
            return gaxiosError(404)
          case 'file-locked':
            return gaxiosError(403)
          default:
            return { id: params.fileId, trashed: false, capabilities: { canCopy: true } }
        }
      },
    })
    const [item] = (await provider.listCourseWork('c1')).items
    const health = await provider.getAttachmentHealth(
      item!.attachments.map((a) => ({ id: a.id, parentType: a.parentType, parentId: a.parentId })),
    )
    expect([...health.values()]).toEqual(['healthy', 'trashed', 'deleted', 'permission_locked', 'healthy'])
  })
})

describe('error mapping', () => {
  it('maps a 401 invalid_grant to AuthExpiredError — not RateLimitError, not a generic Error', async () => {
    const { provider } = providerWith({ 'courseWork.list': () => gaxiosError(401, { reason: 'invalid_grant' }) })
    await expect(provider.listCourseWork('c1')).rejects.toBeInstanceOf(AuthExpiredError)
  })

  it('maps invalid_grant to AuthExpiredError even when the status is not 401', async () => {
    expect(mapGoogleError(gaxiosError(400, { code: 'invalid_grant' }))).toBeInstanceOf(AuthExpiredError)
  })

  it('maps a 429 to RateLimitError, carrying Retry-After as milliseconds', async () => {
    const error = mapGoogleError(gaxiosError(429, { reason: 'rateLimitExceeded', retryAfter: '30' }))
    expect(error).toBeInstanceOf(RateLimitError)
    expect((error as RateLimitError).retryAfterMs).toBe(30_000)
  })

  it('maps a 429 with no Retry-After to an undefined delay rather than zero', () => {
    expect((mapGoogleError(gaxiosError(429)) as RateLimitError).retryAfterMs).toBeUndefined()
  })

  it('separates a rubric licence denial from a plain 403', () => {
    expect(mapGoogleError(gaxiosError(403, { message: 'Rubrics are not available for this license' }))).toBeInstanceOf(
      LicenseBlockedError,
    )
    expect(mapGoogleError(gaxiosError(403, { reason: 'forbidden' }))).toBeInstanceOf(PermissionError)
  })

  it('maps 404 to NotFoundError', () => {
    expect(mapGoogleError(gaxiosError(404))).toBeInstanceOf(NotFoundError)
  })

  it('getCourse answers null for a 404 rather than throwing', async () => {
    const { provider } = providerWith({ 'courses.get': () => gaxiosError(404) })
    await expect(provider.getCourse('nope')).resolves.toBeNull()
  })

  // §8.0/S6 — the raw googleapis error carries config.headers.Authorization.
  it('never lets the raw provider error — or the bearer token it carries — escape', async () => {
    const { provider } = providerWith({ 'courseWork.list': () => gaxiosError(403, { reason: 'forbidden' }) })
    const error = await provider.listCourseWork('c1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PermissionError)
    const serialized = `${(error as Error).message} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`
    expect(serialized).not.toContain('ya29.')
    expect(serialized).not.toContain('Authorization')
    expect((error as { config?: unknown }).config).toBeUndefined()
    expect((error as { response?: unknown }).response).toBeUndefined()
  })
})

describe('the courseWorkId -> courseId bridge', () => {
  it('patches a description against the course the post was created in', async () => {
    const { provider, calls } = providerWith({ 'courseWork.create': () => ({ id: 'new-1' }) })
    await provider.createCourseWork('course-42', {
      title: 'T',
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      materials: [],
      assigneeMode: 'ALL_STUDENTS',
    })
    await provider.updateCourseWorkDescription('new-1', 'a note')
    const patch = calls.find((c) => c.method === 'courseWork.patch')!
    expect(patch.params.courseId).toBe('course-42')
    expect(patch.params.updateMask).toBe('description')
  })

  it('refuses — rather than guessing a course — for a post it has never seen', async () => {
    const { provider } = providerWith()
    await expect(provider.updateCourseWorkDescription('unknown-1', 'x')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('rubrics (get-then-create)', () => {
  async function withKnownPost(handlers: Record<string, (p: Record<string, unknown>) => unknown>) {
    const { provider, calls } = providerWith({ 'courseWork.create': () => ({ id: 'cw-1' }), ...handlers })
    await provider.createCourseWork('course-9', {
      title: 'T',
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      materials: [],
      assigneeMode: 'ALL_STUDENTS',
    })
    return { provider, calls }
  }

  it('returns criteria AND levels, not a boolean', async () => {
    const { provider } = await withKnownPost({
      'rubrics.request': () => ({
        rubrics: [
          {
            criteria: [
              { title: 'Accuracy', description: 'How right', levels: [{ title: 'Great', points: 4 }, { title: 'OK', points: 2 }] },
            ],
          },
        ],
      }),
    })
    const rubric = await provider.getRubric('cw-1')
    expect(rubric!.criteria[0]!.title).toBe('Accuracy')
    expect(rubric!.criteria[0]!.levels.map((l) => l.points)).toEqual([4, 2])
  })

  it('returns null when the assignment has no rubric', async () => {
    const { provider } = await withKnownPost({ 'rubrics.request': () => ({ rubrics: [] }) })
    await expect(provider.getRubric('cw-1')).resolves.toBeNull()
  })

  it('returns null when Google 404s the rubrics collection — an absent rubric, not an error', async () => {
    const { provider } = await withKnownPost({ 'rubrics.request': () => gaxiosError(404) })
    await expect(provider.getRubric('cw-1')).resolves.toBeNull()
  })

  it('does NOT report a 404 on the create path as success — a create that did not happen', async () => {
    const { provider } = await withKnownPost({ 'rubrics.request': () => gaxiosError(404) })
    await expect(provider.createRubric('cw-1', { criteria: [] })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws LicenseBlockedError when the tier blocks rubrics (F7)', async () => {
    const { provider } = await withKnownPost({
      'rubrics.request': () => gaxiosError(403, { message: 'Rubrics require a paid license' }),
    })
    await expect(provider.createRubric('cw-1', { criteria: [] })).rejects.toBeInstanceOf(LicenseBlockedError)
  })
})
