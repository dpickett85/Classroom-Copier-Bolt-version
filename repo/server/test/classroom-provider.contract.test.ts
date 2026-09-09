/**
 * The shared ClassroomProvider CONTRACT test.
 *
 * It is written against the port, not against the mock, so the same suite runs
 * against a future `RealClassroomProvider` unchanged. That seam is the only
 * mechanism that will actually catch drift when the real adapter arrives — the
 * interface's fidelity to the real API is otherwise unverified until then.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ClassroomProvider } from '../src/adapters/classroom-provider.interface.js'
import { MockClassroomProvider } from '../src/adapters/mock/mock-classroom-provider.js'
import { LicenseBlockedError, RateLimitError } from '../src/adapters/types.js'
import {
  F13_PERSISTENT_429_TITLE,
  F6_TRANSIENT_429_TITLE,
  FIXTURE_KEYS,
} from '../src/fixtures/index.js'
import { ALL_COURSE_WORK_STATES } from '../src/services/post-enumerator.js'
import { createTestDb, type TestDb } from './helpers/db.js'

let db: TestDb
let provider: ClassroomProvider

beforeAll(async () => {
  db = await createTestDb()
  provider = new MockClassroomProvider(db.prisma)
})
afterAll(async () => {
  await db.dispose()
})

describe('listCourses — courseStates is on the port (D19/E)', () => {
  it('returns ACTIVE only by default', async () => {
    const page = await provider.listCourses('acct-jamie')
    expect(page.items.every((c) => c.state === 'ACTIVE')).toBe(true)
  })

  it('returns ACTIVE + ARCHIVED when both are requested (source-role scoping)', async () => {
    const page = await provider.listCourses('acct-jamie', { courseStates: ['ACTIVE', 'ARCHIVED'] })
    expect(page.items.some((c) => c.state === 'ARCHIVED')).toBe(true)
  })

  it('scopes to the acting account — F10 collision avoidance', async () => {
    const jamie = await provider.listCourses('acct-jamie', { courseStates: ['ACTIVE', 'ARCHIVED'] })
    const dana = await provider.listCourses('acct-dana', { courseStates: ['ACTIVE', 'ARCHIVED'] })
    const overlap = jamie.items.filter((c) => dana.items.some((d) => d.id === c.id))
    expect(overlap).toEqual([])
  })
})

describe('listCourseWork — courseWorkStates (D19/D, the most dangerous adapter finding)', () => {
  it('returns PUBLISHED only when no states are passed, exactly like the real API', async () => {
    const page = await provider.listCourseWork(FIXTURE_KEYS.F1)
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.every((i) => i.state === 'PUBLISHED')).toBe(true)
  })

  it('returns exactly the requested states when they are passed', async () => {
    const page = await provider.listCourseWork(FIXTURE_KEYS.F1, {
      courseWorkStates: ALL_COURSE_WORK_STATES,
    })
    const states = new Set(page.items.map((i) => i.state))
    expect(states.has('DRAFT')).toBe(true)

    const draftsOnly = await provider.listCourseWork(FIXTURE_KEYS.F1, {
      courseWorkStates: ['DRAFT'],
    })
    expect(draftsOnly.items.every((i) => i.state === 'DRAFT')).toBe(true)
  })

  /**
   * APPLY-D, resolved. `SCHEDULED` was a mock-invented state pinned in place by
   * the test that used to live here, flagged as a DECLARED DIVERGENCE. Google's
   * real vocabulary is PUBLISHED | DRAFT (| DELETED, which v1 deliberately does
   * not model — nothing requests it and no fixture exercises it). A scheduled
   * post is a DRAFT carrying `scheduledTime`, and that is now the only
   * representation: one fact, one column.
   */
  it('real-API parity — a scheduled post is a DRAFT carrying scheduledTime, never its own state', async () => {
    const page = await provider.listCourseWork(FIXTURE_KEYS.F1, {
      courseWorkStates: ALL_COURSE_WORK_STATES,
    })
    // The invented state must be gone entirely.
    expect(page.items.some((i) => (i.state as string) === 'SCHEDULED')).toBe(false)
    // F8's scheduled post is still present and still distinguishable — as a
    // DRAFT with a scheduledTime, exactly as courses.courseWork models it.
    const scheduledDrafts = page.items.filter((i) => i.state === 'DRAFT' && i.scheduledTime != null)
    expect(scheduledDrafts.length).toBeGreaterThan(0)
    // And it surfaces under a DRAFT-only filter, as it would from the real API.
    const draftsOnly = await provider.listCourseWork(FIXTURE_KEYS.F1, {
      courseWorkStates: ['DRAFT'],
    })
    expect(draftsOnly.items.some((i) => i.scheduledTime != null)).toBe(true)
  })

  it('APPLY-D — the two surfaces take DIFFERENTLY NAMED state parameters', async () => {
    // `courses.courseWorkMaterials.list` is a different real endpoint. One
    // shared `ListCourseWorkRequest` asserted a single vocabulary for two of
    // them, which is exactly the mock-shaped convenience the port exists to
    // prevent. A `courseWorkStates` key is simply not part of this request type,
    // so the filter below is ignored — and the default (PUBLISHED only) applies.
    const filtered = await provider.listCourseWorkMaterials(FIXTURE_KEYS.F1, {
      courseWorkMaterialStates: ['DRAFT'],
    })
    expect(filtered.items.every((i) => i.state === 'DRAFT')).toBe(true)

    const defaulted = await provider.listCourseWorkMaterials(FIXTURE_KEYS.F1)
    expect(defaulted.items.every((i) => i.state === 'PUBLISHED')).toBe(true)
  })
})

describe('pagination (D9)', () => {
  it('returns a nextPageToken until the set is exhausted', async () => {
    const paged = new MockClassroomProvider(db.prisma, { forcePageSize: 7 })
    let token: string | null = null
    let total = 0
    let calls = 0
    do {
      const page = await paged.listCourseWork(FIXTURE_KEYS.F4, {
        courseWorkStates: ALL_COURSE_WORK_STATES,
        pageToken: token,
      })
      total += page.items.length
      token = page.nextPageToken
      calls += 1
    } while (token != null)
    expect(calls).toBeGreaterThan(1)
    expect(total).toBe(40)
  })
})

describe('getAttachmentHealth — batch-shaped (D20)', () => {
  it('answers for every ref in one call', async () => {
    const health = await provider.getAttachmentHealth([
      { id: 'att-f2-m1a', parentType: 'courseWorkMaterial', parentId: 'cwm-f2-1' },
      { id: 'att-f2-1a', parentType: 'courseWork', parentId: 'cw-f2-1' },
      { id: 'att-f3-1a', parentType: 'courseWork', parentId: 'cw-f3-1' },
      { id: 'att-f1-m1a', parentType: 'courseWorkMaterial', parentId: 'cwm-f1-1' },
    ])
    expect(health.get('att-f2-m1a')).toBe('trashed')
    expect(health.get('att-f2-1a')).toBe('deleted')
    expect(health.get('att-f3-1a')).toBe('permission_locked')
    expect(health.get('att-f1-m1a')).toBe('healthy')
  })

  it('returns an empty map for an empty batch rather than issuing a query', async () => {
    expect((await provider.getAttachmentHealth([])).size).toBe(0)
  })
})

describe('shareMode has a carrier (D18/C)', () => {
  it('reports the source shareMode verbatim, including STUDENT_COPY', async () => {
    const page = await provider.listCourseWork(FIXTURE_KEYS.F1, {
      courseWorkStates: ALL_COURSE_WORK_STATES,
    })
    const withDrive = page.items.flatMap((i) => i.attachments).filter((a) => a.kind === 'driveFile')
    expect(withDrive.some((a) => a.shareMode === 'STUDENT_COPY')).toBe(true)
  })

  it('round-trips a non-VIEW shareMode through a create — never defaulting it', async () => {
    const { id } = await provider.createCourseWork(FIXTURE_KEYS.TARGET_JAMIE, {
      title: 'shareMode round-trip',
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      materials: [
        {
          kind: 'driveFile',
          driveFileId: 'drive-xyz',
          title: 'Doc',
          shareMode: 'STUDENT_COPY',
        },
      ],
      assigneeMode: 'ALL_STUDENTS',
    })
    const written = await db.prisma.mockAttachment.findMany({ where: { parentId: id } })
    expect(written[0]!.shareMode).toBe('STUDENT_COPY')
  })
})

describe('creates always land as DRAFT with dates cleared', () => {
  it('writes state=DRAFT and null dueDate/scheduledTime', async () => {
    const { id } = await provider.createCourseWork(FIXTURE_KEYS.TARGET_JAMIE, {
      title: 'draft check',
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      maxPoints: 10,
      materials: [],
      assigneeMode: 'ALL_STUDENTS',
    })
    const row = await db.prisma.mockCourseWork.findUnique({ where: { id } })
    expect(row!.state).toBe('DRAFT')
    expect(row!.dueDate).toBeNull()
    expect(row!.scheduledTime).toBeNull()
  })
})

describe('F6 vs F13 — the two rate-limit fixtures must DIVERGE', () => {
  /**
   * APPLY-G — a rate-limit rule belongs to a SOURCE COURSE, not to a title
   * string. Every real run enumerates its source before it creates anything, so
   * a scenario test has to do the same to be in that scenario at all.
   */
  async function providerThatRead(sourceCourseId: string): Promise<MockClassroomProvider> {
    const p = new MockClassroomProvider(db.prisma)
    await p.listCourseWork(sourceCourseId, { courseWorkStates: ALL_COURSE_WORK_STATES })
    return p
  }

  it('a rule does NOT fire for a run that never read its source course', async () => {
    // The bug: keyed on title globally, so a copy of F13's post sitting in a
    // target course from a previous run 429'd a later transfer out of THAT
    // course — a rule intended for one fixture, firing anywhere the name
    // appeared.
    const unrelated = new MockClassroomProvider(db.prisma)
    await unrelated.listCourseWork(FIXTURE_KEYS.F1, {
      courseWorkStates: ALL_COURSE_WORK_STATES,
    })
    const created = await unrelated.createCourseWork(FIXTURE_KEYS.TARGET_JAMIE, {
      title: F13_PERSISTENT_429_TITLE,
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      materials: [{ kind: 'link', url: 'https://x.mock', title: 'x' }],
      assigneeMode: 'ALL_STUDENTS',
    })
    expect(created.id).toBeTruthy()
  })

  it('F6 429s once and then succeeds (retry-succeeds)', async () => {
    const p = await providerThatRead(FIXTURE_KEYS.F6)
    await expect(
      p.createCourseWork(FIXTURE_KEYS.TARGET_DANA, {
        title: F6_TRANSIENT_429_TITLE,
        workType: 'ASSIGNMENT',
        state: 'DRAFT',
        materials: [],
        assigneeMode: 'ALL_STUDENTS',
      }),
    ).rejects.toBeInstanceOf(RateLimitError)

    const second = await p.createCourseWork(FIXTURE_KEYS.TARGET_DANA, {
      title: F6_TRANSIENT_429_TITLE,
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      materials: [],
      assigneeMode: 'ALL_STUDENTS',
    })
    expect(second.id).toBeTruthy()
  })

  it('F13 refuses EVERY attachment-bearing create, no matter how many times', async () => {
    const p = await providerThatRead(FIXTURE_KEYS.F13)
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expect(
        p.createCourseWork(FIXTURE_KEYS.TARGET_DANA, {
          title: F13_PERSISTENT_429_TITLE,
          workType: 'ASSIGNMENT',
          state: 'DRAFT',
          materials: [{ kind: 'link', url: 'https://x.mock', title: 'x' }],
          assigneeMode: 'ALL_STUDENTS',
        }),
      ).rejects.toBeInstanceOf(RateLimitError)
    }
  })

  it('D13 — F13 PERMITS a bare shell create, which is what makes the guaranteed fallback reachable', async () => {
    const p = await providerThatRead(FIXTURE_KEYS.F13)
    const shell = await p.createCourseWork(FIXTURE_KEYS.TARGET_DANA, {
      title: F13_PERSISTENT_429_TITLE,
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      materials: [],
      assigneeMode: 'ALL_STUDENTS',
    })
    expect(shell.id).toBeTruthy()
    const row = await db.prisma.mockCourseWork.findUnique({ where: { id: shell.id } })
    expect(row).not.toBeNull()
  })
})

describe('rubrics — get-then-create (D23)', () => {
  it('returns criteria AND levels, not a boolean', async () => {
    const rubric = await provider.getRubric('cw-f1-1')
    expect(rubric).not.toBeNull()
    expect(rubric!.criteria.length).toBeGreaterThanOrEqual(2)
    expect(rubric!.criteria[0]!.levels.length).toBeGreaterThanOrEqual(1)
    expect(rubric!.criteria[0]!.levels[0]!.points).toBeTypeOf('number')
  })

  it('returns null for coursework with no rubric', async () => {
    expect(await provider.getRubric('cw-f1-3')).toBeNull()
  })

  it('D24 — createRubric SUCCEEDS on a licence-permitted course, copying criteria verbatim', async () => {
    const source = await provider.getRubric('cw-f1-1')
    const target = await provider.createCourseWork(FIXTURE_KEYS.TARGET_JAMIE, {
      title: 'rubric target',
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      materials: [],
      assigneeMode: 'ALL_STUDENTS',
    })
    await provider.createRubric(target.id, source!)
    const copied = await provider.getRubric(target.id)
    expect(copied).toEqual(source)
  })

  it('F7 — createRubric throws LicenseBlockedError on a licence-blocked course', async () => {
    const source = await provider.getRubric('cw-f7-1')
    expect(source).not.toBeNull()
    const target = await provider.createCourseWork(FIXTURE_KEYS.TARGET_DANA, {
      title: 'licence-blocked rubric target',
      workType: 'ASSIGNMENT',
      state: 'DRAFT',
      materials: [],
      assigneeMode: 'ALL_STUDENTS',
    })
    await expect(provider.createRubric(target.id, source!)).rejects.toBeInstanceOf(
      LicenseBlockedError,
    )
  })
})

describe('copyAttachmentToMyDrive — a copy, and ONLY a copy (P0-3)', () => {
  it('LEAVES THE SOURCE ATTACHMENT UNCHANGED', async () => {
    // This assertion is the whole guarantee, and it did not exist. The method
    // named "copy" was implemented as an in-place `update` of the source
    // course's attachment row — the only write to the source course anywhere in
    // the system, in a product whose entire proposition is that copying is
    // non-destructive.
    const before = await db.prisma.mockAttachment.findUniqueOrThrow({
      where: { id: 'att-f3-1a' },
    })
    expect(before.driveState).toBe('permission_locked')

    await provider.copyAttachmentToMyDrive(
      { id: 'att-f3-1a', parentType: 'courseWork', parentId: 'cw-f3-1' },
      'acct-jamie',
    )

    const after = await db.prisma.mockAttachment.findUniqueOrThrow({ where: { id: 'att-f3-1a' } })
    expect(after.ownerAccountId).toBe(before.ownerAccountId)
    expect(after.driveFileId).toBe(before.driveFileId)
    expect(after.parentId).toBe(before.parentId)
    // F3's finding must still be reproducible after a copy — healing it in
    // place made the scenario un-testable within a session.
    expect(after.driveState).toBe('permission_locked')
  })

  it('creates a NEW file the acting account owns, and returns its id', async () => {
    const { newDriveFileId } = await provider.copyAttachmentToMyDrive(
      { id: 'att-f3-1a', parentType: 'courseWork', parentId: 'cw-f3-1' },
      'acct-jamie',
    )
    expect(newDriveFileId).toBeTruthy()

    const copy = await db.prisma.mockAttachment.findFirstOrThrow({
      where: { driveFileId: newDriveFileId },
    })
    expect(copy.id).not.toBe('att-f3-1a')
    expect(copy.ownerAccountId).toBe('acct-jamie')
    expect(copy.driveState).toBe('healthy')
    // The copy lives in the acting account's Drive, NOT on the source post —
    // otherwise "the source course is never touched" would still be false.
    expect(copy.parentType).toBe('myDrive')
  })

  it('does not add an attachment to the source post', async () => {
    const before = await db.prisma.mockAttachment.count({
      where: { parentType: 'courseWork', parentId: 'cw-f3-1' },
    })
    await provider.copyAttachmentToMyDrive(
      { id: 'att-f3-1a', parentType: 'courseWork', parentId: 'cw-f3-1' },
      'acct-dana',
    )
    const after = await db.prisma.mockAttachment.count({
      where: { parentType: 'courseWork', parentId: 'cw-f3-1' },
    })
    expect(after).toBe(before)
  })
})

describe('topics', () => {
  it('createTopic is idempotent by name within a course (the old->new map is built once)', async () => {
    const a = await provider.createTopic(FIXTURE_KEYS.TARGET_JAMIE, 'Unit 1 — Foundations')
    const b = await provider.createTopic(FIXTURE_KEYS.TARGET_JAMIE, 'Unit 1 — Foundations')
    expect(a.topicId).toBe(b.topicId)
  })
})
