/**
 * Cycle-2 DEFER 1 — `MockClassroomProvider`'s rate-limit attempt counter used
 * to live in an instance-local `Map`. Correct for one provider instance, but a
 * provider REBUILT mid-run (a fresh `new MockClassroomProvider(...)` over the
 * SAME database — a process restart, or a second request that constructs its
 * own provider via `buildApp`) silently reset the counter to zero, and F6's
 * "429 once then succeed" rule re-issued a 429 the caller had already paid
 * for.
 *
 * These tests drive that scenario across TWO separate `MockClassroomProvider`
 * instances sharing one `PrismaClient`/database, which an in-memory Map
 * cannot pass and a persisted counter can.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockClassroomProvider } from '../src/adapters/mock/mock-classroom-provider.js'
import { RateLimitError } from '../src/adapters/types.js'
import { F6_TRANSIENT_429_TITLE, FIXTURE_KEYS } from '../src/fixtures/index.js'
import { ALL_COURSE_WORK_STATES } from '../src/services/post-enumerator.js'
import { createTestDb, type TestDb } from './helpers/db.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

/** F6's rule is keyed `${title}:${mode}` inside the provider — asserted here
 *  as a white-box check on the persisted row, not part of the public port. */
const F6_KEY = `${F6_TRANSIENT_429_TITLE}:transient`

async function createF6Post(provider: MockClassroomProvider) {
  return provider.createCourseWork(FIXTURE_KEYS.TARGET_DANA, {
    title: F6_TRANSIENT_429_TITLE,
    workType: 'ASSIGNMENT',
    state: 'DRAFT',
    materials: [],
    assigneeMode: 'ALL_STUDENTS',
  })
}

describe('mock rate-limit attempt state survives a rebuilt provider', () => {
  it('provider A takes the one guaranteed failure; provider B (rebuilt, same DB) continues from there and succeeds', async () => {
    const providerA = new MockClassroomProvider(db.prisma)
    await providerA.listCourseWork(FIXTURE_KEYS.F6, { courseWorkStates: ALL_COURSE_WORK_STATES })

    await expect(createF6Post(providerA)).rejects.toBeInstanceOf(RateLimitError)

    const afterA = await db.prisma.mockRateLimitAttempt.findUnique({ where: { key: F6_KEY } })
    expect(afterA?.attemptCount).toBe(1)

    // A brand-new instance — e.g. the process restarted between the pause and
    // the retry, or a second request built its own provider. `enumeratedCourses`
    // legitimately starts empty per-instance (APPLY-G), so it re-reads the
    // source course exactly as a fresh run would.
    const providerB = new MockClassroomProvider(db.prisma)
    await providerB.listCourseWork(FIXTURE_KEYS.F6, { courseWorkStates: ALL_COURSE_WORK_STATES })

    // The regression this closes: with an in-memory Map, providerB's counter
    // restarts at 0 and 429s AGAIN — a second failure the caller already paid
    // for under providerA. With the persisted count, providerB sees the
    // already-spent failure and succeeds on its very first call.
    const result = await createF6Post(providerB)
    expect(result.id).toBeTruthy()

    // Unchanged by the success — attempts only accrue on failure — so it still
    // reads exactly what providerA left behind.
    const afterB = await db.prisma.mockRateLimitAttempt.findUnique({ where: { key: F6_KEY } })
    expect(afterB?.attemptCount).toBe(1)
  })

  it('the persisted counter accumulates across rebuilt instances rather than resetting — provider A at 2, provider B continues from 2 (not 0)', async () => {
    // Mechanism-level check on the exact row `enforceRateLimit` reads and
    // writes: seed it as if two prior failures were already recorded (the
    // shape a rule with failures >= 2 would leave), then prove a FRESHLY
    // constructed provider's read reflects that accumulated state rather than
    // starting over at 0.
    await db.prisma.mockRateLimitAttempt.create({ data: { key: F6_KEY, attemptCount: 2 } })

    const providerB = new MockClassroomProvider(db.prisma)
    await providerB.listCourseWork(FIXTURE_KEYS.F6, { courseWorkStates: ALL_COURSE_WORK_STATES })

    // F6's rule requires `seen < failures` (1) to fail; a fresh in-memory Map
    // would read `seen = 0` here and 429 again. Reading the persisted 2 (>= 1)
    // means it succeeds immediately — proof the read came from the shared row.
    const result = await createF6Post(providerB)
    expect(result.id).toBeTruthy()

    const row = await db.prisma.mockRateLimitAttempt.findUnique({ where: { key: F6_KEY } })
    expect(row?.attemptCount).toBe(2)
  })
})
