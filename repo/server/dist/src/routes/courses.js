import { Router } from 'express';
import { PreflightRequestSchema, CourseTopicsResponseSchema } from '@classroom-copier/shared';
import { runForAccount } from '../adapters/acting-account.js';
import { NotFoundError, PermissionError } from '../adapters/types.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { PreflightEngine } from '../services/preflight-engine.js';
/**
 * courses-api. Scoping goes through the PORT's `courseStates` filter (D19/E)
 * rather than being applied after the fact against fields the port does not
 * promise — post-hoc filtering is not a contract.
 */
export function coursesRouter(prisma, provider) {
    const router = Router();
    const auth = requireAuth(prisma);
    const engine = new PreflightEngine(prisma, provider);
    /** Every provider call it makes runs inside the caller's acting-account scope
     *  (see `adapters/acting-account.ts`) — `countPosts` carries no accountId of
     *  its own, so the scope is the only thing that says whose token pays. */
    async function listCourses(accountId, role) {
        // Source: active AND archived. Target: active only (PM brief Decision 14).
        const courseStates = role === 'source' ? ['ACTIVE', 'ARCHIVED'] : ['ACTIVE'];
        const courses = [];
        let pageToken = null;
        do {
            const page = await provider.listCourses(accountId, { courseStates, pageToken });
            // APPLY-K — one count per course, not a full two-surface paginated
            // enumeration (plus an attachment query and a rubric query) per course.
            // This is the FIRST authenticated call the app makes; a 30-course teacher
            // was paying 60+ paginated scans to render a list of names.
            const counts = await Promise.all(page.items.map(async (course) => {
                try {
                    return await provider.countPosts(course.id);
                }
                catch (error) {
                    if (!(error instanceof PermissionError) && !(error instanceof NotFoundError))
                        throw error;
                    logger.warn('course post count unavailable; returning course without count', {
                        accountId,
                        courseId: course.id,
                        reason: error.name,
                    });
                    return 0;
                }
            }));
            page.items.forEach((course, index) => {
                courses.push({
                    id: course.id,
                    name: course.name,
                    section: course.section,
                    state: course.state,
                    isSisShell: course.isSisShell,
                    postCount: counts[index],
                });
            });
            pageToken = page.nextPageToken;
        } while (pageToken != null);
        return courses;
    }
    router.get('/courses', auth, async (req, res, next) => {
        const role = req.query.role === 'target' ? 'target' : 'source';
        const accountId = req.auth.accountId;
        try {
            res.json({ courses: await runForAccount(provider, accountId, () => listCourses(accountId, role)) });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/courses/:courseId/topics', auth, async (req, res, next) => {
        const courseId = typeof req.params.courseId === 'string' ? req.params.courseId : '';
        const accountId = req.auth.accountId;
        try {
            const course = await runForAccount(provider, accountId, () => provider.getCourse(courseId));
            if (course == null || course.ownerAccountId !== accountId) {
                res.status(404).json({ error: { code: 'not_found', message: 'Course not found.' } });
                return;
            }
            const topics = [];
            let pageToken = null;
            do {
                const page = await runForAccount(provider, accountId, () => provider.listTopics(courseId, pageToken ? { pageToken } : undefined));
                topics.push(...page.items.map((t) => ({ id: t.id, name: t.name })));
                pageToken = page.nextPageToken;
            } while (pageToken != null);
            const parsed = CourseTopicsResponseSchema.parse({ topics });
            res.json(parsed);
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/courses/:sourceId/preflight', auth, async (req, res, next) => {
        const parsed = PreflightRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: { code: 'bad_request', message: 'targetId is required.' } });
            return;
        }
        const sourceId = typeof req.params.sourceId === 'string' ? req.params.sourceId : '';
        if (sourceId === parsed.data.targetId) {
            res.status(400).json({
                error: { code: 'same_course', message: 'Choose two different courses.' },
            });
            return;
        }
        const accountId = req.auth.accountId;
        try {
            const result = await runForAccount(provider, accountId, () => engine.run({
                accountId,
                sourceCourseId: sourceId,
                targetCourseId: parsed.data.targetId,
                topicIds: parsed.data.topicIds,
            }));
            res.json(result);
        }
        catch (error) {
            next(error);
        }
    });
    return router;
}
