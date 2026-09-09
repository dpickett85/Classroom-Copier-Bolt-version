/**
 * The Prisma client singleton. WAL is enabled explicitly: SQLite is
 * single-writer and the per-item checkpoint plus a 1.5s poll means the write
 * lock is contended lightly and constantly.
 */
import { PrismaClient } from '@prisma/client'

declare global {
  var __classroomCopierPrisma: PrismaClient | undefined
}

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  const client = new PrismaClient(
    databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined,
  )
  return client
}

export const prisma: PrismaClient =
  globalThis.__classroomCopierPrisma ?? (globalThis.__classroomCopierPrisma = createPrismaClient())

export async function enableWal(client: PrismaClient = prisma): Promise<void> {
  try {
    await client.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
    await client.$queryRawUnsafe('PRAGMA busy_timeout=5000;')
  } catch {
    // A non-SQLite datasource (or an in-memory test DB) simply skips this.
  }
}

export type Db = PrismaClient
