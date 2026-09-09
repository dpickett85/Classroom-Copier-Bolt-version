import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MockClassroomProvider } from '../adapters/mock/mock-classroom-provider.js'
import { FIXTURE_KEYS } from '../fixtures/index.js'
import { createTestDb, type TestDb } from '../../test/helpers/db.js'
import { ALL_COURSE_WORK_STATES, enumeratePosts, orderingKey } from './post-enumerator.js'

let db: TestDb
beforeAll(async () => {
  db = await createTestDb()
})
afterAll(async () => {
  await db.dispose()
})

describe('post-enumerator (D16) — the single owner of "all posts"', () => {
  it('D27 — pages F4 at pageSize=7 and still returns exactly 50 posts', async () => {
    // The architecture names this the one silent drop the item-level invariant
    // cannot detect after the fact: a post never scanned never gets a row. It
    // had no acceptance gate before this test.
    const provider = new MockClassroomProvider(db.prisma, { forcePageSize: 7 })
    const spy = vi.spyOn(provider, 'listCourseWork')
    const materialSpy = vi.spyOn(provider, 'listCourseWorkMaterials')

    const result = await enumeratePosts(provider, FIXTURE_KEYS.F4)

    expect(result.posts).toHaveLength(50)
    // 40 courseWork rows at 7/page = 6 calls; 10 materials at 7/page = 2 calls.
    expect(spy.mock.calls.length).toBeGreaterThan(1)
    expect(materialSpy.mock.calls.length).toBeGreaterThan(1)
    expect(result.listCalls).toBe(spy.mock.calls.length + materialSpy.mock.calls.length)
  })

  it('passes BOTH courseWorkStates explicitly — F8 posts (incl. scheduled Drafts) are not dropped', async () => {
    const provider = new MockClassroomProvider(db.prisma)
    const spy = vi.spyOn(provider, 'listCourseWork')
    await enumeratePosts(provider, FIXTURE_KEYS.F1)
    const passed = spy.mock.calls[0]?.[1]?.courseWorkStates
    expect(new Set(passed)).toEqual(new Set(ALL_COURSE_WORK_STATES))
  })

  it('would UNDER-scan if the states filter were omitted — proving the filter is load-bearing', async () => {
    const provider = new MockClassroomProvider(db.prisma)
    // The mock is held to the real API's default (PUBLISHED only). A caller
    // that forgets courseWorkStates silently loses every Draft — including
    // scheduled posts, which are Drafts carrying scheduledTime.
    const unfiltered = await provider.listCourseWork(FIXTURE_KEYS.F1)
    const filtered = await provider.listCourseWork(FIXTURE_KEYS.F1, {
      courseWorkStates: ALL_COURSE_WORK_STATES,
    })
    expect(unfiltered.items.length).toBeLessThan(filtered.items.length)
  })

  it('merges both coursework surfaces into one sequence', async () => {
    const provider = new MockClassroomProvider(db.prisma)
    const { posts } = await enumeratePosts(provider, FIXTURE_KEYS.F1)
    expect(new Set(posts.map((p) => p.sourceType))).toEqual(
      new Set(['courseWork', 'courseWorkMaterial']),
    )
  })

  it('orders oldest-first', async () => {
    const provider = new MockClassroomProvider(db.prisma)
    const { posts } = await enumeratePosts(provider, FIXTURE_KEYS.F1)
    const times = posts.map((p) => p.creationTime.getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('assigns a contiguous createdOrder that IS the position in the total order', async () => {
    const provider = new MockClassroomProvider(db.prisma)
    const { posts } = await enumeratePosts(provider, FIXTURE_KEYS.F1)
    expect(posts.map((p) => p.createdOrder)).toEqual(posts.map((_, i) => i))
  })
})

describe('the ordering key is a TOTAL order (D16)', () => {
  it('breaks ties on sourceType then sourceId, so equal timestamps still sort deterministically', () => {
    const t = new Date('2025-01-01T00:00:00.000Z')
    const a = { creationTime: t, sourceType: 'courseWork' as const, sourceId: 'b' }
    const b = { creationTime: t, sourceType: 'courseWork' as const, sourceId: 'a' }
    const c = { creationTime: t, sourceType: 'courseWorkMaterial' as const, sourceId: 'a' }
    const sorted = [a, b, c].sort(orderingKey)
    expect(sorted.map((x) => `${x.sourceType}:${x.sourceId}`)).toEqual([
      'courseWork:a',
      'courseWork:b',
      'courseWorkMaterial:a',
    ])
    // Reversing the input must not change the output — that is what "total"
    // means, and creationTime alone does not give it across two tables.
    const reversed = [c, b, a].sort(orderingKey)
    expect(reversed).toEqual(sorted)
  })
})

describe('empty course (D26)', () => {
  it('returns zero posts for F14 rather than throwing', async () => {
    const provider = new MockClassroomProvider(db.prisma)
    const { posts } = await enumeratePosts(provider, FIXTURE_KEYS.F14)
    expect(posts).toEqual([])
  })
})
