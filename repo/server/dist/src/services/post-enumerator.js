export const ALL_COURSE_WORK_STATES = ['DRAFT', 'PUBLISHED'];
/**
 * APPLY-D — the second surface's states are passed under their OWN parameter
 * name (`courseWorkMaterialStates`), because `courses.courseWorkMaterials.list`
 * is a different real endpoint. The member list happens to coincide today; the
 * constant is separate so it can diverge without a rename.
 */
export const ALL_COURSE_WORK_MATERIAL_STATES = ['DRAFT', 'PUBLISHED'];
/**
 * `(updateTime ASC, sourceType ASC, sourceId ASC)`.
 *
 * `updateTime` is Google's "last edited" timestamp, which bumps when a teacher
 * drags a post into a new position — so it tracks the on-screen Classwork order
 * that `creationTime` cannot. The tiebreak is not decoration: seeded fixtures
 * routinely share timestamps, and `updateTime` alone is not a total order across
 * two tables. Without the tiebreak "oldest-first" is only well-defined up to
 * ties, and two callers sorting the same set could legitimately produce
 * different sequences.
 */
export function orderingKey(a, b) {
    const byTime = a.updateTime.getTime() - b.updateTime.getTime();
    if (byTime !== 0)
        return byTime;
    if (a.sourceType !== b.sourceType)
        return a.sourceType < b.sourceType ? -1 : 1;
    if (a.sourceId !== b.sourceId)
        return a.sourceId < b.sourceId ? -1 : 1;
    return 0;
}
async function drain(fetchPage, onPage) {
    const items = [];
    let pageToken = null;
    let calls = 0;
    // Loop until nextPageToken is exhausted — or the scan under-counts, and a
    // post that is never scanned never gets a TransferJobItem row, so the
    // item-level invariant cannot detect the loss.
    do {
        const page = await fetchPage(pageToken);
        calls += 1;
        items.push(...page.items);
        pageToken = page.nextPageToken;
        if (onPage)
            await onPage();
    } while (pageToken != null);
    return { items, calls };
}
export async function enumeratePosts(provider, courseId, options = {}) {
    const [work, materials] = await Promise.all([
        drain((pageToken) => provider.listCourseWork(courseId, {
            courseWorkStates: ALL_COURSE_WORK_STATES,
            pageToken,
        }), options.onPage),
        drain((pageToken) => provider.listCourseWorkMaterials(courseId, {
            courseWorkMaterialStates: ALL_COURSE_WORK_MATERIAL_STATES,
            pageToken,
        }), options.onPage),
    ]);
    const merged = [
        ...work.items.map((w) => ({
            sourceType: 'courseWork',
            sourceId: w.id,
            title: w.title,
            description: w.description,
            workType: w.workType,
            state: w.state,
            scheduledTime: w.scheduledTime,
            maxPoints: w.maxPoints,
            answerConfig: w.answerConfig,
            quizFormLink: w.quizFormLink,
            topicId: w.topicId,
            creationTime: w.creationTime,
            updateTime: w.updateTime,
            attachments: w.attachments,
            hasRubric: w.hasRubric,
        })),
        ...materials.items.map((m) => ({
            sourceType: 'courseWorkMaterial',
            sourceId: m.id,
            title: m.title,
            description: m.description,
            // Structurally absent on a Material — not a nulled-out shared field.
            workType: null,
            state: m.state,
            scheduledTime: null,
            maxPoints: null,
            answerConfig: null,
            quizFormLink: null,
            topicId: m.topicId,
            creationTime: m.creationTime,
            updateTime: m.updateTime,
            attachments: m.attachments,
            hasRubric: false,
        })),
    ];
    merged.sort(orderingKey);
    return {
        posts: merged.map((post, index) => ({ ...post, createdOrder: index })),
        listCalls: work.calls + materials.calls,
    };
}
/**
 * Both classwork surfaces plus topics, from the DESTINATION course.
 *
 * States are passed explicitly for the same reason the source enumeration does
 * it: Google's unfiltered default is PUBLISHED-only, and a duplicate check that
 * cannot see the destination's DRAFTS is precisely the bug this feature exists
 * to fix — the second run of a transfer would re-create every draft the first
 * run made.
 *
 * It reuses `drain`, the one pagination loop, rather than hand-rolling a second
 * one that could stop early on a different mistake.
 */
export async function enumerateDestination(provider, courseId, options = {}) {
    const [work, materials, topics] = await Promise.all([
        drain((pageToken) => provider.listCourseWork(courseId, { courseWorkStates: ALL_COURSE_WORK_STATES, pageToken }), options.onPage),
        drain((pageToken) => provider.listCourseWorkMaterials(courseId, {
            courseWorkMaterialStates: ALL_COURSE_WORK_MATERIAL_STATES,
            pageToken,
        }), options.onPage),
        drain((pageToken) => provider.listTopics(courseId, { pageToken }), options.onPage),
    ]);
    return {
        posts: [
            ...work.items.map((w) => ({
                sourceType: 'courseWork',
                sourceId: w.id,
                title: w.title,
                state: w.state,
            })),
            ...materials.items.map((m) => ({
                sourceType: 'courseWorkMaterial',
                sourceId: m.id,
                title: m.title,
                state: m.state,
            })),
        ],
        // API return order is preserved on purpose: on an ambiguous multi-match the
        // FIRST one wins, and "first" has to mean something stable.
        topics: topics.items.map((t) => ({ id: t.id, name: t.name })),
        listCalls: work.calls + materials.calls + topics.calls,
    };
}
/** "Material" / "Assignment" / "Quiz assignment" / "Question" — the type-aware
 *  label the Action Sheet's skip button and the itemized log both render. */
export function typeLabel(sourceType, workType) {
    if (sourceType === 'courseWorkMaterial')
        return 'Material';
    switch (workType) {
        case 'ASSIGNMENT':
            return 'Assignment';
        case 'QUIZ_ASSIGNMENT':
            return 'Quiz assignment';
        case 'SHORT_ANSWER_QUESTION':
        case 'MULTIPLE_CHOICE_QUESTION':
            return 'Question';
        default:
            return 'Assignment';
    }
}
