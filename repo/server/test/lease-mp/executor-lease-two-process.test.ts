/**
 * Two-process lease harness (item 4 of the server-polish backlog).
 *
 * `executor-lease.budget.test.ts` proves the lease's mutual exclusion with a
 * SYNCHRONOUSLY-INJECTED race inside one process (a `vi.spyOn` interleaving an
 * executor and a reconciler call on one shared `PrismaClient`). That is a real
 * proof of the SQL, but it is not a proof that the claim survives two
 * completely independent OS processes — two separate `PrismaClient`
 * connections, two separate Node event loops, no shared JS heap — landing on
 * the SAME SQLite file at (as close as two processes can get to) the same
 * instant. This file is that proof.
 *
 * It found a real gap: `TransferEngine.execute()`'s original claim —
 * `where: { id, status: { in: ['queued', 'running'] } }` — does not exclude a
 * second concurrent claim, because 'running' (the state the FIRST claim just
 * wrote) is itself in the allowed set. Two real processes racing it both got
 * `count: 1`, the second silently overwriting the first's `executorId`. Fixed
 * in `transfer-engine.ts` by adding `executorId: null` to the predicate — see
 * the comment there.
 *
 * The worker (`lease-claim-worker.ts`) intentionally DUPLICATES that claim's
 * SQL rather than importing `TransferEngine.execute()` (a private method that
 * would drag in the whole run: topic creation, enumeration, item hydration —
 * far more than this harness needs to isolate). Keep the two in sync by hand;
 * a red run here that surprises you is the signal they have drifted.
 *
 * NOT part of `npm test` (excluded in `vitest.config.ts`; included only by
 * `vitest.lease-mp.config.ts`, run via `npm run -w server test:lease-mp`).
 * Two-real-process timing is inherently less deterministic than a single-
 * process mock: process boot time, OS scheduling, and SQLite's busy-timeout
 * all add variance the default suite should never carry.
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { scanAndCreateJob } from '../helpers/transfer.js'

const TEST_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)))
const SERVER_DIR = path.resolve(TEST_DIR, '..', '..')
const REPO_ROOT = path.resolve(SERVER_DIR, '..')
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const WORKER = path.join(TEST_DIR, 'lease-claim-worker.ts')

interface WorkerResult {
  label: string
  count: number
}

/** Spawns the worker as a REAL child process (not a Promise, not a Worker
 *  thread — `child_process.spawn`, its own PID, its own V8 instance). */
function spawnWorker(dbFile: string, jobId: string, startAtMs: number, label: string) {
  return new Promise<WorkerResult>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [TSX_CLI, WORKER, dbFile, jobId, String(startAtMs), label],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`worker ${label} exited ${code}\nstderr: ${stderr}\nstdout: ${stdout}`))
        return
      }
      const line = stdout.trim().split('\n').pop()
      if (!line) {
        reject(new Error(`worker ${label} produced no output\nstderr: ${stderr}`))
        return
      }
      resolve(JSON.parse(line) as WorkerResult)
    })
  })
}

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

describe('[lease-mp] two real OS processes racing the executor lease claim', () => {
  it('exactly one process claims the job; the loser sees 0 rows', async () => {
    const { jobId } = await scanAndCreateJob(db.prisma, {
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })

    const before = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(before.status).toBe('queued')
    expect(before.executorId).toBeNull()

    // Both workers spin-wait to this SAME instant before firing their claim —
    // as close to simultaneous as two independent processes get.
    const startAtMs = Date.now() + 500

    const [a, b] = await Promise.all([
      spawnWorker(db.file, jobId, startAtMs, 'A'),
      spawnWorker(db.file, jobId, startAtMs, 'B'),
    ])

    const counts = [a.count, b.count].sort((x, y) => x - y)
    expect(counts, `A=${JSON.stringify(a)} B=${JSON.stringify(b)}`).toEqual([0, 1])

    const winner = a.count === 1 ? a : b
    const loser = a.count === 1 ? b : a
    expect(loser.count).toBe(0)

    const after = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(after.status).toBe('running')
    expect(after.executorId).toBe(`exec-${winner.label}`)
  })
})
