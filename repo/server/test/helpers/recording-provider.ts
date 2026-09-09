/**
 * The counting `ClassroomProvider` double that every P0 assertion in §4.3 is
 * written against.
 *
 * Why a call log and not an outcome check: the two P0s the architecture found
 * are both invisible from the outcome side. `execute()` re-runs terminal items
 * on re-entry and creates REAL duplicate posts in the teacher's course, while
 * `finish()`'s pending-predicate refuses the second ledger write — so the
 * reconciliation sum still balances, every item still reads `transferred`, and
 * the only witness is the destination course itself. An outcome assertion
 * passes against the broken engine. A create-call assertion does not.
 *
 * So this records, for every provider call the engine makes, the method and the
 * title (or topic name) it carried, and the tests assert on that log.
 *
 * It also injects `AuthExpiredError`, which `MockClassroomProvider` deliberately
 * never throws — a mock has no real token to expire, so its handling is
 * exercised by injection, exactly as `PermissionError` and `NotFoundError`
 * already are.
 */
import type { ClassroomProvider } from '../../src/adapters/classroom-provider.interface.js'
import { AuthExpiredError } from '../../src/adapters/types.js'

/** The four calls that WRITE to the teacher's Drive or destination course. */
export const WRITE_METHODS = [
  'createCourseWork',
  'createCourseWorkMaterial',
  'createTopic',
  'copyAttachmentToMyDrive',
] as const

/** The two that create a POST — the ones "duplicate in the teacher's course" means. */
export const CREATE_POST_METHODS = ['createCourseWork', 'createCourseWorkMaterial'] as const

export interface ProviderCall {
  method: string
  /** Post title, topic name, or attachment id — whatever names the subject. */
  subject: string | null
}

export interface Recorder {
  provider: ClassroomProvider
  /** Every recorded call, in order, across every pass. */
  calls: ProviderCall[]
  /**
   * Inject `AuthExpiredError` in place of the Nth post-create (1-indexed),
   * counted across the recorder's whole life. Null disables injection.
   */
  failPostCreateAt: number | null
  /** Inject `AuthExpiredError` on the next call to any of these methods. */
  failOnMethods: Set<string>
  /** Drop a marker so a test can talk about "pass 2" of the call log. */
  mark(label: string): void
  /** The calls recorded since the given marker. */
  since(label: string): ProviderCall[]
  postCreates(calls?: ProviderCall[]): ProviderCall[]
  createdTitles(calls?: ProviderCall[]): string[]
  countOf(method: string, calls?: ProviderCall[]): number
}

function subjectOf(method: string, args: unknown[]): string | null {
  switch (method) {
    case 'createCourseWork':
    case 'createCourseWorkMaterial': {
      const payload = args[1] as { title?: string } | undefined
      return payload?.title ?? null
    }
    case 'createTopic':
      return (args[1] as string | undefined) ?? null
    case 'copyAttachmentToMyDrive': {
      const ref = args[0] as { id?: string } | undefined
      return ref?.id ?? null
    }
    default:
      return null
  }
}

export function recordingProvider(inner: ClassroomProvider): Recorder {
  const calls: ProviderCall[] = []
  const markers = new Map<string, number>()
  let postCreateCount = 0

  const rec: Recorder = {
    provider: inner,
    calls,
    failPostCreateAt: null,
    failOnMethods: new Set<string>(),
    mark(label) {
      markers.set(label, calls.length)
    },
    since(label) {
      return calls.slice(markers.get(label) ?? 0)
    },
    postCreates(from = calls) {
      return from.filter((c) => (CREATE_POST_METHODS as readonly string[]).includes(c.method))
    },
    createdTitles(from = calls) {
      return rec
        .postCreates(from)
        .map((c) => c.subject)
        .filter((t): t is string => t != null)
    },
    countOf(method, from = calls) {
      return from.filter((c) => c.method === method).length
    },
  }

  rec.provider = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown
      if (typeof value !== 'function' || typeof prop !== 'string') return value
      return (...args: unknown[]) => {
        // Recorded BEFORE any injected failure: the question these tests ask is
        // "did this call reach the provider at all", and a call that reached it
        // and was refused still reached it.
        if ((WRITE_METHODS as readonly string[]).includes(prop)) {
          calls.push({ method: prop, subject: subjectOf(prop, args) })
        }

        if (rec.failOnMethods.has(prop)) {
          rec.failOnMethods.delete(prop)
          return Promise.reject(new AuthExpiredError())
        }

        if ((CREATE_POST_METHODS as readonly string[]).includes(prop)) {
          postCreateCount += 1
          if (rec.failPostCreateAt != null && postCreateCount === rec.failPostCreateAt) {
            return Promise.reject(new AuthExpiredError())
          }
        }

        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  }) as ClassroomProvider

  return rec
}
