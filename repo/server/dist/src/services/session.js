/**
 * Sessions — a signed JWT in an httpOnly cookie, plus a revocable `Session`
 * row.
 *
 * The row is not ceremony: a pure stateless JWT has no revocation, so "switch
 * account" and "sign out" would leave a still-valid token a copied cookie could
 * replay. With two seeded accounts that means mis-scoped writes landing
 * classwork in the wrong teacher's course — a data-integrity bug, not merely a
 * security abstraction.
 */
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
export const SESSION_COOKIE = 'cc_session';
export async function createSession(prisma, accountId) {
    const sessionId = `sess-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + config.sessionTtlMs);
    await prisma.session.create({ data: { id: sessionId, accountId, expiresAt } });
    const token = jwt.sign({ sid: sessionId, accountId }, config.sessionSecret, {
        expiresIn: Math.floor(config.sessionTtlMs / 1000),
    });
    return { token, sessionId, expiresAt };
}
export async function resolveSession(prisma, token) {
    if (!token)
        return null;
    let claims;
    try {
        claims = jwt.verify(token, config.sessionSecret);
    }
    catch {
        return null;
    }
    const row = await prisma.session.findUnique({ where: { id: claims.sid } });
    // A revoked or expired row means 401, never a silently-succeeding request.
    if (!row || row.revokedAt != null || row.expiresAt.getTime() < Date.now())
        return null;
    if (row.accountId !== claims.accountId)
        return null;
    return { accountId: row.accountId, sessionId: row.id };
}
export async function revokeSession(prisma, sessionId) {
    await prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
}
/**
 * `SameSite=None; Secure` is required in production because the frontend and
 * API are split-origin Render services. It is NOT usable over plain http, so
 * local dev and test use `SameSite=Lax` without `Secure` and the Vite dev
 * server proxies `/api` to the backend, making dev same-origin. Shipping
 * `Secure` in dev would simply mean no cookie is ever sent and every local run
 * looks like a broken auth bug.
 */
export function cookieOptions(expiresAt) {
    return {
        httpOnly: true,
        sameSite: config.isProductionLike ? 'none' : 'lax',
        secure: config.isProductionLike,
        expires: expiresAt,
        path: '/',
    };
}
export function clearCookieOptions() {
    return {
        path: '/',
        sameSite: config.isProductionLike ? 'none' : 'lax',
        secure: config.isProductionLike,
    };
}
