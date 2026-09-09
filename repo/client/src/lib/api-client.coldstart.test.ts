/**
 * Quality budget `coldstart_overlay_timing` (04-architecture.md §8.1) — kept
 * standalone so `npm run test:budget:coldstart` measures exactly this.
 *
 * D4 + D29: the cold-start mechanism is LATENCY-triggered. No idle clock, no
 * server flag. Every request starts a 2s timer; if the call is still
 * unresolved the overlay flag flips; it clears on response; and a 60s ceiling
 * aborts into a DISTINCT error state so a genuinely down backend and a waking
 * one are never indistinguishable — never an indefinite overlay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COLD_START_CEILING_MS,
  COLD_START_THRESHOLD_MS,
  ColdStartTimeoutError,
  coldStartStore,
  health,
  listCourses,
} from './api-client'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  coldStartStore.reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  coldStartStore.reset()
})

/** A fetch that never resolves on its own, but honours the abort signal. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      }),
  )
}

describe('cold-start threshold', () => {
  it('has the architecture-pinned constants', () => {
    expect(COLD_START_THRESHOLD_MS).toBe(2000)
    expect(COLD_START_CEILING_MS).toBe(60_000)
  })

  it('does not flag a cold start before the 2s threshold', async () => {
    fetchMock.mockImplementation(hangingFetch())
    void listCourses('source').catch(() => {})

    await vi.advanceTimersByTimeAsync(COLD_START_THRESHOLD_MS - 200)
    expect(coldStartStore.getSnapshot().coldStart).toBe(false)
  })

  it('flags a cold start once a call is unresolved at 2s', async () => {
    fetchMock.mockImplementation(hangingFetch())
    void listCourses('source').catch(() => {})

    await vi.advanceTimersByTimeAsync(COLD_START_THRESHOLD_MS)
    expect(coldStartStore.getSnapshot().coldStart).toBe(true)
  })

  it('clears the flag as soon as the response arrives', async () => {
    let resolveIt: (r: Response) => void = () => {}
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveIt = resolve
        }),
    )
    const pending = listCourses('source')

    await vi.advanceTimersByTimeAsync(COLD_START_THRESHOLD_MS)
    expect(coldStartStore.getSnapshot().coldStart).toBe(true)

    resolveIt(
      new Response(JSON.stringify({ courses: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await pending
    expect(coldStartStore.getSnapshot().coldStart).toBe(false)
  })

  it('notifies subscribers exactly on the transitions, not on every tick', async () => {
    fetchMock.mockImplementation(hangingFetch())
    const listener = vi.fn()
    const unsubscribe = coldStartStore.subscribe(listener)

    void listCourses('source').catch(() => {})
    await vi.advanceTimersByTimeAsync(COLD_START_THRESHOLD_MS + 5000)

    // One transition: false -> true. Elapsed time alone must not re-emit.
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})

describe('the 60s ceiling (D4)', () => {
  it('aborts into a distinct ColdStartTimeoutError, and is not an indefinite overlay', async () => {
    fetchMock.mockImplementation(hangingFetch())
    const pending = listCourses('source')
    const assertion = expect(pending).rejects.toBeInstanceOf(ColdStartTimeoutError)

    await vi.advanceTimersByTimeAsync(COLD_START_THRESHOLD_MS)
    expect(coldStartStore.getSnapshot().coldStart).toBe(true)

    await vi.advanceTimersByTimeAsync(COLD_START_CEILING_MS)
    await assertion

    // The overlay is gone — the flow transitions to an error state instead of
    // spinning forever.
    expect(coldStartStore.getSnapshot().coldStart).toBe(false)
    expect(coldStartStore.getSnapshot().timedOut).toBe(true)
  })

  it('does not time out a call that answers before the ceiling', async () => {
    let resolveIt: (r: Response) => void = () => {}
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveIt = resolve
        }),
    )
    const pending = health()
    await vi.advanceTimersByTimeAsync(COLD_START_CEILING_MS - 1000)
    resolveIt(
      new Response(JSON.stringify({ status: 'ok', uptimeMs: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(pending).resolves.toEqual({ status: 'ok', uptimeMs: 1 })
    await vi.advanceTimersByTimeAsync(COLD_START_CEILING_MS)
    expect(coldStartStore.getSnapshot().timedOut).toBe(false)
  })

  it('keeps the overlay up while any one of several concurrent calls is still slow', async () => {
    let resolveFirst: (r: Response) => void = () => {}
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementation(hangingFetch())

    const first = listCourses('source')
    void health().catch(() => {})

    await vi.advanceTimersByTimeAsync(COLD_START_THRESHOLD_MS)
    expect(coldStartStore.getSnapshot().coldStart).toBe(true)

    resolveFirst(
      new Response(JSON.stringify({ courses: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await first
    // The second call is still hanging, so the overlay stays.
    expect(coldStartStore.getSnapshot().coldStart).toBe(true)
  })
})
