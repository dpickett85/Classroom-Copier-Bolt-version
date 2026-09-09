import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { seedFixtures } from '../../src/fixtures/seed.js'

const SERVER_DIR = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const DATA_DIR = path.join(SERVER_DIR, 'prisma', 'data')
const TEMPLATE = path.join(DATA_DIR, 'test-template.db')

export interface TestDb {
  prisma: PrismaClient
  file: string
  dispose(): Promise<void>
}

/** A fresh, schema-only database for one test file. */
export async function createTestDb(options: { seed?: boolean } = {}): Promise<TestDb> {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const file = path.join(DATA_DIR, `test-${crypto.randomUUID()}.db`)
  fs.copyFileSync(TEMPLATE, file)
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${file}` } } })
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000;')
  if (options.seed !== false) await seedFixtures(prisma)
  return {
    prisma,
    file,
    async dispose() {
      await prisma.$disconnect()
      for (const suffix of ['', '-wal', '-shm']) {
        fs.rmSync(file + suffix, { force: true })
      }
    },
  }
}
