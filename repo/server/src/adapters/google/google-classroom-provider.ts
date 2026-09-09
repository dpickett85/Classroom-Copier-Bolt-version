/**
 * `GoogleClassroomProvider` — the app-lifetime `ClassroomProvider` for
 * `GOOGLE_PROVIDER_MODE=google`.
 *
 * **Why this exists at all.** `RealClassroomProvider` is bound to ONE account,
 * because every real call carries that account's bearer token (see its own
 * constructor comment). The composition root, on the other hand, builds exactly
 * one provider at boot and hands the same reference to `coursesRouter`,
 * `PreflightEngine`, `TransferEngine` and `JobReconciler` — none of which know
 * the acting account when they are constructed, and most of whose port methods
 * (`listTopics(courseId)`, `createCourseWork(courseId, …)`, `getRubric(id)`)
 * carry no account at all.
 *
 * So the two cannot simply be swapped: "select `RealClassroomProvider` at the
 * composition root" needs somewhere for the acting account to come from. This
 * adapter is that somewhere. It is a `ClassroomProvider` that owns no
 * credentials of its own and delegates every call to a `RealClassroomProvider`
 * built for the account currently in scope.
 *
 * **The scope is explicit, not ambient guesswork.** `runForAccount` is the only
 * way to establish one, and it is called at the three places that genuinely know
 * who is acting: the authenticated request (`coursesRouter`), the job executor
 * (`TransferEngine.execute`, from `job.accountId`) and the reconciler's target
 * verification. `AsyncLocalStorage` carries it from there, so concurrent jobs
 * for different teachers cannot see each other's binding — which a mutable
 * `this.current` field could not promise.
 *
 * **The bind is LAZY on purpose.** Loading the account's token can raise
 * `AuthExpiredError`, and the engine's F7 handling depends on that arriving from
 * a provider CALL (inside `execute`'s try, where it becomes a re-auth pause)
 * rather than from scope entry (outside it, where it would mark the job
 * `failed`). So `runForAccount` stores a thunk and the token is read on first
 * use.
 *
 * A fresh `RealClassroomProvider` per scope is deliberate too: that adapter
 * memoises courseWorkId → courseId and attachment → Drive-file within a run, and
 * a scope is exactly one run. Nothing is cached across scopes, so a token
 * refreshed by a re-auth is picked up on the next entry with no invalidation
 * logic to get wrong.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { PrismaClient } from '@prisma/client'
import type { ClassroomProvider } from '../classroom-provider.interface.js'
import type {
  AttachmentRef,
  CourseWorkMaterialPayload,
  CourseWorkPayload,
  HealthState,
  ListCourseWorkMaterialsRequest,
  ListCourseWorkRequest,
  ListCoursesRequest,
  Page,
  PageRequest,
  ProviderCourse,
  ProviderCourseWork,
  ProviderCourseWorkMaterial,
  ProviderTopic,
  RubricBody,
} from '../types.js'
import { buildAuthorizedClient } from './oauth-client.js'
import { RealClassroomProvider, clientsFrom } from './real-classroom-provider.js'

/** A thunk, so the token read (and its `AuthExpiredError`) happens on first use. */
type BoundProvider = () => Promise<ClassroomProvider>

export class GoogleClassroomProvider implements ClassroomProvider {
  private readonly scope = new AsyncLocalStorage<BoundProvider>()

  constructor(private readonly prisma: PrismaClient) {}

  async runForAccount<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
    let bound: Promise<ClassroomProvider> | null = null
    const thunk: BoundProvider = () => (bound ??= this.build(accountId))
    return this.scope.run(thunk, fn)
  }

  private async build(accountId: string): Promise<ClassroomProvider> {
    const { auth } = await buildAuthorizedClient(this.prisma, accountId)
    return new RealClassroomProvider(accountId, clientsFrom(auth))
  }

  /**
   * A call outside any scope is a WIRING bug, not a runtime condition — some
   * caller reached the provider without ever saying who is acting. It fails
   * loudly rather than picking an account.
   */
  private async bound(): Promise<ClassroomProvider> {
    const thunk = this.scope.getStore()
    if (!thunk) {
      throw new Error(
        '[google-provider] no acting account in scope. Every path to the Google adapter must go through runForAccount(); this call did not.',
      )
    }
    return thunk()
  }

  /* --- delegation. Nothing below does anything but forward. ---------- */

  async listCourses(accountId: string, req?: ListCoursesRequest): Promise<Page<ProviderCourse>> {
    return (await this.bound()).listCourses(accountId, req)
  }

  async getCourse(courseId: string): Promise<ProviderCourse | null> {
    return (await this.bound()).getCourse(courseId)
  }

  async countPosts(courseId: string): Promise<number> {
    return (await this.bound()).countPosts(courseId)
  }

  async listTopics(courseId: string, req?: PageRequest): Promise<Page<ProviderTopic>> {
    return (await this.bound()).listTopics(courseId, req)
  }

  async createTopic(courseId: string, name: string): Promise<{ topicId: string }> {
    return (await this.bound()).createTopic(courseId, name)
  }

  async listCourseWork(
    courseId: string,
    req?: ListCourseWorkRequest,
  ): Promise<Page<ProviderCourseWork>> {
    return (await this.bound()).listCourseWork(courseId, req)
  }

  async listCourseWorkMaterials(
    courseId: string,
    req?: ListCourseWorkMaterialsRequest,
  ): Promise<Page<ProviderCourseWorkMaterial>> {
    return (await this.bound()).listCourseWorkMaterials(courseId, req)
  }

  async createCourseWork(courseId: string, payload: CourseWorkPayload): Promise<{ id: string }> {
    return (await this.bound()).createCourseWork(courseId, payload)
  }

  async createCourseWorkMaterial(
    courseId: string,
    payload: CourseWorkMaterialPayload,
  ): Promise<{ id: string }> {
    return (await this.bound()).createCourseWorkMaterial(courseId, payload)
  }

  async updateCourseWorkDescription(courseWorkId: string, description: string): Promise<void> {
    return (await this.bound()).updateCourseWorkDescription(courseWorkId, description)
  }

  async updateCourseWorkMaterialDescription(materialId: string, description: string): Promise<void> {
    return (await this.bound()).updateCourseWorkMaterialDescription(materialId, description)
  }

  async getAttachmentHealth(refs: AttachmentRef[]): Promise<Map<string, HealthState>> {
    return (await this.bound()).getAttachmentHealth(refs)
  }

  async copyAttachmentToMyDrive(
    ref: AttachmentRef,
    actingAccountId: string,
  ): Promise<{ newDriveFileId: string }> {
    return (await this.bound()).copyAttachmentToMyDrive(ref, actingAccountId)
  }

  async getRubric(courseWorkId: string): Promise<RubricBody | null> {
    return (await this.bound()).getRubric(courseWorkId)
  }

  async createRubric(targetCourseWorkId: string, rubric: RubricBody): Promise<{ id: string }> {
    return (await this.bound()).createRubric(targetCourseWorkId, rubric)
  }
}
