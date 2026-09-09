/** CLI entry point for the idempotent fixture seed (`npm run -w server seed`). */
import { PrismaClient } from '@prisma/client'
import { seedFixtures } from '../src/fixtures/seed.js'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  await seedFixtures(prisma)
  const [accounts, courses, courseWork, materials, attachments] = await Promise.all([
    prisma.mockAccount.count(),
    prisma.mockCourse.count(),
    prisma.mockCourseWork.count(),
    prisma.mockCourseWorkMaterial.count(),
    prisma.mockAttachment.count(),
  ])
  console.log(
    `[seed] accounts=${accounts} courses=${courses} courseWork=${courseWork} materials=${materials} attachments=${attachments}`,
  )
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed', error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
