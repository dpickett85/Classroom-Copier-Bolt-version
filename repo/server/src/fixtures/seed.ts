/**
 * Idempotent fixture seeding (D3).
 *
 * Every seeded row is upserted by its stable id, so running this twice produces
 * identical row counts and running it on every boot self-heals a wiped disk to
 * a known-good F1–F15 state.
 *
 * What it does NOT restore is job state (TransferJob / TransferJobItem /
 * PreflightScan). See Δ1: if the deployed filesystem turns out to be ephemeral,
 * the fixture world comes back and the ledger does not — and boot
 * reconciliation would have nothing to reconcile.
 */
import type { PrismaClient } from '@prisma/client'
import { SEED_ACCOUNTS, SEED_COURSES } from './index.js'
import type { SeedAttachment, SeedCourse, SeedRubricCriterion } from './index.js'

async function upsertAttachments(
  prisma: PrismaClient,
  parentType: 'courseWork' | 'courseWorkMaterial',
  parentId: string,
  attachments: Omit<SeedAttachment, 'parentType' | 'parentId'>[] | undefined,
): Promise<void> {
  for (const a of attachments ?? []) {
    const data = {
      parentType,
      parentId,
      kind: a.kind,
      driveFileId: a.driveFileId ?? null,
      url: a.url ?? null,
      title: a.title,
      shareMode: a.shareMode ?? null,
      driveState: a.driveState ?? 'healthy',
      ownerAccountId: a.ownerAccountId ?? null,
      sortOrder: a.sortOrder,
    }
    await prisma.mockAttachment.upsert({
      where: { id: a.id },
      create: { id: a.id, ...data },
      update: data,
    })
  }
}

async function upsertRubric(
  prisma: PrismaClient,
  courseWorkId: string,
  criteria: SeedRubricCriterion[],
  licenseBlocked: boolean,
): Promise<void> {
  const rubricId = `rubric-${courseWorkId}`
  await prisma.mockRubric.upsert({
    where: { id: rubricId },
    create: { id: rubricId, courseWorkId, licenseBlocked },
    update: { licenseBlocked },
  })
  for (const [ci, criterion] of criteria.entries()) {
    const criterionId = `${rubricId}-c${ci}`
    await prisma.mockRubricCriterion.upsert({
      where: { id: criterionId },
      create: {
        id: criterionId,
        rubricId,
        title: criterion.title,
        description: criterion.description ?? null,
        sortOrder: criterion.sortOrder,
      },
      update: {
        title: criterion.title,
        description: criterion.description ?? null,
        sortOrder: criterion.sortOrder,
      },
    })
    for (const [li, level] of criterion.levels.entries()) {
      const levelId = `${criterionId}-l${li}`
      await prisma.mockRubricLevel.upsert({
        where: { id: levelId },
        create: {
          id: levelId,
          criterionId,
          title: level.title,
          description: level.description ?? null,
          points: level.points,
          sortOrder: level.sortOrder,
        },
        update: {
          title: level.title,
          description: level.description ?? null,
          points: level.points,
          sortOrder: level.sortOrder,
        },
      })
    }
  }
}

async function seedCourse(prisma: PrismaClient, course: SeedCourse): Promise<void> {
  const courseData = {
    ownerAccountId: course.ownerAccountId,
    name: course.name,
    section: course.section ?? null,
    state: course.state,
    isSisShell: course.isSisShell ?? false,
    rubricsLicensed: course.rubricsLicensed ?? true,
    fixtureKey: course.fixtureKey,
  }
  await prisma.mockCourse.upsert({
    where: { id: course.id },
    create: { id: course.id, ...courseData },
    update: courseData,
  })

  for (const topic of course.topics ?? []) {
    await prisma.mockTopic.upsert({
      where: { id: topic.id },
      create: { id: topic.id, courseId: course.id, name: topic.name, sortOrder: topic.sortOrder },
      update: { name: topic.name, sortOrder: topic.sortOrder },
    })
  }

  for (const cw of course.courseWork ?? []) {
    const data = {
      courseId: course.id,
      title: cw.title,
      description: cw.description ?? null,
      workType: cw.workType,
      state: cw.state,
      dueDate: cw.dueDate ? new Date(cw.dueDate) : null,
      scheduledTime: cw.scheduledTime ? new Date(cw.scheduledTime) : null,
      maxPoints: cw.maxPoints ?? null,
      answerConfig: cw.answerConfig ? JSON.stringify(cw.answerConfig) : null,
      quizFormLink: cw.quizFormLink ?? null,
      topicId: cw.topicId ?? null,
      creationTime: new Date(cw.creationTime),
      createdOrder: cw.createdOrder,
    }
    await prisma.mockCourseWork.upsert({
      where: { id: cw.id },
      create: { id: cw.id, ...data },
      update: data,
    })
    await upsertAttachments(prisma, 'courseWork', cw.id, cw.attachments)
    if (cw.rubric) {
      await upsertRubric(prisma, cw.id, cw.rubric, course.rubricsLicensed === false)
    }
  }

  for (const cwm of course.courseWorkMaterials ?? []) {
    const data = {
      courseId: course.id,
      title: cwm.title,
      description: cwm.description ?? null,
      state: cwm.state,
      topicId: cwm.topicId ?? null,
      creationTime: new Date(cwm.creationTime),
      createdOrder: cwm.createdOrder,
    }
    await prisma.mockCourseWorkMaterial.upsert({
      where: { id: cwm.id },
      create: { id: cwm.id, ...data },
      update: data,
    })
    await upsertAttachments(prisma, 'courseWorkMaterial', cwm.id, cwm.attachments)
  }
}

/**
 * APPLY-L — the explicit reset path for rows a TRANSFER created.
 *
 * `seedFixtures` is idempotent for the fixture rows and has no opinion at all
 * about the posts a run writes into a target course, so those accumulated
 * forever across boots. That accumulation was the second of P0-4's three
 * false-positive paths: on the second run of the same transfer the target
 * already contained a post with every source title, so every interrupted item
 * verified as "transferred" unconditionally. The evidence check is now
 * job-owned and no longer depends on a clean target — but a demo world that
 * grows without bound is still wrong, and a seed with no inverse is a seed
 * whose "idempotent" claim only covers half the table.
 *
 * Deletes exactly what the manifest does not name, inside seeded courses.
 */
export async function pruneGeneratedFixtureRows(prisma: PrismaClient): Promise<{
  courseWork: number
  courseWorkMaterials: number
  topics: number
  attachments: number
}> {
  // Kept as a literal rather than imported from the provider so the seed has no
  // edge into the adapter. See MockAttachment.parentType in schema.prisma.
  const MY_DRIVE_PARENT_TYPE = 'myDrive'

  const courseIds = SEED_COURSES.map((c) => c.id)
  const manifestWorkIds = SEED_COURSES.flatMap((c) => (c.courseWork ?? []).map((cw) => cw.id))
  const manifestMaterialIds = SEED_COURSES.flatMap((c) =>
    (c.courseWorkMaterials ?? []).map((m) => m.id),
  )
  const manifestTopicIds = SEED_COURSES.flatMap((c) => (c.topics ?? []).map((t) => t.id))

  const [staleWork, staleMaterials] = await Promise.all([
    prisma.mockCourseWork.findMany({
      where: { courseId: { in: courseIds }, id: { notIn: manifestWorkIds } },
      select: { id: true },
    }),
    prisma.mockCourseWorkMaterial.findMany({
      where: { courseId: { in: courseIds }, id: { notIn: manifestMaterialIds } },
      select: { id: true },
    }),
  ])
  const staleParentIds = [...staleWork.map((r) => r.id), ...staleMaterials.map((r) => r.id)]

  // MockAttachment's parent is polymorphic, so there is no FK cascade to lean on.
  const attachments = await prisma.mockAttachment.deleteMany({
    where: {
      OR: [{ parentId: { in: staleParentIds } }, { parentType: MY_DRIVE_PARENT_TYPE }],
    },
  })
  const courseWork = await prisma.mockCourseWork.deleteMany({
    where: { id: { in: staleWork.map((r) => r.id) } },
  })
  const courseWorkMaterials = await prisma.mockCourseWorkMaterial.deleteMany({
    where: { id: { in: staleMaterials.map((r) => r.id) } },
  })
  const topics = await prisma.mockTopic.deleteMany({
    where: { courseId: { in: courseIds }, id: { notIn: manifestTopicIds } },
  })

  return {
    courseWork: courseWork.count,
    courseWorkMaterials: courseWorkMaterials.count,
    topics: topics.count,
    attachments: attachments.count,
  }
}

export async function seedFixtures(prisma: PrismaClient): Promise<void> {
  for (const account of SEED_ACCOUNTS) {
    await prisma.mockAccount.upsert({
      where: { id: account.id },
      create: account,
      update: {
        displayName: account.displayName,
        email: account.email,
        initials: account.initials,
      },
    })
  }
  for (const course of SEED_COURSES) {
    await seedCourse(prisma, course)
  }
}
