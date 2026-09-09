/**
 * `runForAccount` — the one call every path into a `ClassroomProvider` makes
 * before it starts using one.
 *
 * The port is deliberately account-less (`listTopics(courseId)`,
 * `createCourseWork(courseId, …)`), which is right for the mock — it reads a
 * shared database and has no credentials — and impossible for a real adapter,
 * where every request carries one teacher's bearer token. This is the seam that
 * reconciles the two: callers state who is acting, and an adapter that needs
 * that fact takes it. `MockClassroomProvider` and every test fake do not
 * implement `runForAccount`, so for them this is a pass-through and nothing
 * about their behaviour changes.
 */
import type { ClassroomProvider } from './classroom-provider.interface.js'

export function runForAccount<T>(
  provider: ClassroomProvider,
  accountId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return provider.runForAccount ? provider.runForAccount(accountId, fn) : fn()
}
