/* ------------------------------------------------------------------ *
 * Error taxonomy (D10) — every one of these has a declared terminal
 * outcome path in transfer-engine (D12). A declared error class with no
 * declared outcome is how an item gets stuck in `pending` forever.
 * ------------------------------------------------------------------ */
export class ProviderError extends Error {
    constructor(message) {
        super(message);
        this.name = new.target.name;
    }
}
export class RateLimitError extends ProviderError {
    retryAfterMs;
    constructor(message = 'Rate limited', retryAfterMs) {
        super(message);
        this.retryAfterMs = retryAfterMs;
    }
}
export class PermissionError extends ProviderError {
}
/**
 * The CREDENTIAL itself was rejected — Google answered 401 / `invalid_grant`,
 * or the stored token no longer decrypts (a rotated or corrupted
 * TOKEN_ENCRYPTION_KEY). Deliberately distinct from `PermissionError`, which
 * means "this account may not touch THIS resource": the fix for that is a
 * different resource, and the fix for this one is always the same — the teacher
 * signs in again.
 *
 * `transfer-engine` routes it to pause-for-reauth rather than to a per-item
 * failure, so an expired token costs a reconnect, not a half-finished transfer.
 * `MockClassroomProvider` never throws it (a mock has no real token to expire);
 * its handling is exercised by direct injection, the same way
 * PermissionError/NotFoundError already are.
 */
export class AuthExpiredError extends ProviderError {
    constructor(message = 'Your Google connection expired. Sign in again to continue.') {
        super(message);
    }
}
export class NotFoundError extends ProviderError {
}
export class LicenseBlockedError extends ProviderError {
}
export class AttachmentNotVisibleError extends ProviderError {
}
/**
 * Google returned 502/503/504 — the service is temporarily unavailable.
 * Retryable, same backoff path as RateLimitError.
 */
export class TransientError extends ProviderError {
    retryAfterMs;
    constructor(message = 'Google is temporarily unavailable.', retryAfterMs) {
        super(message);
        this.retryAfterMs = retryAfterMs;
    }
}
export function isRateLimitError(e) {
    return e instanceof RateLimitError;
}
export function isTransientError(e) {
    return e instanceof TransientError;
}
