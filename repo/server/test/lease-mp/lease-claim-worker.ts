/**
 * Two-process lease harness — the WORKER.
 *
 * A standalone script, run as its OWN Node process via `tsx`, NOT a vitest
 * test file (it lives outside every `include` glob in both vitest configs).
 * It opens its OWN `PrismaClient` against a SQLite file handed to it on argv —
 * a second, independent connection to the same database the parent test's
 * `PrismaClient` also holds open — busy-waits until a shared start time, then
 * fires EXACTLY the conditional `updateMany` `TransferEngine.execute()` uses
 * to take the executor lease (`src/services/transfer-engine.ts`). Two of
 * these, racing the same job row, is the real two-OS-process version of the
 * race `executor-lease.budget.test.ts` proves with a synchronous mock.
 *
 * Prints one JSON line to stdout: `{ "label": string, "count": 0 | 1 }`.
 */
import { PrismaClient } from '@prisma/client'

const [, , dbFile, jobId, startAtMs, label] = process.argv

if (!dbFile || !jobId || !startAtMs || !label) {
  process.stderr.write('usage: lease-claim-worker.ts <dbFile> <jobId> <startAtMs> <label>\n')
  process.exit(2)
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } })
  // Same pragmas the test harness's own connection sets (test/helpers/db.ts) —
  // WAL lets the two connections coexist; the busy timeout absorbs the brief
  // lock contention SQLite's single writer produces when both processes land
  // on the database in the same few milliseconds.
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000;')

  // Busy-wait to the shared start instant rather than `setTimeout`, whose
  // granularity and event-loop queueing would smear the two processes' actual
  // attempts apart by more than the race is supposed to test.
  const target = Number(startAtMs)
  while (Date.now() < target) {
    /* spin */
  }

  // EXACTLY TransferEngine.execute()'s claim (src/services/transfer-engine.ts).
  const claimed = await prisma.transferJob.updateMany({
    where: { id: jobId, status: { in: ['queued', 'running'] }, executorId: null },
    data: {
      status: 'running',
      executorId: `exec-${label}`,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
    },
  })

  process.stdout.write(`${JSON.stringify({ label, count: claimed.count })}\n`)
  await prisma.$disconnect()
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`worker ${label} failed: ${error instanceof Error ? error.stack : String(error)}\n`)
    process.exit(1)
  })
