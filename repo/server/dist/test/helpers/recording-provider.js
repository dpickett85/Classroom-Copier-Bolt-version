import { AuthExpiredError } from '../../src/adapters/types.js';
/** The four calls that WRITE to the teacher's Drive or destination course. */
export const WRITE_METHODS = [
    'createCourseWork',
    'createCourseWorkMaterial',
    'createTopic',
    'copyAttachmentToMyDrive',
];
/** The two that create a POST — the ones "duplicate in the teacher's course" means. */
export const CREATE_POST_METHODS = ['createCourseWork', 'createCourseWorkMaterial'];
function subjectOf(method, args) {
    switch (method) {
        case 'createCourseWork':
        case 'createCourseWorkMaterial': {
            const payload = args[1];
            return payload?.title ?? null;
        }
        case 'createTopic':
            return args[1] ?? null;
        case 'copyAttachmentToMyDrive': {
            const ref = args[0];
            return ref?.id ?? null;
        }
        default:
            return null;
    }
}
export function recordingProvider(inner) {
    const calls = [];
    const markers = new Map();
    let postCreateCount = 0;
    const rec = {
        provider: inner,
        calls,
        failPostCreateAt: null,
        failOnMethods: new Set(),
        mark(label) {
            markers.set(label, calls.length);
        },
        since(label) {
            return calls.slice(markers.get(label) ?? 0);
        },
        postCreates(from = calls) {
            return from.filter((c) => CREATE_POST_METHODS.includes(c.method));
        },
        createdTitles(from = calls) {
            return rec
                .postCreates(from)
                .map((c) => c.subject)
                .filter((t) => t != null);
        },
        countOf(method, from = calls) {
            return from.filter((c) => c.method === method).length;
        },
    };
    rec.provider = new Proxy(inner, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function' || typeof prop !== 'string')
                return value;
            return (...args) => {
                // Recorded BEFORE any injected failure: the question these tests ask is
                // "did this call reach the provider at all", and a call that reached it
                // and was refused still reached it.
                if (WRITE_METHODS.includes(prop)) {
                    calls.push({ method: prop, subject: subjectOf(prop, args) });
                }
                if (rec.failOnMethods.has(prop)) {
                    rec.failOnMethods.delete(prop);
                    return Promise.reject(new AuthExpiredError());
                }
                if (CREATE_POST_METHODS.includes(prop)) {
                    postCreateCount += 1;
                    if (rec.failPostCreateAt != null && postCreateCount === rec.failPostCreateAt) {
                        return Promise.reject(new AuthExpiredError());
                    }
                }
                return value.apply(target, args);
            };
        },
    });
    return rec;
}
