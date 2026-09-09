/**
 * Environment configuration, resolved once and validated at boot.
 *
 * SESSION_SECRET has a fail-fast contract: the process refuses to boot without
 * one outside test. A dev default that ships is the classic form of this bug.
 */

function required(name: string): string {
  const value = process.env[name]
  if (value == null || value.trim() === '') {
    throw new Error(
      `[config] ${name} is required and is not set. Refusing to boot — a dev default that ships is how this becomes a production incident.`,
    )
  }
  return value
}

/**
 * §8.0/S3 — a presence check is not enough. AES-256-GCM needs exactly 32 bytes,
 * so a truncated paste must fail at BOOT with a message naming the fix, not at
 * the first encrypt in the middle of a teacher's transfer. (What this cannot
 * check is entropy: `openssl rand -base64 32` is documented in `.env.example`
 * and the handoff checklist because no runtime check can tell a random key from
 * a typed passphrase of the same length.)
 */
function tokenEncryptionKeyFromEnv(requiredNow: boolean): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (raw == null || raw.trim() === '') {
    if (!requiredNow) return null
    throw new Error(
      '[config] TOKEN_ENCRYPTION_KEY is required when GOOGLE_PROVIDER_MODE=google. Generate one with: openssl rand -base64 32',
    )
  }
  const key = Buffer.from(raw.trim(), 'base64')
  if (key.length !== 32) {
    throw new Error(
      `[config] TOKEN_ENCRYPTION_KEY must base64-decode to exactly 32 bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    )
  }
  return key
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const nodeEnv = process.env.NODE_ENV ?? 'development'
const isProductionLike = nodeEnv === 'production'
const isTest = nodeEnv === 'test' || process.env.VITEST === 'true'

export type GoogleProviderMode = 'mock' | 'google'

/**
 * QA-1 / PM §7.1a — the production boot refuses the fixture world.
 *
 * There used to be a bare `?? 'mock'` here and an `as 'mock' | 'google'` cast,
 * which meant a Render deploy that merely *omitted* `GOOGLE_PROVIDER_MODE` —
 * or typed it wrong — booted cleanly and served invented courses to a real
 * signed-in teacher. The type assertion was doing the damage as much as the
 * default: every consumer tests `=== 'google'`, so any unrecognised string
 * silently *behaved* as mock while claiming to be its own mode.
 *
 * So there are two rules, not one:
 *  - an unrecognised value is refused everywhere, production or not (a typo is
 *    never a mode);
 *  - mock is refused specifically when the environment is production-like.
 *
 * The default stays `'mock'` for the non-production case, deliberately: it is
 * the right default for a laptop and the whole test suite, and removing it
 * would make every developer set a variable to get what they already want. The
 * guard belongs on the ENVIRONMENT, which is the thing that actually
 * distinguishes Render from a laptop — not on the default.
 *
 * The message's reader is a teacher looking at a failed Render deploy, not a
 * developer with this file open, so it names the variable, the exact value,
 * where to put it, and what the wrong value would have done.
 */
function resolveGoogleProviderMode(raw: string | undefined, productionLike: boolean): GoogleProviderMode {
  const value = raw?.trim()

  if (value != null && value !== '' && value !== 'mock' && value !== 'google') {
    throw new Error(
      `[config] GOOGLE_PROVIDER_MODE is set to "${value}", which is not a mode this app has. ` +
        'The only two values are "google" (real Google Classroom) and "mock" (built-in demo data, for local development only). ' +
        'Refusing to boot: an unrecognised value would silently behave like "mock" and show demo courses instead of your real ones. ' +
        'Set GOOGLE_PROVIDER_MODE=google in your Render service\'s Environment settings and redeploy.',
    )
  }

  if (value === 'google') return 'google'

  if (productionLike) {
    throw new Error(
      '[config] GOOGLE_PROVIDER_MODE=google is required for a live deployment, and it is ' +
        (value === 'mock' ? 'set to "mock".' : 'not set.') +
        ' Refusing to boot: without it Classroom Copier would show made-up demo courses instead of your real Google Classroom, ' +
        'and any copy you started would go nowhere. ' +
        'To fix: open this service in the Render dashboard, go to Environment, add GOOGLE_PROVIDER_MODE=google, and redeploy. ' +
        '(See docs/handoff/connecting-to-live-google.md for the full list of variables this deployment needs.)',
    )
  }

  return 'mock'
}

const googleProviderMode = resolveGoogleProviderMode(process.env.GOOGLE_PROVIDER_MODE, isProductionLike)

/**
 * D25 — the two test/dev harness affordances ship in production code and are
 * inert by default AND inert under a production-like NODE_ENV. `cold-start-health`
 * has an acceptance test for exactly that, because a harness that leaks into
 * production is a harness that eventually causes an outage.
 */
function harnessDelay(name: string): number {
  if (isProductionLike) return 0
  return intFromEnv(name, 0)
}

const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

export const config = {
  nodeEnv,
  isProductionLike,
  isTest,
  port: intFromEnv('PORT', 4000),
  sessionSecret: isTest ? (process.env.SESSION_SECRET ?? 'test-secret') : required('SESSION_SECRET'),
  sessionTtlMs: intFromEnv('SESSION_TTL_MS', 24 * 60 * 60 * 1000),
  featureMonetizationEnabled: process.env.FEATURE_MONETIZATION_ENABLED === 'true',
  /**
   * The ONE discriminator that selects concrete adapters. Both the
   * `ClassroomProvider` and the `AccountDirectory` port are gated on this single
   * value rather than on two independent mode checks that could drift apart.
   */
  googleProviderMode,
  /**
   * Which Prisma datasource `scripts/prisma-datasource.mjs` generated against.
   * Recorded here so a boot log can say which database it is actually talking
   * to; the schema itself is selected before the process starts.
   */
  databaseProvider: (process.env.DATABASE_PROVIDER ?? 'sqlite') as 'sqlite' | 'postgresql',
  /** §8.0/S3 — validated at boot, never at first use. */
  tokenEncryptionKey: tokenEncryptionKeyFromEnv(googleProviderMode === 'google' && isProductionLike),
  corsOrigins,
  /**
   * §8.0/S2 — the OAuth callback's redirect target, read ONCE at boot and never
   * derived from the request. No `Referer`, no `Origin` echo, no `returnTo`
   * parameter: that is the difference between a redirect and an open redirect.
   */
  frontendOrigin: process.env.FRONTEND_ORIGIN?.trim() || corsOrigins[0] || 'http://localhost:5173',
  /** Real Google OAuth credentials — required only in google mode (see below). */
  googleClientId: googleProviderMode === 'google' ? required('GOOGLE_CLIENT_ID') : (process.env.GOOGLE_CLIENT_ID ?? ''),
  googleClientSecret:
    googleProviderMode === 'google' ? required('GOOGLE_CLIENT_SECRET') : (process.env.GOOGLE_CLIENT_SECRET ?? ''),
  googleRedirectUri:
    googleProviderMode === 'google' ? required('GOOGLE_REDIRECT_URI') : (process.env.GOOGLE_REDIRECT_URI ?? ''),
  /**
   * §5.1/Decision A — a job whose token has less than this left is refused
   * BEFORE it starts, turning the common late-session case from a mid-transfer
   * stall into a pre-transfer prompt. It is a floor, not a promise: a long job
   * started with an hour left can still exhaust the token, which is what
   * pause-and-resume exists for.
   */
  googleTokenMinRemainingMs: intFromEnv('GOOGLE_TOKEN_MIN_REMAINING_MS', 10 * 60 * 1000),
  /**
   * How long a job paused for re-auth is exempt from the reconciler's staleness
   * sweep. Without it the reconciler resolves a job the teacher is, at that very
   * moment, re-consenting in order to resume.
   */
  googleReauthGraceMs: intFromEnv('GOOGLE_REAUTH_GRACE_MS', 30 * 60 * 1000),
  /** Test harness, not a fixture — cold start has no fixture in the manifest. */
  coldStartSimulateDelayMs: harnessDelay('COLD_START_SIMULATE_DELAY_MS'),
  /** F12's slow mode is normally a run-scoped provider option; this env var is
   *  only for driving the deployed app by hand. Never fixture data. */
  mockProviderDelayMs: harnessDelay('MOCK_PROVIDER_DELAY_MS'),
  /** D12 — the stale-heartbeat sweep runs on an interval, not only at boot. */
  reconcilerIntervalMs: intFromEnv('RECONCILER_INTERVAL_MS', 30_000),
  /**
   * D12/P0-2 — how long without a heartbeat before a job is presumed dead.
   * The executor now holds a LEASE and heartbeats through topic creation and
   * the hydration enumeration, so this is a genuine liveness signal rather than
   * a guess about how long a slow-but-alive run can be silent.
   */
  jobStaleAfterMs: intFromEnv('JOB_STALE_AFTER_MS', 60_000),
  /** APPLY-I — a pre-flight scan older than this is refused at POST
   *  /transfer-jobs rather than transferred as a stale picture. */
  scanTtlMs: intFromEnv('SCAN_TTL_MS', 10 * 60 * 1000),
  /**
   * Seeding is idempotent and safe on every boot (D3).
   *
   * APPLY-L — but it defaults to FALSE under a production-like NODE_ENV. It is
   * idempotent for the fixture rows and has no opinion at all about the posts a
   * transfer creates in a target course, so a production instance that reseeded
   * on every boot accumulated them forever — which is the accumulation that
   * used to make the reconciler's title match report un-copied posts as copied.
   */
  seedOnBoot: isProductionLike
    ? process.env.SEED_ON_BOOT === 'true'
    : process.env.SEED_ON_BOOT !== 'false',
  /**
   * APPLY-L — the explicit reset path for rows a TRANSFER created. Seeding
   * restores the fixture world; only this removes what runs added to it. On by
   * default wherever seeding is (i.e. dev/demo), never in production.
   */
  pruneGeneratedOnBoot: isProductionLike
    ? process.env.PRUNE_GENERATED_ON_BOOT === 'true'
    : process.env.PRUNE_GENERATED_ON_BOOT !== 'false',
} as const

export type AppConfig = typeof config
