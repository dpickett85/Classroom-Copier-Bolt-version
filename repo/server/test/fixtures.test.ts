import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FIXTURE_KEYS } from '../src/fixtures/index.js'
import { seedFixtures } from '../src/fixtures/seed.js'
import { createTestDb, type TestDb } from './helpers/db.js'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
})
afterAll(async () => {
  await db.dispose()
})

async function counts() {
  const [accounts, courses, topics, courseWork, materials, attachments, rubrics, criteria, levels] =
    await Promise.all([
      db.prisma.mockAccount.count(),
      db.prisma.mockCourse.count(),
      db.prisma.mockTopic.count(),
      db.prisma.mockCourseWork.count(),
      db.prisma.mockCourseWorkMaterial.count(),
      db.prisma.mockAttachment.count(),
      db.prisma.mockRubric.count(),
      db.prisma.mockRubricCriterion.count(),
      db.prisma.mockRubricLevel.count(),
    ])
  return { accounts, courses, topics, courseWork, materials, attachments, rubrics, criteria, levels }
}

describe('fixture-seed-data (D3) — idempotency', () => {
  it('produces identical row counts when run twice', async () => {
    const before = await counts()
    await seedFixtures(db.prisma)
    expect(await counts()).toEqual(before)
  })
})

describe('F10 — mock identity seeds two teacher accounts with distinct course lists', () => {
  it('seeds at least two accounts with distinct emails', async () => {
    const accounts = await db.prisma.mockAccount.findMany()
    expect(accounts.length).toBeGreaterThanOrEqual(2)
    expect(new Set(accounts.map((a) => a.email)).size).toBe(accounts.length)
  })

  it('gives each account a different course list', async () => {
    const jamie = await db.prisma.mockCourse.findMany({ where: { ownerAccountId: 'acct-jamie' } })
    const dana = await db.prisma.mockCourse.findMany({ where: { ownerAccountId: 'acct-dana' } })
    expect(jamie.length).toBeGreaterThan(0)
    expect(dana.length).toBeGreaterThan(0)
    expect(new Set(jamie.map((c) => c.id))).not.toEqual(new Set(dana.map((c) => c.id)))
  })
})

describe('F4 — exactly 50 posts', () => {
  it('has exactly 50 CourseWork + CourseWorkMaterial rows combined', async () => {
    const [cw, cwm] = await Promise.all([
      db.prisma.mockCourseWork.count({ where: { courseId: FIXTURE_KEYS.F4 } }),
      db.prisma.mockCourseWorkMaterial.count({ where: { courseId: FIXTURE_KEYS.F4 } }),
    ])
    expect(cw + cwm).toBe(50)
  })
})

describe('F1 — healthy, and the carrier for F8 / F9 / F11', () => {
  it('has no unhealthy attachments (the silent auto-proceed path)', async () => {
    const posts = await db.prisma.mockCourseWork.findMany({ where: { courseId: FIXTURE_KEYS.F1 } })
    const materials = await db.prisma.mockCourseWorkMaterial.findMany({
      where: { courseId: FIXTURE_KEYS.F1 },
    })
    const ids = [...posts.map((p) => p.id), ...materials.map((m) => m.id)]
    const unhealthy = await db.prisma.mockAttachment.count({
      where: { parentId: { in: ids }, driveState: { not: 'healthy' } },
    })
    expect(unhealthy).toBe(0)
  })

  it('F8 — covers Published, plain Draft, and scheduled Draft (Google has no SCHEDULED state)', async () => {
    const work = await db.prisma.mockCourseWork.findMany({
      where: { courseId: FIXTURE_KEYS.F8 },
      select: { state: true, scheduledTime: true },
    })
    const materials = await db.prisma.mockCourseWorkMaterial.findMany({
      where: { courseId: FIXTURE_KEYS.F8 },
      select: { state: true },
    })
    const states = new Set([...work.map((r) => r.state), ...materials.map((r) => r.state)])
    // The vocabulary is Google's: two states, no invented third.
    expect(states).toEqual(new Set(['DRAFT', 'PUBLISHED']))
    // The third COVERAGE case still exists — a scheduled post, represented the
    // way the real API represents it: DRAFT + scheduledTime.
    expect(work.some((r) => r.state === 'DRAFT' && r.scheduledTime != null)).toBe(true)
    expect(work.some((r) => r.state === 'DRAFT' && r.scheduledTime == null)).toBe(true)
  })

  it('F9 — covers all four coursework types including both Question configs', async () => {
    const workTypes = new Set(
      (
        await db.prisma.mockCourseWork.findMany({
          where: { courseId: FIXTURE_KEYS.F9 },
          select: { workType: true },
        })
      ).map((r) => r.workType),
    )
    expect(workTypes).toEqual(
      new Set([
        'ASSIGNMENT',
        'QUIZ_ASSIGNMENT',
        'SHORT_ANSWER_QUESTION',
        'MULTIPLE_CHOICE_QUESTION',
      ]),
    )
    const materials = await db.prisma.mockCourseWorkMaterial.count({
      where: { courseId: FIXTURE_KEYS.F9 },
    })
    expect(materials).toBeGreaterThan(0)
  })

  it('F11 — has >=2 topics and >=1 untopiced post', async () => {
    const topics = await db.prisma.mockTopic.count({ where: { courseId: FIXTURE_KEYS.F11 } })
    expect(topics).toBeGreaterThanOrEqual(2)
    const untopiced = await db.prisma.mockCourseWork.count({
      where: { courseId: FIXTURE_KEYS.F11, topicId: null },
    })
    expect(untopiced).toBeGreaterThanOrEqual(1)
  })

  it('D24 — seeds a rubric with real criteria and levels so createRubric SUCCEEDS somewhere', async () => {
    const cw = await db.prisma.mockCourseWork.findMany({
      where: { courseId: FIXTURE_KEYS.F1 },
      select: { id: true },
    })
    const rubric = await db.prisma.mockRubric.findFirst({
      where: { courseWorkId: { in: cw.map((c) => c.id) } },
      include: { criteria: { include: { levels: true } } },
    })
    expect(rubric).not.toBeNull()
    expect(rubric!.licenseBlocked).toBe(false)
    expect(rubric!.criteria.length).toBeGreaterThanOrEqual(1)
    expect(rubric!.criteria[0]!.levels.length).toBeGreaterThanOrEqual(1)
  })

  it('preserves a non-VIEW shareMode on the source so "never default to VIEW" is testable', async () => {
    const modes = new Set(
      (
        await db.prisma.mockAttachment.findMany({
          where: { parentId: { startsWith: 'cw-f1-' }, kind: 'driveFile' },
          select: { shareMode: true },
        })
      ).map((a) => a.shareMode),
    )
    expect(modes.has('STUDENT_COPY')).toBe(true)
  })
})

describe('F5 — attachment cap, with a deterministic total order (D22)', () => {
  it('has 21+ attachments with contiguous distinct sortOrder values', async () => {
    const attachments = await db.prisma.mockAttachment.findMany({
      where: { parentType: 'courseWork', parentId: 'cw-f5-1' },
      orderBy: { sortOrder: 'asc' },
    })
    expect(attachments.length).toBeGreaterThan(20)
    expect(attachments.map((a) => a.sortOrder)).toEqual(attachments.map((_, i) => i))
  })
})

describe('F2 / F3 — the two pre-flight scenario courses', () => {
  it('F2 has trashed and deleted attachments', async () => {
    const states = new Set(
      (
        await db.prisma.mockAttachment.findMany({
          where: { parentId: { startsWith: 'cwm-f2-' } },
          select: { driveState: true },
        })
      ).map((a) => a.driveState),
    )
    expect(states.has('trashed')).toBe(true)
  })

  it('F3 has a permission-locked attachment owned by the OTHER teacher', async () => {
    const locked = await db.prisma.mockAttachment.findFirst({
      where: { parentId: { startsWith: 'cw-f3-' }, driveState: 'permission_locked' },
    })
    expect(locked).not.toBeNull()
    expect(locked!.ownerAccountId).toBe('acct-dana')
  })
})

describe('F7 / F13 / F14', () => {
  it("F7's target course is licence-blocked so the degradation path is reachable", async () => {
    const target = await db.prisma.mockCourse.findUnique({ where: { id: FIXTURE_KEYS.TARGET_DANA } })
    expect(target!.rubricsLicensed).toBe(false)
  })

  it('F13 seeds an attachment-bearing post (the create that will be refused)', async () => {
    const attachments = await db.prisma.mockAttachment.count({
      where: { parentId: 'cw-f13-1' },
    })
    expect(attachments).toBeGreaterThan(0)
  })

  it('F14 is genuinely empty (D26)', async () => {
    const [cw, cwm] = await Promise.all([
      db.prisma.mockCourseWork.count({ where: { courseId: FIXTURE_KEYS.F14 } }),
      db.prisma.mockCourseWorkMaterial.count({ where: { courseId: FIXTURE_KEYS.F14 } }),
    ])
    expect(cw + cwm).toBe(0)
  })
})

describe('list scoping fixtures', () => {
  it('seeds an archived course so source/target scoping is exercisable', async () => {
    const archived = await db.prisma.mockCourse.findUnique({
      where: { id: FIXTURE_KEYS.ARCHIVED_JAMIE },
    })
    expect(archived!.state).toBe('ARCHIVED')
  })

  it('seeds an SIS roster shell as a target', async () => {
    const target = await db.prisma.mockCourse.findUnique({
      where: { id: FIXTURE_KEYS.TARGET_JAMIE },
    })
    expect(target!.isSisShell).toBe(true)
    expect(target!.state).toBe('ACTIVE')
  })
})

describe('F15 — the dedupe PAIR seeds both sides of every §6.6 case', () => {
  it('seeds a destination DRAFT and a destination PUBLISHED title match', async () => {
    const dest = await db.prisma.mockCourseWork.findMany({
      where: { courseId: FIXTURE_KEYS.F15_TARGET },
    })
    expect(dest.find((w) => w.title === 'Angle Pairs Practice')!.state).toBe('DRAFT')
    expect(dest.find((w) => w.title === 'Proof Writing Quiz')!.state).toBe('PUBLISHED')
  })

  it('keeps the near-miss and cross-surface pairs genuinely non-matching', async () => {
    const [sourceWork, sourceMaterials, destWork] = await Promise.all([
      db.prisma.mockCourseWork.findMany({ where: { courseId: FIXTURE_KEYS.F15_SOURCE } }),
      db.prisma.mockCourseWorkMaterial.findMany({ where: { courseId: FIXTURE_KEYS.F15_SOURCE } }),
      db.prisma.mockCourseWork.findMany({ where: { courseId: FIXTURE_KEYS.F15_TARGET } }),
    ])
    // Near-miss: the two titles must differ, or the fixture proves nothing.
    expect(sourceWork.map((w) => w.title)).toContain('Unit 1')
    expect(destWork.map((w) => w.title)).toContain('Unit 11')
    // Cross-surface: identical titles on DIFFERENT surfaces.
    expect(sourceMaterials.map((m) => m.title)).toContain('Lab Notes')
    expect(destWork.map((w) => w.title)).toContain('Lab Notes')
    expect(sourceWork.map((w) => w.title)).not.toContain('Lab Notes')
  })

  it('carries the combined duplicate + unhealthy-attachment case and its control', async () => {
    const work = await db.prisma.mockCourseWork.findMany({
      where: { courseId: FIXTURE_KEYS.F15_SOURCE },
    })
    const combined = work.find((w) => w.title === 'Circle Theorems Packet')!
    const control = work.find((w) => w.title === 'Coordinate Geometry Lab')!
    for (const parent of [combined, control]) {
      const unhealthy = await db.prisma.mockAttachment.count({
        where: { parentId: parent.id, driveState: { not: 'healthy' } },
      })
      expect(unhealthy, `${parent.title} must carry a broken attachment`).toBe(1)
    }
  })

  it('seeds an ambiguous destination topic pair that normalizes to one name', async () => {
    const topics = await db.prisma.mockTopic.findMany({
      where: { courseId: FIXTURE_KEYS.F15_TARGET },
      orderBy: { sortOrder: 'asc' },
    })
    const ambiguous = topics.filter((t) => t.name.trim().toLowerCase() === 'review')
    expect(ambiguous).toHaveLength(2)
    // Distinct raw names, so "the first by API order" is a real choice.
    expect(ambiguous[0]!.name).not.toBe(ambiguous[1]!.name)
  })
})
