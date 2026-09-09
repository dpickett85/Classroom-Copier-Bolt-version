/**
 * Quality budget: `preflight_destination_scan_call_cost` (owner:
 * duplicate-topic-preflight, §8.1).
 *
 * Target: the destination reads behind `POST /courses/:id/preflight` are
 * PAGINATED ONLY — no per-item round trips — with the call count bounded by
 * ceil(destinationItemCount / pageSize) per surface.
 *
 * The failure this guards is the obvious implementation of duplicate detection:
 * for each source item, ask the destination whether an item with that title
 * exists. That is correct and it is an N+1 that turns a 50-post re-run into 50
 * extra API calls against a quota the teacher shares with their whole district.
 *
 * Measured on the PROVIDER CALL LOG, not on the response: a scan that made the
 * per-item calls and then discarded them would return an identical response.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockClassroomProvider } from '../../src/adapters/mock/mock-classroom-provider.js'
import type { ClassroomProvider } from '../../src/adapters/classroom-provider.interface.js'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { PreflightEngine } from '../../src/services/preflight-engine.js'
import { createTestDb, type TestDb } from '../helpers/db.js'

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

interface Counted {
  provider: ClassroomProvider
  calls: Record<string, number>
}

function counting(inner: ClassroomProvider): Counted {
  const calls: Record<string, number> = {
    listCourseWork: 0,
    listCourseWorkMaterials: 0,
    listTopics: 0,
    getAttachmentHealth: 0,
  }
  const provider = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown
      if (typeof value !== 'function' || typeof prop !== 'string') return value
      return (...args: unknown[]) => {
        if (prop in calls) calls[prop] = (calls[prop] ?? 0) + 1
        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  }) as ClassroomProvider
  return { provider, calls }
}

describe('[budget] preflight_destination_scan_call_cost', () => {
  it('reads each destination surface once per page, never once per source item', async () => {
    const { provider, calls } = counting(new MockClassroomProvider(db.prisma))
    const engine = new PreflightEngine(db.prisma, provider)

    const result = await engine.run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F15_SOURCE,
      targetCourseId: FIXTURE_KEYS.F15_TARGET,
    })

    console.log(
      `[budget] preflight scan cost: sourcePosts=${result.totalPostsScanned} ` +
        `listCourseWork=${calls.listCourseWork} ` +
        `listCourseWorkMaterials=${calls.listCourseWorkMaterials} ` +
        `listTopics=${calls.listTopics} getAttachmentHealth=${calls.getAttachmentHealth}`,
    )

    // One drain of each surface for the SOURCE and one for the DESTINATION,
    // each a single page at the mock's 200-item default: 2 calls, not 2 + N.
    expect(calls.listCourseWork).toBe(2)
    expect(calls.listCourseWorkMaterials).toBe(2)
    // Source topics (for topicName) + destination topics (for reuse).
    expect(calls.listTopics).toBe(2)
    // Still ONE batched health call, per D20 — the dedupe pass must not have
    // split it back into per-item lookups.
    expect(calls.getAttachmentHealth).toBe(1)

    // The bound, stated as the architecture states it.
    expect(calls.listCourseWork).toBeLessThanOrEqual(2 * Math.ceil(result.totalPostsScanned / 200))
  })

  it('scales by PAGE, not by item — a forced 2-item page size on a 50-post course', async () => {
    const { provider, calls } = counting(
      new MockClassroomProvider(db.prisma, { forcePageSize: 2 }),
    )
    const engine = new PreflightEngine(db.prisma, provider)

    // F4 as the source (50 posts) into the F15 destination (6 coursework rows,
    // 0 materials, 5 topics) — so the destination cost is measurable separately
    // from the source's.
    await engine.run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F4,
      targetCourseId: FIXTURE_KEYS.F15_TARGET,
    })

    console.log(
      `[budget] preflight scan cost @ pageSize=2: listCourseWork=${calls.listCourseWork} ` +
        `listCourseWorkMaterials=${calls.listCourseWorkMaterials} listTopics=${calls.listTopics}`,
    )

    // Source: 40 coursework rows -> 20 pages. Destination: 6 rows -> 3 pages.
    expect(calls.listCourseWork).toBe(23)
    // Source: 10 materials -> 5 pages. Destination: 0 rows -> 1 page.
    expect(calls.listCourseWorkMaterials).toBe(6)
    // Source: 2 topics -> 1 page. Destination: 5 topics -> 3 pages.
    expect(calls.listTopics).toBe(4)
    expect(calls.getAttachmentHealth).toBe(1)
  })
})
