import { runForAccount } from '../adapters/acting-account.js';
import { ALL_COURSE_WORK_MATERIAL_STATES, ALL_COURSE_WORK_STATES, } from './post-enumerator.js';
import { logger } from '../logger.js';
const emptyCounters = () => ({
    itemsVerifiedTransferred: 0,
    itemsSkippedNeverAttempted: 0,
    itemsSkippedNotFound: 0,
    itemsSkippedAmbiguous: 0,
});
export class JobReconciler {
    prisma;
    provider;
    options;
    constructor(prisma, provider, options) {
        this.prisma = prisma;
        this.provider = provider;
        this.options = options;
    }
    /**
     * Resolve every job stuck in a non-terminal status with a stale heartbeat.
     * Never auto-resumes: resuming risks creating a duplicate draft for an item
     * whose provider call succeeded but whose checkpoint did not. Verification is
     * the safe half of that trade — it reads, it does not write to the target.
     */
    async reconcileStaleJobs(now = new Date()) {
        const cutoff = new Date(now.getTime() - this.options.staleAfterMs);
        const reauthCutoff = new Date(now.getTime() - this.options.reauthGraceMs);
        // Decision F — TWO predicates, not one, and they are mutually exclusive by
        // construction. A job waiting on re-auth is judged ONLY against the grace
        // period; every other job is judged only against the heartbeat. Written as
        // a single `lastHeartbeatAt < cutoff` filter, a paused job would be
        // reconciled within a heartbeat interval of the moment it asked the teacher
        // to reconnect.
        const stale = await this.prisma.transferJob.findMany({
            where: {
                status: { in: ['queued', 'running'] },
                OR: [
                    { googleReauthRequiredAt: null, lastHeartbeatAt: { lt: cutoff } },
                    { googleReauthRequiredAt: { lt: reauthCutoff } },
                ],
            },
            include: { scan: { select: { targetCourseId: true } } },
        });
        const result = { jobsReconciled: 0, ...emptyCounters() };
        for (const job of stale) {
            // P0-2 — CLAIM FIRST, conditionally, in one statement. If the executor
            // heartbeated between the SELECT above and this UPDATE, `count` is 0 and
            // the job is left entirely alone: not one item is rewritten, and
            // `activeAccountId` is not released under a run that is still going.
            const claimed = await this.prisma.transferJob.updateMany({
                where: {
                    id: job.id,
                    status: { in: ['queued', 'running'] },
                    // The claim re-asserts the SAME predicate the select used, so a job
                    // that resumed in between — the teacher finished reconnecting — is
                    // left entirely alone rather than terminated out from under its new
                    // executor.
                    ...(job.googleReauthRequiredAt != null
                        ? { googleReauthRequiredAt: { lt: reauthCutoff } }
                        : { googleReauthRequiredAt: null, lastHeartbeatAt: { lt: cutoff } }),
                },
                data: {
                    status: 'interrupted',
                    // Revoking the lease is what makes the displaced executor stand down.
                    executorId: null,
                    activeAccountId: null,
                    // Cleared with the terminal write: the job is over, so there is
                    // nothing left for a reconnect to resume and the banner must go.
                    googleReauthRequiredAt: null,
                    finishedAt: new Date(),
                    rateLimitPause: null,
                },
            });
            if (claimed.count === 0) {
                logger.info('reconciler skipped a job it could not claim', { jobId: job.id });
                continue;
            }
            // E1 — `reconcileJob` reads the TARGET course through the provider, which
            // for a real adapter means spending this job owner's credentials. This is
            // the only caller, so the scope is entered here rather than threaded
            // through a public signature nothing else uses.
            const perJob = await runForAccount(this.provider, job.accountId, () => this.reconcileJob(job.id, job.scan.targetCourseId, job.startedAt));
            result.itemsVerifiedTransferred += perJob.itemsVerifiedTransferred;
            result.itemsSkippedNeverAttempted += perJob.itemsSkippedNeverAttempted;
            result.itemsSkippedNotFound += perJob.itemsSkippedNotFound;
            result.itemsSkippedAmbiguous += perJob.itemsSkippedAmbiguous;
            result.jobsReconciled += 1;
            logger.jobEvent('interrupted', { jobId: job.id, ...perJob });
        }
        if (result.jobsReconciled > 0)
            logger.jobEvent('reconciled', { ...result });
        return result;
    }
    async reconcileJob(jobId, targetCourseId, 
    /** Nothing can have been created before this instant (P0-4). */
    jobStartedAt) {
        const counters = emptyCounters();
        const pending = await this.prisma.transferJobItem.findMany({
            where: { jobId, outcome: 'pending' },
            orderBy: { createdOrder: 'asc' },
        });
        if (pending.length === 0)
            return counters;
        // Both list methods already exist on the port and the target world is in
        // the same database, so verification costs one query per surface.
        const index = await this.buildTargetIndex(targetCourseId, jobStartedAt);
        // P0-4 — a target post backs exactly ONE item. Every id any sibling has
        // already claimed is off the table for everyone else.
        const siblings = await this.prisma.transferJobItem.findMany({
            where: { jobId },
            select: { id: true, targetPostId: true, claimedTargetPostId: true },
        });
        const claimedBy = new Map();
        for (const sibling of siblings) {
            for (const id of [sibling.targetPostId, sibling.claimedTargetPostId]) {
                if (id)
                    claimedBy.set(id, sibling.id);
            }
        }
        for (const item of pending) {
            if (item.attemptedAt == null) {
                // Never attempted. Honest.
                await this.resolve(item.id, {
                    outcome: 'skipped',
                    skipReason: 'server_interrupted',
                    note: 'The server was interrupted before this post was attempted. Nothing was created for it.',
                });
                counters.itemsSkippedNeverAttempted += 1;
                continue;
            }
            // 1. Evidence the job owns. The executor wrote this the instant the
            //    create returned, so it names a specific post rather than describing
            //    one.
            if (item.claimedTargetPostId) {
                if (index.allIds.has(item.claimedTargetPostId)) {
                    await this.resolve(item.id, {
                        outcome: 'transferred',
                        skipReason: null,
                        targetPostId: item.claimedTargetPostId,
                        note: 'Recovered after an interruption — the post this item created was found in the target course.',
                    });
                    counters.itemsVerifiedTransferred += 1;
                }
                else {
                    await this.resolve(item.id, {
                        outcome: 'skipped',
                        skipReason: 'server_interrupted',
                        note: 'The server was interrupted mid-attempt. The post this item was creating is not in the target course.',
                    });
                    counters.itemsSkippedNotFound += 1;
                }
                continue;
            }
            // 2. Fallback: the create may have landed between `attemptedAt` and the
            //    claim write. Match by title, but only against posts that (a) could
            //    only have been created by this job and (b) no sibling already owns —
            //    and refuse rather than guess when more than one fits.
            const candidates = (index.byKey.get(`${item.sourceType}:${item.title}`) ?? []).filter((candidate) => {
                const owner = claimedBy.get(candidate.id);
                return owner == null || owner === item.id;
            });
            if (candidates.length === 1) {
                const match = candidates[0];
                claimedBy.set(match.id, item.id);
                await this.resolve(item.id, {
                    outcome: 'transferred',
                    skipReason: null,
                    targetPostId: match.id,
                    note: 'Recovered after an interruption — this post was verified present in the target course.',
                });
                counters.itemsVerifiedTransferred += 1;
            }
            else if (candidates.length > 1) {
                await this.resolve(item.id, {
                    outcome: 'skipped',
                    skipReason: 'server_interrupted',
                    note: 'The server was interrupted mid-attempt. More than one post in the target course matches this one, so we will not claim it was copied — check the target course before re-running.',
                });
                counters.itemsSkippedAmbiguous += 1;
            }
            else {
                await this.resolve(item.id, {
                    outcome: 'skipped',
                    skipReason: 'server_interrupted',
                    note: 'The server was interrupted mid-attempt. We checked the target course and no matching post was created.',
                });
                counters.itemsSkippedNotFound += 1;
            }
        }
        return counters;
    }
    /** Every reconciler write carries the `pending` predicate too, so it can
     *  never overwrite a terminal outcome an executor recorded on evidence. */
    async resolve(itemId, data) {
        const result = await this.prisma.transferJobItem.updateMany({
            where: { id: itemId, outcome: 'pending' },
            data: {
                outcome: data.outcome,
                skipReason: data.skipReason,
                note: data.note,
                ...(data.targetPostId ? { targetPostId: data.targetPostId } : {}),
            },
        });
        if (result.count === 0) {
            logger.warn('reconciler refused to overwrite a terminal item outcome', { itemId });
        }
    }
    async buildTargetIndex(targetCourseId, jobStartedAt) {
        const byKey = new Map();
        const allIds = new Set();
        const add = (key, post) => {
            allIds.add(post.id);
            // P0-4 — a post that predates the job cannot have been created by it. A
            // non-empty target course, or a target dirty from a previous run, used to
            // manufacture "transferred" verdicts here.
            if (jobStartedAt == null || post.creationTime < jobStartedAt)
                return;
            const list = byKey.get(key) ?? [];
            list.push(post);
            byKey.set(key, list);
        };
        let token = null;
        do {
            const page = await this.provider.listCourseWork(targetCourseId, {
                courseWorkStates: ALL_COURSE_WORK_STATES,
                pageToken: token,
            });
            for (const post of page.items) {
                add(`courseWork:${post.title}`, { id: post.id, creationTime: post.creationTime });
            }
            token = page.nextPageToken;
        } while (token != null);
        token = null;
        do {
            const page = await this.provider.listCourseWorkMaterials(targetCourseId, {
                courseWorkMaterialStates: ALL_COURSE_WORK_MATERIAL_STATES,
                pageToken: token,
            });
            for (const post of page.items) {
                add(`courseWorkMaterial:${post.title}`, { id: post.id, creationTime: post.creationTime });
            }
            token = page.nextPageToken;
        } while (token != null);
        return { byKey, allIds };
    }
    /** D12 — the interval. A wedged job self-heals without a process restart. */
    start(intervalMs) {
        const handle = setInterval(() => {
            void this.reconcileStaleJobs().catch((error) => {
                logger.error('job reconciler interval failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }, intervalMs);
        handle.unref?.();
        return () => clearInterval(handle);
    }
}
