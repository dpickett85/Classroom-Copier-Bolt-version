/**
 * Quality budget: `token_failure_pause_resume_fidelity` — **blocking** (§8.1, §4.3).
 *
 * `execute()` is not re-entrant. Its item `findMany` filters on `jobId` alone
 * and does not even select `outcome`, so on a second entry every already-
 * terminal item falls straight through `processItem` into `transferPost` and
 * creates a SECOND real post in the teacher's destination course. `finish()`
 * then refuses the ledger write — the row is already terminal — so the sum
 * balances and the app looks correct while the teacher's Classroom fills with
 * duplicates.
 *
 * That is why nothing in this file asserts an outcome or a count. A balanced
 * reconciliation sum is satisfied by the broken engine. The provider call log
 * is not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_KEYS } from '../../src/fixtures/index.js'
import { MockClassroomProvider } from '../../src/adapters/mock/mock-classroom-provider.js'
import { PreflightEngine } from '../../src/services/preflight-engine.js'
import { TransferEngine, createTransferJob } from '../../src/services/transfer-engine.js'
import { checkInvariant } from '../../src/services/reconciliation.js'
import { createTestDb, type TestDb } from '../helpers/db.js'
import { recordingProvider, type Recorder } from '../helpers/recording-provider.js'
import { FAST_ENGINE } from '../helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

interface Prepared {
  jobId: string
  rec: Recorder
  engine: TransferEngine
}

/**
 * F1 into Jamie's plain target: 6 posts, 2 topics, no duplicates, no broken
 * attachments. Everything that happens here is therefore attributable to
 * re-entrancy rather than to a fixture's own findings.
 */
async function prepare(): Promise<Prepared> {
  const rec = recordingProvider(new MockClassroomProvider(db.prisma))
  const scan = await new PreflightEngine(db.prisma, rec.provider).run({
    accountId: 'acct-jamie',
    sourceCourseId: FIXTURE_KEYS.F1,
    targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
  })
  const { jobId } = await createTransferJob(db.prisma, {
    accountId: 'acct-jamie',
    scanId: scan.scanId,
    resolutions: [],
  })
  return { jobId, rec, engine: new TransferEngine(db.prisma, rec.provider, FAST_ENGINE) }
}

describe('[budget] token_failure_pause_resume_fidelity — P0-1, resume', () => {
  it('pauses on AuthExpiredError without failing the job, leaving later items pending', async () => {
    const { jobId, rec, engine } = await prepare()
    rec.failPostCreateAt = 3
    await engine.run(jobId)

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    const items = await db.prisma.transferJobItem.findMany({
      where: { jobId },
      orderBy: { createdOrder: 'asc' },
    })

    // The pause is a FIELD, not a status: 'interrupted' would be terminal and
    // unresumable, and a new status value would break the partial unique index
    // and /active, which both derive from status alone.
    expect(job.status).toBe('running')
    expect(job.googleReauthRequiredAt).toBeInstanceOf(Date)
    expect(job.executorId).toBeNull()
    expect(job.activeAccountId).toBe('acct-jamie')

    expect(items.filter((i) => i.outcome === 'transferred')).toHaveLength(2)
    const failed = items.find((i) => i.skipReason === 'provider_error')
    expect(failed, 'the item that was attempted when the token died').toBeDefined()
    expect(items.filter((i) => i.outcome === 'pending').length).toBeGreaterThan(0)
  })

  it('resume() makes ZERO create calls for any item terminal after pass 1', async () => {
    const { jobId, rec, engine } = await prepare()
    rec.failPostCreateAt = 3
    await engine.run(jobId)

    const afterPass1 = await db.prisma.transferJobItem.findMany({ where: { jobId } })
    const terminalTitles = afterPass1
      .filter((i) => i.outcome !== 'pending')
      .map((i) => i.title)
    const stillPending = afterPass1.filter((i) => i.outcome === 'pending')

    rec.mark('pass2')
    rec.failPostCreateAt = null
    await engine.resume(jobId)

    const pass2 = rec.since('pass2')
    const pass2Titles = rec.createdTitles(pass2)
    console.log(
      `[budget] reauth resume: terminalAfterPass1=${terminalTitles.length} ` +
        `pendingAtResume=${stillPending.length} pass2Creates=${pass2Titles.length} ` +
        `pass2Topics=${rec.countOf('createTopic', pass2)}`,
    )

    for (const title of terminalTitles) {
      expect(pass2Titles, `"${title}" was created a SECOND time on resume`).not.toContain(title)
    }
    expect(pass2Titles).toHaveLength(stillPending.length)

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.status).toBe('completed')
    expect(job.googleReauthRequiredAt).toBeNull()
    const invariant = await checkInvariant(db.prisma, jobId)
    expect(invariant.holds, invariant.detail).toBe(true)
  })

  it('P0-topics: resume creates ZERO topics that pass 1 already created', async () => {
    const { jobId, rec, engine } = await prepare()
    rec.failPostCreateAt = 3
    await engine.run(jobId)

    const pass1Topics = rec.countOf('createTopic')
    expect(pass1Topics).toBeGreaterThan(0)

    rec.mark('pass2')
    rec.failPostCreateAt = null
    await engine.resume(jobId)

    expect(rec.countOf('createTopic', rec.since('pass2'))).toBe(0)
    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    // j topics, not 2j.
    expect(job.topicsCreatedCount).toBe(pass1Topics)
  })
})

describe('[budget] token_failure_pause_resume_fidelity — P0-attachments, evidence-ambiguous items', () => {
  it('finishes a pending item with attemptedAt AND claimedTargetPostId as transferred, zero calls', async () => {
    const { jobId, rec, engine } = await prepare()
    rec.failPostCreateAt = 3
    await engine.run(jobId)

    // Hand-build the evidence-ambiguous state: attempted, a post demonstrably
    // created, but the outcome write never landed. This is exactly what a crash
    // between `claimTargetPost` and `finish` leaves behind.
    const victim = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, outcome: 'pending' },
      orderBy: { createdOrder: 'asc' },
    })
    await db.prisma.transferJobItem.update({
      where: { id: victim.id },
      data: { attemptedAt: new Date(), claimedTargetPostId: 'target-post-already-created' },
    })

    rec.mark('pass2')
    rec.failPostCreateAt = null
    await engine.resume(jobId)

    const resolved = await db.prisma.transferJobItem.findUniqueOrThrow({ where: { id: victim.id } })
    expect(resolved.outcome).toBe('transferred')
    expect(resolved.targetPostId).toBe('target-post-already-created')
    expect(rec.createdTitles(rec.since('pass2'))).not.toContain(victim.title)
  })

  it('resolves a pending item with attemptedAt and NO claim as skipped/server_interrupted', async () => {
    const { jobId, rec, engine } = await prepare()
    rec.failPostCreateAt = 3
    await engine.run(jobId)

    const victim = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, outcome: 'pending' },
      orderBy: { createdOrder: 'asc' },
    })
    await db.prisma.transferJobItem.update({
      where: { id: victim.id },
      data: { attemptedAt: new Date(), claimedTargetPostId: null },
    })

    rec.mark('pass2')
    rec.failPostCreateAt = null
    await engine.resume(jobId)

    const resolved = await db.prisma.transferJobItem.findUniqueOrThrow({ where: { id: victim.id } })
    expect(resolved.outcome).toBe('skipped')
    expect(resolved.skipReason).toBe('server_interrupted')
    expect(resolved.targetPostId).toBeNull()
    // The point of the whole branch: no re-copy of a Drive file, no re-create.
    expect(rec.createdTitles(rec.since('pass2'))).not.toContain(victim.title)
    expect(rec.countOf('copyAttachmentToMyDrive', rec.since('pass2'))).toBe(0)
  })
})

describe('[budget] F7 — AuthExpiredError BEFORE the item loop is a pause, not a failure', () => {
  it('pauses when buildTopicMap throws, with zero items attempted', async () => {
    const { jobId, rec, engine } = await prepare()
    rec.failOnMethods.add('createTopic')
    await engine.run(jobId)

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.status, 'a pre-loop AuthExpiredError must not fail the job').toBe('running')
    expect(job.googleReauthRequiredAt).toBeInstanceOf(Date)
    const attempted = await db.prisma.transferJobItem.count({
      where: { jobId, attemptedAt: { not: null } },
    })
    expect(attempted).toBe(0)
  })

  it('pauses when enumeratePosts throws', async () => {
    const { jobId, rec, engine } = await prepare()
    rec.failOnMethods.add('listCourseWork')
    await engine.run(jobId)

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.status).toBe('running')
    expect(job.googleReauthRequiredAt).toBeInstanceOf(Date)
    expect(rec.postCreates()).toHaveLength(0)
  })
})

/**
 * F1 — the third silent-drop of this family, and the one with no witness at all.
 *
 * `copyAttachmentToMyDrive` runs BEFORE `createWithBackoff`, so a token that
 * expires during attachment preparation reaches `processItem`'s catch with
 * `attemptedAt` still null and nothing written anywhere. `recordItemFailure`
 * fired anyway and marked the post terminal `skipped`/`provider_error` — so
 * `resume()`, which only dispatches `pending` items, never retried it. The post
 * was permanently lost while the reconciliation sum balanced and the ledger read
 * as an honest skip.
 *
 * The assertion is therefore about the item's state AT THE PAUSE, and about the
 * create call resume does or does not make. An outcome-total check passes
 * against the bug.
 */
describe('[budget] token_failure_pause_resume_fidelity — F1, unattempted at the pause', () => {
  async function prepareCopyToMyDrive(): Promise<Prepared & { scanItemId: string }> {
    const rec = recordingProvider(new MockClassroomProvider(db.prisma))
    const scan = await new PreflightEngine(db.prisma, rec.provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F3,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const finding = scan.findings[0]!
    const { jobId } = await createTransferJob(db.prisma, {
      accountId: 'acct-jamie',
      scanId: scan.scanId,
      resolutions: [{ kind: 'copy_to_my_drive', findingId: finding.id }],
    })
    return {
      jobId,
      rec,
      engine: new TransferEngine(db.prisma, rec.provider, FAST_ENGINE),
      scanItemId: finding.scanItemId,
    }
  }

  it('leaves the item PENDING when the token dies before anything was attempted', async () => {
    const { jobId, rec, engine, scanItemId } = await prepareCopyToMyDrive()
    rec.failOnMethods.add('copyAttachmentToMyDrive')
    await engine.run(jobId)

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.googleReauthRequiredAt, 'the job did not pause for re-auth').toBeInstanceOf(Date)

    const item = await db.prisma.transferJobItem.findFirstOrThrow({ where: { jobId, scanItemId } })
    expect(item.attemptedAt, 'nothing was attempted — the create was never reached').toBeNull()
    expect(item.targetPostId).toBeNull()
    expect(item.claimedTargetPostId).toBeNull()
    // The bug: `skipped`/`provider_error` here is terminal, and terminal means
    // `resume()` will never look at this row again.
    expect(item.outcome, 'a post that was never attempted was marked terminal').toBe('pending')
    expect(item.skipReason).toBeNull()
  })

  it('resume() copies the post the pause interrupted — it is not silently lost', async () => {
    const { jobId, rec, engine, scanItemId } = await prepareCopyToMyDrive()
    rec.failOnMethods.add('copyAttachmentToMyDrive')
    await engine.run(jobId)

    const paused = await db.prisma.transferJobItem.findFirstOrThrow({ where: { jobId, scanItemId } })

    rec.mark('pass2')
    await engine.resume(jobId)

    const resumed = await db.prisma.transferJobItem.findFirstOrThrow({ where: { jobId, scanItemId } })
    expect(resumed.outcome).toBe('transferred')
    expect(rec.createdTitles(rec.since('pass2'))).toContain(paused.title)
    // And the Drive copy the pause interrupted is retried exactly once.
    expect(rec.countOf('copyAttachmentToMyDrive', rec.since('pass2'))).toBe(1)

    const invariant = await checkInvariant(db.prisma, jobId)
    expect(invariant.holds, invariant.detail).toBe(true)
  })
})

/**
 * F6 — what the `outcome: 'pending'` filter in `execute`'s item query actually
 * guards, asserted directly.
 *
 * Mutation-verified by the critic: reverting that filter ALONE left every case
 * above green, because §4.3 fix 3 diverts each re-read item that carries an
 * `attemptedAt` into `resolveFromEvidence` before it can be dispatched. The
 * rows the filter is the only guard for are the ones that went terminal with
 * `attemptedAt` STILL NULL — a `duplicate_title` resolved at job creation,
 * before a single provider call. Nothing above put one in front of a resume.
 *
 * The F15 pair does: four seeded duplicate titles, terminal before the run
 * starts. If the filter goes, resume re-dispatches them and creates four real
 * second copies in the teacher's course while the ledger still balances.
 */
describe('[budget] token_failure_pause_resume_fidelity — F6, terminal-without-attempt at resume', () => {
  it('resume() makes ZERO create calls for duplicate_title items resolved before the run', async () => {
    const rec = recordingProvider(new MockClassroomProvider(db.prisma))
    const scan = await new PreflightEngine(db.prisma, rec.provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F15_SOURCE,
      targetCourseId: FIXTURE_KEYS.F15_TARGET,
    })
    expect(scan.duplicates, 'the F15 pair no longer seeds duplicates').toHaveLength(4)
    const { jobId } = await createTransferJob(db.prisma, {
      accountId: 'acct-jamie',
      scanId: scan.scanId,
      resolutions: [],
    })
    const engine = new TransferEngine(db.prisma, rec.provider, FAST_ENGINE)

    // Pause on the very first create, so the duplicates are still sitting there
    // — terminal, never attempted — when resume re-reads the item table.
    rec.failPostCreateAt = 1
    await engine.run(jobId)

    const afterPass1 = await db.prisma.transferJobItem.findMany({ where: { jobId } })
    const unattemptedTerminal = afterPass1.filter(
      (i) => i.outcome !== 'pending' && i.attemptedAt == null,
    )
    const duplicates = unattemptedTerminal.filter((i) => i.skipReason === 'duplicate_title')
    expect(duplicates, 'no duplicate_title row survived to the resume').toHaveLength(4)
    const stillPending = afterPass1.filter((i) => i.outcome === 'pending')
    expect(stillPending.length).toBeGreaterThan(0)

    rec.mark('pass2')
    rec.failPostCreateAt = null
    await engine.resume(jobId)

    const pass2Titles = rec.createdTitles(rec.since('pass2'))
    console.log(
      `[budget] reauth resume F6: unattemptedTerminal=${unattemptedTerminal.length} ` +
        `duplicates=${duplicates.length} pendingAtResume=${stillPending.length} ` +
        `pass2Creates=${pass2Titles.length}`,
    )

    for (const row of unattemptedTerminal) {
      expect(
        pass2Titles,
        `"${row.title}" was terminal with nothing attempted, and resume created it anyway`,
      ).not.toContain(row.title)
    }
    expect(pass2Titles).toHaveLength(stillPending.length)

    const invariant = await checkInvariant(db.prisma, jobId)
    expect(invariant.holds, invariant.detail).toBe(true)
  })
})
