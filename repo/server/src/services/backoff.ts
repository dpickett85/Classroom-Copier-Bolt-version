/**
 * Exponential backoff with jitter, capped at 5 attempts (UX Delta P0-3).
 *
 * The policy consumes an optional `retryAfterMs` from the provider's error
 * rather than computing purely from the attempt count: real 429s arrive with a
 * `Retry-After` the mock's deterministic simulation will not produce, and the
 * port is shaped to accept it now so the real adapter is a swap.
 */

export const MAX_ATTEMPTS = 5

export interface BackoffPolicy {
  baseDelayMs: number
  multiplier: number
  maxDelayMs: number
  jitterRatio: number
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseDelayMs: 500,
  multiplier: 2,
  maxDelayMs: 8_000,
  jitterRatio: 0.2,
}

/**
 * @param attempt 1-based — the attempt that just failed.
 * @param retryAfterMs honoured when the provider supplies it.
 */
export function backoffDelayMs(
  attempt: number,
  retryAfterMs: number | undefined,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  if (retryAfterMs != null && retryAfterMs > 0) return retryAfterMs
  const raw = policy.baseDelayMs * policy.multiplier ** Math.max(0, attempt - 1)
  const capped = Math.min(raw, policy.maxDelayMs)
  const jitter = capped * policy.jitterRatio * (random() * 2 - 1)
  return Math.max(0, Math.round(capped + jitter))
}

export function hasAttemptsLeft(attempt: number): boolean {
  return attempt < MAX_ATTEMPTS
}
