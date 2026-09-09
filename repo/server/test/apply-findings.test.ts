/**
 * Cycle-2 code-review findings that needed a gate of their own.
 *
 * Each block below names the finding it closes and, more importantly, the input
 * that makes it fail. The recurring failure mode this whole cycle is about is a
 * gate that cannot go red, so every case here was checked against the
 * pre-fix code first.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  OVERFLOW_LINKS_HEADER,
  rateLimitExhaustionNote,
  rubricDegradedNote,
  shareModeUnknownNote,
} from '@classroom-copier/shared'
import { FIXTURE_KEYS } from '../src/fixtures/index.js'
import { pruneGeneratedFixtureRows, seedFixtures } from '../src/fixtures/seed.js'
import { MAX_ATTEMPTS } from '../src/services/backoff.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { runTransfer } from './helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

/* ================================================================== *
 * APPLY-A — "never default to VIEW"
 * ================================================================== */

describe('APPLY-A — a Drive attachment with no readable shareMode is a finding, never a VIEW', () => {
  const UNKNOWN_TITLE = 'Handout with an unreadable sharing setting.docx'

  it('does not write VIEW, does not link the file, and names it in the note', async () => {
    // Latent today because all ten seeded driveFile fixtures set shareMode. A
    // real Drive file with an unset one reaches `?? 'VIEW'` immediately — and
    // the brief's binding requirement is "preserve each attachment's shareMode
    // … NEVER default to VIEW".
    await db.prisma.mockAttachment.create({
      data: {
        id: 'att-f1-nullsharemode',
        parentType: 'courseWork',
        parentId: 'cw-f1-1',
        kind: 'driveFile',
        driveFileId: 'drive-unknown-sharemode',
        title: UNKNOWN_TITLE,
        shareMode: null,
        driveState: 'healthy',
        ownerAccountId: 'acct-jamie',
        sortOrder: 50,
      },
    })

    const { jobId } = await runTransfer(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })

    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, sourceId: 'cw-f1-1' },
    })
    expect(item.targetPostId).not.toBeNull()

    const written = await db.prisma.mockAttachment.findMany({
      where: { parentId: item.targetPostId! },
    })
    // The forbidden substitution, in the only form it could take.
    const substituted = written.find((a) => a.driveFileId === 'drive-unknown-sharemode')
    expect(substituted, 'the file was linked despite an unreadable shareMode').toBeUndefined()
    expect(written.every((a) => a.shareMode !== 'VIEW' || a.title !== UNKNOWN_TITLE)).toBe(true)

    // And the teacher is told, by name, rather than silently getting a guess.
    expect(item.note ?? '').toContain(shareModeUnknownNote(UNKNOWN_TITLE))
  })
})

/* ================================================================== *
 * APPLY-B — nothing outside the adapter touches the mock's tables
 * ================================================================== */

describe('APPLY-B — the type-only port is not bypassed', () => {
  it('no module outside adapters/mock or fixtures reads the mock Classroom tables', () => {
    // The port emitting no JS was this run's chief structural device, and three
    // modules reached around it into `prisma.mock*`. The worst of them was
    // `refreshAttachments`: when a real adapter ships, that query hits a table
    // that no longer exists and EVERY post is created with zero attachments.
    const srcDir = path.resolve(fileURLToPath(new URL('../src', import.meta.url)))
    const allowedPrefixes = [
      path.join(srcDir, 'adapters', 'mock'),
      path.join(srcDir, 'fixtures'),
    ]
    // MockAccount is the identity table behind sessions, not a Classroom
    // resource — the port has no method for it and never should.
    const forbidden =
      /prisma\.(mockCourse|mockCourseWork|mockCourseWorkMaterial|mockAttachment|mockTopic|mockRubric)/

    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
        if (allowedPrefixes.some((prefix) => full.startsWith(prefix))) continue
        const text = fs.readFileSync(full, 'utf8')
        for (const [index, line] of text.split('\n').entries()) {
          // Comments naming the tables are how the fix is EXPLAINED; a real
          // bypass is never on a comment line.
          const trimmed = line.trim()
          if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
            continue
          }
          if (forbidden.test(line)) offenders.push(`${path.relative(srcDir, full)}:${index + 1}`)
        }
      }
    }
    walk(srcDir)

    expect(offenders, `these modules bypass the ClassroomProvider port: ${offenders.join(', ')}`)
      .toEqual([])
  })
})

/* ================================================================== *
 * APPLY-F — the bare shell keeps what it dropped
 * ================================================================== */

describe('APPLY-F — the rate-limit shell carries the notes and the overflow links', () => {
  it('appends the 21+ overflow URLs to the shell rather than discarding them', async () => {
    // 25 attachments on the post the mock refuses. The shell used to be composed
    // as `{ overflow: [], notes: [exhaustionNote] }`, so it told the teacher to
    // "re-attach any files" without naming one, and the 21+-as-description-URLs
    // guarantee was silently void on this path.
    for (let i = 0; i < 25; i += 1) {
      await db.prisma.mockAttachment.create({
        data: {
          id: `att-f13-overflow-${i}`,
          parentType: 'courseWork',
          parentId: 'cw-f13-1',
          kind: 'link',
          url: `https://overflow.mock/${i}`,
          title: `Overflow resource ${i}`,
          driveState: 'healthy',
          sortOrder: 10 + i,
        },
      })
    }

    const { jobId } = await runTransfer(db.prisma, {
      accountId: 'acct-dana',
      sourceCourseId: FIXTURE_KEYS.F13,
      targetCourseId: FIXTURE_KEYS.TARGET_DANA,
    })
    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, sourceId: 'cw-f13-1' },
    })
    expect(item.outcome).toBe('fallback_shell')

    const shell = await db.prisma.mockCourseWork.findUniqueOrThrow({
      where: { id: item.targetPostId! },
    })
    expect(shell.description).toContain(rateLimitExhaustionNote(MAX_ATTEMPTS))
    expect(shell.description, 'the shell discarded the overflow link list').toContain(
      OVERFLOW_LINKS_HEADER,
    )
    expect(shell.description).toContain('https://overflow.mock/24')
  })
})

/* ================================================================== *
 * QA-2 — fallback_shell AND rubricDegraded on the same item
 * ================================================================== */

describe('QA-2 — the combined outcome, which was correct by construction and untested', () => {
  it('counts a rubric-degraded fallback shell ONCE, in fallback_shell', async () => {
    // `05-implementation.md` described this combination as unit-covered. Every
    // existing rubricDegraded test used outcome 'transferred'; the two-column
    // combination had zero coverage.
    await db.prisma.mockRubric.create({
      data: { id: 'rubric-cw-f13-1', courseWorkId: 'cw-f13-1', licenseBlocked: false },
    })
    await db.prisma.mockRubricCriterion.create({
      data: { id: 'rubric-cw-f13-1-c0', rubricId: 'rubric-cw-f13-1', title: 'Clarity', sortOrder: 0 },
    })
    await db.prisma.mockRubricLevel.create({
      data: {
        id: 'rubric-cw-f13-1-c0-l0',
        criterionId: 'rubric-cw-f13-1-c0',
        title: 'Excellent',
        points: 4,
        sortOrder: 0,
      },
    })
    // The target course's licence blocks rubrics, so createRubric denies.
    await db.prisma.mockCourse.update({
      where: { id: FIXTURE_KEYS.TARGET_DANA },
      data: { rubricsLicensed: false },
    })

    const { jobId } = await runTransfer(db.prisma, {
      accountId: 'acct-dana',
      sourceCourseId: FIXTURE_KEYS.F13,
      targetCourseId: FIXTURE_KEYS.TARGET_DANA,
    })
    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, sourceId: 'cw-f13-1' },
    })

    expect(item.outcome).toBe('fallback_shell')
    expect(item.rubricDegraded).toBe(true)

    // The two are orthogonal columns: `rubricNotesAdded` is a non-additive
    // subset tag, so the three-term sum must not double-count this post.
    const counts = await db.prisma.transferJobItem.findMany({ where: { jobId } })
    const transferred = counts.filter((i) => i.outcome === 'transferred').length
    const fallback = counts.filter((i) => i.outcome === 'fallback_shell').length
    const skipped = counts.filter((i) => i.outcome === 'skipped').length
    expect(transferred + fallback + skipped).toBe(counts.length)

    const shell = await db.prisma.mockCourseWork.findUniqueOrThrow({
      where: { id: item.targetPostId! },
    })
    expect(shell.description).toContain(rubricDegradedNote())
  })
})

/* ================================================================== *
 * APPLY-L — the seed has an inverse
 * ================================================================== */

describe('APPLY-L — generated rows can be pruned, and the fixture world survives it', () => {
  it('removes what transfers created and leaves the manifest intact', async () => {
    await runTransfer(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const generatedBefore = await db.prisma.mockCourseWork.count({
      where: { courseId: FIXTURE_KEYS.TARGET_JAMIE },
    })
    expect(generatedBefore).toBeGreaterThan(0)

    const fixtureBefore = await db.prisma.mockCourseWork.count({
      where: { courseId: FIXTURE_KEYS.F1 },
    })

    const pruned = await pruneGeneratedFixtureRows(db.prisma)
    expect(pruned.courseWork + pruned.courseWorkMaterials).toBeGreaterThan(0)

    expect(
      await db.prisma.mockCourseWork.count({ where: { courseId: FIXTURE_KEYS.TARGET_JAMIE } }),
    ).toBe(0)
    expect(await db.prisma.mockCourseWork.count({ where: { courseId: FIXTURE_KEYS.F1 } })).toBe(
      fixtureBefore,
    )
    // The source course's attachments are untouched by the prune, too.
    expect(
      await db.prisma.mockAttachment.count({
        where: { parentType: 'courseWork', parentId: 'cw-f1-1' },
      }),
    ).toBeGreaterThan(0)

    // And re-seeding after a prune is still a no-op for the manifest.
    await seedFixtures(db.prisma)
    expect(await db.prisma.mockCourseWork.count({ where: { courseId: FIXTURE_KEYS.F1 } })).toBe(
      fixtureBefore,
    )
  })
})
