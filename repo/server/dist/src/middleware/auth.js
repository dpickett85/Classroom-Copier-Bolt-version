import { SESSION_COOKIE, resolveSession } from '../services/session.js';
export function requireAuth(prisma) {
    return async (req, res, next) => {
        const cookieToken = req.cookies?.[SESSION_COOKIE];
        const headerToken = extractBearerToken(req.get('authorization'));
        const token = headerToken ?? cookieToken;
        const session = await resolveSession(prisma, token);
        if (!session) {
            res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
            return;
        }
        req.auth = session;
        next();
    };
}
function extractBearerToken(header) {
    if (!header)
        return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match ? match[1] : undefined;
}
