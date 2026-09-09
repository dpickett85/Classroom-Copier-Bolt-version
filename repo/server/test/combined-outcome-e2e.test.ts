/**
 * Carried gap (d) — the combined outcome, driven through the ENGINE against
 * SEEDED data.
 *
 * "A post that is BOTH fallback-shell and rubric-degraded counts once under
 * fallback shells, rubricDegraded as an orthogonal tag" already has unit
 * coverage (`resolutions.test.ts`-style assertions on the mapping itself) and
 * `apply-findings.test.ts`'s QA-2 block drives the engine end-to-end for ONE
 * variant of it — F13's RATE-LIMIT-EXHAUSTION shell (`created.kind === 'shell'`)
 * combined with a licence-denied rubric.
 *
 * That leaves the OTHER fallback_shell path untested end-to-end: a post that
 * is genuinely CREATED (never rate-limited) but whose outcome is forced to
 * `fallback_shell` by a teacher's Action-Sheet resolution for a TRASHED
 * attachment (`declaredOutcome` via `resolution.forcedOutcome`, not
 * `created.kind === 'shell'`) — combined with the SAME post's rubric hitting
 * the target course's licence denial. Two independent degradation paths,
 * landing on the SAME item, and neither the resolution-driven fallback_shell
 * path nor its interaction with rubricDegraded had ever been driven through a
 * real preflight scan + resolution + transfer against seeded fixture data.
 *
 * No F1–F14 manifest edits: the trashed attachment and the licence flip are
 * both applied to the already-seeded `cw-f1-1` / `TARGET_JAMIE` at test time,
 * the same way `apply-findings.test.ts` does it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachmentFallbackNote, rubricDegradedNote } from '@classroom-copier/shared'
import { MockClassroomProvider } from '../src/adapters/mock/mock-classroom-provider.js'
import { FIXTURE_KEYS } from '../src/fixtures/index.js'
import { PreflightEngine } from '../src/services/preflight-engine.js'
import { countOutcomes } from '../src/services/reconciliation.js'
import { createTransferJob, TransferEngine } from '../src/services/transfer-engine.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { FAST_ENGINE } from './helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

const TRASHED_ATTACHMENT_ID = 'att-f1-1-trashed'
const TRASHED_ATTACHMENT_TITLE = 'Withdrawn primary source scan.pdf'

describe('carried gap (d) — fallback_shell (via a resolved trashed attachment) AND rubricDegraded on the SAME item', () => {
  it('outcome=fallback_shell, rubricDegraded=true, reconciliation balances exactly once, both notes present', async () => {
    // `cw-f1-1` already carries a rubric AND one healthy attachment in the
    // seeded fixture (D24 — the rubric SUCCESS path is fixtured elsewhere).
    // Add a SECOND attachment that is trashed, so pre-flight raises exactly
    // one finding for this post, and flip the target course's licence so the
    // SAME post's rubric copy is denied.
    await db.prisma.mockAttachment.create({
      data: {
        id: TRASHED_ATTACHMENT_ID,
        parentType: 'courseWork',
        parentId: 'cw-f1-1',
        kind: 'driveFile',
        driveFileId: 'drive-f1-withdrawn',
        title: TRASHED_ATTACHMENT_TITLE,
        shareMode: 'VIEW',
        driveState: 'trashed',
        ownerAccountId: 'acct-jamie',
        sortOrder: 1,
      },
    })
    await db.prisma.mockCourse.update({
      where: { id: FIXTURE_KEYS.TARGET_JAMIE },
      data: { rubricsLicensed: false },
    })

    const provider = new MockClassroomProvider(db.prisma)

    // Real pre-flight scan — the finding for the trashed attachment comes
    // from the SAME code path a live run uses, not a hand-built fixture.
    const scan = await new PreflightEngine(db.prisma, provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const finding = scan.findings.find((f) => f.attachmentId === TRASHED_ATTACHMENT_ID)
    expect(finding, 'pre-flight did not flag the trashed attachment').toBeTruthy()
    expect(finding!.issue).toBe('trashed')
    expect(finding!.scenario).toBe(2)

    // The teacher's recommended Scenario-2 choice: keep the post, drop the
    // dead attachment, note it. This is the resolution-driven fallback_shell
    // path (`declaredOutcome`), NOT the retry-exhaustion shell path.
    const { jobId } = await createTransferJob(db.prisma, {
      accountId: 'acct-jamie',
      scanId: scan.scanId,
      resolutions: [{ kind: 'create_draft_shell_with_note', findingId: finding!.id }],
    })

    const engine = new TransferEngine(db.prisma, provider, FAST_ENGINE)
    await engine.run(jobId)

    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, sourceId: 'cw-f1-1' },
    })
    expect(item.outcome).toBe('fallback_shell')
    expect(item.rubricDegraded).toBe(true)
    expect(item.targetPostId, 'the post was genuinely created, not skipped').toBeTruthy()

    // Reconciliation: the item counts exactly ONCE, under fallback_shell.
    // `rubricNotesAdded` is the orthogonal tag — it must NOT inflate the sum.
    const counts = await countOutcomes(db.prisma, jobId)
    expect(counts.transferred + counts.fallbackShell + counts.skippedTotal).toBe(counts.totalItems)
    expect(counts.fallbackShell).toBeGreaterThanOrEqual(1)
    expect(counts.rubricNotesAdded).toBeGreaterThanOrEqual(1)

    const rows = await db.prisma.transferJobItem.findMany({ where: { jobId } })
    const buckets = { transferred: 0, fallback_shell: 0, skipped: 0 } as Record<string, number>
    for (const row of rows) buckets[row.outcome] = (buckets[row.outcome] ?? 0) + 1
    // This specific post appears in fallback_shell and NOWHERE else.
    expect(rows.filter((r) => r.sourceId === 'cw-f1-1')).toHaveLength(1)

    // Both notes present on the created shell's description.
    const shell = await db.prisma.mockCourseWork.findUniqueOrThrow({
      where: { id: item.targetPostId! },
    })
    expect(shell.description).toContain(attachmentFallbackNote(TRASHED_ATTACHMENT_TITLE))
    expect(shell.description).toContain(rubricDegradedNote())
  })
})
