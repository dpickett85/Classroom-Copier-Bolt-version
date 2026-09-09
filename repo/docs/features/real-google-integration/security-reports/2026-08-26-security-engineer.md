SECURITY CODE REVIEW — Classroom Copier / Real Google Integration (Phase 2)

Scope: `server/src/adapters/google/{oauth-client,real-classroom-provider}.ts`, `server/src/routes/auth.ts`,
`server/src/config.ts`, `server/src/logger.ts`, `server/src/app.ts`, `server/src/index.ts`,
`server/src/services/{token-crypto,session,job-reconciler,transfer-engine,preflight-engine,post-enumerator,reconciliation,account-directory}.ts`,
`server/src/middleware/{auth,csrf}.ts`, `server/prisma/schema.template.prisma`, `client/src/lib/api-client.ts`,
`client/src/features/auth/*`, `.env.example` (root/server/client), `docs/handoff/connecting-to-live-google.md`,
`server/test/{google-oauth.integration,cross-account-isolation,composition-root}.test.ts`, `server/src/services/token-crypto.test.ts`

Commit: `3b1fca33e0bc45db715358a92ea51d6b4f8f6e58` (branch `phase2/real-google-integration`)
Reviewed: 2026-08-26

Dependency audit: `npm audit` — server: 7 advisories (4 moderate, 3 high), **0 reachable at runtime**; client: 0 advisories.
Architect-report risks re-checked: 8 confirmed enforced (S1, S2, S3, S4, S6, S7, S8, S9-superseded) · 1 partially confirmed (S5) · 0 unimplemented

EXPOSED CREDENTIALS: none found. Grepped for Google client-secret shapes (`GOCSPX-…`), API-key shapes (`AIza…`),
and literal `client_secret` assignments across `*.ts/.tsx/.json/.md/.env*`; the only hit is a placeholder string
`'client-secret'` in a test fixture (`server/src/services/token-crypto.test.ts:94`), not a real credential.
`.env.example` (root, `server/.env.example`, `client/.env.example`) are placeholders only. No `VITE_`-prefixed
variable carries anything but the public API base URL (`client/src/lib/api-client.ts:55`).

Findings: 1 critical · 0 high · 0 medium · 1 low

| # | Severity | Dimension | File:line | Finding | Fix | APPLY/DEFER |
|---|----------|-----------|-----------|---------|-----|-------------|
| E1 | critical | Insecure defaults / production gate | `server/src/app.ts:57-62`, `server/src/index.ts:24` | `buildApp()`'s classroom-data provider defaults to `new MockClassroomProvider(...)` whenever `deps.provider` is omitted, and `index.ts` — the real production boot path — calls `buildApp({ prisma })` with no `provider` at all. `RealClassroomProvider` (`server/src/adapters/google/real-classroom-provider.ts:293`) is instantiated nowhere in production code — only in its own test file (`real-classroom-provider.test.ts:82`). `config.googleProviderMode` gates `createAccountDirectory` (app.ts:65) and mounts/unmounts the mock auth routes (app.ts:118-120), but **never selects the classroom provider**. Net effect: a teacher can complete real Google OAuth (real consent, real encrypted token, real `GoogleAccount` row) and every subsequent course listing, pre-flight scan, and post-copy operation still runs against the in-memory mock fixture world, never touching Google Classroom. This contradicts 05-implementation.md's explicit claim ("Mock provider stays test-only... production boot fail-fasts on GOOGLE_PROVIDER_MODE") — that claim is true only for the mock account-picker *routes*, not for the mock classroom *provider*, which is what actually reads and writes a teacher's coursework. No test anywhere asserts `buildApp` selects `RealClassroomProvider` when `GOOGLE_PROVIDER_MODE=google` (checked `composition-root.test.ts`, `google-oauth.integration.test.ts` — the latter's §8.4 test only checks the mock *routes* 404, not provider wiring). | In `app.ts`, branch on `config.googleProviderMode` the same way `createAccountDirectory` already does: `deps.provider ?? (config.googleProviderMode === 'google' ? new RealClassroomProvider(...) : new MockClassroomProvider(...))`, and make it construct the Google client per-request/per-account as `real-classroom-provider.ts` already expects (it takes an authorized client, not a bare account id — the composition needs `buildAuthorizedClient` wired in). Add a boot-time assertion mirroring the `TOKEN_ENCRYPTION_KEY` fail-fast: refuse to boot if `GOOGLE_PROVIDER_MODE=google` and the wired provider is not `RealClassroomProvider`. Add a `composition-root` test asserting provider identity per mode, matching the existing pattern for `createAccountDirectory`. | APPLY |
| E2 | low | Design risk / test coverage (S5) | `server/test/cross-account-isolation.test.ts:36-40` | The cross-account isolation contract test (S5) is real and asserts the right thing (403/404 status codes, not just body diffing — `cross-account-isolation.test.ts:11-14`), but it drives both accounts through the **mock** sign-in path (`ACCOUNT_JAMIE`/`ACCOUNT_DANA` via `POST /api/auth/sign-in`), never through two distinct `GoogleAccount` rows. The route/middleware code it exercises (`requireAuth`, `resolveSession`, every `job.accountId !== req.auth!.accountId` check) is provider-agnostic — `Session.accountId` is opaque to whether it names a `MockAccount` or `GoogleAccount` — so the coverage is representative, and `google-oauth.integration.test.ts:249-281` separately proves the resume-by-account-id path (S8) against a real `GoogleAccount`-flavored `TransferJob`. Still, no single test signs in two distinct Google identities and asserts isolation between them. | Add one `GoogleAccount`-flavored case to either file: two fake OAuth callbacks with different `sub` claims, then assert B's session cannot read A's `TransferJob`/`PreflightScan` — closing the literal reading of S5 ("account A cannot reach account B's GoogleAccount") rather than relying on the mock-account proxy. | DEFER |

## Prior-finding dispositions
| Finding | Severity | Disposition | Evidence |
|---|---|---|---|
| S1 (PKCE, S256) | medium | resolved | `server/src/adapters/google/oauth-client.ts:50-54` (`createPkcePair` — SHA-256 challenge, base64url verifier), `:79-80` (`code_challenge_method: 'S256'`); verifier carried only in the `cc_oauth_state` cookie payload (`server/src/routes/auth.ts:112-140`), never in the authorization URL; proven end-to-end including a verifier-mismatch rejection in `server/test/google-oauth.integration.test.ts:102-133,204-214`. |
| S2 (open redirect) | medium | resolved | `server/src/config.ts:96-100` — `frontendOrigin` resolved once at boot from `FRONTEND_ORIGIN` else `CORS_ORIGINS[0]`, never from request data; `server/src/routes/auth.ts:70-86` — `redirectToFrontend` is "the ONLY function that builds a Location header" and takes no request-derived parameter; directly proven against hostile `Referer`/`Origin`/`returnTo`/absolute-URL `state` in `server/test/google-oauth.integration.test.ts:225-247`. |
| S3 (key generation guidance) | medium | resolved | `server/src/config.ts:26-41` — 32-byte base64-decode check, boot fail-fast with the exact message; `.env.example:59` and `server/src/config.ts:31,37` all carry the literal `openssl rand -base64 32` command; boot behavior proven in `server/src/services/token-crypto.test.ts:98-115`. |
| S4 (decrypt-failure → reauth path) | medium | resolved | `server/src/services/token-crypto.ts:59-80` — `decryptToken`'s catch discards the raw cipher error and throws `AuthExpiredError`, routing into the existing pause/reconnect UX identically to an expired token; proven for a wrong key, a tampered auth tag, and garbage ciphertext in `token-crypto.test.ts:32-51`. |
| S5 (cross-account isolation test) | low | resolved, with a gap | `server/test/cross-account-isolation.test.ts` (5 tests, status-code assertions, not body diffing) proves the property at the route layer; see E2 above for the one literal gap (no test signs in two distinct `GoogleAccount` identities). |
| S6 (no-log-tokens rule) | low | resolved | `server/src/services/token-crypto.ts:71-79` and `oauth-client.ts:104-109,134-137` discard raw errors rather than logging them; `real-classroom-provider.ts:126-155` (`mapGoogleError`) converts every raw googleapis/gaxios error into a fixed-message `ProviderError` before it can reach any `logger.*` call or an HTTP response, so `config.headers.Authorization` on a gaxios error object never has a path to a log line; every `logger.error/warn` call site reviewed (`transfer-engine.ts`, `app.ts:148-150`, `job-reconciler.ts:362-364`, `index.ts:53-57`) logs only `error.message`, never the raw error object; explicit negative-assertion test in `token-crypto.test.ts:54-68` (`.not.toContain` on ciphertext/iv/tag/plaintext). |
| S7 (`cc_oauth_state` cookie attrs) | low | resolved | `server/src/routes/auth.ts:56-64` — `HttpOnly`, `SameSite=Lax`, `Secure` conditional on `config.isProductionLike`, `path: '/api/auth'`, `maxAge: 600000` (10 min); asserted directly in `google-oauth.integration.test.ts:116-126` including the dev-mode `not Secure` case. |
| S8 (resume scoped by session account) | low | resolved | `server/src/routes/auth.ts:199-214` — the paused job is looked up by `accountId: identity.sub` (the just-authenticated session's own account), never by a request-supplied job id; proven negatively in `google-oauth.integration.test.ts:249-281` (a job paused under a different account is left untouched by B's callback). |
| S9 (Drive scope blast radius) | low, informational | superseded | The implementation uses `drive.file` (`server/src/adapters/google/oauth-client.ts:38`), **not** the `drive.metadata.readonly` scope the architecture review evaluated — `drive.file` grants access only to files the app created or the user explicitly opened with it, which eliminates the whole-Drive metadata exposure S9 was scored against. The handoff doc (`docs/handoff/connecting-to-live-google.md:56-63`) explains *why* Drive access is requested but does not name the specific scope; given the scope actually used has no meaningful blast radius left to disclose, this is a documentation nicety, not a live gap. |

## Independent checks (per assignment)

1. **AES-256-GCM.** IV: `crypto.randomBytes(12)` fresh per call (`token-crypto.ts:49`), proven never to repeat across two encryptions of identical plaintext (`token-crypto.test.ts:15-22`). Auth tag: captured via `cipher.getAuthTag()` and verified via `decipher.setAuthTag()` before any plaintext is returned (`token-crypto.ts:55,66`). Tamper resistance: a flipped tag byte and substituted ciphertext both throw and are both mapped to `AuthExpiredError` rather than returning garbage plaintext (`token-crypto.test.ts:37-51`) — fails closed. No static IV, no ECB/CBC fallback anywhere in the module.
2. **Secrets.** See "EXPOSED CREDENTIALS" above — none committed. No `VITE_`-prefixed variable carries a secret; `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are read only server-side (`config.ts:102-104`) and the authorization URL is built server-side (`oauth-client.ts:70-82`) so the client never needs them.
3. **Authorization on every route.** Every account-scoped route (`courses.ts:27,64`; `transfer-jobs.ts:91,158,174,241,266`) derives `accountId` from `req.auth!.accountId` (session-resolved, never client-supplied) and, on the two read paths that take a resource id (`GET /transfer-jobs/:id/status`, `GET /transfer-jobs/:id/items`), re-checks `job.accountId !== req.auth!.accountId` before returning anything — ownership is checked, not inferred. `requireAuth` (`middleware/auth.ts:11-22`) itself never trusts a client-supplied account id.
4. **CSRF/CORS.** `cors({ origin: config.corsOrigins, credentials: true })` (`app.ts:84-89`) is a fixed allowlist, not `origin: true` and not an `Origin`-reflecting function — confirmed unchanged from the design review's reading. `requireCsrfHeader()` (`middleware/csrf.ts:21-33`) still requires `X-Classroom-Copier` on every `POST/PATCH/DELETE`, forcing a preflight the fixed-origin CORS config can refuse; the two new GET auth routes correctly sit outside `PROTECTED_METHODS`.
5. **Mock provider unreachable in production.** The mock **auth routes** are correctly gated (`app.ts:118-120`, proven 404 in `google-oauth.integration.test.ts:298-322`) and the client bundle is clean of mock endpoints per 05-implementation.md. The mock **classroom provider**, however, is not gated at all — see **E1**, critical.

## Currency note (dimension 11)

Verified current as of 2026-08-26: AES-256-GCM with a random 96-bit IV, a 128-bit auth tag, and a key held separate
from the session-signing secret remains aligned with OWASP's Cryptographic Storage Cheat Sheet guidance carried
forward from the architect-stage review; nothing in the implementation regresses that. PKCE with S256 matches
RFC 9700 / OAuth 2.1 guidance already cited by the architect review — implementation source read directly rather
than assumed.

## Note on the working tree at review time

The commit reviewed (`3b1fca3`) correctly implements the P0-B/P0-C re-entrancy fix in `transfer-engine.ts:702,725-731`
(`where: { jobId, outcome: 'pending' }` plus the evidence-ambiguous-item branch). At the moment this review ran, the
**uncommitted working tree** contained a local, unstaged edit to that same file that reverts both lines — dropping the
`outcome: 'pending'` filter and collapsing the evidence-ambiguous branch back to a straight pass-through. This is not
part of commit `3b1fca3` and is outside this report's scope (and this review never edits code), but it is a live
regression risk in the working directory the human should check before anything is committed on top of it: it is a
duplicate-post/data-integrity defect, not a credential or authorization issue, so it is flagged here rather than
scored as a numbered finding.

Verdict: fix before gate
